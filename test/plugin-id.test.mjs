/**
 * 守卫：client.js 里 __ModuleLoader__.load({ id }) 必须等于 package.json 的 name。
 *
 * 宿主按 package.json 的 name 去找注册项，对不上就整个 client bundle 加载失败，
 * 报 "loaded without registering <name> via __ModuleLoader__.load" —— 而且是静默的，
 * 类型检查和普通单测都发现不了。
 *
 * 2026-09-17 建这条时，这个包正处在坏的状态：name 是 @webkubor/dsh-user-mirror，
 * 而 id 还写着无 scope 的 dsh-user-mirror（scope 迁移时漏改）。同一个形状的 bug
 * 在 dsh-llm-hub 上发生过一次，那次也是迁 scope 漏改注册 id。
 *
 * 断言两边都从文件里读，不写死任何包名 —— 写死期望值的断言在改名时非但拦不住，
 * 反而成了钉住旧名的锚。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('client.js 注册的 id 等于 package.json 的 name', () => {
  const m = client.match(/__ModuleLoader__\.load\(\{[\s\S]{0,800}?\bid:\s*['"]([^'"]+)['"]/)
  assert.ok(m, '没找到 __ModuleLoader__.load({ id: ... }) —— 注册块被改动过就来核对这条')
  assert.equal(
    m[1], pkg.name,
    `注册 id 与包名不符：id='${m[1]}' 而 name='${pkg.name}'。` +
    '宿主按 name 找注册，对不上会让整个 client bundle 一起加载失败。',
  )
})
