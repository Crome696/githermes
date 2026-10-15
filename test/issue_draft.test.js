import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIssueDraftBody,
  confirmedIssueWrite,
  detectIssueDraftCandidate,
  duplicateSearchQuery,
  issueDraftRepoFromText,
  issueDraftRepoFromMessages,
  issueDraftTitle,
  parseIssueDraftResponse,
  issueBodyDiff,
  rewriteIssueBody,
  redactIssueSecrets,
  resolveIssueDraftRepo,
} from '../desktop/issue_draft.js'

test('repo selection prefers the session repository, accepts an explicit chat repo, and rejects ambiguous input', () => {
  assert.equal(resolveIssueDraftRepo({ sessionRepo: 'owner/session', chatRepo: 'owner/chat' }), 'owner/session')
  assert.equal(resolveIssueDraftRepo({ chatRepo: 'other/repo' }), 'other/repo')
  assert.equal(resolveIssueDraftRepo({ sessionRepo: 'bad; gh issue create', chatRepo: '' }), '')
  assert.equal(issueDraftRepoFromText('See https://github.com/Crome696/githermes/issues/13'), 'Crome696/githermes')
  assert.equal(issueDraftRepoFromText('See https://github.com/other/project/pull/42'), 'other/project')
  assert.equal(resolveIssueDraftRepo({ chatRepo: issueDraftRepoFromText('See https://github.com/other/project/pull/42') }), 'other/project')
  assert.equal(issueDraftRepoFromText('There is no repository here'), '')
  assert.equal(issueDraftRepoFromText('and/or'), '')
  assert.equal(issueDraftRepoFromText('src/foo'), '')
  assert.equal(issueDraftRepoFromText('See https://github.com/Crome696/githermes/issues/13.'), 'Crome696/githermes')
  assert.equal(issueDraftRepoFromText('owner/repository'), 'owner/repository')
  assert.equal(issueDraftRepoFromText('Repository: owner/repository'), 'owner/repository')
})

test('chat repo resolution selects the newest explicit repository mention', () => {
  assert.equal(issueDraftRepoFromMessages([
    { role: 'user', content: 'Use https://github.com/older/repo for this.' },
    { role: 'assistant', content: 'The latest request is for https://github.com/newer/repo.' },
  ]), 'newer/repo')
})

test('chat repo resolution leaves same-message ties unresolved for the user', () => {
  assert.equal(issueDraftRepoFromMessages([
    { role: 'user', content: 'Please use https://github.com/one/repo and https://github.com/two/repo.' },
  ]), '')
})

test('duplicate search is scoped to open issues and title/body; body rewrite diff shows additions and removals', () => {
  assert.equal(duplicateSearchQuery('Keyboard bug', 'Focus lost'), 'is:issue is:open in:title,body Keyboard bug Focus lost')
  assert.equal(issueBodyDiff('old heading\nold detail\nkeep', 'new heading\nnew detail\nkeep'), '- old heading\n- old detail\n+ new heading\n+ new detail\n  keep')
  assert.equal(rewriteIssueBody('Existing scope', 'New session context'), 'Existing scope\n\n<!-- githermes:issue-draft:start -->\nNew session context\n<!-- githermes:issue-draft:end -->')
  assert.equal(rewriteIssueBody('Before\n\n<!-- githermes:issue-draft:start -->\nOld draft\n<!-- githermes:issue-draft:end -->\n\nAfter', 'New draft'), 'Before\n\n<!-- githermes:issue-draft:start -->\nNew draft\n<!-- githermes:issue-draft:end -->\n\nAfter')
})

test('duplicate search uses task content, finds a matching issue fixture, and omits template boilerplate', () => {
  const title = 'Keep issue draft in the active Hermes session'
  const body = buildIssueDraftBody({
    goal: 'Persist a session issue draft after a model response',
    context: 'The pane currently loses the proposed title and body.',
    implementation: 'Read assistant history and populate the form once.',
    acceptance: ['The returned draft appears without copy and paste.'],
  })
  const query = duplicateSearchQuery(title, body)
  const fixture = { title, body: 'Persist a session issue draft after a model response. The pane currently loses the proposed title and body. Read assistant history and populate the form once. The returned draft appears without copy and paste.', state: 'OPEN' }
  const terms = query.replace(/^is:issue is:open in:title,body\s*/, '').toLowerCase().split(/\s+/).filter(Boolean)
  assert.ok(terms.length > 0)
  const matches = [fixture].filter(issue => issue.state === 'OPEN' && terms.every(term => `${issue.title} ${issue.body}`.toLowerCase().includes(term)))
  assert.deepEqual(matches, [fixture], `matching open-issue fixture not found for terms: ${terms.join(', ')}`)
  for (const boilerplate of ['## Goal', '## Context', '## Implementation', '## Acceptance criteria', '## References', 'Describe the desired outcome', 'Add relevant session context', 'Add relevant session, PR, or issue links']) {
    assert.ok(!query.includes(boilerplate), `query contains template boilerplate: ${boilerplate}`)
  }
  assert.equal(duplicateSearchQuery('Useful title', buildIssueDraftBody({})), 'is:issue is:open in:title,body Useful title')
})

