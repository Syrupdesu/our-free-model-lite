// Live A/B for the free-lane transport.
//
// Usage: OUR_FREE_MODEL_FREE_TRANSPORT=bun node scripts/lane-ab.mjs [model]
//        OUR_FREE_MODEL_FREE_TRANSPORT=node node scripts/lane-ab.mjs [model]
//
// The same fingerprint body goes out through both transports; Bun answers 200
// and Node answers 429 on the current gateway. Run it after an upstream sync.

import { postStreamed } from '../src/http.js'
import { applyFingerprint, mintSessionId } from '../src/upstream.js'

const model = process.argv[2] ?? 'nemotron-3.5-lightning-free'
const body = {
  model,
  messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
  stream: true,
  max_tokens: 16,
}
applyFingerprint(body, false)

let chunks = 0
let text = ''
const started = Date.now()
try {
  await postStreamed({
    path: '/inference/v1/chat/completions',
    body,
    session: mintSessionId(),
    timeoutMs: 45000,
    onData: payload => {
      chunks += 1
      if (payload === '[DONE]') return
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content
        if (typeof delta === 'string') text += delta
      } catch { /* keep counting framing errors as chunks */ }
    },
  })
  console.log(JSON.stringify({ transport: process.env.OUR_FREE_MODEL_FREE_TRANSPORT ?? 'auto', model, ok: true, chunks, ms: Date.now() - started, text: text.slice(0, 40) }))
} catch (error) {
  console.log(JSON.stringify({ transport: process.env.OUR_FREE_MODEL_FREE_TRANSPORT ?? 'auto', model, ok: false, ms: Date.now() - started, code: error?.code, message: String(error?.message ?? error).slice(0, 200) }))
}
