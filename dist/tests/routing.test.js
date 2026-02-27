import test from 'node:test';
import assert from 'node:assert/strict';
import { extractForcedAuthType, ensureCodexInstructions, ensureCodexPayloadCompatibility, normalizeModel, rewriteOpenAIModelsForRouting, selectAuthTypeForRequest, toCodexBackendUrl } from '../routing.js';
test('selectAuthTypeForRequest routes codex models to oauth', () => {
    assert.equal(selectAuthTypeForRequest('gpt-5.3-codex'), 'oauth');
    assert.equal(selectAuthTypeForRequest('openai/gpt-5.2-codex-high'), 'oauth');
});
test('selectAuthTypeForRequest routes non-codex models to api', () => {
    assert.equal(selectAuthTypeForRequest('gpt-5.2'), 'api');
    assert.equal(selectAuthTypeForRequest('gpt-4.1'), 'api');
});
test('selectAuthTypeForRequest honors explicit route suffixes', () => {
    assert.equal(selectAuthTypeForRequest('gpt-5.3-codex-api'), 'api');
    assert.equal(selectAuthTypeForRequest('gpt-5.3-codex-oauth'), 'oauth');
    assert.equal(selectAuthTypeForRequest('openai/gpt-5.3-codex-api-high'), 'api');
});
test('normalizeModel strips auth-route suffixes', () => {
    assert.equal(normalizeModel('gpt-5.3-codex-oauth'), 'gpt-5.3-codex');
    assert.equal(normalizeModel('openai/gpt-5.3-codex-api-high'), 'gpt-5.3-codex');
    assert.equal(normalizeModel('gpt-5.2-oauth'), 'gpt-5.2');
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
test('ensureCodexInstructions extracts developer instructions from responses input', () => {
    const payload = {
        input: [
            { role: 'developer', content: [{ type: 'input_text', text: 'Follow these rules.' }] },
            { role: 'user', content: 'hi' }
        ]
    };
    ensureCodexInstructions(payload);
    assert.equal(payload.instructions, 'Follow these rules.');
    assert.equal(payload.input.length, 1);
    assert.equal(payload.input[0].role, 'user');
});
test('ensureCodexInstructions falls back to default when missing', () => {
    const payload = { input: [{ role: 'user', content: 'hi' }] };
    ensureCodexInstructions(payload);
    assert.ok(typeof payload.instructions === 'string' && payload.instructions.length > 0);
});
test('ensureCodexPayloadCompatibility strips max_output_tokens and maps to max_tokens', () => {
    const payload = { max_output_tokens: 123 };
    ensureCodexPayloadCompatibility(payload);
    assert.equal(payload.max_output_tokens, undefined);
    assert.equal(payload.max_tokens, 123);
});
test('extractForcedAuthType reads explicit route hints', () => {
    assert.equal(extractForcedAuthType({ opencodeMultiAuthRoute: 'oauth' }), 'oauth');
    assert.equal(extractForcedAuthType({ opencode_multi_auth_route: 'api' }), 'api');
    assert.equal(extractForcedAuthType({ opencodeMultiAuthRoute: 'invalid' }), null);
});
test('rewriteOpenAIModelsForRouting creates API and OAuth aliases for dual models', () => {
    const rewritten = rewriteOpenAIModelsForRouting({
        'gpt-5.2': {
            id: 'gpt-5.2',
            name: 'GPT 5.2 (OAuth)',
            options: { textVerbosity: 'medium' }
        },
        'gpt-5.2-codex': {
            id: 'gpt-5.2-codex',
            name: 'GPT 5.2 Codex'
        }
    });
    assert.ok(rewritten['gpt-5.2-api']);
    assert.ok(rewritten['gpt-5.2-oauth']);
    assert.equal(rewritten['gpt-5.2-api'].name, 'GPT 5.2 (API)');
    assert.equal(rewritten['gpt-5.2-oauth'].name, 'GPT 5.2 (OAuth)');
    assert.equal(rewritten['gpt-5.2-api'].id, 'gpt-5.2-api');
    assert.equal(rewritten['gpt-5.2-oauth'].id, 'gpt-5.2-oauth');
    assert.equal(rewritten['gpt-5.2-api'].options?.opencodeMultiAuthRoute, 'api');
    assert.equal(rewritten['gpt-5.2-oauth'].options?.opencodeMultiAuthRoute, 'oauth');
    assert.ok(rewritten['gpt-5.2-codex-api']);
    assert.ok(rewritten['gpt-5.2-codex-oauth']);
    assert.equal(rewritten['gpt-5.2-codex-api'].name, 'GPT 5.2 Codex (API)');
    assert.equal(rewritten['gpt-5.2-codex-oauth'].name, 'GPT 5.2 Codex (OAuth)');
    assert.equal(rewritten['gpt-5.2-codex-api'].options?.opencodeMultiAuthRoute, 'api');
    assert.equal(rewritten['gpt-5.2-codex-oauth'].options?.opencodeMultiAuthRoute, 'oauth');
});
test('rewriteOpenAIModelsForRouting is stable for already routed dual model maps', () => {
    const rewritten = rewriteOpenAIModelsForRouting({
        'gpt-5.2-api': {
            id: 'gpt-5.2',
            name: 'GPT 5.2 (API)',
            options: { opencodeMultiAuthRoute: 'api' }
        },
        'gpt-5.2-oauth': {
            id: 'gpt-5.2',
            name: 'GPT 5.2 (OAuth)',
            options: { opencodeMultiAuthRoute: 'oauth' }
        }
    });
    assert.deepEqual(Object.keys(rewritten).sort(), ['gpt-5.2-api', 'gpt-5.2-oauth']);
});
test('rewriteOpenAIModelsForRouting collapses duplicate display labels', () => {
    const rewritten = rewriteOpenAIModelsForRouting({
        alpha: {
            id: 'alpha',
            name: 'Shared Model'
        },
        beta: {
            id: 'beta',
            name: 'Shared Model'
        },
        'alpha-codex': {
            id: 'alpha-codex',
            name: 'Shared Codex'
        },
        'beta-codex': {
            id: 'beta-codex',
            name: 'Shared Codex'
        }
    });
    assert.deepEqual(Object.keys(rewritten).sort(), ['alpha', 'alpha-codex-api', 'alpha-codex-oauth']);
    assert.equal(rewritten.alpha.name, 'Shared Model (API)');
    assert.equal(rewritten['alpha-codex-api'].name, 'Shared Codex (API)');
    assert.equal(rewritten['alpha-codex-oauth'].name, 'Shared Codex (OAuth)');
});
//# sourceMappingURL=routing.test.js.map