test('assistant issue draft response is parsed into title and body for direct form adoption', () => {
  assert.deepEqual(parseIssueDraftResponse([
    { role: 'user', text: 'Draft an issue' },
    { role: 'assistant', text: 'Title: Preserve the issue draft\n\nBody:\n## Goal\nKeep the proposed issue in the pane.\n\n## Acceptance criteria\n- [ ] No copy and paste' },
  ]), {
    title: 'Preserve the issue draft',
    body: '## Goal\nKeep the proposed issue in the pane.\n\n## Acceptance criteria\n- [ ] No copy and paste',
  })
  assert.equal(parseIssueDraftResponse([
    { role: 'assistant', text: 'Title: Old draft\n\nBody:\nOld body' },
    { role: 'user', text: 'Draft a GitHub issue from this session' },
  ]), null, 'a previous answer must not populate the form while the current request is unanswered')
})

test('issue draft form always starts with a non-empty, secret-masked title', () => {
  assert.equal(issueDraftTitle('Follow-up: keep the session draft'), 'Follow-up: keep the session draft')
  assert.equal(issueDraftTitle('token=super-secret-value-12345'), 'token=[REDACTED]')
  assert.equal(issueDraftTitle(''), 'Session issue draft')
})

test('duplicate issue title is redacted before it can be adopted into the form', () => {
  const item = { title: 'Investigate token=super-secret-value-12345' }
  assert.equal(redactIssueSecrets(item.title), 'Investigate token=[REDACTED]')
})

test('draft bodies use the required sections and secret-shaped values are masked before review', () => {
  const body = buildIssueDraftBody({ goal: 'Use ghp_12345678901234567890 in a sample' })
  assert.match(body, /## Goal[\s\S]*## Context[\s\S]*## Implementation[\s\S]*## Acceptance criteria[\s\S]*## References/)
  assert.equal(redactIssueSecrets('token=super-secret-value-12345'), 'token=[REDACTED]')
  assert.equal(redactIssueSecrets('ghp_12345678901234567890'), '[REDACTED]')
})

test('auto-detection only suggests explicitly marked issue intent and masks secrets', () => {
  assert.equal(detectIssueDraftCandidate([{ role: 'user', content: 'We should track this as an issue: token=super-secret-value-12345' }]), 'We should track this as an issue: token=[REDACTED]')
  assert.equal(detectIssueDraftCandidate([{ role: 'user', content: 'Maybe someday we can improve this' }]), null)
})

test('GitHub writes require explicit confirmation, update checks the reviewed body and both paths read back exact values', async () => {
  const calls = []
  let stored = { number: 7, title: 'Old', body: 'before', url: 'https://github.com/a/b/issues/7' }
  const api = {
    readIssue: async () => ({ ...stored }),
    createIssue: async (_repo, title, body) => { calls.push('create'); stored = { number: 8, title, body, url: 'https://github.com/a/b/issues/8' }; return stored },
    updateIssue: async (_repo, _number, title, body) => { calls.push('update'); stored = { ...stored, title, body } },
  }
  await assert.rejects(confirmedIssueWrite({ action: 'create', confirmed: false, repo: 'a/b', title: 'New', body: 'draft', ...api }), /explicit confirmation/)
  assert.deepEqual(calls, [])
  const created = await confirmedIssueWrite({ action: 'create', confirmed: true, repo: 'a/b', title: 'New', body: 'draft', ...api })
  assert.equal(created.title, 'New')
  assert.equal(calls[0], 'create')
  stored = { number: 7, title: 'Old', body: 'before', url: 'https://github.com/a/b/issues/7' }
  const updated = await confirmedIssueWrite({ action: 'update', confirmed: true, repo: 'a/b', title: 'Rewritten', body: 'after', number: 7, originalTitle: 'Old', originalBody: 'before', ...api })
  assert.equal(updated.body, 'after')
  await assert.rejects(confirmedIssueWrite({ action: 'update', confirmed: true, repo: 'a/b', title: 'Lost edit', body: 'after', number: 7, originalTitle: 'Old', originalBody: 'stale', ...api }), /changed since review/)
  assert.equal(calls.filter(call => call === 'update').length, 1)
})
