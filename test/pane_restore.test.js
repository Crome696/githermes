import test from 'node:test'
import assert from 'node:assert/strict'

// Behavioural contract adapter: not an actual Desktop layout/drag test.
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
}
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }

const { host } = await import('@hermes/plugin-sdk')
const opened = [], options = [], contributions = [], revealed = []
host.openWorkspace = (key, opts) => {
  opened.push(key)
  options.push(opts)
  return () => opts.onClose?.()
}
host.paneVisibility = () => ({ get: () => false, listen: () => () => {}, subscribe: () => () => {} })
host.undismissPane = () => {}
host.revealPane = id => revealed.push(id)
const { default: plugin } = await import('../desktop/plugin.js')

function load() {
  const disposers = []
  plugin.register({
    register: contribution => { contributions.push(contribution); return () => {} },
    onDispose: fn => disposers.push(fn),
    rest: async () => ({}),
    os: { openExternal() {} },
    storage: { get: (_key, fallback) => fallback, set() {} },
  })
  return () => disposers.splice(0).forEach(fn => fn())
}

function withLoad(fn) {
  for (const array of [opened, options, contributions, revealed]) array.length = 0
  const unload = load()
  try { fn(unload) } finally { unload() }
}

test('fresh install: loading the plugin does not force the pane open', () => {
  store.clear()
  withLoad(() => assert.equal(opened.length, 0))
})

test('pane left open survives a reload; unload is not a user close', () => {
  store.set('githermes.paneOpen.v1', '1')
  withLoad(() => assert.equal(opened.length, 1, 'restores the pane the user left open'))
  assert.equal(store.get('githermes.paneOpen.v1'), '1', 'unload retains the user choice')
  withLoad(() => assert.equal(opened.length, 1))
})

test('pane the user closed stays closed across a reload', () => {
  store.set('githermes.paneOpen.v1', '0')
  withLoad(() => assert.equal(opened.length, 0))
})

test('SDK workspace opening retains the right dock and re-fronts without duplicating', () => {
  store.clear()
  withLoad(() => {
    const open = contributions.find(c => c.id === 'palette').data.run
    open()
    assert.deepEqual(opened, ['github'])
    assert.deepEqual(options[0].dock, { pane: 'workspace', pos: 'right' })
    assert.equal(options[0].minWidth, '320px')
    assert.equal(options[0].title, 'GitHub')
    assert.equal(typeof options[0].render, 'function')
    assert.equal(options[0].render().props.className.includes('githermes-pane'), true)
    open()
    assert.deepEqual(opened, ['github'])
    assert.deepEqual(revealed, ['plugin-workspace:github'])
    assert.equal(store.get('githermes.paneOpen.v1'), '1')
    options[0].onClose()
    assert.equal(store.get('githermes.paneOpen.v1'), '0')
  })
})
