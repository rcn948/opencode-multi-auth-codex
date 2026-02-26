import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getNextAccount } from '../rotation.js'
import { addAccount, loadStore, saveStore } from '../store.js'

function setupTempStore(): { cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-multi-auth-rotation-priority-'))
  const storeFile = path.join(dir, 'accounts.json')
  const prevStore = process.env.OPENCODE_MULTI_AUTH_STORE_FILE
  process.env.OPENCODE_MULTI_AUTH_STORE_FILE = storeFile

  return {
    cleanup: () => {
      if (prevStore === undefined) {
        delete process.env.OPENCODE_MULTI_AUTH_STORE_FILE
      } else {
        process.env.OPENCODE_MULTI_AUTH_STORE_FILE = prevStore
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('oauth rotation prioritizes account with soonest reset', async () => {
  const temp = setupTempStore()
  try {
    const now = Date.now()
    addAccount('late', {
      authType: 'oauth',
      accessToken: 'access-late',
      refreshToken: 'refresh-late',
      expiresAt: now + 24 * 3600 * 1000,
      rateLimits: {
        weekly: { remaining: 80, limit: 100, resetAt: now + 10 * 3600 * 1000 }
      }
    })
    addAccount('soon', {
      authType: 'oauth',
      accessToken: 'access-soon',
      refreshToken: 'refresh-soon',
      expiresAt: now + 24 * 3600 * 1000,
      rateLimits: {
        weekly: { remaining: 80, limit: 100, resetAt: now + 60 * 60 * 1000 }
      }
    })

    const store = loadStore()
    store.rotationIndex = 1
    saveStore(store)

    const next = await getNextAccount({ rotationStrategy: 'round-robin' }, { authType: 'oauth' })
    assert.equal(next?.account.alias, 'soon')
  } finally {
    temp.cleanup()
  }
})

test('oauth rotation de-prioritizes exhausted limits', async () => {
  const temp = setupTempStore()
  try {
    const now = Date.now()
    addAccount('exhausted', {
      authType: 'oauth',
      accessToken: 'access-exhausted',
      refreshToken: 'refresh-exhausted',
      expiresAt: now + 24 * 3600 * 1000,
      rateLimits: {
        weekly: { remaining: 0, limit: 100, resetAt: now + 30 * 60 * 1000 }
      }
    })
    addAccount('available', {
      authType: 'oauth',
      accessToken: 'access-available',
      refreshToken: 'refresh-available',
      expiresAt: now + 24 * 3600 * 1000,
      rateLimits: {
        weekly: { remaining: 25, limit: 100, resetAt: now + 5 * 3600 * 1000 }
      }
    })

    const next = await getNextAccount({ rotationStrategy: 'round-robin' }, { authType: 'oauth' })
    assert.equal(next?.account.alias, 'available')
  } finally {
    temp.cleanup()
  }
})

test('api rotation still follows configured strategy', async () => {
  const temp = setupTempStore()
  try {
    addAccount('api-a', {
      authType: 'api',
      apiKey: 'sk-a'
    })
    addAccount('api-b', {
      authType: 'api',
      apiKey: 'sk-b'
    })

    const store = loadStore()
    store.rotationIndex = 1
    saveStore(store)

    const next = await getNextAccount({ rotationStrategy: 'round-robin' }, { authType: 'api' })
    assert.equal(next?.account.alias, 'api-b')
  } finally {
    temp.cleanup()
  }
})
