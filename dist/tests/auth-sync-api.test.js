import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __resetAuthSyncStateForTests, syncAuthFromOpenCode } from '../auth-sync.js';
import { loadStore } from '../store.js';
function setupTempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-multi-auth-sync-test-'));
    const storeFile = path.join(dir, 'accounts.json');
    const prevStore = process.env.OPENCODE_MULTI_AUTH_STORE_FILE;
    const prevSync = process.env.OPENCODE_MULTI_AUTH_SYNC_API;
    process.env.OPENCODE_MULTI_AUTH_STORE_FILE = storeFile;
    delete process.env.OPENCODE_MULTI_AUTH_SYNC_API;
    return {
        dir,
        storeFile,
        cleanup: () => {
            if (prevStore === undefined) {
                delete process.env.OPENCODE_MULTI_AUTH_STORE_FILE;
            }
            else {
                process.env.OPENCODE_MULTI_AUTH_STORE_FILE = prevStore;
            }
            if (prevSync === undefined) {
                delete process.env.OPENCODE_MULTI_AUTH_SYNC_API;
            }
            else {
                process.env.OPENCODE_MULTI_AUTH_SYNC_API = prevSync;
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}
test('syncAuthFromOpenCode imports and deduplicates API keys', async () => {
    const temp = setupTempStore();
    try {
        __resetAuthSyncStateForTests();
        await syncAuthFromOpenCode(async () => ({ type: 'api', key: 'sk-one' }));
        let store = loadStore();
        assert.equal(Object.keys(store.accounts).length, 1);
        assert.equal(Object.values(store.accounts)[0].authType, 'api');
        __resetAuthSyncStateForTests();
        await syncAuthFromOpenCode(async () => ({ type: 'api', key: 'sk-one' }));
        store = loadStore();
        assert.equal(Object.keys(store.accounts).length, 1);
        __resetAuthSyncStateForTests();
        await syncAuthFromOpenCode(async () => ({ type: 'api', key: 'sk-two' }));
        store = loadStore();
        assert.equal(Object.keys(store.accounts).length, 2);
        process.env.OPENCODE_MULTI_AUTH_SYNC_API = '0';
        __resetAuthSyncStateForTests();
        await syncAuthFromOpenCode(async () => ({ type: 'api', key: 'sk-three' }));
        store = loadStore();
        assert.equal(Object.keys(store.accounts).length, 2);
    }
    finally {
        temp.cleanup();
    }
});
test('syncAuthFromOpenCode does not cooldown after empty auth', async () => {
    const temp = setupTempStore();
    try {
        __resetAuthSyncStateForTests();
        await syncAuthFromOpenCode(async () => null);
        await syncAuthFromOpenCode(async () => ({ type: 'api', key: 'sk-after-empty' }));
        const store = loadStore();
        assert.equal(Object.keys(store.accounts).length, 1);
        assert.equal(Object.values(store.accounts)[0].authType, 'api');
    }
    finally {
        temp.cleanup();
    }
});
//# sourceMappingURL=auth-sync-api.test.js.map