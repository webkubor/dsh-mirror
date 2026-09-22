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
  id: '@dsh-plugins/dsh-user-mirror',
  factory: (require) => {
    const React = require('react')
    const exports = {}
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const CSS = `
      .dsh-mirror-view {
        padding: 20px 20px 120px; font-size: 13px; line-height: 1.6; height: 100%; overflow: auto;
      }
      /* 限宽居中 —— 超宽屏上铺满会把每行拉到 100+ 字，判断本身就读不下去了；
         底部留出输入框的高度，否则最后一条永远被压在下面。 */
      .dsh-mirror-view > * { max-width: 860px; margin-left: auto; margin-right: auto; }

      /* 入场：判断依次浮起，不是一次性糊上来 */
      @keyframes dmr-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
      @keyframes dmr-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @keyframes dmr-fade { from { opacity: 0; } to { opacity: 1; } }

      /* ── 画像头：一层极淡的光晕，让它从列表里浮出来 ── */
      .dmr-portrait {
        display: flex; gap: 13px; align-items: flex-start;
        padding: 16px 16px 18px; border-radius: 14px; margin-bottom: 4px;
        background:
          radial-gradient(120% 140% at 0% 0%, rgba(192, 138, 62, .10) 0%, transparent 58%),
          var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02));
        animation: dmr-fade .5s ease both;
      }
      .dsh-mirror-orb { flex: none; display: flex; align-items: center; margin-top: 3px; }
      .dsh-mirror-orb:empty { display: none; }
      .dsh-mirror-orb-fallback { flex: none; font-size: 19px; line-height: 1; margin-top: 2px; }
      .dmr-portrait-body { flex: 1; min-width: 0; }
      .dmr-eyebrow {
        font-size: 10px; letter-spacing: .16em; text-transform: uppercase;
        color: var(--dsw-alias-label-tertiary, #aaa); margin-bottom: 7px;
      }
      .dmr-sketch {
        font-size: 16px; line-height: 1.58; color: var(--dsw-alias-label-primary, #222);
        margin: 0; font-weight: 450; text-wrap: balance; letter-spacing: -.003em;
        animation: dmr-rise .5s .06s cubic-bezier(.22,.61,.36,1) both;
      }
      .dmr-sketch b { font-weight: 650; }
      .dmr-sketch-note {
        color: var(--dsw-alias-label-tertiary, #aaa); font-size: 11.5px; margin-top: 8px;
        font-variant-numeric: tabular-nums;
        animation: dmr-rise .5s .12s cubic-bezier(.22,.61,.36,1) both;
      }

      /* 四类强度计：条从左侧展开 */
      .dmr-meters { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; }
      .dmr-meter { min-width: 88px; flex: 1 1 88px; max-width: 160px; }
      .dmr-meter .lab {
        font-size: 11.5px; color: var(--dsw-alias-label-secondary, #888);
        display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
      }
      .dmr-meter .lab b {
        font-weight: 650; color: var(--dsw-alias-label-primary, #222);
        font-variant-numeric: tabular-nums; font-size: 12.5px;
      }
      .dmr-meter .bar {
        height: 3px; border-radius: 3px; margin-top: 7px; overflow: hidden;
        background: var(--dsw-alias-border-l1, rgba(0,0,0,.07));
      }
      .dmr-meter .bar i {
        display: block; height: 100%; border-radius: 3px; transform-origin: left;
        background: linear-gradient(90deg, #C08A3E, #D9A257);
        animation: dmr-grow .7s .2s cubic-bezier(.22,.61,.36,1) both;
      }
      .dmr-meter.is-red .bar i { background: linear-gradient(90deg, #C9564A, #DE7264); }

      .dmr-rule { border: 0; height: 0; margin: 22px 0 0; }

      /* ── 分区标题 ── */
      .dmr-sec { display: flex; align-items: baseline; gap: 8px; margin: 0 0 11px; }
      .dmr-sec h4 {
        margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
        color: var(--dsw-alias-label-secondary, #888);
      }
      .dmr-sec .n {
        font-size: 11px; color: var(--dsw-alias-label-tertiary, #aaa);
        font-variant-numeric: tabular-nums;
      }
      .dmr-sec .hint { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary, #aaa); }

      /* ── 红线：左侧一道竖条，比整框包围更利落 ── */
      .dmr-redline {
        display: flex; gap: 11px; align-items: flex-start; margin-bottom: 7px;
        background: linear-gradient(90deg, rgba(201, 86, 74, .09), rgba(201, 86, 74, .03) 60%, transparent);
        border-left: 2px solid #C9564A; border-radius: 3px 9px 9px 3px;
        padding: 10px 13px;
        animation: dmr-rise .42s cubic-bezier(.22,.61,.36,1) both;
        transition: background .2s ease;
      }
      .dmr-redline:hover { background: linear-gradient(90deg, rgba(201, 86, 74, .15), rgba(201, 86, 74, .05) 60%, transparent); }
      .dmr-redline:nth-child(2) { animation-delay: .04s; }
      .dmr-redline:nth-child(3) { animation-delay: .08s; }
      .dmr-redline:nth-child(4) { animation-delay: .12s; }
      .dmr-redline:nth-child(n+5) { animation-delay: .16s; }
      .dmr-redline .mark {
        flex: none; color: #C9564A; font-size: 10px; font-weight: 700; margin-top: 3.5px;
        font-variant-numeric: tabular-nums; letter-spacing: .04em;
      }
      .dmr-redline .t { color: var(--dsw-alias-label-primary, #222); font-weight: 500; }

      /* ── 原则卡：强度进字重与明度，hover 才浮起来 ── */
      .dmr-card {
        border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.07));
        border-radius: 10px; padding: 12px 14px; margin-bottom: 7px;
        background: var(--dsw-alias-bg-layer-1, #fff);
        animation: dmr-rise .42s cubic-bezier(.22,.61,.36,1) both;
        transition: transform .2s cubic-bezier(.22,.61,.36,1), box-shadow .2s ease, border-color .2s ease;
      }
      .dmr-card:nth-child(2) { animation-delay: .04s; }
      .dmr-card:nth-child(3) { animation-delay: .08s; }
      .dmr-card:nth-child(4) { animation-delay: .12s; }
      .dmr-card:nth-child(5) { animation-delay: .16s; }
      .dmr-card:nth-child(n+6) { animation-delay: .2s; }
      .dmr-card:hover, .dmr-card:focus-within {
        transform: translateY(-1px);
        border-color: rgba(192, 138, 62, .42);
        box-shadow: 0 6px 18px -10px rgba(0, 0, 0, .3);
      }
      .dmr-card .t { margin: 0; color: var(--dsw-alias-label-primary, #222); text-wrap: pretty; }
      .dmr-card.s-3 .t { font-size: 14.5px; font-weight: 600; letter-spacing: -.004em; }
      .dmr-card.s-2 .t { font-size: 13.5px; font-weight: 500; }
      .dmr-card.s-1 .t { font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-secondary, #888); }

      .dmr-evid {
        margin-top: 9px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #aaa);
        display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
      }
      /* 印证次数：小横条比圆点更有“计量”感 */
      .dmr-dots { display: inline-flex; gap: 3px; }
      .dmr-dots i {
        width: 10px; height: 4px; border-radius: 2px; display: block;
        background: linear-gradient(90deg, #C08A3E, #D9A257);
      }
      .dmr-dots i.off { background: var(--dsw-alias-border-l2, rgba(0,0,0,.1)); }
      .dmr-why-btn {
        border: 0; background: none; padding: 0; cursor: pointer; font: inherit; font-size: 11.5px;
        color: var(--dsw-alias-label-tertiary, #aaa);
        border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));
        transition: color .15s ease, border-color .15s ease;
      }
      .dmr-why-btn:hover { color: #C08A3E; border-color: rgba(192, 138, 62, .5); }
      .dmr-spacer { margin-left: auto; }
      .dmr-why {
        margin-top: 10px; padding-top: 10px; font-size: 12px; line-height: 1.7;
        color: var(--dsw-alias-label-secondary, #888);
        border-top: 1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.09));
        animation: dmr-rise .28s ease both;
      }
      .dmr-forget {
        flex: none; border: none; background: none; cursor: pointer;
        color: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); font-size: 12px; padding: 0 3px;
        border-radius: 5px; line-height: 1.4; transition: color .15s ease, background .15s ease;
      }
      .dmr-card:hover .dmr-forget { color: var(--dsw-alias-label-tertiary, #aaa); }
      .dmr-forget:hover { color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
      .dmr-forget.is-confirming { color: #ef5350; }

      /* ── 双栏 ── */
      .dmr-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
      @media (max-width: 560px) { .dmr-cols { grid-template-columns: 1fr; gap: 20px; } }
      .dmr-plain { list-style: none; margin: 0; padding: 0; }
      .dmr-plain li {
        display: flex; gap: 9px; align-items: flex-start; margin-bottom: 7px;
        font-size: 12.5px; color: var(--dsw-alias-label-secondary, #888);
        animation: dmr-rise .4s .1s cubic-bezier(.22,.61,.36,1) both;
      }
      .dmr-plain li::before {
        content: ""; flex: none; width: 4px; height: 4px; border-radius: 50%;
        background: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); margin-top: 7.5px;
      }
      .dmr-plain li .t { color: var(--dsw-alias-label-primary, #222); }

      /* ── 正在淡忘 ── */
      .dmr-fading > summary {
        cursor: pointer; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #aaa);
        list-style: none; padding: 7px 0; display: flex; align-items: center; gap: 7px;
        transition: color .15s ease;
      }
      .dmr-fading > summary:hover { color: var(--dsw-alias-label-secondary, #888); }
      .dmr-fading > summary::-webkit-details-marker { display: none; }
      .dmr-fading > summary::before {
        content: "▸"; font-size: 9px; transition: transform .22s cubic-bezier(.22,.61,.36,1);
      }
      .dmr-fading[open] > summary::before { transform: rotate(90deg); }
      .dmr-fade-item {
        display: flex; align-items: center; gap: 10px; font-size: 12.5px;
        color: var(--dsw-alias-label-tertiary, #aaa); padding: 8px 12px; margin-bottom: 6px;
        border: 1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.1)); border-radius: 9px;
        animation: dmr-rise .32s ease both;
      }

      /* ── 状态与说明 ── */
      .dsh-mirror-empty { color: var(--dsw-alias-label-tertiary, #aaa); text-align: center; padding: 44px 16px; line-height: 1.85; }
      .dsh-mirror-refresh {
        border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
        background: var(--dsw-alias-button-elevated-fill, #fff);
        color: var(--dsw-alias-label-secondary, #888);
        border-radius: 7px; padding: 3px 11px; cursor: pointer; font-size: 11.5px;
        transition: color .15s ease, border-color .15s ease, background .15s ease;
      }
      .dsh-mirror-refresh:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));
        color: var(--dsw-alias-label-primary, #222);
      }
      .dsh-mirror-how {
        border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.07));
        border-radius: 10px; padding: 11px 13px; margin-top: 22px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02));
        font-size: 12px; line-height: 1.7;
      }
      .dsh-mirror-how summary { cursor: pointer; color: var(--dsw-alias-label-secondary, #888); }
      .dsh-mirror-how dl { margin: 8px 0 0; }
      .dsh-mirror-how dt { color: var(--dsw-alias-label-primary, #222); font-weight: 600; margin-top: 7px; }
      .dsh-mirror-how dd { margin: 2px 0 0; color: var(--dsw-alias-label-secondary, #888); }
      .dsh-mirror-how code {
        background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.05));
        padding: 1px 5px; border-radius: 4px; font-size: 11px;
      }

      /* ── Webkubor 插件家族互导矩阵 ── */
      .dmr-suite-dock {
        margin-top: 32px; padding: 16px 18px; border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02));
        border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.07));
      }
      .dmr-suite-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 6px; }
      .dmr-suite-title { font-size: 12.5px; font-weight: 650; color: var(--dsw-alias-label-primary, #222); margin: 0; display: flex; align-items: center; gap: 6px; }
      .dmr-suite-desc { font-size: 11px; color: var(--dsw-alias-label-tertiary, #888); }
      .dmr-suite-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
      .dmr-suite-card {
        padding: 12px 14px; border-radius: 9px; display: flex; flex-direction: column; justify-content: space-between;
        background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.06));
        transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
      }
      .dmr-suite-card:hover { transform: translateY(-2px); border-color: var(--dsw-alias-border-l1, rgba(0,0,0,.2)); box-shadow: 0 4px 14px rgba(0,0,0,.06); }
      .dmr-suite-card-top { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
      .dmr-suite-card-icon { font-size: 17px; line-height: 1; }
      .dmr-suite-card-name { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); text-decoration: none; }
      .dmr-suite-card-desc { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); line-height: 1.45; margin-bottom: 10px; flex: 1; }
      .dmr-suite-card-bottom { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: auto; font-size: 11px; }
      .dmr-suite-badge-active { display: inline-flex; align-items: center; gap: 4px; color: #10b981; font-weight: 600; font-size: 11px; }
      .dmr-suite-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }
      .dmr-suite-btn {
        cursor: pointer; padding: 3px 8px; border-radius: 5px; font-size: 10.5px; font-weight: 550;
        background: var(--dsw-alias-bg-layer-3, rgba(0,0,0,.04)); border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
        color: var(--dsw-alias-label-primary, #222); transition: all .15s;
      }
      .dmr-suite-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); }
      .dmr-suite-link { color: var(--dsw-alias-label-tertiary, #888); text-decoration: none; font-size: 10.5px; }
      .dmr-suite-link:hover { color: var(--dsw-alias-label-primary, #222); }

      /* 动效是增强，不是承载 —— 关掉后信息结构完全不变 */
      @media (prefers-reduced-motion: reduce) {
        .dmr-portrait, .dmr-sketch, .dmr-sketch-note, .dmr-card, .dmr-redline,
        .dmr-plain li, .dmr-fade-item, .dmr-why, .dmr-meter .bar i { animation: none !important; }
        .dmr-card { transition: none; }
        .dmr-card:hover { transform: none; }
      }
    `

    /** ai-orb 的同源 ESM 入口 —— host 端 vendor 路由直接下发 node_modules 里的真源。 */
    const ORB_MODULE = '/dsh-mirror/vendor/ai-orb/index.js'

    /** 删除单条记忆的端点。 */
    const ORB_FORGET_URL = '/dsh-mirror/forget'

    /** 「刚记过」的表态窗口：这段时间内球显示 done + 角标。 */
    const LEARNED_WINDOW_MS = 60 * 1000

    /** 浏览器语言：中文浏览器显示中文，其余语言显示英文。 */
    const IS_ZH = /^zh(?:-|$)/i.test(navigator.language || '')
    const TEXT = {
      zh: {
        orb: { idle: '待命', thinking: '正在读记忆', working: '正在刷新', done: '刚记下新偏好', error: '读取失败' },
        kinds: { redline: '红线', principle: '原则 / 取舍', workflow: '工作方式', taste: '审美 / 表达' },
        justNow: '刚刚', minute: '分钟前', hour: '小时前', day: '天前', active: '条判断在生效', redlines: '条红线不衰减', fading: '条正在淡忘', recent: '最近一次印证 '
      },
      en: {
        orb: { idle: 'idle', thinking: 'reading memory', working: 'refreshing', done: 'new preference learned', error: 'read failed' },
        kinds: { redline: 'Red lines', principle: 'Principles / trade-offs', workflow: 'Workflow', taste: 'Taste / expression' },
        justNow: 'just now', minute: ' min ago', hour: ' hr ago', day: ' days ago', active: ' active judgments', redlines: ' red lines never fade', fading: ' fading', recent: 'Last confirmed '
      }
    }
    const T = IS_ZH ? TEXT.zh : TEXT.en
    const tr = (zh, en) => IS_ZH ? zh : en
    const ORB_LABELS = Object.fromEntries(Object.entries(T.orb).map(([key, value]) => [key, 'dsh-mirror · ' + value]))

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
      if (diff < 60 * 1000) return T.justNow
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + T.minute
      if (diff < day) return Math.floor(diff / 3600000) + T.hour
      return Math.floor(diff / day) + T.day
    }

    /** 四类的展示顺序与中文名 —— 红线排最前，它是唯一越界有代价的一类。 */
    const KIND_ORDER = ['redline', 'principle', 'workflow', 'taste']
    const KIND_LABEL = {
      redline: T.kinds.redline,
      principle: T.kinds.principle,
      workflow: T.kinds.workflow,
      taste: T.kinds.taste,
    }

    /** 超过这个时间没被印证，就算「正在淡忘」——与 host 端半衰期同数量级。 */
    const FADE_MS = 30 * 24 * 60 * 60 * 1000

    /**
     * 把一串记忆派生成画像所需的几个切面。
     * 排序一律按 strength 降序 —— 画像的上层必须是最被印证的判断，
     * 而不是最近写入的那条。
     */
    function digest(memories, now) {
      const live = []
      const fading = []
      memories.forEach((m) => {
        // 红线不参与淡忘：越界有代价的约束不该因为一阵子没踩到就消失
        if (m.kind !== 'redline' && now - m.lastSeenAt > FADE_MS) fading.push(m)
        else live.push(m)
      })
      const byKind = {}
      KIND_ORDER.forEach((k) => { byKind[k] = [] })
      live.forEach((m) => { (byKind[m.kind] || byKind.principle).push(m) })
      KIND_ORDER.forEach((k) => byKind[k].sort((a, b) => b.strength - a.strength))
      live.sort((a, b) => b.strength - a.strength)
      fading.sort((a, b) => b.strength - a.strength)
      const max = live.reduce((x, m) => Math.max(x, m.strength), 0) || 1
      return { byKind, live, fading, max }
    }

    /**
     * 强度三档 —— 相对最强的那条，而不是绝对值。
     * 绝对值没有意义：整个库都衰减过一轮时，最强的那条也可能只有 0.5。
     */
    function tier(m, max) {
      const r = m.strength / max
      return r >= 0.66 ? 3 : r >= 0.33 ? 2 : 1
    }

    /** 画像速写下面那行：如实报数，不编。 */
    function summaryLine(d, now) {
      const parts = [d.live.length + T.active]
      if (d.byKind.redline.length) parts.push(d.byKind.redline.length + T.redlines)
      if (d.fading.length) parts.push(d.fading.length + T.fading)
      if (d.live.length) parts.push(T.recent + timeAgo(d.live[0].lastSeenAt))
      return parts.join(' · ')
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
      // 展开「看是哪几次」的那条 id —— 证据默认收起，不让细节淹掉判断
      const [openWhy, setOpenWhy] = React.useState(null)
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
      // ── 从记忆列表派生画像 ───────────────────────────────────────
      const now = Date.now()
      const d = digest(state.memories, now)
      const top = d.live.length ? d.live[0] : null

      const header = React.createElement('div', { className: 'dmr-portrait' },
        // 这个容器的 children 必须恒为空：AgentOrb 是命令式 append 进来的，
        // 一旦让 React 管它的 children，下一次重渲染就会把球一起清掉。
        React.createElement('div', { className: 'dsh-mirror-orb', ref: orbHost }),
        orbReady ? null : React.createElement('span', { className: 'dsh-mirror-orb-fallback' }, '🪞'),
        React.createElement('div', { className: 'dmr-portrait-body' },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' },
          },
            React.createElement('div', { className: 'dmr-eyebrow' }, tr('AI 眼中的你', 'You through AI eyes')),
            React.createElement('button', {
              className: 'dsh-mirror-refresh',
              onClick: () => load(true),
              disabled: state.refreshing,
              }, state.refreshing ? tr('刷新中…', 'Refreshing…') : tr('刷新', 'Refresh')),
          ),
          // 速写取最强那条 —— 它就是模型眼里最认定你的判断，不编人格描述
          top
            ? React.createElement('p', { className: 'dmr-sketch' },
                tr('被印证最多的判断是 ', 'Most confirmed judgment: '),
                React.createElement('b', null, '「' + top.text + '」'))
            : React.createElement('p', { className: 'dmr-sketch' }, tr('还没有足够的判断来描出你', 'Not enough judgments to sketch you yet')),
          React.createElement('div', { className: 'dmr-sketch-note' }, summaryLine(d, now)),
          // 四类强度计
          React.createElement('div', { className: 'dmr-meters' },
            KIND_ORDER.filter((k) => d.byKind[k].length).map((k) =>
              React.createElement('div', {
                key: k,
                className: 'dmr-meter' + (k === 'redline' ? ' is-red' : ''),
              },
                React.createElement('div', { className: 'lab' },
                  React.createElement('span', null, KIND_LABEL[k]),
                  React.createElement('b', null, String(d.byKind[k].length)),
                ),
                React.createElement('div', { className: 'bar' },
                  React.createElement('i', {
                    style: { width: Math.round((d.byKind[k].length / d.live.length) * 100) + '%' },
                  }),
                ),
              ),
            ),
          ),
        ),
      )

      // 「它到底什么时候记、记什么」——不写清楚，这一栏对人就是个黑盒
      const kinds = state.kinds || {}
      const how = React.createElement('details', { className: 'dsh-mirror-how' },
        React.createElement('summary', null, tr('它什么时候记？记哪些？为什么会忘？', 'When does it remember, what does it keep, and why does it forget?')),
        React.createElement('dl', null,
          React.createElement('dt', null, tr('什么时候记', 'When it remembers')),
          React.createElement('dd', null,
            '模型自己判断。它意识到你表达了一条可复用的判断依据时，会调用 ',
            React.createElement('code', null, 'mirror_remember'),
            ' —— 所以每次记录都出现在对话里，看得见，不是背后偷偷写的。'),
          React.createElement('dt', null, tr('记哪些', 'What it keeps')),
          ...Object.keys(kinds).length
            ? Object.entries(kinds).map(([k, desc]) =>
                React.createElement('dd', { key: k },
                  React.createElement('code', null, k), ' ', desc))
            : [React.createElement('dd', { key: 'na' }, tr('原则 / 红线 / 工作方式 / 表达偏好', 'Principles / red lines / workflow / expression preferences'))],
          React.createElement('dt', null, tr('不记哪些', 'What it does not keep')),
          React.createElement('dd', null,
            '一次性请求（那是任务不是原则）、客观事实（路径账号服务器——那些另有真源，' +
            '这里再存一份就会互相打架）、以及模型自己的猜测。'),
          React.createElement('dt', null, tr('怎么更新', 'How it updates')),
          React.createElement('dd', null,
            '同一主题有新说法就覆盖旧的，不新增近义条目；每次被再次确认，强度 +1。'),
          React.createElement('dt', null, tr('为什么会忘', 'Why it forgets')),
          React.createElement('dd', null,
            '强度 = 确认次数 × 时间衰减（半衰期 30 天），容量封顶后淘汰最弱的一条。' +
            '人脑不能无限递增，这里也一样 —— 只收判断依据不收事实，量本来就有限。'),
        ),
      )

      // ── 一张卡：正面只放判断，证据折在里面 ────────────────────────
      const cardOf = (m) => {
        const open = openWhy === m.id
        const confirming = pendingForget === m.id
        return React.createElement('div', { className: 'dmr-card s-' + tier(m, d.max), key: m.id },
          React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
            React.createElement('p', { className: 't', style: { flex: 1 } }, m.text),
            React.createElement('button', {
              className: 'dmr-forget' + (confirming ? ' is-confirming' : ''),
              title: confirming ? tr('再点一次就真的撤掉', 'Click again to remove') : tr('撤掉这条', 'Remove this item'),
              onClick: () => (confirming ? forget(m.id) : setPendingForget(m.id)),
              onBlur: () => confirming && setPendingForget(null),
            }, confirming ? tr('确认撤掉？', 'Confirm removal?') : '✕'),
          ),
          React.createElement('div', { className: 'dmr-evid' },
            React.createElement('span', { className: 'dmr-dots', 'aria-hidden': 'true' },
              [0, 1, 2, 3, 4].map((i) =>
                React.createElement('i', { key: i, className: i < Math.min(m.hits, 5) ? '' : 'off' }))),
            React.createElement('span', null, m.hits + tr(' 次印证', ' confirmations')),
            m.reason
              ? React.createElement('button', {
                  className: 'dmr-why-btn',
                  'aria-expanded': open ? 'true' : 'false',
                  onClick: () => setOpenWhy(open ? null : m.id),
                }, open ? tr('收起', 'Collapse') : tr('看是哪几次', 'See evidence'))
              : null,
            React.createElement('span', { className: 'dmr-spacer' }),
            React.createElement('span', null, timeAgo(m.lastSeenAt)),
          ),
          open && m.reason ? React.createElement('div', { className: 'dmr-why' }, m.reason) : null,
        )
      }

      const section = (k, hint) => {
        const list = d.byKind[k]
        if (!list.length) return null
        return React.createElement(React.Fragment, { key: k },
          React.createElement('div', { className: 'dmr-sec' },
            React.createElement('h4', null, KIND_LABEL[k]),
            React.createElement('span', { className: 'n' }, String(list.length)),
            hint ? React.createElement('span', { className: 'hint' }, hint) : null,
          ),
          k === 'redline'
            ? list.map((m, i) =>
                React.createElement('div', { className: 'dmr-redline', key: m.id },
                  React.createElement('span', { className: 'mark' }, String(i + 1).padStart(2, '0')),
                  React.createElement('span', { className: 't' }, m.text)))
            : list.map(cardOf),
        )
      }

      // 工作方式 / 审美 —— 轻量清单，两栏
      const plainList = (k) => {
        const list = d.byKind[k]
        if (!list.length) return null
        return React.createElement('div', null,
          React.createElement('div', { className: 'dmr-sec' },
            React.createElement('h4', null, KIND_LABEL[k]),
            React.createElement('span', { className: 'n' }, String(list.length)),
          ),
          React.createElement('ul', { className: 'dmr-plain' },
            list.map((m) =>
              React.createElement('li', { key: m.id },
                React.createElement('span', { className: 't' }, m.text)))),
        )
      }

      let content
      if (state.loading) {
        content = React.createElement('div', { className: 'dsh-mirror-empty' }, tr('加载中…', 'Loading…'))
      } else if (state.error) {
        content = React.createElement('div', { className: 'dsh-mirror-empty' }, tr('加载失败：', 'Load failed: ') + state.error)
      } else if (state.memories.length === 0) {
        content = React.createElement('div', { className: 'dsh-mirror-empty' },
          tr('还没有任何记忆。等你下次表达出某条原则或取舍时，模型会当场用 mirror_remember 记下来 —— 你会在对话里看到它记了什么。', 'No memories yet. When you express a reusable principle or trade-off, the model will record it with mirror_remember — you will see what it remembers in the conversation.'))
      } else {
        const cols = (d.byKind.workflow.length || d.byKind.taste.length)
          ? React.createElement('div', { className: 'dmr-cols' }, plainList('workflow'), plainList('taste'))
          : null
        content = React.createElement('div', null,
          section('redline', tr('越界有代价，永不衰减', 'Crossing the line has a cost; never fades')) ? React.createElement('div', null,
            React.createElement('hr', { className: 'dmr-rule' }),
            section('redline', tr('越界有代价，永不衰减', 'Crossing the line has a cost; never fades'))) : null,
          d.byKind.principle.length ? React.createElement('div', null,
            React.createElement('hr', { className: 'dmr-rule' }),
            section('principle', tr('字越重 = 被越多次印证', 'Heavier text = confirmed more often'))) : null,
          cols ? React.createElement('div', null,
            React.createElement('hr', { className: 'dmr-rule' }), cols) : null,
          d.fading.length ? React.createElement('div', null,
            React.createElement('hr', { className: 'dmr-rule' }),
            React.createElement('details', { className: 'dmr-fading' },
              React.createElement('summary', null,
                '正在淡忘 · ' + d.fading.length + ' 条 —— 超过 30 天没被印证，再无命中就会被淘汰'),
              d.fading.map((m) =>
                React.createElement('div', { className: 'dmr-fade-item', key: m.id },
                  React.createElement('span', null, m.text))),
            )) : null,
        )
      }

      function SuiteDock() {
        const [copied, setCopied] = React.useState(null)
        const suite = [
          {
            id: 'bloom',
            name: 'Bloom Theme',
            icon: '🎨',
            desc: '极致毛玻璃美学与暗黑/亮色主题',
            repo: 'https://github.com/webkubor/dsh-bloom-theme',
            pkg: '@dsh-plugins/dsh-bloom-theme',
          },
          {
            id: 'hub',
            name: 'LLM Hub',
            icon: '⚡',
            desc: '多模型统一聚合与智能重试分发',
            repo: 'https://github.com/webkubor/dsh-llm-hub',
            pkg: '@dsh-plugins/dsh-llm-hub',
          },
          {
            id: 'mirror',
            name: 'User Mirror',
            icon: '🪞',
            desc: '用户角色数字画像与偏好记忆网络',
            repo: 'https://github.com/webkubor/dsh-mirror',
            pkg: '@dsh-plugins/dsh-user-mirror',
            isCurrent: true,
          },
          {
            id: 'inspector',
            name: 'Env Inspector',
            icon: '🖥️',
            desc: '端口监听释放、CLI工具链与环境大屏',
            repo: 'https://github.com/webkubor/dsh-env-inspector',
            pkg: '@dsh-plugins/dsh-env-inspector',
          },
        ]

        const handleCopy = (pkg) => {
          const cmd = `dsh plugin install ${pkg}`
          if (navigator.clipboard) navigator.clipboard.writeText(cmd)
          setCopied(pkg)
          setTimeout(() => setCopied(null), 2000)
        }

        return React.createElement('div', { className: 'dmr-suite-dock' },
          React.createElement('div', { className: 'dmr-suite-head' },
            React.createElement('h4', { className: 'dmr-suite-title' },
              React.createElement('span', null, '🌟'),
              'Webkubor DSH 扩展家族'
            ),
            React.createElement('span', { className: 'dmr-suite-desc' },
              '专为 DeepSeek Harness 打造的美学与效能工具套件'
            )
          ),
          React.createElement('div', { className: 'dmr-suite-cards' },
            suite.map((item) =>
              React.createElement('div', { className: 'dmr-suite-card', key: item.id },
                React.createElement('div', { className: 'dmr-suite-card-top' },
                  React.createElement('span', { className: 'dmr-suite-card-icon' }, item.icon),
                  React.createElement('a', {
                    href: item.repo,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'dmr-suite-card-name'
                  }, item.name)
                ),
                React.createElement('div', { className: 'dmr-suite-card-desc' }, item.desc),
                React.createElement('div', { className: 'dmr-suite-card-bottom' },
                  item.isCurrent
                    ? React.createElement('span', { className: 'dmr-suite-badge-active' },
                        React.createElement('span', { className: 'dmr-suite-badge-dot' }),
                        '已激活'
                      )
                    : React.createElement('button', {
                        type: 'button',
                        className: 'dmr-suite-btn',
                        onClick: () => handleCopy(item.pkg),
                        title: `复制命令: dsh plugin install ${item.pkg}`
                      }, copied === item.pkg ? tr('✓ 已复制!', '✓ Copied!') : tr('⚡ 复制安装', '⚡ Copy install')), 
                  React.createElement('a', {
                    href: item.repo,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'dmr-suite-link'
                  }, 'GitHub ↗')
                )
              )
            )
          )
        )
      }

      return React.createElement('div', { className: 'dsh-mirror-view' }, header, content, how, React.createElement(SuiteDock))
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
