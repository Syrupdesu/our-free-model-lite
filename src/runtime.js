/**
 * The model runtime: listing, availability, and the adapter the harness calls.
 *
 * This is the whole point of the plugin — one keyless lane (OpenCode's Zen
 * gateway) plus Kilo's free pool, a roster that follows the upstream listing,
 * and per-model verdicts that only the user's explicit actions refresh.
 *
 * Removed from the upstream project on purpose: paid/co-paid lanes, account
 * channels, subscription imports, custom providers, fallback chains, token
 * savers, the local gateway, the dashboard and every promotional surface.
 *
 * @module src/runtime.js
 */

import path from 'node:path'
import { FreeModelAdapter, ROUTE_MAIN, ROUTE_REGION } from './adapter.js'
import { buildCatalog, buildKiloCatalog, parseListing, reviveKiloCatalog, isKiloEntry } from './catalog.js'
import { JsonStore, SETTINGS_INITIAL, AVAILABILITY_INITIAL } from './store.js'
import { STATE, detectEgress, probeCatalog } from './probe.js'
import { CODE, UpstreamError, getJson } from './http.js'
import { runModelTest, modelAvailability } from './model-test.js'
import { DEFAULT_LEVEL } from './effort.js'
import { fetchKiloListing } from './kilo.js'
import { sessionForConversation } from './upstream.js'

/** Shown only when the very first listing cannot be read and no cache exists. */
const FALLBACK_CATALOG = buildCatalog([
  'mimo-v2.6-flash-free', 'mimo-v2.5-free', 'ling-3.0-fin-free',
  'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'space-bunny-free',
])

export function createRuntimeStores({ dataDir, logger = console }) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
    throw new TypeError('dataDir must be an absolute path')
  }
  const open = (file, initial) => new JsonStore(path.join(dataDir, file), structuredClone(initial), {
    log: message => logger.warn?.(message),
  })
  const settings = open('settings.json', SETTINGS_INITIAL)
  const availability = open('availability.json', AVAILABILITY_INITIAL)
  const catalogStore = open('catalog.json', { version: 1, at: 0, entries: [], kiloRows: [] })
  return {
    settings, availability, catalogStore,
    dispose() {
      settings.dispose()
      availability.dispose()
      catalogStore.dispose()
    },
  }
}

