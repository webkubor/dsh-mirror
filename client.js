/**
 * dsh-user-mirror 浏览器半侧：在「对话 / 轨迹」后面加一个「记忆」tab。
 *
 * 数据通道：host 端 /dsh-mirror/preferences（见 index.js），本半侧 fetch 它。
 *
 * ── 这个 tab 只回答两个问题 ──────────────────────────────────
 *   1. 模型这一轮到底看到了哪几条？（生效区，带 token 数）
 *   2. 我存的那些，它没看到的是什么、为什么？（未生效区，标出原因）
 *
 * 为什么砍到只剩这两件事：v0.8 之前这个 tab 长 3306px / 8 个 block，其中
 * 画像速写、四类强度计、说明折叠、扩展家族广告四块合计 1200+ px，删掉不损失
 * 任何信息。更糟的是它宣称「22 条判断在生效」而实际只注入 5 条 —— 界面在骗人，
 * 用户花力气看的东西从来没生效过。host 端现在给每条打 injected 标记，这里
 * 的第一职责就是如实显示，不再自己编一套好看的说法。
 */
window.__ModuleLoader__.load({
  id: '@dsh-plugins/dsh-user-mirror',
  factory: (require) => {
    const React = require('react')
    const exports = {}
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // token 名全部来自 dsh-bloom-theme 的真实定义（grep 校验过）：
    // label-primary / label-secondary / label-tertiary、
    // bg-layer-1 / bg-layer-2 / bg-layer-3、border-l1、brand-primary、
    // state-error-primary / state-success-primary
    const CSS = `
      .dsh-mirror-view {
        padding: 16px 20px 120px; font-size: 13px; line-height: 1.6; height: 100%; overflow: auto;
      }
      /* 限宽居中：超宽屏上铺满会把每行拉到 100+ 字，判断本身就读不下去了。
         底部留出输入框高度，否则最后一条永远压在下面。 */
      .dsh-mirror-view > * { max-width: 860px; margin-left: auto; margin-right: auto; }

      @keyframes dmr-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes dmr-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }

      /* ── 头：状态球 + 一行实况 ───────────────────────────── */
      .dmr-head {
        display: flex; gap: 11px; align-items: flex-start;
        padding: 12px 14px; border-radius: 12px; margin-bottom: 4px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02));
        border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
        animation: dmr-fade .35s ease both;
      }
      .dsh-mirror-orb { flex: none; display: flex; align-items: center; }
      .dsh-mirror-orb:empty { display: none; }
      .dsh-mirror-orb-fallback { flex: none; font-size: 18px; line-height: 1; }
      .dmr-head-body { flex: 1; min-width: 0; }
      .dmr-head-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .dmr-eyebrow {
        font-size: 10px; letter-spacing: .15em; text-transform: uppercase;
        color: var(--dsw-alias-label-tertiary, #999);
      }
      .dsh-mirror-refresh {
        background: none; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));
        color: var(--dsw-alias-label-secondary, #666); border-radius: 7px;
        font-size: 11.5px; padding: 2px 9px; cursor: pointer; font-family: inherit;
      }
      .dsh-mirror-refresh:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04)); }
      .dsh-mirror-refresh:disabled { opacity: .5; cursor: default; }
      /* 这一行是整个 tab 的核心断言：模型这一轮真的看到了几条 */
      .dmr-budget {
        font-size: 14px; color: var(--dsw-alias-label-primary, #222);
        margin: 3px 0 0; font-variant-numeric: tabular-nums; letter-spacing: -.002em;
      }
      .dmr-budget b { font-weight: 650; }
      .dmr-budget .dim { color: var(--dsw-alias-label-tertiary, #999); }
      /* 注意：注入条数**不**因存在未注入条目而标红 —— 19 条生效不是坏事，
         标红会被读成「19 有问题」。该警示的是下面那条折叠区，不是这个数字。 */
      /* 预算条：满了就说明后面的都进不来 */
      .dmr-budget-bar {
        height: 2px; border-radius: 2px; margin-top: 8px; overflow: hidden;
        background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.06));
      }
      .dmr-budget-bar i { display: block; height: 100%; background: var(--dsw-alias-brand-primary, #8b5cf6); }

      /* ── 分区标题 ─────────────────────────────────────── */
      .dmr-sec {
        display: flex; align-items: baseline; gap: 9px;
        margin: 20px 0 9px; animation: dmr-rise .3s ease both;
      }
      .dmr-sec h4 {
        margin: 0; font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
        color: var(--dsw-alias-label-secondary, #666); font-weight: 600;
      }
      .dmr-sec .n { font-size: 11px; color: var(--dsw-alias-label-tertiary, #999); font-variant-numeric: tabular-nums; }
      .dmr-sec .hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #999); }

      /* ── 记忆行：一行一条判断，不做卡片墙 ────────────────── */
      .dmr-row {
        display: flex; gap: 10px; align-items: flex-start;
        padding: 9px 11px; border-radius: 9px; margin-bottom: 4px;
        background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.015));
        border: 1px solid transparent;
        animation: dmr-rise .3s ease both;
      }
      .dmr-row:hover { border-color: var(--dsw-alias-border-l1, rgba(0,0,0,.07)); }
      .dmr-row.is-dead { opacity: .62; }
      .dmr-row.is-redline { border-left: 2px solid var(--dsw-alias-state-error-primary, #d44); }
      .dmr-row-t { flex: 1; min-width: 0; }
      .dmr-row-text { margin: 0; color: var(--dsw-alias-label-primary, #222); overflow-wrap: anywhere; }
      .dmr-row-meta {
        display: flex; gap: 9px; align-items: center; margin-top: 4px;
        font-size: 11px; color: var(--dsw-alias-label-tertiary, #999);
        font-variant-numeric: tabular-nums; flex-wrap: wrap;
      }
      .dmr-chip {
        font-size: 10px; letter-spacing: .04em; padding: 0 5px; border-radius: 4px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));
        color: var(--dsw-alias-label-secondary, #666);
      }
      .dmr-chip.is-red { color: var(--dsw-alias-state-error-primary, #d44); }
      .dmr-tag { font-size: 10px; padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-state-error-primary, #d44); color: #fff; }
      .dmr-why-btn {
        background: none; border: none; padding: 0; cursor: pointer; font-family: inherit;
        color: var(--dsw-alias-label-tertiary, #999); font-size: 11px;
        text-decoration: underline; text-underline-offset: 2px;
      }
      .dmr-why {
        margin: 6px 0 2px; padding: 7px 9px; border-radius: 7px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03));
        color: var(--dsw-alias-label-secondary, #666); font-size: 11.5px; line-height: 1.62;
      }
      .dmr-forget {
        flex: none; background: none; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));
        color: var(--dsw-alias-label-tertiary, #999); border-radius: 6px;
        min-width: 24px; height: 22px; padding: 0 5px; cursor: pointer;
        font-size: 11px; line-height: 1; font-family: inherit;
      }
      .dmr-forget:hover { color: var(--dsw-alias-state-error-primary, #d44); }
      .dmr-forget.is-confirming {
        color: #fff; background: var(--dsw-alias-state-error-primary, #d44);
        border-color: var(--dsw-alias-state-error-primary, #d44);
      }

      /* ── 折叠区（未生效 / 引导词）──────────────────────── */
      .dmr-fold {
        margin-top: 18px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.07));
        padding-top: 12px;
      }
      .dmr-fold > summary {
        cursor: pointer; font-size: 12.5px; color: var(--dsw-alias-label-secondary, #666);
        list-style: none; display: flex; align-items: center; gap: 7px;
      }
      .dmr-fold > summary::-webkit-details-marker { display: none; }
      .dmr-fold > summary::before { content: '▸'; font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); }
      .dmr-fold[open] > summary::before { content: '▾'; }
      .dmr-fold-body { margin-top: 10px; }
      .dmr-fold-note { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #999); margin: 0 0 8px; line-height: 1.6; }

      /* 引导词列表 */
      .dmr-g-list { list-style: none; margin: 0; padding: 0; }
      .dmr-g-item {
        padding: 7px 10px; border-radius: 8px; margin-bottom: 3px;
        background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.015));
        font-size: 12px; color: var(--dsw-alias-label-secondary, #666);
      }
      .dmr-g-top { display: flex; gap: 7px; align-items: center; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #999); }
      .dmr-g-ok { color: var(--dsw-alias-state-success-primary, #3a7); }
      .dmr-g-desc { margin-top: 2px; color: var(--dsw-alias-label-primary, #222); }
      .dmr-note {
        font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary, #666);
        background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.015));
        padding: 10px 12px; border-radius: 9px; margin-top: 8px;
      }
      .dmr-note code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04)); padding: 0 4px; border-radius: 4px;
      }
    `
    function injectCSS() {
      if (document.getElementById('dsh-mirror-css')) return
      const el = document.createElement('style')
      el.id = 'dsh-mirror-css'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /** ai-orb 的同源静态路径 —— host 端把 node_modules/ai-orb/src/ 整目录下发了。 */
    const ORB_MODULE = '/dsh-mirror/vendor/ai-orb/index.js'
    /** 状态球「刚记下」的高亮窗口。 */
    const LEARNED_WINDOW_MS = 60 * 1000

    /** 浏览器语言：中文浏览器显示中文，其余显示英文。 */
    const IS_ZH = /^zh(?:-|$)/i.test(navigator.language || '')
    const TEXT = {
      zh: {
        orb: { idle: '待命', thinking: '正在读记忆', working: '正在刷新', done: '刚记下新偏好', error: '读取失败' },
        kinds: { redline: '红线', principle: '原则 / 取舍', workflow: '工作方式', taste: '审美 / 表达' },
        justNow: '刚刚', minute: '分钟前', hour: '小时前', day: '天前',
      },
      en: {
        orb: { idle: 'idle', thinking: 'reading memory', working: 'refreshing', done: 'new preference learned', error: 'read failed' },
        kinds: { redline: 'Red lines', principle: 'Principles / trade-offs', workflow: 'Workflow', taste: 'Taste / expression' },
        justNow: 'just now', minute: ' min ago', hour: ' hr ago', day: ' days ago',
      },
    }
    const T = IS_ZH ? TEXT.zh : TEXT.en
    const tr = (zh, en) => (IS_ZH ? zh : en)
    const ORB_LABELS = Object.fromEntries(
      Object.entries(T.orb).map(([k, v]) => [k, 'dsh-mirror · ' + v]),
    )

    /** 视图状态 → 球的表情。 */
    function orbStateOf(s, now) {
      if (s.error) return ['error', 0]
      if (s.refreshing) return ['working', 0]
      if (s.loading) return ['thinking', 0]
      const learned = s.lastLearned
      if (learned && learned.count > 0 && now - learned.at < LEARNED_WINDOW_MS) {
        return ['done', learned.count]
      }
      return ['idle', 0]
    }

    /** 相对时间：模型认得「3 小时前」，不认得「1790578297411」。 */
    function timeAgo(ts) {
      const s = Math.max(0, (Date.now() - ts) / 1000)
      if (s < 60) return T.justNow
      if (s < 3600) return Math.floor(s / 60) + T.minute
      if (s < 86400) return Math.floor(s / 3600) + T.hour
      return Math.floor(s / 86400) + T.day
    }

    /** 记忆 tab 组件。 */
    function MemoryView() {
      const [state, setState] = React.useState({
        loading: true,
        refreshing: false,
        memories: [],
        budget: { maxTokens: 500, usedTokens: 0, injectedCount: 0, totalCount: 0 },
        error: null,
        lastLearned: null,
        guidance: null,
      })
      // 球是装饰件：拿不到就退回 🪞，不能让它挡住列表
      const [orbReady, setOrbReady] = React.useState(false)
      // 待确认删除的那条 id —— 两段式，第一下只是亮起来，不直接删
      const [pendingForget, setPendingForget] = React.useState(null)
      // 展开证据的那条 id
      const [openWhy, setOpenWhy] = React.useState(null)
      const orbHost = React.useRef(null)
      const orb = React.useRef(null)

      const load = React.useCallback((manual) => {
        setState((s) => ({ ...s, loading: !manual, refreshing: !!manual }))
        Promise.all([
          fetch('/dsh-mirror/preferences').then((r) => r.json()),
          fetch('/dsh-mirror/guidance').then((r) => r.json()).catch(() => null),
        ]).then(([pref, guide]) =>
          setState({
            loading: false,
            refreshing: false,
            memories: pref.memories || [],
            budget: pref.budget || { maxTokens: 500, usedTokens: 0, injectedCount: 0, totalCount: 0 },
            error: null,
            lastLearned: pref.lastLearned || null,
            guidance: guide,
          }),
        ).catch((e) =>
          setState((s) => ({ ...s, loading: false, refreshing: false, error: String(e) })),
        )
      }, [])

      React.useEffect(() => {
        injectCSS()
        load(false)
      }, [load])

      const forget = React.useCallback(
        (id) => {
          setPendingForget(null)
          fetch('/dsh-mirror/forget/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(() => load(true))
            .catch(() => load(true))
        },
        [load],
      )

      // 挂载 ai-orb —— host 端 vendor 路由下发的 npm 真源，不是抄一份进来
      React.useEffect(() => {
        let disposed = false
        import(ORB_MODULE)
          .then(({ AgentOrb }) => {
            if (disposed || !orbHost.current) return
            orb.current = new AgentOrb(orbHost.current, {
              size: 24,
              theme: 'violet',
              shape: 'circle',
              follow: false, // 24px 的小球跟不出效果，省掉全局 mousemove
              labels: ORB_LABELS,
            })
            setOrbReady(true)
          })
          .catch(() => { /* 球没加载出来就用 🪞 兜底，列表照常 */ })
        return () => {
          disposed = true
          if (orb.current) { orb.current.destroy(); orb.current = null }
        }
      }, [])

      const [orbState, orbUnseen] = orbStateOf(state, Date.now())
      React.useEffect(() => {
        if (orb.current) orb.current.set(orbState, orbUnseen)
      }, [orbState, orbUnseen])

      // done 是有时效的：窗口一过要自己回落 idle，否则角标会一直挂着
      React.useEffect(() => {
        if (orbState !== 'done' || !state.lastLearned) return
        const left = LEARNED_WINDOW_MS - (Date.now() - state.lastLearned.at)
        if (left <= 0) return
        const t = setTimeout(() => setState((s) => ({ ...s })), left + 100)
        return () => clearTimeout(t)
      }, [orbState, state.lastLearned])

      const live = state.memories.filter((m) => m.injected)
      const dead = state.memories.filter((m) => !m.injected)
      const b = state.budget
      const pct = b.maxTokens ? Math.min(100, Math.round((b.usedTokens / b.maxTokens) * 100)) : 0

      const head = React.createElement('div', { className: 'dmr-head' },
        // 这个容器的 children 必须恒为空：AgentOrb 是命令式 append 进来的，
        // 一旦让 React 管它的 children，下一次重渲染就会把球一起清掉。
        React.createElement('div', { className: 'dsh-mirror-orb', ref: orbHost }),
        orbReady ? null : React.createElement('span', { className: 'dsh-mirror-orb-fallback' }, '🪞'),
        React.createElement('div', { className: 'dmr-head-body' },
          React.createElement('div', { className: 'dmr-head-top' },
            React.createElement('div', { className: 'dmr-eyebrow' }, tr('记忆', 'Memory')),
            React.createElement('button', {
              className: 'dsh-mirror-refresh',
              onClick: () => load(true),
              disabled: state.refreshing,
            }, state.refreshing ? tr('刷新中…', 'Refreshing…') : tr('刷新', 'Refresh')),
          ),
          // 唯一需要抬头看的一行：模型这一轮真的看到了几条
          React.createElement('p', { className: 'dmr-budget' },
            tr('本轮注入 ', 'Injected now: '),
            React.createElement('b', null, String(b.injectedCount)),
            ' ',
            React.createElement('span', { className: 'dim' },
              tr(`条 · 共存 ${b.totalCount} 条 · 预算用了 ${b.usedTokens}/${b.maxTokens} tok`,
                 `of ${b.totalCount} stored · ${b.usedTokens}/${b.maxTokens} tok used`)),
          ),
          React.createElement('div', { className: 'dmr-budget-bar' },
            React.createElement('i', { style: { width: pct + '%' } })),
        ),
      )

      const chip = (m) => React.createElement('span', {
        className: 'dmr-chip' + (m.kind === 'redline' ? ' is-red' : ''),
      }, T.kinds[m.kind] || m.kind)

      const row = (m) => {
        const open = openWhy === m.id
        const confirming = pendingForget === m.id
        return React.createElement('div', {
          className: 'dmr-row' + (m.injected ? '' : ' is-dead') + (m.kind === 'redline' ? ' is-redline' : ''),
          key: m.id,
        },
          React.createElement('div', { className: 'dmr-row-t' },
            React.createElement('p', { className: 'dmr-row-text' }, m.text),
            React.createElement('div', { className: 'dmr-row-meta' },
              chip(m),
              React.createElement('span', null, m.tokens + ' tok'),
              React.createElement('span', null, m.hits + tr(' 次印证', ' confirmed')),
              React.createElement('span', null, timeAgo(m.lastSeenAt)),
              m.overlong
                ? React.createElement('span', {
                    className: 'dmr-tag',
                    title: tr('超过单条上限，永远不注入。该搬去 guidance/ 或 reference/',
                              'Over the per-item cap; never injected. Move it to guidance/ or reference/'),
                  }, tr('超长', 'too long'))
                : null,
              m.reason
                ? React.createElement('button', {
                    className: 'dmr-why-btn',
                    'aria-expanded': open ? 'true' : 'false',
                    onClick: () => setOpenWhy(open ? null : m.id),
                  }, open ? tr('收起', 'Collapse') : tr('证据', 'Evidence'))
                : null,
            ),
            open && m.reason ? React.createElement('div', { className: 'dmr-why' }, m.reason) : null,
          ),
          React.createElement('button', {
            className: 'dmr-forget' + (confirming ? ' is-confirming' : ''),
            title: confirming ? tr('再点一次就真的撤掉', 'Click again to remove') : tr('撤掉这条', 'Remove'),
            onClick: () => (confirming ? forget(m.id) : setPendingForget(m.id)),
            onBlur: () => confirming && setPendingForget(null),
          }, confirming ? tr('确认?', 'Sure?') : '✕'),
        )
      }

      // ── 手写引导词：真源在 ~/.dsh/memory/guidance/，是另一个功能 ──
      const guidanceFold = () => {
        const g = state.guidance
        if (!g) {
          return React.createElement('details', { className: 'dmr-fold' },
            React.createElement('summary', null, tr('手写引导词 · 读不到', 'Hand-written guidance · unreachable')),
            React.createElement('div', { className: 'dmr-fold-body' },
              React.createElement('p', { className: 'dmr-fold-note' },
                tr('/dsh-mirror/guidance 无响应。引导词照常注入系统提示，只是这里看不到。',
                   '/dsh-mirror/guidance unreachable. Guidance is still injected; only this view is missing.')),
            ),
          )
        }
        const liveG = (g.entries || []).filter((e) => e.injected)
        const deadG = (g.entries || []).filter((e) => !e.injected)
        const diags = g.diagnostics || []
        return React.createElement('details', { className: 'dmr-fold' },
          React.createElement('summary', null,
            tr(`手写引导词 · 本会话注入 ${liveG.length} 条`,
               `Hand-written guidance · ${liveG.length} injected`)),
          React.createElement('div', { className: 'dmr-fold-body' },
            React.createElement('p', { className: 'dmr-fold-note' },
              tr('你手写的规矩。真源在 ~/.dsh/memory/guidance/ —— 只进 description 一行，全文用 memory_read 取。',
                 'Rules you wrote by hand. Source of truth: ~/.dsh/memory/guidance/ — one description line each, full text via memory_read.')),
            React.createElement('ul', { className: 'dmr-g-list' }, liveG.map((e) =>
              React.createElement('li', { className: 'dmr-g-item', key: e.file },
                React.createElement('div', { className: 'dmr-g-top' },
                  React.createElement('span', null, 'p' + e.priority),
                  React.createElement('span', { className: 'dmr-g-ok' }, '✓ ' + tr('已注入', 'injected')),
                  React.createElement('span', null, e.file)),
                React.createElement('div', { className: 'dmr-g-desc' }, e.description),
              ))),
            deadG.length
              ? React.createElement('p', { className: 'dmr-fold-note', style: { marginTop: '8px' } },
                  '⚠ ' + tr(`${deadG.length} 条未注入（预算 ${g.usedChars}/${g.maxChars} 字符）：`,
                             `${deadG.length} not injected (budget ${g.usedChars}/${g.maxChars} chars): `) +
                  deadG.map((e) => e.file).join('、'))
              : null,
            diags.length
              ? React.createElement('p', { className: 'dmr-fold-note', style: { marginTop: '8px' } },
                  '⚠ ' + tr('这些文件没被加载：', 'These files were not loaded: ') +
                  diags.map((x) => x.message).join('；'))
              : null,
          ),
        )
      }

      let content
      if (state.loading) {
        content = React.createElement('p', { className: 'dmr-fold-note' }, tr('加载中…', 'Loading…'))
      } else if (state.error) {
        content = React.createElement('p', { className: 'dmr-fold-note' },
          tr('加载失败：', 'Load failed: ') + state.error)
      } else if (state.memories.length === 0) {
        content = React.createElement('div', { className: 'dmr-note' },
          tr('还没有任何记忆。等你表达出某条原则或取舍时，模型会当场用 mirror_remember 记下来 —— 你会在对话里看到它记了什么。',
             'No memories yet. When you express a reusable principle or trade-off, the model records it with mirror_remember — you will see it in the conversation.'))
      } else {
        content = React.createElement(React.Fragment, null,
          live.length
            ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'dmr-sec' },
                  React.createElement('h4', null, tr('模型这轮看到的', 'Injected every turn')),
                  React.createElement('span', { className: 'n' }, String(live.length)),
                  React.createElement('span', { className: 'hint' },
                    tr('每轮都进系统提示', 'in the system prompt every turn')),
                ),
                live.map(row),
              )
            : React.createElement('p', { className: 'dmr-fold-note' },
                tr('没有一条记忆进得了预算 —— 存的都超长或太弱，模型这一轮看不到任何一条。',
                   'Nothing fits the budget — everything stored is over-long or too weak. The model sees none of it.')),
          // 没生效的一律折叠。默认摊开一条条列出来是在骗注意力：
          // 它们不占系统提示，用户对它们唯一有用的动作是「搬到该去的地方」或「删掉」。
          dead.length
            ? React.createElement('details', { className: 'dmr-fold' },
                React.createElement('summary', null,
                  tr(`${dead.length} 条存在但没注入`, `${dead.length} stored but not injected`)),
                React.createElement('div', { className: 'dmr-fold-body' },
                  React.createElement('p', { className: 'dmr-fold-note' },
                    tr('它们不占系统提示，所以现在不影响模型。超长的该搬去 ~/.dsh/memory/guidance/ 或 reference/；其余的改短或删掉就能进预算。',
                       'They do not enter the system prompt, so they do not affect the model. Over-long ones belong in ~/.dsh/memory/guidance/ or reference/; shorten or delete the rest to make room.')),
                  dead.map(row),
                ),
              )
            : null,
          guidanceFold(),
        )
      }

      return React.createElement('div', { className: 'dsh-mirror-view' }, head, content)
    }

    exports.name = 'dsh-user-mirror'

    /**
     * cordis fiber inject —— 必须在这里声明，否则访问 ctx.slots 会抛
     * `cannot get property "slots" without inject`。
     * 注意 package.json 的 dsh.client.inject 是 informational（加载/预取元数据，
     * 不做 apply 排序），起不到服务守卫作用，两者不能混为一谈。
     */
    exports.inject = ['slots']

    exports.apply = function apply(ctx) {
      // conversation.view 这个 slot 由 ui-conversation 声明，激活顺序不保证，
      // 所以依赖 slots.inject 等它上账，而不是假定顺序直接 register。
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'memory',
            order: 20,
            label: () => tr('记忆', 'Memory'),
          },
          MemoryView,
        ),
      )
    }

    return exports
  },
})
