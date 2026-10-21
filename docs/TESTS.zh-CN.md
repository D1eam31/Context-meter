# Context Meter 0.1.2 测试报告

记录日期：2026-10-20（Asia/Shanghai）。macOS 26.7.1 arm64；客户端 26.1007.30912 build 20156；mise 2026.10.14；Node 24.22.0；npm 11.19.1。依赖版本未改变，不引入 Python。

## 本次变更

用户明确选择 MIT。已新增完整 LICENSE，package.json、package-lock.json 根包和 plugin.json 设置 license 为 MIT。版本升为 0.1.2，运行包复制项目 LICENSE，并继续保留 Node 与第三方依赖许可。界面和统计逻辑沿用 0.1.1。

## 验证结果

- 类型检查、构建、22 项自动化测试通过；清单 Schema、版本和 MIT 许可元数据均通过检查。
- 0.1.1 标题列表版已获本聊天用户确认“可以正常打开”。该结果为人工确认，不是自动截图，也没有测量新增事件的精确 UI 显示延迟。
- 0.1.1 浏览器预览已检查深浅色、380 px 窄面板、标题搜索、重复记录、暂停状态与 HTML 文本安全；本次未修改相关逻辑。
- 三平台包的 LICENSE、清单、Node 运行时、第三方许可与 ZIP 结构须在导出后校验，结果保存在 0.1.2 验证记录。
- macOS arm64 的最终包使用自带 Node 完成协议和两秒轮询节奏检查；其精确毫秒结果保存在验证记录，不能冒充浏览器渲染延迟。
- Intel Mac 与 Windows 的实机运行、桌面面板和远程 CI 仍待验证。未上传 GitHub，未提交公开目录。

## 自动化原始结果

```text
> context-meter@0.1.2 test
> node --test tests/*.test.mjs

✔ latest and weighted cumulative cache rates are independent of context size (0.602042ms)
✔ missing, zero denominators, invalid and contradictory counts are unavailable (0.151375ms)
✔ cumulative consumption can exceed capacity without inflating context occupancy (0.370417ms)
✔ titles use explicit metadata; renamed and duplicate records retain independent references (21.545834ms)
✔ missing, malformed and partial title metadata do not leak prompts or stop monitoring (4.413667ms)
✔ oversized title indexes fall back without allocating unbounded metadata (6.926292ms)
✔ title index symlinks cannot read metadata outside CODEX_HOME (2.436875ms)
✔ explicit record selection isolates sessions without exposing paths or content (3.127083ms)
✔ duplicate session IDs remain selectable as separate records (2.575041ms)
✔ idle polling scans zero new bytes; partial append waits for newline (2.636583ms)
✔ truncation resets incremental state (1.9615ms)
✔ atomic file replacement resets the same opaque record reference (1.998042ms)
✔ truncate-and-rewrite with growth invalidates cached usage (2.079834ms)
✔ duplicate events do not accumulate usage; compaction marks old values (2.143291ms)
✔ large image-like records are skipped with bounded buffers; following usage is read (6.848ms)
✔ large histories expose catch-up state and resume without rescanning (30.502625ms)
✔ simultaneous polls share a scan and never double count bytes (2.246917ms)
✔ outside file and directory symlinks cannot supply data (3.882917ms)
✔ unknown events and invalid JSON do not alter statistics or write logs (1.758708ms)
✔ missing directories report absence; removed records fail without stale output (1.651667ms)
✔ official stdio client initializes, discovers App metadata and uses opaque references (106.974875ms)
✔ portable manifests validate against downloaded official schemas and match package version (22.977708ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 334.126375
```

## 许可和发布边界

项目源码 MIT 与 Node/依赖的许可分别保留。MIT 不等于官方目录准入。版权署名采用 Context Meter contributors，未虚构已验证的发布者身份。GitHub 上传指南仅提供用户可执行的命令，没有自动创建仓库、提交或推送。
