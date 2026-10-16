/** Numeric/metadata-only Goal accounting. No transcript parsing or snapshot addition. */
export const METRICS_KEY = 'goalUsageMetricsV1'
export const PRICES_KEY = 'goalUsagePricesV1'
export const TOKEN_KEYS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']
const text = value => typeof value === 'string' && value.length <= 256 && !/[\r\n\x00-\x1f]/.test(value) ? value : ''
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
const count = value => Number.isSafeInteger(value) && value > 0 ? value : null
const time = value => positive(value) !== null && Number.isFinite(new Date(value * 1000).getTime()) ? value : null
export const metricsId = (connection, profile, session) => JSON.stringify([connection, profile, session])

export function metricFromReceipt(receipt, kind, connection = 'local', ownerProfile = receipt?.plan?.profile) {
  if (!text(receipt?.stored_session_id) || !text(receipt?.session_id) || !text(receipt.plan?.profile)) return null
  const info = receipt.modelReadback || {}
  const items = (Array.isArray(receipt.plan.items) ? receipt.plan.items : []).filter(i => i && /^[\w.-]+\/[\w.-]+$/.test(i.repo) && Number.isSafeInteger(i.number) && i.number > 0).map(i => ({ repo: i.repo.toLowerCase(), number: i.number }))
  return {
    id: metricsId(connection, receipt.plan.profile, receipt.stored_session_id), connection: text(connection),
    profile: text(receipt.plan.profile), ownerProfile: text(ownerProfile), session: text(receipt.stored_session_id), runtime: text(receipt.session_id),
    kind: ['issue', 'pr', 'fix'].includes(kind) ? kind : 'issue', items,
    model: text(info.model), provider: text(info.provider),
    reasoning: typeof info.reasoning_effort === 'string' ? text(info.reasoning_effort) : null,
    fast: typeof info.fast === 'boolean' ? info.fast : null,
    handoff: text(receipt.stage), status: 'unknown', startedAt: null, endedAt: null, observedAt: null,
    tokens: Object.fromEntries(TOKEN_KEYS.map(k => [k, null])), cost: null, modelChanged: false,
  }
}

/** All-zero and absent fields are indistinguishable from backend normalization.
 * Never promote either to provider-reported usage. A positive counter is usable;
 * a missing/zero bucket stays unknown even when another bucket is positive. */
export function usageSnapshot(payload) {
  const u = payload?.usage && typeof payload.usage === 'object' ? payload.usage : payload || {}
  const pick = (...keys) => { for (const key of keys) { const n = count(u[key]); if (n !== null) return n } return null }
  return {
    input: pick('input', 'input_tokens'), output: pick('output', 'output_tokens'),
    reasoning: pick('reasoning', 'reasoning_tokens'), cacheRead: pick('cache_read', 'cache_read_tokens'),
    cacheWrite: pick('cache_write', 'cache_write_tokens'),
  }
}

export function hermesCost(payload) {
  const u = payload?.usage && typeof payload.usage === 'object' ? payload.usage : payload || {}
  for (const [field, fallback] of [['actual_cost_usd', 'actual'], ['cost_usd', 'unknown'], ['estimated_cost_usd', 'estimated']]) {
    const amount = u[field], status = ['actual', 'estimated', 'included', 'unknown'].includes(u.cost_status) ? u.cost_status : fallback
    if (positive(amount) !== null || amount === 0 && ['actual', 'included'].includes(u.cost_status)) return { amount, status, source: 'hermes' }
  }
  return null
}

