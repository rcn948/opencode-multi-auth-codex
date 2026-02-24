import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAuthTypeForRequest } from '../index.js'

test('selectAuthTypeForRequest routes codex models to oauth', () => {
  assert.equal(selectAuthTypeForRequest('gpt-5.3-codex'), 'oauth')
  assert.equal(selectAuthTypeForRequest('openai/gpt-5.2-codex-high'), 'oauth')
})

test('selectAuthTypeForRequest routes non-codex models to api', () => {
  assert.equal(selectAuthTypeForRequest('gpt-5.2'), 'api')
  assert.equal(selectAuthTypeForRequest('gpt-4.1'), 'api')
})

test('selectAuthTypeForRequest handles object model payloads', () => {
  assert.equal(selectAuthTypeForRequest({ model: 'gpt-5.3-codex' }), 'oauth')
  assert.equal(selectAuthTypeForRequest({ id: 'gpt-5.2' }), 'api')
  assert.equal(selectAuthTypeForRequest({ modelID: 'gpt-5.3-codex' }), 'oauth')
  assert.equal(selectAuthTypeForRequest({ model: { modelID: 'gpt-5.3-codex' } }), 'oauth')
})

test('selectAuthTypeForRequest handles unexpected model shapes', () => {
  assert.equal(selectAuthTypeForRequest({}), 'api')
  assert.equal(selectAuthTypeForRequest(123 as unknown), 'api')
})

test('selectAuthTypeForRequest can infer oauth from codex URL path', () => {
  assert.equal(selectAuthTypeForRequest(undefined, 'https://chatgpt.com/backend-api/codex/responses'), 'oauth')
})
