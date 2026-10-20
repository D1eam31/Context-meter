# Context Meter 技术文档

## 状态

当前版本为 Context Meter 0.1.2。0.1.0 已完成 macOS arm64 本地安装验证。验证版 0.1.0-probe.2 的实际侧面板打开及持续刷新由用户确认，随后进入完整开发；0.1.0 的指标卡、表格及暂停/继续也已获得用户确认。0.1.1 已修复会话标题与选择列表，新增 5 项回归测试；界面已完成模拟宿主下的浏览器检查，用户已于 2026-10-20 确认新版面板正常打开。完整版本的自动化检查、运行时打包及协议测试结果见同目录《Context-Meter-测试报告.md》。真实 UI 的用户确认与自动化证据分别记录，不混为同一种验证。

## 目标环境

| 组件 | 已探测版本 / 计划版本 | 管理方式 |
| --- | --- | --- |
| macOS | 26.7.1 arm64 | 实机 |
| 桌面客户端 | 26.1007.30912，build 20156 | 现有安装 |
| Codex CLI | 0.162.0-alpha.17.2 | 客户端附带，仅用于插件管理 |
| mise | 2026.10.14 | 本机现有安装 |
| Node.js | 24.22.0 LTS，已安装 | 本机 mise，项目级固定版本 |
| npm | 11.19.1 | Node 分发附带，未全局升级 |
| MCP SDK | @modelcontextprotocol/sdk 1.32.1 | 精确版本、npm 锁文件 |
| MCP Apps SDK | @modelcontextprotocol/ext-apps 1.7.5 | 与 MCP SDK 1.x 配套；不是 SDK 2.x 组合 |
| zod | 4.6.7 | 精确版本 |
| TypeScript / Node 类型 | 7.0.2 / @types/node 24.19.2 | 开发依赖 |
| esbuild / Ajv | 0.28.2 / 8.20.0 | 构建及 Schema 验证 |
| sharp | 0.35.5 | 仅构建图标；不进入运行时包 |
| Python | 项目不依赖 | 本轮系统 Python 3.9.6 仅用于只读探测 |

Node 实际路径：`~/.local/share/mise/installs/node/24.22.0/bin/node`。mise 路径：`~/.local/bin/mise`。本机缓存实际位于 `~/Library/Caches/mise`。未修改系统 Python，也未通过 Homebrew、独立安装器或全局 npm 安装运行时。

## 环境安装与重建

首次安装执行了项目 `mise trust mise.toml` 和 `mise install`，安装时由 mise 校验官方 Node 分发及其校验信息；随后生成 `mise.lock`。运行中安装产生过缓存目录权限不足，补充实际缓存路径权限后完成，未关闭校验。

源码环境重建：

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

当前执行主机的登录 shell 曾未找到 mise，实际执行改用上述绝对路径。开发依赖均写入 package-lock.json；安装源为 npm 官方注册表。重建使用锁文件，发布包不需要 npm install。

图标构建依赖 sharp 的首次选择版本在 npm audit 中出现高危通告，已更新至 0.35.5；交付前重新执行 npm ci、构建、测试及 audit。最终结果以测试报告为准。

## 实施顺序

1. 制作最小 stdio MCP 与面板资源。
2. 测试协议、会话隔离和统计数值。
3. 测试本地 marketplace 安装、实际客户端面板和无模型参与刷新。
4. 在用户确认验证版面板显示、刷新以及协议和数值测试通过后，完成增量适配、三平台包和技术资料。浏览器新增统计的精确延迟单独保留为实测项目。

## 架构与数据边界

数据流：本地会话目录 → 服务端日志适配器 → 数值计算 → stdio MCP 工具 → MCP Apps 侧面板。UI 使用官方 App SDK，通过宿主代理调用工具；不自行开启 HTTP 端口，不使用 CDN，不调用 OpenAI 推理 API，也不创建周期性模型请求。

服务端读取 `CODEX_HOME/sessions`；缺省为用户目录下 `.codex/sessions`。0.1.1 额外只读同一 CODEX_HOME 根目录下的固定文件 `session_index.jsonl`，仅解析 id、thread_name、updated_at，为会话匹配标题；不读取其他根目录文件或 SQLite 数据库。工具不接受文件路径。扫描跳过目录和文件符号链接；打开前后校验真实路径、根目录包含关系和文件身份，并以只读方式打开。会话正文可能在扫描时作为字节经过内存，只有元数据和统计事件被解析保留；不返回正文、提示词或工具输出，不写入会话日志。

