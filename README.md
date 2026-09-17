<h1 align="center">🪞 dsh-user-mirror</h1>

<p align="center">
  <strong>Let the AI know you.</strong><br>
  让模型主动记下你的判断依据（原则 / 红线 / 工作方式），跨会话复用 —— 有容量、会遗忘、每条都说得出为什么记。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/deps-1%20runtime%20%C2%B7%205%20peer-blue?style=flat-square" alt="deps">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/DSH-%E2%89%A50.1.1--rc.2-8b5cf6?style=flat-square" alt="DSH">
  &nbsp;·&nbsp; <a href="CHANGELOG.md">更新日志</a>
</p>

---

## 这是什么

一个 DSH 插件：**让模型主动记下「你怎么想」**，跨 session 复用，再注入回系统提示。

- 🧠 **学** —— 模型意识到你表达了可复用的判断依据时，调用 `mirror_remember` 记下来，**并写下为什么记**
- 💾 **记** —— 用 `ctx.storageDomain` 本地持久化，**有容量上限、会遗忘、新认知覆盖旧的**
- 🎯 **用** —— 自动注入 system prompt，按 **token 预算** 注入，不是条数

### 只记判断依据，不记事实

这是这个插件唯一重要的取舍。**事实（路径、账号、服务器、仓库地址）另有真源**，
这里再记一份就是第二真源，两边迟早打架。所以它只收 cs 那类真源里没有的东西 ——
你的原则、取舍、红线、工作方式。

这同时也是「人脑不能无限递增」的解法：判断依据天然有限（几十条量级），事实无限。
只收前者，容量就不是靠淘汰硬撑出来的。

| 分类 | 记什么 |
|---|---|
| `principle` | 原则/取舍 —— 什么情况下怎么选 |
| `redline` | 红线 —— 绝对不要做什么 |
| `workflow` | 工作方式 —— 流程与协作习惯 |
| `taste` | 审美/表达 —— 措辞、风格、呈现 |

### 为什么不从 think 链里猜

v0.4 之前是用正则扫模型的 reasoning 流，找「用户偏好…」这类复述。实测在真实数据上
**命中 0 次** —— 它赌模型会用某种特定中文句式复述你，这个假设太脆弱；而且就算命中，
「用户想让我改这个按钮」这种一次性意图也会被当成长期偏好记下来。

「这算长期原则还是一次性请求」是判断，正则是手脚，手脚做不了这个判断。所以改成
模型自己判断、主动调用工具 —— 顺带解决了可解释性：**每次记录都发生在对话里，看得见，
每条都带理由**，而不是背后悄悄写。

## 记忆模型：有结构、会遗忘

记忆不是无限递增的——人就是会遗忘，新认知覆盖旧认知：

| 机制 | 规则 |
|---|---|
| **强度** | `强度 = 命中次数 × 时间衰减`（遗忘曲线） |
| **遗忘** | 半衰期默认 30 天：多久没被再次确认，强度减半 |
| **覆盖** | 同主题的新说法覆盖旧的（不新增近义条目） |
| **封顶** | 默认 20 条上限，满了淘汰强度最低的 |
| **预算** | 注入按 token 预算（默认 500），不是「塞全部」 |

同主题判定走两条通道：英文实体（`r2` / `picx` / `main` 这类词在技术语境里几乎等于
主题标签，共同命中两个即判同主题）+ 中文二元组重叠。**已知边界**：同义但完全换词的
纯中文（「回复一律用中文」vs「一律中文回复，术语保留英文」）会漏检，多存一条。
真要修得上 embedding，不值得为此加重量级依赖 —— 而且模型记录时看得见已有记忆，
防重主要靠它，`findSimilar` 只是兜底。

## 安装

```bash
dsh plugin --profile web add @dsh-plugins/dsh-user-mirror
```

⚠️ **只能装在提供 `storageDomain` 和 `webServer` 的 profile 上**（也就是 web）。
headless profile 两个服务都没有，插件会停在 `pending (waiting for services:
storageDomain, webServer)` 并让整个 boot 失败 —— 前者是记忆持久化的根基，
后者是「记忆」tab 取数据的通道。

## 怎么工作

1. 模型看到系统提示里已有的记忆（按强度排序、受 token 预算约束）
2. 你表达出某条可复用的判断依据时，模型调用 `mirror_remember(text, kind, reason)`
3. 归一化 + 实体/中文二元组双通道匹配，判断是覆盖同主题旧记忆还是新增
4. 新增后若超出容量上限，淘汰强度最低的一条
5. 下次组装 system prompt 时，这条就在里面了

工具调用是可见的，所以「它什么时候记了什么」你在对话里直接看得到。记忆 tab 里
每条还带着 `reason`（为什么记）和强度、确认次数、最后确认时间。

## 配置

在 `cordis.patch.yml` 里覆盖：

```yaml
- insert:
    - id: dsh-mirror
      name: dsh-user-mirror
      config:
        maxPreferences: 20   # 记忆容量上限（条数）
        halfLifeDays: 30     # 半衰期（天），越久越弱
        maxTokens: 500       # 注入的 token 预算
        sectionOrder: 160    # system prompt 里的位置（越小越靠前）
```

## UI

安装后，「对话 / 轨迹」后面会多一个**「记忆」tab**：

- 每条记忆展示 分类 + 内容 + **为什么记** + 强度/确认次数/最后确认时间
- 每条右侧有 `✕` 可以撤掉它。两段式：第一下只变成「确认撤掉？」，再点才真删 ——
  删除端点只认 DELETE/POST，`GET` 一律 405，免得被浏览器预取或前进后退重放误删
- 一个可展开的说明面板，直接回答「什么时候记？记哪些？为什么会忘？」
- 一颗 [ai-orb](https://github.com/webkubor/ai-orb) 状态球，会表态：
  拉取中 `thinking` / 刷新中 `working`（环在转）/ 刚记下 `done` + 角标显示记了几条 / 失败 `error`
- 数据来自 host 端 `/dsh-mirror/preferences`

球用的是 npm 上的 ai-orb 本体，不是抄一份进来：host 端把 `node_modules/ai-orb/src`
按同源静态资源下发（`/dsh-mirror/vendor/ai-orb/`），client 端 `import()` 它。
升级 ai-orb 只需升依赖，没有副本要同步。

## 工具

- `mirror_remember(text, kind, reason)` —— 记下一条判断依据
- `mirror_forget(text, reason)` —— 撤掉一条记错的（按同主题匹配，不用给精确原文）

**没有查询工具**，这是故意的：记忆本来就注入在 system prompt 里，再给一个查询工具
就是第二条读路径，白占常驻 token。v0.6 把原来的 `mirror_preferences` 换成了
`mirror_forget` —— 只能写不能撤的话，一条记错的东西要么等半个月衰减掉、要么等同主题
新说法覆盖它（而中文同义换词还会漏检），这期间它一直污染每一轮的系统提示。

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

## 隐私

- 偏好只存本地（`~/.dsh/storages/`）
- 不联网、不上传
- 想清空？删除 `dsh_mirror` domain 即可

## License

MIT © [webkubor](https://github.com/webkubor)
