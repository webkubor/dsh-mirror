/**
 * 存量记忆压缩迁移 —— 2026-09-28
 *
 * 为什么做：单条 150 字上限 + 密度排序上线后，22 条里有 7 条超长被拦在注入之外。
 * 逐条看下来分三类：
 *   · 真判断，只是把步骤写进去了      → 抽象掉步骤，只留取舍
 *   · SOP / 操作手册                  → 搬到 guidance 或 reference
 *   · 插件自己的架构说明（不是用户判断）→ 删
 *
 * 跑法：node scripts/migrate-20260928-compress.mjs [--dry]
 * 幂等：按 id 匹配，重复跑不会重复处理；已迁移过的条目带 _migrated 标记会跳过。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const STORE = join(homedir(), '.dsh', 'storages', 'dsh_mirror.json')
const dry = process.argv.includes('--dry')

/**
 * id → 新文本。
 * 判据：读完之后，模型不需要翻别的文件就能改行为；如果这句话在指导「打开哪个文件、
 * 敲什么命令」，那它不是判断依据，是 SOP。
 */
const REWRITE = {
  // ── 原来是 SOP，抽象成判断 ────────────────────────────────────
  'pref-mucgy8h0-40apv5':
    '决策点让 codex 和 claude 双 agent 交叉评估：各自独立给意见再汇总比对，挑差异大的点二轮。思维链真源是 ~/.dsh/memory/，agent 自己读，不在调用时塞历史。',
  'pref-mucoqk7d-x9amyz':
    'kyvault 有多个后端会静默漂移：文档里写的 secret:// ref 本机查不到不等于它不存在，先换 KYVAULT_BACKEND 再找。',
  'pref-mujat7qj-bm6ujn':
    '想给「建议你去做 X」之前硬卡三项：用户是不是已经做过、他做得到吗（跨账号资产红线）、报错含义查证了吗。任一项没过就先去查，不出方案。',
  'pref-muja3zp5-deks94':
    '规则写完没人读等于没写 —— 约定一律做成能拦的 CI 门禁挂在 prepublishOnly 上。判断 SOP 有没有落实，拿规则逐条 grep 实际产物。',
  'pref-mujch593-6czm5m':
    '判断「有没有问题」要落到权威状态字段，不能只看自己观察到的表面异常。看起来不对 ≠ 真有问题，先验证它是否真会坏事。',
  'pref-mujcboy3-oig10i': null, // 插件自己的架构说明，不是用户判断 → 删
  'pref-mub2v1t2-w3u8t9':
    '官网部署到测试环境只能进「待验证」，视觉质量是独立门槛：样式没达标就不能关单/上线，继续在 QA 修。',
  'pref-mucc4mz5-pz8jgp':
    '盘点项目先分清产品侧资产和研发团队自己的平台，别混在一个口径里说 —— 单子落在谁那儿要分清。',
  'pref-mujcboy1-2p1vaz':
    '补丁打错层，短期能过长期一定漂移：能力问题修模型声明层，「该怎么干活」进记忆/引导词层，都不塞进路由层。',
  'pref-mukucoqr-7bk2qi':
    'R2 图床是我个人的，公司/ModelGo 的资产不许放进去 —— 要给业务配图就找运维要公司的图床。',
  'pref-mujcdukg-buy4sx':
    'dsh-user-mirror 是我个人资产，发布走个人流程不走公司审批。',
  'pref-muhtqga7-s35nsf':
    '写 UI 必须用 lite-browser 实测渲染，不能靠语法检查 + 猜 CSS 变量 —— 主题变量真源在 dsh-bloom-theme，写之前先 grep 出真实 token 名。',
}

/** 已够短的条目，原样保留（列出来只为让你能对照检查）。 */
const KEEP = [
  'pref-mu730p1r-nmwxkh', 'pref-mu72xia4-8pj9dx', 'pref-mu72xibk-2jb4da', 'pref-mu72xiae-d6tfiu',
  'pref-mu72xiay-64ieon', 'pref-mu72xibd-a7fh87', 'pref-mu72xiar-hllf3c', 'pref-muhwkiao-kk6adh',
  'pref-mukucowp-u93fid', 'pref-mukw34n7-t5aqob',
]

const MAX = 150
const store = JSON.parse(readFileSync(STORE, 'utf8'))
const table = store.tables.preferences

let rewritten = 0
let deleted = 0
const problems = []
const after = {}

for (const [id, next] of Object.entries(REWRITE)) {
  const p = table[id]
  if (!p) { problems.push(`⚠ 找不到 ${id}（可能已经被手动删过）`); continue }
  if (p._migrated) { problems.push(`- ${id} 已迁移过，跳过`); continue }
  if (next === null) {
    delete table[id]
    deleted++
    problems.push(`- 删除 ${id}：${p.text.slice(0, 30)}…（插件自己的架构说明，不是用户判断）`)
    continue
  }
  if (next.length > MAX) {
    problems.push(`✗ 改写后仍超长（${next.length} > ${MAX}）：${next.slice(0, 30)}…`)
    continue
  }
  p.text = next
  p.reason = (p.reason || '') + ' ｜ 2026-09-28 压缩：原来把操作步骤写进来了，抽象掉步骤只留判断。'
  p._migrated = '2026-09-28'
  rewritten++
}

for (const [id, p] of Object.entries(table)) {
  if (p.text.length > MAX) problems.push(`✗ 仍然超长（${p.text.length}）：${p.text.slice(0, 30)}…`)
  after[id] = { kind: p.kind, tok: Math.ceil(p.text.length / 2), len: p.text.length }
}

console.log(`改写 ${rewritten} 条，删除 ${deleted} 条，未动 ${KEEP.length} 条，剩 ${Object.keys(table).length} 条`)
console.log(`总注入量（全部塞进去）：${Object.values(after).reduce((s, x) => s + x.tok, 0)} tok`)
if (problems.length) console.log('\n' + problems.join('\n'))

if (!dry) {
  writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n')
  console.log('\n已写入 ' + STORE)
} else {
  console.log('\n[dry] 未写入')
}
