import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const workflow = new URL('../.github/workflows/ci.yml', import.meta.url)
const source = existsSync(workflow) ? readFileSync(workflow, 'utf8').replace(/\r\n/g, '\n') : ''

test('CI runs for every PR, pushes to main and manual dispatch without path filters', () => {
  assert.ok(existsSync(workflow), 'the test workflow must exist')
  assert.match(source, /^on:\n  pull_request:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/m)
  assert.doesNotMatch(source, /\b(?:paths|paths-ignore|branches-ignore):/)
})

test('CI cancels superseded runs for the same ref', () => {
  assert.match(source, /^concurrency:\n  group: ci-\$\{\{ github.ref \}\}\n  cancel-in-progress: true$/m)
})

test('CI tests all supported OSes on Node 22 and Electron 40 Node 24', () => {
  assert.match(source, /^    name: test \(\$\{\{ matrix.os \}\}, node \$\{\{ matrix.node \}\}\)$/m)
  assert.match(source, /^    runs-on: \$\{\{ matrix.os \}\}$/m)
  assert.match(source, /^      fail-fast: false$/m)
  assert.match(source, /^        os: \[ubuntu-latest, windows-latest, macos-latest\]$/m)
  assert.match(source, /^        node: \[22, 24\]$/m)
})

test('CI uses npm test with its pretest bootstrap and does not install nonexistent dependencies', () => {
  assert.match(source, /^      - name: Run tests\n        run: npm test$/m)
  assert.doesNotMatch(source, /npm (?:ci|install)|cache: npm/)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.pretest, 'node scripts/bootstrap-stubs.mjs')
  assert.equal(pkg.scripts.test, 'node --test')
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0)
  assert.equal(Object.keys(pkg.devDependencies || {}).length, 0)
})

test('CI actions are immutable and credentials are not persisted', () => {
  assert.match(source, /^permissions:\n  contents: read$/m)
  assert.match(source, /uses: actions\/checkout@[a-f0-9]{40} # v5/)
  assert.match(source, /persist-credentials: false/)
  assert.match(source, /uses: actions\/setup-node@[a-f0-9]{40} # v5/)
  assert.match(source, /node-version: \$\{\{ matrix.node \}\}/)
  assert.doesNotMatch(source, /secrets\.|pull_request_target|write-all/)
})

test('CI also checks the plugin syntax without changing the runtime', () => {
  assert.match(source, /^      - name: Check plugin syntax\n        run: node --check desktop\/plugin.js$/m)
})
