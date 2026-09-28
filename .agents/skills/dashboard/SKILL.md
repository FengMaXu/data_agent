---
name: dashboard
description: 生成商用级别的交互式 HTML BI 看板
allowed-tools:
  - query_database
  - write_file
  - generate_dashboard
  - search_knowledge
  - read_knowledge
---

# 商用级 HTML BI 看板生成

## 目标

生成可以直接交付给业务人员、数据分析师或管理层使用的独立 HTML 看板：清晰的数据叙事、统一的视觉编码、稳定的布局。HTML 看板本身就是交付物，下载链接只作为文件获取入口；不要把复杂看板拆成 widget 卡片。

本 Skill 只描述 `generate_dashboard` 当前实际支持的能力。不要向用户承诺下文“暂不支持”中列出的功能。

## 当前能力

| 支持 | 暂不支持（不要写进 spec，也不要向用户承诺） |
| --- | --- |
| v3 静态看板：KPI 卡片、折线、柱形、饼图（环形）、表格 | 页面筛选器、点击下钻、交叉联动 |
| 通用笛卡尔图：柱、线、散点混合，双 y 轴，按维度分系列 | 横向条形图（x 轴固定为类目轴） |
| 图表 tooltip、图例、随窗口缩放 | 自定义布局宽度与高度、导出按钮 |
| 按完整 spec 重新生成并覆盖已有看板 | 读取已有看板后局部修改 |
| — | v4 语义实时看板（见下文，当前不能用于交付） |

## 调用方式

`generate_dashboard` 的四个参数都要写明：

```text
generate_dashboard(operation, mode, version, spec, editPath?)
```

- `operation`：`"validate"` 只校验，成功返回 `dashboard spec valid`；`"create"` 生成新看板；`"edit"` 用完整 spec 重新生成并覆盖 `editPath` 指向的文件。
- `mode` 与 `version`：交付看板时固定为 `mode: "static"`、`version: "v3"`。
- 校验失败时返回 `DASHBOARD_SPEC_INVALID: <错误列表>`，按错误修改 spec 后重试。
- `create` 成功返回 `[DASHBOARD_CREATED] dashboards/<filename>.html`；`filename` 省略时以时间戳命名。
- `edit` 不会读取旧看板，必须提供修改后的**完整** spec 和原文件路径 `editPath`。

推荐顺序：先 `validate`，通过后 `create`。

## 推荐流程

1. **理解需求**：明确核心问题（趋势、结构、对比、排名、明细）、受众、时间范围与粒度。用户没有说明但数据可以推断时，先做合理假设，并在最终答复中写明。
2. **准备数据**：用 `query_database` 查询，再用 `write_file` 写入 `data/*.csv`。每个 CSV 保持窄而清晰：维度列、指标列、时间列。**在查询中把数据聚合到图表需要的粒度**，每个 x 值（或每个 x 值加系列值）一行。数值列只放数字，单位写进列名或轴名。
3. **设计 spec**：见下文结构与视图写法。
4. **校验并生成**：`validate` → `create`。
5. **最终答复**：见文末格式。

## v3 Spec 结构

```json dashboard-v3-spec
{
  "version": "3",
  "title": "2025年12月三大行业经营分析",
  "filename": "industry_dashboard",
  "datasets": [
    { "id": "industry_summary", "source": { "type": "csv", "path": "data/industry_summary.csv" } }
  ],
  "views": [
    {
      "id": "kpi_summary",
      "type": "metric_cards",
      "title": "核心指标",
      "cards": [
        { "label": "累计销售额", "value": "7,276.57 亿元", "change": "-23.34%" },
        { "label": "零售业销售额", "value": "499.88 亿元", "change": "+16.46%" }
      ]
    },
    {
      "id": "industry_sales",
      "type": "chart",
      "title": "三大行业累计销售额",
      "dataset": "industry_summary",
      "x": { "field": "行业大类" },
      "series": [{ "name": "累计销售额", "field": "累计销售额_亿元", "mark": "bar" }]
    }
  ]
}
```

- `title`、至少一个 `datasets` 项、至少一个 `views` 项为必填。
- dataset 用 `source.path` 引用工作区中的 CSV（首行为表头；能解析为有限数字的单元格按数字读取）。少量数据也可以直接写 `"rows": [{...}]`，但不要把大表塞进工具参数。
- dataset 上的 `schema`，以及视图上的 `insight`、`recipe`、`reading_mode`、`source`、`layout` 等字段不会被使用，不必填写。

## 视图写法

视图按 `views` 中的顺序排列，桌面端每行两个，表格独占一行，图表高度固定。把 KPI 放在最前，核心图其次，支撑图和明细表放在后面。

