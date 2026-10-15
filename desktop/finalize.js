const STATES = Object.freeze({
  open: 'offen',
  working: 'in Arbeit',
  pr: 'PR offen',
  failing: 'PR mit Failing Checks',
  merged: 'gemerged',
  closed: 'geschlossen ohne Merge',
})

export function buildFinalizeQuery(items) {
  if (!Array.isArray(items) || items.length > 50) throw new Error('Finalization batch must contain at most 50 issues')
  const variables = {}, declarations = [], fields = []
  items.forEach((item, index) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(item?.repo || '') || !Number.isSafeInteger(item.number) || item.number < 1) throw new Error('Invalid queued issue')
    const [owner, name] = item.repo.split('/')
    const ownerVar = `owner${index}`, nameVar = `name${index}`, numberVar = `number${index}`
    variables[ownerVar] = owner; variables[nameVar] = name; variables[numberVar] = item.number
    declarations.push(`$${ownerVar}: String!, $${nameVar}: String!, $${numberVar}: Int!`)
    fields.push(`i${index}: repository(owner:$${ownerVar},name:$${nameVar}) { issue(number:$${numberVar}) { number title state stateReason url timelineItems(itemTypes:[CONNECTED_EVENT,CROSS_REFERENCED_EVENT],last:50) { nodes { ... on ConnectedEvent { subject { ... on PullRequest { number title url state merged mergedAt closingIssuesReferences(first:100) { nodes { number repository { nameWithOwner } } } commits(last:1) { nodes { commit { statusCheckRollup { state } } } } } } } ... on CrossReferencedEvent { willCloseTarget source { ... on PullRequest { number title url state merged mergedAt closingIssuesReferences(first:100) { nodes { number repository { nameWithOwner } } } commits(last:1) { nodes { commit { statusCheckRollup { state } } } } } } } } } } }`)
  })
  return { query: `query Finalize(${declarations.join(',')}) { ${fields.join(' ')} }`, variables }
}

function pullRequests(issue) {
  const prs = new Map()
  for (const event of issue?.timelineItems?.nodes || []) {
    const candidate = event?.subject || (event?.willCloseTarget ? event.source : null)
    if (!candidate?.url || !candidate?.number) continue
    const refs = candidate.closingIssuesReferences?.nodes || []
    const matches = refs.some(ref => ref.number === issue.number && ref.repository?.nameWithOwner?.toLowerCase() === issue.repository?.nameWithOwner?.toLowerCase())
    const old = prs.get(candidate.url)
    prs.set(candidate.url, { ...candidate, closes: !!matches || !!event.willCloseTarget || !!old?.closes })
  }
  return [...prs.values()]
}

export function deriveFinalizeRow(item, issue, assigned = false) {
  const refs = pullRequests(issue)
  // Prefer closing references; otherwise use connected/cross-reference PRs.
  const byPreference = list => list.sort((a,b) => Number(a.state !== 'OPEN')-Number(b.state !== 'OPEN') || String(b.mergedAt || '').localeCompare(String(a.mergedAt || '')))
  const selected = byPreference(refs.filter(pr => pr.closes))[0] || byPreference(refs.slice())[0]
  let state
  if (selected?.merged || selected?.state === 'MERGED') state = STATES.merged
  else if (issue?.state === 'CLOSED') state = STATES.closed
  else if (selected) state = ['FAILURE','ERROR'].includes(String(selected.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || '').toUpperCase()) ? STATES.failing : STATES.pr
  else state = assigned ? STATES.working : STATES.open
  return { ...item, title: issue?.title || item.title || `#${item.number}`, url: issue?.url || `https://github.com/${item.repo}/issues/${item.number}`, state, prs: refs, pr: selected || null }
}

export function decodeFinalizeResponse(payload, items, assignments = {}) {
  if (payload?.errors?.length) throw new Error(payload.errors.map(e => e.message).join('; '))
  return items.map((item, index) => {
    const issue = payload?.data?.[`i${index}`]?.issue
    if (!issue) throw new Error(`Issue ${item.repo}#${item.number} is missing from GraphQL response`)
    issue.repository = { nameWithOwner: item.repo }
    return deriveFinalizeRow(item, issue, !!assignments[`issue:${item.repo.toLowerCase()}#${item.number}`])
  })
}

export function finalizeMarkdown(rows) {
  const cell = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
  return ['| Issue | Zustand | PR |', '| --- | --- | --- |', ...rows.map(row => `| [${cell(row.repo)}#${row.number}](${row.url}) ${cell(row.title)} | ${cell(row.state)} | ${row.pr ? `[ #${row.pr.number} ](${row.pr.url})` : '–'} |`)].join('\n')
}

export function finalizePollInterval(rows) {
  return Array.isArray(rows) && rows.length && rows.every(row => ![STATES.open, STATES.working, STATES.failing].includes(row.state)) ? false : 30_000
}
export { STATES as FINALIZE_STATES }