export function createModelRuntime({
  settings, availability, catalogStore,
  logger = console,
  attributionUserAgent = 'deepseek-harness',
  resolveImage,
}) {
  let freeCatalog = materializeCatalog(catalogStore.get().entries ?? [])
  let kiloCatalog = reviveKiloCatalog(catalogStore.get().kiloRows)
  let catalog = mergeCatalog(freeCatalog, kiloCatalog)
  let egress = availability.get().egress ?? null
  let disposed = false
  const lifetime = new AbortController()
  let egressGeneration = 0

  const state = () => ({
    catalog,
    membership: computeMembership(catalog, availability.get(), settings.get()),
    settings: settings.get(),
    attributionUserAgent,
  })

  const adapter = new FreeModelAdapter({
    state,
    resolveImage,
    recordUsage: () => {},
    recordTurn: () => {},
    warn: message => logger.warn?.(message) ?? logger.log?.(message),
  })

  let catalogRefresh = null
  let catalogRefreshForced = false
  let catalogRefreshProbed = false

  async function refreshCatalog(opts) {
    const { probe = false, force = false } = opts ?? {}
    if (disposed) return catalog
    while (catalogRefresh !== null) {
      const shared = catalogRefresh
      const sharedForced = catalogRefreshForced
      const sharedProbed = catalogRefreshProbed
      const value = await shared
      if (disposed || ((!force || sharedForced) && (!probe || sharedProbed))) return value
    }
    const run = refreshCatalogOnce({ probe, force })
    catalogRefresh = run
    catalogRefreshForced = force
    catalogRefreshProbed = probe
    try { return await run } finally {
      if (catalogRefresh === run) {
        catalogRefresh = null
        catalogRefreshForced = false
        catalogRefreshProbed = false
      }
    }
  }

  async function refreshCatalogOnce({ probe, force }) {
    let ids = []
    try {
      ids = parseListing(await fetchListing())
    } catch (error) {
      if (!disposed) logger.warn?.(`our-free-model: model listing refresh failed (${error?.message ?? error}); keeping the cached catalog`)
    }
    if (disposed) return catalog
    if (ids.length > 0) {
      freeCatalog = buildCatalog(ids)
      catalogStore.update({ at: Date.now(), entries: freeCatalog.map(entry => entry.id) })
      catalogStore.flush()
      settings.update({ catalogSyncedAt: Date.now() })
    } else {
      freeCatalog = materializeCatalog(catalogStore.get().entries ?? [])
    }
    await refreshKiloRoster()
    if (disposed) return catalog
    catalog = mergeCatalog(freeCatalog, kiloCatalog)
    if (probe) await refreshAvailability(force)
    return catalog
  }

  async function refreshKiloRoster() {
    try {
      const payload = await fetchKiloListing({ signal: lifetime.signal })
      if (disposed) return
      if (payload?.error || !Array.isArray(payload?.data)) throw new Error('invalid Kilo model listing')
      kiloCatalog = buildKiloCatalog(payload.data)
      catalogStore.update({ kiloRows: kiloCatalog })
    } catch (error) {
      if (!disposed) logger.warn?.(`our-free-model: Kilo listing failed (${error?.code ?? error?.message ?? 'unknown'}); keeping its cached roster`)
    }
  }

  async function fetchListing() {
    if (disposed) return { data: [] }
    return getJson('/inference/v1/models', {
      session: sessionForConversation('catalog:our-free-model'),
      attributionUserAgent,
      signal: lifetime.signal,
    })
  }

  let probeRound = null
  let probeThrottleStreak = 0
  let probeBackoffUntil = 0

  async function runProbeRound() {
    const generation = egressGeneration
    // Kilo rows are trusted as listed: probing them spends the pool's quota to
    // learn something its public listing already states.
    const probeable = catalog.filter(entry => !isKiloEntry(entry))
    const results = await probeCatalog(probeable, { attributionUserAgent, signal: lifetime.signal }, (id, result) => {
      if (disposed || generation !== egressGeneration) return
      availability.edit(value => ({
        ...value,
        results: {
          ...value.results,
          [id]: {
            state: result.state,
            ...result.detail === undefined ? {} : { detail: result.detail },
            ...result.ttftMs === undefined ? {} : { ttftMs: result.ttftMs },
            latencyMs: result.latencyMs,
            startedAt: result.startedAt,
            at: Date.now(),
          },
        },
      }))
    }, 2)
    if (disposed || generation !== egressGeneration) return {}
    availability.update({ at: Date.now(), egress })
    availability.flush()
    const verdicts = Object.values(results)
    if (verdicts.length > 0 && verdicts.every(row => row.state === STATE.unavailable)) {
      logger.warn?.(`our-free-model: the gateway refused all ${verdicts.length} models this round (${verdicts[0].detail ?? 'no detail'}); keeping them advertised`)
    }
    const allThrottled = verdicts.length > 0 && verdicts.every(row => row.state === STATE.throttled)
    probeThrottleStreak = allThrottled ? probeThrottleStreak + 1 : 0
    probeBackoffUntil = allThrottled
      ? Date.now() + Math.min(30 * 2 ** (probeThrottleStreak - 1), 120) * 60_000
      : 0
    if (allThrottled) {
      logger.warn?.(`our-free-model: probe round hit the lane quota; probes pause for ${Math.round((probeBackoffUntil - Date.now()) / 60_000)} minutes`)
    }
    return results
  }

  async function refreshAvailability(force = false) {
    if (disposed || (!force && probeBackoffUntil > Date.now())) return {}
    if (probeRound !== null) return probeRound
    const round = runProbeRound()
    probeRound = round
    try { return await round } finally { if (probeRound === round) probeRound = null }
  }

  async function watchEgress() {
    if (disposed) return false
    const seen = await detectEgress({ signal: lifetime.signal })
    if (disposed || seen === undefined) return false
    const previous = availability.get().egress
    const changed = previous === null || previous === undefined
      || previous.ip !== seen.ip || (seen.country !== undefined && previous.country !== seen.country)
    egress = seen
    if (changed) {
      egressGeneration++
      const expire = rows => Object.fromEntries(Object.entries(rows ?? {}).map(([id, row]) => [id, { ...row, stale: true }]))
      availability.edit(value => ({
        ...value, egress: seen, at: 0,
        results: expire(value.results), manualResults: expire(value.manualResults),
      }))
      availability.flush()
      probeThrottleStreak = 0
      probeBackoffUntil = 0
      logger.info?.(`our-free-model: egress changed to ${seen.ip}${seen.country ? ` (${seen.country})` : ''}; previous verdicts marked stale`)
    }
    return true
  }

  const latestTests = new Map()
  async function testModel(id, effort = DEFAULT_LEVEL, { signal } = {}) {
    if (disposed) throw new UpstreamError('Model runtime stopped', CODE.aborted)
    if (settings.get().enabled === false) throw new UpstreamError('Inference is paused', CODE.client)
    const entry = catalog.find(candidate => candidate.id === id)
    if (!entry) throw new UpstreamError('Unknown model "' + id + '"', CODE.client, { status: 404 })
    const token = {}
    latestTests.set(id, token)
    const generation = egressGeneration
    const selectedEffort = effort === undefined || effort === '' ? DEFAULT_LEVEL : effort
    const linkedSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    const persist = row => {
      if (disposed || linkedSignal.aborted || latestTests.get(id) !== token || generation !== egressGeneration) return false
      availability.edit(value => ({ ...value, manualResults: { ...value.manualResults, [id]: row } }))
      availability.flush()
      return !availability.writeFailed
    }
    try {
      const measured = await runModelTest(testSignal => adapter.stream({
        provider: ROUTE_MAIN,
        model: entry.id,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        reasoningEffort: selectedEffort,
        sessionId: 'bench:' + entry.id + ':' + selectedEffort,
        signal: testSignal,
      }, entry, state()), { signal: linkedSignal })
      if (linkedSignal.aborted || disposed) throw new UpstreamError('Text test cancelled', CODE.aborted)
      if (generation !== egressGeneration) throw new UpstreamError('Network egress changed during the test; please test again', CODE.aborted)
      const persisted = persist({ state: STATE.available, source: 'manual', at: Date.now(), ttftMs: measured.ttftMs, latencyMs: measured.totalMs })
      return { model: entry.id, effort: selectedEffort, ok: true, ...measured, persisted }
    } catch (error) {
      if (error?.code !== CODE.aborted) persist({ state: STATE.unknown, source: 'manual', at: Date.now(), detail: String(error?.message ?? error).slice(0, 200) })
      throw error
    } finally {
      if (latestTests.get(id) === token) latestTests.delete(id)
    }
  }

  return {
    testModel,
    state,
    adapter,
    refreshCatalog,
    refreshAvailability,
    watchEgress,
    fetchListing,
    get catalog() { return catalog },
    get egress() { return egress },
    setAttributionUserAgent(value) { attributionUserAgent = value },
    /** One row per model as the settings page renders it. */
    rows() {
      const snapshot = availability.get()
      return catalog.map(entry => {
        const verdict = modelAvailability(entry.id, snapshot, Boolean(entry.channel))
        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          vision: entry.vision === true,
          contextWindow: entry.contextWindow,
          maxOutput: entry.maxOutput,
          reasoning: entry.reasoning === true,
          efforts: Array.isArray(entry.efforts) ? entry.efforts : [],
          channel: entry.channel ?? '',
          state: verdict.availability,
          probedAt: verdict.probedAt,
          latencyMs: verdict.latencyMs,
          ttftMs: verdict.ttftMs,
          detail: verdict.detail,
          source: verdict.availabilitySource,
        }
      })
    },
    counts() {
      const rows = this.rows()
      const counts = { total: rows.length, available: 0, 'region-blocked': 0, unavailable: 0, throttled: 0, unknown: 0 }
      for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1
      return counts
    },
    dispose() {
      if (disposed) return
      disposed = true
      lifetime.abort()
    },
  }
}

