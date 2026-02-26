import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { syncAuthFromOpenCode } from './auth-sync.js'
import {
  createAuthorizationFlow,
  createHeadlessAuthorizationFlow,
  loginAccount,
  loginAccountHeadless
} from './auth.js'
import { extractRateLimitUpdate, mergeRateLimits } from './rate-limits.js'
import {
  getNextAccount,
  markAuthInvalid,
  markModelUnsupported,
  markRateLimited,
  markWorkspaceDeactivated
} from './rotation.js'
import { listAccounts, updateAccount } from './store.js'
import { type AccountAuthType, DEFAULT_CONFIG, type PluginConfig } from './types.js'
import {
  ensureCodexInstructions,
  ensureCodexPayloadCompatibility,
  extractForcedAuthType,
  extractModelName,
  normalizeModel,
  rewriteOpenAIModelsForRouting,
  selectAuthTypeForRequest,
  stripForcedAuthType,
  toCodexBackendUrl
} from './routing.js'

const PROVIDER_ID = 'openai'
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1'
const REDIRECT_PORT = 1455
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`
const URL_PATHS = {
  RESPONSES: '/responses',
  CODEX_RESPONSES: '/codex/responses'
}
const OPENAI_HEADERS = {
  BETA: 'OpenAI-Beta',
  ACCOUNT_ID: 'chatgpt-account-id',
  ORIGINATOR: 'originator',
  SESSION_ID: 'session_id',
  CONVERSATION_ID: 'conversation_id'
}
const OPENAI_HEADER_VALUES = {
  BETA_RESPONSES: 'responses=experimental',
  ORIGINATOR_CODEX: 'codex_cli_rs'
}
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

let pluginConfig: PluginConfig = { ...DEFAULT_CONFIG }

type ProviderModelConfig = Record<string, any>

type ModelsDevCost = {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

type ModelsDevLimit = {
  context?: number
  input?: number
  output?: number
}

type ModelsDevModalities = {
  input?: string[]
  output?: string[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(headers: Headers): number | null {
  const retryAfterMs = headers.get('retry-after-ms')
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs)
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed)
  }

  const retryAfter = headers.get('retry-after')
  if (!retryAfter) return null

  const seconds = Number.parseFloat(retryAfter)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000)
  }

  const dateMs = Date.parse(retryAfter)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    if (delta > 0) return Math.ceil(delta)
  }

  return null
}

function opencodeModelsPath(): string {
  const override = process.env.OPENCODE_MODELS_PATH
  if (override && override.trim()) return override.trim()
  const xdgCacheHome = process.env.XDG_CACHE_HOME
  if (xdgCacheHome && xdgCacheHome.trim()) {
    return path.join(xdgCacheHome.trim(), 'opencode', 'models.json')
  }
  return path.join(os.homedir(), '.cache', 'opencode', 'models.json')
}

function loadCachedOpenAIModels(): Record<string, ProviderModelConfig> {
  const primary = opencodeModelsPath()
  const fallback = path.join(os.homedir(), '.local', 'share', 'opencode', 'models.json')
  const candidates = primary === fallback ? [primary] : [primary, fallback]

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue

    try {
      const raw = fs.readFileSync(file, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, any>
      const openai = parsed?.openai
      const models = openai?.models
      if (!models || typeof models !== 'object') continue
      if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
        console.log(`[multi-auth] loaded openai models cache from ${file}`)
      }
      return models as Record<string, ProviderModelConfig>
    } catch {
      continue
    }
  }

  return {}
}

function hasProviderModelShape(models: Record<string, ProviderModelConfig>): boolean {
  return Object.values(models).some((model) => {
    return Boolean(
      model &&
      typeof model === 'object' &&
      model.api &&
      typeof model.api === 'object' &&
      typeof model.api.id === 'string'
    )
  })
}

function parseModelNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toProviderSeedModel(modelID: string, model: ProviderModelConfig): ProviderModelConfig {
  const modalities = (model?.modalities || {}) as ModelsDevModalities
  const limit = (model?.limit || {}) as ModelsDevLimit
  const cost = (model?.cost || {}) as ModelsDevCost
  const inputModalities = toStringArray(modalities.input)
  const outputModalities = toStringArray(modalities.output)

  return {
    id: modelID,
    providerID: PROVIDER_ID,
    api: {
      id: modelID,
      url: typeof model?.provider?.api === 'string' ? model.provider.api : OPENAI_API_BASE_URL,
      npm: typeof model?.provider?.npm === 'string' ? model.provider.npm : '@ai-sdk/openai'
    },
    status: typeof model?.status === 'string' ? model.status : 'active',
    name: typeof model?.name === 'string' && model.name.trim() ? model.name : modelID,
    capabilities: {
      temperature: Boolean(model?.temperature),
      reasoning: Boolean(model?.reasoning),
      attachment: Boolean(model?.attachment),
      toolcall: model?.tool_call !== false,
      input: {
        text: inputModalities.includes('text'),
        audio: inputModalities.includes('audio'),
        image: inputModalities.includes('image'),
        video: inputModalities.includes('video'),
        pdf: inputModalities.includes('pdf')
      },
      output: {
        text: outputModalities.includes('text'),
        audio: outputModalities.includes('audio'),
        image: outputModalities.includes('image'),
        video: outputModalities.includes('video'),
        pdf: outputModalities.includes('pdf')
      },
      interleaved: model?.interleaved ?? false
    },
    cost: {
      input: parseModelNumber(cost.input),
      output: parseModelNumber(cost.output),
      cache: {
        read: parseModelNumber(cost.cache_read),
        write: parseModelNumber(cost.cache_write)
      }
    },
    options: model?.options && typeof model.options === 'object' ? model.options : {},
    limit: {
      context: parseModelNumber(limit.context),
      input: parseModelNumber(limit.input),
      output: parseModelNumber(limit.output)
    },
    headers: model?.headers && typeof model.headers === 'object' ? model.headers : {},
    family: typeof model?.family === 'string' ? model.family : '',
    release_date: typeof model?.release_date === 'string' ? model.release_date : '',
    variants: model?.variants && typeof model.variants === 'object' ? model.variants : {}
  }
}

function buildInjectedLatestModel(providerShape: boolean, latestModel: string): ProviderModelConfig {
  if (providerShape) {
    return {
      id: latestModel,
      providerID: PROVIDER_ID,
      api: {
        id: latestModel,
        url: OPENAI_API_BASE_URL,
        npm: '@ai-sdk/openai'
      },
      status: 'active',
      name: 'GPT-5.3 Codex',
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 }
      },
      options: {},
      limit: {
        context: 200000,
        input: 200000,
        output: 8192
      },
      headers: {},
      family: 'gpt-codex',
      release_date: '',
      variants: {}
    }
  }

  return {
    id: latestModel,
    name: 'GPT-5.3 Codex',
    reasoning: true,
    tool_call: true,
    temperature: true,
    limit: {
      context: 200000,
      output: 8192
    }
  }
}

function buildRouteModelSeed(existing: Record<string, ProviderModelConfig>): Record<string, ProviderModelConfig> {
  const seed: Record<string, ProviderModelConfig> = { ...existing }
  const cached = loadCachedOpenAIModels()
  const providerShape = hasProviderModelShape(existing)

  for (const [modelID, model] of Object.entries(cached)) {
    if (seed[modelID]) continue
    seed[modelID] = providerShape
      ? toProviderSeedModel(modelID, model)
      : {
          id: modelID,
          name: typeof model?.name === 'string' && model.name.trim() ? model.name : modelID
        }
  }

  return seed
}

function buildRoutedModelMap(existing: Record<string, ProviderModelConfig>): Record<string, ProviderModelConfig> {
  const seed = buildRouteModelSeed(existing)
  const providerShape = hasProviderModelShape(existing)

  const injectModelsRaw = process.env.OPENCODE_MULTI_AUTH_INJECT_MODELS
  const injectModels = injectModelsRaw === '1' || injectModelsRaw === 'true'
  if (injectModels) {
    const latestModel = (process.env.OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL || 'gpt-5.3-codex').trim()
    if (!seed[latestModel]) {
      seed[latestModel] = buildInjectedLatestModel(providerShape, latestModel)
    }
  }

  return rewriteOpenAIModelsForRouting(seed)
}

function replaceModelMapInPlace(
  target: Record<string, ProviderModelConfig>,
  next: Record<string, ProviderModelConfig>
): Record<string, ProviderModelConfig> {
  for (const key of Object.keys(target)) {
    delete target[key]
  }

  for (const [key, value] of Object.entries(next)) {
    target[key] = value
  }

  return target
}

function configure(config: Partial<PluginConfig>): void {
  pluginConfig = { ...pluginConfig, ...config }
}

function decodeJWT(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const decoded = Buffer.from(payload, 'base64').toString('utf-8')
    return JSON.parse(decoded) as Record<string, any>
  } catch {
    return null
  }
}

function extractRequestUrl(input: Request | string | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function resolveRequestMethod(input: Request | string | URL, init?: RequestInit): string {
  if (init?.method) return init.method
  if (input instanceof Request && input.method) return input.method
  return 'POST'
}

function resolveRequestHeaders(input: Request | string | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  const override = new Headers(init?.headers || {})
  for (const [key, value] of override.entries()) {
    headers.set(key, value)
  }
  return headers
}

function parseJsonBody(raw: string): Record<string, any> | null {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, any>
  } catch {
    return null
  }
}

async function resolveRequestBody(
  input: Request | string | URL,
  init?: RequestInit
): Promise<Record<string, any>> {
  if (typeof init?.body === 'string') {
    return parseJsonBody(init.body) || {}
  }

  if (input instanceof Request) {
    try {
      const text = await input.clone().text()
      const parsed = parseJsonBody(text)
      if (parsed) return parsed
    } catch {
      // ignore body parse failures
    }
  }

  return {}
}

function rewriteUrlForCodex(url: string): string {
  return url.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES)
}

function filterInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input
  return input
    .filter((item) => item?.type !== 'item_reference')
    .map((item) => {
      if (item && typeof item === 'object' && 'id' in item) {
        const { id, ...rest } = item as Record<string, unknown>
        return rest
      }
      return item
    })
}

function ensureContentType(headers: Headers): Headers {
  const responseHeaders = new Headers(headers)
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'text/event-stream; charset=utf-8')
  }
  return responseHeaders
}

function parseSseStream(sseText: string): unknown | null {
  const lines = sseText.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    try {
      const data = JSON.parse(line.substring(6)) as { type?: string; response?: unknown }
      if (data?.type === 'response.done' || data?.type === 'response.completed') {
        return data.response
      }
    } catch {
      // ignore malformed chunks
    }
  }
  return null
}

async function convertSseToJson(response: Response, headers: Headers): Promise<Response> {
  if (!response.body) {
    throw new Error('[multi-auth] Response has no body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  const jsonHeaders = new Headers(headers)
  jsonHeaders.set('content-type', 'application/json; charset=utf-8')

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fullText += decoder.decode(value, { stream: true })

    const finalResponse = parseSseStream(fullText)
    if (finalResponse) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      return new Response(JSON.stringify(finalResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: jsonHeaders
      })
    }
  }

  fullText += decoder.decode()

  const finalResponse = parseSseStream(fullText)
  if (!finalResponse) {
    return new Response(fullText, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  }

  return new Response(JSON.stringify(finalResponse), {
    status: response.status,
    statusText: response.statusText,
    headers: jsonHeaders
  })
}

/**
 * Multi-account OAuth plugin for OpenCode
 *
 * Rotates between multiple ChatGPT Plus/Pro accounts for rate limit resilience.
 */
const MultiAuthPlugin: Plugin = async ({ client, $, serverUrl, project, directory }: PluginInput) => {
  const terminalNotifierPath = (() => {
    const candidates = [
      '/opt/homebrew/bin/terminal-notifier',
      '/usr/local/bin/terminal-notifier'
    ]
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) return c
      } catch {
        // ignore
      }
    }
    return null
  })()

  const notifyEnabledRaw = process.env.OPENCODE_MULTI_AUTH_NOTIFY
  const notifyEnabled = notifyEnabledRaw !== '0' && notifyEnabledRaw !== 'false'
  const notifySound = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_SOUND || '/System/Library/Sounds/Glass.aiff').trim()

  const lastStatusBySession = new Map<string, string>()
  const lastNotifiedAtByKey = new Map<string, number>()
  const lastRetryAttemptBySession = new Map<string, number>()

  const escapeAppleScriptString = (value: string): string => {
    return String(value)
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\"')
      .replaceAll(String.fromCharCode(10), '\n')
  }

  let didWarnTerminalNotifier = false

  const notifyMac = (title: string, message: string, clickUrl?: string): void => {
    if (!notifyEnabled) return
    if (process.platform !== 'darwin') return

    const macOpenRaw = process.env.OPENCODE_MULTI_AUTH_NOTIFY_MAC_OPEN
    const macOpenEnabled = macOpenRaw !== '0' && macOpenRaw !== 'false'

    // Best effort: clickable notifications require terminal-notifier.
    if (macOpenEnabled && clickUrl && terminalNotifierPath) {
      try {
        $`${terminalNotifierPath} -title ${title} -message ${message} -open ${clickUrl}`
          .nothrow()
          .catch(() => {})
      } catch {
        // ignore
      }
    } else {
      if (macOpenEnabled && clickUrl && !terminalNotifierPath && !didWarnTerminalNotifier) {
        didWarnTerminalNotifier = true
        if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
          console.log('[multi-auth] mac click-to-open requires terminal-notifier (brew install terminal-notifier)')
        }
      }

      try {
        const osascript = '/usr/bin/osascript'
        const safeTitle = escapeAppleScriptString(title)
        const safeMessage = escapeAppleScriptString(message)
        const script = `display notification "${safeMessage}" with title "${safeTitle}"`

        // Fire-and-forget: never block OpenCode event processing.
        $`${osascript} -e ${script}`.nothrow().catch(() => {})
      } catch {
        // ignore
      }
    }

    if (!notifySound) return

    try {
      const afplay = '/usr/bin/afplay'
      $`${afplay} ${notifySound}`.nothrow().catch(() => {})
    } catch {
      // ignore
    }
  }


  const ntfyUrl = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_NTFY_URL || '').trim()
  const ntfyToken = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_NTFY_TOKEN || '').trim()
  const notifyUiBaseUrl = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_UI_BASE_URL || '').trim()

  const getSessionUrl = (sessionID: string): string => {
    const base = (notifyUiBaseUrl || serverUrl?.origin || '').replace(/\/$/, '')
    if (!base) return ''
    return `${base}/session/${sessionID}`
  }



  const projectLabel = (((project as any)?.name as string | undefined) || project?.id || '').trim() || 'OpenCode'

  type SessionMeta = { title?: string }
  const sessionMetaCache = new Map<string, SessionMeta>()

  const getSessionMeta = async (sessionID: string): Promise<SessionMeta> => {
    const cached = sessionMetaCache.get(sessionID)
    if (cached?.title) return cached

    try {
      const res = await client.session.get({
        path: { id: sessionID },
        query: { directory }
      })

      // @opencode-ai/sdk returns { data } shape.
      const data = (res as any)?.data as { title?: string } | undefined
      const meta: SessionMeta = { title: data?.title }
      sessionMetaCache.set(sessionID, meta)
      return meta
    } catch {
      const meta: SessionMeta = cached || {}
      sessionMetaCache.set(sessionID, meta)
      return meta
    }
  }

  const formatTitle = (kind: 'idle' | 'retry' | 'error'): string => {
    if (kind === 'error') return `OpenCode - ${projectLabel} - Error`
    if (kind === 'retry') return `OpenCode - ${projectLabel} - Retrying`
    return `OpenCode - ${projectLabel}`
  }

  const formatBody = async (kind: 'idle' | 'retry' | 'error', sessionID: string, detail?: string): Promise<string> => {
    const meta = await getSessionMeta(sessionID)
    const titleLine = meta.title ? `Task: ${meta.title}` : ''
    const url = getSessionUrl(sessionID)

    if (kind === 'idle') {
      return [titleLine, `Session finished: ${sessionID}`, detail || '', url].filter(Boolean).join('\n')
    }

    if (kind === 'retry') {
      return [titleLine, `Retrying: ${sessionID}`, detail || '', url].filter(Boolean).join('\n')
    }

    return [titleLine, `Error: ${sessionID}`, detail || '', url].filter(Boolean).join('\n')
  }

  const notifyMacRich = async (kind: 'idle' | 'retry' | 'error', sessionID: string, detail?: string): Promise<void> => {
    const body = await formatBody(kind, sessionID, detail)
    notifyMac(formatTitle(kind), body, getSessionUrl(sessionID) || undefined)
  }

  const notifyNtfyRich = async (kind: 'idle' | 'retry' | 'error', sessionID: string, detail?: string): Promise<void> => {
    if (!notifyEnabled) return
    if (!ntfyUrl) return

    const sessionUrl = getSessionUrl(sessionID)
    const title = formatTitle(kind)
    const body = await formatBody(kind, sessionID, detail)

    // ntfy priority: 1=min, 3=default, 5=max
    const priority = kind === 'error' ? '5' : kind === 'retry' ? '4' : '3'

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Title': title,
      'Priority': priority
    }

    if (sessionUrl) headers['Click'] = sessionUrl
    if (ntfyToken) headers['Authorization'] = `Bearer ${ntfyToken}`

    try {
      await fetch(ntfyUrl, { method: 'POST', headers, body })
    } catch {
      // ignore
    }
  }
  const shouldThrottle = (key: string, minMs: number): boolean => {
    const last = lastNotifiedAtByKey.get(key) || 0
    const now = Date.now()
    if (now - last < minMs) return true
    lastNotifiedAtByKey.set(key, now)
    return false
  }

  const formatRetryDetail = (status: any): string => {
    const attempt = typeof status?.attempt === 'number' ? status.attempt : undefined
    const message = typeof status?.message === 'string' ? status.message : ''
    const next = typeof status?.next === 'number' ? status.next : undefined

    const parts: string[] = []
    if (typeof attempt === 'number') parts.push(`Attempt: ${attempt}`)
    // OpenCode has emitted both "seconds-until-next" and "epoch ms" variants over time.
    if (typeof next === 'number') {
      const seconds =
        next > 1e12 ? Math.max(0, Math.round((next - Date.now()) / 1000)) : Math.max(0, Math.round(next))
      parts.push(`Next in: ${seconds}s`)
    }
    if (message) parts.push(message)
    return parts.join(' | ')
  }

  const formatErrorDetail = (err: any): string => {
    if (!err || typeof err !== 'object') return ''
    const name = typeof err.name === 'string' ? err.name : ''
    const code = typeof err.code === 'string' ? err.code : ''
    const message =
      (typeof err.message === 'string' && err.message) ||
      (typeof err.error?.message === 'string' && err.error.message) ||
      ''
    return [name, code, message].filter(Boolean).join(': ')
  }

  const notifyRich = async (
    kind: 'idle' | 'retry' | 'error',
    sessionID: string,
    detail?: string
  ): Promise<void> => {
    try {
      await notifyMacRich(kind, sessionID, detail)
    } catch {
      // ignore
    }

    try {
      await notifyNtfyRich(kind, sessionID, detail)
    } catch {
      // ignore
    }
  }

  return {
    event: async ({ event }) => {
      if (!notifyEnabled) return
      if (!event || !('type' in event)) return

      if (event.type === 'session.created' || event.type === 'session.updated') {
        const info = (event as any).properties?.info as
          | { id?: string; title?: string }
          | undefined
        const id = info?.id
        if (id) {
          sessionMetaCache.set(id, { title: info?.title })
        }
        return
      }

      if (event.type === 'session.status') {
        const sessionID = (event as any).properties?.sessionID as string | undefined
        const status = (event as any).properties?.status
        const statusType = status?.type as string | undefined
        if (!sessionID || !statusType) return

        lastStatusBySession.set(sessionID, statusType)

        if (statusType === 'retry') {
          const attempt = typeof status?.attempt === 'number' ? status.attempt : undefined
          const prevAttempt = lastRetryAttemptBySession.get(sessionID)

          if (typeof attempt === 'number') {
            if (prevAttempt === attempt && shouldThrottle(`retry:${sessionID}:${attempt}`, 5000)) {
              return
            }
            lastRetryAttemptBySession.set(sessionID, attempt)
          }

          const key = `retry:${sessionID}:${typeof attempt === 'number' ? attempt : 'na'}`
          if (shouldThrottle(key, 2000)) return

          await notifyRich('retry', sessionID, formatRetryDetail(status))
        }

        return
      }

      if (event.type === 'session.error') {
        const sessionID = (event as any).properties?.sessionID as string | undefined
        const id = sessionID || 'unknown'
        const err = (event as any).properties?.error
        const detail = formatErrorDetail(err)
        const key = `error:${id}:${detail}`
        if (shouldThrottle(key, 2000)) return
        await notifyRich('error', id, detail)
        return
      }

      if (event.type === 'session.idle') {
        const sessionID = (event as any).properties?.sessionID as string | undefined
        if (!sessionID) return

        const prev = lastStatusBySession.get(sessionID)
        if (prev === 'busy' || prev === 'retry') {
          if (shouldThrottle(`idle:${sessionID}`, 2000)) return
          await notifyRich('idle', sessionID)
        }

        lastStatusBySession.set(sessionID, 'idle')
      }
	    },
	    config: async (config) => {
	      try {
	        const openai = (config.provider?.[PROVIDER_ID] as any) || null
	        if (!openai || typeof openai !== 'object') return
	        openai.models ||= {}

	        const rewritten = buildRoutedModelMap(openai.models)
	        openai.models = replaceModelMapInPlace(openai.models, rewritten)

	        const selected = (config as any)?.model
	        if (typeof selected === 'string' && selected.startsWith('openai/')) {
	          const selectedModel = selected.replace('openai/', '')
	          const explicit = selectedModel.endsWith('-oauth') || selectedModel.endsWith('-api')
	          if (!explicit && !openai.models[selectedModel]) {
	            const oauthKey = `${selectedModel}-oauth`
	            const apiKey = `${selectedModel}-api`
	            if (selectedModel.includes('codex') && openai.models[oauthKey]) {
	              ;(config as any).model = `openai/${oauthKey}`
	            } else if (openai.models[apiKey]) {
	              ;(config as any).model = `openai/${apiKey}`
	            } else if (openai.models[oauthKey]) {
	              ;(config as any).model = `openai/${oauthKey}`
	            }
	          }
	        }

	        if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
	          const count = Object.keys(openai.models).length
	          console.log(`[multi-auth] configured route-labeled openai models (${count})`)
	        }
	      } catch (err) {
        if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
          console.log('[multi-auth] config routing rewrite failed:', err)
        }
      }
    },

    auth: {
      provider: PROVIDER_ID,

      /**
       * Loader configures the SDK with multi-account rotation
       */
      async loader(getAuth, provider) {
        await syncAuthFromOpenCode(getAuth)

        if (provider && typeof provider === 'object') {
          const models = (provider as any).models
          if (models && typeof models === 'object') {
            const rewritten = buildRoutedModelMap(models)
            ;(provider as any).models = replaceModelMapInPlace(models, rewritten)
          }
        }

        const accounts = listAccounts()

        if (accounts.length === 0) {
          console.log('[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>')
          return {}
        }

        // Custom fetch with multi-account rotation
        const customFetch = async (
          input: Request | string | URL,
          init?: RequestInit,
          local429RetryAttempt = 0
        ): Promise<Response> => {
          await syncAuthFromOpenCode(getAuth)

          const originalUrl = extractRequestUrl(input)
          const method = resolveRequestMethod(input, init)
          const body = await resolveRequestBody(input, init)
          const outgoingHeaders = resolveRequestHeaders(input, init)

          const rawModel = extractModelName(body.model)
          const forcedAuthType = extractForcedAuthType(body)
          const authHint = await (async () => {
            try {
              const timeoutMs = 2500
              const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
              const auth = await Promise.race([getAuth(), timeoutPromise])
              if (auth && typeof auth === 'object' && 'type' in auth) {
                if (auth.type === 'oauth') return 'oauth' as const
                if (auth.type === 'api') return 'api' as const
              }
              return null
            } catch {
              return null
            }
          })()

          const selectedAuthType = forcedAuthType || (
            rawModel
              ? selectAuthTypeForRequest(body.model, originalUrl)
              : (authHint ?? selectAuthTypeForRequest(body.model, originalUrl))
          )

          let rotation = await getNextAccount(pluginConfig, { authType: selectedAuthType })

          if (!rotation && !rawModel) {
            const fallback = selectedAuthType === 'oauth' ? 'api' : 'oauth'
            rotation = await getNextAccount(pluginConfig, { authType: fallback })
          }

          if (!rotation) {
            const label = selectedAuthType === 'api' ? 'API key' : 'OAuth'
            return new Response(
              JSON.stringify({ error: { message: `No available ${label} accounts` } }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const { account, credential, authType: resolvedAuthType } = rotation
          const isStreaming = body?.stream === true
          const normalizedModel = normalizeModel(body.model)
          const reasoningMatch = rawModel?.match(/-(none|low|medium|high|xhigh)$/)

          const payload: Record<string, any> = {
            ...body,
            ...(normalizedModel ? { model: normalizedModel } : {}),
            store: false
          }

          stripForcedAuthType(payload)

          if (resolvedAuthType === 'oauth') {
            ensureCodexPayloadCompatibility(payload)
            ensureCodexInstructions(payload)
          }

          // Note: The ChatGPT Codex backend does not currently accept
          // `truncation`. Keep this opt-in and default off.
          if (resolvedAuthType === 'oauth' && payload.truncation === undefined) {
            const truncationRaw = (process.env.OPENCODE_MULTI_AUTH_TRUNCATION || '').trim()
            if (truncationRaw && truncationRaw !== 'disabled' && truncationRaw !== 'false' && truncationRaw !== '0') {
              payload.truncation = truncationRaw
            }
          }

          if (payload.input) {
            payload.input = filterInput(payload.input)
          }

          if (reasoningMatch?.[1]) {
            payload.reasoning = {
              ...(payload.reasoning || {}),
              effort: reasoningMatch[1],
              summary: payload.reasoning?.summary || 'auto'
            }
          }

          delete payload.reasoning_effort

          const url = resolvedAuthType === 'oauth'
            ? toCodexBackendUrl(originalUrl)
            : originalUrl

          try {
            const headers = new Headers(outgoingHeaders)
            headers.delete('x-api-key')
            headers.set('Content-Type', 'application/json')
            headers.set('Authorization', `Bearer ${credential}`)

            if (resolvedAuthType === 'oauth') {
              const decoded = decodeJWT(credential)
              const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id
              if (!accountId) {
                return new Response(
                  JSON.stringify({ error: { message: '[multi-auth] Failed to extract accountId from token' } }),
                  { status: 401, headers: { 'Content-Type': 'application/json' } }
                )
              }

              headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId)
              headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES)
              headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX)

              const cacheKey = payload?.prompt_cache_key
              if (cacheKey) {
                headers.set(OPENAI_HEADERS.CONVERSATION_ID, cacheKey)
                headers.set(OPENAI_HEADERS.SESSION_ID, cacheKey)
              } else {
                headers.delete(OPENAI_HEADERS.CONVERSATION_ID)
                headers.delete(OPENAI_HEADERS.SESSION_ID)
              }

              headers.set('accept', 'text/event-stream')
            } else {
              headers.delete(OPENAI_HEADERS.ACCOUNT_ID)
              headers.delete(OPENAI_HEADERS.BETA)
              headers.delete(OPENAI_HEADERS.ORIGINATOR)
              headers.delete(OPENAI_HEADERS.CONVERSATION_ID)
              headers.delete(OPENAI_HEADERS.SESSION_ID)
              if (!headers.has('accept')) {
                headers.set('accept', 'application/json')
              }
            }

            const timeoutMsRaw = process.env.OPENCODE_MULTI_AUTH_REQUEST_TIMEOUT_MS || '45000'
            const timeoutMs = Number.parseInt(timeoutMsRaw, 10)
            const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeout)

            if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
              console.log(
                `[multi-auth] request auth=${resolvedAuthType} alias=${account.alias} model=${rawModel || 'unknown'} url=${url}`
              )
            }

            const send = async (attempt: number): Promise<Response> => {
              const res = await fetch(url, {
                method,
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
              })

              if (resolvedAuthType === 'oauth' && res.status === 400 && attempt < 1) {
                const errData = await res.clone().json().catch(() => null) as any
                const detail =
                  (typeof errData?.detail === 'string' && errData.detail) ||
                  (typeof errData?.error?.message === 'string' && errData.error.message) ||
                  ''
                const match = detail.match(/Unsupported parameter:\s*([A-Za-z0-9_]+)/)
                const key = match?.[1]
                if (key && Object.prototype.hasOwnProperty.call(payload, key)) {
                  delete payload[key]
                  if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
                    console.log(`[multi-auth] stripping unsupported codex param: ${key}`)
                  }
                  return send(attempt + 1)
                }
              }

              return res
            }

            let res: Response
            try {
              res = await send(0)
            } finally {
              clearTimeout(timer)
            }

            if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
              console.log(
                `[multi-auth] response auth=${resolvedAuthType} alias=${account.alias} status=${res.status}`
              )
            }

            const limitUpdate = extractRateLimitUpdate(res.headers)
            if (limitUpdate) {
              updateAccount(account.alias, {
                rateLimits: mergeRateLimits(account.rateLimits, limitUpdate)
              })
            }

            if (res.status === 401 || res.status === 403) {
              const errorData = await res.clone().json().catch(() => ({})) as { error?: { message?: string } }
              const message = errorData?.error?.message || ''

              if (resolvedAuthType === 'api' || message.toLowerCase().includes('invalidated') || res.status === 401) {
                markAuthInvalid(account.alias)
              }

              const retryRotation = await getNextAccount(pluginConfig, { authType: resolvedAuthType })
              if (retryRotation && retryRotation.account.alias !== account.alias) {
                return customFetch(input, init, local429RetryAttempt)
              }

              return new Response(
                JSON.stringify({
                  error: {
                    message: `[multi-auth][acc=${account.alias}] Unauthorized on all ${resolvedAuthType} accounts. ${message}`.trim()
                  }
                }),
                { status: res.status, headers: { 'Content-Type': 'application/json' } }
              )
            }

            if (res.status === 429) {
              markRateLimited(account.alias, pluginConfig.rateLimitCooldownMs)

              const retryRotation = await getNextAccount(pluginConfig, { authType: resolvedAuthType })
              if (retryRotation && retryRotation.account.alias !== account.alias) {
                return customFetch(input, init, local429RetryAttempt)
              }

              const local429RetriesRaw = process.env.OPENCODE_MULTI_AUTH_LOCAL_429_RETRIES || '2'
              const local429Retries = Number.parseInt(local429RetriesRaw, 10)
              const maxLocal429Retries = Number.isFinite(local429Retries) && local429Retries >= 0
                ? local429Retries
                : 2

              if (local429RetryAttempt < maxLocal429Retries) {
                const retryAfterMs = parseRetryAfterMs(res.headers)
                const fallback = Math.min(pluginConfig.rateLimitCooldownMs, 10_000)
                const waitMs = Math.max(500, Math.min(retryAfterMs ?? fallback, 60_000))

                if (shouldThrottle(`toast:429:${account.alias}:${local429RetryAttempt}`, 2000)) {
                  // noop
                } else {
                  client.tui
                    .showToast({
                      body: {
                        title: 'Rate limit',
                        message: `All ${resolvedAuthType.toUpperCase()} accounts cooling down. Retrying in ${Math.round(waitMs / 1000)}s...`,
                        variant: 'warning',
                        duration: Math.min(waitMs + 1000, 15000)
                      }
                    })
                    .catch(() => {})
                }

                await sleep(waitMs)
                return customFetch(input, init, local429RetryAttempt + 1)
              }

              const errorData = await res.json().catch(() => ({})) as { error?: { message?: string } }
              return new Response(
                JSON.stringify({
                  error: {
                    message: `[multi-auth][acc=${account.alias}] Rate limited on all ${resolvedAuthType} accounts. ${errorData.error?.message || ''}`
                  }
                }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
              )
            }

            if (resolvedAuthType === 'oauth' && res.status === 402) {
              // Some accounts can temporarily be in a deactivated workspace state.
              // Rotate to the next account instead of hard-failing the request.
              const errorData = await res.clone().json().catch(() => null) as any
              const errorText = await res.clone().text().catch(() => '')

              const code =
                (typeof errorData?.detail?.code === 'string' && errorData.detail.code) ||
                (typeof errorData?.error?.code === 'string' && errorData.error.code) ||
                ''
              const message =
                (typeof errorData?.detail?.message === 'string' && errorData.detail.message) ||
                (typeof errorData?.detail === 'string' && errorData.detail) ||
                (typeof errorData?.error?.message === 'string' && errorData.error.message) ||
                (typeof errorData?.message === 'string' && errorData.message) ||
                errorText ||
                ''

              const isDeactivatedWorkspace =
                code === 'deactivated_workspace' ||
                message.toLowerCase().includes('deactivated_workspace') ||
                message.toLowerCase().includes('deactivated workspace')

              if (isDeactivatedWorkspace) {
                markWorkspaceDeactivated(account.alias, pluginConfig.workspaceDeactivatedCooldownMs, {
                  error: message || code
                })

                const retryRotation = await getNextAccount(pluginConfig, { authType: 'oauth' })
                if (retryRotation && retryRotation.account.alias !== account.alias) {
                  return customFetch(input, init, local429RetryAttempt)
                }

                return new Response(
                  JSON.stringify({
                    error: {
                      message: `[multi-auth][acc=${account.alias}] Workspace deactivated on all accounts. ${message || code}`.trim()
                    }
                  }),
                  { status: 402, headers: { 'Content-Type': 'application/json' } }
                )
              }
            }

            if (resolvedAuthType === 'oauth' && res.status === 400) {
              // Some accounts get staged access to newer Codex models (e.g. gpt-5.3-codex).
              // If the backend says the model isn't supported for this account, temporarily
              // skip it instead of trapping the whole rotation on a permanent 400 loop.
              const errorData = await res.clone().json().catch(() => ({})) as any
              const message =
                (typeof errorData?.detail === 'string' && errorData.detail) ||
                (typeof errorData?.error?.message === 'string' && errorData.error.message) ||
                (typeof errorData?.message === 'string' && errorData.message) ||
                ''

              const isModelUnsupported =
                typeof message === 'string' &&
                message.toLowerCase().includes('model is not supported') &&
                message.toLowerCase().includes('chatgpt account')

              if (isModelUnsupported) {
                markModelUnsupported(account.alias, pluginConfig.modelUnsupportedCooldownMs, {
                  model: normalizedModel,
                  error: message
                })

                const retryRotation = await getNextAccount(pluginConfig, { authType: 'oauth' })
                if (retryRotation && retryRotation.account.alias !== account.alias) {
                  return customFetch(input, init, local429RetryAttempt)
                }

                return new Response(
                  JSON.stringify({
                    error: {
                      message: `[multi-auth] Model not supported on all accounts. ${message}`.trim()
                    }
                  }),
                  { status: 400, headers: { 'Content-Type': 'application/json' } }
                )
              }
            }

            if (!res.ok) {
              return res
            }

            const responseHeaders = ensureContentType(res.headers)
            if (!isStreaming && responseHeaders.get('content-type')?.includes('text/event-stream')) {
              return await convertSseToJson(res, responseHeaders)
            }

            return res
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
              return new Response(
                JSON.stringify({
                  error: {
                    message: `[multi-auth][acc=${account.alias}] Request timed out after ${process.env.OPENCODE_MULTI_AUTH_REQUEST_TIMEOUT_MS || '45000'}ms`
                  }
                }),
                { status: 504, headers: { 'Content-Type': 'application/json' } }
              )
            }
            return new Response(
              JSON.stringify({ error: { message: `[multi-auth] Request failed: ${err}` } }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
          }
        }

        // Return SDK configuration with custom fetch for rotation
        return {
          apiKey: 'multi-auth-router',
          baseURL: OPENAI_API_BASE_URL,
          fetch: customFetch
        }
      },

      methods: [
        {
          label: 'ChatGPT OAuth (Headless, Multi-Auth)',
          type: 'oauth' as const,

          prompts: [
            {
              type: 'text' as const,
              key: 'alias',
              message: 'Account alias (e.g., personal, work)',
              placeholder: 'personal'
            }
          ],

          authorize: async (inputs?: Record<string, string>) => {
            const alias = inputs?.alias || `account-${Date.now()}`
            const flow = await createHeadlessAuthorizationFlow()

            return {
              url: flow.url,
              method: 'auto' as const,
              instructions: `Enter code: ${flow.userCode} for "${alias}"`,

              callback: async () => {
                try {
                  const account = await loginAccountHeadless(alias, flow)
                  if (!account.refreshToken || !account.accessToken || !account.expiresAt) {
                    return { type: 'failed' as const }
                  }
                  return {
                    type: 'success' as const,
                    provider: PROVIDER_ID,
                    refresh: account.refreshToken,
                    access: account.accessToken,
                    expires: account.expiresAt
                  }
                } catch {
                  return { type: 'failed' as const }
                }
              }
            }
          }
        },
        {
          label: 'ChatGPT OAuth (Browser Callback, Fallback)',
          type: 'oauth' as const,

          prompts: [
            {
              type: 'text' as const,
              key: 'alias',
              message: 'Account alias (e.g., personal, work)',
              placeholder: 'personal'
            }
          ],

          authorize: async (inputs?: Record<string, string>) => {
            const alias = inputs?.alias || `account-${Date.now()}`
            const flow = await createAuthorizationFlow()

            return {
              url: flow.url,
              method: 'auto' as const,
              instructions: `Login with your ChatGPT Plus/Pro account for "${alias}"`,

              callback: async () => {
                try {
                  const account = await loginAccount(alias, flow)
                  if (!account.refreshToken || !account.accessToken || !account.expiresAt) {
                    return { type: 'failed' as const }
                  }
                  return {
                    type: 'success' as const,
                    provider: PROVIDER_ID,
                    refresh: account.refreshToken,
                    access: account.accessToken,
                    expires: account.expiresAt
                  }
                } catch {
                  return { type: 'failed' as const }
                }
              }
            }
          }
        },
        {
          label: 'OpenAI API Key (Multi-Auth)',
          type: 'api' as const
        }
      ]
    }
  }
}

export default MultiAuthPlugin
