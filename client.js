/**
 * Our Free Model (lite) — browser half.
 *
 * One settings section: the model roster with its availability, a master
 * switch, and a test button per model. No announcements, no onboarding, no
 * sponsor banner, no recommended-projects page, no dashboard, no gateway panel.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides.
 */
window.__ModuleLoader__.load({
  id: 'dsh-our-free-model',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useCallback, useMemo } = React

    const NS = 'settings.ourFreeModel'
    const API = '/api/our-free-model'
    const inject = ['slots', 'locale']

    // ── copy ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        nav: 'Our Free Model',
        title: 'Our Free Model',
        subtitle: '免登录、免注册、免 API Key 的免费模型；清单跟随上游，可用性按你的网络实测。',
        'meta.description': '在 DeepSeek Harness 内直连免密免费模型，带可用性探测与单模型测速。',
        loading: '正在加载…',
        loadFailed: '无法连接插件后端',
        retry: '重试',
        refresh: '刷新清单',
        reprobe: '探测可用性',
        probing: '探测中…',
        refreshing: '刷新中…',
        'state.available': '可用',
        'state.region-blocked': '地区受限',
        'state.unavailable': '不可用',
        'state.throttled': '限流',
        'state.unknown': '未实测',
        'counts.total': '共 {n} 个模型',
        'counts.ok': '{n} 个可用',
        'counts.unknown': '{n} 个未实测',
        'egress.label': '当前出口',
        'egress.none': '未探测',
        enabled: '启用插件',
        'enabled.hint': '关闭后模型路由保留，但不再提供任何模型。',
        expose: '显示地区受限模型',
        'expose.hint': '把这些模型单独归组，仍然可见但不会混进主列表。',
        interval: '清单刷新间隔（分钟）',
        test: '测速',
        testing: '测试中…',
        'test.unknown': '—',
        'test.ok': '首字 {ttft} ms · {tps} tok/s',
        'test.fail': '测试失败',
        'result.sample': '回答：{text}',
        'row.context': '{n}K 上下文',
        'row.output': '最长 {n}K 输出',
        vision: '视觉',
        reasoning: '思考',
        'channel.kilo': 'Kilo',
        'settings.saved': '已保存',
        'settings.failed': '保存失败',
        'test.timeout': '测试超时（模型可能正在排长队）',
        empty: '还没有模型。点「刷新清单」重新拉取。',
        'empty.hint': '免费车道的清单来自上游网关，第一次加载需要几秒。',
        'probe.hint': '探测会真实发一次极短请求，消耗少量免费额度。',
      },
      en: {
        nav: 'Our Free Model',
        title: 'Our Free Model',
        subtitle: 'Free models with no login, no sign-up and no API key. The roster follows upstream; availability is measured on your own network.',
        'meta.description': 'Keyless free models inside DeepSeek Harness, with availability probes and per-model speed tests.',
        loading: 'Loading…',
        loadFailed: 'Cannot reach the plugin backend',
        retry: 'Retry',
        refresh: 'Refresh roster',
        reprobe: 'Probe availability',
        probing: 'Probing…',
        refreshing: 'Refreshing…',
        'state.available': 'Available',
        'state.region-blocked': 'Region-limited',
        'state.unavailable': 'Unavailable',
        'state.throttled': 'Throttled',
        'state.unknown': 'Not tested',
        'counts.total': '{n} models',
        'counts.ok': '{n} available',
        'counts.unknown': '{n} untested',
        'egress.label': 'Current egress',
        'egress.none': 'not detected',
        enabled: 'Enable plugin',
        'enabled.hint': 'The routes stay registered, but no model is served while this is off.',
        expose: 'Show region-limited models',
        'expose.hint': 'They stay visible in their own group instead of mixing into the main list.',
        interval: 'Roster refresh interval (minutes)',
        test: 'Test',
        testing: 'Testing…',
        'test.unknown': '—',
        'test.ok': 'first token {ttft} ms · {tps} tok/s',
        'test.fail': 'Test failed',
        'result.sample': 'Answer: {text}',
        'row.context': '{n}K context',
        'row.output': 'up to {n}K output',
        vision: 'vision',
        reasoning: 'thinking',
        'channel.kilo': 'Kilo',
        'settings.saved': 'Saved',
        'settings.failed': 'Could not save',
        'test.timeout': 'The test timed out (the model may be queued)',
        empty: 'No models yet. Press "Refresh roster".',
        'empty.hint': 'The free lane lists its models upstream; the first load takes a few seconds.',
        'probe.hint': 'A probe sends one very short real request and spends a little free quota.',
      },
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    async function api(path, options) {
      const { timeout = 15_000, ...rest } = options ?? {}
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const response = await fetch(`${API}${path}`, { ...rest, redirect: 'error', signal: controller.signal })
        const text = await response.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 200) } }
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        return payload
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('timeout')
        throw error
      } finally {
        clearTimeout(timer)
      }
    }

    const post = (path, body, timeout) => api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      timeout,
    })

    function useAsync(load, deps) {
      const [state, setState] = useState({ status: 'loading', data: undefined, error: undefined })
      const reload = useCallback(() => {
        setState(current => ({ ...current, status: current.data === undefined ? 'loading' : 'refreshing' }))
        let alive = true
        load().then(data => { if (alive) setState({ status: 'ready', data, error: undefined }) })
          .catch(error => { if (alive) setState({ status: 'error', data: undefined, error: String(error?.message ?? error) }) })
        return () => { alive = false }
      }, deps ?? [])
      useEffect(() => reload(), [reload])
      return { ...state, reload }
    }

    function localeTag(ctx) {
      try {
        const snapshot = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : ctx.locale?.getSnapshot?.()
        const value = snapshot?.active ?? ctx.locale?.locale
        return typeof value === 'string' ? value : document.documentElement.lang || 'zh'
      } catch { return 'zh' }
    }

    function fmt(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (all, key) => (values?.[key] === undefined ? all : String(values[key])))
    }

    function stateTone(state) {
      if (state === 'available') return 'ok'
      if (state === 'region-blocked') return 'warn'
      if (state === 'throttled') return 'warn'
      if (state === 'unavailable') return 'bad'
      return 'muted'
    }

    // ── components ────────────────────────────────────────────────────────────
    function Badge({ tone, children }) {
      return h('span', { className: `ofmlite_badge tone-${tone}` }, children)
    }

    function Switch({ checked, onChange, label, hint }) {
      return h('label', { className: 'ofmlite_switch' },
        h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }),
        h('span', { className: 'ofmlite_track', 'aria-hidden': 'true' }, h('span', { className: 'ofmlite_knob' })),
        h('span', { className: 'ofmlite_switchtext' },
          h('span', { className: 'ofmlite_switchlabel' }, label),
          hint === undefined ? null : h('span', { className: 'ofmlite_hint' }, hint)))
    }

    function NumberField({ label, value, min, max, onCommit }) {
      const [draft, setDraft] = useState(String(value))
      useEffect(() => setDraft(String(value)), [value])
      const commit = () => {
        const number = Number(draft)
        if (Number.isFinite(number) && number >= min && number <= max) onCommit(Math.trunc(number))
        else setDraft(String(value))
      }
      return h('label', { className: 'ofmlite_field' },
        h('span', { className: 'ofmlite_switchlabel' }, label),
        h('input', {
          type: 'number', value: draft, min, max,
          onChange: event => setDraft(event.target.value),
          onBlur: commit,
          onKeyDown: event => { if (event.key === 'Enter') commit() },
        }))
    }

    function ModelRow({ t, model, busy, result, onTest }) {
      const context = Math.round((model.contextWindow ?? 0) / 1024)
      const output = Math.round((model.maxOutput ?? 0) / 1024)
      const showTest = result !== undefined && result !== null && result.running !== true
      return h('div', { className: 'ofmlite_row' },
        h('div', { className: 'ofmlite_rowmain' },
          h('div', { className: 'ofmlite_rowtitle' },
            h('span', { className: 'ofmlite_name' }, model.name || model.id),
            model.channel === 'kilo' ? h(Badge, { tone: 'muted' }, t('channel.kilo')) : null,
            model.vision ? h(Badge, { tone: 'muted' }, t('vision')) : null,
            model.reasoning ? h(Badge, { tone: 'muted' }, t('reasoning')) : null),
          h('div', { className: 'ofmlite_rowsub' },
            h('span', null, fmt(t('row.context'), { n: context })),
            h('span', { className: 'ofmlite_dot' }, '·'),
            h('span', null, fmt(t('row.output'), { n: output })),
            model.description ? h(Fragment, null, h('span', { className: 'ofmlite_dot' }, '·'), h('span', { title: model.description }, model.description.slice(0, 70))) : null)),
        h('div', { className: 'ofmlite_rowside' },
          h(Badge, { tone: stateTone(model.state) }, t(`state.${model.state}`) || model.state),
          h('button', {
            type: 'button', className: 'ofmlite_btn subtle', disabled: busy,
            onClick: () => onTest(model),
          }, busy ? t('testing') : t('test'))),
        showTest ? h('div', { className: `ofmlite_result ${result.ok ? 'ok' : 'bad'}` },
          result.ok
            ? fmt(t('test.ok'), { ttft: result.ttftMs ?? '—', tps: result.tokensPerSecond ?? '—' })
            : `${t('test.fail')}${result.error ? `：${result.error}` : ''}`,
          result.ok && result.sample ? h('div', { className: 'ofmlite_sample' }, fmt(t('result.sample'), { text: result.sample })) : null)
          : model.detail ? h('div', { className: 'ofmlite_detail' }, model.detail) : null)
    }

    function SettingsPage(props) {
      const t = useMemo(() => {
        const base = key => {
          const language = props.locale && String(props.locale).toLowerCase().startsWith('zh') ? 'zh' : 'en'
          return (DICT[language] ?? DICT.en)[key] ?? key
        }
        return Object.assign(base, { locale: props.locale })
      }, [props.locale])

      const summary = useAsync(() => api('/summary'), [])
      const [busy, setBusy] = useState('')
      const [tests, setTests] = useState({})
      const [notice, setNotice] = useState('')

      const patch = async values => {
        setNotice('')
        try {
          await post('/settings', values)
          summary.reload()
          setNotice(t('settings.saved'))
        } catch (error) {
          setNotice(`${t('settings.failed')}：${String(error?.message ?? error)}`)
        }
      }

      const refresh = async probe => {
        setBusy(probe ? 'probe' : 'refresh')
        setNotice('')
        try {
          await post('/refresh', { probe }, probe ? 20 * 60_000 : 60_000)
          summary.reload()
        } catch (error) {
          setNotice(String(error?.message ?? error))
        } finally {
          setBusy('')
        }
      }

      const test = async model => {
        setTests(current => ({ ...current, [model.id]: { running: true } }))
        try {
          const result = await post('/test', { id: model.id }, 330_000)
          setTests(current => ({ ...current, [model.id]: { running: false, ...result } }))
          summary.reload()
        } catch (error) {
          setTests(current => ({
            ...current,
            [model.id]: { running: false, ok: false, error: String(error?.message === 'timeout' ? t('test.timeout') : error?.message ?? error) },
          }))
        }
      }

      if (summary.status === 'loading') return h('div', { className: 'ofmlite_root' }, h('p', { className: 'ofmlite_muted' }, t('loading')))
      if (summary.status === 'error') {
        return h('div', { className: 'ofmlite_root' },
          h('div', { className: 'ofmlite_error' }, h('b', null, t('loadFailed')), h('div', null, summary.error)),
          h('button', { type: 'button', className: 'ofmlite_btn', onClick: () => summary.reload() }, t('retry')))
      }

      const data = summary.data
      const counts = data.counts ?? { total: 0 }
      const models = data.models ?? []
      return h('div', { className: 'ofmlite_root' },
        h('header', { className: 'ofmlite_hero' },
          h('div', null,
            h('h2', { className: 'ofmlite_title' }, t('title')),
            h('p', { className: 'ofmlite_sub' }, t('subtitle'))),
          h('div', { className: 'ofmlite_heroside' },
            data.egress?.ip ? h('span', { className: 'ofmlite_muted' }, `${t('egress.label')} ${data.egress.ip}${data.egress.country ? ` (${data.egress.country})` : ''}`) : null,
            h('span', { className: 'ofmlite_muted' }, fmt(t('counts.total'), { n: counts.total })))),

        h('div', { className: 'ofmlite_toolbar' },
          h('div', { className: 'ofmlite_counts' },
            h('span', { className: 'ofmlite_count ok' }, fmt(t('counts.ok'), { n: counts.available ?? 0 })),
            h('span', { className: 'ofmlite_count muted' }, fmt(t('counts.unknown'), { n: counts.unknown ?? 0 }))),
          h('div', { className: 'ofmlite_actions' },
            h('button', { type: 'button', className: 'ofmlite_btn', disabled: busy !== '', onClick: () => refresh(false) },
              busy === 'refresh' ? t('refreshing') : t('refresh')),
            h('button', { type: 'button', className: 'ofmlite_btn primary', disabled: busy !== '', onClick: () => refresh(true), title: t('probe.hint') },
              busy === 'probe' ? t('probing') : t('reprobe')))),

        notice ? h('div', { className: 'ofmlite_notice' }, notice) : null,

        h('section', { className: 'ofmlite_settings' },
          h(Switch, { checked: data.settings.enabled, label: t('enabled'), hint: t('enabled.hint'), onChange: value => patch({ enabled: value }) }),
          h(Switch, { checked: data.settings.exposeRegionModels, label: t('expose'), hint: t('expose.hint'), onChange: value => patch({ exposeRegionModels: value }) }),
          h(NumberField, { label: t('interval'), value: data.settings.probeIntervalMinutes, min: 1, max: 1440, onCommit: value => patch({ probeIntervalMinutes: value }) })),

        models.length === 0
          ? h('div', { className: 'ofmlite_empty' }, h('div', null, t('empty')), h('div', { className: 'ofmlite_muted' }, t('empty.hint')))
          : h('div', { className: 'ofmlite_list' }, models.map(model => h(ModelRow, {
            key: model.id, t, model,
            busy: tests[model.id]?.running === true,
            result: tests[model.id],
            onTest: test,
          }))))
    }

    // ── styles ────────────────────────────────────────────────────────────────
    const CSS = `
      .ofmlite_root{display:flex;flex-direction:column;gap:16px;padding:4px 2px 32px;color:inherit;font-size:13px}
      .ofmlite_hero{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .ofmlite_title{margin:0;font-size:20px;font-weight:700;letter-spacing:-.3px}
      .ofmlite_sub{margin:6px 0 0;max-width:72ch;line-height:1.55;opacity:.72}
      .ofmlite_heroside{display:flex;flex-direction:column;gap:4px;align-items:flex-end;font-size:12px}
      .ofmlite_muted{opacity:.62}
      .ofmlite_toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;border:1px solid rgba(127,127,127,.22);border-radius:12px;background:rgba(127,127,127,.06)}
      .ofmlite_counts{display:flex;gap:10px;align-items:center}
      .ofmlite_count{font-weight:600}
      .ofmlite_count.ok{color:#2f9e6b}
      .ofmlite_actions{display:flex;gap:8px}
      .ofmlite_btn{appearance:none;border:1px solid rgba(127,127,127,.32);background:transparent;color:inherit;border-radius:9px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer;transition:background .15s ease,opacity .15s ease}
      .ofmlite_btn:hover{background:rgba(127,127,127,.14)}
      .ofmlite_btn:disabled{opacity:.5;cursor:default}
      .ofmlite_btn.primary{border-color:rgba(80,130,255,.5);background:rgba(80,130,255,.14)}
      .ofmlite_btn.subtle{padding:4px 10px;font-weight:500;border-radius:8px;font-size:12px}
      .ofmlite_settings{display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;padding:14px;border:1px solid rgba(127,127,127,.18);border-radius:12px}
      .ofmlite_switch{display:flex;gap:10px;align-items:flex-start;max-width:280px;cursor:pointer}
      .ofmlite_switch input{position:absolute;opacity:0;width:0;height:0}
      .ofmlite_track{position:relative;flex:0 0 34px;height:20px;margin-top:1px;border-radius:999px;background:rgba(127,127,127,.36);transition:background .15s ease}
      .ofmlite_switch input:checked+.ofmlite_track{background:rgba(80,130,255,.75)}
      .ofmlite_knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease;box-shadow:0 1px 3px rgba(0,0,0,.3)}
      .ofmlite_switch input:checked+.ofmlite_track .ofmlite_knob{transform:translateX(14px)}
      .ofmlite_switchtext{display:flex;flex-direction:column;gap:3px}
      .ofmlite_switchlabel{font-weight:600}
      .ofmlite_hint{font-size:12px;line-height:1.45;opacity:.6}
      .ofmlite_field{display:flex;flex-direction:column;gap:6px}
      .ofmlite_field input{width:110px;padding:6px 8px;border-radius:8px;border:1px solid rgba(127,127,127,.32);background:rgba(127,127,127,.06);color:inherit;font:inherit}
      .ofmlite_notice{padding:8px 12px;border-radius:9px;background:rgba(127,127,127,.1);font-size:12px}
      .ofmlite_list{display:flex;flex-direction:column;border:1px solid rgba(127,127,127,.18);border-radius:12px;overflow:hidden}
      .ofmlite_row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;padding:12px 14px;border-top:1px solid rgba(127,127,127,.14)}
      .ofmlite_row:first-child{border-top:0}
      .ofmlite_rowmain{min-width:0}
      .ofmlite_rowtitle{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .ofmlite_name{font-weight:650;overflow-wrap:anywhere}
      .ofmlite_rowsub{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;font-size:12px;opacity:.66;overflow-wrap:anywhere}
      .ofmlite_dot{opacity:.4}
      .ofmlite_rowside{display:flex;gap:8px;align-items:center}
      .ofmlite_badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(127,127,127,.3);font-size:11px;font-weight:650;letter-spacing:.2px}
      .ofmlite_badge.tone-ok{color:#2f9e6b;border-color:rgba(47,158,107,.45);background:rgba(47,158,107,.1)}
      .ofmlite_badge.tone-warn{color:#c98a1e;border-color:rgba(201,138,30,.45);background:rgba(201,138,30,.1)}
      .ofmlite_badge.tone-bad{color:#c9524a;border-color:rgba(201,82,74,.45);background:rgba(201,82,74,.1)}
      .ofmlite_badge.tone-muted{opacity:.65}
      .ofmlite_result{grid-column:1 / -1;font-size:12px;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.08)}
      .ofmlite_result.ok{color:#2f9e6b}
      .ofmlite_result.bad{color:#c9524a}
      .ofmlite_sample{margin-top:4px;opacity:.7;overflow-wrap:anywhere}
      .ofmlite_detail{grid-column:1 / -1;font-size:12px;opacity:.6;overflow-wrap:anywhere}
      .ofmlite_error{padding:12px 14px;border-radius:10px;background:rgba(201,82,74,.12);border:1px solid rgba(201,82,74,.35)}
      .ofmlite_empty{display:flex;flex-direction:column;gap:6px;padding:24px;border:1px dashed rgba(127,127,127,.3);border-radius:12px;text-align:center}
      @media(max-width:560px){.ofmlite_row{grid-template-columns:1fr}.ofmlite_rowside{justify-content:flex-start}}
    `

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'our-free-model: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-our-free-model')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'our-free-model: styles')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'our-free-model',
        order: 35,
        label: () => t('nav'),
        locale: NS,
      }, props => h(SettingsPage, { ...props, locale: localeTag(ctx), ctx })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'our-free-model'
    exports.__test = { DICT, SettingsPage, ModelRow, api }
    return module.exports
  },
})
