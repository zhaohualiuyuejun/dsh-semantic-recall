/**
 * dsh-semantic-recall —— 浏览器半端：设置页（settings.section）
 *
 * 为什么自己写页面：本机 DSH 0.2.1-rc.5 的 settings.update() 返回成功但不落盘
 * ⇒ 页面直接打自己的 /api/session-recall/*，写插件自己的 config.json，任何版本都能用。
 *
 * 界面口径（2026-10-31 按用户反馈定）：
 *   · 嵌入只有「云端 / 本地」两种，**不写任何厂商名**
 *   · 排除工作区 = 列出 DSH 里所有工作区，✅ 就索引、不 ✅ 就不索引
 *   · 话题卡本地模型留空 = 用 DSH 自己的模型总结
 */
window.__ModuleLoader__.load({
  id: 'dsh-semantic-recall',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/session-recall'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      let why = ''
      try { why = (await res.json())?.error || '' } catch { /* 忽略 */ }
      throw new Error(`HTTP ${res.status}${why ? `：${why}` : ''}`)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-sr-root]{display:flex;flex-direction:column;gap:17px;padding:2px 2px 10px;max-width:700px;font-size:13px;}
[data-sr-sec]{display:flex;flex-direction:column;gap:9px;}
[data-sr-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sr-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-sr-label]{font-size:13px;min-width:96px;}
[data-sr-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sr-in]{flex:1;min-width:180px;padding:6px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.04));
  color:var(--dsw-alias-label-primary,#e8eaed);outline:none;}
[data-sr-in]:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff);}
[data-sr-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-bg-tertiary,rgba(255,255,255,.16));transition:background .15s;}
[data-sr-sw][data-on="1"]{background:var(--dsw-alias-brand-primary,#4c8dff);}
[data-sr-sw]::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;
  background:#fff;transition:transform .15s;}
[data-sr-sw][data-on="1"]::after{transform:translateX(16px);}
[data-sr-btn]{padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;border:0;
  background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff;}
[data-sr-btn][data-ghost="1"]{background:transparent;color:var(--dsw-alias-label-primary,#e8eaed);
  border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));}
[data-sr-btn][data-on="1"]{background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff;
  border:1px solid var(--dsw-alias-brand-primary,#4c8dff);}
[data-sr-btn]:disabled{opacity:.5;cursor:default;}
[data-sr-card]{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:9px;
  padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.04));}
[data-sr-k]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sr-v]{font-size:13px;font-weight:600;}
[data-sr-msg]{font-size:12px;line-height:18px;padding:6px 10px;border-radius:8px;}
[data-sr-msg][data-kind="ok"]{background:rgba(76,175,80,.14);color:#8bd48f;}
[data-sr-msg][data-kind="err"]{background:rgba(244,67,54,.14);color:#ff9a90;}
[data-sr-msg][data-kind="warn"]{background:rgba(255,193,7,.14);color:#ffd479;}
[data-sr-bar]{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;}
[data-sr-bar]>i{display:block;height:100%;background:var(--dsw-alias-brand-primary,#4c8dff);transition:width .3s;}
[data-sr-ws]{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;
  border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.04));padding:6px 8px;}
[data-sr-wsr]{display:flex;align-items:center;gap:9px;padding:5px 4px;border-radius:7px;cursor:pointer;}
[data-sr-wsr]:hover{background:rgba(255,255,255,.05);}
[data-sr-wsr][data-off="1"]{opacity:.55;}
[data-sr-ck]{flex:none;width:18px;height:18px;border-radius:5px;display:flex;align-items:center;
  justify-content:center;font-size:12px;line-height:1;
  border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.22));}
[data-sr-ck][data-on="1"]{background:var(--dsw-alias-brand-primary,#4c8dff);border-color:var(--dsw-alias-brand-primary,#4c8dff);color:#fff;}
[data-sr-wsl]{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-sr-wsn]{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-sr-seg]{display:inline-flex;gap:0;border-radius:8px;overflow:hidden;
  border:1px solid var(--dsw-alias-border-secondary,rgba(255,255,255,.16));}
[data-sr-seg]>button{padding:6px 18px;font-size:12px;border:0;cursor:pointer;background:transparent;
  color:var(--dsw-alias-label-primary,#e8eaed);}
[data-sr-seg]>button[data-on="1"]{background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff;}
[data-sr-link]{font-size:11px;color:var(--dsw-alias-brand-primary,#4c8dff);cursor:pointer;text-decoration:underline;
  background:none;border:0;padding:0;}
`

    const FIELD = (label, node, note) => h('div', { 'data-sr-sec': '' },
      h('div', { 'data-sr-row': '' }, h('span', { 'data-sr-label': '' }, label), node),
      note ? h('div', { 'data-sr-note': '' }, note) : null)

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [cfg, setCfg] = React.useState(null)
      const [ws, setWs] = React.useState([])
      const [key, setKey] = React.useState('')
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const d = await jget('/state')
          setSt(d.status || null)
          setCfg(d.config || null)
        } catch (e) {
          setMsg({ kind: 'err', text: '读状态失败：' + e.message })
        }
      }, [])
      const loadWs = React.useCallback(async () => {
        try {
          const d = await jget('/workspaces')
          setWs(d.workspaces || [])
        } catch { /* 工作区列表拿不到不影响别的 */ }
      }, [])

      React.useEffect(() => { load(); loadWs() }, [load, loadWs])
      React.useEffect(() => {
        const t = setInterval(() => { load().catch(() => {}) }, 3000)
        return () => clearInterval(t)
      }, [load])

      const save = async (patch, okText) => {
        setBusy(true)
        setMsg(null)
        try {
          const d = await jpost('/config', { patch })
          setCfg(d.config || null)
          setSt(d.status || null)
          setKey('')
          setMsg({ kind: 'ok', text: okText || (d.rebuild ? '已保存，正在后台重建索引' : '已保存') })
          if ('excludeWorkspaces' in patch) loadWs()
        } catch (e) {
          setMsg({ kind: 'err', text: '保存失败：' + e.message })
        } finally { setBusy(false) }
      }

      const rebuild = async (force) => {
        setBusy(true)
        setMsg(null)
        try {
          const d = await jpost('/reindex', { force })
          setMsg({ kind: d.ok ? 'ok' : 'warn', text: d.note || '已开始' })
        } catch (e) {
          setMsg({ kind: 'err', text: '重建失败：' + e.message })
        } finally { setBusy(false) }
      }

      const toggleWs = (row) => {
        const next = ws.map((w) => (w.dir === row.dir ? { ...w, indexed: !w.indexed } : w))
        setWs(next)
        const exclude = next.filter((w) => !w.indexed).map((w) => w.dir).join(',')
        save({ excludeWorkspaces: exclude }, '工作区选择已保存，索引会在下次检查时同步')
      }

      if (!st || !cfg) {
        return h('div', { 'data-sr-root': '' }, h('div', { 'data-sr-note': '' }, '读取中…'))
      }

      const idx = st.index
      const b = st.lastBuild || {}
      const building = st.building || b.phase === 'building'
      const prog = typeof b.progress === 'number' ? Math.round(b.progress * 100) : null
      const mode = cfg.provider

      return h('div', { 'data-sr-root': '' },

        // ── 状态 ──────────────────────────────────────────────
        h('div', { 'data-sr-sec': '' },
          h('div', { 'data-sr-h': '' }, '状态'),
          h('div', { 'data-sr-card': '' },
            h('div', {}, h('div', { 'data-sr-k': '' }, '索引块数'), h('div', { 'data-sr-v': '' }, idx ? String(idx.chunks) : '无')),
            h('div', {}, h('div', { 'data-sr-k': '' }, '维度'), h('div', { 'data-sr-v': '' }, idx && idx.dim ? String(idx.dim) : '—')),
            h('div', {}, h('div', { 'data-sr-k': '' }, '体积'), h('div', { 'data-sr-v': '' }, idx ? `${idx.sizeMB} MB` : '—')),
            h('div', {}, h('div', { 'data-sr-k': '' }, '建于'), h('div', { 'data-sr-v': '' }, idx && idx.builtAt ? String(idx.builtAt).slice(5, 16).replace('T', ' ') : '—')),
            h('div', {}, h('div', { 'data-sr-k': '' }, '话题卡'), h('div', { 'data-sr-v': '' }, `${st.dayCards || 0} 天`)),
            h('div', {}, h('div', { 'data-sr-k': '' }, '检索方式'), h('div', { 'data-sr-v': '' },
              st.providerEffective === 'none' ? '字面' : st.providerEffective === 'cloud' ? '云端语义' : '本地语义')),
          ),
          building ? h('div', { 'data-sr-sec': '' },
            h('div', { 'data-sr-note': '' }, `正在建索引… ${prog !== null ? prog + '%' : ''} ${b.stage || ''}`),
            h('div', { 'data-sr-bar': '' }, h('i', { style: { width: `${prog ?? 10}%` } })),
          ) : null,
          b.error ? h('div', { 'data-sr-msg': '', 'data-kind': 'err' },
            `上次失败：${b.error}${b.errorHint ? ' — ' + b.errorHint : ''}`) : null,
          h('div', { 'data-sr-row': '' },
            h('button', { 'data-sr-btn': '', 'data-ghost': '1', disabled: busy || building, onClick: () => rebuild(false) }, '增量更新'),
            h('button', { 'data-sr-btn': '', 'data-ghost': '1', disabled: busy || building, onClick: () => rebuild(true) }, '全量重建'),
            h('span', { 'data-sr-note': '' }, '全量重建会重新嵌入全部块：通常需要数分钟，属于正常现象'),
          ),
        ),

        // ── 嵌入 ──────────────────────────────────────────────
        h('div', { 'data-sr-sec': '' },
          h('div', { 'data-sr-row': '' },
            h('div', { 'data-sr-h': '' }, '嵌入'),
            h('div', { style: { flex: '1' } }),
            mode !== 'none'
              ? h('button', {
                'data-sr-link': '', disabled: busy,
                onClick: () => save({ provider: 'none' }, '已停用嵌入：索引会重建为纯字面（不花钱）'),
              }, '停用嵌入')
              : null,
            mode !== 'none'
              ? h('span', { 'data-sr-note': '' }, '（停用嵌入功能，会导致检索能力下降）')
              : h('span', { 'data-sr-note': '' }, '（当前已停用：检索只用字面匹配，只能给候选）'),
          ),
          h('div', { 'data-sr-row': '' },
            h('span', { 'data-sr-label': '' }, '检索方式'),
            h('div', { 'data-sr-seg': '' },
              h('button', {
                'data-on': mode === 'cloud' ? '1' : '0', disabled: busy,
                onClick: () => mode !== 'cloud' && save({ provider: 'cloud' }),
              }, '云端'),
              h('button', {
                'data-on': mode === 'local' ? '1' : '0', disabled: busy,
                onClick: () => mode !== 'local' && save({ provider: 'local' }),
              }, '本地'),
            ),
          ),
          mode === 'none'
            ? h('div', { 'data-sr-msg': '', 'data-kind': 'warn' }, '当前没有启用嵌入（只做字面检索，只能给候选）。选「云端」或「本地」即可开启。')
            : null,

          // 云端
          mode === 'cloud' ? h('div', { 'data-sr-sec': '' },
            FIELD('API Key', h('input', {
              'data-sr-in': '', type: 'password', value: key,
              placeholder: cfg.apiKeySet ? '已设置（留空=不改）' : '粘贴 API Key',
              onChange: (e) => setKey(e.target.value),
            }), '只写在本机的配置文件里，不会出现在对话中'),
            h('div', { 'data-sr-row': '' },
              h('button', { 'data-sr-btn': '', disabled: busy || !key.trim(), onClick: () => save({ apiKey: key.trim() }, 'API Key 已保存') }, '保存 Key'),
              h('button', { 'data-sr-btn': '', 'data-ghost': '1', disabled: busy || !cfg.apiKeySet, onClick: () => save({ apiKey: '' }, 'API Key 已清除') }, '清除 Key'),
            ),
            FIELD('接口地址', h('input', {
              'data-sr-in': '', value: cfg.apiBase || '', placeholder: '任何 OpenAI 兼容的 /v1 地址（留空=内置默认）',
              onChange: (e) => setCfg({ ...cfg, apiBase: e.target.value }),
              onBlur: (e) => save({ apiBase: e.target.value }),
            }), '要求实现 /v1/embeddings'),
            FIELD('嵌入模型', h('input', {
              'data-sr-in': '', value: cfg.model || '', placeholder: '留空 = 内置默认模型',
              onChange: (e) => setCfg({ ...cfg, model: e.target.value }),
              onBlur: (e) => save({ model: e.target.value }),
            })),
          ) : null,

          // 本地
          mode === 'local' ? h('div', { 'data-sr-sec': '' },
            FIELD('本地服务地址', h('input', {
              'data-sr-in': '', value: cfg.localBase || '', placeholder: 'http://127.0.0.1:11434',
              onChange: (e) => setCfg({ ...cfg, localBase: e.target.value }),
              onBlur: (e) => save({ localBase: e.target.value }),
            }), '本机嵌入服务（默认即 Ollama）。⚠️ Ollama 必须带 --embeddings 启动，否则会报「不支持嵌入」'),
            FIELD('本地模型名', h('input', {
              'data-sr-in': '', value: cfg.model || '', placeholder: 'bge-m3',
              onChange: (e) => setCfg({ ...cfg, model: e.target.value }),
              onBlur: (e) => save({ model: e.target.value }),
            }), '填该服务里已下载的**嵌入模型**名字（不是对话模型）'),
          ) : null,

          mode === 'none'
            ? h('div', { 'data-sr-note': '' }, '想恢复检索能力：选上面的「云端」或「本地」即可。')
            : null,
        ),

        // ── 索引 ──────────────────────────────────────────────
        h('div', { 'data-sr-sec': '' },
          h('div', { 'data-sr-h': '' }, '索引'),
          FIELD('索引天数', h('input', {
            'data-sr-in': '', type: 'number', min: 1, max: 365, value: cfg.indexDays,
            onChange: (e) => setCfg({ ...cfg, indexDays: Number(e.target.value) }),
            onBlur: (e) => save({ indexDays: Number(e.target.value) }),
          }), '默认 7 天；想搜「上周」建议 14'),
          h('div', { 'data-sr-row': '' },
            h('span', { 'data-sr-label': '' }, '自动增量'),
            h('button', {
              'data-sr-sw': '', 'data-on': cfg.autoIndex ? '1' : '0', disabled: busy,
              onClick: () => save({ autoIndex: !cfg.autoIndex }),
            }),
            h('span', { 'data-sr-note': '' }, '启动时 + 每 6 小时检查一次'),
          ),
          h('div', { 'data-sr-row': '' }, h('span', { 'data-sr-label': '' }, '索引哪些工作区')),
          ws.length
            ? h('div', { 'data-sr-ws': '' },
              ...ws.map((w) => h('div', {
                'data-sr-wsr': '', 'data-off': w.indexed ? '0' : '1',
                onClick: () => !busy && toggleWs(w),
              },
              h('span', { 'data-sr-ck': '', 'data-on': w.indexed ? '1' : '0' }, w.indexed ? '✓' : ''),
              h('span', { 'data-sr-wsl': '', title: w.label }, w.label),
              h('span', { 'data-sr-wsn': '' }, `${w.sessions} 场${w.chunks ? ` · 已索引 ${w.chunks} 块` : ''}`),
              )))
            : h('div', { 'data-sr-note': '' }, '还没读到工作区（索引建好后就会出现）'),
          h('div', { 'data-sr-note': '' }, '勾上 = 索引；取消 = 不索引（隐私）。新出现的工作区默认是勾上的。'),
        ),

        // ── 话题卡 ────────────────────────────────────────────
        h('div', { 'data-sr-sec': '' },
          h('div', { 'data-sr-h': '' }, '每日话题卡'),
          h('div', { 'data-sr-row': '' },
            h('span', { 'data-sr-label': '' }, '启用'),
            h('button', {
              'data-sr-sw': '', 'data-on': cfg.daySummaries ? '1' : '0', disabled: busy,
              onClick: () => save({ daySummaries: !cfg.daySummaries }),
            }),
            h('span', { 'data-sr-note': '' }, '每天 3~5 个话题，用于「想不起来关键词」时给你挑'),
          ),
          FIELD('本地模型', h('input', {
            'data-sr-in': '', value: cfg.summaryModel || '', placeholder: '留空 = 用 DSH 当前的模型总结',
            onChange: (e) => setCfg({ ...cfg, summaryModel: e.target.value }),
            onBlur: (e) => save({ summaryModel: e.target.value }),
          }), '留空：走 DSH 自己的模型（会消耗额度）；填了：只用本机 Ollama 的这个模型（不出网）'),
        ),

        msg ? h('div', { 'data-sr-msg': '', 'data-kind': msg.kind }, msg.text) : null,
        h('div', { 'data-sr-note': '' }, '配置存在本机：' + (st.configPath || '')),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-semantic-recall')
        style.textContent = CSS
        document.head.appendChild(style)
        try { ctx.effect(() => () => style.remove(), 'semantic-recall: 设置页样式') } catch { /* 老版本没有 effect */ }

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'session-recall', order: 34, label: '会话语义检索' },
          () => h(Panel),
        ))
      },
    }
  },
})
