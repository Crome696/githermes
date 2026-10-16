import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('desktop plugin contains no foreign repository identifiers', () => {
  const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /claudiumio|claudioorjunior|Crome696\//i)
})
