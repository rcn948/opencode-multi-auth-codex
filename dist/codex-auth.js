import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addAccount, loadStore, setActiveAlias, updateAccount } from './store.js';
import { isOauthAccount } from './types.js';
const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_AUTH_FILE = path.join(CODEX_DIR, 'auth.json');
const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const HERMES_AUTH_FILE = path.join(HERMES_HOME, 'auth.json');
let lastFingerprint = null;
let lastAuthError = null;
export function getCodexAuthPath() {
    return CODEX_AUTH_FILE;
}
function ensureDir() {
    if (!fs.existsSync(CODEX_DIR)) {
        fs.mkdirSync(CODEX_DIR, { recursive: true, mode: 0o700 });
    }
}
export function loadCodexAuthFile() {
    lastAuthError = null;
    if (!fs.existsSync(CODEX_AUTH_FILE))
        return null;
    try {
        const raw = fs.readFileSync(CODEX_AUTH_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch (err) {
        lastAuthError = 'Failed to parse codex auth.json';
        console.error('[multi-auth] Failed to parse codex auth.json:', err);
        return null;
    }
}
export function writeCodexAuthFile(auth) {
    ensureDir();
    fs.writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2), {
        mode: 0o600
    });
}
export function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
        const decoded = Buffer.from(padded, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
export function getEmailFromClaims(claims) {
    if (!claims)
        return undefined;
    if (typeof claims.email === 'string')
        return claims.email;
    const profile = claims['https://api.openai.com/profile'];
    if (profile?.email)
        return profile.email;
    return undefined;
}
export function getAccountIdFromClaims(claims) {
    if (!claims)
        return undefined;
    const auth = claims['https://api.openai.com/auth'];
    return auth?.chatgpt_account_id;
}
export function getExpiryFromClaims(claims) {
    if (!claims)
        return undefined;
    const exp = claims.exp;
    if (typeof exp === 'number')
        return exp * 1000;
    return undefined;
}
function fingerprintTokens(tokens) {
    return `${tokens.access_token}:${tokens.refresh_token}:${tokens.id_token}`;
}
function buildAlias(email, accountId, store) {
    const base = email?.split('@')[0] || accountId?.slice(0, 8) || `account-${Date.now()}`;
    const existing = new Set(Object.keys(store.accounts));
    let candidate = base || `account-${Date.now()}`;
    let suffix = 1;
    while (existing.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}
function findMatchingAlias(tokens, accountId, email, store) {
    for (const account of Object.values(store.accounts)) {
        if (!isOauthAccount(account))
            continue;
        if (accountId && account.accountId === accountId)
            return account.alias;
        if (account.accessToken === tokens.access_token)
            return account.alias;
        if (account.refreshToken === tokens.refresh_token)
            return account.alias;
        if (account.idToken === tokens.id_token)
            return account.alias;
        if (email && account.email === email)
            return account.alias;
    }
    return null;
}
export function syncCodexAuthFile() {
    const auth = loadCodexAuthFile();
    if (!auth?.tokens?.access_token || !auth.tokens.refresh_token || !auth.tokens.id_token) {
        return { alias: null, added: false, updated: false };
    }
    const fingerprint = fingerprintTokens(auth.tokens);
    const accessClaims = decodeJwtPayload(auth.tokens.access_token);
    const idClaims = decodeJwtPayload(auth.tokens.id_token);
    const email = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims);
    const accountId = auth.tokens.account_id || getAccountIdFromClaims(idClaims) || getAccountIdFromClaims(accessClaims);
    const expiresAt = getExpiryFromClaims(accessClaims) || getExpiryFromClaims(idClaims) || Date.now();
    const store = loadStore();
    const now = Date.now();
    const alias = findMatchingAlias(auth.tokens, accountId, email, store);
    if (lastFingerprint === fingerprint && alias) {
        return { alias, added: false, updated: false };
    }
    lastFingerprint = fingerprint;
    const update = {
        authType: 'oauth',
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        idToken: auth.tokens.id_token,
        accountId,
        expiresAt,
        email,
        lastRefresh: auth.last_refresh,
        lastSeenAt: now,
        source: 'codex'
    };
    if (alias) {
        updateAccount(alias, update);
        setActiveAlias(alias);
        return { alias, added: false, updated: true };
    }
    const newAlias = buildAlias(email, accountId, store);
    addAccount(newAlias, update);
    setActiveAlias(newAlias);
    return { alias: newAlias, added: true, updated: true };
}
export function getCodexAuthStatus() {
    return { error: lastAuthError };
}
export function writeCodexAuthForAlias(alias) {
    const store = loadStore();
    const account = store.accounts[alias];
    if (!account) {
        throw new Error(`Unknown alias: ${alias}`);
    }
    if (!isOauthAccount(account) || !account.idToken) {
        throw new Error('Missing token data for alias');
    }
    const current = loadCodexAuthFile();
    const auth = {
        OPENAI_API_KEY: current?.OPENAI_API_KEY ?? null,
        tokens: {
            id_token: account.idToken,
            access_token: account.accessToken,
            refresh_token: account.refreshToken,
            account_id: account.accountId
        },
        last_refresh: new Date().toISOString()
    };
    writeCodexAuthFile(auth);
    setActiveAlias(alias);
    updateAccount(alias, {
        lastRefresh: auth.last_refresh,
        lastSeenAt: Date.now(),
        source: 'codex'
    });
}
function loadHermesAuthStore() {
    if (!fs.existsSync(HERMES_AUTH_FILE)) {
        return { version: 1, providers: {}, credential_pool: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(HERMES_AUTH_FILE, 'utf-8'));
    }
    catch (err) {
        throw new Error(`Failed to parse Hermes auth store: ${err}`);
    }
}
function writeHermesAuthStore(authStore) {
    fs.mkdirSync(path.dirname(HERMES_AUTH_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(HERMES_AUTH_FILE, JSON.stringify(authStore, null, 2), { mode: 0o600 });
}
function poolIdForAccessToken(accessToken) {
    return crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 6);
}
export function getHermesAuthPath() {
    return HERMES_AUTH_FILE;
}
export function writeHermesCodexAuthForAlias(alias) {
    const store = loadStore();
    const account = store.accounts[alias];
    if (!account) {
        throw new Error(`Unknown alias: ${alias}`);
    }
    if (!isOauthAccount(account) || !account.idToken || !account.accessToken || !account.refreshToken) {
        throw new Error('Hermes sync is only supported for OAuth accounts with complete token data');
    }
    const now = new Date().toISOString();
    const authStore = loadHermesAuthStore();
    if (!authStore.version)
        authStore.version = 1;
    if (!authStore.providers || typeof authStore.providers !== 'object')
        authStore.providers = {};
    if (!authStore.credential_pool || typeof authStore.credential_pool !== 'object')
        authStore.credential_pool = {};
    authStore.providers['openai-codex'] = {
        ...(authStore.providers['openai-codex'] || {}),
        tokens: {
            id_token: account.idToken,
            access_token: account.accessToken,
            refresh_token: account.refreshToken,
            account_id: account.accountId
        },
        last_refresh: account.lastRefresh || now,
        auth_mode: 'oauth'
    };
    authStore.updated_at = now;
    const entry = {
        id: poolIdForAccessToken(account.accessToken),
        label: alias || 'device_code',
        auth_type: 'oauth',
        priority: 0,
        source: 'device_code',
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
        last_status: null,
        last_status_at: null,
        last_error_code: null,
        last_error_reason: null,
        last_error_message: null,
        last_error_reset_at: null,
        base_url: 'https://chatgpt.com/backend-api/codex',
        last_refresh: account.lastRefresh || now,
        request_count: 0
    };
    const pool = Array.isArray(authStore.credential_pool['openai-codex'])
        ? authStore.credential_pool['openai-codex']
        : [];
    const existingIndex = pool.findIndex((item) => item?.source === 'device_code');
    if (existingIndex >= 0) {
        pool[existingIndex] = { ...pool[existingIndex], ...entry };
    }
    else {
        pool.unshift(entry);
    }
    authStore.credential_pool['openai-codex'] = pool;
    writeHermesAuthStore(authStore);
    updateAccount(alias, {
        lastSeenAt: Date.now(),
        notes: account.notes
    });
    return { alias, hermesAuthPath: HERMES_AUTH_FILE };
}
//# sourceMappingURL=codex-auth.js.map