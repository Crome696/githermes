import test from 'node:test'
import assert from 'node:assert/strict'
import { dependencyBotPr, parseDependencyTitle, groupDependencyPrs, requestDependencyBotRebase } from '../desktop/plugin.js'

const pr = (overrides = {}) => ({
  repo: 'owner/repo', number: 1, title: 'Update dependency @angular/router from 22.1.0 to 22.2.0',
  author: { login: 'renovate[bot]' }, headRefName: 'renovate/angular-router-22.x',
  state: 'OPEN', isDraft: false, mergeableState: 'clean', checkState: 'SUCCESS',
  ...overrides,
})

test('dependency bot detection recognizes known/configured logins and self-hosted branch prefixes', () => {
  assert.equal(dependencyBotPr(pr()), true)
  assert.equal(dependencyBotPr(pr({ author: { login: 'dependabot[bot]' }, headRefName: 'feature/deps' })), true)
  assert.equal(dependencyBotPr(pr({ author: { login: 'automation-user' }, headRefName: 'feature/deps' }), { logins: ['automation-user'] }), true)
  assert.equal(dependencyBotPr(pr({ author: { login: 'alice' }, headRefName: 'renovate/custom-update' })), true)
  assert.equal(dependencyBotPr(pr({ author: { login: 'alice' }, headRefName: 'dependabot/npm_and_yarn/pkg-1.2.3' })), true)
  assert.equal(dependencyBotPr(pr({ author: { login: 'alice' }, headRefName: 'feature/renovate/custom-update' })), false)
  assert.equal(dependencyBotPr(pr({ author: { login: 'alice' }, headRefName: 'feature/update' })), false)
})

test('dependency title parser extracts package, version jump, major and security markers', () => {
  assert.deepEqual(parseDependencyTitle('Update dependency @angular/router from 22.1.0 to 23.0.0'), {
    package: '@angular/router', from: '22.1.0', to: '23.0.0', major: true, security: false,
  })
  assert.deepEqual(parseDependencyTitle('[SECURITY] Bump lodash from 4.17.20 to 4.17.21'), {
    package: 'lodash', from: '4.17.20', to: '4.17.21', major: false, security: true,
  })
  assert.deepEqual(parseDependencyTitle('chore(deps): update dependency @types/node to v22.10.2'), {
    package: '@types/node', from: null, to: '22.10.2', major: null, security: false,
  })
  assert.equal(parseDependencyTitle('Update dependencies'), null)
})

test('dependency PRs group green, red, pending and conflicts with conflicts taking precedence', () => {
  const groups = groupDependencyPrs([
    pr({ number: 1 }),
    pr({ number: 2, checkState: 'FAILURE' }),
    pr({ number: 3, checkState: 'PENDING' }),
    pr({ number: 4, mergeableState: 'dirty' }),
    pr({ number: 5, isDraft: true }),
    pr({ number: 6, mergeableState: 'CONFLICTING' }),
    pr({ number: 7, mergeableState: 'UNKNOWN' }),
  ])
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.map(row => row.number)])), {
    green: [1], red: [2], pending: [3, 5, 7], conflict: [4, 6],
  })
})

test('conflict handling requests a bot rebase, never a local rebase, and deduplicates concurrent clicks', async () => {
  const calls = []
  let comments = ''
  const run = async command => {
    calls.push(command)
    if (command.includes('--paginate')) return comments
    if (command.includes('--method POST')) { comments = '@dependabot rebase'; return '{}' }
    throw new Error('unexpected command')
  }
  const item = pr({ author: { login: 'dependabot[bot]' }, headRefName: 'dependabot/npm_and_yarn/pkg-1' })
  const [first, second] = await Promise.all([requestDependencyBotRebase(item, run), requestDependencyBotRebase(item, run)])
  assert.deepEqual(first, { status: 'requested', command: '@dependabot rebase' })
  assert.deepEqual(second, first)
  assert.equal(calls.filter(command => command.includes('--method POST')).length, 1)
  assert.ok(calls.every(command => !/git\s+rebase|force-with-lease/i.test(command)))
  assert.equal((await requestDependencyBotRebase(item, run)).status, 'already-requested')
})
