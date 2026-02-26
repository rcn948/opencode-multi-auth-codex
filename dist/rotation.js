import { getStoreDiagnostics, loadStore, saveStore, updateAccount } from './store.js';
import { ensureValidToken } from './auth.js';
import { isApiAccount, isOauthAccount } from './types.js';
function shuffled(input) {
    const a = [...input];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function oauthResetPriority(account, now) {
    const windows = [account.rateLimits?.fiveHour, account.rateLimits?.weekly];
    let hasWindow = false;
    let hasAvailable = false;
    let hasUnknown = false;
    let minResetAt = Number.POSITIVE_INFINITY;
    for (const window of windows) {
        if (!window)
            continue;
        hasWindow = true;
        if (typeof window.remaining === 'number') {
            if (window.remaining <= 0)
                continue;
            hasAvailable = true;
            if (typeof window.resetAt === 'number') {
                minResetAt = Math.min(minResetAt, window.resetAt);
            }
            else {
                hasUnknown = true;
            }
            continue;
        }
        hasUnknown = true;
    }
    if (hasAvailable && Number.isFinite(minResetAt)) {
        return { bucket: 0, resetAt: minResetAt };
    }
    if (hasAvailable || hasUnknown) {
        return { bucket: 1, resetAt: Number.POSITIVE_INFINITY };
    }
    if (!hasWindow) {
        return { bucket: 2, resetAt: Number.POSITIVE_INFINITY };
    }
    return { bucket: 3, resetAt: Number.POSITIVE_INFINITY };
}
function prioritizeOauthAliases(aliases, accounts, now) {
    const index = new Map(aliases.map((alias, i) => [alias, i]));
    return [...aliases].sort((a, b) => {
        const pa = oauthResetPriority(accounts[a], now);
        const pb = oauthResetPriority(accounts[b], now);
        if (pa.bucket !== pb.bucket)
            return pa.bucket - pb.bucket;
        if (pa.resetAt !== pb.resetAt)
            return pa.resetAt - pb.resetAt;
        return (index.get(a) || 0) - (index.get(b) || 0);
    });
}
export async function getNextAccount(config, options) {
    let store = loadStore();
    const aliases = Object.keys(store.accounts);
    if (aliases.length === 0) {
        const diag = getStoreDiagnostics();
        const extra = diag.error ? ` (${diag.error})` : '';
        const addCommand = options?.authType === 'api'
            ? 'opencode-multi-auth add-api <alias>'
            : 'opencode-multi-auth add <alias>';
        console.error(`[multi-auth] No accounts configured. Run: ${addCommand}${extra}`);
        if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
            console.error(`[multi-auth] store file: ${diag.storeFile}`);
        }
        return null;
    }
    const now = Date.now();
    const availableAliases = aliases.filter(alias => {
        const acc = store.accounts[alias];
        if (options?.authType && acc.authType !== options.authType)
            return false;
        const notRateLimited = !acc.rateLimitedUntil || acc.rateLimitedUntil < now;
        const notModelUnsupported = !acc.modelUnsupportedUntil || acc.modelUnsupportedUntil < now;
        const notWorkspaceDeactivated = !acc.workspaceDeactivatedUntil || acc.workspaceDeactivatedUntil < now;
        const notInvalidated = !acc.authInvalid;
        return notRateLimited && notModelUnsupported && notWorkspaceDeactivated && notInvalidated;
    });
    if (availableAliases.length === 0) {
        console.warn('[multi-auth] No available accounts (rate-limited or invalidated).');
        return null;
    }
    const tokenFailureCooldownMs = (() => {
        const raw = process.env.OPENCODE_MULTI_AUTH_TOKEN_FAILURE_COOLDOWN_MS;
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
        return 60_000;
    })();
    const buildCandidates = () => {
        const withOauthPriority = (result) => {
            if (options?.authType !== 'oauth')
                return result;
            return {
                ...result,
                aliases: prioritizeOauthAliases(result.aliases, store.accounts, now)
            };
        };
        switch (config.rotationStrategy) {
            case 'least-used': {
                const sorted = [...availableAliases].sort((a, b) => {
                    const aa = store.accounts[a];
                    const bb = store.accounts[b];
                    const usageDiff = (aa?.usageCount || 0) - (bb?.usageCount || 0);
                    if (usageDiff !== 0)
                        return usageDiff;
                    const lastDiff = (aa?.lastUsed || 0) - (bb?.lastUsed || 0);
                    if (lastDiff !== 0)
                        return lastDiff;
                    return a.localeCompare(b);
                });
                return withOauthPriority({ aliases: sorted });
            }
            case 'random': {
                return withOauthPriority({ aliases: shuffled(availableAliases) });
            }
            case 'round-robin':
            default: {
                const start = store.rotationIndex % availableAliases.length;
                const rr = availableAliases.map((_, i) => availableAliases[(start + i) % availableAliases.length]);
                const nextIndex = (selected) => {
                    const idx = availableAliases.indexOf(selected);
                    if (idx < 0)
                        return store.rotationIndex;
                    return (idx + 1) % availableAliases.length;
                };
                return withOauthPriority({ aliases: rr, nextIndex });
            }
        }
    };
    const { aliases: candidates, nextIndex } = buildCandidates();
    for (const candidate of candidates) {
        const current = store.accounts[candidate];
        let credential = null;
        let credentialType = null;
        if (isOauthAccount(current)) {
            credentialType = 'oauth';
            credential = await ensureValidToken(candidate);
        }
        else if (isApiAccount(current)) {
            credentialType = 'api';
            credential = current.apiKey;
        }
        if (!credential || !credentialType) {
            // Don't hard-fail the whole system on a single broken account.
            // Put it on a short cooldown so rotation can keep working.
            const reason = current?.authType === 'api'
                ? '[multi-auth] API key unavailable for account'
                : '[multi-auth] Token unavailable (refresh failed?)';
            store = updateAccount(candidate, {
                rateLimitedUntil: now + tokenFailureCooldownMs,
                limitError: reason,
                lastLimitErrorAt: now
            });
            continue;
        }
        store = updateAccount(candidate, {
            usageCount: (store.accounts[candidate]?.usageCount || 0) + 1,
            lastUsed: now,
            limitError: undefined
        });
        store.activeAlias = candidate;
        store.lastRotation = now;
        if (nextIndex) {
            store.rotationIndex = nextIndex(candidate);
        }
        saveStore(store);
        return {
            account: store.accounts[candidate],
            credential,
            authType: credentialType
        };
    }
    console.error('[multi-auth] No available accounts (token refresh failed on all candidates).');
    return null;
}
export function markRateLimited(alias, cooldownMs) {
    updateAccount(alias, {
        rateLimitedUntil: Date.now() + cooldownMs
    });
    console.warn(`[multi-auth] Account ${alias} marked rate-limited for ${cooldownMs / 1000}s`);
}
export function clearRateLimit(alias) {
    updateAccount(alias, {
        rateLimitedUntil: undefined
    });
}
export function markModelUnsupported(alias, cooldownMs, info) {
    updateAccount(alias, {
        modelUnsupportedUntil: Date.now() + cooldownMs,
        modelUnsupportedAt: Date.now(),
        modelUnsupportedModel: info?.model,
        modelUnsupportedError: info?.error
    });
    const extra = info?.model ? ` (model=${info.model})` : '';
    console.warn(`[multi-auth] Account ${alias} marked model-unsupported for ${cooldownMs / 1000}s${extra}`);
}
export function clearModelUnsupported(alias) {
    updateAccount(alias, {
        modelUnsupportedUntil: undefined,
        modelUnsupportedAt: undefined,
        modelUnsupportedModel: undefined,
        modelUnsupportedError: undefined
    });
}
export function markWorkspaceDeactivated(alias, cooldownMs, info) {
    updateAccount(alias, {
        workspaceDeactivatedUntil: Date.now() + cooldownMs,
        workspaceDeactivatedAt: Date.now(),
        workspaceDeactivatedError: info?.error
    });
    console.warn(`[multi-auth] Account ${alias} marked workspace-deactivated for ${cooldownMs / 1000}s`);
}
export function clearWorkspaceDeactivated(alias) {
    updateAccount(alias, {
        workspaceDeactivatedUntil: undefined,
        workspaceDeactivatedAt: undefined,
        workspaceDeactivatedError: undefined
    });
}
export function markAuthInvalid(alias) {
    updateAccount(alias, {
        authInvalid: true,
        authInvalidatedAt: Date.now()
    });
    console.warn(`[multi-auth] Account ${alias} marked invalidated`);
}
export function clearAuthInvalid(alias) {
    updateAccount(alias, {
        authInvalid: false,
        authInvalidatedAt: undefined
    });
}
//# sourceMappingURL=rotation.js.map