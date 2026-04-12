# OpenCode Setup (1:1 with guard22)

This is a newcomer-friendly guide to set up OpenCode with the same stack I use:

- Multi-account **ChatGPT OAuth** rotation for Codex (this plugin)
- Codex Token Dashboard (web UI) for accounts/tokens/quotas
- Antigravity auth (Gemini/Claude through OpenCode) for background agents
- Oh My OpenCode (agent harness + extra tooling)
- MCP servers (Chrome DevTools, Firecrawl)

The goal: after you finish, OpenCode feels "ready" and fast to use.

## What You Get

- OpenCode Desktop + `opencode-cli` working
- Multiple ChatGPT Plus/Pro accounts added, automatic rotation
- Selecting **GPT-5.2 Codex** in OpenCode can still use **Codex 5.3** via backend mapping (until OpenCode lists 5.3 natively)
- A web dashboard to inspect accounts, refresh tokens, refresh quotas, add/remove accounts, notes/tags

## Requirements (macOS)

You need:

- OpenCode Desktop installed (includes `opencode-cli`)
- Node.js installed (for MCP tools like `npx ...`)
- Bun installed (OpenCode uses Bun for plugin installs)

Quick checks:

```bash
node -v
bun -v
ls /Applications/OpenCode.app/Contents/MacOS/opencode-cli
```

If Node/Bun are missing, install them first.

## Install This Plugin

Install this repo into OpenCode's config directory:

```bash
bun add github:dredivaris/opencode-multi-auth-codex#v1.0.9 --cwd ~/.config/opencode
```

If you prefer tracking `main` (not recommended for beginners):

```bash
bun add github:dredivaris/opencode-multi-auth-codex --cwd ~/.config/opencode
```

## Optional Plugins (Same Stack)

These are optional but part of the "1:1" setup I use.

### Antigravity Auth

```bash
bun add opencode-antigravity-auth@1.4.5 --cwd ~/.config/opencode
```

### Oh My OpenCode

```bash
bun add oh-my-opencode@3.1.6 --cwd ~/.config/opencode
```

## Create the OpenCode Config

Edit (or create) this file:

- `~/.config/opencode/opencode.json`

Below is a known-good baseline.

Important:

- Replace placeholders like `PASTE_FIRECRAWL_API_KEY_HERE` with your value.
- Replace `YOUR_USER` with your macOS username.
- Do not share this file if it contains secrets.

```json
{
  "$schema": "https://opencode.ai/config.json",

  "plugin": [
    "oh-my-opencode@3.1.6",
    "opencode-antigravity-auth@1.4.5",

    "file:///Users/YOUR_USER/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/index.js"
  ],

  "permission": {
    "delegate_task": "allow",
    "task": { "*": "allow" },
    "skill": { "*": "allow" }
  },

  "compaction": {
    "auto": true,
    "prune": true
  },

  "model": "google/antigravity-gemini-3-pro-high",

  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "include": ["reasoning.encrypted_content"],
        "store": false
      },

      "models": {
        "gpt-5.2": {
          "name": "GPT-5.2",
          "limit": { "context": 272000, "output": 128000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },

        "gpt-5.2-codex-medium": {
          "name": "GPT 5.2 Codex Medium (OAuth)",
          "limit": { "context": 400000, "output": 128000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        },

        "gpt-5.2-codex-high": {
          "name": "GPT 5.2 Codex High (OAuth)",
          "limit": { "context": 400000, "output": 128000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": ["reasoning.encrypted_content"],
            "store": false
          }
        }
      }
    },

    "google": {
      "models": {
        "antigravity-gemini-3-pro-high": {
          "name": "Gemini 3 Pro High (Antigravity)",
          "limit": { "context": 250000, "output": 65535 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "gemini-3-flash": {
          "name": "Gemini 3 Flash (Antigravity)",
          "limit": { "context": 250000, "output": 65536 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        },
        "claude-opus-4-5-thinking-high": {
          "name": "Claude Opus 4.5 Thinking High (Antigravity)",
          "limit": { "context": 200000, "output": 64000 },
          "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] }
        }
      }
    }
  },

  "mcp": {
    "chrome-devtools": {
      "type": "local",
      "command": ["npx", "-y", "chrome-devtools-mcp@latest", "--channel", "stable"],
      "enabled": true
    },

    "firecrawl-mcp": {
      "type": "local",
      "command": ["npx", "-y", "firecrawl-mcp"],
      "environment": {
        "FIRECRAWL_API_KEY": "PASTE_FIRECRAWL_API_KEY_HERE"
      },
      "enabled": true
    }
  }
}
```

## Add Codex Accounts (Multi-Account OAuth)

