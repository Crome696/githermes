import test from 'node:test'
import assert from 'node:assert/strict'
import { dependencyBotPr, parseDependencyTitle, groupDependencyPrs } from '../desktop/plugin.js'

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
  assert.equal(parseDependencyTitle('Update dependencies'), null)
})

test('dependency PRs group green, red, pending and conflicts with conflicts taking precedence', () => {
  const groups = groupDependencyPrs([
    pr({ number: 1 }),
    pr({ number: 2, checkState: 'FAILURE' }),
    pr({ number: 3, checkState: 'PENDING' }),
    pr({ number: 4, mergeableState: 'dirty' }),
    pr({ number: 5, isDraft: true }),
  ])
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.map(row => row.number)])), {
    green: [1], red: [2], pending: [3, 5], conflict: [4],
  })
})
