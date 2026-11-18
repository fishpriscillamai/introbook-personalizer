# HAP 13 当前标准与新增页契约

当前标准为用户 2026-11-16 提供的 `HAP13-IntroBook-中英文版-20261116.html`。标准源 SHA-256：`450622ca53b227e48f12aa528afe69f03989d7dc81424ea1057909c32c5f7225`。未知源指纹需要重新审阅适配，不能改指纹强行套用。

## 登记与选择

```text
node <skill>/scripts/introbook.mjs register-hap13 --input <最新标准.html>
node <skill>/scripts/introbook.mjs status
node <skill>/scripts/introbook.mjs prepare --request request.json --workdir <new-directory>
```

当前源的默认版本 `2026-11-18-hap13`；可选 `--templates` 指定外部标准库，但 prepare/status 必须传同一路径。版本不可覆盖。默认 Mingdao 必须选 manifest.engine=hap13 的当前源；历史工作副本可继续按其 baseline 重建。Nocoly 使用独立标准，不自动转换。

原标准共有 20 页，中英文共用同一组 DOM。注册只增补稳定页面身份，适配新增页目录／英文标题与语言正文，逐页内部 HTML 字节保持一致。模板、页面保护、布局文件分别做指纹检查。所有原页锁定：

| 内容 | 稳定身份 | 处理 |
|---|---|---|
| 制造、流通、医药医疗、教育四个示例 | hap13-standard-09 至 12；原 HTML ID ex-mfg/ex-dist/ex-med/ex-edu | 完整保留文字、图形、交互、素材 |
| 客户案例入口 | hap13-standard-16 | 保留，新页连续接在其后 |
| 伙伴、荣誉、公司、联系 | hap13-standard-17 至 20 | 接在新增页之后，身份不变 |
| 其他标准页 | hap13-standard-01 至 15 | 完整保留，包括两处内嵌双语视频 |

内嵌 MP4 仅在此引擎开启；不允许外链视频、iframe 或网络加载。不改旧版资源检查默认边界。公开网页 href 可点击后联网，离线阅读不自动请求。

## 两种已确认布局

- `case-flow`：来自“乐江机械”的流程型案例。左侧四步业务流程＋系统标签，右侧挑战／实施／价值，下方可借鉴之处。
- `partner-solution`：来自“中小制造业业务全流程管理”的方案页。主标题下独立伙伴公司全称，左侧四步流程／异常／业务对象，右侧适用场景与两项能力，下方需求对接重点。

版式适用于其他已核验客户和伙伴。不得把乐江／思牧永久写成必选案例，也不把它们当作固定四个功能示例。未经批准的银鹭成果型页不进入布局库。

两种新增页均无最下方小字页脚：不生成“公开客户案例…可借鉴之处为案例归纳…样稿 02 流程型案例”，不生成“公开伙伴方案…交付范围以伙伴确认为准…样稿 03 伙伴方案”，也不换成同义脚注。来源与适配范围保留于 sources.json/source-notes.md。正文的可借鉴之处、需求对接重点、伙伴公司副标题必须保留。

## 修改文件

`changes.pages` 与 `changes.remove` 固定为空。新页只通过 `changes.add` 添加，第一项 afterPageId 为 `hap13-standard-16`，后续为上一项 newPageId。ID 使用 `custom-` 开头的小写英文、数字及短横线。禁止任意 HTML、CSS、footer 字段。

```json
{
  "pages": [],
  "remove": [],
  "add": [
    {
      "newPageId": "custom-case-a",
      "afterPageId": "hap13-standard-16",
      "layout": "case-flow",
      "sourceIds": ["cases:<已回读的rowId>"],
      "content": {"zh": {"字段": "按下表填写完整内容"}}
    },
    {
      "newPageId": "custom-solution-a",
      "afterPageId": "custom-case-a",
      "layout": "partner-solution",
      "sourceIds": ["solutions:<已回读的rowId>"],
      "partnerCompany": "已核验伙伴公司全称",
      "content": {"zh": {"字段": "按下表填写完整内容"}}
    }
  ],
  "gaps": []
}
```

