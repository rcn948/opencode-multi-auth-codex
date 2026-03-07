import { writeCodexAuthForAlias } from './codex-auth.js';
import { logError, logInfo } from './logger.js';
import { probeRateLimitsForAccount } from './probe-limits.js';
import { mergeRateLimits } from './rate-limits.js';
import { loadStore, updateAccount } from './store.js';
import { recommendAccount, remainingPercent } from './account-recommendation.js';
import { isOauthAccount } from './types.js';
const RESET_LOOKAHEAD_MS = envNumber('OPENCODE_MULTI_AUTH_RESET_LOCK_LOOKAHEAD_MS', 2 * 60_000);
const RESET_RETRY_MS = envNumber('OPENCODE_MULTI_AUTH_RESET_LOCK_RETRY_MS', 2 * 60_000);
const RESET_MIN_JUMP_MS = envNumber('OPENCODE_MULTI_AUTH_RESET_LOCK_MIN_JUMP_MS', 5 * 24 * 60 * 60_000);
const RESET_INTERVAL_MS = envNumber('OPENCODE_MULTI_AUTH_RESET_LOCK_INTERVAL_MS', 60_000);
const RESET_MAX_ANCHOR_ATTEMPTS = Math.max(1, Math.floor(envNumber('OPENCODE_MULTI_AUTH_RESET_LOCK_MAX_ATTEMPTS', 8)));
const RESET_ANCHOR_PAUSE_MS = envNumber('OPENCODE_MULTI_AUTH_RESET_LOCK_PAUSE_MS', 1_500);
const defaultDeps = {
    loadStore,
    updateAccount,
    writeCodexAuthForAlias,
    probeRateLimitsForAccount,
    recommendAccount,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    logInfo,
    logError
};
let runtimeState = {
    enabled: isResetLockEnabled(),
    running: false
};
function envNumber(name, fallback) {
    const raw = process.env[name];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export function isResetLockEnabled() {
    const raw = process.env.OPENCODE_MULTI_AUTH_RESET_LOCK;
    if (!raw)
        return true;
    const normalized = raw.trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}
export function getResetLockIntervalMs() {
    return RESET_INTERVAL_MS;
}
export function getResetLockState() {
    return { ...runtimeState, enabled: isResetLockEnabled() };
}
export function __resetResetLockStateForTests() {
    runtimeState = {
        enabled: isResetLockEnabled(),
        running: false
    };
}
function getWeeklyResetAt(account) {
    const resetAt = account.rateLimits?.weekly?.resetAt;
    return typeof resetAt === 'number' ? resetAt : null;
}
function weeklyPercent(account) {
    return remainingPercent(account.rateLimits?.weekly);
}
function isResetDue(account, now) {
    const resetAt = getWeeklyResetAt(account);
    if (!resetAt)
        return false;
    if (now < resetAt - RESET_LOOKAHEAD_MS)
        return false;
    const lastAttemptAt = typeof account.lastResetLockAttemptAt === 'number' ? account.lastResetLockAttemptAt : 0;
    if (lastAttemptAt > 0 && lastAttemptAt + RESET_RETRY_MS > now)
        return false;
    return true;
}
function didWeeklyWindowReset(before, after) {
    const beforeResetAt = getWeeklyResetAt(before);
    const afterResetAt = getWeeklyResetAt(after);
    if (!beforeResetAt || !afterResetAt)
        return false;
    if (afterResetAt <= beforeResetAt + RESET_MIN_JUMP_MS)
        return false;
    const afterPercent = weeklyPercent(after);
    return afterPercent === null || afterPercent >= 99;
}
function selectCandidate(store, now) {
    return Object.values(store.accounts)
        .filter((account) => isOauthAccount(account) && Boolean(account.idToken) && !account.authInvalid)
        .filter((account) => isResetDue(account, now))
        .sort((a, b) => {
        const ra = getWeeklyResetAt(a) ?? Number.POSITIVE_INFINITY;
        const rb = getWeeklyResetAt(b) ?? Number.POSITIVE_INFINITY;
        if (ra !== rb)
            return ra - rb;
        return a.alias.localeCompare(b.alias);
    })[0] || null;
}
async function probeAndPersist(account, deps, now, status) {
    const probe = await deps.probeRateLimitsForAccount(account);
    if (!probe.rateLimits) {
        throw new Error(probe.error || 'No rate limit data returned from probe');
    }
    deps.updateAccount(account.alias, {
        rateLimits: mergeRateLimits(account.rateLimits, probe.rateLimits),
        lastLimitProbeAt: now,
        resetLockStatus: status,
        resetLockError: undefined,
        lastResetLockErrorAt: undefined
    });
    const store = deps.loadStore();
    const updated = store.accounts[account.alias];
    if (!updated) {
        throw new Error(`Account disappeared during reset lock: ${account.alias}`);
    }
    return updated;
}
function chooseReturnAlias(store, previousActiveAlias, deps) {
    const recommended = deps.recommendAccount(Object.values(store.accounts)).alias;
    if (recommended && store.accounts[recommended])
        return recommended;
    if (previousActiveAlias && store.accounts[previousActiveAlias])
        return previousActiveAlias;
    return store.activeAlias && store.accounts[store.activeAlias] ? store.activeAlias : null;
}
async function anchorAccount(account, deps, previousActiveAlias) {
    let switched = false;
    try {
        deps.writeCodexAuthForAlias(account.alias);
        switched = true;
        deps.logInfo(`reset-lock: switched auth.json to ${account.alias}`);
        let latest = deps.loadStore().accounts[account.alias] || account;
        let weekly = weeklyPercent(latest);
        let attempts = 0;
        deps.updateAccount(account.alias, {
            resetLockStatus: 'anchoring',
            resetLockError: undefined,
            lastResetLockErrorAt: undefined
        });
        while ((weekly === null || weekly > 99) && attempts < RESET_MAX_ANCHOR_ATTEMPTS) {
            attempts += 1;
            latest = await probeAndPersist(latest, deps, deps.now(), 'anchoring');
            weekly = weeklyPercent(latest);
            if (weekly !== null && weekly <= 99)
                break;
            if (attempts < RESET_MAX_ANCHOR_ATTEMPTS) {
                await deps.sleep(RESET_ANCHOR_PAUSE_MS);
            }
        }
        if (weekly === null || weekly > 99) {
            throw new Error(`Weekly quota remained at ${weekly === null ? 'unknown' : `${weekly}%`} after ${attempts} anchor attempts`);
        }
        const anchoredAt = deps.now();
        deps.updateAccount(account.alias, {
            resetLockStatus: 'anchored',
            lastResetLockSuccessAt: anchoredAt,
            lastResetLockWindowResetAt: latest.rateLimits?.weekly?.resetAt,
            resetLockError: undefined,
            lastResetLockErrorAt: undefined
        });
        runtimeState.lastSuccessAt = anchoredAt;
        runtimeState.lastAnchoredAlias = account.alias;
        deps.logInfo(`reset-lock: anchored ${account.alias} weekly window at ${weekly}%`);
    }
    finally {
        if (switched) {
            const refreshedStore = deps.loadStore();
            const returnAlias = chooseReturnAlias(refreshedStore, previousActiveAlias, deps);
            if (returnAlias && returnAlias !== refreshedStore.activeAlias) {
                deps.writeCodexAuthForAlias(returnAlias);
                deps.logInfo(`reset-lock: restored preferred auth.json alias ${returnAlias}`);
            }
        }
    }
}
export async function runResetLockPass(customDeps = {}) {
    const deps = { ...defaultDeps, ...customDeps };
    runtimeState.enabled = isResetLockEnabled();
    if (!runtimeState.enabled) {
        return getResetLockState();
    }
    if (runtimeState.running) {
        return getResetLockState();
    }
    const startedAt = deps.now();
    runtimeState.running = true;
    runtimeState.lastRunAt = startedAt;
    runtimeState.lastError = undefined;
    try {
        const store = deps.loadStore();
        const candidate = selectCandidate(store, startedAt);
        if (candidate) {
            runtimeState.currentAlias = candidate.alias;
            deps.updateAccount(candidate.alias, {
                resetLockStatus: 'probing',
                lastResetLockAttemptAt: startedAt,
                resetLockError: undefined,
                lastResetLockErrorAt: undefined
            });
            deps.logInfo(`reset-lock: probing ${candidate.alias} near weekly reset`);
            const probed = await probeAndPersist(candidate, deps, deps.now(), 'probing');
            if (!didWeeklyWindowReset(candidate, probed)) {
                deps.updateAccount(candidate.alias, {
                    resetLockStatus: 'pending',
                    lastResetLockWindowResetAt: probed.rateLimits?.weekly?.resetAt
                });
            }
            else {
                deps.logInfo(`reset-lock: detected fresh weekly window for ${candidate.alias}`);
                await anchorAccount(probed, deps, store.activeAlias);
            }
        }
    }
    catch (err) {
        runtimeState.lastError = String(err);
        const activeAlias = runtimeState.currentAlias;
        if (activeAlias) {
            deps.updateAccount(activeAlias, {
                resetLockStatus: 'error',
                resetLockError: String(err),
                lastResetLockErrorAt: deps.now()
            });
        }
        deps.logError(`reset-lock failed${activeAlias ? ` for ${activeAlias}` : ''}: ${String(err)}`);
    }
    finally {
        runtimeState.running = false;
        runtimeState.currentAlias = undefined;
    }
    return getResetLockState();
}
//# sourceMappingURL=reset-lock.js.map