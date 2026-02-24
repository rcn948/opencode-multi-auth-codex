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
2. Choose `ChatGPT OAuth (Multi-Account)`
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

- Codex models (for example `gpt-5.3-codex`) use the OAuth account pool
- Non-codex OpenAI models (for example `gpt-5.2`, `gpt-4.1`) use the API-key pool

Within each pool, accounts rotate round-robin and skip temporarily blocked accounts.

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
- Refresh OAuth tokens
- Refresh OAuth rate-limit probes
- Remove accounts

## 8) Useful Environment Variables

- `OPENCODE_MULTI_AUTH_SYNC_API=0` disable auto-import of OpenCode API auth
- `OPENCODE_MULTI_AUTH_API_KEY` provide API key for `add-api`
- `OPENCODE_MULTI_AUTH_DEBUG=1` enable extra debug logging
- `CODEX_SOFT_STORE_PASSPHRASE` encrypt local account store at rest

## 9) Storage and Security

- Account store file: `~/.config/opencode-multi-auth/accounts.json`
- Codex OAuth device auth file: `~/.codex/auth.json`

Treat both as sensitive credential files. Do not share them.

## 10) Quick Troubleshooting

### `No available OAuth accounts`

- Add OAuth accounts (`add <alias>`)
- Re-auth invalid OAuth aliases
- Wait for temporary cooldown to expire

### `No available API key accounts`

- Add API account (`add-api <alias>`)
- Or add key through OpenCode UI (`Manually enter API Key`) and let it auto-import

### Tokens/API keys look out of date

- Run `opencode-multi-auth status`
- Open dashboard and refresh token(s) for OAuth accounts
