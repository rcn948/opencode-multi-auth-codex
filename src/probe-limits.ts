import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { findLatestSessionRateLimits } from './sessions-limits.js'
import type { AccountCredentials, AccountRateLimits } from './types.js'

const CODEX_HOME_ROOT = path.join(os.homedir(), '.codex-multi')
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml')
const CODEX_BIN_ENV = 'OPENCODE_MULTI_AUTH_CODEX_BIN'

const DEFAULT_PROMPT = 'Reply ONLY with OK. Do not run any commands.'
const EXEC_TIMEOUT_MS = 120_000
const DEFAULT_PROBE_MODELS = ['gpt-5.5', 'gpt-5-codex', 'gpt-5.2-codex', 'gpt-5.3-codex']

export interface ProbeResult {
  rateLimits?: AccountRateLimits
  eventTs?: number
  sourceFile?: string
  error?: string
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function sanitizeAlias(alias: string): string {
  return alias.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getAliasHome(alias: string): string {
  return path.join(CODEX_HOME_ROOT, sanitizeAlias(alias))
}

function writeAuthJson(dir: string, account: AccountCredentials): void {
  if (!account.accessToken || !account.refreshToken || !account.idToken) {
    throw new Error('Missing tokens for alias')
  }
  const auth = {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: account.idToken,
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      account_id: account.accountId
    },
    last_refresh: new Date().toISOString()
  }
  const authPath = path.join(dir, 'auth.json')
  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
}

function copyConfigToml(dir: string): void {
  if (!fs.existsSync(CODEX_CONFIG_PATH)) return
  const target = path.join(dir, 'config.toml')
  try {
    fs.copyFileSync(CODEX_CONFIG_PATH, target)
  } catch {
    // ignore config copy errors
  }
}

function shouldRetryWithFallback(error?: string): boolean {
  if (!error) return false
  const text = error.toLowerCase()
  return (
    text.includes('model_not_found') ||
    text.includes('model is not supported') ||
    text.includes('requested model') ||
    text.includes('does not exist')
  )
}

function getProbeModels(): string[] {
  const raw = (process.env.OPENCODE_MULTI_AUTH_LIMITS_PROBE_MODELS || '').trim()
  const fromEnv = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const candidates = fromEnv.length > 0 ? fromEnv : DEFAULT_PROBE_MODELS
  return Array.from(new Set(candidates))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function pathDirs(pathValue = process.env.PATH || ''): string[] {
  return pathValue.split(path.delimiter).filter(Boolean)
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32') return [name]

  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
  return [name, ...extensions.map((ext) => `${name}${ext.toLowerCase()}`), ...extensions.map((ext) => `${name}${ext.toUpperCase()}`)]
}

function canExecute(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function nvmNodeBinDirs(): string[] {
  const root = path.join(os.homedir(), '.nvm', 'versions', 'node')
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'bin'))
  } catch {
    return []
  }
}

function commonBinDirs(): string[] {
  return unique([
    path.dirname(process.execPath),
    path.join(os.homedir(), '.bun', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    ...nvmNodeBinDirs(),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ])
}

function findExecutable(name: string, dirs: string[]): string | undefined {
  for (const dir of dirs) {
    for (const executableName of executableNames(name)) {
      const candidate = path.join(dir, executableName)
      if (canExecute(candidate)) return candidate
    }
  }
  return undefined
}

export function resolveCodexExecutable(pathValue = process.env.PATH || ''): { command: string; pathEnv: string } {
  const configured = (process.env[CODEX_BIN_ENV] || '').trim()
  const configuredDir = configured ? path.dirname(configured) : ''
  const dirs = unique([...pathDirs(pathValue), configuredDir, ...commonBinDirs()])
  const pathEnv = dirs.join(path.delimiter)

  if (configured) {
    return { command: configured, pathEnv }
  }

  return { command: findExecutable('codex', dirs) || 'codex', pathEnv }
}

function formatSpawnError(err: NodeJS.ErrnoException): string {
  if (err.code !== 'ENOENT') return String(err)

  const configured = (process.env[CODEX_BIN_ENV] || '').trim()
  if (configured) {
    return `Executable not found: ${configured}. Check ${CODEX_BIN_ENV}.`
  }

  return 'Executable not found in PATH or common install locations: "codex". Set OPENCODE_MULTI_AUTH_CODEX_BIN to the full codex executable path.'
}

async function runCodexExec(
  codexHome: string,
  model?: string
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--cd',
      codexHome,
      '--sandbox',
      'read-only'
    ]
    if (model) {
      args.push('-m', model)
    }
    args.push(DEFAULT_PROMPT)

    let stderr = ''
    let stdout = ''
    const executable = resolveCodexExecutable()

    const child = spawn(executable.command, args, {
      env: { ...process.env, PATH: executable.pathEnv, CODEX_HOME: codexHome },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, error: 'codex exec timed out' })
    }, EXEC_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      stdout += data.toString()
      if (stdout.length > 4000) stdout = stdout.slice(-4000)
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      resolve({ ok: false, error: formatSpawnError(err) })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ ok: true })
      } else {
        const message = stderr.trim() || stdout.trim() || `codex exec failed (code ${code})`
        resolve({ ok: false, error: message })
      }
    })
  })
}

export async function probeRateLimitsForAccount(account: AccountCredentials): Promise<ProbeResult> {
  const codexHome = getAliasHome(account.alias)
  ensureDir(codexHome)
  writeAuthJson(codexHome, account)
  copyConfigToml(codexHome)

  const sessionsDir = path.join(codexHome, 'sessions')
  const probeModels = getProbeModels()
  let lastError = 'No token_count events found in alias sessions'
  const attemptErrors: string[] = []

  for (let idx = 0; idx < probeModels.length; idx++) {
    const probeModel = probeModels[idx]
    const startedAt = Date.now()
    const execResult = await runCodexExec(codexHome, probeModel)
    const latest = findLatestSessionRateLimits({
      sessionsDir,
      sinceMs: startedAt - 5_000
    })

    if (latest?.rateLimits) {
      return {
        rateLimits: latest.rateLimits,
        eventTs: latest.eventTs,
        sourceFile: latest.sourceFile
      }
    }

    if (execResult.error) {
      lastError = execResult.error
      attemptErrors.push(`[model=${probeModel}] ${execResult.error}`)
    }

    const hasNext = idx < probeModels.length - 1
    if (!hasNext) break
    if (!shouldRetryWithFallback(execResult.error)) break
  }

  if (attemptErrors.length > 0) {
    return { error: attemptErrors[attemptErrors.length - 1] }
  }

  return { error: lastError }
}

export function getProbeHomeRoot(): string {
  return CODEX_HOME_ROOT
}
