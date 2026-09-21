<h1 align="center">🪞 dsh-user-mirror</h1>

<p align="center">
  <strong>让 AI 记住你怎么想，而不是你说过什么。</strong><br>
  DSH 插件 —— 模型主动记下你的原则、红线与工作方式，跨会话复用。<br>
  会遗忘、有容量上限、每条都说得出为什么记。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-user-mirror"><img src="https://img.shields.io/npm/v/%40dsh-plugins%2Fdsh-user-mirror?style=flat-square&color=8b5cf6&logo=npm&label=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@dsh-plugins/dsh-user-mirror"><img src="https://img.shields.io/npm/dm/%40dsh-plugins%2Fdsh-user-mirror?style=flat-square&color=6d7f9c&label=downloads" alt="downloads" /></a>
  <img src="https://img.shields.io/badge/DSH-%E2%89%A50.1.1--rc.2-4d6bfe?style=flat-square" alt="DSH" />
  <img src="https://img.shields.io/badge/runtime_deps-1-5A9E6F?style=flat-square" alt="deps" />
  <img src="https://img.shields.io/badge/license-MIT-777?style=flat-square" alt="MIT" />
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek_Harness-Plugin-4d6bfe?style=flat-square" alt="DSH Plugin" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-4d6bfe?style=flat-square" alt="dsh-plugin" /></a>
  <a href="https://github.com/topics/ai-memory"><img src="https://img.shields.io/badge/topic-ai--memory-8b5cf6?style=flat-square" alt="ai-memory" /></a>
  &nbsp;·&nbsp; <a href="CHANGELOG.md">更新日志</a> · <a href="DEV_NOTES.md">开发笔记</a>
</p>

<p align="center">
  <img src="https://img.webkubor.online/dsh-user-mirror/mirror-portrait.png" alt="记忆 tab：AI 眼中的你 —— 一句话速写、四类判断、每条被印证过几次" width="100%" />
  <br />
  <sub><b>记忆 tab</b> —— 不是一份记录列表，是一张画像：一句话速写、四类判断分区、<br/>
  红线单独成块，每条判断的字重就是它被印证的次数。</sub>
</p>

## 装它和不装它的区别

| | 不装 | dsh-user-mirror |
|---|---|---|
| 换一个会话 | 你的原则要**重讲一遍** | **自动注入，模型已经知道** |
| 模型到底记了什么 | 不透明，只能猜 | **记忆 tab 里一条条列出来** |
| 它凭什么记这条 | 无从追溯 | **每条都带理由，点开就看到** |
| 记多了会不会塞爆上下文 | 会 | **按 token 预算注入，不按条数** |
| 记错了怎么办 | 只能重开会话 | **点一下撤掉** |
| 过时的偏好 | 一直留着误导模型 | **会遗忘 —— 30 天没被印证就进淡忘区** |

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

## 记忆 tab 长什么样

安装后，「对话 / 轨迹」后面会多一个**「记忆」tab**。它不是一份记录清单，是一张画像：

- **一句话速写** —— 顶部直接给出「被印证最多的那条判断」，那就是模型眼里最认定你的一条
- **四类分区** —— 红线单独成块（越界有代价，且不参与遗忘），原则是主体，工作方式与审美压成两栏
- **强度就是字重** —— 被印证越多的判断字越重越实，弱的退成灰字；不显示「强度 3.7」这种对人没意义的数字
- **证据折在判断里** —— 正面只放抽象后的判断，点「看是哪几次」才展开它从哪些具体事件来的
- **正在淡忘** —— 30 天没被印证的判断进折叠区，让「会遗忘」这件事看得见
- 每条可以点 `✕` 撤掉。两段式：第一下只变成「确认撤掉？」，再点才真删 ——
  删除端点只认 DELETE/POST，`GET` 一律 405，免得被浏览器预取或前进后退重放误删
- 一颗 [ai-orb](https://github.com/webkubor/ai-orb) 状态球会表态：读取中 / 刷新中 / 刚记下（带角标）/ 失败

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

### 已知限制：改写幅度大的中文同义句会被记成两条

同主题判定走两条通道 —— 英文实体（`r2` / `picx` 这类技术名词，共享两个即判同主题）
和中文 bigram 重叠（阈值 0.3）。纯中文表述**只差一两个字**时能正确合并
（实测相似度 0.67–0.77），但**换一种说法**就会漏判：

| A | B | bigram 相似度 | 结果 |
|---|---|---|---|
| 提交之前一定要跑一遍测试 | 提交之前一定要先跑一遍测试 | 0.77 | ✅ 合并 |
| 删东西之前必须先问我 | 要删掉东西之前先来问一下我 | 0.18 | ❌ 记成两条 |

原因是 bigram 只看字面重叠，不理解同义。条目有上限，重复条目会挤掉真正有用的记忆。

**现在的对策**：`mirror_remember` 时尽量沿用已有表述；发现重复用 `mirror_forget` 删掉一条。
**根治要靠**同义归并（词向量或让模型自己判重），尚未做。这条限制被测试锁住
（`test/memory-core.test.mjs` 的「已知缺陷」用例），将来改进时那条会失败，提醒同步更新。

## 安装

```bash
dsh plugin --profile web add @dsh-plugins/dsh-user-mirror
```

⚠️ **只能装在提供 `storageDomain` 和 `webServer` 的 profile 上**（也就是 web）。
headless profile 两个服务都没有，插件会停在 `pending (waiting for services:
storageDomain, webServer)` 并让整个 boot 失败 —— 前者是记忆持久化的根基，
后者是「记忆」tab 取数据的通道。

### 关于 ai-orb 的 vendoring

唯一运行时依赖是 [ai-orb](https://github.com/webkubor/ai-orb)（SVG 状态球，零依赖）。
声明为 `dependencies` 但**不会被打进客户端 bundle**——client 端通过
`import('/dsh-mirror/vendor/ai-orb/index.js')` 同源加载，路径由 host 侧把
`node_modules/ai-orb/src/` 整目录以 `/dsh-mirror/vendor/ai-orb` 这个静态路由下发。

为什么不直接 bundle：状态球会被多个页面同时实例化，单独 ESM 模块走 HTTP/2 多路复用，
首屏不阻塞；而且 ai-orb 升级只需 `pnpm update ai-orb`，没有任何手抄副本需要同步。

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

## 工具

- `mirror_remember(text, kind, reason)` —— 记下一条判断依据
- `mirror_forget(text, reason)` —— 撤掉一条记错的（按同主题匹配，不用给精确原文）

**没有查询工具**，这是故意的：记忆本来就注入在 system prompt 里，再给一个查询工具
就是第二条读路径，白占常驻 token。v0.6 把原来的 `mirror_preferences` 换成了
`mirror_forget` —— 只能写不能撤的话，一条记错的东西要么等半个月衰减掉、要么等同主题
新说法覆盖它（而中文同义换词还会漏检），这期间它一直污染每一轮的系统提示。

## 隐私

- 偏好只存本地（`~/.dsh/storages/`）
- 不联网、不上传
- 想清空？删除 `dsh_mirror` domain 即可

## License

MIT © [webkubor](https://github.com/webkubor)
