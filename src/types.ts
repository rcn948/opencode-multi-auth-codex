// Account credentials stored locally
export type AccountAuthType = 'oauth' | 'api'

export interface AccountCredentials {
  alias: string
  authType: AccountAuthType
  accessToken?: string
  refreshToken?: string
  idToken?: string
  accountId?: string
  expiresAt?: number // Unix timestamp
  apiKey?: string
  email?: string
  lastRefresh?: string
  lastSeenAt?: number
  lastActiveUntil?: number
  lastUsed?: number
  usageCount: number
  rateLimitedUntil?: number // If hit rate limit, when it resets
  // Some accounts don't have access to a given Codex model yet (staged rollout).
  // We temporarily skip them instead of hard-invalidating the account.
  modelUnsupportedUntil?: number
  modelUnsupportedAt?: number
  modelUnsupportedModel?: string
  modelUnsupportedError?: string
  // Some ChatGPT accounts can be in a deactivated workspace state (402 Payment Required,
  // detail.code = "deactivated_workspace"). Treat this as a temporary block and rotate.
  workspaceDeactivatedUntil?: number
  workspaceDeactivatedAt?: number
  workspaceDeactivatedError?: string
  authInvalid?: boolean
  authInvalidatedAt?: number
  rateLimits?: AccountRateLimits
  rateLimitHistory?: RateLimitHistoryEntry[]
  limitStatus?: LimitStatus
  limitError?: string
  lastLimitProbeAt?: number
  lastLimitErrorAt?: number
  resetLockStatus?: ResetLockStatus
  lastResetLockAttemptAt?: number
  lastResetLockSuccessAt?: number
  lastResetLockErrorAt?: number
  lastResetLockWindowResetAt?: number
  resetLockError?: string
  tags?: string[]
  notes?: string
  source?: 'opencode' | 'codex'
}

export type OAuthAccountCredentials = AccountCredentials & {
  authType: 'oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type ApiAccountCredentials = AccountCredentials & {
  authType: 'api'
  apiKey: string
}

export function isOauthAccount(
  account: AccountCredentials | null | undefined
): account is OAuthAccountCredentials {
  return Boolean(
    account &&
      account.authType === 'oauth' &&
      typeof account.accessToken === 'string' &&
      typeof account.refreshToken === 'string' &&
      typeof account.expiresAt === 'number'
  )
}

export function isApiAccount(
  account: AccountCredentials | null | undefined
): account is ApiAccountCredentials {
  return Boolean(
    account &&
      account.authType === 'api' &&
      typeof account.apiKey === 'string' &&
      account.apiKey.length > 0
  )
}

export interface RateLimitWindow {
  limit?: number
  remaining?: number
  resetAt?: number
  updatedAt?: number
}

export interface AccountRateLimits {
  fiveHour?: RateLimitWindow
  weekly?: RateLimitWindow
}

export interface RateLimitSnapshot {
  remaining?: number
  limit?: number
  resetAt?: number
}

export interface RateLimitHistoryEntry {
  at: number
  fiveHour?: RateLimitSnapshot
  weekly?: RateLimitSnapshot
}

export type LimitStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped'

export type ResetLockStatus = 'idle' | 'pending' | 'probing' | 'anchoring' | 'anchored' | 'error'

// Local store for all accounts
export interface AccountStore {
  accounts: Record<string, AccountCredentials>
  activeAlias: string | null
  rotationIndex: number
  lastRotation: number
}

// OpenAI model info
export interface OpenAIModel {
  id: string
  object: string
  created: number
  owned_by: string
}

// Plugin config
export interface PluginConfig {
  rotationStrategy: 'round-robin' | 'least-used' | 'random'
  autoRefreshTokens: boolean
  rateLimitCooldownMs: number // How long to skip rate-limited accounts
  modelUnsupportedCooldownMs: number // How long to skip accounts that don't support the requested model
  workspaceDeactivatedCooldownMs: number // How long to skip accounts with deactivated workspaces
  modelFilter: RegExp // Which models to expose
}

// OpenCode provider model definition
export interface ProviderModel {
  name: string
  limit: {
    context: number
    output: number
  }
  modalities: {
    input: string[]
    output: string[]
  }
  options: {
    reasoningEffort: string
    reasoningSummary: string
    textVerbosity: string
    include: string[]
    store: boolean
  }
}

export const DEFAULT_CONFIG: PluginConfig = {
  rotationStrategy: 'round-robin',
  autoRefreshTokens: true,
  rateLimitCooldownMs: 5 * 60 * 1000, // 5 minutes
  modelUnsupportedCooldownMs: 30 * 60 * 1000, // 30 minutes
  workspaceDeactivatedCooldownMs: 30 * 60 * 1000, // 30 minutes
  modelFilter: /^gpt-5/
}
