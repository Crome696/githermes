import { atom, useValue, Button } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { aggregateMetrics, filterMetrics, metricCost, metricDuration, metricsCsv, validatePrices } from './goal_metrics.js'

export const $goalMetrics = atom({ records: [], prices: { version: 1, rows: [] }, error: '' })
export const $showGoalMetrics = atom(false)
let controller = null
export function setMetricsController(value) { controller = value }
const number = value => value === null || value === undefined ? 'nicht verfügbar' : value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const timestamp = value => value ? new Date(value * 1000).toLocaleString('de-DE') : 'nicht verfügbar'
const seconds = value => value === null ? 'nicht verfügbar' : `${number(value)} s`
export function costText(cost) {
  if (cost.amount === null) return cost.label || 'nicht verfügbar'
  const origin = cost.source === 'hermes' ? `Hermes · ${cost.status === 'actual' ? 'gemeldet' : cost.status === 'included' ? 'im Abo enthalten' : cost.status === 'estimated' ? 'geschätzt' : 'Kostenstatus unbekannt'}` : `geschätzt · Preistabelle ${cost.date}`
  return `${cost.amount.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 })} USD · ${origin}${cost.partial ? ' · Teilsumme: Cache-Tokens nicht verfügbar' : ''}`
}
export function GoalMetricDetails({ record, prices, now = Date.now() / 1000 }) {
  const tokens = record.tokens
  return jsxs('div', { className: 'mt-2 text-xs break-words', 'data-goal-metrics': record.id, children: [
    jsx('p', { children: `Profil: ${record.profile} · Modell: ${record.model || 'nicht verfügbar'} · Provider: ${record.provider || 'nicht verfügbar'} · Reasoning: ${record.reasoning === '' ? 'nicht gesetzt' : record.reasoning ?? 'nicht verfügbar'} · Fast: ${record.fast === null ? 'nicht verfügbar' : record.fast ? 'An' : 'Aus'}` }),
    jsx('p', { children: `Goal: ${record.status} · Start: ${timestamp(record.startedAt)} · ${record.endedAt ? `Ende (beobachtet): ${timestamp(record.endedAt)}` : record.status === 'done' ? 'Ende: nicht verfügbar' : `läuft seit: ${timestamp(record.startedAt)}`} · Gesamtdauer${record.endedAt ? ' (bis beobachtetes Ende)' : ' (inkl. Warte-/Pausenzeit)'}: ${seconds(metricDuration(record, now))}` }),
    jsx('p', { children: `Tokens · Input: ${number(tokens.input)} · Output: ${number(tokens.output)} · Reasoning (Teilmenge): ${number(tokens.reasoning)} · Cache gelesen: ${number(tokens.cacheRead)} · Cache geschrieben: ${number(tokens.cacheWrite)}` }),
    jsx('p', { children: `Kosten: ${costText(metricCost(record, prices))}${record.modelChanged ? ' · Modellwechsel: keine Berechnung aus einer einzelnen Modellpreistabelle' : ''}` }),
    jsx('p', { children: `Letzte Usage-Erfassung: ${timestamp(record.observedAt)}${record.items.length === 1 ? ` · ${record.items[0].repo}#${record.items[0].number}: Laufzeit und Tokens dieses Einzel-Item-Goals` : ' · Pro Item nicht zuordenbar; nur Goal-Summe (keine Aufteilung anhand von Prompts oder Antworten).'}` }),
  ] })
}
export function GoalReceiptMetrics({ receipt, kind }) {
  const { records, prices, error } = useValue($goalMetrics)
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now() / 1000), 10_000); return () => clearInterval(timer) }, [])
  if (!receipt?.stored_session_id) return null
  const matches = records.filter(r => r.session === receipt.stored_session_id && r.profile === receipt.plan.profile && (!kind || r.kind === kind))
  // Never guess between equal stored ids on different connections.
  const record = matches.length === 1 ? matches[0] : null
  return jsxs('section', { 'aria-label': 'Goal-Metriken', children: [
    record ? jsx(GoalMetricDetails, { record, prices, now }) : jsx('p', { className: 'text-xs', children: 'Goal-Metriken: nicht verfügbar' }),
    error ? jsx('p', { role: 'alert', className: 'text-xs', children: error }) : null,
  ] })
}
export function downloadMetricsCsv(records, prices, filters) {
  const blob = new Blob(['\ufeff', metricsCsv(records, prices, filters)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = 'githermes-goals.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function GoalMetricsOverview({ onClose }) {
  const { records, prices, error } = useValue($goalMetrics)
  const [profile, setProfile] = useState(''), [model, setModel] = useState(''), [period, setPeriod] = useState('day')
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now() / 1000), 10_000); return () => clearInterval(timer) }, [])
  const filters = { profile, model }, rows = filterMetrics(records, filters), totals = aggregateMetrics(records, period, prices, filters, now)
  const select = (label, value, set, options) => jsxs('label', { children: [label, ' ', jsx('select', { 'aria-label': label, value, onChange: e => set(e.target.value), children: options.map(([id, name]) => jsx('option', { value: id, children: name }, id)) })] })
  return jsxs('section', { 'aria-label': 'Goal-Verbrauchsübersicht', className: 'p-3 overflow-auto', children: [
    jsx('h3', { children: 'Goal-Verbrauch · lokal gespeichert' }),
    jsx('p', { className: 'text-xs', children: 'Kumulative Session-Zähler, keine Addition von Snapshots. Null ohne Reporting-Nachweis bleibt nicht verfügbar. Ende ist der beobachtete done-Status, nicht die Handoff-Bestätigung. Zeiträume: UTC, Woche ab Montag; Zuordnung nach Goal-Start. Summen umfassen auch laufende Goals und Warte-/Pausenzeit.' }),
    jsxs('div', { className: 'flex flex-wrap gap-2 mt-2', children: [
      select('Profilfilter', profile, setProfile, [['', 'Alle Profile'], ...[...new Set(records.map(r => r.profile))].sort().map(v => [v, v])]),
      select('Modellfilter', model, setModel, [['', 'Alle Modelle'], ...[...new Set(records.map(r => r.model).filter(Boolean))].sort().map(v => [v, v])]),
      select('Zeitraum', period, setPeriod, [['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat']]),
      jsx(Button, { size: 'sm', onClick: () => downloadMetricsCsv(records, prices, filters), children: 'CSV exportieren' }),
      jsx(Button, { size: 'sm', onClick: () => controller?.refresh(), children: 'Metriken aktualisieren' }),
      onClose ? jsx(Button, { size: 'sm', onClick: onClose, children: 'Übersicht schließen' }) : null,
    ] }),
    error ? jsx('p', { role: 'alert', children: error }) : null,
    ...totals.map(g => jsxs('div', { className: 'mt-3 text-xs', 'data-metric-period': g.key, children: [
      jsx('h4', { children: `${g.key} · ${g.goals} Goals` }),
      jsx('p', { children: `Laufzeit: ${seconds(g.duration)} (${g.durationMissing} nicht verfügbar)` }),
      jsx('p', { children: `Input: ${number(g.tokens.input)} (${g.missing.input} fehlen) · Output: ${number(g.tokens.output)} (${g.missing.output} fehlen) · Reasoning: ${number(g.tokens.reasoning)} (${g.missing.reasoning} fehlen) · Cache gelesen: ${number(g.tokens.cacheRead)} (${g.missing.cacheRead} fehlen) · Cache geschrieben: ${number(g.tokens.cacheWrite)} (${g.missing.cacheWrite} fehlen)` }),
      jsx('p', { children: `Kosten${g.estimated ? ' (enthält geschätzte Werte)' : ''}: ${g.cost === null ? 'nicht verfügbar' : `${g.cost.toFixed(8)} USD`} · ${g.costMissing} Goals ohne Kosten · ${g.costPartial} Cache-Teilsummen` }),
    ] }, g.key)),
    !rows.length ? jsx('p', { children: 'Noch keine Goals für diesen Filter erfasst.' }) : null,
    jsx('h4', { className: 'mt-3', children: 'Letzte Goals (neuester Start zuerst)' }),
    ...rows.map(r => jsxs('article', { className: 'mt-3 border-t', children: [jsx('h5', { children: `${r.kind} · ${r.connection} · ${r.session} · ${r.items.map(i => `${i.repo}#${i.number}`).join(', ')}` }), jsx(GoalMetricDetails, { record: r, prices, now })] }, r.id)),
  ] })
}
export function GoalMetricsSettings() {
  const { prices } = useValue($goalMetrics)
  const [draft, setDraft] = useState(() => JSON.stringify(prices, null, 2)), [message, setMessage] = useState('')
  return jsxs('section', { 'aria-label': 'GitHermes Preistabelle', className: 'p-3', children: [
    jsx('h3', { children: 'GitHermes · Goal-Kosten' }),
    jsx('p', { children: 'USD pro Million Tokens. Keine Preise vorgegeben. provider kann leer sein (alle Provider dieses Modells). input, output, cacheRead und cacheWrite sind Zahlen oder null (kein Preis). Datum pro Modell: YYYY-MM-DD. Hermes-Kosten haben Vorrang; Tabellenwerte sind geschätzt. Fehlende Cache-Zähler ergeben nur eine ausdrücklich markierte Teilsumme, keine erfundenen Cache-Kosten.' }),
    jsx('p', { children: 'Zeilenformat: {"provider":"", "model":"Modell-ID", "date":"YYYY-MM-DD", "input":null, "output":null, "cacheRead":null, "cacheWrite":null}' }),
    ...prices.rows.map(r => jsx('p', { children: `${r.provider || 'Alle Provider'} · ${r.model} · Preisstand: ${r.date}` }, JSON.stringify([r.provider, r.model]))),
    jsx('textarea', { 'aria-label': 'Preistabelle JSON', rows: 14, style: { width: '100%' }, value: draft, onChange: e => setDraft(e.target.value) }),
    jsx(Button, { onClick: () => { try { const value = validatePrices(JSON.parse(draft)); if (!controller) throw new Error('Metrik-Speicher nicht bereit.'); controller.setPrices(value); setDraft(JSON.stringify(value, null, 2)); setMessage('Preistabelle gespeichert.') } catch (e) { setMessage(e.message) } }, children: 'Preistabelle speichern' }),
    message ? jsx('p', { role: 'status', children: message }) : null,
  ] })
}
