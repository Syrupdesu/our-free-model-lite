/**
 * Our Free Model (lite) — host half.
 *
 * One keyless lane, one settings page, one probe/test surface. Everything the
 * upstream project grew around this lane — the co-paid gateway and its GitHub
 * star gate, the ten account channels, subscription imports, the aggregate
 * provider registry, fallback chains, token savers, the local OpenAI gateway,
 * the dashboard, the announcement feed, the recommended-projects page and the
 * self-updater — is deliberately absent. There is no code path in this package
 * that installs, updates, or replaces itself.
 *
 * @module index.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome, DATA_DIR_NAME } from './src/store.js'
import { createRuntimeStores, createModelRuntime } from './src/runtime.js'
import { ROUTE_MAIN, ROUTE_REGION, ROUTE_LABELS } from './src/adapter.js'
import { rejectionFor } from './src/trust.js'
import { UpstreamError } from './src/http.js'
import { resolveAttributionUserAgent } from './adapter/kernel.js'

export const name = 'our-free-model'

/** `llm` is what this plugin exists for; everything else is optional. */
export const inject = ['llm']

const PKG_DIR = fileURLToPath(new URL('./', import.meta.url))

function readVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version ?? '')
  } catch {
    return '0.0.0'
  }
}

export const version = readVersion()

const EDITABLE_SETTINGS = new Set(['enabled', 'exposeRegionModels', 'probeIntervalMinutes', 'defaultMaxTokens'])

/** Validate and normalise one settings patch. Throws on a field it cannot honour. */
function normalizeSettingsPatch(patch, current) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new UpstreamError('settings must be an object', 'INVALID_INPUT', { status: 400 })
  const next = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE_SETTINGS.has(key)) throw new UpstreamError(`unknown setting "${key}"`, 'INVALID_INPUT', { status: 400 })
    if (key === 'enabled' || key === 'exposeRegionModels') {
      if (typeof value !== 'boolean') throw new UpstreamError(`${key} must be a boolean`, 'INVALID_INPUT', { status: 400 })
      next[key] = value
      continue
    }
    const number = Number(value)
    if (!Number.isFinite(number)) throw new UpstreamError(`${key} must be a number`, 'INVALID_INPUT', { status: 400 })
    if (key === 'probeIntervalMinutes') {
      if (number < 1 || number > 1440) throw new UpstreamError('probeIntervalMinutes must be between 1 and 1440', 'INVALID_INPUT', { status: 400 })
      next[key] = Math.trunc(number)
      continue
    }
    if (number < 1024 || number > 262144) throw new UpstreamError('defaultMaxTokens must be between 1024 and 262144', 'INVALID_INPUT', { status: 400 })
    next[key] = Math.trunc(number)
  }
  return { ...current, ...next }
}

