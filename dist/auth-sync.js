import crypto from 'node:crypto';
import { addAccount, loadStore, updateAccount } from './store.js';
import { decodeJwtPayload, getAccountIdFromClaims, getEmailFromClaims } from './codex-auth.js';
import { isApiAccount, isOauthAccount } from './types.js';
const OPENAI_ISSUER = 'https://auth.openai.com';
const AUTH_SYNC_COOLDOWN_MS = 10_000;
const AUTH_SYNC_API_ENV = 'OPENCODE_MULTI_AUTH_SYNC_API';
let lastSyncedAccess = null;
let lastSyncedApiFingerprint = null;
let lastSyncAt = 0;
async function fetchEmail(accessToken) {
    try {
        const res = await fetch(`${OPENAI_ISSUER}/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok)
            return undefined;
        const user = (await res.json());
        return user.email;
    }
    catch {
        return undefined;
    }
}
function findAccountAliasByToken(access, refresh) {
    const store = loadStore();
    for (const account of Object.values(store.accounts)) {
        if (!isOauthAccount(account))
            continue;
        if (account.accessToken === access)
            return account.alias;
        if (refresh && account.refreshToken === refresh)
            return account.alias;
    }
    return null;
}
function findAccountAliasByEmail(email, store) {
    for (const account of Object.values(store.accounts)) {
        if (!isOauthAccount(account))
            continue;
        if (account.email && account.email === email)
            return account.alias;
    }
    return null;
}
function findApiAliasByKey(key, store) {
    for (const account of Object.values(store.accounts)) {
        if (!isApiAccount(account))
            continue;
        if (account.apiKey === key)
            return account.alias;
    }
    return null;
}
function buildAlias(email, existingAliases) {
    const base = email ? email.split('@')[0] : 'account';
    let candidate = base || 'account';
    let suffix = 1;
    while (existingAliases.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}
function buildApiAlias(existingAliases) {
    let candidate = 'api';
    let suffix = 1;
    while (existingAliases.has(candidate)) {
        candidate = `api-${suffix}`;
        suffix += 1;
    }
    return candidate;
}
function fingerprintApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}
function apiSyncEnabled() {
    const raw = process.env[AUTH_SYNC_API_ENV];
    return raw !== '0' && raw !== 'false';
}
export function __resetAuthSyncStateForTests() {
    lastSyncedAccess = null;
    lastSyncedApiFingerprint = null;
    lastSyncAt = 0;
}
export async function syncAuthFromOpenCode(getAuth) {
    const now = Date.now();
    if (now - lastSyncAt < AUTH_SYNC_COOLDOWN_MS)
        return;
    lastSyncAt = now;
    let auth = null;
    try {
        auth = await getAuth();
    }
    catch {
        return;
    }
    if (!auth)
        return;
    if (auth.type === 'oauth') {
        if (!auth.access)
            return;
        if (auth.access === lastSyncedAccess)
            return;
        lastSyncedAccess = auth.access;
        const existingAlias = findAccountAliasByToken(auth.access, auth.refresh);
        const accessClaims = decodeJwtPayload(auth.access);
        const derivedEmail = getEmailFromClaims(accessClaims);
        const derivedAccountId = getAccountIdFromClaims(accessClaims);
        if (existingAlias) {
            updateAccount(existingAlias, {
                authType: 'oauth',
                accessToken: auth.access,
                refreshToken: auth.refresh,
                expiresAt: auth.expires,
                email: derivedEmail,
                accountId: derivedAccountId
            });
            return;
        }
        const store = loadStore();
        const email = (await fetchEmail(auth.access)) || derivedEmail;
        if (email) {
            const existingByEmail = findAccountAliasByEmail(email, store);
            if (existingByEmail) {
                updateAccount(existingByEmail, {
                    authType: 'oauth',
                    accessToken: auth.access,
                    refreshToken: auth.refresh,
                    expiresAt: auth.expires,
                    email
                });
                return;
            }
        }
        const alias = buildAlias(email, new Set(Object.keys(store.accounts)));
        addAccount(alias, {
            authType: 'oauth',
            accessToken: auth.access,
            refreshToken: auth.refresh,
            expiresAt: auth.expires,
            email,
            accountId: derivedAccountId,
            source: 'opencode'
        });
        return;
    }
    if (auth.type === 'api') {
        if (!apiSyncEnabled())
            return;
        if (!auth.key)
            return;
        const keyFingerprint = fingerprintApiKey(auth.key);
        if (keyFingerprint === lastSyncedApiFingerprint)
            return;
        lastSyncedApiFingerprint = keyFingerprint;
        const store = loadStore();
        const existingAlias = findApiAliasByKey(auth.key, store);
        if (existingAlias) {
            updateAccount(existingAlias, {
                authType: 'api',
                apiKey: auth.key,
                source: 'opencode',
                authInvalid: false,
                authInvalidatedAt: undefined
            });
            return;
        }
        const alias = buildApiAlias(new Set(Object.keys(store.accounts)));
        addAccount(alias, {
            authType: 'api',
            apiKey: auth.key,
            source: 'opencode',
            lastSeenAt: Date.now(),
            authInvalid: false,
            authInvalidatedAt: undefined
        });
    }
}
//# sourceMappingURL=auth-sync.js.map