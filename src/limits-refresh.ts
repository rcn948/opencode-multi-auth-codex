import { mergeRateLimits } from './rate-limits.js'
import { loadStore, updateAccount } from './store.js'
import { probeRateLimitsForAccount } from './probe-limits.js'
import { logError, logInfo } from './logger.js'
import type { AccountCredentials } from './types.js'

export interface LimitRefreshResult {
  alias: string
  updated: boolean
  error?: string
}

export async function refreshRateLimitsForAccount(account: AccountCredentials): Promise<LimitRefreshResult> {
  updateAccount(account.alias, { limitStatus: 'running', limitError: undefined })
  logInfo(`Refreshing limits for ${account.alias}`)
  const probe = await probeRateLimitsForAccount(account)
  if (!probe.rateLimits) {
    logError(`Limit probe failed for ${account.alias}: ${probe.error || 'Probe failed'}`)
    const now = Date.now()
    const updates: Partial<AccountCredentials> = {
      limitStatus: 'error',
      limitError: probe.error || 'Probe failed',
      lastLimitErrorAt: now
    }
    if (probe.authInvalid && !account.authInvalid) {
      updates.authInvalid = true
      updates.authInvalidatedAt = now
      logError(`Auth invalid detected for ${account.alias}; flagging for re-login`)
    }
    updateAccount(account.alias, updates)
    return {
      alias: account.alias,
      updated: false,
      error: probe.error || 'Probe failed'
    }
  }

  const successUpdates: Partial<AccountCredentials> = {
    rateLimits: mergeRateLimits(account.rateLimits, probe.rateLimits),
    limitStatus: 'success',
    limitError: undefined,
    lastLimitProbeAt: Date.now()
  }
  if (account.authInvalid) {
    successUpdates.authInvalid = false
    successUpdates.authInvalidatedAt = undefined
  }
  updateAccount(account.alias, successUpdates)
  return { alias: account.alias, updated: true }
}

export async function refreshRateLimits(
  accounts: AccountCredentials[],
  alias?: string
): Promise<LimitRefreshResult[]> {
  if (alias) {
    const account = accounts.find((acc) => acc.alias === alias)
    if (!account) {
      return [{ alias, updated: false, error: 'Unknown alias' }]
    }
    return [await refreshRateLimitsForAccount(account)]
  }

  const store = loadStore()
  const results: LimitRefreshResult[] = []
  for (const account of accounts) {
    results.push(await refreshRateLimitsForAccount(account))
  }
  if (results.length === 0 && !store.activeAlias) {
    return [{ alias: 'active', updated: false, error: 'No accounts configured' }]
  }
  return results
}
