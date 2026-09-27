/**
 * dsh-mirror / guidance —— 手写引导词的读取与注入。
 *
 * 与「偏好记忆」的分工：
 *   - 偏好记忆（preferences 表）：模型自己记的，有强度/衰减/淘汰。
 *   - 引导词（本模块）：人自己写的，纪律是「少而稳」，不做衰减。
 *
 * 目录约定（~/.dsh/memory/）：
 *   guidance/    注入 system prompt —— 每条只进 description 一行，全文按需读
 *   reference/   不注入 —— 清单、资料、盘点，等模型需要时再读
 *   archive/     不读 —— 过期或已移交的留档
 *
 * 防膨胀（这是目录能不烂掉的关键）：
 *   1. 只注入 description 一行，不注入全文 —— 20 条引导词也只占 20 行。
 *   2. 总预算封顶，超了按 priority 截断，并明确标出「哪条被截了」。
 *   3. 没有 description 的文件不注入（只记进 diagnostics），逼作者写摘要。
 *   4. 抄 cs 真源的（archive 里那种）不注入 —— 真源在 cs rule，抄一份就是第二真源。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 默认引导词目录。 */
export const DEFAULT_MEMORY_ROOT = join(homedir(), '.dsh', 'memory')

/**
 * 解析一个 md 文件的 frontmatter。
 * 只支持最简单的 `key: value` 形式 —— 不引 yaml 依赖，也不该在引导词里写嵌套。
 * @param raw - 文件全文。
 * @returns `{ meta, body }`，无 frontmatter 时 meta 为空对象。
 */
export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  // 结尾分隔符必须独占一行：找 '\n---' 之后紧跟换行或文件末尾的那个
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const after = raw.slice(end + 4)
  // 结尾标记后应当只剩一个换行（或直接结束）；否则不是我们认的 frontmatter
  if (after !== '' && !after.startsWith('\n') && !after.startsWith('\r\n')) {
    return { meta: {}, body: raw }
  }
  const head = raw.slice(3, end)
  // 吃掉结尾标记后的换行与紧随的空行，让正文从真实内容开始
  const body = after.replace(/^(?:\r?\n)+/, '')
  const meta = {}
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (m) meta[m[1]] = m[2].trim()
  }
  return { meta, body }
}

/**
 * 扫描引导词目录。
 * @param root - memory 根目录。
 * @param opts - `{ nowMs }`（保留参数，便于测试稳定）。
 * @returns `{ entries, diagnostics }`；entries 已按 priority 降序、名称升序排好。
 */
export async function scanGuidance(root = DEFAULT_MEMORY_ROOT, opts = {}) {
  const dir = join(root, 'guidance')
  const diagnostics = []
  let names = []
  try {
    names = await readdir(dir)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { entries: [], diagnostics: [{ level: 'info', message: 'guidance/ 目录不存在，跳过引导词注入' }] }
    return { entries: [], diagnostics: [{ level: 'warn', message: 'guidance/ 读取失败: ' + String(err) }] }
  }

  const entries = []
  for (const fname of names.sort()) {
    if (!fname.endsWith('.md')) continue
    const full = join(dir, fname)
    let raw = ''
    try {
      const st = await stat(full)
      if (!st.isFile()) continue
      // 单文件硬上限：引导词不该超过 32KB（超过基本是抄了别处的真源）
      if (st.size > 32 * 1024) {
        diagnostics.push({ level: 'warn', message: fname + ' 超过 32KB，疑似抄录真源，已跳过' })
        continue
      }
      raw = await readFile(full, 'utf8')
    } catch (err) {
      diagnostics.push({ level: 'warn', message: fname + ' 读取失败: ' + String(err) })
      continue
    }

    const { meta, body } = parseFrontmatter(raw)
    const description = (meta.description || '').trim()
    if (!description) {
      diagnostics.push({ level: 'warn', message: fname + ' 缺少 description，未注入（请补 frontmatter）' })
      continue
    }
    const priority = Number.isFinite(Number(meta.priority)) ? Number(meta.priority) : 50
    entries.push({
      file: fname,
      path: full,
      description,
      priority,
      tags: (meta.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
      lines: body.split('\n').length,
    })
  }

  entries.sort((a, b) => (b.priority - a.priority) || a.file.localeCompare(b.file))
  return { entries, diagnostics }
}

/**
 * 把引导词渲染成 system prompt 段落。
 * 只放 description 一行 —— 全文走 memory_read 按需取。
 * @param entries - scanGuidance 的结果。
 * @param maxChars - 预算（字符）。近似 2 字符 ≈ 1 token。
 * @returns `{ text, included, dropped, usedChars }`。
 */
export function renderGuidance(entries, maxChars) {
  if (entries.length === 0) return { text: '', included: [], dropped: [], usedChars: 0 }

  const head = [
    '用户的引导词（手写，优先级高于你的默认习惯）：',
    '',
    '这些是**索引**。要按某条做事时，用 memory_read 取全文再执行——别照着这一行猜细节。',
    '',
  ].join('\n')

  // 显示路径必须带 guidance/ 前缀 —— 与 memory_read 的入参完全一致，
  // 否则模型照着这一行去读会 404，白白多一次失败往返。
  const relOf = (e) => 'guidance/' + e.file

  const included = []
  const dropped = []
  let used = head.length
  for (const e of entries) {
    const line = '- [' + e.priority + '] ' + e.description + '  → ' + relOf(e)
    if (used + line.length + 1 > maxChars) {
      dropped.push(e)
      continue
    }
    included.push(e)
    used += line.length + 1
  }
  if (included.length === 0) return { text: '', included, dropped, usedChars: 0 }

  const lines = included.map((e) => '- [' + e.priority + '] ' + e.description + '  → ' + relOf(e))
  let text = head + lines.join('\n')
  if (dropped.length > 0) {
    // 明确说出来，绝不静默丢 —— 否则用户永远不知道红线被挤掉了
    text += '\n\n（预算不足，以下引导词本次未注入：' + dropped.map((e) => e.file).join('、') + '。要它们生效，精简已有引导词或调大 maxGuidanceChars。）'
  }
  return { text, included, dropped, usedChars: used }
}

/**
 * 读一条引导词的全文（给 memory_read 工具用）。
 * @param root - memory 根目录。
 * @param name - 文件名（guidance/ 下）或 'reference/xxx.md' 这类相对路径。
 * @returns 文件全文，或 null（不存在 / 越界）。
 */
export async function readGuidanceFile(root, name) {
  // 防目录穿越：只允许 memory 根下的相对路径，且不含 ..
  const cleaned = String(name).replace(/^\.\//, '').trim()
  if (cleaned.includes('..') || cleaned.startsWith('/')) return null
  const full = join(root, cleaned)
  if (!full.startsWith(root)) return null
  try {
    const st = await stat(full)
    if (!st.isFile()) return null
    if (st.size > 256 * 1024) return { name: cleaned, text: '（文件过大，超过 256KB，拒绝读取）', truncated: true }
    const text = await readFile(full, 'utf8')
    return { name: cleaned, text, truncated: false }
  } catch {
    return null
  }
}
