/**
 * Plugin-owned durable state: user settings, catalog cache and probe results.
 *
 * Storage is a plain JSON file under the harness home rather than a harness
 * service on purpose. The settings seam changed shape between the two kernel
 * lines this plugin has to run on (the older one exposes a registrable
 * namespace, the newer one projects volatile plugin config), and the storage
 * domain needs composition rows a bare profile may not mount. A file the plugin
 * owns behaves identically on both, and usage history is high-cardinality
 * telemetry that does not belong in a configuration document anyway.
 *
 * Writes are coalesced and land through a temp file + rename, so a crash mid
 * write cannot leave a truncated store.
 *
 * @module src/store.js
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Same resolution the harness home-paths helper uses: `$DSH_HOME` else `~/.dsh`. */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export const DATA_DIR_NAME = 'our-free-model'

export class JsonStore {
  /**
   * @param {string} file - absolute path
   * @param {object} initial - value used when the file does not exist yet
   * @param {{log?: (message: string) => void}} [options] - write-failure channel;
   *   without it a flush that cannot write (disk full, permissions) stays silent
   */
  constructor(file, initial, { log } = {}) {
    this.file = file
    this.value = initial
    this.dirty = false
    this.timer = undefined
    this.disposed = false
    this.log = log
    this.writeFailed = false
    this.load()
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.value = { ...this.value, ...parsed }
      }
    } catch {
      // Absent is normal; unreadable is not. Keep the damaged file: without this
      // the next scheduled flush renames a fresh default over it and the user's
      // settings — the forward key, the acknowledged announcements — are gone with
      // nothing on disk to recover and nothing in the log to explain.
      try {
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch { /* a home we cannot write to is not this file's problem */ }
    }
  }

  get() {
    return this.value
  }

  /** Merge a patch in and schedule the write. Returns the new value. */
  update(patch) {
    if (this.disposed) return this.value
    this.value = { ...this.value, ...patch }
    this.schedule()
    return this.value
  }

  /** Mutate through a callback; used for read-modify-write on nested state. */
  edit(mutate) {
    if (this.disposed) return this.value
    const next = mutate(structuredClone(this.value))
    if (next !== undefined) this.value = next
    this.schedule()
    return this.value
  }

  schedule(delayMs = 800) {
    if (this.disposed) return
    this.dirty = true
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, delayMs)
    // Telemetry must never hold the process open.
    this.timer.unref?.()
  }

  flush() {
    if (!this.dirty || this.disposed) return
    this.dirty = false
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(this.value, undefined, 2), { mode: 0o600 })
      fs.renameSync(temp, this.file)
      this.writeFailed = false
    } catch (error) {
      // fail-soft: the next mutation retries, and nothing downstream depends on
      // it — but a home that cannot be written to loses every statistic and
      // every acknowledged setting, so the first failure gets said out loud
      // instead of rotting silently (repeat failures stay quiet: one line per
      // incident, not one per scheduled flush).
      // Re-arm `dirty`: it was cleared before the attempt, so dispose()'s
      // final flush would otherwise skip a write that never landed and drop
      // the session's last changes silently.
      this.dirty = true
      if (!this.writeFailed) {
        this.writeFailed = true
        this.log?.(`our-free-model: could not persist ${path.basename(this.file)} (${error?.message ?? error}); changes are kept in memory only`)
      }
    }
  }

  dispose() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    // Persist what this generation changed, THEN lock the store: late callbacks
    // from a hot-reloaded-away generation (an in-flight feed poll, a pending
    // update check) must never write over the successor generation's state.
    // The disposal order makes this safe — the successor's stores are created
    // only after the previous generation's disposers have run.
    this.flush()
    this.disposed = true
    this.dirty = false
  }
}


export const SETTINGS_INITIAL = {
  version: 1,
  /** Master switch: when off the routes stay registered but serve nothing. */
  enabled: true,
  /** Show region-limited models in the picker as soon as they answer. */
  exposeRegionModels: true,
  /** Minutes between background catalog (listing) refreshes. Availability is
   *  only probed when the user asks for it — probes spend the lane's quota. */
  probeIntervalMinutes: 15,
  /** Cap a turn's output so a slow lane cannot run away. */
  defaultMaxTokens: 32768,
  /** One checkpoint continuation after a cut or a reasoning-only stop. */
  streamRecovery: true,
  catalogSyncedAt: 0,
}

/** Availability snapshot: the current egress plus per-model verdicts. */
export const AVAILABILITY_INITIAL = {
  version: 1,
  at: 0,
  egress: {},
  results: {},
  manualResults: {},
}

export const MIN_DECODE_MS = 250
export const MAX_CREDIBLE_TPS = 250

/** Tokens/second over the measured decode window, with the sanity gates. */
export function decodeWindow(decodeMs, tokens, ok) {
  const ms = Number.isFinite(decodeMs) && decodeMs > 0 ? decodeMs : 0
  const count = Number.isFinite(tokens) ? tokens : 0
  if (ok !== true || count <= 0 || ms < MIN_DECODE_MS) return { measurable: false, decodeMs: 0, tps: null }
  const tps = (count / ms) * 1000
  if (!Number.isFinite(tps) || tps > MAX_CREDIBLE_TPS) return { measurable: false, decodeMs: 0, tps: null }
  return { measurable: true, decodeMs: ms, tps: Math.round(tps) }
}
