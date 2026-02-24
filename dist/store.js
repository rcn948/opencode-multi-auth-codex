import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'node:crypto';
import { isApiAccount, isOauthAccount } from './types.js';
export { isApiAccount, isOauthAccount };
const STORE_DIR_ENV = 'OPENCODE_MULTI_AUTH_STORE_DIR';
const STORE_FILE_ENV = 'OPENCODE_MULTI_AUTH_STORE_FILE';
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth');
const DEFAULT_STORE_FILE = 'accounts.json';
function getStoreDir() {
    const override = process.env[STORE_DIR_ENV];
    if (override && override.trim())
        return path.resolve(override.trim());
    return DEFAULT_STORE_DIR;
}
function getStoreFile() {
    const override = process.env[STORE_FILE_ENV];
    if (override && override.trim())
        return path.resolve(override.trim());
    return path.join(getStoreDir(), DEFAULT_STORE_FILE);
}
const STORE_ENV_PASSPHRASE = 'CODEX_SOFT_STORE_PASSPHRASE';
const STORE_VERSION = 1;
let storeLocked = false;
let lastStoreError = null;
let lastStoreEncrypted = false;
function ensureDir() {
    const dir = getStoreDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
function emptyStore() {
    return {
        accounts: {},
        activeAlias: null,
        rotationIndex: 0,
        lastRotation: Date.now()
    };
}
function getPassphrase() {
    const value = process.env[STORE_ENV_PASSPHRASE];
    return value && value.trim().length > 0 ? value : null;
}
function isEncryptedFile(payload) {
    return Boolean(payload && payload.encrypted === true && typeof payload.data === 'string');
}
function deriveKey(passphrase, salt) {
    return crypto.scryptSync(passphrase, salt, 32);
}
function encryptStore(store, passphrase) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const serialized = JSON.stringify(store);
    const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        encrypted: true,
        version: STORE_VERSION,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64')
    };
}
function decryptStore(file, passphrase) {
    const salt = Buffer.from(file.salt, 'base64');
    const iv = Buffer.from(file.iv, 'base64');
    const tag = Buffer.from(file.tag, 'base64');
    const data = Buffer.from(file.data, 'base64');
    const key = deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
}
function buildSnapshot(window) {
    if (!window)
        return undefined;
    return {
        remaining: window.remaining,
        limit: window.limit,
        resetAt: window.resetAt
    };
}
function buildHistoryEntry(rateLimits) {
    if (!rateLimits?.fiveHour && !rateLimits?.weekly)
        return null;
    const updatedAtValues = [rateLimits?.fiveHour?.updatedAt, rateLimits?.weekly?.updatedAt].filter((value) => typeof value === 'number');
    const at = updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : Date.now();
    return {
        at,
        fiveHour: buildSnapshot(rateLimits?.fiveHour),
        weekly: buildSnapshot(rateLimits?.weekly)
    };
}
function appendHistory(history, entry) {
    const next = history ? [...history] : [];
    const last = next[next.length - 1];
    const same = last &&
        last.fiveHour?.remaining === entry.fiveHour?.remaining &&
        last.weekly?.remaining === entry.weekly?.remaining &&
        last.fiveHour?.resetAt === entry.fiveHour?.resetAt &&
        last.weekly?.resetAt === entry.weekly?.resetAt;
    if (!same) {
        next.push(entry);
    }
    if (next.length > 160) {
        return next.slice(next.length - 160);
    }
    return next;
}
function coerceAuthType(raw) {
    const explicit = raw.authType;
    if (explicit === 'oauth' || explicit === 'api')
        return explicit;
    const hasOauthTokenPair = typeof raw.accessToken === 'string' && raw.accessToken.length > 0 &&
        typeof raw.refreshToken === 'string' && raw.refreshToken.length > 0;
    const hasApiKey = typeof raw.apiKey === 'string' && raw.apiKey.length > 0;
    if (hasApiKey && !hasOauthTokenPair)
        return 'api';
    return 'oauth';
}
function normalizeAccount(alias, raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const source = raw;
    let authType = coerceAuthType(source);
    const hasApiKey = typeof source.apiKey === 'string' && source.apiKey.length > 0;
    const hasOauthTokenPair = typeof source.accessToken === 'string' && source.accessToken.length > 0 &&
        typeof source.refreshToken === 'string' && source.refreshToken.length > 0;
    if (authType === 'api' && !hasApiKey && hasOauthTokenPair)
        authType = 'oauth';
    if (authType === 'oauth' && !hasOauthTokenPair && hasApiKey)
        authType = 'api';
    const normalized = {
        ...source,
        alias,
        authType,
        usageCount: typeof source.usageCount === 'number' ? source.usageCount : 0
    };
    if (!Array.isArray(normalized.rateLimitHistory)) {
        normalized.rateLimitHistory = undefined;
    }
    if (authType === 'api') {
        normalized.apiKey = hasApiKey ? String(source.apiKey) : undefined;
        normalized.accessToken = undefined;
        normalized.refreshToken = undefined;
        normalized.idToken = undefined;
        normalized.expiresAt = undefined;
    }
    else {
        normalized.apiKey = undefined;
        normalized.accessToken = typeof source.accessToken === 'string' ? source.accessToken : undefined;
        normalized.refreshToken = typeof source.refreshToken === 'string' ? source.refreshToken : undefined;
        normalized.idToken = typeof source.idToken === 'string' ? source.idToken : undefined;
        normalized.expiresAt = typeof source.expiresAt === 'number' ? source.expiresAt : Date.now();
    }
    const changed = JSON.stringify(source) !== JSON.stringify(normalized);
    return { account: normalized, changed };
}
function normalizeStore(raw) {
    const baseline = emptyStore();
    if (!raw || typeof raw !== 'object') {
        return { store: baseline, changed: true };
    }
    const source = raw;
    const accountsSource = source.accounts && typeof source.accounts === 'object'
        ? source.accounts
        : {};
    const accounts = {};
    let changed = false;
    for (const [alias, candidate] of Object.entries(accountsSource)) {
        const normalized = normalizeAccount(alias, candidate);
        if (!normalized) {
            changed = true;
            continue;
        }
        changed ||= normalized.changed;
        accounts[alias] = normalized.account;
    }
    const aliases = Object.keys(accounts);
    let activeAlias = typeof source.activeAlias === 'string' ? source.activeAlias : null;
    if (!activeAlias || !accounts[activeAlias]) {
        activeAlias = aliases[0] || null;
        changed = true;
    }
    let rotationIndex = typeof source.rotationIndex === 'number' ? source.rotationIndex : 0;
    if (!Number.isFinite(rotationIndex) || rotationIndex < 0) {
        rotationIndex = 0;
        changed = true;
    }
    const lastRotation = typeof source.lastRotation === 'number' ? source.lastRotation : Date.now();
    const store = {
        accounts,
        activeAlias,
        rotationIndex,
        lastRotation
    };
    if (aliases.length === 0) {
        store.activeAlias = null;
        store.rotationIndex = 0;
    }
    else {
        store.rotationIndex = store.rotationIndex % aliases.length;
    }
    return { store, changed };
}
export function loadStore() {
    storeLocked = false;
    lastStoreError = null;
    lastStoreEncrypted = false;
    ensureDir();
    const file = getStoreFile();
    if (fs.existsSync(file)) {
        try {
            const data = fs.readFileSync(file, 'utf-8');
            const parsed = JSON.parse(data);
            if (isEncryptedFile(parsed)) {
                lastStoreEncrypted = true;
                const passphrase = getPassphrase();
                if (!passphrase) {
                    storeLocked = true;
                    lastStoreError = `Store is encrypted. Set ${STORE_ENV_PASSPHRASE} to unlock.`;
                    return emptyStore();
                }
                try {
                    const decrypted = decryptStore(parsed, passphrase);
                    const normalized = normalizeStore(decrypted);
                    if (normalized.changed) {
                        saveStore(normalized.store);
                    }
                    return normalized.store;
                }
                catch (err) {
                    storeLocked = true;
                    lastStoreError = 'Failed to decrypt store. Check passphrase.';
                    console.error('[multi-auth] Failed to decrypt store:', err);
                    return emptyStore();
                }
            }
            const normalized = normalizeStore(parsed);
            if (normalized.changed) {
                saveStore(normalized.store);
            }
            return normalized.store;
        }
        catch {
            storeLocked = true;
            lastStoreError = 'Failed to parse store. Store locked until fixed.';
            console.error('[multi-auth] Failed to parse store, resetting');
        }
    }
    return emptyStore();
}
export function saveStore(store) {
    ensureDir();
    if (storeLocked) {
        console.error('[multi-auth] Store locked; refusing to overwrite encrypted file.');
        return;
    }
    const file = getStoreFile();
    const passphrase = getPassphrase();
    const payload = passphrase ? encryptStore(store, passphrase) : store;
    const json = JSON.stringify(payload, null, 2);
    // Best-effort backup to help recover from crashes/corruption.
    try {
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, `${file}.bak`);
            fs.chmodSync(`${file}.bak`, 0o600);
        }
    }
    catch {
        // ignore backup failures
    }
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    let fd = null;
    try {
        fd = fs.openSync(tmp, 'w', 0o600);
        fs.writeFileSync(fd, json, { encoding: 'utf-8' });
        try {
            fs.fsyncSync(fd);
        }
        catch {
            // fsync not supported everywhere; best-effort
        }
    }
    finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            }
            catch {
                // ignore
            }
        }
    }
    try {
        fs.renameSync(tmp, file);
    }
    catch (err) {
        // Windows can fail to rename over an existing file.
        if (err?.code === 'EPERM' || err?.code === 'EEXIST') {
            try {
                fs.unlinkSync(file);
            }
            catch {
                // ignore
            }
            fs.renameSync(tmp, file);
        }
        else {
            try {
                fs.unlinkSync(tmp);
            }
            catch {
                // ignore
            }
            throw err;
        }
    }
    try {
        fs.chmodSync(file, 0o600);
    }
    catch {
        // ignore
    }
}
export function getStoreDiagnostics() {
    return {
        storeDir: getStoreDir(),
        storeFile: getStoreFile(),
        locked: storeLocked,
        encrypted: lastStoreEncrypted,
        error: lastStoreError
    };
}
export function addAccount(alias, creds) {
    const store = loadStore();
    const normalized = normalizeAccount(alias, {
        ...creds,
        alias,
        usageCount: 0
    });
    if (!normalized)
        return store;
    const account = normalized.account;
    const entry = buildHistoryEntry(creds.rateLimits);
    store.accounts[alias] = {
        ...account,
        usageCount: 0,
        rateLimitHistory: entry ? [entry] : account.rateLimitHistory
    };
    if (!store.activeAlias) {
        store.activeAlias = alias;
    }
    saveStore(store);
    return store;
}
export function removeAccount(alias) {
    const store = loadStore();
    delete store.accounts[alias];
    if (store.activeAlias === alias) {
        const remaining = Object.keys(store.accounts);
        store.activeAlias = remaining[0] || null;
    }
    saveStore(store);
    return store;
}
export function updateAccount(alias, updates) {
    const store = loadStore();
    if (store.accounts[alias]) {
        const current = store.accounts[alias];
        const normalized = normalizeAccount(alias, { ...current, ...updates });
        if (!normalized)
            return store;
        const next = normalized.account;
        if (updates.rateLimits || next.rateLimits) {
            const entry = buildHistoryEntry(next.rateLimits);
            if (entry) {
                next.rateLimitHistory = appendHistory(current.rateLimitHistory, entry);
            }
        }
        store.accounts[alias] = next;
        saveStore(store);
    }
    return store;
}
export function upsertAccount(alias, creds) {
    const store = loadStore();
    if (store.accounts[alias]) {
        return updateAccount(alias, creds);
    }
    return addAccount(alias, creds);
}
export function setActiveAlias(alias) {
    const store = loadStore();
    const now = Date.now();
    const previousAlias = store.activeAlias;
    if (alias === null) {
        store.activeAlias = null;
    }
    else if (store.accounts[alias]) {
        if (previousAlias && previousAlias !== alias && store.accounts[previousAlias]) {
            store.accounts[previousAlias] = {
                ...store.accounts[previousAlias],
                lastActiveUntil: now
            };
        }
        store.activeAlias = alias;
        store.accounts[alias] = {
            ...store.accounts[alias],
            lastSeenAt: now,
            lastActiveUntil: undefined
        };
        const aliases = Object.keys(store.accounts);
        const idx = aliases.indexOf(alias);
        if (idx >= 0) {
            store.rotationIndex = idx;
        }
        store.lastRotation = now;
    }
    saveStore(store);
    return store;
}
export function getActiveAccount() {
    const store = loadStore();
    if (!store.activeAlias)
        return null;
    return store.accounts[store.activeAlias] || null;
}
export function listAccounts() {
    const store = loadStore();
    return Object.values(store.accounts);
}
export function getStorePath() {
    return getStoreFile();
}
export function getStoreStatus() {
    const diag = getStoreDiagnostics();
    return { locked: diag.locked, encrypted: diag.encrypted, error: diag.error };
}
//# sourceMappingURL=store.js.map