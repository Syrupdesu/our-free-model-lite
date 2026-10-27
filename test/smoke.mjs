/**
 * Offline smoke test for the lite build.
 *
 * It answers three questions without touching the real upstream:
 *   1. no removed feature survived in code (no EAC/vault/updater/ads/login),
 *   2. the modules load and the adapter advertises a catalog,
 *   3. the host half applies under a stub ctx and serves the settings API,
 *      including validation and the per-model test error path.
 *
 * The lanes point at a closed loopback port so every outbound call fails fast.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { Readable } from 'node:stream'

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ofmlite-'))
process.env.OUR_FREE_MODEL_BASE = 'http://127.0.0.1:1'
process.env.OUR_FREE_MODEL_KILO_BASE = 'http://127.0.0.1:1'

const root = path.dirname(new URL(import.meta.url).pathname)
const pkg = path.join(root, '..')

// ── 1. static scan ───────────────────────────────────────────────────────────
const CODE = ['index.js', 'client.js', 'cordis.patch.yml', 'package.json']
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full)
  return /\.(js|mjs|json|yml|yaml)$/.test(entry.name) ? [full] : []
})
for (const file of [...CODE.map(name => path.join(pkg, name)), ...walk(path.join(pkg, 'src')), ...walk(path.join(pkg, 'adapter'))]) {
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const banned of [
    'beichenapi', 'SPONSOR', 'github.com/login', 'oauth/authorize', 'x-ofm-user',
    "from './eac", "from './vault", "from './updater", "from './feed", "from './picks",
    'LANE_SEAL', 'announcements.json', 'child_process', 'createHmac',
  ]) {
    assert.equal(text.includes(banned), false, `${path.relative(pkg, file)} still references ${banned}`)
  }
}
console.log('ok  static scan: no removed feature survives')

// ── 2. modules + adapter ─────────────────────────────────────────────────────
const { buildCatalog, buildKiloCatalog } = await import(path.join(pkg, 'src/catalog.js'))
const { FreeModelAdapter } = await import(path.join(pkg, 'src/adapter.js'))
const catalog = buildCatalog(['mimo-v2.6-flash-free', 'muse-spark-1.3-contributor-free'])
const kilo = buildKiloCatalog([{ id: 'kilo-auto/free', name: 'Kilo Auto', context_length: 131072, isFree: true }])
assert.ok(catalog.length === 2, 'free catalog rows')
assert.ok(kilo.length === 1, 'kilo row')
const adapter = new FreeModelAdapter({
  state: () => ({
    catalog: [...catalog, ...kilo],
    membership: { 'our-free-model': [...catalog, ...kilo].map(row => row.id) },
    settings: { defaultMaxTokens: 32768 },
    attributionUserAgent: 'deepseek-harness',
  }),
  recordUsage: () => {},
  recordTurn: () => {},
})
const listed = await adapter.listModels('our-free-model')
assert.equal(listed.length, 3)
assert.equal(listed[0].provider, 'our-free-model')
const resolved = await adapter.resolveModel('our-free-model', 'mimo-v2.6-flash-free')
assert.ok(resolved.context.contextWindow > 0)
console.log('ok  adapter lists and resolves catalog rows')

// ── 3. client bundle ─────────────────────────────────────────────────────────
{
  let exports
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { exports = factory(name => (name === 'react' ? { createElement: () => null, Fragment: null, useState: () => [], useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn() } : {})) } } }
  await import(path.join(pkg, 'client.js'))
  assert.equal(exports.name, 'our-free-model')
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  delete globalThis.window
  console.log('ok  client bundle registers')
}

// ── 4. host apply + HTTP ─────────────────────────────────────────────────────
const { apply } = await import(path.join(pkg, 'index.js'))
const disposers = []
const routes = []
const settingsCalls = []
const ctx = {
  logger: { info: () => {}, warn: () => {}, debug: () => {}, log: () => {} },
  fiber: { entry: { options: { id: 'our-free-model' } } },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose ?? (() => {})
  },
  inject(_deps, callback) {
    callback({
      webServer: { register(route) { routes.push(route); return () => {} } },
      effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    })
  },
  get: () => undefined,
  llm: {
    registerAdapter: () => ({ replace: () => {} }),
    registerConfigurableProviders: value => settingsCalls.push(value),
    registerModelDiscovery: () => {},
  },
}
apply(ctx, {})
assert.ok(routes.length === 1, 'api route registered')

const handler = routes[0].handler
const server = http.createServer((req, res) => handler(req, res))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/our-free-model`

const getSummary = async () => {
  const response = await fetch(`${base}/summary`)
  assert.equal(response.status, 200)
  return response.json()
}
let summary = await getSummary()
assert.equal(typeof summary.version, 'string')
assert.ok(Array.isArray(summary.models))
assert.ok(summary.counts.total >= 1, 'fallback catalog is advertised')
assert.equal(summary.settings.enabled, true)

const patched = await fetch(`${base}/settings`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false, probeIntervalMinutes: 30 }),
})
assert.equal(patched.status, 200)
summary = await patched.json()
assert.equal(summary.settings.enabled, false)
assert.equal(summary.settings.probeIntervalMinutes, 30)

const rejected = await fetch(`${base}/settings`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ forward: { enabled: true } }),
})
assert.equal(rejected.status, 400)

const tested = await fetch(`${base}/test`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: summary.models[0].id }),
})
assert.equal(tested.status, 200)
const result = await tested.json()
assert.equal(result.ok, false, 'closed port must fail the test, not hang or crash')
assert.equal(typeof result.error, 'string')

const missing = await fetch(`${base}/nope`)
assert.equal(missing.status, 404)
console.log('ok  host API: summary, settings validation, test error path, 404')

await new Promise(resolve => server.close(resolve))
for (const dispose of disposers) { try { dispose() } catch {} }
await new Promise(resolve => setTimeout(resolve, 50))
console.log('ok  teardown')
console.log('\nall smoke tests passed')
