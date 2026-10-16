import { METRICS_KEY, PRICES_KEY, metricFromReceipt, restoreMetrics, restorePrices, updateMetric } from './goal_metrics.js'

const controllers = new WeakMap()
/** Telemetry must never replay or fail an accepted native Goal handoff. */
export function noteGoalReceipt(storage, receipt, kind, api, owner = {}) {
  const controller = controllers.get(storage)
  if (controller) controller.track(receipt, kind, owner)
  else {
    try {
      const row = metricFromReceipt(receipt, kind, owner.connection || api?.state?.connectionId?.get?.() || 'local', owner.profile || api?.state?.profile?.get?.() || receipt.plan.profile)
      if (!row) return
      const records = restoreMetrics(storage.get(METRICS_KEY, []))
      const old = records.find(r => r.id === row.id)
      storage.set(METRICS_KEY, restoreMetrics([...records.filter(r => r.id !== row.id), old ? { ...old, handoff: row.handoff, runtime: row.runtime } : row]))
    } catch { /* registration's controller surfaces storage failures in the UI */ }
  }
}

export function createMetricsController(api, storage, { onChange = () => {}, interval = 10_000, now = () => Date.now() / 1000, schedule = setInterval, cancel = clearInterval } = {}) {
  let records = restoreMetrics(storage.get(METRICS_KEY, [])), prices = restorePrices(storage.get(PRICES_KEY, null))
  let disposed = false, inflight = null, failed = false
  const leases = new Map(), captured = new Map(), watchers = new Map()
  const emit = () => { if (!disposed) onChange({ records, prices, error: failed ? 'Metriken konnten nicht vollständig gelesen oder gespeichert werden; letzte Erfassung bleibt sichtbar.' : '' }) }
  const commit = next => { const clean = restoreMetrics(next); storage.set(METRICS_KEY, clean); records = clean; emit() }
  const connection = () => api.state?.connectionId?.get?.() || 'local'
  function watch(id, gateway) {
    if (watchers.get(id)?.gateway === gateway || typeof gateway?.onEvent !== 'function') return
    watchers.get(id)?.dispose()
    let sequence = -1
    const dispose = gateway.onEvent(event => {
      const row = records.find(r => r.id === id)
      if (disposed || !row || row.endedAt || event.replayed || event.session_id !== row.runtime) return
      if (!['session.usage', 'message.complete', 'session.control.update', 'session.info'].includes(event.type)) return
      if (Number.isInteger(event.seq)) { if (event.seq <= sequence) return; sequence = event.seq }
      const payload = event.payload || {}
      const update = event.type === 'session.control.update' ? { control: payload }
        : event.type === 'session.info' ? { info: payload }
          : event.type === 'message.complete' && !payload.usage ? null : { usage: payload }
      if (!update) return
      try { commit(records.map(r => r.id === id ? updateMetric(r, { ...update, now: now() }) : r)) }
      catch { failed = true; emit() }
    })
    watchers.set(id, { gateway, dispose })
  }
  async function request(record, method, params = {}) {
    const gateway = captured.get(record.id)
    if (gateway) return gateway.request(method, params)
    const route = { connectionId: record.connection, profile: record.ownerProfile }
    if (typeof api.requestProfile === 'function') {
      const key = JSON.stringify(route)
      if (!leases.has(key) && typeof api.retainProfileSocket === 'function') leases.set(key, api.retainProfileSocket(route))
      return api.requestProfile(route, method, params)
    }
    // Old SDKs: only the captured owning gateway, never the newly focused tab.
    let fallback
    if (connection() === record.connection && (api.state?.profile?.get?.() || 'default') === record.ownerProfile) {
      fallback = api.getGateway?.() || api
      if (fallback !== api) { captured.set(record.id, fallback); watch(record.id, fallback) }
    }
    if (!fallback) throw new Error('Owning gateway unavailable')
    return fallback.request(method, params)
  }
  const controller = {
    get records() { return records },
    get prices() { return prices },
    setPrices(value) { storage.set(PRICES_KEY, value); prices = restorePrices(value); emit() },
    track(receipt, kind, owner = {}) {
      if (disposed) return
      try {
        const row = metricFromReceipt(receipt, kind, owner.connection || connection(), owner.profile || api.state?.profile?.get?.() || receipt.plan.profile)
        if (!row) return
        const old = records.find(r => r.id === row.id)
        const next = old ? { ...old, runtime: row.runtime, handoff: row.handoff,
          model: old.model || row.model, provider: old.provider || row.provider,
          reasoning: old.reasoning ?? row.reasoning, fast: old.fast ?? row.fast } : row
        // Capturing at handoff prevents a later focus change from redirecting reads.
        const gateway = owner.gateway || api.getGateway?.()
        commit([...records.filter(r => r.id !== row.id), next])
        if (gateway) { captured.set(row.id, gateway); watch(row.id, gateway) }
      } catch { failed = true; emit() }
    },
    refresh() {
      if (disposed) return Promise.resolve()
      if (inflight) return inflight
      inflight = (async () => {
        failed = false
        // Sequential, bounded reads: no overlap between ticks or manual refreshes.
        for (const initial of records.filter(r => !r.endedAt)) {
          if (disposed) break
          try {
            const active = await request(initial, 'session.active_list')
            // Stored timestamp IDs can collide across profiles in one gateway.
            // Require both IDs; never follow a same-key foreign runtime.
            const live = active?.sessions?.find(s => s.session_key === initial.session && s.id === initial.runtime)
            if (!live) { failed = true; continue } // don't resume/create sessions for accounting
            const params = { session_id: live.id }
            let control, usage
            // Independent availability: a host without usage must still show runtime;
            // a host without structured control may still report token counters.
            try { control = await request(initial, 'session.control.read', params) } catch { failed = true }
            // Read AFTER control so done's final cumulative counters are available.
            try { usage = await request(initial, 'session.usage', params) } catch { failed = true }
            if (disposed) break
            const current = records.find(r => r.id === initial.id)
            const updated = updateMetric({ ...current, runtime: live.id }, { usage, control, now: now() })
            commit(records.map(r => r.id === initial.id ? updated : r))
          } catch { failed = true }
        }
        const activeRoutes = new Set(records.filter(r => !r.endedAt).map(r => JSON.stringify({ connectionId: r.connection, profile: r.ownerProfile })))
        for (const [key, release] of leases) if (!activeRoutes.has(key)) { release(); leases.delete(key) }
        emit()
      })().finally(() => { inflight = null })
      return inflight
    },
    dispose() {
      disposed = true; cancel(timer)
      for (const release of leases.values()) release()
      for (const watcher of watchers.values()) watcher.dispose()
      leases.clear(); captured.clear(); watchers.clear()
      if (controllers.get(storage) === controller) controllers.delete(storage)
    },
  }
  const timer = schedule(() => { void controller.refresh() }, interval)
  timer?.unref?.() // Node contract tests must not be held open by telemetry.
  controllers.set(storage, controller)
  emit()
  return controller
}
