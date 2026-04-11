import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../index.js'
import mod from '../server.js'

test('server entry exports a v1 server module', () => {
  assert.equal(typeof mod, 'object')
  assert.equal(typeof mod.server, 'function')
  assert.equal(mod.server, plugin)
  assert.equal('tui' in mod, false)
})
