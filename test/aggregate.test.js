import test from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../desktop/plugin.js'

test('combined picker has a distinct owned scope and accepts persisted owner scopes', () => {
  assert.equal(typeof plugin.aggregateScope, 'function')
  assert.deepEqual(plugin.aggregateScope('@all'), { type: 'all' })
  assert.deepEqual(plugin.aggregateScope('@owner:example-org'), { type: 'owner', owner: 'example-org' })
  assert.equal(plugin.aggregateScope('stranger/repo'), null)
})
test('combined search never ANDs personal and organization owners', () => {
  assert.equal(typeof plugin.buildAggregateRequest, 'function')
  const req = plugin.buildAggregateRequest({ owners: [{login:'alice',kind:'user'},{login:'team',kind:'org'}], kind:'prs', state:'open', filters:{} })
  assert.match(req.variables.q0, /user:alice/)
  assert.match(req.variables.q1, /org:team/)
  assert.ok(!req.variables.q0.includes('org:team'))
  assert.match(req.query, /s0: search/)
  assert.match(req.query, /s1: search/)
})
