import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAuthTypeForRequest, toCodexBackendUrl } from '../index.js';
test('selectAuthTypeForRequest routes codex models to oauth', () => {
    assert.equal(selectAuthTypeForRequest('gpt-5.3-codex'), 'oauth');
    assert.equal(selectAuthTypeForRequest('openai/gpt-5.2-codex-high'), 'oauth');
});
test('selectAuthTypeForRequest routes non-codex models to api', () => {
    assert.equal(selectAuthTypeForRequest('gpt-5.2'), 'api');
    assert.equal(selectAuthTypeForRequest('gpt-4.1'), 'api');
});
test('selectAuthTypeForRequest handles object model payloads', () => {
    assert.equal(selectAuthTypeForRequest({ model: 'gpt-5.3-codex' }), 'oauth');
    assert.equal(selectAuthTypeForRequest({ id: 'gpt-5.2' }), 'api');
    assert.equal(selectAuthTypeForRequest({ modelID: 'gpt-5.3-codex' }), 'oauth');
    assert.equal(selectAuthTypeForRequest({ model: { modelID: 'gpt-5.3-codex' } }), 'oauth');
});
test('selectAuthTypeForRequest handles unexpected model shapes', () => {
    assert.equal(selectAuthTypeForRequest({}), 'api');
    assert.equal(selectAuthTypeForRequest(123), 'api');
});
test('selectAuthTypeForRequest can infer oauth from codex URL path', () => {
    assert.equal(selectAuthTypeForRequest(undefined, 'https://chatgpt.com/backend-api/codex/responses'), 'oauth');
});
test('toCodexBackendUrl always targets backend-api responses endpoint', () => {
    assert.equal(toCodexBackendUrl('https://api.openai.com/v1/responses'), 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(toCodexBackendUrl('https://api.openai.com/v1/chat/completions'), 'https://chatgpt.com/backend-api/codex/chat/completions');
    assert.equal(toCodexBackendUrl('https://chatgpt.com/backend-api/codex/responses?stream=true'), 'https://chatgpt.com/backend-api/codex/responses?stream=true');
});
//# sourceMappingURL=routing.test.js.map