# Context Meter 分发与安装

## GitHub 与官方插件目录

将代码放在 GitHub、发布 Release 附件，不需要 OpenAI 开发者认证。创建仓库需要 GitHub 账号及相应权限。项目已按你的选择采用 MIT，根目录 LICENSE 已补齐。当前未代你创建或上传仓库。

官方插件目录是另一条渠道。本地 MCP 插件目前需要获批准入和发布者验证。官网、支持页面、隐私政策、服务条款和审核录屏属于官方目录提交材料；当前暂无这些资料，不影响 GitHub 分发和本地安装。

依据：[GitHub 创建仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)、[GitHub 许可证说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)、[OpenAI 桌面插件提交](https://developers.openai.com/plugins/deploy/desktop-only)。

## 当前交付

- `context-meter-0.1.2-darwin-arm64.zip`：Apple 芯片 Mac；本机运行已检查；0.1.1 标题列表已获用户确认；0.1.2 仅更新许可与文档。
- `context-meter-0.1.2-darwin-x64.zip`：Intel Mac；构建与完整性检查完成，实机验证待办。
- `context-meter-0.1.2-win32-x64.zip`：Windows x64；构建与完整性检查完成，实机验证待办。
- `context-meter-0.1.2-source.zip`：开发源码、依赖锁文件、测试和 CI 配置，不含已安装依赖或用户会话日志。

每个运行包包含 Node 24.22.0，使用者无需安装 Node、Python、mise 或独立监控 App。仍需通过 Codex 支持的本地插件安装流程加载；这些附件不是已经上架的官方商店条目。

## 本机现状

当前交付版本为 0.1.2；通过官方 CLI 升级，安装状态见 0.1.2 验证记录。本机 marketplace 源位于交付目录的 `context-meter-local`。该目录是本地安装源，保留它即可继续升级；不要把它当成临时文件删除。

打开当前会话侧面板中的 Context Meter，手动选择一份记录。相同会话标识会列出多个独立记录引用。用户已确认 0.1.0 指标卡、用量表格以及暂停/继续功能正常，并于 2026-10-20 确认 0.1.1 标题列表版正常打开。0.1.1 用标题和搜索列表替换原生下拉框；升级后请重启客户端并重新打开面板。重命名会话后点击“刷新会话列表”。

## 其他电脑安装

1. 下载匹配平台的 ZIP 和 SHA-256 文件，校验后解压到固定目录。ZIP 内顶层目录名是 `context-meter`。
2. 在同一个 marketplace 根目录创建 `.agents/plugins/marketplace.json`，内容见下面示例。根目录应同时包含 `context-meter` 文件夹与 `.agents` 文件夹。
3. 使用官方 CLI 添加来源并安装，然后重启桌面客户端。

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

macOS 示例：

```sh
codex plugin marketplace add /absolute/path/to/marketplace
codex plugin add context-meter@context-meter-local
```

Windows PowerShell 示例：

```powershell
codex plugin marketplace add 'C:\path\to\marketplace'
codex plugin add context-meter@context-meter-local
```

这些路径仅为命令示例，需替换为实际解压目录。若 shell 中找不到 codex，请使用已安装客户端的官方 CLI 路径或其插件安装入口，不要另装监控 App。

首次打开没有任何记录被自动选中。看不到数据时，先刷新会话列表，确认客户端在本机执行并已产生统计事件；自定义目录通过 CODEX_HOME 配置。首次扫描大日志会分批追赶，过程中会提示统计尚未追平。

## 发布到自己的 GitHub

1. 项目已采用 MIT；选择仓库名称，在自己的 GitHub 创建空仓库。
2. 将源码 ZIP 解压后的内容作为仓库内容。不要上传 node_modules、build、真实 `.codex` 日志或凭证。
3. 运行源码 README 中的 mise 重建、构建和测试命令。
4. 推送后查看三平台 CI 的实际结果；工作流配置本身不代表测试已经通过。
5. 创建版本标签和 Release，将三个运行 ZIP、SHA-256 文件及已验证的平台说明作为附件。大运行时适合 Release 附件，不需要进入源码 Git 历史。
6. 给用户上述本地安装说明。没有官方目录准入时，不宣称能够直接从官方目录搜索安装。

后续可以将一个 Git marketplace 作为安装来源，但需要设计并测试其平台分发方式；当前不假设一个 Git 仓库会自动为不同系统挑选二进制附件。

## 官方目录准备状态

已草拟发布说明、默认图标、五个正向和三个负向审核用例。以下项目待发布者后续补充：本地 MCP 准入、验证主体、四类公开页面、国家范围及商业声明、真实审核录屏、相应平台的实测证据。

录屏建议使用测试会话：展示插件版本、选择记录、观察指标刷新、切换两份同标识记录、暂停/继续以及缺失统计提示。保留可读结果，避免真实提示词和凭证出镜。录屏脚本不是已经录好的演示；当前没有录制或上传视频。

审核用例已写入插件清单。程序级相关行为已被自动测试覆盖；端到端自然语言审核用例尚未在提交门户运行，不能标为审核通过。

详细上传命令见《Context-Meter-GitHub上传指南.md》；只上传导出的源码目录，将运行 ZIP 与校验清单作为 Release 附件。
