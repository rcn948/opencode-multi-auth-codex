import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { resolveCodexExecutable } from '../probe-limits.js'

const ORIGINAL_PATH = process.env.PATH
const ORIGINAL_CODEX_BIN = process.env.OPENCODE_MULTI_AUTH_CODEX_BIN

function restoreEnv(): void {
  if (ORIGINAL_PATH === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = ORIGINAL_PATH
  }

  if (ORIGINAL_CODEX_BIN === undefined) {
    delete process.env.OPENCODE_MULTI_AUTH_CODEX_BIN
  } else {
    process.env.OPENCODE_MULTI_AUTH_CODEX_BIN = ORIGINAL_CODEX_BIN
  }
}

test.afterEach(() => {
  restoreEnv()
})

test('resolveCodexExecutable uses OPENCODE_MULTI_AUTH_CODEX_BIN when configured', () => {
  process.env.OPENCODE_MULTI_AUTH_CODEX_BIN = '/custom/bin/codex'

  const resolved = resolveCodexExecutable('/usr/bin')

  assert.equal(resolved.command, '/custom/bin/codex')
  assert.ok(resolved.pathEnv.split(path.delimiter).includes('/custom/bin'))
})

test('resolveCodexExecutable finds codex from the effective PATH', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bin-'))
  const codexPath = path.join(tempDir, 'codex')
  fs.writeFileSync(codexPath, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(codexPath, 0o755)

  const resolved = resolveCodexExecutable(tempDir)

  assert.equal(resolved.command, codexPath)
  assert.ok(resolved.pathEnv.split(path.delimiter).includes(tempDir))
})
