import test from 'node:test'
import assert from 'node:assert/strict'
import { __resetResetLockStateForTests, runResetLockPass } from '../reset-lock.js'
import type { ProbeResult } from '../probe-limits.js'
import type { AccountCredentials, AccountRateLimits, AccountStore } from '../types.js'

function buildOauthAccount(alias: string, weekly: AccountRateLimits['weekly']): AccountCredentials {
  return {
    alias,
    authType: 'oauth',
    accessToken: `${alias}-access`,
    refreshToken: `${alias}-refresh`,
    idToken: `${alias}-id`,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    usageCount: 0,
    rateLimits: { weekly }
  }
}

function createStore(now: number): AccountStore {
  return {
    accounts: {
      current: buildOauthAccount('current', {
        remaining: 80,
        limit: 100,
        resetAt: now + 60 * 60 * 1000,
        updatedAt: now
      }),
      resetme: buildOauthAccount('resetme', {
        remaining: 12,
        limit: 100,
        resetAt: now - 30_000,
        updatedAt: now - 30_000
      })
    },
    activeAlias: 'current',
    rotationIndex: 0,
    lastRotation: now
  }
}

function createDeps(
  store: AccountStore,
  probeResults: AccountRateLimits[],
  options?: { recommendedAlias?: string }
) {
  const switchedAliases: string[] = []
  let tick = 0

  return {
    switchedAliases,
    deps: {
      loadStore: () => store,
      updateAccount: (alias: string, updates: Partial<AccountCredentials>) => {
        store.accounts[alias] = {
          ...store.accounts[alias],
          ...updates,
          rateLimits: updates.rateLimits ?? store.accounts[alias].rateLimits
        }
        return store
      },
      writeCodexAuthForAlias: (alias: string) => {
        switchedAliases.push(alias)
        store.activeAlias = alias
      },
      probeRateLimitsForAccount: async (): Promise<ProbeResult> => {
        const next = probeResults.shift()
        assert.ok(next, 'expected another probe result')
        return { rateLimits: next }
      },
      recommendAccount: () => ({ alias: options?.recommendedAlias ?? 'current' }),
      sleep: async () => {},
      now: () => {
        tick += 1
        return store.lastRotation + tick
      },
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {}
    }
  }
}

test('reset lock anchors a fresh weekly window then switches back to preferred alias', async () => {
  __resetResetLockStateForTests()
  const now = Date.now()
  const store = createStore(now)
  const nextResetAt = now + 7 * 24 * 60 * 60 * 1000
  const { deps, switchedAliases } = createDeps(store, [
    {
      weekly: { remaining: 100, limit: 100, resetAt: nextResetAt, updatedAt: now + 1_000 }
    },
    {
      weekly: { remaining: 99, limit: 100, resetAt: nextResetAt, updatedAt: now + 2_000 }
    }
  ])

  const state = await runResetLockPass(deps)

  assert.equal(state.lastAnchoredAlias, 'resetme')
  assert.equal(store.activeAlias, 'current')
  assert.deepEqual(switchedAliases, ['resetme', 'current'])
  assert.equal(store.accounts.resetme.resetLockStatus, 'anchored')
  assert.equal(store.accounts.resetme.rateLimits?.weekly?.remaining, 99)
  assert.equal(store.accounts.resetme.lastResetLockWindowResetAt, nextResetAt)
})

test('reset lock marks account pending when weekly window has not reset yet', async () => {
  __resetResetLockStateForTests()
  const now = Date.now()
  const store = createStore(now)
  const currentResetAt = store.accounts.resetme.rateLimits?.weekly?.resetAt
  const { deps, switchedAliases } = createDeps(store, [
    {
      weekly: { remaining: 12, limit: 100, resetAt: currentResetAt, updatedAt: now + 1_000 }
    }
  ])

  const state = await runResetLockPass(deps)

  assert.equal(state.lastAnchoredAlias, undefined)
  assert.equal(store.activeAlias, 'current')
  assert.deepEqual(switchedAliases, [])
  assert.equal(store.accounts.resetme.resetLockStatus, 'pending')
  assert.equal(store.accounts.resetme.lastResetLockSuccessAt, undefined)
})

test('reset lock keeps account pending (not error) while usage-limited and backs off until refill', async () => {
  __resetResetLockStateForTests()
  const now = Date.now()
  const store = createStore(now)
  const resetAt = now + 2 * 24 * 60 * 60 * 1000
  const { deps, switchedAliases } = createDeps(store, [])
  // Override the probe to simulate a "hit your usage limit" response.
  deps.probeRateLimitsForAccount = async () => ({
    error: "[model=gpt-5.5] You've hit your usage limit. Upgrade to Pro ... try again at Jun 19th, 2026 9:09 AM.",
    usageLimited: true,
    usageLimitResetAt: resetAt
  })

  const state = await runResetLockPass(deps)

  assert.equal(state.lastError, undefined)
  assert.equal(store.accounts.resetme.resetLockStatus, 'pending')
  assert.equal(store.accounts.resetme.resetLockError, undefined)
  assert.equal(store.accounts.resetme.rateLimitedUntil, resetAt)
  assert.deepEqual(switchedAliases, [])
})

test('reset lock flags auth-invalid for re-login without recording a reset-lock error', async () => {
  __resetResetLockStateForTests()
  const now = Date.now()
  const store = createStore(now)
  const { deps, switchedAliases } = createDeps(store, [])
  deps.probeRateLimitsForAccount = async () => ({
    error: '[model=gpt-5.3-codex] refresh token was already used. Please log out and sign in again.',
    authInvalid: true
  })

  const state = await runResetLockPass(deps)

  assert.equal(state.lastError, undefined)
  assert.equal(store.accounts.resetme.authInvalid, true)
  assert.equal(store.accounts.resetme.resetLockStatus, 'pending')
  assert.equal(store.accounts.resetme.resetLockError, undefined)
  assert.deepEqual(switchedAliases, [])
})

test('reset lock records an error when repeated anchor probes never drop below 100 percent', async () => {
  __resetResetLockStateForTests()
  const now = Date.now()
  const store = createStore(now)
  const nextResetAt = now + 7 * 24 * 60 * 60 * 1000
  const probeResults: AccountRateLimits[] = [
    {
      weekly: { remaining: 100, limit: 100, resetAt: nextResetAt, updatedAt: now + 1_000 }
    }
  ]

  for (let i = 0; i < 8; i += 1) {
    probeResults.push({
      weekly: { remaining: 100, limit: 100, resetAt: nextResetAt, updatedAt: now + 2_000 + i }
    })
  }

  const { deps, switchedAliases } = createDeps(store, probeResults)
  const state = await runResetLockPass(deps)

  assert.equal(store.accounts.resetme.resetLockStatus, 'error')
  assert.match(store.accounts.resetme.resetLockError || '', /Weekly quota remained at 100%/)
  assert.equal(store.activeAlias, 'current')
  assert.deepEqual(switchedAliases, ['resetme', 'current'])
  assert.match(state.lastError || '', /Weekly quota remained at 100%/)
})
