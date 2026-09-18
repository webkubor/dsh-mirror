# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.7.0] - 2026-09-18

### 记忆 tab 从「记录列表」变成「一张画像」

原来打开记忆 tab，看到的是一份数据库视图：每条记录平权排列，下面跟一行
`强度 3.7 / 确认 5 次 / 2 天前`，四类记忆混在一个流里只靠一个小徽章区分。
人从里面读不出自己是谁。

现在它是一张画像：

- **一句话速写** —— 顶部直接给出被印证最多的那条判断，那就是模型眼里最认定你的一条
- **强度就是字重** —— 越被印证的判断字越重越实，弱的退成灰字。不再显示「强度 3.7」
  这种对人没有意义的数字
- **证据折进判断里** —— 正面只放抽象后的判断，点「看是哪几次」才展开它从哪些具体
  事件来的。技术细节不占版面，但追溯链还在
- **红线单独成块** —— 四类不该长得一样。红线是越界有代价的硬约束，给它唯一的朱砂色，
  并且不参与遗忘
- **「正在淡忘」折叠区** —— 会遗忘是这个插件最独特的机制，以前完全看不见

视觉上：画像头一层极淡光晕，卡片依次浮起、hover 微微上抬，强度条从左展开，
印证次数用小横条计量。所有动效在系统「减少动态效果」下自动关闭，关掉后信息结构不变。
内容限宽 860px 居中 —— 超宽屏上铺满会把每行拉到 100+ 字，判断本身就读不下去了。

### 其它

- README 重做：加了 npm / 下载量 / topic 徽章、记忆 tab 实拍图，以及「装它和不装它
  的区别」对照表；三段开发笔记移到 [DEV_NOTES.md](./DEV_NOTES.md)，README 只留用户向内容
- 新增 `npm run deploy`：直接同步到 web profile，改完刷新页面就能看到，不必等发版

> 数据契约没有变化，`index.js` 未改动，升级不影响已有记忆。

## [0.6.3] - 2026-09-17

### 包名迁移

- `name` 从 `@webkubor/dsh-user-mirror` 迁到 `@dsh-plugins/dsh-user-mirror`（org scope）。
  原因：org 名比个人账号名得体，读起来是「dsh-plugins 项目组的插件」，而不是「
  webkubor 这个人的玩具」。
  旧的 `@webkubor/dsh-user-mirror@0.6.2` 不删 —— 按 `dsh-plugins` 顶层 README 的规则，
  只挂 deprecate 指向新名，`npm unpublish` 一律不碰（虽然月下载为 0，但流程一致）。
- version 跳到 **0.6.3**（跳过 0.6.2 —— 那是 0.6.1 改名 + 一次空内容的占位重发，
  详见下方 0.6.2 节）。

### 修复

- **client.js 注册 id 与 package.json 的 name 对齐**：迁移到 org scope 时漏改了
  `__ModuleLoader__.load({ id })`，宿主按 `package.json` 的 name 找注册项，
  对不上就**静默不挂载** —— 类型检查和普通单测都发现不了，只有打开页面才会发现
  那个 tab / 入口不见了。dsh-llm-hub 在 0.6.3 上发生过同形状的事故。

### 新增

- **测试**：新增 `test/plugin-id.test.mjs` 守卫这条 regression。
  守卫不写死期望值，而是分别从 `package.json` 和 `client.js` 里读 —— 写死期望值的断言
  在改名时非但拦不住，反而成了钉住旧名的锚。`npm test` 已在 `package.json` 的
  `scripts` 里接好。

## [0.6.2] - 2026-09-17

### 发布占位

- 与 0.6.1 内容等同的一次重发，发布在 `@webkubor/dsh-user-mirror` scope 下。
  0.6.2 **没有对应的 commit**（包名迁移过程中、工作区处于混合状态时发出的占位重发，
  本仓库 git 树里没有这个版本），也没有 tag —— 它只是在 npm 注册表上占着 0.6.2
  这个号码。

  本条按 git 证据如实记录：编一份看起来完整的清单，比留一句「查不到」更坏。

  补这节的原因是发布工作流（参 `dsh-llm-hub/.github/workflows/publish.yml` 的同样处理）
  的 Release 步骤要从 CHANGELOG 取对应小节，取不到就 `process.exit(1)`：缺小节意味着
  `gh workflow run publish.yml -f tag=v0.6.2` 这类补发会直接失败。

## [0.6.1] - 2026-09-17 之前

### 基础版本（从 npm tarball 恢复）

- **记忆模型**：强度 = 命中次数 × 时间衰减，半衰期默认 30 天，容量上限 20 条，
  按 token 预算（默认 500）注入。
- **同主题覆盖**：英文实体（`r2` / `picx` / `main` 这类技术语境里的主题标签）+ 中文
  二元组重叠双通道判定。已知边界：完全换词的纯中文同义句会漏检 —— 真要修得上 embedding，
  不值得为此加重量级依赖。
- **工具**：`mirror_remember(text, kind, reason)`（记 + 写明为什么记）、
  `mirror_forget(text, reason)`（按同主题匹配撤掉，v0.6 把原来的 `mirror_preferences`
  替换成它 —— 只能写不能撤的话，一条记错的东西要么等半个月衰减、要么等同主题新说法
  覆盖它，期间一直污染每一轮的系统提示）。
- **故意不提供查询工具**：记忆本来就在 system prompt 里，再给查询工具就是第二条
  读路径，白占常驻 token。
- **UI**：「对话 / 轨迹」之后多一个「记忆」tab，每条带分类 + 内容 + `reason` +
  强度/确认次数/最后确认时间，右上 ✕ 两段式删除（DELETE/POST 限定 + 同源校验，
  GET 一律 405，免得被预取或前进后退重放误删）。
- **状态球**：用 npm 上的 [ai-orb](https://github.com/webkubor/ai-orb) 本体（host 端按
  同源静态资源下发 `/dsh-mirror/vendor/ai-orb/`），不是抄一份进来；升 ai-orb 只需升
  依赖，没有副本要同步。
- **cordis 挂载**：单行 `insert` —— `id: dsh-mirror`、`name: dsh-user-mirror`，由
  `dsh.bundle.patch` 自动 insert。
- **强约束**：只能装在提供 `storageDomain` + `webServer` 的 profile 上（也就是 web），
  headless 上两个服务都缺 —— 依赖路径在 README「安装」节明写。