function materializeCatalog(ids) {
  const rebuilt = buildCatalog(ids)
  return rebuilt.length > 0 ? rebuilt : FALLBACK_CATALOG
}

function mergeCatalog(freeCatalog, kiloCatalog) {
  const seen = new Set()
  const merged = []
  for (const entry of [...freeCatalog, ...kiloCatalog]) {
    if (entry === null || entry === undefined || seen.has(entry.id)) continue
    seen.add(entry.id)
    merged.push(entry)
  }
  return merged
}

/** Which route each model is advertised under, from its egress verdict. */
export function computeMembership(catalog, availabilitySnapshot, settings) {
  const expose = settings?.exposeRegionModels !== false
  const verdictOf = entry => modelAvailability(entry.id, availabilitySnapshot, Boolean(entry.channel)).availability
  const probeable = catalog.filter(entry => !entry.channel)
  const refusedAll = probeable.length > 0 && probeable.every(entry => verdictOf(entry) === STATE.unavailable)
  let usable = catalog.filter(entry => verdictOf(entry) !== STATE.unavailable)
  if (refusedAll) usable = catalog
  const main = []
  const region = []
  for (const entry of usable) {
    const verdict = verdictOf(entry)
    if (verdict !== STATE.regionBlocked) main.push(entry.id)
    else if (expose) region.push(entry.id)
  }
  const membership = {}
  if (main.length > 0) membership[ROUTE_MAIN] = main
  if (region.length > 0) membership[ROUTE_REGION] = region
  return membership
}