### KPI 卡片

`metric_cards` 直接展示写好的文本，数值由你从查询结果中取得并格式化：

```json dashboard-v3-view
{
  "id": "kpi_summary",
  "type": "metric_cards",
  "title": "核心指标",
  "cards": [
    { "label": "累计销售额", "value": "7,276.57 亿元", "change": "-23.34%" }
  ]
}
```

`kpi` 对一个字段的所有行做聚合（`aggregate` 可选 `sum`、`avg`、`count`、`min`、`max`，默认 `sum`），显示未格式化的数值。比率类指标不要用 `kpi` 聚合，改用 `metric_cards` 填写查询算好的值。

```json dashboard-v3-view
{ "id": "total_sales", "type": "kpi", "title": "累计销售额（亿元）", "dataset": "industry_summary", "field": "累计销售额_亿元" }
```

### 通用笛卡尔图

柱形图、折线图、散点图、柱线组合图、双轴图都使用 `type: "chart"`：

```json dashboard-v3-view
{
  "id": "industry_sales_growth",
  "type": "chart",
  "title": "三大行业累计销售额与同比增速",
  "subtitle": "销售额为柱形，增速为折线",
  "dataset": "industry_summary",
  "x": { "field": "行业大类" },
  "axes": [
    { "id": "sales_axis", "orient": "y", "position": "left", "name": "销售额", "unit": "亿元" },
    { "id": "growth_axis", "orient": "y", "position": "right", "name": "同比增速", "unit": "%" }
  ],
  "series": [
    { "name": "累计销售额", "field": "累计销售额_亿元", "mark": "bar", "axis": "sales_axis" },
    { "name": "同比增速", "field": "同比增速_百分比", "mark": "line", "axis": "growth_axis" }
  ]
}
```

约束：

- 必填 `dataset`、`x.field`，以及至少一个带 `field` 和 `mark` 的系列；`mark` 只能是 `bar`、`line`、`scatter`。
- x 轴固定为类目轴，按数据中出现的顺序排列；散点图的 x 也是类目。
- **同一个 x 值有多行时，各行的值会被相加。** 数据必须事先聚合到 x 粒度（或 x 加系列粒度），比率、均值等指标尤其不能依赖相加。
- 缺失值按 0 绘制；不希望显示为 0 的缺口，要在查询中处理。
- `axis` 必须与 `axes` 中某个 `id` 完全一致，否则系列会静默落到第一个轴上。只有一个量纲时可以省略 `axes`。
- 同一张图不超过 2 个量纲；超过时拆成多张图。

### 按维度分系列

长表中一个指标按某个维度拆成多条线或多组柱时，用 `series_by`，此时 `series` 只能有一个：

```json dashboard-v3-view
{
  "id": "industry_trend",
  "type": "chart",
  "title": "三大行业同比增速走势",
  "dataset": "trend_data",
  "x": { "field": "month" },
  "series_by": {
    "field": "industry",
    "order": ["批发业", "零售业", "餐饮业"],
    "colors": { "批发业": "#4F6980", "零售业": "#F47942", "餐饮业": "#638B66" }
  },
  "series": [{ "name": "同比增速", "field": "growth_pct", "mark": "line" }]
}
```

也可以用 `series[].where` 为每个系列显式筛选行。同一个 `field` 在多个系列中重复出现时，必须使用 `series_by`，或者每个系列都带 `where`，否则校验不通过：

```json dashboard-v3-view
{
  "id": "industry_trend_explicit",
  "type": "chart",
  "title": "批发业与零售业同比增速",
  "dataset": "trend_data",
  "x": { "field": "month" },
  "series": [
    { "name": "批发业", "field": "growth_pct", "mark": "line", "where": { "industry": "批发业" } },
    { "name": "零售业", "field": "growth_pct", "mark": "line", "where": { "industry": "零售业" } }
  ]
}
```

### 简写折线图与柱形图

`type: "line"` 或 `"bar"` 配合 `xField`、`yField`，按 x 值分组并聚合（`aggregate` 默认 `sum`）。只用于可加指标；需要多系列、双轴或比率指标时改用 `chart`。

```json dashboard-v3-view
{ "id": "monthly_sales", "type": "line", "title": "月度销售额", "dataset": "trend_data", "xField": "month", "yField": "sales" }
```

### 饼图（环形）

`pie` 需要 `nameField` 与 `valueField`，每一行是一个扇区，不做聚合。只用于可加指标的完整构成，类别不超过 5 个，值不能为负。

```json dashboard-v3-view
{ "id": "industry_share", "type": "pie", "title": "三大行业销售额构成", "dataset": "industry_summary", "nameField": "行业大类", "valueField": "累计销售额_亿元" }
```

