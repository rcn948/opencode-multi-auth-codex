# PRP-Lite: Add OpenAI API Account Swapping to Multi-Auth Codex Plugin

```yaml
prp_id: "3b39717b-852c-406b-885c-2c74420f8634"
version: "1.0.0"
status: "draft"
model_targets: ["gpt-5.3-codex"]
last_validated_on: "2026-02-23T19:34:46Z"
name: "Mixed OpenAI Auth Rotation (OAuth + API)"
description: |
  Extend opencode-multi-auth-codex so it can store, rotate, and manage
  both ChatGPT OAuth accounts (Codex backend) and OpenAI API-key accounts
  (OpenAI API backend), without regressing existing OAuth workflows.
compatibility:
  posture: "backward_compatible"
  notes: "Keep current OAuth behavior and store compatibility; no breaking changes for existing aliases."
smoke_test_cmd: "npm run build && node ./dist/cli.js help"
decision_log:
  - "Use account-type-aware routing: Codex-capable models route to OAuth pool; non-Codex OpenAI models route to API-key pool."
  - "Preserve existing accounts.json entries by migrating legacy rows to authType=oauth at load time."
  - "Auto-import OpenCode `openai` API auth entries into plugin store with deterministic dedupe; provide opt-out via env flag."
change_log:
  - "1.0.0: Initial PRP-Lite draft"
  - "1.0.1: Resolved API account sync decision (auto-import path)"
```

## Goal
Add first-class support for OpenAI API account rotation/swapping in this plugin, while preserving current multi-account ChatGPT OAuth (Codex) rotation.

## Why
- Users currently get multi-account resilience only for ChatGPT OAuth; API users still manually re-login/swap keys.
- OpenCode itself supports both auth types for `openai`, so this plugin should mirror that capability.
- Mixed auth support reduces operational friction and avoids context switching between provider/account login flows.

## What
Implement a dual-pool account system in `opencode-multi-auth-codex`:
- OAuth accounts (existing): continue using ChatGPT Codex backend and current headers/rotation semantics.
- API accounts (new): use OpenAI API key auth and route requests to standard OpenAI endpoints.
- Unified store/dashboard/CLI with explicit account type, safe redaction, and account-type-appropriate actions.

### Success Criteria
- [ ] Existing OAuth-only users upgrade without data loss or behavior regressions.
- [ ] Plugin can add/store/use multiple OpenAI API-key aliases and rotate among them.
- [ ] Requests using Codex models use OAuth pool; requests using non-Codex OpenAI models use API-key pool.
- [ ] Mixed setups (OAuth + API) work in one runtime without manual mode toggles.
- [ ] Dashboard and CLI clearly show account type and hide invalid actions per type.

### Risk Register
- Store migration bug could invalidate existing aliases - likelihood: med / impact: high - mitigation: load-time backward-compatible migration with backup, plus explicit migration tests.

## Open Questions & Assumptions
- Assumption: API accounts are supported via both manual add (UI/CLI) and automatic sync from OpenCode `Auth.get("openai")` when `type: "api"`.
  - Implementation note: use deterministic dedupe by API-key fingerprint and alias fallback (`api-<n>`).
  - Rollback plan: keep manual add behavior and disable auto-sync using env flag `OPENCODE_MULTI_AUTH_SYNC_API=0`.

## All Needed Context
- file: `opencode-multi-auth-codex/src/index.ts`
  why: Core auth loader + custom fetch/rotation path; currently hard-coded to OAuth token + Codex URL rewrite.
- file: `opencode-multi-auth-codex/src/types.ts` and `opencode-multi-auth-codex/src/store.ts`
  why: Current account schema is OAuth-shaped; migration and account-type fields must land here first.
- file: `opencode/packages/opencode/src/auth/index.ts` and `opencode/packages/opencode/src/provider/provider.ts`
  why: Upstream source-of-truth for `oauth` vs `api` auth payloads and plugin auth-loader injection behavior.

## Implementation Blueprint

### Data Model and Routing
- Introduce `authType: 'oauth' | 'api'` on account rows.
- Add `apiKey?: string` and make OAuth-only fields optional/guarded by type helpers.
- Split rotation into pool-aware selection (`oauth` vs `api`) while preserving cooldown/error semantics.
- In custom fetch, compute requested model family and route:
  - OAuth path: existing Codex mapping + token refresh + `chatgpt-account-id` behavior.
  - API path: pass through OpenAI endpoint, set `Authorization: Bearer <apiKey>`, avoid Codex-only headers.

### UX and Operations
- CLI: add API-key account add command and type-aware status output.
- Dashboard: show account type badge; disable/hide OAuth-only actions for API accounts (`switch auth.json`, token refresh, limits probe).
- Sync: ingest OpenCode OAuth and API auth entries into local store with dedupe and source tagging.

### Backward Compatibility
- Load-time migration maps legacy rows to `authType: 'oauth'`.
- Existing `accounts.json` still readable; save with new fields after first write.
- Preserve current environment variables and OAuth behavior unchanged unless account type is `api`.

## Task Specification

Task 1:
READ `src/types.ts`, `src/store.ts`, `src/auth.ts`:
  - FIND: OAuth-only assumptions (`accessToken`, `refreshToken`, `idToken`, `expiresAt` as required).
  - PRESERVE: Existing field names for backward compatibility.
  - VALIDATE: N/A (analysis task).

