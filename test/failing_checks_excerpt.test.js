import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { FIX_CHECK_COLLECTOR } from '../desktop/plugin.js'

// Execute shipped helpers unchanged; only gh/PR reads are outside this boundary.
function excerpt(raw, cap = 4096) {
  const wrapper = String.raw`import sys,json
p=json.load(sys.stdin)
sys.argv=['collector','octocat/Hello-World','10','logs']
ns={};exec(compile(p['source'].split("pr=api('pulls/'")[0],'shipped-collector-helpers','exec'),ns)
print(json.dumps(ns['excerpt'](p['raw'],p['cap'])))`
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', wrapper], {
    input: JSON.stringify({ source: FIX_CHECK_COLLECTOR, raw, cap }), encoding: 'utf8', maxBuffer: 2 ** 20,
  })
  assert.equal(result.status, 0, result.stderr)
  const text = JSON.parse(result.stdout)
  assert.ok(Buffer.byteLength(text) <= cap)
  assert.ok(!text.includes('\ufffd'))
  return text
}
const noise = 'CI\tTest\t✔ failed-check handling regression passes with correct behavior\n'

test('late causal assertion survives successful test names containing failure words', () => {
  const raw = noise.repeat(100) + 'CI\tTest\tnot ok 42 - causal regression\nCI\tTest\tAssertionError [ERR_ASSERTION]: expected actual critical cause\n'
  const text = excerpt(raw)
  assert.match(text, /expected actual critical cause/)
  assert.match(text, /not ok 42 - causal regression/)
  assert.match(text, /\[.*omitted.*\]/)
})
test('huge earlier weak sections and huge adjacent context cannot crowd out later real causes', () => {
  const raw = ('failure-handling lockfile documentation ' + 'ä😀'.repeat(7000) + '\n').repeat(4)
    + 'before-one\nbefore-two\nAssertionError [ERR_ASSERTION]: late critical cause\nafter-one\nafter-two\nafter-three\n'
  const text = excerpt(raw)
  for (const context of ['before-one', 'before-two', 'late critical cause', 'after-one', 'after-two', 'after-three']) assert.ok(text.includes(context), context)
})
for (const diagnostic of [
  '##[error]src/main.py:12: native annotation cause',
  'npm ERR! code ERESOLVE: conflicting peer dependencies',
  'Traceback (most recent call last):',
  'Error: Process completed with exit code 1.',
]) test(`structured diagnostic outranks earlier successful names: ${diagnostic}`, () => {
  const text = excerpt(noise.repeat(120) + 'context-before\n' + diagnostic + '\ncontext-after\n')
  assert.ok(text.includes(diagnostic))
  assert.match(text, /context-before/)
  assert.match(text, /context-after/)
})
test('separated diagnostic context stays chronological with explicit gaps and no duplicates', () => {
  const raw = 'a0\na1\nError: first cause\na3\na4\na5\n' + 'ordinary noise\n'.repeat(20)
    + 'b0\nb1\nAssertionError: second cause\nb3\nb4\nb5\n'
  const text = excerpt(raw)
  assert.ok(text.indexOf('first cause') < text.indexOf('second cause'))
  assert.equal(text.match(/first cause/g).length, 1)
  assert.match(text, /a0\na1\nError: first cause\na3\na4\na5/)
  assert.match(text, /b0\nb1\nAssertionError: second cause\nb3\nb4\nb5/)
  assert.match(text, /\[.*omitted.*\]/)
})
test('many actual errors receive bounded selection across the log, not just its prefix', () => {
  const raw = Array.from({ length: 100 }, (_, i) => `before ${i}\nError: actual-cause-${i} ${'ä😀'.repeat(800)}\nafter ${i}\n${'ordinary\n'.repeat(8)}`).join('')
  const text = excerpt(raw)
  assert.match(text, /actual-cause-0 /)
  assert.match(text, /actual-cause-99 /)
  assert.ok(new Set(text.match(/actual-cause-\d+/g)).size >= 4)
  assert.match(text, /truncated/)
})
test('redaction precedes ranked selection and UTF-8 clipping even for tiny fair shares', () => {
  const raw = noise.repeat(100) + 'Error: API_KEY="SyntheticLateSecret9234\ncontinuation"\nAssertionError: late cause ' + 'ä😀'.repeat(4000)
  for (const cap of [32, 64, 128, 512, 4096]) {
    const text = excerpt(raw, cap)
    assert.ok(!text.includes('SyntheticLateSecret9234') && !text.includes('continuation'))
  }
  assert.match(excerpt(raw), /late cause/)
})
