import test from 'node:test'
import assert from 'node:assert/strict'
import * as p from '../desktop/plugin.js'

test('only the specified failing rollup states and external failure/error enable Fix', () => {
  assert.equal(typeof p.failedPrChecks, 'function')
  for (const conclusion of ['FAILURE','TIMED_OUT','CANCELLED','ACTION_REQUIRED']) assert.equal(p.failedPrChecks([{__typename:'CheckRun',status:'COMPLETED',conclusion}]).length,1)
  for (const conclusion of ['SUCCESS','NEUTRAL','SKIPPED','STALE','STARTUP_FAILURE']) assert.equal(p.failedPrChecks([{__typename:'CheckRun',status:'COMPLETED',conclusion}]).length,0)
  for (const state of ['FAILURE','ERROR']) assert.equal(p.failedPrChecks([{__typename:'StatusContext',state}]).length,1)
  assert.equal(p.failedPrChecks([{status:'IN_PROGRESS',conclusion:'FAILURE'},{state:'PENDING'}]).length,0)
})
