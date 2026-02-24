import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findExistingOauthAlias } from '../auth.js';
import { addAccount, loadStore } from '../store.js';
function setupTempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-multi-auth-oauth-dedupe-'));
    const storeFile = path.join(dir, 'accounts.json');
    const prevStore = process.env.OPENCODE_MULTI_AUTH_STORE_FILE;
    process.env.OPENCODE_MULTI_AUTH_STORE_FILE = storeFile;
    return {
        cleanup: () => {
            if (prevStore === undefined) {
                delete process.env.OPENCODE_MULTI_AUTH_STORE_FILE;
            }
            else {
                process.env.OPENCODE_MULTI_AUTH_STORE_FILE = prevStore;
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}
test('findExistingOauthAlias prefers accountId then refresh token', () => {
    const temp = setupTempStore();
    try {
        addAccount('first', {
            authType: 'oauth',
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresAt: Date.now() + 60_000,
            email: 'same@example.com',
            accountId: 'acct-1'
        });
        addAccount('second', {
            authType: 'oauth',
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresAt: Date.now() + 60_000,
            email: 'other@example.com',
            accountId: 'acct-2'
        });
        const store = loadStore();
        assert.equal(findExistingOauthAlias(store, {
            accountId: 'acct-1',
            refreshToken: 'refresh-2',
            accessToken: 'access-2',
            email: 'other@example.com'
        }), 'first');
        assert.equal(findExistingOauthAlias(store, {
            refreshToken: 'refresh-2'
        }), 'second');
    }
    finally {
        temp.cleanup();
    }
});
test('findExistingOauthAlias falls back to access token then email', () => {
    const temp = setupTempStore();
    try {
        addAccount('alpha', {
            authType: 'oauth',
            accessToken: 'access-alpha',
            refreshToken: 'refresh-alpha',
            expiresAt: Date.now() + 60_000,
            email: 'alpha@example.com',
            accountId: 'acct-alpha'
        });
        const store = loadStore();
        assert.equal(findExistingOauthAlias(store, { accessToken: 'access-alpha' }), 'alpha');
        assert.equal(findExistingOauthAlias(store, { email: 'alpha@example.com' }), 'alpha');
        assert.equal(findExistingOauthAlias(store, { email: 'missing@example.com' }), null);
    }
    finally {
        temp.cleanup();
    }
});
//# sourceMappingURL=oauth-dedupe.test.js.map