/**
 * dsh-mirror —— 让 AI 越用越懂你的偏好学习插件。
 *
 * 记忆模型：有结构、会遗忘。
 *  - 每条记忆有「强度」= 命中次数 × 时间衰减（遗忘曲线）
 *  - 容量封顶，满了淘汰最弱的
 *  - 语义相似的新记忆覆盖旧记忆（新认知覆盖旧认知）
 *  - 注入按 token 预算，不是条数
 *
 * 职责：
 *  - 订阅 session 事件，捕获模型的 thinking 链（reasoning-delta）
 *  - 从 think 链中提取「模型对用户偏好的理解」（规则匹配）
 *  - 用 ctx.storage 的 domain 能力持久化偏好（表：preferences）
 *  - 注册 system-prompt section，按强度 + token 预算注入
 *  - 提供 mirror_remember / mirror_forget 两个工具：记下、撤掉
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
// normalize 起别名：本模块已有一个用于偏好文本归一化的 normalize
import { dirname, join, normalize as normalizePath, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_MEMORY_ROOT,
  scanGuidance,
  renderGuidance,
  readGuidanceFile,
} from './guidance.js'

/** 稳定插件名。 */
export const name = 'dsh-mirror'

/**
 * ai-orb 真源目录 —— 直接指向 node_modules 里的 npm 包本体。
 *
 * client.js 是手写、无构建、原样下发的，`require()` 只能拿到 host 提供的模块，
 * 拿不到 npm 包。所以这里把 ai-orb 的 ESM 源码按同源静态资源下发，client 端
 * 用 `import('/dsh-mirror/vendor/ai-orb/index.js')` 取 —— 包内的
 * `import './style.js'` 会自然解析到同一前缀下。
 *
 * 好处是不留副本：升级 ai-orb 只需升依赖，不用同步任何拷贝过来的代码。
 */
const ORB_SRC = join(dirname(createRequire(import.meta.url).resolve('ai-orb/package.json')), 'src')

/**
 * vendor 路由前缀 —— 结尾**不能**带斜杠。
 * webserver 的 prefix 匹配是 `pathname === prefix || pathname.startsWith(prefix + '/')`，
 * 自带尾斜杠会变成匹配双斜杠，结果永远 404。
 */
const VENDOR_PREFIX = '/dsh-mirror/vendor/ai-orb'

/** 删除单条记忆的路由前缀（同样不能带尾斜杠）。 */
const FORGET_PREFIX = '/dsh-mirror/forget'

/** 需要的服务：存储域 / 系统提示 / 工具注册 / HTTP 载体（给 client 端查数据）。 */
export const inject = ['storageDomain', 'systemPrompt', 'tools', 'webServer']

/** 插件配置。 */
export const Config = z.object({
  /** 记忆容量上限（条数）。满了淘汰强度最低的。 */
  maxPreferences: z.number().default(20),
  /** 半衰期（天）。多久没被再次确认，强度减半。 */
  halfLifeDays: z.number().default(30),
  /** 注入系统提示的 token 预算（近似：2 字符 ≈ 1 token）。 */
  maxTokens: z.number().default(500),
  /** system-prompt section 的排序位置（越小越靠前）。 */
  sectionOrder: z.number().default(160),
  /**
   * 手写引导词根目录。目录约定见 guidance.js：
   * guidance/ 注入、reference/ 按需读、archive/ 不读。
   */
  memoryRoot: z.string().default(DEFAULT_MEMORY_ROOT),
  /** 引导词注入的字符预算（近似 2 字符 ≈ 1 token）。超了按 priority 截断并明确标注。 */
  maxGuidanceChars: z.number().default(1600),
})

/**
 * 记忆的分类 —— 刻意只有四类，且刻意**不包含**「事实」。
 *
 * 事实（路径、账号、服务器、домен…）已经有 cs 作真源，这里再记一份就是第二真源。
 * 这颗镜子只记 cs 里没有的东西：你**怎么想、怎么取舍**。
 *
 * 这也是「人脑不能无限递增」的解法 —— 判断依据天然有限（几十条），
 * 事实无限。只收前者，容量就不是靠淘汰硬撑出来的。
 */