### 表格

`columns` 可选，省略时显示全部列；表格显示 dataset 的全部行，独占一行。

```json dashboard-v3-view
{
  "id": "top_items",
  "type": "table",
  "title": "重点行业明细",
  "dataset": "industry_detail",
  "columns": [
    { "field": "行业中类", "label": "行业中类" },
    { "field": "累计销售额_亿元", "label": "销售额(亿元)" },
    { "field": "同比增速_百分比", "label": "同比增速(%)" }
  ]
}
```

## v4 语义看板：当前不能用于交付

`mode: "semantic"`、`version: "v4"` 目前只生成一个桥接壳页面：不渲染任何视图，生成时不执行查询，应用内的实时刷新也没有接通。用户要求“筛选后重新查询”“语义查询联动”“应用内实时刷新”时，说明这项能力暂不可用，改用 v3 按用户关心的切片分别生成图表。

它接受的结构如下，仅供了解，不要用来交付：

```json dashboard-v4-spec
{
  "title": "行业经营分析",
  "parameters": { "month": { "type": "string" } },
  "views": [
    { "id": "trend_chart", "type": "line", "title": "销售额走势", "query": "按月份统计批发零售业累计销售额" }
  ]
}
```

## 设计方法与硬约束

1. 先判数据形状，再选视图。至少比较两个能承载同一数据的候选，按业务问题、标签容量和阅读速度选择，不按“哪个图最炫”选择。
2. 每个视图只承担一个独立结论。`title` 表达对象或结论，写清“对象 + 指标 + 时间/口径”，不写“柱状图”等图型名；单位、口径、筛选范围写进 `subtitle`。
3. 图表不诚实时拒绝：面积不直接用半径编码；占比类别超过 5 个时改用排序后的柱形图或表格；超过 6 个系列时拆图。
4. 一张看板回答一个业务问题；简约胜于炫技，优先 KPI、折线、柱形、环形、表格。

| 数据形状 | 视图 |
| --- | --- |
| 3–6 个头部指标 | `metric_cards` |
| 单指标有序时间序列 | `chart` + `line`，或简写 `line` |
| 一个指标按一个维度分组的趋势 | `chart` + `series_by` |
| 已排序的类目比较、少类目比较 | `chart` + `bar`（查询中排好序） |
| 2–3 个可比系列 | `chart` + 多个 `bar` 系列 |
| 绝对量 + 比率 | `chart` 双轴：`bar` + `line` |
| 围绕零点的正负值 | `chart` + `bar` |
| 不超过 5 类的完整构成 | `pie` |
| 类目与数值的关系、逐项分布 | `chart` + `scatter` |
| 可核对的明细、带多个指标的排名 | `table` |

## 配色

参考项目根目录 `设计原则及配色方案.md`。工具默认按系列顺序使用本项目八色商用色板：

`#4F6980` 深蓝灰、`#F47942` 橙红、`#638B66` 深灰绿、`#FBB04E` 橘黄、`#B66353` 铁锈红、`#849DB1` 浅蓝灰、`#B9AA97` 浅灰褐、`#7E756D` 深灰褐。

只有 `series_by.colors` 可以按系列值指定颜色。同一个维度值在不同图中要保持同一颜色：在每张图的 `series_by.colors` 中写相同的映射，或让系列顺序保持一致。语义映射：达标/盈利用 `#638B66`，未达标/亏损用 `#B66353` 或 `#F47942`，中性基准用 `#7E756D`。

## 验收

生成前：

- CSV 已写入工作区，dataset 的 `source.path` 与文件路径一致。
- 每个 `view.id` 唯一，`dataset` 引用存在。
- 每个系列的 `field` 在对应 CSV 中存在；每个 `axis` 能在 `axes` 中找到。
- 图表数据已聚合到 x 粒度，比率类指标没有依赖工具求和。
- `validate` 返回 `dashboard spec valid`。

生成后：

- `create` 返回了 HTML 路径。
- 标题、单位、图例、颜色一致。

## 错误处理

- `DASHBOARD_SPEC_INVALID`：按错误列表修改 spec 或 CSV，不要绕过校验。
- `DASHBOARD_MODE_VERSION_MISMATCH`：`mode` 与 `version` 只能是 `static`+`v3` 或 `semantic`+`v4`。
- 用户要求筛选、下钻、实时刷新等暂不支持的能力时，明确说明限制，给出可落地的替代方案（例如按切片拆成多张图、附上明细表），不要伪造交互。

## 最终答复格式

1. 看板 HTML 链接。
2. 数据来源和口径摘要，包括所做的假设。
3. 核心发现 2 到 4 条。
4. 已执行的校验。
