import test from 'node:test';
import assert from 'node:assert/strict';
import { __resetResetLockStateForTests, runResetLockPass } from '../reset-lock.js';
function buildOauthAccount(alias, weekly) {
    return {
        alias,
        authType: 'oauth',
        accessToken: `${alias}-access`,
        refreshToken: `${alias}-refresh`,
        idToken: `${alias}-id`,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        usageCount: 0,
        rateLimits: { weekly }
    };
}
function createStore(now) {
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
    };
}
function createDeps(store, probeResults, options) {
    const switchedAliases = [];
    let tick = 0;
    return {
        switchedAliases,
        deps: {
            loadStore: () => store,
            updateAccount: (alias, updates) => {
                store.accounts[alias] = {
                    ...store.accounts[alias],
                    ...updates,
                    rateLimits: updates.rateLimits ?? store.accounts[alias].rateLimits
                };
                return store;
            },
            writeCodexAuthForAlias: (alias) => {
                switchedAliases.push(alias);
                store.activeAlias = alias;
            },
            probeRateLimitsForAccount: async () => {
                const next = probeResults.shift();
                assert.ok(next, 'expected another probe result');
                return { rateLimits: next };
            },
            recommendAccount: () => ({ alias: options?.recommendedAlias ?? 'current' }),
            sleep: async () => { },
            now: () => {
                tick += 1;
                return store.lastRotation + tick;
            },
            logInfo: () => { },
            logWarn: () => { },
            logError: () => { }
        }
    };
}
test('reset lock anchors a fresh weekly window then switches back to preferred alias', async () => {
    __resetResetLockStateForTests();
    const now = Date.now();
    const store = createStore(now);
    const nextResetAt = now + 7 * 24 * 60 * 60 * 1000;
    const { deps, switchedAliases } = createDeps(store, [
        {
            weekly: { remaining: 100, limit: 100, resetAt: nextResetAt, updatedAt: now + 1_000 }
        },
        {
            weekly: { remaining: 99, limit: 100, resetAt: nextResetAt, updatedAt: now + 2_000 }
        }
    ]);
    const state = await runResetLockPass(deps);
    assert.equal(state.lastAnchoredAlias, 'resetme');
    assert.equal(store.activeAlias, 'current');
    assert.deepEqual(switchedAliases, ['resetme', 'current']);
    assert.equal(store.accounts.resetme.resetLockStatus, 'anchored');
    assert.equal(store.accounts.resetme.rateLimits?.weekly?.remaining, 99);
    assert.equal(store.accounts.resetme.lastResetLockWindowResetAt, nextResetAt);
});
test('reset lock marks account pending when weekly window has not reset yet', async () => {
    __resetResetLockStateForTests();
    const now = Date.now();
    const store = createStore(now);
    const currentResetAt = store.accounts.resetme.rateLimits?.weekly?.resetAt;
    const { deps, switchedAliases } = createDeps(store, [
        {
            weekly: { remaining: 12, limit: 100, resetAt: currentResetAt, updatedAt: now + 1_000 }
        }
    ]);
    const state = await runResetLockPass(deps);
    assert.equal(state.lastAnchoredAlias, undefined);
    assert.equal(store.activeAlias, 'current');
    assert.deepEqual(switchedAliases, []);
    assert.equal(store.accounts.resetme.resetLockStatus, 'pending');
    assert.equal(store.accounts.resetme.lastResetLockSuccessAt, undefined);
});
test('reset lock records an error when repeated anchor probes never drop below 100 percent', async () => {
    __resetResetLockStateForTests();
    const now = Date.now();
    const store = createStore(now);
    const nextResetAt = now + 7 * 24 * 60 * 60 * 1000;
    const probeResults = [
        {
            weekly: { remaining: 100, limit: 100, resetAt: nextResetAt, updatedAt: now + 1_000 }
        }
    ];
    for (let i = 0; i < 8; i += 1) {
        probeResults.push({
            weekly: { remaining: 100, limit: 100, resetAt: nextResetAt, updatedAt: now + 2_000 + i }
        });
    }
    const { deps, switchedAliases } = createDeps(store, probeResults);
    const state = await runResetLockPass(deps);
    assert.equal(store.accounts.resetme.resetLockStatus, 'error');
    assert.match(store.accounts.resetme.resetLockError || '', /Weekly quota remained at 100%/);
    assert.equal(store.activeAlias, 'current');
    assert.deepEqual(switchedAliases, ['resetme', 'current']);
    assert.match(state.lastError || '', /Weekly quota remained at 100%/);
});
//# sourceMappingURL=reset-lock.test.js.map