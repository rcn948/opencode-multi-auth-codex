import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import MultiAuthPlugin from '../index.js'
import { __resetAuthSyncStateForTests } from '../auth-sync.js'

function setupEnv(): { cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-multi-auth-models-'))
  const modelsPath = path.join(dir, 'models.json')
  const storeFile = path.join(dir, 'accounts.json')

  fs.writeFileSync(
    modelsPath,
    JSON.stringify(
      {
        openai: {
          models: {
            'gpt-5.2': { id: 'gpt-5.2', name: 'GPT 5.2' },
            'gpt-5.2-pro': { id: 'gpt-5.2-pro', name: 'GPT 5.2 Pro' },
            'gpt-5.4': { id: 'gpt-5.4', name: 'GPT 5.4' },
            'gpt-5.4-mini': { id: 'gpt-5.4-mini', name: 'GPT 5.4 Mini' },
            'gpt-5.2-codex': { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex' }
          }
        }
      },
      null,
      2
    ),
    'utf-8'
  )

  const prevModelsPath = process.env.OPENCODE_MODELS_PATH
  const prevStoreFile = process.env.OPENCODE_MULTI_AUTH_STORE_FILE
  const prevSyncApi = process.env.OPENCODE_MULTI_AUTH_SYNC_API

  process.env.OPENCODE_MODELS_PATH = modelsPath
  process.env.OPENCODE_MULTI_AUTH_STORE_FILE = storeFile
  process.env.OPENCODE_MULTI_AUTH_SYNC_API = '1'

  return {
    cleanup: () => {
      if (prevModelsPath === undefined) {
        delete process.env.OPENCODE_MODELS_PATH
      } else {
        process.env.OPENCODE_MODELS_PATH = prevModelsPath
      }

      if (prevStoreFile === undefined) {
        delete process.env.OPENCODE_MULTI_AUTH_STORE_FILE
      } else {
        process.env.OPENCODE_MULTI_AUTH_STORE_FILE = prevStoreFile
      }

      if (prevSyncApi === undefined) {
        delete process.env.OPENCODE_MULTI_AUTH_SYNC_API
      } else {
        process.env.OPENCODE_MULTI_AUTH_SYNC_API = prevSyncApi
      }

      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('auth loader rewrites provider models in place with API/OAuth labels', async () => {
  const env = setupEnv()
  try {
    __resetAuthSyncStateForTests()

    const plugin = await MultiAuthPlugin({
      client: {
        session: {
          async get() {
            return { data: {} }
          }
        },
        tui: {
          async showToast() {
            return
          }
        }
      } as any,
      $: (null as any),
      serverUrl: new URL('http://localhost:4096'),
      project: { id: 'project-test', name: 'Project Test' } as any,
      directory: process.cwd(),
      worktree: process.cwd()
    })

    const provider: any = {
      models: {
        'gpt-5.2': { id: 'gpt-5.2', name: 'GPT 5.2' },
        'gpt-5.2-codex': { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex' }
      }
    }

    const initialRef = provider.models

    assert.ok(plugin.auth?.loader)
    await plugin.auth!.loader!(
      async () => ({ type: 'api', key: 'sk-test' } as any),
      provider
    )

    assert.equal(provider.models, initialRef)
    assert.ok(provider.models['gpt-5.2-pro'])
    assert.equal(provider.models['gpt-5.2-pro'].name, 'GPT 5.2 Pro (API)')
    assert.ok(provider.models['gpt-5.2-api'])
    assert.ok(provider.models['gpt-5.2-oauth'])
    assert.equal(provider.models['gpt-5.2-api'].options?.opencodeMultiAuthRoute, 'api')
    assert.equal(provider.models['gpt-5.2-oauth'].options?.opencodeMultiAuthRoute, 'oauth')
    assert.ok(provider.models['gpt-5.4-api'])
    assert.ok(provider.models['gpt-5.4-oauth'])
    assert.equal(provider.models['gpt-5.4-api'].name, 'GPT 5.4 (API)')
    assert.equal(provider.models['gpt-5.4-oauth'].name, 'GPT 5.4 (OAuth)')
    assert.equal(provider.models['gpt-5.4-api'].options?.opencodeMultiAuthRoute, 'api')
    assert.equal(provider.models['gpt-5.4-oauth'].options?.opencodeMultiAuthRoute, 'oauth')
    assert.ok(provider.models['gpt-5.4-mini-api'])
    assert.ok(provider.models['gpt-5.4-mini-oauth'])
    assert.equal(provider.models['gpt-5.4-mini-api'].name, 'GPT 5.4 Mini (API)')
    assert.equal(provider.models['gpt-5.4-mini-oauth'].name, 'GPT 5.4 Mini (OAuth)')
    assert.equal(provider.models['gpt-5.4-mini-api'].options?.opencodeMultiAuthRoute, 'api')
    assert.equal(provider.models['gpt-5.4-mini-oauth'].options?.opencodeMultiAuthRoute, 'oauth')
    assert.ok(provider.models['gpt-5.2-codex-api'])
    assert.ok(provider.models['gpt-5.2-codex-oauth'])
    assert.equal(provider.models['gpt-5.2-codex-api'].name, 'GPT 5.2 Codex (API)')
    assert.equal(provider.models['gpt-5.2-codex-oauth'].name, 'GPT 5.2 Codex (OAuth)')
    assert.equal(provider.models['gpt-5.2-codex-api'].options?.opencodeMultiAuthRoute, 'api')
    assert.equal(provider.models['gpt-5.2-codex-oauth'].options?.opencodeMultiAuthRoute, 'oauth')
  } finally {
    env.cleanup()
  }
})

test('config hook upgrades plain codex model selection to oauth-labeled entry', async () => {
  const env = setupEnv()
  try {
    const plugin = await MultiAuthPlugin({
      client: {
        session: {
          async get() {
            return { data: {} }
          }
        },
        tui: {
          async showToast() {
            return
          }
        }
      } as any,
      $: (null as any),
      serverUrl: new URL('http://localhost:4096'),
      project: { id: 'project-test', name: 'Project Test' } as any,
      directory: process.cwd(),
      worktree: process.cwd()
    })

    assert.ok(plugin.config)

    const config: any = {
      model: 'openai/gpt-5.2-codex',
      provider: {
        openai: {
          models: {
            'gpt-5.2-codex': { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex' }
          }
        }
      }
    }

    await plugin.config!(config)

    assert.equal(config.model, 'openai/gpt-5.2-codex-oauth')
    assert.ok(config.provider.openai.models['gpt-5.2-codex-api'])
    assert.ok(config.provider.openai.models['gpt-5.2-codex-oauth'])
  } finally {
    env.cleanup()
  }
})