/** Parse one JSON body with a hard size cap. */
function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new UpstreamError('request body too large', 'INVALID_INPUT', { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') return resolve({})
      try { resolve(JSON.parse(text)) } catch { reject(new UpstreamError('request body is not JSON', 'INVALID_INPUT', { status: 400 })) }
    })
    req.on('error', reject)
  })
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  const home = resolveDshHome()
  const dataDir = path.resolve(home, DATA_DIR_NAME)
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  // `mode` only applies on creation; an older install's directory keeps 0755.
  try { fs.chmodSync(dataDir, 0o700) } catch { /* the files inside are 0600 regardless */ }

  const stores = createRuntimeStores({ dataDir, logger })
  const { settings } = stores
  const runtime = createModelRuntime({
    ...stores,
    logger,
    attributionUserAgent: 'deepseek-harness',
  })

  const packageVersion = version
  let disposed = false
  // An unreadable service is not an absent one: hand the fence an empty object
  // so it fails closed instead of dropping the host's browser authentication.
  const connection = () => {
    if (typeof ctx.get !== 'function') return undefined
    try { return ctx.get('connection') } catch { return {} }
  }

  // ── registration ────────────────────────────────────────────────────────────
  ctx.llm.registerAdapter([ROUTE_MAIN, ROUTE_REGION], runtime.adapter)
  ctx.llm.registerConfigurableProviders?.([
    { provider: ROUTE_MAIN, displayName: ROUTE_LABELS[ROUTE_MAIN], settingsNs: ctx.fiber?.entry?.options?.id ?? name, settingsPath: [] },
  ])
  // The in-app "detect models" button asks this for what the picker advertises.
  ctx.llm.registerModelDiscovery?.(ctx.fiber?.entry?.options?.id ?? name, async () => {
    await runtime.refreshCatalog({ probe: false, force: true })
    const advertised = new Set(Object.values(runtime.state().membership).flat())
    return runtime.catalog
      .filter(entry => advertised.has(entry.id))
      .map(entry => ({
        id: entry.id,
        name: entry.name,
        contextWindow: entry.contextWindow,
        maxTokens: entry.maxOutput,
        inputModalities: entry.vision ? ['text', 'image'] : ['text'],
      }))
  })

  // ── summary ─────────────────────────────────────────────────────────────────
  const summary = () => ({
    version: packageVersion,
    settings: {
      enabled: settings.get().enabled !== false,
      exposeRegionModels: settings.get().exposeRegionModels !== false,
      probeIntervalMinutes: settings.get().probeIntervalMinutes ?? 15,
      defaultMaxTokens: settings.get().defaultMaxTokens ?? 32768,
    },
    egress: runtime.egress,
    syncedAt: settings.get().catalogSyncedAt ?? 0,
    counts: runtime.counts(),
    models: runtime.rows(),
  })

  // ── HTTP surface ────────────────────────────────────────────────────────────
  async function api(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const marker = '/api/our-free-model'
    const at = url.pathname.indexOf(marker)
    const prefix = at >= 0 ? url.pathname.slice(0, at + marker.length) : marker
    const route = url.pathname.slice(at >= 0 ? prefix.length : 0).replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    }

    const rejection = rejectionFor(req, connection(), decision => {
      if (decision.status >= 500) logger.warn?.(`our-free-model: request admission failed (${decision.source}: ${decision.reason})`)
    })
    if (rejection !== undefined) {
      return send(rejection, { error: rejection === 401 ? 'unauthorized' : rejection === 503 ? 'admission unavailable' : 'forbidden' })
    }

    try {
      if (method === 'GET' && route === '/summary') return send(200, summary())

      if (method === 'POST' && route === '/settings') {
        const patch = await readJson(req)
        settings.update(normalizeSettingsPatch(patch, settings.get()))
        settings.flush()
        return send(200, summary())
      }

      if (method === 'POST' && route === '/refresh') {
        const body = await readJson(req)
        const probe = body?.probe === true
        await runtime.refreshCatalog({ probe, force: true })
        if (probe) await runtime.watchEgress().catch(() => {})
        return send(200, summary())
      }

      if (method === 'POST' && route === '/test') {
        const body = await readJson(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        if (id === '') throw new UpstreamError('test needs a model id', 'INVALID_INPUT', { status: 400 })
        const effort = typeof body?.effort === 'string' && body.effort !== '' ? body.effort : undefined
        const controller = new AbortController()
        const onClose = () => { if (!res.writableEnded) controller.abort() }
        res.on('close', onClose)
        try {
          const result = await runtime.testModel(id, effort, { signal: controller.signal })
          return send(200, {
            ok: true,
            model: result.model,
            effort: result.effort,
            ttftMs: result.ttftMs,
            totalMs: result.totalMs,
            tokensPerSecond: result.tokensPerSecond,
            outputTokens: result.outputTokens,
            reasoningTokens: result.reasoningTokens,
            sample: result.sample,
            persisted: result.persisted,
          })
        } catch (error) {
          return send(200, {
            ok: false,
            model: id,
            error: String(error?.message ?? error).slice(0, 400),
            code: typeof error?.code === 'string' ? error.code : '',
          })
        } finally {
          res.off('close', onClose)
        }
      }

      return send(404, { error: 'not found' })
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      if (status >= 500) logger.warn?.(`our-free-model: ${String(error?.message ?? error)}`)
      return send(status, { error: String(error?.message ?? error) })
    }
  }

  // `webServer` may be published after plugins load; injecting pends until it is.
  ctx.inject(['webServer'], scoped => {
    const server = scoped.webServer
    scoped.effect(() => server.register({ kind: 'prefix', path: '/api/our-free-model', handler: api }), 'our-free-model: api routes')
    logger.info?.('our-free-model: settings API mounted at /api/our-free-model')
  })

  // ── boot + cadence ──────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    disposed = true
    runtime.dispose()
    stores.dispose()
  }, 'our-free-model: stores')

  ctx.effect(() => {
    void (async () => {
      runtime.setAttributionUserAgent(await resolveAttributionUserAgent(logger))
      if (disposed) return
      try {
        await runtime.refreshCatalog({ probe: false, force: true })
        await runtime.watchEgress().catch(() => {})
      } catch (error) {
        logger.warn?.(`our-free-model: startup refresh failed (${error?.message ?? error})`)
      }
    })().catch(error => logger.warn?.(`our-free-model: startup refresh failed (${error?.message ?? error})`))
  }, 'our-free-model: boot refresh')

  // Listing refresh only: availability probes stay a user action.
  ctx.effect(() => {
    let timer
    const arm = () => {
      if (disposed) return
      const minutes = Math.max(1, Number(settings.get().probeIntervalMinutes) || 15)
      timer = setTimeout(() => {
        if (disposed) return
        void runtime.refreshCatalog({ probe: false }).catch(() => {}).finally(arm)
      }, minutes * 60_000)
      timer.unref?.()
    }
    arm()
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer) }
  }, 'our-free-model: catalog cadence')
}
