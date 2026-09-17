/**
 * 记忆内核的功能测试。
 *
 * 2026-09-17 补。在此之前这个包只有三条「契约守卫」（包名、注册 id、README），
 * 而真正决定它有没有用的十个纯函数 —— 相似判定、强度衰减、预算选择 —— 一行测试都没有。
 * 这类错是静默的：不会报错，只会悄悄记错东西或该覆盖时没覆盖，等人发现时
 * 记忆库已经脏了。
 *
 * 用例优先取 index.js 注释里记下的**真实漏检案例**，那些是踩过的坑，
 * 比我现编的输入更有资格当回归基线。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalize, strengthOf, extractEntities, extractGrams,
  jaccard, findSimilar, selectMemories, renderPreferences, KINDS,
} from '../index.js'

const HALF_LIFE = 14 * 24 * 3600 * 1000 // 14 天
const NOW = Date.UTC(2026, 8, 17)
const mk = (text, over = {}) => ({ text, hits: 1, kind: 'principle', updatedAt: NOW, lastSeenAt: NOW, ...over })

test('normalize 去掉「用户」前缀与标点，用于同一性比较', () => {
  assert.equal(normalize('用户说：图片一律上 R2。'), '说图片一律上r2')
  // 同一句话的两种写法必须归一到一起，否则会被当成两条记忆
  assert.equal(normalize('图片，一律上 R2！'), normalize('图片一律上R2'))
})

test('strengthOf：命中越多越强，越久越弱', () => {
  const fresh = strengthOf(mk('x', { hits: 3 }), NOW, HALF_LIFE)
  const old = strengthOf(mk('x', { hits: 3, lastSeenAt: NOW - HALF_LIFE }), NOW, HALF_LIFE)
  assert.ok(fresh > old, '同样命中次数，越旧应该越弱')
  // 半衰期处衰减到 1/e，不是 1/2 —— 用的是 exp(-age/halfLife)
  assert.ok(Math.abs(old / fresh - Math.exp(-1)) < 1e-9)
  // hits 是线性因子
  assert.ok(Math.abs(strengthOf(mk('x', { hits: 2 }), NOW, HALF_LIFE) / fresh - 2 / 3) < 1e-9)
})

test('strengthOf 用 lastSeenAt，没有才回落 updatedAt', () => {
  const a = strengthOf({ text: 'x', hits: 1, updatedAt: NOW - HALF_LIFE, lastSeenAt: NOW }, NOW, HALF_LIFE)
  const b = strengthOf({ text: 'x', hits: 1, updatedAt: NOW - HALF_LIFE }, NOW, HALF_LIFE)
  assert.ok(a > b, 'lastSeenAt 更近时应该更强')
})

test('jaccard 边界：空集合返回 0，不能是 NaN', () => {
  assert.equal(jaccard(new Set(), new Set(['a'])), 0)
  assert.equal(jaccard(new Set(['a']), new Set()), 0)
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1)
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3)
})

test('findSimilar 认出「同一件事的两种说法」——注释里记的真实漏检案例', () => {
  const table = new Map([['k1', mk('图片一律上 R2，不要再往 picx 加图')]])
  const hit = findSimilar(table, '图片走 R2，picx 不再接受新图')
  assert.ok(hit, '这两句说的是同一条原则，必须判为同主题（否则记忆库里会堆两条重复的）')
  assert.equal(hit[0], 'k1')
})

test('findSimilar：完全无关的两条不能误判为同主题', () => {
  const table = new Map([['k1', mk('图片一律上 R2，不要再往 picx 加图')]])
  assert.equal(findSimilar(table, '每天下午三点提醒我喝水'), null)
})

test('findSimilar：太短的输入不判定（信号不足）', () => {
  const table = new Map([['k1', mk('图片一律上 R2')]])
  assert.equal(findSimilar(table, '好的'), null)
})

test('selectMemories 按强度排序并卡住 token 预算', () => {
  const table = new Map([
    ['weak', mk('这条很弱'.repeat(4), { hits: 1, lastSeenAt: NOW - 3 * HALF_LIFE })],
    ['strong', mk('这条最强'.repeat(4), { hits: 10 })],
    ['mid', mk('这条中等'.repeat(4), { hits: 3 })],
  ])
  const all = selectMemories(table, 10_000, NOW, HALF_LIFE)
  assert.deepEqual(all.map(([k]) => k).slice(0, 2), ['strong', 'mid'], '应按强度降序')

  const tight = selectMemories(table, 10, NOW, HALF_LIFE)
  assert.ok(tight.length < all.length, 'token 预算小的时候必须截断')
  assert.equal(tight[0][0], 'strong', '截断时保留最强的')
})

test('selectMemories 丢弃已彻底遗忘的条目', () => {
  const table = new Map([['ghost', mk('很久没被确认了', { hits: 1, lastSeenAt: NOW - 100 * HALF_LIFE })]])
  assert.equal(selectMemories(table, 10_000, NOW, HALF_LIFE).length, 0)
})

test('renderPreferences：没有记忆时一个字都不注入', () => {
  assert.equal(renderPreferences(new Map(), 10_000, NOW, HALF_LIFE), '')
  // 全部遗忘时同样不注入，不能剩个空标题
  const dead = new Map([['g', mk('x', { hits: 1, lastSeenAt: NOW - 100 * HALF_LIFE })]])
  assert.equal(renderPreferences(dead, 10_000, NOW, HALF_LIFE), '')
})

test('renderPreferences 输出带序号、kind 与强度', () => {
  const out = renderPreferences(new Map([['k', mk('图片一律上 R2', { kind: 'principle', hits: 5 })]]), 10_000, NOW, HALF_LIFE)
  assert.match(out, /1\. \[principle\] 图片一律上 R2（强度 5\.0）/)
  assert.match(out, /会遗忘，可被新认知覆盖/)
})

test('KINDS 是稳定枚举 —— 存量记忆按它归类，改动会让旧数据失去分类', () => {
  assert.ok(Object.keys(KINDS).length > 0)
  for (const [k, v] of Object.entries(KINDS)) {
    assert.equal(typeof k, 'string')
    assert.ok(v, `${k} 要有描述，工具定义里会展示给模型`)
  }
})

test('jaccard 空集合必须返回 0，不能让 NaN 泄漏进相似判定', () => {
  // 去掉空集合兜底时 0/0 = NaN，而 NaN >= 阈值 恒为 false ——
  // 相似判定会悄悄退化成「永不命中」，不报错、不崩溃，只是记忆库开始堆重复条目。
  // 2026-09-17 变异测试发现：改坏这行，原有用例一个都抓不住。
  const r = jaccard(new Set(), new Set())
  assert.equal(r, 0)
  assert.ok(!Number.isNaN(r), 'NaN 会让下游阈值比较静默失效')
})

test('中文通道：零实体的中文同义句必须判为同主题（锁住 bigram 阈值）', () => {
  // 前面那条 R2/picx 用例其实走的是实体通道（共享 r2、picx 两个实体），
  // 把 GRAM_THRESHOLD 改成 0.99 它照样通过 —— 中文通道等于没测。
  // 这里用**零实体、且相似度明显跨过阈值**的句子，强制走 bigram 分支并锁住阈值。
  const cases = [
    ['图片一律上传到对象存储不要放仓库', '图片一律上传到对象存储不要放代码仓库'],
    ['提交之前一定要跑一遍测试', '提交之前一定要先跑一遍测试'],
  ]
  for (const [a, b] of cases) {
    assert.equal(extractEntities(a).size, 0, `用例必须零实体，否则被实体通道接管：${a}`)
    const table = new Map([['k', mk(a)]])
    const hit = findSimilar(table, b)
    assert.ok(hit, `只差一两个字的同义句必须判为同主题，否则会被记成两条：\n  A: ${a}\n  B: ${b}`)
  }
})

test('中文通道有已知缺陷：改写幅度大的同义句仍会漏判', () => {
  // 实测：换一种说法（而非只差一两个字）时 bigram 相似度只有 0.18-0.23，低于 0.3 阈值。
  // 也就是说**同一条原则换个说法会被记成两条**。这是已知限制，不是测试写错。
  // 锁住现状的目的：将来改进分词或加同义归并时这条会失败，提醒同步更新预期。
  const a = '删东西之前必须先问我'
  const b = '要删掉东西之前先来问一下我'
  const j = jaccard(extractGrams(a), extractGrams(b))
  assert.ok(j < 0.3, `实测 ${j.toFixed(3)}；若已超过阈值说明分词改进了，请更新本用例与 README 的已知限制`)
  assert.equal(findSimilar(new Map([['k', mk(a)]]), b), null, '当前实现下这对会漏判（已知缺陷）')
})