export function updateMetric(record, { usage, control, info, now = Date.now() / 1000 } = {}) {
  if (record.endedAt !== null) return record // terminal snapshots cannot absorb later chat usage
  const next = { ...record, tokens: { ...record.tokens } }
  const identity = info || usage?.usage || usage || {}
  if (text(identity.model)) {
    next.modelChanged ||= !!next.model && next.model !== identity.model
    next.model = identity.model
  }
  if (text(identity.provider)) next.provider = identity.provider
  if (typeof identity.reasoning_effort === 'string') next.reasoning = text(identity.reasoning_effort)
  if (typeof identity.fast === 'boolean') next.fast = identity.fast
  if (usage !== undefined) {
    const snapshot = usageSnapshot(usage)
    // Counters are cumulative. Replace (do not sum or max); a reset must not leave
    // old usage masquerading as the new runtime's counters. But an empty/null
    // snapshot carries no new observation and must not erase recorded totals.
    const rawUsage = usage?.usage && typeof usage.usage === 'object' ? usage.usage : usage
    const hasTokenObservation = TOKEN_KEYS.some(key => snapshot[key] !== null) ||
      ['input', 'input_tokens', 'output', 'output_tokens', 'reasoning', 'reasoning_tokens', 'cache_read', 'cache_read_tokens', 'cache_write', 'cache_write_tokens'].some(key => typeof rawUsage?.[key] === 'number')
    const reportedCost = hermesCost(usage)
    if (hasTokenObservation || reportedCost) {
      next.tokens = snapshot
      next.cost = reportedCost
      next.observedAt = time(now)
    }
  }
  const goal = control?.control?.goal ?? control?.goal
  if (goal) {
    if (time(goal.created_at)) next.startedAt = goal.created_at
    if (['active', 'paused', 'done'].includes(goal.status)) next.status = goal.status
    if (goal.status === 'done') next.endedAt = time(now) // observed, NOT a native completion timestamp
  }
  return next
}

/** Closed serialization boundary: unexpected fields (prompts, replies, errors,
 * contracts, titles, raw payloads) never enter metrics storage or CSV. */
export function restoreMetrics(value) {
  if (!Array.isArray(value)) return []
  const records = new Map()
  for (const row of value) {
    if (!row || !text(row.session) || !text(row.profile) || !text(row.connection)) continue
    const base = metricFromReceipt({ stored_session_id: row.session, session_id: text(row.runtime) || row.session, plan: { profile: row.profile, items: row.items }, stage: row.handoff, modelReadback: { model: row.model, provider: row.provider, reasoning_effort: row.reasoning, fast: row.fast } }, row.kind, row.connection, row.ownerProfile || row.profile)
    base.status = ['active', 'paused', 'done'].includes(row.status) ? row.status : 'unknown'
    base.startedAt = time(row.startedAt); base.endedAt = base.status === 'done' ? time(row.endedAt) : null
    base.observedAt = time(row.observedAt); base.modelChanged = row.modelChanged === true
    base.tokens = Object.fromEntries(TOKEN_KEYS.map(k => [k, count(row.tokens?.[k])]))
    base.cost = row.cost?.source === 'hermes' ? hermesCost({ cost_usd: row.cost.amount, cost_status: row.cost.status }) : null
    records.set(base.id, base)
  }
  return [...records.values()]
}

export function validatePrices(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.rows)) throw new Error('Preistabelle benötigt version: 1 und rows.')
  const seen = new Set()
  const rows = value.rows.map(row => {
    if (!row || row.provider !== undefined && row.provider !== '' && !text(row.provider)) throw new Error('Provider muss eine gültige Zeichenfolge oder leer sein.')
    if (!text(row.model) || !row.model || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date) throw new Error('Modell und gültiges Preisdatum (YYYY-MM-DD) angeben.')
    const provider = text(row.provider) || ''
    const key = JSON.stringify([provider, row.model])
    if (seen.has(key)) throw new Error('Doppelter Modell-/Provider-Preis.')
    seen.add(key)
    const rates = {}
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (row[key] === null || row[key] === undefined) rates[key] = null
      else if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0) throw new Error('Preise müssen nichtnegative Zahlen oder null sein (USD pro Million Tokens).')
      else rates[key] = row[key]
    }
    return { provider, model: row.model, date: row.date, ...rates }
  })
  return { version: 1, rows }
}
export function restorePrices(value) { try { return validatePrices(value) } catch { return { version: 1, rows: [] } } }

