import test from 'node:test'
import assert from 'node:assert/strict'

// Authorized temporary CI proof for #7. Removed by a normal cleanup commit.
test('issue #7 intentional red-check proof', () => {
  assert.fail('ISSUE_7_INTENTIONAL_CI_FAILURE')
})