You can add accounts via OpenCode UI or via this plugin CLI.

### Option A: OpenCode UI

In OpenCode:

- Providers / Auth
- OpenAI
- Choose **"ChatGPT OAuth (Headless, Multi-Auth)"**
  - Fallback option is also available: **"ChatGPT OAuth (Browser Callback, Fallback)"**
- Enter an alias (e.g. `acc1`, `work`, `backup`)
- Complete login in your browser

Repeat for each account.

### Option B: Plugin CLI

```bash
node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js add acc1
node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js add acc2
node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js status
```

Account store file:

- `~/.config/opencode-multi-auth/accounts.json`

Security note:

- Treat it like a password vault. It contains refresh tokens.

## Add OpenAI API Accounts (Multi-Account API Keys)

You can add API accounts in two ways.

### Option A: OpenCode UI (auto-import)

In OpenCode:

- Providers / Auth
- OpenAI
- Choose **"Manually enter API Key"**
- Enter your OpenAI API key

This plugin auto-imports each new key into `~/.config/opencode-multi-auth/accounts.json`.

### Option B: Plugin CLI

```bash
OPENCODE_MULTI_AUTH_API_KEY=sk-... \
node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js add-api api1

OPENCODE_MULTI_AUTH_API_KEY=sk-... \
node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js add-api api2

node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js status
```

Routing behavior:

- `-oauth` models (or `(OAuth)` picker entries) use OAuth rotation.
- `-api` models (or `(API)` picker entries) use API-key rotation.
- Without explicit route labels: codex models default to OAuth, non-codex models default to API.
- Codex models are exposed as both API and OAuth variants; some non-codex models are also dual-route (`gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-pro`).
- OAuth account selection is quota-reset aware (nearest usable reset first); API follows configured strategy.

## Codex 5.3 Mapping (How to Use the Newest Codex)

OpenCode may not list `openai/gpt-5.3-codex` yet. This plugin can still use it.

Default behavior:

- If you select `openai/gpt-5.2-codex` (or `openai/gpt-5-codex`), the plugin will send requests as `gpt-5.3-codex`.

Env vars:

- `OPENCODE_MULTI_AUTH_PREFER_CODEX_LATEST=0` disables mapping.
- `OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL=gpt-5.3-codex` overrides target.
- `OPENCODE_MULTI_AUTH_DUAL_ROUTE_MODELS=gpt-5,gpt-5.1,gpt-5.2,gpt-5.4,gpt-5.4-mini,gpt-5.4-pro` controls non-codex dual-route variants.
- `OPENCODE_MULTI_AUTH_DEBUG=1` prints mapping logs.

### Verify mapping works

```bash
OPENCODE_MULTI_AUTH_DEBUG=1 \
OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL=gpt-5.3-codex \
/Applications/OpenCode.app/Contents/MacOS/opencode-cli run \
  -m openai/gpt-5.2-codex "Reply ONLY with OK." \
  --print-logs --log-level INFO
```

Expected:

- log contains `model map: gpt-5.2-codex -> gpt-5.3-codex`
- response is `OK`

## Web Dashboard

Start local dashboard:

```bash
node ~/.config/opencode/node_modules/@dredivaris/opencode-multi-auth-codex/dist/cli.js web --host 127.0.0.1 --port 3434
```

Open:

- `http://127.0.0.1:3434`

What it's for:

- See all accounts
- Refresh tokens
- Refresh limits/quotas (active or all accounts)
- Add/remove accounts
- Notes/tags
- Basic logs

## Troubleshooting

### "No available accounts"

Rotation found zero usable accounts (expired/invalid/rate-limited).

Fix:

- Open dashboard and look for ERROR badges.
- Re-auth the failing account.
- Add more accounts, or wait for cooldown.

### "No available API key accounts"

You selected an API-routed model but no API-key account is available.

Fix:

- Add one with `add-api` (CLI) or connect OpenCode OpenAI with "Manually enter API Key"
- Re-run `status` to confirm API aliases exist

### "No available OAuth accounts"

You selected an OAuth-routed model but no OAuth account is available.

Fix:

- Add one with `add` (CLI) or OpenCode OAuth login flow
- Re-run `status` to confirm OAuth aliases exist

### 401 / "token invalidated" / "Token refresh failed"

This is almost always account-level.

Fix:

- Re-login that specific alias.

### Check plugin loading

```bash
/Applications/OpenCode.app/Contents/MacOS/opencode-cli debug config --print-logs
```

You should see entries like:

- `... opencode-multi-auth-codex ... loading plugin`
- `... opencode-antigravity-auth ... loading plugin`
- `... oh-my-opencode ... loading plugin`
