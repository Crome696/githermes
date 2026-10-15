const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/
const PATH_ROOTS = new Set(['src', 'test', 'tests', 'lib', 'desktop', 'scripts', 'docs', 'assets', 'dist', 'build', 'packages', 'apps', 'components', 'node_modules'])
const NON_REPO_PAIRS = new Set(['and/or', 'tcp/ip', 'i/o', 'km/h'])

function isRepoMention(owner, repo, text, start) {
  const before = text[start - 1] || ''
  const end = start + owner.length + 1 + repo.length
  const after = text[end] || ''
  if (before === '/' || before === '.' || after === '/') return false
  if (PATH_ROOTS.has(owner.toLowerCase())) return false
  if (NON_REPO_PAIRS.has(`${owner}/${repo}`.toLowerCase())) return false
  if (/^\d+$/.test(owner) && /^\d+$/.test(repo)) return false
  return true
}

export function resolveIssueDraftRepo({ sessionRepo, chatRepo } = {}) {
  for (const value of [sessionRepo, chatRepo]) {
    const repo = String(value || '').trim()
    if (REPO.test(repo)) return repo
  }
  return ''
}

export function issueDraftRepoFromText(text) {
  const value = String(text || '')
  const url = value.match(/https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?=\/|[?#\s.,;!)]|$)/i)
  if (url) return `${url[1]}/${url[2].replace(/\.git$/i, '')}`
  const literal = value.trim().match(/^(?:repository\s*:\s*)?([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)[.,;!]?$/i)
  if (!literal) return ''
  const owner = literal[1]
  const repo = literal[2]
  if (PATH_ROOTS.has(owner.toLowerCase()) || NON_REPO_PAIRS.has(`${owner}/${repo}`.toLowerCase())) return ''
  return `${owner}/${repo}`
}

export function issueDraftRepoFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  for (const message of messages.slice().reverse()) {
    const text = messageText(message)
    if (!text) continue
    const candidates = new Set()
    const urlPattern = /https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?=\/|[?#\s.,;!)]|$)/gi
    for (const match of text.matchAll(urlPattern)) candidates.add(`${match[1]}/${match[2].replace(/\.git$/i, '').replace(/[.,;!]+$/, '')}`)
    const withoutUrls = text.replace(/https?:\/\/github\.com\/[^\s]*/gi, ' ')
    const literalPattern = /(?<![A-Za-z0-9_./-])([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?)(?![A-Za-z0-9_./-])/g
    for (const match of withoutUrls.matchAll(literalPattern)) {
      const owner = match[1]
      const repo = match[2]
      if (!isRepoMention(owner, repo, withoutUrls, match.index)) continue
      candidates.add(`${owner}/${repo}`)
    }
    if (candidates.size) return candidates.size === 1 ? [...candidates][0] : ''
  }
  return ''
}

export function redactIssueSecrets(value) {
  if (Array.isArray(value)) return value.map(redactIssueSecrets)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactIssueSecrets(item)]))
  if (typeof value !== 'string') return value
  return value
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/(?:sk[-_]|gh[pousr]_|github_pat_|npm_|pypi-|xox[baprs]-|xapp-\d+-|AIza|pplx-|fal_|fc-|bb_live_|gAAAA|[sr]k_live_|sk_test_|SG\.|hf_|r8_|do[po]_v1_|am_(?:org_)?|tvly-|exa_|gsk_|syt_|retaindb_|hsk-|mem0_|brv_|xai-|ntn_|fw[-_]|fpk-|gl(?:pat|oas|dt|rt|rtr|cbt|ptt|ft|imt|agent|soat|ffct|wt)-)[A-Za-z0-9_.=+/-]{10,}/gi, '[REDACTED]')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|client_secret|password|auth|jwt|session|secret|key|code|signature|x-amz-signature|x-goog-signature|sig)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic|digest)\s+[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(["']?[\w.-]*(?:api.?key|token|secret|password|passwd|credential|auth|bearer|private.?key|key.material)[\w.-]*["']?\s*[:=]\s*)(["'])([\s\S]*?)\2/gi, (all, prefix, quote, secret) => secret.startsWith('[REDACTED') ? all : `${prefix}${quote}[REDACTED]${quote}`)
    .replace(/(\b[\w.-]*(?:api.?key|token|secret|password|passwd|credential|auth|bearer|private.?key|key.material)[\w.-]*\s*[:=]\s*)(?!["']?\[REDACTED)([^\s,;&}\]]+)/gi, '$1[REDACTED]')
    .replace(/(--(?:password|token|api-key|secret)\s+)[^\s]+/gi, '$1[REDACTED]')
}

export function buildIssueDraftBody({ goal = '', context = '', implementation = '', acceptance = [], references = [] } = {}) {
  const bullets = values => values.map(value => String(value || '').trim()).filter(Boolean).map(value => `- [ ] ${value}`).join('\n') || '- [ ] Define acceptance criteria'
  return [
    '## Goal', String(goal).trim() || 'Describe the desired outcome.',
    '## Context', String(context).trim() || 'Add relevant session context.',
    '## Implementation', String(implementation).trim() || 'Describe the proposed implementation.',
    '## Acceptance criteria', bullets(acceptance),
    '## References', references.map(value => String(value || '').trim()).filter(Boolean).join('\n') || 'Add relevant session, PR, or issue links.',
  ].join('\n\n')
}

export function issueDraftTitle(candidate = '') {
  const firstLine = String(candidate || '').split(/\r?\n/).find(line => line.trim()) || ''
  return redactIssueSecrets(firstLine.replace(/^\s*(?:[-*]\s*)?/, '').trim()).slice(0, 120) || 'Session issue draft'
}

export function duplicateSearchQuery(title, body) {
  const boilerplate = /^(?:describe the desired outcome\.?|add relevant session context\.?|describe the proposed implementation\.?|define acceptance criteria\.?|add relevant session, pr, or issue links\.?)$/i
  const content = String(body || '').split(/\r?\n/)
    .filter(line => !/^\s*#{1,6}\s+/.test(line))
    .map(line => line.replace(/^\s*-\s*\[\s*\]\s*/, '').trim())
    .filter(line => line && !boilerplate.test(line))
  const parts = [String(title || '').trim().slice(0, 90), ...content]
  const seen = new Set()
  const terms = parts.map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => {
      const key = part.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).join(' ').slice(0, 180)
  return `is:issue is:open in:title,body ${terms}`
}

function messageText(message) {
  return typeof message?.content === 'string' ? message.content
    : Array.isArray(message?.content) ? message.content.map(part => typeof part === 'string' ? part : part?.text || '').join('\n')
      : typeof message?.text === 'string' ? message.text : ''
}

export function parseIssueDraftResponse(messages) {
  if (!Array.isArray(messages)) return null
  const requestIndex = messages.findLastIndex(message =>
    ['user', 'human'].includes(String(message?.role || message?.author || '').toLowerCase()) && /draft (?:a github )?issue/i.test(messageText(message)))
  for (const message of messages.slice(Math.max(0, requestIndex + 1)).slice(-20).reverse()) {
    if (!['assistant', 'bot', 'model'].includes(String(message?.role || message?.author || '').toLowerCase())) continue
    const text = redactIssueSecrets(messageText(message)).trim()
    const match = text.match(/(?:^|\n)\s*(?:\*\*)?Title(?:\*\*)?\s*:\s*(.+?)\s*(?:\n+|$)(?:\s*(?:\*\*)?Body(?:\*\*)?\s*:\s*\n?)([\s\S]+)$/i)
    if (match && match[1].trim() && match[2].trim()) return { title: match[1].trim(), body: match[2].trim() }
  }
  return null
}

export function issueDraftFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  return messages.slice(-30).map(messageText).filter(Boolean).join('\n')
}

export function detectIssueDraftCandidate(messages) {
  if (!Array.isArray(messages)) return null
  for (const message of messages.slice(-30).reverse()) {
    const text = typeof message?.content === 'string' ? message.content
      : Array.isArray(message?.content) ? message.content.map(part => typeof part === 'string' ? part : part?.text || '').join('\n')
        : typeof message?.text === 'string' ? message.text : ''
    const match = /\b(?:track this as an issue|turn this into an issue|create an issue for this|file an issue for this|follow[- ]up issue)\b/i.exec(text)
    if (match) return redactIssueSecrets(text.slice(Math.max(0, match.index - 240), match.index + match[0].length + 500)).trim()
  }
  return null
}

export function issueBodyDiff(before, after) {
  const oldLines = normalizeLineEndings(before).split('\n')
  const newLines = normalizeLineEndings(after).split('\n')
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++
  return [
    ...oldLines.slice(Math.max(0, prefix - 2), prefix).map(line => `  ${line}`),
    ...oldLines.slice(prefix, oldLines.length - suffix).map(line => `- ${line}`),
    ...newLines.slice(prefix, newLines.length - suffix).map(line => `+ ${line}`),
    ...oldLines.slice(oldLines.length - suffix).map(line => `  ${line}`),
  ].join('\n')
}

export function rewriteIssueBody(existing, draft) {
  const body = normalizeLineEndings(existing)
  const content = normalizeLineEndings(draft).trim()
  const start = '<!-- githermes:issue-draft:start -->'
  const end = '<!-- githermes:issue-draft:end -->'
  const startIndex = body.indexOf(start)
  const endIndex = body.indexOf(end, startIndex + start.length)
  if (startIndex >= 0 && endIndex >= 0) {
    return `${body.slice(0, startIndex + start.length)}\n${content}\n${body.slice(endIndex)}`
  }
  const section = `${start}\n${content}\n${end}`
  return body.trim() ? `${body.trimEnd()}\n\n${section}` : section
}

export function issueDraftFinalBody(selected, draftContent) {
  return rewriteIssueBody(redactIssueSecrets(selected?.body || ''), redactIssueSecrets(draftContent || ''))
}

function normalizeLineEndings(value) {
  const carriageReturn = String.fromCharCode(13)
  return String(value || '').replaceAll(`${carriageReturn}\n`, '\n').replaceAll(carriageReturn, '\n')
}

export async function confirmedIssueWrite({ action, confirmed, repo, title, body, number, originalTitle, originalBody, readIssue, createIssue, updateIssue }) {
  if (!confirmed) throw new Error('GitHub write requires explicit confirmation')
  if (!REPO.test(String(repo || '')) || !String(title || '').trim() || !String(body || '').trim()) throw new Error('Issue draft is incomplete')
  if (action === 'create') {
    const created = await createIssue(repo, title, body)
    const actual = await readIssue(repo, created.number)
    if (actual.title !== title || String(actual.body ?? '') !== body) throw new Error('Created issue did not match the submitted title and body')
    return actual
  }
  if (action === 'update') {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid issue number')
    const current = await readIssue(repo, number)
    if (current.state && String(current.state).toUpperCase() !== 'OPEN') throw new Error('Duplicate issue is no longer open; refresh the search')
    if ((originalTitle != null && current.title !== originalTitle) || String(current.body ?? '') !== String(originalBody ?? '')) throw new Error('Issue changed since review; reload and compare the new diff')
    await updateIssue(repo, number, title, body)
    const actual = await readIssue(repo, number)
    if (actual.title !== title || String(actual.body ?? '') !== body) throw new Error('Updated issue did not match the submitted title and body')
    return actual
  }
  throw new Error('Unsupported issue draft action')
}
