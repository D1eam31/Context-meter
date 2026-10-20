# Context Meter 上传 GitHub 指南

当前发布版本为 0.1.2，项目源码采用 MIT。LICENSE 中版权声明为 `Copyright (c) 2026 Context Meter contributors`，没有冒用已验证个人或企业身份。若希望改为自己的公开姓名或 GitHub 用户名，应在首次发布前统一修改版权声明，并重新生成 ZIP 与校验文件。

本指南提供命令，不代表已经上传。运行 `git push` 会把提交发送到你指定的 GitHub 仓库；如果仓库为 Public，源码将对所有人公开。

## 1. 准备 GitHub 空仓库

本机已检测到 `/usr/bin/git`，没有在 PATH 中检测到 `gh`，因此主流程不依赖 GitHub CLI，也不需要另装桌面 App。

在 GitHub 登录后创建名为 `context-meter` 的仓库。若希望公开开源，选择 Public。不要勾选生成 README、.gitignore 或许可证，因为本地已经包含这些文件。复制新仓库的 HTTPS 地址。

## 2. 初始化和上传

使用导出的干净源码目录，不要在整个 outputs 目录初始化仓库。把命令中的 `YOUR_USERNAME`、`你的公开署名`、`你的GitHub提交邮箱` 替换为自己的信息。提交邮箱可以使用 GitHub Settings → Emails 中显示的 noreply 地址。

下面的 `git config` 只配置当前仓库，不修改全局 Git 设置。

```sh
cd "/absolute/path/to/context-meter"

git init -b main
git config user.name "你的公开署名"
git config user.email "你的GitHub提交邮箱"

git add .
git diff --cached --stat
git commit -m "feat: release Context Meter 0.1.2 under MIT"

git remote add origin "https://github.com/YOUR_USERNAME/context-meter.git"
git push -u origin main
```

推送前查看 `git diff --cached --stat` 的清单，应包含源码、测试、图标、文档、锁文件和 LICENSE，不包含 node_modules、build、dist、runtime、evidence、会话日志或凭证。导出的源码目录已经排除这些文件；.gitignore 也保留相应规则。

若提交邮箱不正确，先修改 `git config user.email`，再提交。若 GitHub 提示该仓库已存在提交，不要使用强制推送覆盖它；改用新的空仓库，或先按 Git 提示处理现有历史。

## 3. 身份验证

如果 Git 已配置 GitHub 凭据，推送会使用现有认证。若 HTTPS 要求输入密码，应使用 GitHub Personal Access Token，而不是账号登录密码。不要把 Token 写进仓库 URL、脚本或任何提交文件。

若创建仅限该仓库的 fine-grained Token，推送源码需要 Contents 的读写权限；由于源码包含 `.github/workflows/verify.yml`，新增或更新工作流还需要相应的 Workflows 写权限。已有 SSH 配置的用户，也可以将远程地址改为 GitHub 给出的 SSH 地址后推送。

## 4. 检查 CI

推送后打开仓库的 Actions，查看 Verify 工作流的 macOS arm64、Intel macOS 和 Windows 结果。提供工作流不等于 CI 已通过；当前没有代你运行 GitHub 工作流。即使 CI 启动检查通过，也不能代替相应平台的真实桌面面板验证。

## 5. 发布下载安装包

先推送版本标签：

```sh
git tag v0.1.2
git push origin v0.1.2
```

然后到仓库的 Releases → Draft a new release，选择 `v0.1.2`，上传交付目录中的附件：

- context-meter-0.1.2-darwin-arm64.zip
- context-meter-0.1.2-darwin-x64.zip
- context-meter-0.1.2-win32-x64.zip
- context-meter-0.1.2-source.zip
- SHA256SUMS-0.1.2.txt

发布说明可直接使用《Context-Meter-0.1.2-发布说明.md》。三平台 Node 运行时只放在 Release 附件中，不提交进源码仓库。每个运行包包含匹配架构的 Node 24.22.0，用户不需要安装 Node/Python/mise。

在 Release 中保留验证状态：Apple 芯片 Mac 已完成本机运行验证，0.1.1 标题列表版已获用户确认；Intel Mac 和 Windows 仍待实机验证。GitHub Release 不会自动让插件上架 Codex 官方目录，跨平台附件也不会自动变成按平台分发的插件目录。

如果你以后安装了 GitHub CLI，仓库登录并推送后也可在当前仓库目录运行以下命令发布附件：

```sh
gh auth login --hostname github.com --git-protocol https --web

RELEASE_DIR="/absolute/path/to/releases"
gh release create v0.1.2 \
  "$RELEASE_DIR"/context-meter-0.1.2-*.zip \
  "$RELEASE_DIR/SHA256SUMS-0.1.2.txt" \
  --verify-tag \
  --title "Context Meter 0.1.2" \
  --notes-file "$RELEASE_DIR/Context-Meter-0.1.2-发布说明.md"
```

此命令会公开发布 Release；只在确认仓库内容、附件和说明后执行。

## 6. 后续更新

始终在同一个源码仓库里修改、提交和推送：

```sh
git add .
git commit -m "fix: describe the actual change"
git push
```

每次发布使用新的版本号与标签。不要反复对现有仓库执行 `git init`、`git remote add origin` 或首次发布命令。

## 官方依据

- [GitHub：上传本地代码](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [GitHub：管理 Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub CLI：创建仓库](https://cli.github.com/manual/gh_repo_create)
- [GitHub CLI：创建 Release](https://cli.github.com/manual/gh_release_create)
- [GitHub：大文件与 Release 附件](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
