# 操作流程与数据契约

下文 `<skill>` 指安装后此 Skill 的实际目录，不依赖开发者本机路径。需要 Node.js 20+；运行时除 Node 内置模块外无依赖。

## 标准源到位

```text
node <skill>/scripts/introbook.mjs inspect --input <source>/index.html --root <source>
node <skill>/scripts/introbook.mjs register --input <source>/index.html --root <source> --brand mingdao --version 2026-10-19 --locale zh --policy policy.json
```

Nocoly 使用 `--brand nocoly`。`--locale` 是源文件无语言标记时的默认值；双语源用 data-locale-deck 分组。登记默认放在 skill/assets/templates/<brand>/<version>；可用 `--templates` 指定独立标准库，后续 status/prepare 也传同一路径。不可覆盖已有版本。

### 本次官方网页快照适配

对已审阅的 2026-10-19 两站快照，用下列命令创建全新适配目录（原文件与依赖不改）：

```text
node <skill>/scripts/introbook.mjs adapt-web --input <archive>/index.html --root <archive> --brand mingdao --output <new-adapted-directory>
```

Nocoly 使用独立归档和 `--brand nocoly`。工具核验源 HTML 与全部依赖指纹，按已审阅的品牌/语言槽位生成 index.html、policy.json、adaptation.json，并保留源交互的排版与模块切换。未知版本拒绝套用此适配器，需先重新审阅。

完成逐页视觉与案例增删的浏览器验证后，使用适配目录登记：

```text
node <skill>/scripts/introbook.mjs register --input <adapted>/index.html --root <adapted> --brand mingdao --version 2026-10-19-adapted-20261023 --policy <adapted>/policy.json --provenance <adapted>/adaptation.json
```

默认库会供本机安装入口使用；无模板分发包仍需接收源资料，包含模板的包可直接使用内置品牌基准。模板日期是源快照日期，不表示线上内容已更新到安装当天。

## 一次生成

request.json：

```json
{"customer":"某制造企业","industry":"制造业","scenarios":["质量追溯","设备管理"],"requirements":"希望减少跨车间重复录入","brand":"mingdao","locale":"zh"}
```

brand 省略为 mingdao；locale 省略为 zh，可选 en/bilingual。客户名称可省略。不把缺少事实的猜测写成客户现状。

```text
node <skill>/scripts/introbook.mjs prepare --request request.json --workdir <new-directory>
node <skill>/scripts/introbook.mjs search-plan --request request.json
```

prepare 默认选此品牌最近登记版本；可指定 `--version` 或 `--template <version-directory>`。返回页面规则，工作目录含 baseline/、run.json、sources.json、changes.json、materials/。不要编辑 baseline/ 或 run.json。

执行实际 MCP 检索和原记录核验，然后填入 sources.json（normalizeSource 的输出组成数组）、source-notes.md 以及 changes.json。客户图片放在本次 materials/ 内；只有经过公开性核验的图片可以采用，不能把原始演讲附件中的内部截图直接拿来。

changes.json：

```json
{
  "pages":[{"pageId":"p-zh-2","values":{"s-2":{"text":"用客户熟悉的业务语言解释平台价值"}},"sourceIds":[]}],
  "remove":[],
  "add":[],
  "gaps":[]
}
```

文字槽位的 value 只能为 text；图片为 `{"image":"logo.png","alt":"已核验客户 Logo"}`，路径相对于 materials/。脚本转换成内嵌资源保存于内部 applied.json。修改普通文字仍需事实核对；sourceIds 可关联所用来源。所有案例/方案修改必须有 sourceIds，并覆盖该页所有 editable 槽位。

新增案例页：add 中使用 `{"templatePageId":"p-zh-14","newPageId":"case-new-overview","afterPageId":"p-zh-13","values":{...},"sourceIds":["cases:<rowId>"]}`；后续详情页放在刚新增的概览页之后。只能克隆 replaceable 模板；所有客户特定内容都要替换。pure decorative 图片可在 policy 的 decorative 白名单下用 `{"preserve":true}`。remove 只接受 replaceable 页 ID。不要删锁定页。双语新增/删除须保持两语言页数、对应案例和事实一致；脚本检查页数，语义对齐仍需 AI 复核。

伙伴公司归属是额外信息，不能占用流程图小标题。对已审阅的第 17 页流程型版式，可在 pages/add 的编辑项中设置 `"partnerCompany":"已核验的伙伴公司全称"`：脚本在主标题下新增独立副标题，保留所有原槽位及流程。公司名称须与所引用 solutions 来源的 partnerCompany 完全一致，且在公开依据正文中出现。该字段仅适用于可替换页与受支持的流程版式，不接受任意 HTML/CSS；未知版式需先整理。纯排版修订可在独立工作目录中复制原 run/baseline/sources，保留真实生成与核验时间，另记 revision.json；不能把复制时间伪装为新的来源回读时间。

```text
node <skill>/scripts/introbook.mjs apply --workdir <directory>
node <skill>/scripts/introbook.mjs validate --workdir <directory>
```

apply 会生成工作版 index.html 与 applied.json；validate 将模板、策略指纹与整个结果重建比较。普通产品文案槽位不允许引入新的阿拉伯数字，避免添加未经核定的产品统计；案例中的数字必须出现在所引用原记录的公开正文中。数字匹配不等于语义正确，仍需核对数字归属、条件及上下文。不要手改输出；发现排版问题先优化允许修改的表达，仍无法容纳就减少案例信息或更换合适模板。

## 真实检查和交付

实际检查离线、桌面、手机、目录/翻页/语言交互、事实、素材来源和锁定页。记录 review.json：

```json
{"htmlSha256":"validate 返回的当前指纹","offline":true,"desktop":true,"mobile":true,"navigation":true,"content":true,"reviewer":"实际执行检查的 Agent 或人员","reviewedAt":"实际检查时间的 ISO 字符串"}
```

这些布尔值是检查证据的摘要，不能用填 true 代替实际检查；截图、控制台、网络和内容核对证据留在内部工作目录。正文变化后须重检当前指纹。无法验证时在对话中标明待复核，不能调用正式 deliver。

```text
node <skill>/scripts/introbook.mjs deliver --workdir <directory> --review <directory>/review.json --output <delivery-name>.html
```

交付只复制一个 HTML，拒绝覆盖已有文件，不会把来源、原始文件、策略或工作记录塞进成品。保留工作目录用于追溯。

## 英文版与跨语言复用

同一客户需求切换英文时，沿用品牌、匿名要求和业务范围，使用英文标准页。英文案例版式按英文 inventory/policy 填写，不能直接将中文槽位号换页 ID；例如当前第 17 页的流程小标题是中文 s-32、英文 s-66，英文正文包含独立分行槽位。所有旧客户内容仍须成套替换，伙伴公司作为额外页头行。译写的公司名称须保留公开中文原名及明确的内部翻译字段，不伪称官方英文注册名。
