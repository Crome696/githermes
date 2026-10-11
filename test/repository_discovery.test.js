import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as plugin from '../desktop/plugin.js'

const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const useReposSource = source.slice(source.indexOf('function useRepos() {'), source.indexOf('// Behind count only changes'))
const personal = Array.from({ length: 131 }, (_, i) => `sample-owner/repository-${String(i).padStart(3, '0')}`)
const allRepos = [...personal, 'sample-org/private-team-project']

// Exercise the actual query callback, adapting only the query hook and shell
// boundary. The old owner-only command gets its real 30-row discovery window.
test('repository query includes organization repositories and every page', async () => {
  const run = new Function('useQuery', 'GH', 'ID', 'shJson', 'loadAccessibleRepos',
    `${useReposSource}; return useRepos().queryFn()`)
  const result = await run(options => options, 'gh', 'githermes',
    async () => personal.slice(0, 30).map(nameWithOwner => ({ nameWithOwner })),
    () => plugin.loadAccessibleRepos(async () => allRepos.join('\n')))
  assert.equal(result.length, allRepos.length)
  assert.deepEqual(result, [...allRepos].sort())
})

test('discovery explicitly requests all visibility and affiliations without a cap', async () => {
  let command
  await plugin.loadAccessibleRepos(async cmd => { command = cmd; return '' })
  assert.ok(command.includes("api 'user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&sort=full_name&direction=asc'"))
  assert.ok(command.includes("--paginate --jq '.[].full_name'"))
  assert.ok(!command.includes('--limit'))
  const helper = source.slice(source.indexOf('export async function loadAccessibleRepos'), source.indexOf('function useRepos'))
  assert.ok(helper.includes('run = shBig'), 'repository names must use the chunked transport')
})

test('discovery normalizes CRLF, ignores blank lines and deduplicates case-insensitively', async () => {
  const result = await plugin.loadAccessibleRepos(async () => 'z-owner/Zed\r\n\r\na-org/private\r\nZ-OWNER/ZED\n')
  assert.deepEqual(result, ['a-org/private', 'z-owner/Zed'])
})

test('repository discovery is not limited by a 4000-character shell payload', async () => {
  const repos = Array.from({ length: 350 }, (_, i) => `sample-organization/repository-${String(i).padStart(3, '0')}`)
  const payload = repos.join('\n')
  assert.ok(payload.length > 4000)
  assert.deepEqual(await plugin.loadAccessibleRepos(async () => payload), repos)
})

test('an account with no repositories produces an empty discovery list', async () => {
  assert.deepEqual(await plugin.loadAccessibleRepos(async () => ''), [])
})

test('authentication and organization authorization failures propagate, not partial success', async () => {
  for (const message of ['HTTP 401: Bad credentials', 'HTTP 403: SAML SSO authorization required']) {
    await assert.rejects(plugin.loadAccessibleRepos(async () => { throw new Error(message) }), { message })
  }
})

test('altered or invalid CLI output fails rather than silently hiding repositories', async () => {
  for (const output of ['invalid', 'owner/repo; rm -rf /', 'owner/repo\nHTTP 403']) {
    await assert.rejects(plugin.loadAccessibleRepos(async () => output), /invalid repository name/)
  }
})