会话标识不保证对应唯一日志。列表同时返回 `session_id` 和基于相对日志路径生成的 SHA-256 `session_ref`；工具按后者读取。相同标识的记录分别展示，标题相同也不合并。不猜测当前聊天，也不自动挑选最近修改的记录。日志移动后引用会变化，需要刷新列表重新选择。

UI 每 2 秒读取所选记录，使用请求代次校验避免快速切换时旧响应覆盖新会话。隐藏、暂停或销毁面板时停止轮询；重新显示或继续时恢复。数据只存在服务端内存及当前面板实例中。

## 增量读取与兼容策略

- 记录文件身份、偏移、未完成行、最近统计和压缩状态；稳定追加时只扫描新增字节。
- 单次以 256 KiB 分块，最多扫描 32 MiB；未追平时明确返回 catching_up。超大日志首次加载可能超过 3 秒，界面显示扫描进度。
- 行缓冲上限为 2 MiB；超长记录跳到下一个换行符，不保留整段图片编码。统计事件本身超限也会被跳过，因此相应数据可能不可用。
- 未完成的最后一行不接受为事件。多字节 UTF-8 在完整行收齐后解析。
- 文件截断、原子替换、同长度改写会重置扫描；另外检查已处理边界附近 256 字节，识别常见的截断后增长改写。此方法基于日志正常追加的假设，不对任意历史中部编辑提供完整内容校验。
- 目录索引缓存 10 秒，用户刷新列表时立即重建。不存在的目录返回明确状态，单个无法读取的条目计入跳过数量。
- 忽略未知事件；计数缺失和格式异常不转为零。服务重启后重新扫描，不依赖持久化索引。

## 会话标题与选择列表（0.1.1）

标题取自本地 session_index.jsonl，以 id 匹配会话，按 updated_at 保留最新标题。该索引同样不是稳定公开 API。缺少索引、未知格式或没有匹配时 title 返回 null，面板显示“未命名会话”，不会把第一条用户提示词当成标题。

索引仅接受普通文件，拒绝符号链接；使用只读句柄并核对文件身份和修改信息。索引上限 8 MiB，单行上限 16 KiB，标题最多 160 个 Unicode 码点。超限、半行或异常时安全退回无标题，不阻断用量监控。清理控制字符后，UI 仍只通过 textContent 渲染，避免将标题作为 HTML 执行。刷新会话列表时重新读取索引，因此重命名后需要刷新列表。

列表使用面板内的 details、搜索框和按钮，替代原生 select 弹出菜单；背景和文字颜色成对设置，避免宿主深色主题中出现白色不可读选项。支持按标题、会话标识和记录引用搜索；显示修改时间与短码区分重复记录。完整标识可展开查看，所选会话仍以 session_ref 精确绑定。

## MCP 接口

| 工具 | 参数 | 可见范围 | 返回 |
| --- | --- | --- | --- |
| open_monitor | 空对象 | 模型与 App / 会话入口 | 会话列表、可用状态、版本；绑定 UI 资源 |
| list_sessions | 空对象 | 仅 App | 记录引用、标题（可为 null）、会话标识、开始和修改时间、重复记录数 |
| get_session_metrics | session_ref，64 位小写十六进制 | 仅 App | 最近/累计数值、派生指标、上报/读取时间、状态和扫描进度 |

三个工具均声明 `readOnlyHint: true`、`destructiveHint: false`、`openWorldHint: false`。资源 URI 为 `ui://context-meter/monitor.html`，MIME 为 `text/html;profile=mcp-app`。UI 只通过 `app.callServerTool` 调用本服务；会话入口使用官方 `openai/ui.entrypoints` 的 thread 类型。

错误会返回简短可恢复提示，不将内部文件路径或异常堆栈返回给模型或 UI。无效引用、记录移走、权限不足和读取期间替换均不会返回另一份记录的数据。

## 统计口径

最近和累计缓存命中率分别为对应 cached_input_tokens / input_tokens。未缓存输入为输入减缓存输入。窗口占用估算使用最近 total_tokens / model_context_window，分母取事件上报值，不硬编码模型窗口。

缓存输入仍占上下文窗口。累计 tokens 不是当前窗口占用。reasoning_output_tokens 是 output_tokens 的明细，不重复相加。缺失、负数、非整数、零分母、缓存大于输入及不一致总数会使相应指标不可用；不通过截断为 100% 掩盖异常。

状态包括 reported、unavailable、catching_up 和 awaiting_post_compaction。检测到压缩后保留并标注旧值，新的有效统计到达后更新。界面使用本地时间格式展示 ISO 上报时间，未获得事件时显示不可用。

## 打包与安装

