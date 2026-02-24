import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadStore } from '../store.js'

function withTempStoreFile<T>(fn: (storeFile: string) => T): T {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-multi-auth-store-test-'))
  const storeFile = path.join(tempDir, 'accounts.json')
  const previous = process.env.OPENCODE_MULTI_AUTH_STORE_FILE
  process.env.OPENCODE_MULTI_AUTH_STORE_FILE = storeFile
  try {
    return fn(storeFile)
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_MULTI_AUTH_STORE_FILE
    } else {
      process.env.OPENCODE_MULTI_AUTH_STORE_FILE = previous
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

test('loadStore migrates legacy oauth and api rows', () => {
  withTempStoreFile((storeFile) => {
    const legacy = {
      accounts: {
        legacyOauth: {
          alias: 'legacyOauth',
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: Date.now() + 60_000,
          usageCount: 2
        },
        legacyApi: {
          alias: 'legacyApi',
          apiKey: 'sk-test-1234',
          usageCount: 1
        }
      },
      activeAlias: 'legacyOauth',
      rotationIndex: 0,
      lastRotation: Date.now()
    }
    fs.writeFileSync(storeFile, JSON.stringify(legacy, null, 2), 'utf-8')

    const store = loadStore()
    assert.equal(store.accounts.legacyOauth.authType, 'oauth')
    assert.equal(store.accounts.legacyOauth.accessToken, 'access-1')
    assert.equal(store.accounts.legacyOauth.refreshToken, 'refresh-1')

    assert.equal(store.accounts.legacyApi.authType, 'api')
    assert.equal(store.accounts.legacyApi.apiKey, 'sk-test-1234')
    assert.equal(store.accounts.legacyApi.accessToken, undefined)
  })
})
