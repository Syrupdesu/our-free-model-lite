// Session identity and store permissions.
//
// The lane accounts quota per upstream session, and it refuses a hash-derived
// pseudo timestamp even when the id has the right shape (upstream A/B controls,
// 2026-10-28). These assertions pin the ported behaviour: mint from a real clock
// once, migrate a legacy mapping exactly once, never rotate on retry, and keep
// the store private.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-stable-session-'))
const previous = process.env.DSH_HOME
process.env.DSH_HOME = scratch

try {
  const up = await import('../src/upstream.js?stable-session=first')
  const legacy = up.canonicalizeSession('legacy')
  const real = up.mintSessionId(Date.now() - 1000)
  const dataDir = path.join(scratch, 'our-free-model')
  const file = path.join(dataDir, 'session-map.json')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: { legacy, real } }), { mode: 0o644 })
  fs.chmodSync(file, 0o644)

  const before = Date.now()
  const upgraded = up.sessionForConversation('legacy')
  const after = Date.now()

  assert.notEqual(upgraded, legacy, 'a hash-derived mapping is replaced')
  assert.ok(up.isCanonicalSession(upgraded), 'the replacement carries the accepted encoding')
  const decoded = (~BigInt(`0x${upgraded.slice(4, 16)}`) & 0xffffffffffffn) >> 12n
  assert.ok(decoded >= (BigInt(before) & 0xfffffffffn) && decoded <= (BigInt(after) & 0xfffffffffn), 'the replacement carries the real clock')
  assert.equal(up.sessionForConversation('legacy'), upgraded, 'a retry never rotates the id')
  assert.equal(up.sessionForConversation('real'), real, 'a real remembered id is preserved')
  const caller = up.mintSessionId()
  assert.equal(up.sessionForConversation(caller), caller, "a caller's canonical id is forwarded verbatim")

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.version, 2, 'the store is marked as the migrated layout')
  assert.equal(saved.sessions.legacy, upgraded)
  assert.equal(saved.sessions.real, real)

  const mode = fs.statSync(file).mode & 0o777
  assert.equal(mode, 0o600, `the store is private, got ${mode.toString(8)}`)

  const reloaded = await import('../src/upstream.js?stable-session=second')
  assert.equal(reloaded.sessionForConversation('legacy'), upgraded, 'a restart keeps the minted id')
  assert.equal(reloaded.sessionForConversation('real'), real)
  const fresh = reloaded.sessionForConversation('new-conversation')
  assert.notEqual(fresh, upgraded)
  assert.equal(reloaded.sessionForConversation('new-conversation'), fresh)

  console.log('ok  sessions: real timestamp, one-time migration, stable retries, private store')
} finally {
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  fs.rmSync(scratch, { recursive: true, force: true })
}
