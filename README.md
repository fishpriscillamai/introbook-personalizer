# IntroBook Personalizer

根据客户行业、业务场景和需求，生成明道云 HAP / Nocoly 个性化离线 HTML 产品手册。支持中文、英文与双语；交付一个可断网打开的 HTML。

当前稳定版：**v1.0.0**。中英文真实需求样本已完成当前 Codex 桌面环境的端到端生成、内容与视觉检查，并经用户确认。

## 安装

推荐从 [Releases](https://github.com/fishpriscillamai/introbook-personalizer/releases/latest) 下载对应安装包：

| 文件 | 用途 |
|---|---|
| `introbook-personalizer-codex.zip` | Codex / 当前合并版 Codex、ChatGPT 桌面工作环境 |
| `introbook-personalizer-workbuddy.zip` | Work Buddy 技能导入包，仍需实际宿主验证 |
| `SHA256SUMS` | 安装包校验值 |

正式安装包包含两品牌各自的最新已登记模板，每品牌中英文各 27 页。标准源快照日期为 **2026-10-19**，策略日期为 **2026-10-23**，不代表线上资料每天自动更新。包内不含客户定制成品、案例原始记录或凭据。

Codex：解压后保留目录，运行：

```sh
node introbook-personalizer/scripts/install.mjs
node introbook-personalizer/scripts/introbook.mjs status
```

安装器建立目录链接，不覆盖已有的不同同名 Skill。Windows 使用目录 junction；Windows 实机安装、Work Buddy 实际导入与生成尚未完成，不宣称已验收。

Work Buddy：将对应 ZIP 导入其技能管理入口，再连接具有读取权限的 HAP Personal MCP。两个包使用同一份源码。

从 GitHub 克隆的源码仓库不带大型品牌模板文件；可使用 Release 安装包，或按 [操作流程](skills/introbook-personalizer/references/workflow.md) 接收、审阅并登记标准源。不要把测试样本当作标准手册。

## 使用

在支持 Skill 的宿主中描述需求，例如：

> 用 introbook-personalizer 为一家匿名食品饮料制造和零售企业制作英文 IntroBook，重点讲灵活排产、库存与运输协同，希望减少不必要的生产和库存占用。

默认明道云中文；可指定 Nocoly、英文或双语。保留品牌独立口径，不以换 Logo 的方式转换品牌。

生成流程：需求理解 → 标准副本 → 案例与方案检索 → 原记录核验 → 受控改写 → 静态校验 → 实际离线视觉检查 → 单文件交付。CLI 负责确定性文件处理；宿主 Agent 负责实际 MCP 调用、来源语义和视觉核验，不存在隐藏的联网生成服务。

## 固定规则

- 技术架构和“价值八方式”整页沿用标准素材；产品参数、认证、安全、部署、统计和公司事实不因客户改写。
- 客户案例和伙伴解决方案分别选 2–3 个；缺少严格同行业案例时可采用同场景跨行业证据，明确借鉴范围。
- 优先呈现可核验的量化成果；不把实施规模或方案目标写成既有成果，也不把他人收益承诺给新客户。
- 伙伴方案标题为“伙伴解决方案：方案名称” / “Partner Solution: Solution Name”；公司名称是主标题下**额外新增**的副标题，不替换流程图小标题。案例/方案可局部调整布局。
- 中文和英文使用各自标准页、槽位和分行；内部保留公司译名与原名的对应，不把译写当作已核验英文注册名。
- 正式交付必须绑定当前 HTML 指纹的真实检查。仅修改 review.json 中的布尔值不构成验收。

## 知识库与权限

内置 [知识库配置](skills/introbook-personalizer/references/knowledge-sources.json) 是用于定位指定明道云案例与方案库的非敏感元数据，**不包含访问令牌，也不授予访问权限**。使用者需自行连接 HAP Personal MCP，并取得两库的读取权限。案例只采用“发布中”，方案只采用“公开上架”，检索后回读当前原记录。

如用于其他知识库，按相同配置契约设置应用、知识库、工作表、状态与公开字段，并核对该库的发布规则。不要填写密钥到配置文件或提交到仓库。

## 开发与验证

运行时需要 Node.js 20+；核心工具仅用内置模块。Python 工具仅用标准库。

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p test_web_fetch.py
python3 scripts/build_packages.py --output dist
```

最后一条默认生成不含模板的源码包；在本地已登记模板后，可使用 `--include-templates --latest-templates` 仅带每品牌最新版本。

浏览器审查辅助脚本需要外部提供 Playwright 与 Chrome 路径，通过 `INTROBOOK_PLAYWRIGHT_DIR` 和 `INTROBOOK_BROWSER_EXECUTABLE` 指定。自动测试不能替代真实业务、素材与逐页视觉核验。源码仓库未分发官方原网页归档，因此两个依赖原归档的适配器测试会明确跳过。

## 版本与素材

- [变更记录](CHANGELOG.md)
- [Skill 入口](skills/introbook-personalizer/SKILL.md)
- [素材与第三方说明](THIRD_PARTY_NOTICES.md)

代码公开发布不改变第三方品牌、手册、字体、图片及案例素材的权利归属。本次未为第三方素材授予额外的再许可。
