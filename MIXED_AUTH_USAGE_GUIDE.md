# OpenCode Multi-Auth Plugin Guide (OAuth + API)

This guide explains how to install and use the plugin with both:

- ChatGPT OAuth accounts (Plus/Pro, Codex backend)
- OpenAI API key accounts (OpenAI API backend)

## 1) Install

### Option A: Install from GitHub (recommended)

```bash
bun add github:dredivaris/opencode-multi-auth-codex --cwd ~/.config/opencode
```

Add the plugin to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["github:dredivaris/opencode-multi-auth-codex"]
}
```

### Option B: Local source install

```bash
git clone https://github.com/dredivaris/opencode-multi-auth-codex.git
cd opencode-multi-auth-codex
npm install
npm run build
```

Then point OpenCode plugin config to your local built file:

```json
{
  "plugin": [
    "file:///ABSOLUTE/PATH/TO/opencode-multi-auth-codex/dist/index.js"
  ]
}
```

## 2) Verify CLI

If installed as package:

```bash
opencode-multi-auth help
```

If running from local source:

```bash
node ./dist/cli.js help
```

## 3) Add ChatGPT OAuth Accounts (Codex)

### OpenCode UI flow

In OpenCode auth/provider UI:

1. Select `openai`
2. Choose `ChatGPT OAuth (Headless, Multi-Auth)`
   - Fallback option also exists: `ChatGPT OAuth (Browser Callback, Fallback)`
3. Enter alias (for example `personal`, `work`)
4. Complete browser login

Repeat for each OAuth account.

### CLI flow

```bash
opencode-multi-auth add personal
opencode-multi-auth add work
```

Each command opens browser OAuth login.

## 4) Add OpenAI API Key Accounts

### OpenCode UI flow (auto-import)

In OpenCode auth/provider UI:

1. Select `openai`
2. Choose `Manually enter API Key`
3. Paste key

The plugin auto-imports this API key account into its multi-account store.

### CLI flow

```bash
# safer: from env var
OPENCODE_MULTI_AUTH_API_KEY=sk-... opencode-multi-auth add-api team-api

# or direct flag
opencode-multi-auth add-api backup-api --key sk-...
```

## 5) View Accounts and Health

```bash
opencode-multi-auth list
opencode-multi-auth status
```

You will see account type labels (`oauth` or `api`) and usage/health state.

## 6) How Switching Works

### Automatic switching (main behavior)

Switching is model-based and automatic:

- Models with `-oauth` (or `(OAuth)` in picker) use OAuth pool
- Models with `-api` (or `(API)` in picker) use API-key pool
- If no explicit route suffix/label is present:
  - models containing `codex` route to OAuth
  - non-codex models route to API

Picker behavior:

- Codex models are exposed as both `(API)` and `(OAuth)` variants
- Non-codex models are API-labeled by default
- Some non-codex models are dual-route by default (`gpt-5`, `gpt-5.1`, `gpt-5.2`)

Rotation behavior:

- API accounts follow configured rotation strategy (`round-robin` default)
- OAuth accounts are additionally prioritized by nearest usable quota reset
- Temporarily blocked/invalid accounts are skipped until cooldown/retry window

### Manual "Use on device" switching (OAuth only)

Use dashboard to manually set which OAuth account is written to `~/.codex/auth.json`:

```bash
opencode-multi-auth web --host 127.0.0.1 --port 3434
```

Open `http://127.0.0.1:3434` and click `Use on device` on an OAuth card.

Note: API accounts do not write into `~/.codex/auth.json`.

## 7) Dashboard Features

- Add OAuth account (browser login)
- Add API key account
- View account type, status, and usage
- See recommended OAuth account + recommendation reason
- Search/filter by alias/email/tags/notes
- Sort by recommended, limits, expiry, refresh time, or alias
- Edit tags/notes per account
- Refresh OAuth tokens
- Refresh OAuth rate-limit probes
- Queue progress + stop for limit refresh jobs
- Remove accounts

## 8) Useful Environment Variables

- `OPENCODE_MULTI_AUTH_SYNC_API=0` disable auto-import of OpenCode API auth
- `OPENCODE_MULTI_AUTH_API_KEY` provide API key for `add-api`
- `OPENCODE_MULTI_AUTH_DEBUG=1` enable extra debug logging
- `OPENCODE_MULTI_AUTH_PREFER_CODEX_LATEST=0` disable `gpt-5.2-codex` -> latest codex mapping
- `OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL=gpt-5.3-codex` override mapped latest codex target
- `OPENCODE_MULTI_AUTH_DUAL_ROUTE_MODELS=gpt-5,gpt-5.1,gpt-5.2` choose non-codex models that get both API/OAuth picker variants
- `OPENCODE_MULTI_AUTH_INJECT_MODELS=1` inject latest codex model into routed model map when missing from OpenCode cache
- `OPENCODE_MULTI_AUTH_REQUEST_TIMEOUT_MS=45000` request timeout override
- `OPENCODE_MULTI_AUTH_LOCAL_429_RETRIES=2` local retries when all accounts in chosen pool are cooling down
- `CODEX_SOFT_STORE_PASSPHRASE` encrypt local account store at rest

## 9) Storage and Security

- Account store file: `~/.config/opencode-multi-auth/accounts.json`
- Codex OAuth device auth file: `~/.codex/auth.json`

Treat both as sensitive credential files. Do not share them.

## 10) Quick Troubleshooting

### `No available OAuth accounts`

- You selected an OAuth-routed model but no usable OAuth accounts exist
- Add OAuth account (`add <alias>`)
- Re-auth invalid OAuth aliases
- Wait for temporary cooldown/retry window to expire

### `No available API key accounts`

- You selected an API-routed model but no usable API accounts exist
- Add API account (`add-api <alias>`)
- Or add key through OpenCode UI (`Manually enter API Key`) and let it auto-import

### Tokens/API keys look out of date

- Run `opencode-multi-auth status`
- Open dashboard and refresh token(s) for OAuth accounts