export function metricCost(record, table) {
  if (record.cost) return { ...record.cost, partial: false }
  if (record.tokens.input === null || record.tokens.output === null || record.modelChanged) return { amount: null, label: 'nicht verfügbar', partial: false }
  const row = table.rows.find(r => r.model === record.model && r.provider === record.provider) || table.rows.find(r => r.model === record.model && r.provider === '')
  if (!row) return { amount: null, label: 'kein Preis hinterlegt', partial: false }
  let amount = 0, partial = false
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    const tokens = record.tokens[key]
    if (tokens === null) { partial = true; continue }
    if (row[key] === null) return { amount: null, label: 'kein Preis hinterlegt', partial: false }
    amount += tokens * row[key]
  }
  amount /= 1_000_000
  return Number.isFinite(amount) ? { amount, status: 'estimated', source: 'table', date: row.date, partial } : { amount: null, label: 'nicht verfügbar', partial: false }
}
export function metricDuration(record, now = Date.now() / 1000) {
  if (!record.startedAt) return null
  const end = record.endedAt ?? now
  return end >= record.startedAt ? end - record.startedAt : null
}
export function filterMetrics(records, { profile = '', model = '' } = {}) {
  return records.filter(r => (!profile || r.profile === profile) && (!model || r.model === model)).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}
function periodKey(epoch, period) {
  const d = new Date(epoch * 1000)
  if (period === 'month') return d.toISOString().slice(0, 7)
  if (period === 'week') { const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1) }
  return d.toISOString().slice(0, 10)
}
/** Bucket by Goal creation, UTC calendar day / Monday week / month. Unknown
 * members stay visible as missing counts, never silently become zero totals. */
export function aggregateMetrics(records, period, table, filters = {}, now = Date.now() / 1000) {
  if (!['day', 'week', 'month'].includes(period)) throw new Error('Ungültiger Zeitraum')
  const groups = new Map()
  for (const row of filterMetrics(records, filters)) {
    const key = row.startedAt ? periodKey(row.startedAt, period) : 'Start nicht verfügbar'
    if (!groups.has(key)) groups.set(key, { key, goals: 0, duration: null, durationMissing: 0, tokens: Object.fromEntries(TOKEN_KEYS.map(k => [k, null])), missing: Object.fromEntries(TOKEN_KEYS.map(k => [k, 0])), cost: null, costMissing: 0, costPartial: 0, estimated: false })
    const g = groups.get(key); g.goals++
    const duration = metricDuration(row, now)
    if (duration === null) g.durationMissing++; else g.duration = (g.duration ?? 0) + duration
    for (const k of TOKEN_KEYS) { if (row.tokens[k] === null) g.missing[k]++; else g.tokens[k] = (g.tokens[k] ?? 0) + row.tokens[k] }
    const cost = metricCost(row, table)
    if (cost.amount === null) g.costMissing++; else { g.cost = (g.cost ?? 0) + cost.amount; g.estimated ||= cost.status === 'estimated' || cost.source === 'table'; if (cost.partial) g.costPartial++ }
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
}
const cell = value => {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // spreadsheet formula injection
  return `"${s.replaceAll('"', '""')}"`
}
export function metricsCsv(records, table, filters = {}, now = Date.now() / 1000) {
  const columns = ['connection', 'profile', 'session', 'kind', 'items', 'model', 'provider', 'reasoning', 'fast', 'status', 'start_epoch', 'end_observed_epoch', 'duration_seconds', 'usage_observed_epoch', ...TOKEN_KEYS, 'cost_usd', 'cost_status', 'cost_source', 'cost_partial', 'price_date']
  return [columns, ...filterMetrics(records, filters).map(r => {
    const c = metricCost(r, table)
    return [r.connection, r.profile, r.session, r.kind, r.items.map(i => `${i.repo}#${i.number}`).join('; '), r.model, r.provider, r.reasoning, r.fast, r.status, r.startedAt, r.endedAt, metricDuration(r, now), r.observedAt, ...TOKEN_KEYS.map(k => r.tokens[k]), c.amount, c.status || c.label, c.source, c.partial, c.date]
  })].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
