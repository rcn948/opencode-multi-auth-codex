import type { AccountCredentials, RateLimitWindow } from './types.js'

export function remainingPercent(window?: RateLimitWindow): number | null {
  if (!window || typeof window.remaining !== 'number' || typeof window.limit !== 'number') return null
  if (window.limit === 0) return null
  return Math.round((window.remaining / window.limit) * 100)
}

export function authInvalidRetryMs(): number {
  const raw = process.env.OPENCODE_MULTI_AUTH_AUTH_INVALID_RETRY_MS
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 10 * 60_000
}

export function formatDurationShort(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.ceil(hours / 24)
  return `${days}d`
}

export function authState(
  account: AccountCredentials,
  now: number
): { eligible: boolean; retrying: boolean; reason?: string } {
  if (!account.authInvalid) {
    return { eligible: true, retrying: false }
  }

  const invalidatedAt = typeof account.authInvalidatedAt === 'number' ? account.authInvalidatedAt : 0
  if (!invalidatedAt) {
    return { eligible: false, retrying: false, reason: 'auth invalid' }
  }

  const retryAt = invalidatedAt + authInvalidRetryMs()
  if (retryAt <= now) {
    return { eligible: true, retrying: true, reason: 'auth retry window reached' }
  }

  return {
    eligible: false,
    retrying: false,
    reason: `auth invalid (retry in ${formatDurationShort(retryAt - now)})`
  }
}

export function blockReason(account: AccountCredentials, now: number): string | null {
  if (account.rateLimitedUntil && account.rateLimitedUntil > now) {
    return `rate limited (${formatDurationShort(account.rateLimitedUntil - now)})`
  }
  if (account.modelUnsupportedUntil && account.modelUnsupportedUntil > now) {
    return `model unsupported (${formatDurationShort(account.modelUnsupportedUntil - now)})`
  }
  if (account.workspaceDeactivatedUntil && account.workspaceDeactivatedUntil > now) {
    return `workspace deactivated (${formatDurationShort(account.workspaceDeactivatedUntil - now)})`
  }
  return null
}

export function oauthRecommendPriority(account: AccountCredentials): { bucket: number; resetAt: number; reason: string } {
  const weekly = account.rateLimits?.weekly
  const fiveHour = account.rateLimits?.fiveHour

  const weeklyRemaining = typeof weekly?.remaining === 'number' ? weekly.remaining : undefined
  const fiveRemaining = typeof fiveHour?.remaining === 'number' ? fiveHour.remaining : undefined

  if (typeof weeklyRemaining === 'number' && weeklyRemaining > 0 && typeof weekly?.resetAt === 'number') {
    return { bucket: 0, resetAt: weekly.resetAt, reason: 'earliest weekly reset with available quota' }
  }

  if (typeof fiveRemaining === 'number' && fiveRemaining > 0 && typeof fiveHour?.resetAt === 'number') {
    return { bucket: 1, resetAt: fiveHour.resetAt, reason: 'earliest 5h reset with available quota' }
  }

  const hasUnknownAvailable =
    (typeof weeklyRemaining === 'number' && weeklyRemaining > 0) ||
    (typeof fiveRemaining === 'number' && fiveRemaining > 0)
  if (hasUnknownAvailable) {
    return { bucket: 2, resetAt: Number.POSITIVE_INFINITY, reason: 'quota available but reset time unknown' }
  }

  const hasWindow = Boolean(weekly || fiveHour)
  if (!hasWindow) {
    return { bucket: 3, resetAt: Number.POSITIVE_INFINITY, reason: 'no quota metadata yet' }
  }

  return { bucket: 4, resetAt: Number.POSITIVE_INFINITY, reason: 'quota exhausted' }
}

export type RecommendationResult = {
  alias: string | null
  reason?: string
  skippedReasons: Record<string, string>
}

export function recommendAccount(accounts: AccountCredentials[]): RecommendationResult {
  const now = Date.now()
  const skippedReasons: Record<string, string> = {}

  const oauthCandidates = accounts.filter((account) =>
    account.authType === 'oauth'
  )

  const eligibleOauth = oauthCandidates.filter((account) => {
    const auth = authState(account, now)
    if (!auth.eligible) {
      skippedReasons[account.alias] = auth.reason || 'auth invalid'
      return false
    }
    const blocked = blockReason(account, now)
    if (blocked) {
      skippedReasons[account.alias] = blocked
      return false
    }
    return true
  })

  if (eligibleOauth.length > 0) {
    const ranked = [...eligibleOauth].sort((a, b) => {
      const pa = oauthRecommendPriority(a)
      const pb = oauthRecommendPriority(b)
      if (pa.bucket !== pb.bucket) return pa.bucket - pb.bucket
      if (pa.resetAt !== pb.resetAt) return pa.resetAt - pb.resetAt
      return a.alias.localeCompare(b.alias)
    })

    const selected = ranked[0]
    if (!selected) {
      return { alias: null, reason: 'no eligible oauth account', skippedReasons }
    }

    const pr = oauthRecommendPriority(selected)
    const resetNote = Number.isFinite(pr.resetAt)
      ? ` (reset ${new Date(pr.resetAt).toLocaleString()})`
      : ''
    return {
      alias: selected.alias,
      reason: `${pr.reason}${resetNote}`,
      skippedReasons
    }
  }

  let best: { alias: string; score: number } | null = null
  for (const account of accounts) {
    const auth = authState(account, now)
    if (!auth.eligible) {
      skippedReasons[account.alias] = auth.reason || 'auth invalid'
      continue
    }
    const blocked = blockReason(account, now)
    if (blocked) {
      skippedReasons[account.alias] = blocked
      continue
    }
    const fiveRaw = remainingPercent(account.rateLimits?.fiveHour)
    const weeklyRaw = remainingPercent(account.rateLimits?.weekly)
    if (fiveRaw === null && weeklyRaw === null) {
      continue
    }
    const five = fiveRaw ?? 0
    const weekly = weeklyRaw ?? 0
    const expiresInDays = account.expiresAt ? (account.expiresAt - now) / (24 * 3600 * 1000) : 30
    const expiryPenalty = expiresInDays < 3 ? 20 : expiresInDays < 7 ? 10 : 0
    const score = five * 2 + weekly - expiryPenalty
    if (!best || score > best.score) {
      best = { alias: account.alias, score }
    }
  }
  return {
    alias: best?.alias ?? null,
    reason: best ? 'fallback by remaining quota score' : 'no eligible account with quota data',
    skippedReasons
  }
}