使用 Agent Plugins 1.0 的根 plugin.json 和 mcp.json。实际宿主要求 stdio command 是裸命令或包含在插件中的 `./` 路径；`${PLUGIN_ROOT}` 保留用于参数和 cwd。首次验证的错误启动命令已被宿主明确拒绝，修正后服务正常发现。

为向 Codex 的本地进程转发自定义 CODEX_HOME，增加 `.codex-plugin/plugin.json` 环境兼容声明。当前 CLI 的解析输出已确认 env_vars 包含 CODEX_HOME；这不是额外的网络权限或服务地址。

三种平台分别生成包，均包含服务器、UI、技能、图标、匹配架构的 Node 和许可证。Mac 启动 `./runtime/node`，Windows 启动 `./runtime/node.exe`。通过二进制头检查架构；跨平台分发不意味着已完成跨平台运行验证。

macOS 构建主机上的打包命令：

```sh
mise exec -- node scripts/package.mjs --target darwin-arm64 --output /absolute/output --archive
mise exec -- node scripts/package.mjs --target darwin-x64 --output /absolute/output --archive
mise exec -- node scripts/package.mjs --target win32-x64 --output /absolute/output --archive
```

异构运行时须先下载至 build/downloads，文件名为官方 node-v24.22.0 分发名。脚本先比对 mise.lock 中相应平台的 SHA-256，再提取 Node 与 LICENSE。每包包含 runtime/provenance.json，ZIP 附带 SHA-256 文件。打包时检查官方清单 Schema 和 ZIP 完整性。Windows 上的本机无 ZIP 暂存模式用于 CI；统一 ZIP 导出目前在 macOS/Linux 构建主机执行。

当前本机已注册 marketplace `context-meter-dev`，源目录为交付目录下 context-meter-local，插件为 `context-meter@context-meter-dev`。源码开发目录在 work/context-meter。升级修改源目录并运行官方 CLI，不编辑缓存。完整版本已安装到 `~/.codex/plugins/cache/context-meter-dev/context-meter/0.1.2`。

具体安装、卸载和 GitHub 分发方法见源码 README 以及交付目录的分发说明。

## 官方依据

- 插件打包：https://developers.openai.com/plugins/build/plugins
- 桌面插件发布：https://developers.openai.com/plugins/deploy/desktop-only
- 扩展入口：https://developers.openai.com/plugins/build/extensions
- MCP Apps：https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html
- OpenAI MCP Extensions：https://github.com/openai/mcp-extensions/blob/main/docs/spec.md
- Node：https://nodejs.org/en/download
- mise：https://mise.jdx.dev/configuration.html

日志 `event_msg.token_count.info` 是本地实现细节，不是稳定公开 API。MCP 和 UI 使用官方 SDK 与协议，日志格式单独适配。

## 发布边界

目标平台为 macOS arm64、macOS x64、Windows x64。目前只有 macOS arm64 实机；其他平台未经运行验证，不得标为支持验证通过。已提供三平台 CI 配置，尚未上传 GitHub 或运行远程工作流。

GitHub 源码和 Release 分发不要求 OpenAI 开发者认证。官方插件目录中的本地 MCP 提交需要获批准入及发布者验证；用户尚无这些资料，作为后续工作记录，不阻止本地软件交付。

公开目录元数据中已草拟五个正向、三个负向审核用例和发布说明。没有填写虚构发布者、国家、收费声明、政策链接或录屏 URL；当前包不是“已准备好提交审核”的成品。项目源码已按用户选择采用 MIT；依赖和 Node 的实际许可继续随包附带。

## 累计量与窗口容量示例

截图中最近请求为 302,810 输入 + 364 输出 = 303,174 tokens；303,174 ÷ 475,000 ≈ 63.8%。16,337,649 是多次请求的累计消耗，可以大于窗口容量。每轮发送的历史会再次计入该轮输入，缓存命中仍计入输入；压缩也不会清零历史累计。累计数值不代表当前上下文长度、唯一文字数量或实际账单金额。

0.1.1 将表头改为“最近一次请求”和“多次请求累计”，合计行明确标注输入加输出，并在进度条下直接显示估算公式。

## 0.1.2 许可与 GitHub 准备

新增根目录 LICENSE（MIT），版权声明为 Copyright (c) 2026 Context Meter contributors。package.json、package-lock.json 根包及 plugin.json 同步 license 为 MIT。分平台包和源码包均包含完整 LICENSE，Node 与依赖声明继续保留。private: true 仅防止 npm 误发布，不影响 GitHub 公开源码。

发布版本使用 0.1.2 区分补齐许可后的分发包；统计逻辑与选择界面未改变。公开源码目录单独导出，排除依赖目录、构建缓存、真实日志、凭证及运行时。未自动创建 Git 仓库、提交或上传 GitHub。
