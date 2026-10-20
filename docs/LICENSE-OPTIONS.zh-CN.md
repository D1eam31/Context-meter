# 开源许可证选择说明

许可证是权利人预先写好的使用授权，不是开发者认证，也不是应用商店准入证明。无需购买标准许可证。你已于 2026-10-20 选择 MIT；当前交付已补齐 LICENSE、元数据及各平台包中的许可文本。

## 常见选择

| 许可证 | 商用与闭源 | 修改和分发时的主要义务 | 适合的分享目标 |
| --- | --- | --- | --- |
| MIT | 允许商用、闭源分发 | 保留版权和许可证声明 | 希望别人尽量自由地使用和改进 |
| Apache-2.0 | 允许商用、闭源分发 | 保留相关声明，标注修改；有适用 NOTICE 时按规定保留；另有明确的贡献者专利授权与终止条款 | 接受宽松使用，希望专利规则更明确 |
| MPL-2.0 | 允许商用，可与闭源文件组成较大项目 | 分发时，对 MPL 覆盖文件及其修改提供源码并延续其许可证；独立新增文件通常可采用其他条款 | 希望插件现有文件的修改继续共享，同时方便集成 |
| GPL-3.0 | 允许商用、收费分发 | 分发受 GPL 覆盖的衍生作品时，按 GPL 提供对应源码并遵守其余条件 | 希望衍生版本继续保持自由软件授权 |
| AGPL-3.0 | 允许商用、收费 | 在 GPL 类要求外，修改后的程序若支持用户通过网络交互，还须向这些用户提供对应源码获取机会 | 也希望网络服务形式的修改回馈源码 |

这里的“提供源码”不是一律要求上传 GitHub。GPL 的义务主要在分发时面向接收者；纯粹自己修改和使用，通常不需要公开给所有人。AGPL 另外覆盖特定的远程网络交互情形。组合项目的适用范围取决于代码组织、修改及分发方式，不能仅凭同一电脑上运行就判断。

这些许可证都允许商用。它们不能作为“禁止别人收费”的规则。如果你想禁止商业使用，应另选限制性授权；不能再直接称为符合通常开放源代码定义的开源软件。

## 对这个插件的选择建议

如果你的目标是免费分享，允许任何人使用、改进和商用，MIT 最简明。Apache-2.0 同样宽松，但专利和变更声明规则更明确。如果你希望别人分发修改版时继续分享插件现有文件的源码，可以考虑 MPL-2.0。若希望受许可证覆盖的衍生版本整体延续同一开源授权，可以进一步比较 GPL-3.0；本插件主要本地运行，AGPL 的网络服务条款并非首要需求。

选定后通常需要：根目录增加 LICENSE，填写适用的版权声明；同步 package.json 与插件元数据中的许可证标识，并保留 Node、SDK 等第三方原有许可。插件自己的许可证不能取消这些第三方义务。正式对外发布时应确认你有权授权相应代码和素材。

当前源码包已包含根 LICENSE，采用 MIT，署名为 Context Meter contributors。Node 与已打包依赖的许可已经分别放在 runtime/NODE-LICENSE 和 dist/THIRD-PARTY-NOTICES.txt。

## 依据

- [GitHub：为仓库添加许可证](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- [MIT](https://choosealicense.com/licenses/mit/)
- [Apache-2.0](https://choosealicense.com/licenses/apache-2.0/)
- [MPL-2.0](https://choosealicense.com/licenses/mpl-2.0/)
- [GPL-3.0](https://choosealicense.com/licenses/gpl-3.0/)
- [AGPL-3.0](https://choosealicense.com/licenses/agpl-3.0/)

以上是条款概览，用于比较分享方式；具体权利义务以你最终选定的完整许可证文本为准。