export const KINDS = {
  principle: '原则/取舍 —— 什么情况下怎么选',
  redline: '红线 —— 绝对不要做什么',
  workflow: '工作方式 —— 流程与协作习惯',
  taste: '审美/表达 —— 措辞、风格、呈现',
}

/** 记忆记录 schema。 */
const preferenceSchema = zod.object({
  id: zod.string(),
  text: zod.string(),
  /** 四类之一，见 KINDS。 */
  kind: zod.string(),
  /** 为什么记下它 —— 没有理由的记忆无法追溯，也就无法信任。 */
  reason: zod.string(),
  hits: zod.number(),
  lastSeenAt: zod.number(),
  source: zod.string(),
  createdAt: zod.number(),
  updatedAt: zod.number(),
})

/**
 * 记忆域的声明。
 * v3：加入 kind / reason —— 从「猜出来的偏好」变成「说得出理由的判断依据」。
 */
const MirrorDomain = defineDomain({
  name: 'dsh_mirror',
  version: 3,
  tables: {
    preferences: domainTable(preferenceSchema),
  },
})

/** 归一化：去「用户」前缀、去空白和标点，用于语义覆盖匹配。 */
export function normalize(text) {
  return text
    .replace(/^用户/, '')
    .replace(/[\s。！？；;，,、：「」『』"'`]/g, '')
    .toLowerCase()
}

/** 遗忘曲线强度 = 命中次数 × 时间衰减。 */
export function strengthOf(p, now, halfLifeMs) {
  const age = Math.max(0, now - (p.lastSeenAt ?? p.updatedAt))
  const decay = Math.exp(-age / halfLifeMs)
  return p.hits * decay
}

/** 停用词：出现得太普遍，对「是不是同一个主题」没有区分力。 */
const STOP = new Set([
  '偏好', '喜欢', '习惯', '希望', '要求', '倾向', '介意', '注重', '在意', '讨厌', '不喜欢',
  '强调', '坚持', '约定', '认为', '觉得', '说过', '提到', '非常', '比较', '更', '一直', '通常',
  '一般', '明显', '特别', '似乎', '好像', '应该', '可能', '很', '真的', '其实', '并不',
  '的', '是', '在', '用', '和', '而', '但', '就', '都', '也', '不', '没', '有', '了', '着',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这个', '那个', '这种', '那种',
  '不要', '一律', '不再', '这里', '那里', '什么', '怎么', '可以', '需要', '必须',
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'not', 'no', 'yes', 'use', 'using', 'prefer', 'prefers', 'like', 'likes',
])

/**
 * 提取英文/数字实体（r2、picx、typescript、main…）。
 *
 * 关键：在**原文**上切，不能用 normalize 的结果 —— 它把标点删掉了，
 * 「R2，picx」会粘成一个 `r2picx`，两个实体变一个词，同主题就再也认不出来。
 * 标点和中文本身就是天然词边界。
 */
export function extractEntities(text) {
  const t = text.replace(/^用户/, '').toLowerCase()
  const out = new Set()
  for (const w of t.match(/[a-z0-9]+/g) || []) {
    if (w.length >= 2 && !STOP.has(w)) out.add(w)
  }
  return out
}

/**
 * 提取中文二元组。中文没有空格，bigram 是最省事又够用的切法 ——
 * 为了判断「是不是同一个主题」引入一个分词器，是典型的偶然复杂度。
 */
export function extractGrams(text) {
  const t = text.replace(/^用户/, '')
  const out = new Set()
  for (const seg of t.replace(/[^一-龥]+/g, ' ').trim().split(/\s+/)) {
    for (let i = 0; i + 2 <= seg.length; i++) {
      const bg = seg.slice(i, i + 2)
      if (!STOP.has(bg)) out.add(bg)
    }
  }
  return out
}

/** 主题关键词 = 英文实体 + 中文二元组。 */
export function extractKeywords(text) {
  return new Set([...extractEntities(text), ...extractGrams(text)])
}

/** 两个关键词集合的 Jaccard 相似度。 */
export function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0
  let inter = 0
  for (const x of setA) if (setB.has(x)) inter++
  return inter / (setA.size + setB.size - inter)
}

/** 中文二元组重叠到多少算同一主题。bigram 集合天然偏大，阈值不能照搬词级的 0.5。 */
const GRAM_THRESHOLD = 0.3

/**
 * 找同主题的已有记忆，用于覆盖。
 *
 * 分两路判据，因为两类文本的信号强度差得很远：
 *  · 英文实体（r2 / picx / typescript / main）在技术语境里几乎等于主题标签，
 *    共同命中两个就足以判定同主题；
 *  · 纯中文的表述只能靠 bigram 重叠，阈值另算。
 * 合成一个 jaccard 的话，实体会被大量 bigram 稀释 —— 「图片一律上 R2，不要再往
 * picx 加图」和「图片走 R2，picx 不再接受新图」就是这么漏掉的。
 */
export function findSimilar(table, text) {
  const n = normalize(text)
  if (n.length < 4) return null
  const ent = extractEntities(text)
  const grams = extractGrams(text)

  for (const [key, p] of table.entries()) {
    const pn = normalize(p.text)
    if (pn === n) return [key, p]
    if (pn.length >= 6 && (pn.includes(n) || n.includes(pn))) return [key, p]

    // 实体通道
    const pEnt = extractEntities(p.text)
    if (ent.size > 0 && pEnt.size > 0) {
      let shared = 0
      for (const x of ent) if (pEnt.has(x)) shared++
      // 两个共同实体 = 同主题；只有一个时，得是某一方全部实体都对上才算。
      // 这里刻意偏向合并：条目有上限，宁可覆盖成近义的一条，也不要堆两条重复的。
      if (shared >= 2 || (shared === 1 && (ent.size === 1 || pEnt.size === 1))) return [key, p]
    }

    // 中文通道
    if (grams.size > 0 && jaccard(grams, extractGrams(p.text)) >= GRAM_THRESHOLD) return [key, p]
  }
  return null
}

/** 近似 token 数（中英混合约 2 字符 / token）。 */
function estTokens(text) {
  return Math.ceil(text.length / 2)
}

/**
 * 单条记忆的字符硬上限。
 *
 * 判断依据天然是短的：「减法优先：无用本身就是删除的理由」14 个字说完了。
 * 记到 150 字往上的，几乎一定混进了操作步骤、路径、token 名 —— 那是 SOP，
 * 该去 guidance/ 或 reference/。塞在这里的后果是它一个人吃掉半个预算，
 * 再把后面十几条真正该注入的短原则全挤出去（实测 22 条里只有 5 条生效）。
 */
export const MAX_MEMORY_CHARS = 150

/**
 * 超长条目的哨兵值。放进密度字段参与排序时用它隔开：
 * 超长的不参与注入，但也不假装它不存在 —— /preferences 端点会把它们
 * 带 injected:false 原样返回，UI 才能把它们单列出来说清楚。
 */
const OVERLONG = -1

/**
 * 按 token 预算选记忆。
 *
 * 排序用「强度密度」= 强度 / token 数，而不是纯强度。这是修「17 条不生效」
 * 的根因：纯强度排序下，一条 hits 高但 148 token 的长条目先占满预算，
 * 把后面 7 token 的短原则整片挤掉 —— 而短原则才是每次会话都该带的东西。
 * 密度排序下，同样 2 次印证，「减法优先」(9 tok) 会排在「写 UI 必须用
 * lite-browser 实测…」(148 tok) 前面。
 *
 * 第二处修：超预算时 `continue` 而不是 `break`。原来一条长条目放不下就
 * 直接终止整个循环，后面所有条目一律不取，哪怕它们短到完全塞得下。
 *
 * @returns `[[key, p, strength, tokens], …]` —— tokens 一并带出去，UI 显示用。
 */
export function selectMemories(table, maxTokens, now, halfLifeMs) {
  const entries = [...table.entries()]
    .map(([key, p]) => [key, p, strengthOf(p, now, halfLifeMs)])
    .filter(([, , s]) => s > 0.01) // 已彻底遗忘的不要
    .map(([key, p, s]) => {
      const tokens = estTokens(p.text)
      return [key, p, s, tokens, p.text.length > MAX_MEMORY_CHARS ? OVERLONG : s / tokens]
    })
    .sort((a, b) => b[4] - a[4]) // OVERLONG = -1 沉底，永远排最后

  const out = []
  let used = 0
  for (const [key, p, strength, tokens, density] of entries) {
    if (density === OVERLONG) continue // 交给 UI 提示用户去搬走
    if (used + tokens > maxTokens) continue // 放不下就跳过，别连坐后面所有条目
    out.push([key, p, strength, tokens])
    used += tokens
  }
  return out
}

/**
 * 渲染注入到系统提示的记忆段落。
 *
 * 框架文案要吝啬到底 —— 预算是留给记忆本身的。
 * 没有记忆就一个字都不注入：「什么时候该记」已经写在 mirror_remember 的
 * 工具定义里，而工具定义本来就常驻上下文，在这儿再讲一遍就是第二真源。
 *
 * 刻意不注入强度数字。绝对值对模型没有意义（整个库衰减一轮后最高那条也
 * 可能只有 0.5），而且模型会把它当数据读走 —— 用户已经见过 AI 复述
 * 「这条记忆强度 6.0」当回事。强度是给人看的，不是给模型算的。
 */
export function renderPreferences(table, maxTokens, now, halfLifeMs) {
  const selected = selectMemories(table, maxTokens, now, halfLifeMs)
  if (selected.length === 0) return ''
  const lines = selected.map(
    ([, p], i) => `${i + 1}. [${p.kind ?? 'principle'}] ${p.text}`,
  )
  return `关于这个人怎么想（会遗忘，可被新认知覆盖）：\n\n${lines.join('\n')}`
}

/**
 * 应用插件：打开存储域、注册系统提示 section、订阅 think 链、注册工具。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx, config) {
  const halfLifeMs = config.halfLifeDays * 24 * 60 * 60 * 1000
  let table = null

  /**
   * 最近一次「记下东西」的活动 —— 只给 client 端的状态球表态用。
   * 提取本身是 turn/end 里同步跑完的，快到抓不住「正在记」的那一瞬，
   * 所以记的是「刚记过、记了几条」，让球有话可说。
   */
  let lastLearned = { at: 0, count: 0 }

  /*
   * 引导词缓存 —— section 的 text() 每次组装都会求值，不能每次都读盘。
   * 用一个可变对象持有最近一次扫描结果，后台定期（以及工具调用后）刷新。
   *
   * 刻意不做文件监听：引导词改一次要人动手，轮询 30s 足够，也少一个 inotify 依赖。
   */
  const guidanceCache = { entries: [], diagnostics: [], scannedAt: 0 }

  async function refreshGuidance() {
    try {
      const { entries, diagnostics } = await scanGuidance(config.memoryRoot)
      guidanceCache.entries = entries
      guidanceCache.diagnostics = diagnostics
      guidanceCache.scannedAt = Date.now()
    } catch (err) {
      // fail-open：引导词读不到不该拖垮整个 system prompt 组装
      ctx.logger?.warn('dsh-mirror: 引导词扫描失败: ' + String(err))
    }
  }

  // 首次扫描 + 每 30s 刷新（用 effect 管生命周期，随插件卸载停止）
  ctx.effect(() => {
    void refreshGuidance()
    const timer = setInterval(() => void refreshGuidance(), 30_000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'dsh-mirror: guidance refresh')

  /*
   * 存储域的生命周期必须整段包在 effect 里 —— 三个坑一起躲：
   *
   * 1. open 放在 apply 顶层的话，effect 重跑（插件重载）拿到的还是同一个
   *    promise，而 domain 已被上一轮 cleanup 关掉，从此永久不可用。
   * 2. cleanup 关了 domain 却不清 table，table 就成了悬垂引用：下一次
   *    `table.size` / `table.put` 打到已关闭的底层 DB，内部 db 是 undefined，
   *    炸出 `Cannot read properties of undefined (reading 'prepare')` ——
   *    而且是在 turn/end 里炸，表现为「本轮运行失败」，日志里还找不到。
   * 3. open 尚未完成就卸载，句柄会漏在 promise 里没人关。
   */
  ctx.effect(() => {
    let disposed = false
    let handle = null
    const opening = ctx.storageDomain.open(MirrorDomain)

    opening
      .then((domain) => {
        // 已经卸载了才 resolve：这个句柄没人会用，直接关掉，别漏
        if (disposed) {
          domain.close()
          return
        }
        handle = domain
        table = domain.table('preferences')
        ctx.logger?.info(`dsh-mirror: 记忆存储已就绪（容量 ${config.maxPreferences} 条，半衰期 ${config.halfLifeDays} 天）`)
      })
      .catch((err) => {
        ctx.logger?.error(`dsh-mirror: 打开存储域失败: ${err?.message ?? err}`)
      })

    return () => {
      disposed = true
      // 先断引用再关：关掉之后谁都不许再碰这张表
      table = null
      if (handle) {
        handle.close()
        handle = null
      }
    }
  })

  /**
   * 落一条记忆：覆盖相似旧记忆，满了淘汰最弱。
   * @returns 'updated'（覆盖了同主题旧认知）或 'created'（新记）
   */
  const remember = ({ text, kind, reason }) => {
    const now = Date.now()
    const similar = findSimilar(table, text)
    if (similar) {
      const [key, p] = similar
      // 新认知覆盖旧认知：保留旧 id，更新内容/命中/时间
      table.put(key, {
        ...p,
        text,
        kind,
        reason,
        hits: p.hits + 1,
        lastSeenAt: now,
        updatedAt: now,
      })
      return 'updated'
    }
    const id = `pref-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    table.put(id, {
      id,
      text,
      kind,
      reason,
      hits: 1,
      lastSeenAt: now,
      source: 'tool',
      createdAt: now,
      updatedAt: now,
    })
    // 容量封顶：淘汰强度最低的
    if (table.size > config.maxPreferences) {
      const weakest = [...table.entries()]
        .map(([k, p]) => [k, strengthOf(p, now, halfLifeMs)])
        .sort((a, b) => a[1] - b[1])[0]
      if (weakest) table.delete(weakest[0])
    }
    return 'created'
  }

// system-prompt section：告诉模型什么时候该记、怎么记（order 在最前面，先布置任务再展示已有记忆）
	ctx.systemPrompt.section({
	  name: 'mirror:duty',
	  order: config.sectionOrder - 1,
	  text: () => {
	    if (!table) return ''
	    const lines = [
	      '当你察觉到用户表达了可复用的判断依据时，调用 mirror_remember 记录：',
	      '',
	      '  principle（原则/取舍）— 偏向什么方案、怎么选',
	      '  redline（红线）— 绝对不能做什么',
	      '  workflow（工作方式）— 流程习惯、协作偏好',
	      '  taste（审美/表达）— 措辞、风格、呈现方式',
	      '',
	      '不记：一次性请求、客观事实（路径账号服务器另有真源）、你自己的猜测。',
	      '同一主题有新说法就再记一次，会覆盖旧的。记完就记完了，不要单独汇报"我记下来了"。',
	    ]
	    return lines.join('\n')
	  },
	})

	// system-prompt section：注入已有记忆（函数形式，每次组装时求值）
	ctx.systemPrompt.section({
	  name: 'mirror:preferences',
	  order: config.sectionOrder,
	  text: () => {
	    if (!table) return ''
	    const rendered = renderPreferences(table, config.maxTokens, Date.now(), halfLifeMs)
	    if (!rendered) return '（mirror: 还没有任何记忆。当用户表达出可复用的原则/红线/工作方式/表达偏好时，调用 mirror_remember 记录。）'
	    return rendered
	  },
	})

	/*
	 * system-prompt section：手写引导词。
	 *
	 * 与上面「偏好记忆」的分工：偏好是模型自己记的，会衰减淘汰；引导词是人写的，
	 * 纪律是少而稳。order 排在偏好**之前** —— 人写的约束优先级高于模型的推断。
	 *
	 * 只注入 description 一行，全文走 memory_read 按需取。这是目录能不烂掉的关键：
	 * 20 条引导词也只占 20 行，而不是 20 篇文档。
	 */
	ctx.systemPrompt.section({
	  name: 'mirror:guidance',
	  order: config.sectionOrder - 10,
	  text: () => {
	    const { entries } = guidanceCache
	    if (!entries || entries.length === 0) return ''
	    return renderGuidance(entries, config.maxGuidanceChars).text
	  },
	})


  /*
   * HTTP 端点：给 client 端（记忆 tab）查偏好列表。
   *
   * 这个端点的头号职责是**说真话**：每条都要带 injected / tokens / overlong，
   * 让 UI 能区分「模型每轮都看得到」和「存在但预算挤掉了」。原版用
   * Infinity 取全部、只给强度，UI 于是显示「22 条判断在生效」，实际只注入
   * 5 条 —— 用户花力气看的东西从来没生效过，而界面一个字都没提示。
   */
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-mirror/preferences',
        handler: async (req, res) => {
          try {
            const now = Date.now()
            const injected = table ? selectMemories(table, config.maxTokens, now, halfLifeMs) : []
            const injectedKeys = new Set(injected.map(([k]) => k))
            const all = table ? selectMemories(table, Infinity, now, halfLifeMs) : []

            const body = JSON.stringify({
              // 预算实况：UI 顶部那一行「本轮注入 N 条 / 共 M 条 · 预算 X tok」
              budget: {
                maxTokens: config.maxTokens,
                usedTokens: injected.reduce((s, x) => s + x[3], 0),
                injectedCount: injected.length,
                totalCount: all.length,
              },
              memories: all.map(([, p, s, tokens]) => ({
                id: p.id,
                text: p.text,
                kind: p.kind ?? 'principle',
                reason: p.reason ?? '',
                strength: Math.round(s * 100) / 100,
                hits: p.hits,
                lastSeenAt: p.lastSeenAt,
                tokens,
                // 这条模型每轮看得到吗？看 UI 的第一件事就是这个
                injected: injectedKeys.has(p.id),
                // 超长 = 该搬去 guidance/ 或 reference/，别占 mirror 的预算
                overlong: p.text.length > MAX_MEMORY_CHARS,
              })),
              // 让 UI 能把「记什么/怎么分类」原样讲给人听，不用在两处各写一份
              kinds: KINDS,
              // 单条上限，UI 提示「超过这个长度就不记了」用
              maxChars: MAX_MEMORY_CHARS,
              // 给状态球表态用：刚记过什么、记了几条
              lastLearned,
            })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(body)
          } catch (err) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: String(err) }))
          }
        },
      }),
    'dsh-mirror: /preferences route',
  )

  /*
   * HTTP 端点：给 client 端看「手写引导词加载了什么」。
   *
   * 这是本次改造的重点之一 —— 用户此前根本看不到 ~/.dsh/memory 有没有被读。
   * 现在把扫描结果、每条是否进了预算、被截断的是谁，全摊开。
   */
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-mirror/guidance',
        handler: async (req, res) => {
          try {
            const rendered = renderGuidance(guidanceCache.entries, config.maxGuidanceChars)
            const included = new Set(rendered.included.map((e) => e.file))
            const body = JSON.stringify({
              memoryRoot: config.memoryRoot,
              scannedAt: guidanceCache.scannedAt,
              maxChars: config.maxGuidanceChars,
              usedChars: rendered.usedChars,
              entries: guidanceCache.entries.map((e) => ({
                file: e.file,
                description: e.description,
                priority: e.priority,
                tags: e.tags,
                lines: e.lines,
                injected: included.has(e.file),
              })),
              dropped: rendered.dropped.map((e) => e.file),
              diagnostics: guidanceCache.diagnostics,
            })
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(body)
          } catch (err) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: String(err) }))
          }
        },
      }),
    'dsh-mirror: /guidance route',
  )

  // vendor 路由：把 ai-orb 的 ESM 源码按同源静态资源下发给 client 端
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: VENDOR_PREFIX,
        handler: async (req, res) => {
          // 只放行 ORB_SRC 目录内的 .js。规范化后校验前缀，挡住 ../ 穿越 ——
          // 这是个对浏览器开放的读文件端点，不能只信 URL 长什么样。
          const rel = (req.url || '').split('?')[0].slice(VENDOR_PREFIX.length)
          const file = normalizePath(join(ORB_SRC, rel))
          if (!file.startsWith(ORB_SRC + sep) || !file.endsWith('.js')) {
            res.writeHead(403, { 'content-type': 'text/plain' })
            res.end('forbidden')
            return
          }
          try {
            const body = await readFile(file, 'utf8')
            res.writeHead(200, {
              'content-type': 'text/javascript; charset=utf-8',
              'cache-control': 'no-cache',
            })
            res.end(body)
          } catch {
            res.writeHead(404, { 'content-type': 'text/plain' })
            res.end('not found')
          }
        },
      }),
    'dsh-mirror: ai-orb vendor route',
  )

  // 工具：主动记下一条判断依据。判断谁该做，就交给谁 —— 这是脑的活，不是正则的活。
  ctx.tools.register(
    defineTool({
      name: 'mirror_remember',
      description:
        '记下一条可复用的判断依据，供以后所有会话使用。容量有限，宁缺毋滥。\n' +
        'text 必须是一句话、150 字以内 —— 这是判断依据的长度，不是 SOP 的长度。\n' +
        '不记：一次性请求（那是任务）、客观事实（路径账号服务器另有真源）、你自己的猜测。\n' +
        '同一主题有新说法就直接再记一次，系统会覆盖旧的。',
      // 注意：parameters 是「参数名 → schema」的映射，必填用内联 required: true。
      // 写成标准 JSON Schema（外面套一层 type: 'object' + properties）会被当成
      // 一个叫 type 的参数，报 `parameters.type must be a value schema object`。
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: '这条依据本身，一句话，150 字以内，用对方的说法。',
        },
        // enum 已经把四类枚举出来了，再逐条解释一遍是重复 —— 类名本身够自解释
        kind: { type: 'string', required: true, enum: Object.keys(KINDS) },
        reason: {
          type: 'string',
          required: true,
          description: '凭什么认为它可复用（在什么场景下说的）。',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            outcome: { type: 'string', required: true },
            total: { type: 'integer', required: true },
          },
        },
        render: (args, value) => [
          {
            type: 'text',
            text:
              (value.outcome === 'updated' ? '🪞 更新了一条记忆（覆盖同主题旧认知）：' : '🪞 记下一条新记忆：') +
              `\n${args.text}\n（${args.kind} · 现有 ${value.total} 条）`,
          },
        ],
      },
      async execute(args) {
        if (!table) throw new Error('mirror_remember: 记忆存储尚未就绪')
        if (!Object.hasOwn(KINDS, args.kind)) {
          throw new Error(`mirror_remember: kind 只能是 ${Object.keys(KINDS).join(' / ')}`)
        }
        const text = String(args.text || '').trim()
        if (text.length < 4) throw new Error('mirror_remember: text 太短，说不清就别记')
        // 超长一律拒收，并说清该往哪儿放 —— 放进去的代价是它一个人吃掉半个
        // 注入预算，再把后面十几条短原则挤出 system prompt（实测 22 条只生效 5 条）。
        // 只警告不拦没有用：模型记过一次就认为记过了，下次照记。
        if (text.length > MAX_MEMORY_CHARS) {
          throw new Error(
            `mirror_remember: text 有 ${text.length} 字，超过 ${MAX_MEMORY_CHARS} 字上限，没记。\n` +
              '判断依据是一句话，不是 SOP。带操作步骤、路径、token 名、工具名的内容属于两种东西：\n' +
              '  · 要 AI 每次会话都遵守的规矩 → ~/.dsh/memory/guidance/ 放一个 md（要有 description 头）\n' +
              '  · 只是资料/清单，需要时才查    → ~/.dsh/memory/reference/\n' +
              '如果核心判断能压进 ' + MAX_MEMORY_CHARS + ' 字，就压进去记 —— 抽象掉步骤，只留取舍。',
          )
        }
        const outcome = remember({ text, kind: args.kind, reason: String(args.reason || '').trim() })
        lastLearned = { at: Date.now(), count: 1 }
        ctx.logger?.info(`dsh-mirror: ${outcome} [${args.kind}] ${text}`)
        return { outcome, total: table.size }
      },
    }),
  )

  /*
   * 工具：读一条引导词的全文。
   *
   * system prompt 里只放了 description 一行 —— 那是索引。真要按某条做事时，
   * 用这个工具取全文。这样"有 30 条引导词"也不会把每轮请求撑爆。
   *
   * 只读 memoryRoot 下的文件，防目录穿越（guidance.js 里做了校验收口）。
   */
  ctx.tools.register(
    defineTool({
      name: 'memory_read',
      description:
        '读一条手写引导词的全文。system prompt 里的引导词列表只是摘要（一行一条），' +
        '真要按某条做事时用它取全文再执行。\n' +
        'name 传 system prompt 里显示的相对路径，如 "guidance/cs-flow.md"；' +
        '也可以读 "reference/xxx.md" 这类参考资料。',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: '相对 ~/.dsh/memory/ 的路径，如 guidance/cs-flow.md',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            text: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args) {
        const found = await readGuidanceFile(config.memoryRoot, args.name)
        if (!found) {
          const available = guidanceCache.entries.map((e) => 'guidance/' + e.file).join('、')
          throw new Error(
            'memory_read: 找不到 "' + args.name + '"。' +
              (available ? '可用的引导词：' + available : 'guidance/ 下暂无引导词。'),
          )
        }
        return { name: found.name, text: found.text }
      },
    }),
  )

  /*
   * 工具：撤掉一条记错的记忆。
   *
   * 这里原本是个 mirror_preferences 查询工具，但记忆本来就注入在 system prompt 里，
   * 再给一个查询工具是第二条读路径 —— 白占常驻 token。真正缺的是「撤」：
   * 只能写不能撤的话，一条记错的东西要么等半个月衰减掉，要么等同主题新说法覆盖它
   * （而中文同义换词还会漏检），在此期间它一直污染每一轮的系统提示。
   */
  ctx.tools.register(
    defineTool({
      name: 'mirror_forget',
      description:
        '撤掉一条记错的记忆（记成了一次性请求、客观事实，或本人否认过）。\n' +
        'text 传要撤的那条大意即可，按同主题匹配，不需要精确原文。',
      parameters: {
        text: { type: 'string', required: true, description: '要撤掉的那条记忆的大意。' },
        reason: { type: 'string', required: true, description: '为什么要撤。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            outcome: { type: 'string', required: true },
            forgot: { type: 'string', required: true },
            total: { type: 'integer', required: true },
          },
        },
        render: (_args, value) =>
          value.outcome === 'not_found'
            ? [{ type: 'text', text: '🪞 没找到对应的记忆，什么都没动。' }]
            : [{ type: 'text', text: `🪞 已撤掉：${value.forgot}\n（还剩 ${value.total} 条）` }],
      },
      async execute(args) {
        if (!table) throw new Error('mirror_forget: 记忆存储尚未就绪')
        const text = String(args.text || '').trim()
        if (text.length < 4) throw new Error('mirror_forget: text 太短，无法定位')
        const hit = findSimilar(table, text)
        if (!hit) return { outcome: 'not_found', forgot: '', total: table.size }
        const [key, p] = hit
        table.delete(key)
        ctx.logger?.info(`dsh-mirror: forgot [${p.kind}] ${p.text} —— ${args.reason}`)
        return { outcome: 'forgot', forgot: p.text, total: table.size }
      },
    }),
  )

  // HTTP：给「记忆」tab 的删除按钮用。/dsh-mirror/forget/<id>
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: FORGET_PREFIX,
        handler: async (req, res) => {
          // 只认 DELETE/POST：GET 会被浏览器预取或历史前进后退重放，误删就找不回来了
          if (req.method !== 'DELETE' && req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'method not allowed' }))
            return
          }
          const id = decodeURIComponent((req.url || '').split('?')[0].slice(FORGET_PREFIX.length + 1))
          if (!table || !id) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'missing id or storage not ready' }))
            return
          }
          const hit = [...table.entries()].find(([, p]) => p.id === id)
          if (!hit) {
            res.writeHead(404, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'not found' }))
            return
          }
          table.delete(hit[0])
          ctx.logger?.info(`dsh-mirror: forgot via UI [${hit[1].kind}] ${hit[1].text}`)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, total: table.size }))
        },
      }),
    'dsh-mirror: /forget route',
  )
}

export default { name, inject, Config, apply }
