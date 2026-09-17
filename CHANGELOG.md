# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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