Task 2:
UPDATE `src/types.ts`:
  - ADD: `authType: 'oauth' | 'api'` to `AccountCredentials`.
  - ADD: `apiKey?: string`.
  - MODIFY: OAuth fields to be conditionally required via helper guards (or doc-invariant + runtime validation).
  - PRESERVE: Existing fields used by dashboard/rate-limits.
  - VALIDATE: `npm run build`.

Task 3:
UPDATE `src/store.ts`:
  - ADD: load-time migration function for legacy entries (default `authType='oauth'`).
  - ADD: helper validators (`isOauthAccount`, `isApiAccount`) and alias-safe upsert path.
  - MODIFY: `addAccount` and `updateAccount` typing to allow API rows.
  - PRESERVE: encryption behavior and atomic write semantics.
  - VALIDATE: `npm run build`.

Task 4:
UPDATE `src/auth-sync.ts`:
  - MODIFY: handle both `auth.type === 'oauth'` and `auth.type === 'api'` from OpenCode.
  - ADD: auto-import enabled by default; allow disable via `OPENCODE_MULTI_AUTH_SYNC_API=0`.
  - ADD: API-key dedupe strategy (key fingerprint or exact match, never log raw key).
  - ADD: source tagging (`source: 'opencode'`) for API entries.
  - VALIDATE: `npm run build`.

Task 5:
UPDATE `src/rotation.ts`:
  - MODIFY: expose pool-aware selector (e.g., `getNextAccount(config, { authType })`).
  - PRESERVE: cooldown/error handling for OAuth.
  - ADD: API-account invalidation handling for 401/403 without token-refresh paths.
  - VALIDATE: `npm run build`.

Task 6:
UPDATE `src/index.ts`:
  - MODIFY: custom fetch to branch by requested model/account type.
  - OAuth branch: MIRROR current behavior (Codex endpoint rewrite, JWT decode, account header, token refresh).
  - API branch: use original OpenAI path/base URL, set bearer key from API account, strip Codex-only headers.
  - ADD: clear error responses when requested pool has zero available accounts.
  - PRESERVE: existing retry-on-429 and account marking semantics, scoped per pool.
  - VALIDATE: `npm run build`.

Task 7:
UPDATE `src/index.ts` auth methods:
  - ADD: API auth method with prompts (`alias`, `apiKey`) returning `{ type:'success', provider:'openai', key }`.
  - PRESERVE: existing OAuth method labels/flow.
  - OPTIONAL: keep current "Skip" path if still useful.
  - VALIDATE: `npm run build && node ./dist/cli.js help`.

Task 8:
UPDATE `src/cli.ts`:
  - ADD: `add-api <alias>` command (or unified `add --type api`).
  - MODIFY: `list/status` output to include account type and type-specific fields.
  - PRESERVE: current OAuth add/login behavior.
  - VALIDATE: `npm run build && node ./dist/cli.js status`.

Task 9:
UPDATE `src/web.ts`:
  - MODIFY: `scrubAccount` to redact `apiKey` in addition to OAuth tokens.
  - ADD: API account creation endpoint (`/api/account/add-api`) and client form.
  - MODIFY: card rendering to show type badge and action gating by type.
  - PRESERVE: existing Codex auth.json watcher/switch behavior for OAuth accounts.
  - VALIDATE: `npm run build` and manual web smoke (`node ./dist/cli.js web --host 127.0.0.1 --port 3434`).

Task 10:
UPDATE docs (`README.md`, `OPENCODE_SETUP_1TO1.md`):
  - ADD: mixed-account concept, API account add flow, and routing behavior.
  - ADD: troubleshooting section for "no API accounts available" and mixed-mode expectations.
  - PRESERVE: existing OAuth setup docs.
  - VALIDATE: manual doc accuracy pass against actual CLI commands.

Task 11:
CREATE minimal regression checks:
  - CREATE: `src/__tests__/` (or project-consistent equivalent) for store migration + routing decision helpers.
  - TEST: legacy account row migration to `authType='oauth'`.
  - TEST: routing decision (`codex` model -> OAuth pool, non-codex -> API pool).
  - VALIDATE: run project test command if available; otherwise execute targeted node-based assertions.

## Validation Loop

### Level 0: Smoke Test
```bash
npm run build && node ./dist/cli.js help
```

### Level 1: Type/Syntax Validation
```bash
npm run build
```

### Level 2: Minimal Targeted Validation
```bash
# Legacy store migration does not drop existing OAuth aliases
OPENCODE_MULTI_AUTH_STORE_FILE=/tmp/opencode-multi-auth-test.json node ./dist/cli.js status
```

### Level 3: Integration Validation (Manual but deterministic steps)
```bash
# 1) Add one OAuth alias and one API alias
# 2) Trigger one codex model request and one non-codex OpenAI request
# 3) Verify account usage counters increment in the expected pool only
```

## Guarded Operations
- Any write to real credential files (`~/.config/opencode-multi-auth/accounts.json`, `~/.codex/auth.json`) should be tested with temporary store file overrides first.
- Never print or log API keys/refresh tokens; only log alias and type.
- If adding auto-import from OpenCode API auth, avoid overwriting manually labeled aliases without deterministic dedupe.

## Post-Execution Writeback
- On completion, bump to `version: 1.1.0`, set `status: completed`, update `last_validated_on`, and append validation outcomes.
- Add a short results digest (what shipped, what was deferred, and final routing behavior).
