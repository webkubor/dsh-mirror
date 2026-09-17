/**
 * dsh-mirror 浏览器半侧：在「对话 / 轨迹」后面加一个「记忆」tab。
 *
 * 数据通道：host 端注册了 /dsh-mirror/preferences 端点（见 index.js），
 * 本半侧 fetch 它拿到记忆列表，实时展示。
 *
 * 结构：
 *  - conversation.view slot（id=memory, order=20）→ 排在对话(0)、轨迹(10) 之后
 *  - MemoryView 组件用 React hooks + fetch 渲染记忆列表
 */
window.__ModuleLoader__.load({
  id: 'dsh-user-mirror',
  factory: (require) => {
    const React = require('react')
    const exports = {}
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const CSS = `
      .dsh-mirror-view { padding: 16px; font-size: 13px; line-height: 1.6; height: 100%; overflow: auto; }
      .dsh-mirror-view h3 { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
      .dsh-mirror-view .dmr-sub { color: var(--dsw-alias-label-secondary, #888); font-size: 12px; margin-bottom: 12px; }
      .dsh-mirror-item {
        border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
        border-radius: 8px; padding: 8px 12px; margin-bottom: 8px;
        background: var(--dsw-alias-bg-layer-1, #fff);
      }
      .dsh-mirror-item .dmr-text { color: var(--dsw-alias-label-primary, #222); }
      .dsh-mirror-item .dmr-meta { color: var(--dsw-alias-label-tertiary, #aaa); font-size: 11px; margin-top: 4px; display: flex; gap: 10px; }
      .dsh-mirror-empty { color: var(--dsw-alias-label-tertiary, #aaa); text-align: center; padding: 40px 0; }
      .dsh-mirror-refresh {
        border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
        background: var(--dsw-alias-button-elevated-fill, #fff);
        color: var(--dsw-alias-label-primary, #222);
        border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px;
      }
      .dsh-mirror-refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
      .dsh-mirror-title { display: flex; align-items: center; gap: 8px; }
      .dsh-mirror-how {
        border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
        border-radius: 8px; padding: 10px 12px; margin: 4px 0 12px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02));
        font-size: 12px; line-height: 1.7;
      }
      .dsh-mirror-how summary { cursor: pointer; color: var(--dsw-alias-label-secondary, #888); }
      .dsh-mirror-how dl { margin: 8px 0 0; }
      .dsh-mirror-how dt { color: var(--dsw-alias-label-primary, #222); font-weight: 600; margin-top: 6px; }
      .dsh-mirror-how dd { margin: 2px 0 0; color: var(--dsw-alias-label-secondary, #888); }
      .dsh-mirror-how code {
        background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.05));
        padding: 1px 4px; border-radius: 4px; font-size: 11px;
      }
      .dmr-kind {
        flex: none; font-size: 11px; padding: 1px 6px; border-radius: 4px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
        color: var(--dsw-alias-label-secondary, #888);
      }
      .dmr-head { display: flex; align-items: baseline; gap: 6px; }
      .dmr-forget {
        margin-left: auto; flex: none; border: none; background: none; cursor: pointer;
        color: var(--dsw-alias-label-tertiary, #aaa); font-size: 12px; padding: 0 4px;
        border-radius: 4px; line-height: 1.4;
      }
      .dmr-forget:hover { color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
      .dmr-forget.is-confirming { color: #ef5350; }
      .dmr-reason {
        color: var(--dsw-alias-label-tertiary, #aaa); font-size: 11px;
        margin-top: 4px; padding-left: 8px;
        border-left: 2px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
      }
      .dsh-mirror-orb { flex: none; display: flex; align-items: center; }
      .dsh-mirror-orb:empty { display: none; }
      .dsh-mirror-orb-fallback { flex: none; font-size: 18px; line-height: 1; }
    `

    /** ai-orb 的同源 ESM 入口 —— host 端 vendor 路由直接下发 node_modules 里的真源。 */
    const ORB_MODULE = '/dsh-mirror/vendor/ai-orb/index.js'

    /** 删除单条记忆的端点。 */
    const ORB_FORGET_URL = '/dsh-mirror/forget'

    /** 「刚记过」的表态窗口：这段时间内球显示 done + 角标。 */
    const LEARNED_WINDOW_MS = 60 * 1000

    /** 球的中文无障碍文案（ai-orb 默认是英文）。 */
    const ORB_LABELS = {
      idle: 'dsh-mirror · 待命',
      thinking: 'dsh-mirror · 正在读记忆',
      working: 'dsh-mirror · 正在刷新',
      done: 'dsh-mirror · 刚记下新偏好',
      error: 'dsh-mirror · 读取失败',
    }

    /**
     * 把当前视图状态映射成球的表情。
     * 「工作」和「记录」是这里的两条主线：手动刷新 = working（环在转），
     * host 端刚提取到偏好 = done + 角标（记了几条）。
     */
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

    function injectCSS() {
      const tagId = 'dsh-user-mirror/view.css'
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-user-mirror'
      tag.setAttribute('data-plugin-css', tagId)
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function timeAgo(ts) {
      const diff = Date.now() - ts
      const day = 24 * 60 * 60 * 1000
      if (diff < 60 * 1000) return '刚刚'
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
      if (diff < day) return Math.floor(diff / 3600000) + ' 小时前'
      return Math.floor(diff / day) + ' 天前'
    }

    /** 记忆 tab 组件。 */
    function MemoryView() {
      const [state, setState] = React.useState({
        loading: true,
        refreshing: false,
        memories: [],
        kinds: null,
        error: null,
        lastLearned: null,
      })
      // 球是装饰件：拿不到就退回 🪞，不能让它挡住记忆列表
      const [orbReady, setOrbReady] = React.useState(false)
      // 待确认删除的那条 id —— 两段式，第一下只是亮起来，不直接删
      const [pendingForget, setPendingForget] = React.useState(null)
      const orbHost = React.useRef(null)
      const orb = React.useRef(null)

      const load = React.useCallback((manual) => {
        setState((s) => ({ ...s, loading: !manual, refreshing: !!manual }))
        fetch('/dsh-mirror/preferences')
          .then((r) => r.json())
          .then((d) =>
            setState({
              loading: false,
              refreshing: false,
              memories: d.memories || [],
              kinds: d.kinds || null,
              error: null,
              lastLearned: d.lastLearned || null,
            }),
          )
          .catch((e) =>
            setState({
              loading: false,
              refreshing: false,
              memories: [],
              kinds: null,
              error: String(e),
              lastLearned: null,
            }),
          )
      }, [])

      React.useEffect(() => {
        injectCSS()
        load(false)
      }, [load])

      const forget = React.useCallback(
        (id) => {
          setPendingForget(null)
          fetch(ORB_FORGET_URL + '/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(() => load(true))
            .catch(() => load(true))
        },
        [load],
      )

      // 挂载 ai-orb —— 用的是 host 端 vendor 路由下发的 npm 真源，不是抄一份进来
      React.useEffect(() => {
        let disposed = false
        import(ORB_MODULE)
          .then(({ AgentOrb }) => {
            if (disposed || !orbHost.current) return
            orb.current = new AgentOrb(orbHost.current, {
              size: 26,
              theme: 'violet',
              shape: 'circle',
              follow: false, // 26px 的小球跟不出效果，省掉全局 mousemove
              labels: ORB_LABELS,
            })
            setOrbReady(true)
          })
          .catch(() => {
            /* 球没加载出来就用 🪞 兜底，记忆列表照常 */
          })
        return () => {
          disposed = true
          if (orb.current) {
            orb.current.destroy()
            orb.current = null
          }
        }
      }, [])

      // 状态 → 球的表情
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

      // 头部常驻（不随加载状态早退）——否则 loading 期间球还没挂上，
      // 而 thinking 恰恰是最该让人看到的那一下。
      const header = React.createElement(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('div', { className: 'dsh-mirror-title' },
          // 这个容器的 children 必须恒为空：AgentOrb 是命令式 append 进来的，
          // 一旦让 React 管它的 children，下一次重渲染就会把球一起清掉。
          React.createElement('div', { className: 'dsh-mirror-orb', ref: orbHost }),
          orbReady ? null : React.createElement('span', { className: 'dsh-mirror-orb-fallback' }, '🪞'),
          React.createElement('div', null,
            React.createElement('h3', null, '记忆'),
            React.createElement('div', { className: 'dmr-sub' },
              '从 think 链学到的偏好 · 会遗忘 · 新覆盖旧',
            ),
          ),
        ),
        React.createElement(
          'button',
          {
            className: 'dsh-mirror-refresh',
            onClick: () => load(true),
            disabled: state.refreshing,
          },
          state.refreshing ? '刷新中…' : '刷新',
        ),
      )

      // 「它到底什么时候记、记什么」——不写清楚，这一栏对人就是个黑盒
      const kinds = state.kinds || {}
      const how = React.createElement('details', { className: 'dsh-mirror-how' },
        React.createElement('summary', null, '它什么时候记？记哪些？为什么会忘？'),
        React.createElement('dl', null,
          React.createElement('dt', null, '什么时候记'),
          React.createElement('dd', null,
            '模型自己判断。它意识到你表达了一条可复用的判断依据时，会调用 ',
            React.createElement('code', null, 'mirror_remember'),
            ' —— 所以每次记录都出现在对话里，看得见，不是背后偷偷写的。'),
          React.createElement('dt', null, '记哪些'),
          ...Object.keys(kinds).length
            ? Object.entries(kinds).map(([k, desc]) =>
                React.createElement('dd', { key: k },
                  React.createElement('code', null, k), ' ', desc))
            : [React.createElement('dd', { key: 'na' }, '原则 / 红线 / 工作方式 / 表达偏好')],
          React.createElement('dt', null, '不记哪些'),
          React.createElement('dd', null,
            '一次性请求（那是任务不是原则）、客观事实（路径账号服务器——那些另有真源，' +
            '这里再存一份就会互相打架）、以及模型自己的猜测。'),
          React.createElement('dt', null, '怎么更新'),
          React.createElement('dd', null,
            '同一主题有新说法就覆盖旧的，不新增近义条目；每次被再次确认，强度 +1。'),
          React.createElement('dt', null, '为什么会忘'),
          React.createElement('dd', null,
            '强度 = 确认次数 × 时间衰减（半衰期 30 天），容量封顶后淘汰最弱的一条。' +
            '人脑不能无限递增，这里也一样 —— 只收判断依据不收事实，量本来就有限。'),
        ),
      )

      let content
      if (state.loading) {
        content = React.createElement('div', { className: 'dsh-mirror-empty' }, '加载中…')
      } else if (state.error) {
        content = React.createElement('div', { className: 'dsh-mirror-empty' }, '加载失败：' + state.error)
      } else if (state.memories.length === 0) {
        content = React.createElement('div', { className: 'dsh-mirror-empty' },
          '还没有任何记忆。等你下次表达出某条原则或取舍时，模型会当场用 mirror_remember 记下来 —— 你会在对话里看到它记了什么。')
      } else {
        const confirming = pendingForget
        content = state.memories.map((m) =>
          React.createElement('div', { className: 'dsh-mirror-item', key: m.id },
            React.createElement('div', { className: 'dmr-head' },
              React.createElement('span', { className: 'dmr-kind' }, m.kind || 'principle'),
              React.createElement('span', { className: 'dmr-text' }, m.text),
              React.createElement('button', {
                className: 'dmr-forget' + (confirming === m.id ? ' is-confirming' : ''),
                title: confirming === m.id ? '再点一次就真的撤掉' : '撤掉这条',
                onClick: () => (confirming === m.id ? forget(m.id) : setPendingForget(m.id)),
                onBlur: () => confirming === m.id && setPendingForget(null),
              }, confirming === m.id ? '确认撤掉？' : '✕'),
            ),
            m.reason
              ? React.createElement('div', { className: 'dmr-reason' }, '为什么记：' + m.reason)
              : null,
            React.createElement('div', { className: 'dmr-meta' },
              React.createElement('span', null, '强度 ' + m.strength),
              React.createElement('span', null, '确认 ' + m.hits + ' 次'),
              React.createElement('span', null, timeAgo(m.lastSeenAt)),
            ),
          ),
        )
      }

      return React.createElement('div', { className: 'dsh-mirror-view' }, header, how, content)
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
            label: () => '记忆',
          },
          MemoryView,
        ),
      )
    }

    return exports
  },
})
