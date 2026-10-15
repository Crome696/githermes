import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIssueDraftBody,
  confirmedIssueWrite,
  detectIssueDraftCandidate,
  duplicateSearchQuery,
  issueDraftRepoFromText,
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
  assert.equal(issueDraftRepoFromText('There is no repository here'), '')
})

test('duplicate search is scoped to open issues and title/body; body rewrite diff shows additions and removals', () => {
  assert.equal(duplicateSearchQuery('Keyboard bug', 'Focus lost'), 'is:issue is:open in:title,body Keyboard bug Focus lost')
  assert.equal(issueBodyDiff('old heading\nold detail\nkeep', 'new heading\nnew detail\nkeep'), '- old heading\n- old detail\n+ new heading\n+ new detail\n  keep')
  assert.equal(rewriteIssueBody('Existing scope', 'New session context'), 'Existing scope\n\n---\n\n## Session update\n\nNew session context')
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
