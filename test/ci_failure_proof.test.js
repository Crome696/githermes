import test from 'node:test'
import { setTimeout } from 'node:timers/promises'

// Authorized temporary overlap window; no delay in local verification.
test('issue #7 temporary concurrency verification window', async () => {
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log('ISSUE_7_CONCURRENCY_WINDOW_STARTED')
    await setTimeout(120_000)
  }
})
