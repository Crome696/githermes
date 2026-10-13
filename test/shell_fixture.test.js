import test from 'node:test'
import assert from 'node:assert/strict'
import { relocateShellArtifacts } from '../scripts/test-helpers/shell_fixture.mjs'

test('shell fixture relocation preserves Ubuntu payload and CLI paths already under /tmp', () => {
  const root = '/tmp/githermes-transport-fixture'
  const command = `cat '${root}/payload.json' > '/tmp/ghprs.sample.raw'; node '${root}/fixture.mjs' < '/tmp/ghaggregate.sample'`
  assert.equal(relocateShellArtifacts(command, root),
    `cat '${root}/payload.json' > '${root}/ghprs.sample.raw'; node '${root}/fixture.mjs' < '${root}/ghaggregate.sample'`)
})

test('shell fixture relocation handles Windows runner scripts and transport cleanup', () => {
  const root = '/c/Users/runner/fixture'
  const command = `base64 -d > /tmp/gt$$.sh; bash /tmp/gt$$.sh; unlink /tmp/gt$$.sh; unlink '/tmp/ghprs.sample.hex'`
  assert.equal(relocateShellArtifacts(command, root),
    `base64 -d > ${root}/gt$$.sh; bash ${root}/gt$$.sh; unlink ${root}/gt$$.sh; unlink '${root}/ghprs.sample.hex'`)
})

test('shell fixture relocation is idempotent and leaves unrelated /tmp paths unchanged', () => {
  const root = '/tmp/githermes-aggregate-fixture'
  const command = `node '${root}/fixture.mjs'; cat '/tmp/unrelated/data.json'; unlink '/tmp/ghaggregate.sample'`
  const relocated = `node '${root}/fixture.mjs'; cat '/tmp/unrelated/data.json'; unlink '${root}/ghaggregate.sample'`
  assert.equal(relocateShellArtifacts(command, root), relocated)
  assert.equal(relocateShellArtifacts(relocated, root), relocated)
})
