import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseFrontmatter, scanGuidance, renderGuidance, readGuidanceFile } from '../guidance.js'

test('parseFrontmatter 解析 key: value', () => {
  const { meta, body } = parseFrontmatter('---\ndescription: 一句话\npriority: 90\n---\n\n# 标题\n正文')
  assert.equal(meta.description, '一句话')
  assert.equal(meta.priority, '90')
  assert.ok(body.startsWith('# 标题'))
})

test('parseFrontmatter 无 frontmatter 时原样返回', () => {
  const { meta, body } = parseFrontmatter('# 标题\n正文')
  assert.deepEqual(meta, {})
  assert.equal(body, '# 标题\n正文')
})

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-guidance-'))
  await mkdir(join(root, 'guidance'), { recursive: true })
  await mkdir(join(root, 'reference'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content, 'utf8')
  }
  return root
}

test('scanGuidance 按 priority 降序', async () => {
  const root = await fixture({
    'guidance/low.md': '---\ndescription: 低\npriority: 10\n---\nlow',
    'guidance/high.md': '---\ndescription: 高\npriority: 100\n---\nhigh',
  })
  const { entries } = await scanGuidance(root)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].file, 'high.md')
  assert.equal(entries[1].file, 'low.md')
  await rm(root, { recursive: true, force: true })
})

test('scanGuidance 跳过缺 description 的文件并记诊断', async () => {
  const root = await fixture({
    'guidance/ok.md': '---\ndescription: 有\n---\nok',
    'guidance/nodesc.md': '# 没有 frontmatter',
  })
  const { entries, diagnostics } = await scanGuidance(root)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].file, 'ok.md')
  assert.ok(diagnostics.some((d) => d.message.includes('nodesc.md')))
  await rm(root, { recursive: true, force: true })
})

test('renderGuidance 只输出 description 行，不含全文', async () => {
  const entries = [
    { file: 'a.md', description: '描述A', priority: 90, tags: [], lines: 10 },
  ]
  const { text, included } = renderGuidance(entries, 4000)
  assert.equal(included.length, 1)
  assert.ok(text.includes('描述A'))
  assert.ok(text.includes('memory_read'))
})

test('renderGuidance 超预算时截断并明确标注', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    file: 'f' + i + '.md', description: 'x'.repeat(60), priority: 100 - i, tags: [], lines: 5,
  }))
  const { included, dropped } = renderGuidance(entries, 400)
  assert.ok(included.length < entries.length, '应有条目被截断')
  assert.ok(dropped.length > 0, '应记录被截断的条目')
})

test('readGuidanceFile 防目录穿越', async () => {
  const root = await fixture({ 'guidance/a.md': 'AAAA' })
  assert.equal(await readGuidanceFile(root, '../../etc/passwd'), null)
  assert.equal(await readGuidanceFile(root, '/etc/passwd'), null)
  const ok = await readGuidanceFile(root, 'guidance/a.md')
  assert.equal(ok.text, 'AAAA')
  await rm(root, { recursive: true, force: true })
})
