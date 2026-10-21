# Context Meter

在支持 MCP Apps 的 Codex 桌面客户端中，查看本地会话记录的 token 用量、提示词缓存命中率与上下文窗口占用估算。

## 使用

安装后打开会话侧面板中的 Context Meter，按会话标题搜索，手动选择一份会话记录；完整标识可展开查看。标题来自本地 session_index.jsonl；没有标题时显示“未命名会话”，不从正文提取。界面每 2 秒更新；同一会话标识的不同日志记录单独列出。窗口数值来自最近上报事件，不能视为逐 token 实时计量。首次扫描大日志时显示追赶进度。

发布包包含固定版本 Node 24.22.0，运行不需要系统 Node、Python 或 mise。程序不会修改或上传会话日志。会话日志不是稳定公开 API；客户端格式变更可能需要更新适配器。

macOS arm64 已完成协议和本地运行验证。macOS x64 与 Windows x64 包只完成构建、格式及完整性检查，尚未完成实机启动和桌面界面验证。公开目录上架仍取决于本地 MCP 准入及审核。

## 源码环境

使用本机 mise，项目固定 Node 24.22.0：

```sh
mise trust mise.toml
mise install --locked
mise exec -- node --version
mise exec -- npm --version
mise exec -- npm ci --ignore-scripts
mise exec -- npm run typecheck
mise exec -- npm run build
mise exec -- npm test
```

`mise.toml`、`mise.lock` 与 `package-lock.json` 记录版本和下载校验信息。首版不使用 Python。`--ignore-scripts` 避免安装依赖时执行生命周期脚本；esbuild 与 sharp 使用锁定的可选平台二进制包。

## 本地安装

将目标平台 ZIP 解压到一个固定目录，在同一个 marketplace 根目录下创建 `.agents/plugins/marketplace.json`：

```json
{
  "name": "context-meter-local",
  "interface": { "displayName": "Context Meter Local" },
  "plugins": [{
    "name": "context-meter",
    "source": { "source": "local", "path": "./context-meter" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Productivity"
  }]
}
```

然后运行：

```sh
codex plugin marketplace add /absolute/path/to/marketplace
codex plugin add context-meter@context-meter-local
```

重启客户端后打开插件。升级时替换 marketplace 中的源码目录，再通过 CLI 安装新版本；不要编辑插件缓存。

卸载：`codex plugin remove context-meter@context-meter-local`。移除本地目录源：`codex plugin marketplace remove context-meter-local`。mise 的 Node 与本地 Codex 日志不会随插件卸载。

## 数据与接口

数据根目录使用 `CODEX_HOME`，未设置时使用用户目录下的 `.codex`。用量读取范围为其 `sessions` 子目录；额外只读根目录固定的 `session_index.jsonl` 标题元数据。目录只在服务端解析，工具不接受任意文件路径。选择使用 `session_ref`，显示使用 `session_id`；同标识日志不会合并。

- `open_monitor({})`：打开面板。
- `list_sessions({})`：返回记录列表、目录可用状态和跳过条目数。仅 App 可调用。
- `get_session_metrics({"session_ref":"64位十六进制引用"})`：返回所选记录的统计。仅 App 可调用。

详情见 [技术文档](docs/TECHNICAL.zh-CN.md)、[测试报告](docs/TESTS.zh-CN.md) 和 [分发安装说明](docs/DISTRIBUTION.zh-CN.md)。

## 依赖许可与发布

运行时许可见 `runtime/NODE-LICENSE`，已打包依赖的许可见 `dist/THIRD-PARTY-NOTICES.txt`。项目源码采用 [MIT 许可证](LICENSE)，版权声明为 Copyright (c) 2026 Context Meter contributors。发布主体和公开目录政策资料仍由发布者补充。此交付不代表已公开发布或已通过审核。

## 0.1.1 更新

会话名称与搜索列表替代代码串和原生下拉菜单，统一深浅色配色。重复记录保留独立引用。表头明确区分最近请求与多次请求累计，并显示窗口占用估算公式。22 项自动化测试通过；新列表在模拟宿主的浏览器预览中已检查，实际 Codex 客户端已于 2026-10-20 获用户确认正常打开。

许可证选择见 [对比说明](docs/LICENSE-OPTIONS.zh-CN.md)。用户已选择 MIT，详细条款见根目录 LICENSE。

## 0.1.2 更新

补齐 MIT 许可证、npm 与插件许可证元数据，以及源码和运行包中的 LICENSE。界面与统计功能沿用 0.1.1。GitHub 上传步骤见 [发布指南](docs/GITHUB.zh-CN.md)。源码目录与 GitHub 仓库不包含运行时大文件；安装 ZIP 作为 Release 附件分发。