上例为结构示意，`字段` 占位不能直接运行。各语言对象须严格包含以下字段，无多余字段：

| 布局 | 字段 |
|---|---|
| case-flow | category、title、subtitle、flowTitle、systemsLabel、processSummary、takeawayLabel、takeaway；steps 四项 `{title,detail}`；systems 三至五个短字符串；sections 三项 `{label,title,text}` |
| partner-solution | category、title、company、flowTitle、exceptionLabel、exception、objects、audienceLabel、audienceTitle、audience、takeawayLabel、takeaway；steps 四项 `{role,title,detail}`；features 两项 `{title,text}` |

值为纯文字，可用换行表达两行。字段长度限制只是防错上限，不代表所有字体和词语都一定装得下。中文标题尽量一行；步骤标题约 4–7 汉字，细节约 6–10 汉字；右侧正文每组两行以内。英文步骤标题通常 1–3 词，说明尽量一行；右侧两项能力说明各一行，正文尽量两行。优先精简措辞，不通过随意缩字、删栏目或改共享样式解决。

来源须在本次 prepare 后真实回读。case-flow 只能引 cases，partner-solution 只能引 solutions。依照 retrieval.md 核验公开状态和原文；脚本检查身份、状态、时间与数字，但不代替事实和语义核对。伙伴公司必须在对应 solutions 的 partnerCompany 和公开正文中一致，中文 company 必须完全匹配；英文译名须在 add 条目的顶层（与 partnerCompany、content 同级）额外设 `companyNameIsTranslation: true`，不要放进 content.en 或只写在 sources.json 中，内部保存原名与翻译说明，不宣称其为核验过的注册英文名。

## 语言、校验与交付

request.locale=zh 时 content 仅含 zh；en 时仅含 en；bilingual 时必须同时含 zh 和 en，描述相同对象与事实。双语共用一页，例如追加四页后两种语言均为 24 页，不是 48 页。英文标准标题按原页稳定身份映射，新增页使用其英文 title。

仍通过 apply → validate → 实际渲染 → review.json → deliver。确认原 P16、所有新增页及后续标准页的目录/翻页顺序，中英文标准标题不因插页错位；检查四个示例的跳转和相关交互、两处视频离线播放。检查 1920×1080、1280×720、390×844，等动画稳定后截图。每页检查字体、换行、卡片和下方留白，无溢出且无被删除的小字页脚。原 20 页内部指纹必须全部一致。

正式按需求各选 2–3 个公开客户案例和伙伴方案；证据不足时减少并明确缺口。版式回归用各一页不等于一份完整定制销售材料。安装包或本地源码更新不代表已发布，须分别报告实际安装、公共版本与宿主验收状态。

## 2026-11-16 标准资料替换

本次只替换标准资料及其版本适配。20 页顺序、四个固定示例、P16 插入位置不变；新版 P17–19 和英文文案沿用新源。案例与伙伴方案布局文件保持 2026-11-13 已确认版本，SHA-256 `c2059389a39b7be58433552265efcfa521bf044e1fd7d0b4e9dd4581f1dff4d0`，不恢复已删除页脚。旧源及历史工作副本仍可读取和校验，不被覆盖。

## 2026-11-18 标准文件校正

用户指定本项目根目录 `HAP13-IntroBook-中英文版-20261116.html` 为标准，文件日期仍为 2026-11-16；登记版本为 `2026-11-18-hap13`。已核对 20 页结构、文字和资源差异：目录颜色及 P9–12 四张截图和 object-fit:cover 更新，其他 16 页内部字节未变。完整沿用新源图片、裁切、点击查看原图的逻辑。原版本保留，以便历史工作副本重建。当前更新通过静态结构及完整性校验；本地浏览器预览受策略限制，尚未视觉验收，不得据此宣称视觉通过。
