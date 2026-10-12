#!/usr/bin/env node
/**
 * Bootstrap minimal module stubs so `npm test` works on a fresh clone.
 *
 * The desktop runtime loads this plugin from a blob URL and rewrites the
 * `@hermes/plugin-sdk` / `react` specifiers to its own in-app shims. Node's
 * test runner has no such rewrite, so we give the imports somewhere to resolve
 * to. These stubs live in repo-local node_modules (gitignored) and are never
 * seen by the desktop loader — they exist purely for `node --test`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = {
  'node_modules/@hermes/plugin-sdk/package.json': {
    name: '@hermes/plugin-sdk',
    type: 'module',
    main: './index.js',
  },
  'node_modules/@hermes/plugin-sdk/index.js': `// v0.21.7 contract adapter; NOT a renderer or gateway implementation.
export const atom = (initial) => {
  let value = initial
  const listeners = new Set()
  const store = {
    get: () => value,
    set: next => { const previous = value; if (Object.is(next, value)) return; value = next; listeners.forEach(fn => fn(value, previous)) },
    listen: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    subscribe: fn => { const stop = store.listen(fn); fn(value); return stop },
  }
  return store
}
export const host = {
  state: { activeSessionId: atom(null), cwd: atom(''), profile: atom('default'), gateway: atom('idle') },
  request: async () => { throw new Error('SDK test adapter: configure host.request explicitly') },
}
export const useValue = store => store.get()
export const useQuery = () => ({ isLoading: false, isError: false, data: null })
export const useMutation = () => ({ mutate: () => {}, isPending: false, error: null })
export const queryClient = { invalidateQueries: () => Promise.resolve() }
export const Button = () => null
export const Input = () => null
export const Textarea = () => null
export const Badge = () => null
export const CopyButton = () => null
export const StatusDot = () => null
export const ScrollArea = () => null
export const EmptyState = () => null
export const ErrorState = () => null
export const GlyphSpinner = () => null
export const Skeleton = () => null
export const SearchField = () => null
export const SegmentedControl = () => null
export const Separator = () => null
export const Tabs = () => null
export const TabsList = () => null
export const TabsTrigger = () => null
export const Select = () => null
export const SelectContent = () => null
export const SelectItem = () => null
export const SelectTrigger = () => null
export const SelectValue = () => null
export const Popover = () => null
export const PopoverTrigger = () => null
export const PopoverContent = () => null
export const Codicon = () => null
export const icons = {}
export const cn = (...args) => args.filter(Boolean).join(' ')
export const relativeTime = () => ''
export const PALETTE_AREA = 'palette'
export const TITLEBAR_AREAS = { left: 'titleBar.left', center: 'titleBar.center', right: 'titleBar.right' }
export const PANES_AREA = 'panes'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const Tip = () => null
`,
  'node_modules/react/package.json': {
    name: 'react',
    type: 'module',
    main: './index.js',
    exports: {
      '.': './index.js',
      './jsx-runtime': './jsx-runtime.js',
    },
  },
  'node_modules/react/index.js': `export const useState = (init) => [typeof init === 'function' ? init() : init, () => {}]
export const useEffect = () => {}
export const useMemo = (fn) => fn()
export const useRef = (init) => ({ current: init })
export default { useState, useEffect, useMemo, useRef }
`,
  'node_modules/react/jsx-runtime.js': `export const jsx = (type, props, key) => ({ type, props, key })
export const jsxs = (type, props, key) => ({ type, props, key })
export const Fragment = Symbol.for('react.fragment')
`,
}

for (const [rel, content] of Object.entries(files)) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n')
}
console.log('stubs OK')
