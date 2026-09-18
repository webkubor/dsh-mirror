# 开发笔记 — dsh-user-mirror

> 这些是踩过的坑与结构约束，面向改这个插件的人。用户向的说明在 [README](./README.md)。

## 开发笔记：`@deepseek-ai/*` 必须放 peerDependencies，否则 DSH 全站工具调用崩

**这是本插件造成过的最严重事故，务必别再犯。**

把 `@deepseek-ai/dsh-tools` 这类包写进 `dependencies`，安装后 profile 的
`node_modules` 里就会多出第二份。而 DSH 的工具调度句柄是用模块内私有的
`Symbol()`（不是 `Symbol.for()`）做 key 的：

```js
// dsh-tools/lib/index.js
const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler")
// dsh-agent-loop/lib/index.js:193
const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)
```

两份 `dsh-tools` = 两个不相等的 Symbol = 读出来是 `undefined`，于是**每一次工具调用**
都炸成 `UNKNOWN: Cannot read properties of undefined (reading 'prepare')`。更糟的是
这一轮会留下没有响应的 `tool_calls`，下一轮直接被上游 API 拒绝
（`assistant message with 'tool_calls' must be followed by tool messages`），
整个会话废掉。

而且**孤儿包也算**：profile 的 `package.json` 依赖为空、`bundles` 里也没有这个插件，
只要 `node_modules/@deepseek-ai/` 还残留着，照样全崩。所以卸载插件并不够。

正确写法照抄官方生态插件 `dsh-context`：`dependencies` 留空或只放真正的第三方库，
所有 `@deepseek-ai/*` 加上 `react` / `zod` 一律进 `peerDependencies`。

已存量的救急办法是把重复目录换成指向宿主那份的软链（Node 按 realpath 去重，
就收敛回单实例）：

```bash
G=$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai
W=~/.dsh/profiles/web/node_modules/@deepseek-ai
for p in dsh-tools dsh-storage-domain dsh-system-prompt schemastery cosmokit; do
  rm -rf "$W/$p" && ln -s "$G/$p" "$W/$p"
done
# 验证两边 realpath 一致
```

已报给上游：<https://github.com/deepseek-ai/deepseek-harness/discussions/4640>

## 开发笔记：别在自己正在用的 profile 上试未验证的代码

插件 `apply` 里抛错**会让整个 plugin tree 加载失败**，DSH 随即降级启动 ——
web 服务还在（页面能打开），但模型列表、会话历史这些插件全没上来，看起来像「数据丢了」。

所以改完先在一个不影响日常使用的 profile 上验证 boot 能过，再动天天在用的那个。
最省事的冒烟测试是 `dsh --profile <name> --help`：它需要 app 实例才能列出 flags，
所以 boot 阶段的错误会在这一步就暴露，不用花 API 额度。

⚠️ 本插件的例外：它依赖 `storageDomain` + `webServer`，headless 上装不了（见上文），
所以只能在 web 上验证 —— 那就更要先 `--help` 冒烟一遍。

## 开发笔记：client 半侧有**两层** inject，别混

写 DSH client 插件最容易踩的坑 —— 报错长这样：

```
cannot get property "slots" without inject
```

明明 `package.json` 里写了 `dsh.client.inject`，却还是抛。因为那是**另一层**：

| 位置 | 写什么 | 作用 |
|---|---|---|
| `package.json` → `dsh.client.inject` | **包名** | informational —— 只是加载/预取元数据，**不做服务守卫、也不排 apply 顺序** |
| client 模块 → `exports.inject` | **服务名** | cordis fiber inject，真正的服务访问守卫 |

DSH 自己的 `dsh-client-ui-workspace` 在源码注释里写明了这点：

> `dsh.client.inject` edges are informational (loading/prefetch metadata, never apply
> sequencing) … apply therefore depends on each slot declaration through `slots.inject()`
> instead of assuming order.

所以两条规矩：

1. **访问 `ctx.<service>` 前，必须在 client 模块上 `exports.inject = ['slots', ...]`。**
2. **注册 slot 要走 `ctx.slots.inject('<slot-name>', () => ctx.slots.register(...))`**，
   不要 `ctx.effect(() => ctx.slots.register(...))`。目标 slot（如 `conversation.view`）
   由 ui-conversation 声明，激活顺序不保证；假定顺序的话，即使补了 `exports.inject`
   也可能静默不挂载 —— 不报错，tab 就是不出现，比直接崩更难查。

另外 `dsh.client.immediately: true` 只适合**无服务依赖的纯 DOM 插件**（如换皮肤）。
要等服务的插件不该抢跑，官方带 inject 的插件都没有它。

改了 `dsh.client` 这一段属于 boot graph 层面，**必须重启 DSH 才生效**（改 JS 逻辑则只需
重新部署 + 刷新页面）。重启后旧标签页里的 bundle 请求会落在服务重启窗口内、`<script>`
onerror 之后不会自动重试，表现成「某个插件 failed to load / 一直加载中」——
硬刷新（Cmd+Shift+R）即可，不是真的坏了。
