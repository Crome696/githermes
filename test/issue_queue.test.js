import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyIssueQueue, updateIssueQueue, restoreIssueQueues, persistIssueQueue, startIssueQueue, QUEUE_START_BLOCKER } from '../desktop/plugin.js'
const repo = 'octocat/Hello-World'
const item = number => ({ repo, number, title: `Issue ${number}`, state: 'OPEN', labels: [{ name: 'bug', color: 'ff0000' }], assignees: [{ login: 'octocat' }] })
const selected = () => [5, 2, 9].reduce((d, n) => updateIssueQueue(d, { type: 'toggle', item: item(n) }), emptyIssueQueue(repo))
const numbers = d => d.items.map(i => i.number)

test('queue preserves selection order, metadata and independent repository drafts', () => {
 const d = selected()
 assert.deepEqual(numbers(d), [5, 2, 9])
 assert.equal(d.items[0].title, 'Issue 5')
 assert.deepEqual(d.items[0].labels, item(5).labels)
 assert.deepEqual(d.items[0].assignees, item(5).assignees)
 assert.equal(d.status, 'draft'); assert.ok(d.items.every(i => i.status === 'draft'))
 assert.deepEqual(numbers(updateIssueQueue(d, { type: 'toggle', item: item(2) })), [5, 9])
 assert.deepEqual(numbers(d), [5, 2, 9], 'updates must not mutate the prior snapshot')
 assert.equal(emptyIssueQueue('github/sdk').items.length, 0)
})
test('accessible and drag ordering share the same immutable move; remove and clear reset safely', () => {
 const d = selected()
 const moved = updateIssueQueue(d, { type: 'move', number: 9, to: 0 })
 assert.deepEqual(numbers(moved), [9, 5, 2])
 assert.deepEqual(numbers(updateIssueQueue(moved, { type: 'move', number: 9, to: 2 })), [5, 2, 9])
 assert.deepEqual(numbers(updateIssueQueue(moved, { type: 'remove', number: 5 })), [9, 2])
 const cleared = updateIssueQueue(moved, { type: 'clear' })
 assert.deepEqual(numbers(cleared), []); assert.equal(cleared.options.autoMerge, false)
 assert.equal(cleared.options.onError, 'stop')
 for (const action of [{ type: 'move', number: 9, to: -1 }, { type: 'move', number: 9, to: 3 }, { type: 'move', number: 8, to: 0 }, { type: 'retry' }, { type: 'resume' }, { type: 'pause' }]) assert.throws(() => updateIssueQueue(d, action))
})
test('scope, open-state, issue number and queue capacity are enforced before selection', () => {
 for (const r of ['@all', '@owner:github', 'bad', 'owner/repo;exec', '../repo']) assert.throws(() => emptyIssueQueue(r))
 for (const over of [{ repo: 'github/sdk' }, { state: 'CLOSED' }, { number: 0 }, { number: 1.1 }, { number: Number.MAX_SAFE_INTEGER + 1 }, { title: null }]) assert.throws(() => updateIssueQueue(selected(), { type: 'toggle', item: { ...item(5), ...over } }))
 let d = emptyIssueQueue(repo)
 for (let n = 1; n <= 100; n++) d = updateIssueQueue(d, { type: 'toggle', item: item(n) })
 assert.throws(() => updateIssueQueue(d, { type: 'toggle', item: item(101) }), /100/)
 assert.equal(updateIssueQueue(d, { type: 'toggle', item: item(100) }).items.length, 99)
})
test('defaults never approve merge; policy controls are validated draft preferences, not execution', () => {
 const d = emptyIssueQueue(repo)
 assert.deepEqual(d.options, { target: 'user', assignee: '', profile: '', strategy: 'squash', autoMerge: false, onError: 'stop' })
 for (const strategy of ['squash', 'merge', 'rebase']) assert.equal(updateIssueQueue(d, { type: 'options', options: { strategy } }).options.strategy, strategy)
 const opted = updateIssueQueue(d, { type: 'options', options: { autoMerge: true, onError: 'skip', target: 'agent', assignee: 'octocat', profile: 'fixture-agent' } })
 assert.equal(opted.options.autoMerge, true); assert.equal(opted.options.onError, 'skip')
 for (const options of [{ strategy: 'admin' }, { autoMerge: 'true' }, { onError: 'ignore' }, { target: 'shell' }, { assignee: '$(id)' }, { profile: null }, { toString: 'bad' }, JSON.parse('{"__proto__":{}}'), []]) assert.throws(() => updateIssueQueue(d, { type: 'options', options }))
})
test('real disk serialization restores order/options in a fresh module and isolates another repo', async () => {
 const artifacts = fileURLToPath(new URL('../../../artifacts/githermes-issues-2-3-4/', import.meta.url))
 mkdirSync(artifacts, { recursive: true })
 const dir = mkdtempSync(join(artifacts, 'issue-5-storage-'))
 try {
  const file = join(dir, 'storage.json')
  const storage = { set: (key, value) => writeFileSync(file, JSON.stringify({ [key]: value })) }
  let d = updateIssueQueue(selected(), { type: 'move', number: 9, to: 0 })
  d = updateIssueQueue(d, { type: 'options', options: { target: 'agent', profile: 'worker', assignee: 'octocat', strategy: 'rebase', autoMerge: true, onError: 'skip' } })
  const queues = persistIssueQueue(storage, { 'github/sdk': emptyIssueQueue('github/sdk') }, d)
  assert.deepEqual(numbers(queues[repo]), [9, 5, 2])
  const cold = await import(`../desktop/plugin.js?queue-cold=${Date.now()}`)
  const restored = cold.restoreIssueQueues(JSON.parse(readFileSync(file)).issueQueues)
  assert.deepEqual(numbers(restored[repo]), [9, 5, 2]); assert.equal(restored['github/sdk'].items.length, 0)
  assert.deepEqual(restored[repo].options, { ...d.options, autoMerge: false })
  assert.equal(restored[repo].status, 'draft'); assert.equal(restored[repo].goalId, undefined)
  const cleared = updateIssueQueue(restored[repo], { type: 'clear' })
  persistIssueQueue(storage, restored, cleared)
  assert.equal(cold.restoreIssueQueues(JSON.parse(readFileSync(file)).issueQueues)[repo].items.length, 0)
 } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('persistence failure never publishes the new snapshot or claims saved progress', () => {
 const old = { [repo]: selected() }
 assert.throws(() => persistIssueQueue({ set: () => { throw new Error('disk full') } }, old, emptyIssueQueue(repo)), /disk full/)
 assert.deepEqual(numbers(old[repo]), [5, 2, 9])
})
test('corrupt persisted drafts, duplicate issues and fabricated running state are rejected', () => {
 assert.deepEqual(restoreIssueQueues(null), {}); assert.deepEqual(restoreIssueQueues([]), {})
 for (const over of [{ version: 2 }, { status: 'running' }, { repo: 'github/sdk' }, { items: [item(5), item(5)] }, { options: { ...selected().options, autoMerge: 'yes' } }]) assert.deepEqual(restoreIssueQueues({ [repo]: { ...selected(), ...over } }), {})
 const raw = selected(); raw.items[0].status = 'merged'; raw.items[0].goalId = 'fake'
 assert.equal(restoreIssueQueues({ [repo]: raw })[repo].items[0].status, 'draft')
 assert.equal(restoreIssueQueues({ [repo]: raw })[repo].items[0].goalId, undefined)
})
test('start and retry attempts fail closed regardless of checks, consent or error policy, with no RPC', () => {
 let calls = 0
 const host = { request: () => { calls++; throw new Error('external writes forbidden') } }
 for (const onError of ['stop', 'skip']) for (const autoMerge of [false, true]) for (const checks of ['green', 'red', 'pending', 'missing']) {
  const d = updateIssueQueue(selected(), { type: 'options', options: { onError, autoMerge } })
  for (let retry = 0; retry < 2; retry++) assert.throws(() => startIssueQueue(host, d, { checks, protection: true, approved: autoMerge }), { message: QUEUE_START_BLOCKER })
  assert.deepEqual(numbers(d), [5, 2, 9]); assert.equal(d.status, 'draft')
 }
 assert.equal(calls, 0)
})
test('mounted production wiring keeps aggregate scope separate and explains disabled start', () => {
 const s = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
 assert.match(s, /labels,assignees`/)
 assert.match(s, /'aria-label': `Select issue #\$\{it.number\}`/)
 assert.match(s, /onClick: e => e.stopPropagation\(\)/)
 assert.match(s, /onDragStart:.*setDragging/); assert.match(s, /onDrop:.*type: 'move'/)
 assert.match(s, /button\(`Move #\$\{item.number\} up`/)
 assert.match(s, /disabled: true, 'aria-describedby': 'queue-start-blocker'/)
 assert.match(s, /\$issueQueues.set\(restoreIssueQueues/)
})
