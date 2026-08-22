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

## General multi-series contract

For long-form/tidy data, do not fake multiple lines by repeating the same
`series.field` three times. Use one of these explicit grouping contracts:

1. Use `series_by` when one measure should become one series per dimension
   value, for example three industries over time:

```json
{
  "type": "chart",
  "coordinate": "cartesian",
  "dataset": "trend_data",
  "x": { "field": "month", "type": "category" },
  "series_by": {
    "field": "industry",
    "order": ["Wholesale", "Retail", "Catering"],
    "colors": {
      "Wholesale": "#4F6980",
      "Retail": "#F47942",
      "Catering": "#638B66"
    }
  },
  "axes": [{ "id": "growth_axis", "orient": "y", "name": "YoY growth", "unit": "%" }],
  "series": [
    { "name": "YoY growth", "field": "growth_pct", "mark": "line", "axis": "growth_axis" }
  ]
}
```

2. Use `series[].where` when each series needs an explicit filter:

```json
{
  "series": [
    { "name": "Wholesale", "field": "growth_pct", "mark": "line", "axis": "growth_axis", "where": { "industry": "Wholesale" } },
    { "name": "Retail", "field": "growth_pct", "mark": "line", "axis": "growth_axis", "where": { "industry": "Retail" } }
  ]
}
```

Validation rejects repeated `series.field` values unless the view uses
`series_by` or every repeated series has a `where` filter. This prevents a
single long-form measure from being silently rendered as duplicated or zig-zag
lines.

## Filter defaults

Do not set a filter default to display labels such as `"全部"` or `"All"`.
The all option is represented by an empty value. If no filtering should be
applied on first render, omit `default` or set `"default": ""`.

# 商用级 HTML BI 看板生成

## 目标

生成可以直接交付给业务人员、数据分析师或管理层使用的独立 HTML BI 看板。看板必须具备清晰的数据叙事、稳定的布局、统一的视觉编码、必要的交互能力和可维护的结构化 spec。

默认使用 `build_dashboard(spec={...})` 的 v3 spec。不要再把复杂看板拆成 widget 卡片，也不要把“查看”做成下载行为。HTML 看板本身就是交付物，下载链接只作为文件获取入口。

### KTX 实时联动看板使用 V4

当用户要求“筛选后重新查询数据库”“KTX 语义查询联动”或“应用内实时刷新”时，使用 `validate_semantic_dashboard_spec` 和 `build_semantic_dashboard`，不要把语义查询伪装成 V3 CSV dataset。

V4 的唯一核心模型是：

```text
parameters + data + views + interactions + layout
```

- `data` 节点直接声明 KTX source-relative dimensions/measures；不要写 SQL、SQL Template、QueryRegistry 或任意查询回调。
- 选择字段的键是看板输出字段名，例如 `measures: {"sales": "sales_ytd_total"}`；工具会在服务端做 KTX headers 映射。
- 参数只能是首期 `select`，options 必须引用一个不带 `$param` 的 data 节点；`null` 表示不筛选。
- `where` 首期只使用 `eq` 和 `{"$param": "parameter_name"}`。
- 点击筛选/预定义下钻统一使用 `action.type="set_parameter"`，不经过 Agent。
- 先调用 `validate_semantic_dashboard_spec`，再调用 `build_semantic_dashboard`；构建时会执行真实 KTX 默认查询并生成快照，应用内预览才支持实时刷新，离线 HTML 仍是快照。

V4 示例：

```json
{
  "version": "4",
  "title": "行业经营分析",
  "connection": "default-mysql",
  "parameters": {
    "month": {
      "type": "select",
      "default": null,
      "options": {"data": "month_options", "field": "month"}
    }
  },
  "data": {
    "month_options": {
      "source": "business_industry_sales_trend",
      "dimensions": {"month": {"field": "snapshot_month", "granularity": "month"}},
      "measures": {"sales": "sales_ytd_total"},
      "limit": 200
    },
    "trend": {
      "source": "business_industry_sales_trend",
      "dimensions": {"month": {"field": "snapshot_month", "granularity": "month"}},
      "measures": {"sales": "sales_ytd_total"},
      "where": [{"field": "snapshot_month", "operator": "eq", "value": {"$param": "month"}}]
    }
  },
  "views": [{
    "id": "trend_chart",
    "type": "chart",
    "data": "trend",
    "x": {"field": "month", "type": "category"},
    "axes": [{"id": "sales_axis", "orient": "y", "name": "销售额"}],
    "series": [{"field": "sales", "mark": "bar", "axis": "sales_axis"}]
  }],
  "interactions": [],
  "layout": {}
}
```

V3 仍用于静态 CSV、本地筛选和可离线独立交付；不要在同一份 spec 中混用 V3 `datasets/filters` 与 V4 `data/parameters`。

## 工作原则

1. 数据先落盘，再生成看板。
   SQL 或分析结果必须先写入 CSV 文件，再由 dashboard 工具读取 CSV。不要把大表数据塞进工具参数。

2. 用结构化 spec 表达意图。
   复杂图表、双轴和柱线组合写入 `views`，页面筛选写入 `filters`，点击下钻写入 `interactions`。不要依赖 raw `echarts_option`，也不要声明运行时尚未实现的交互。

3. 一张看板回答一个业务问题。
   先明确受众、业务问题、关键指标、可用维度、默认时间范围。若用户没有明确，但数据中可以推断，先做合理假设并在最终说明中写明。

4. 简约胜于炫技。
   优先使用 KPI 卡片、折线图、柱形图、条形图、环形图、表格。除非用户明确要求，不使用罕见图表类型。

5. 视觉编码必须一致。
   同一个维度或业务对象在所有图表中使用相同颜色。不要在同一看板里让“零售业”一会儿是蓝色、一会儿是橙色。

6. 交互要显式可理解。
   优先提供明确筛选器、图例、tooltip、面包屑和下钻返回路径。不要只依赖隐蔽的交叉过滤。

## 设计方法与硬约束

借鉴编辑型图表的选型方法，但不复制外部模板、单色体系或代码。所有数据编码颜色继续使用本项目配色。

1. 先判数据形状，再选 recipe。至少比较两个可承载同一数据本体的候选，按业务问题、标签容量和阅读速度选择，不按“哪个图最炫”选择。
2. 每个 view 只承担一个独立结论。新建 view 必须填写 `insight`、`recipe`、`reading_mode` 和 `source`；`title` 应表达对象或结论，不写“柱状图”等图型名。
3. `reading_mode` 只能是 `glance`、`analysis`、`detail`。管理层首屏优先 `glance`，诊断图优先 `analysis`，明细核对优先 `detail`。
4. recipe 是选型记录，不拥有配色。禁止为了模仿外部风格替换本项目八色商用色板。
5. 图表不诚实时拒绝：柱形图不断轴；面积不得直接用半径编码；占比类别超过 5 个时改用排序条形图或表格；超过 6 个系列时拆图。

### 商业图表 Recipe

| recipe | 数据形状 | 推荐视图 | 阅读模式 |
|---|---|---|---|
| `kpi-summary` | 3–6 个头部指标 | KPI cards | glance |
| `trend-line` | 单指标有序时间序列 | line | analysis |
| `multi-series-trend` | 一个指标按一个维度分组的趋势 | line + `series_by` | analysis |
| `ranked-bars` | 已排序类目比较 | bar | glance |
| `category-columns` | 少类目比较 | bar | glance |
| `grouped-comparison` | 2–3 个可比系列 | grouped bar | analysis |
| `volume-and-rate` | 绝对量 + 比率 | 双轴 bar + line | analysis |
| `positive-negative` | 围绕零点的正负值 | bar | glance |
| `composition-donut` | 不超过 5 类的 100% 构成 | pie_chart | glance |
| `relationship-scatter` | 两个数值指标的关系 | scatter | analysis |
| `distribution-scatter` | 逐记录分布 | scatter | detail |
| `detail-table` | 可核对的明细记录 | table | detail |
| `top-n-table` | 带多个指标的排名记录 | table | detail |
| `master-detail` | 总览到明细的点击下钻 | chart/table + drilldown | analysis |
## 推荐流程

1. 理解需求
   - 判断看板体裁：分析型、杂志型、信息图型。
   - 明确核心问题：趋势、结构、对比、贡献、异常、下钻明细。
   - 明确粒度：时间、地区、行业、产品、客户、组织等。

2. 准备数据
   - 用 `execute_sql` 查询数据，或使用已有文件。
   - 用 `write_workspace_file` 写入 `data/*.csv`。
   - 每个 CSV 保持窄而清晰：维度列、指标列、时间列、层级关联列。
   - 数值列使用数字，不要混入单位文本；单位写入 schema 或图表轴。

3. 设计 spec
   - 使用 `version: "3"`。
   - 在 `datasets` 中声明 CSV、字段类型、字段角色和单位。
   - 在 `views` 中声明 KPI、图表、表格，并记录 `insight`、`recipe`、`reading_mode`、`source`。
   - 在 `filters` 中声明下拉筛选；`interactions` 目前只声明点击下钻。

4. 先校验，再生成
   - 对复杂看板先调用 `validate_dashboard_spec(spec=...)`。
   - 校验通过后调用 `build_dashboard(spec=...)`。
   - 需要修改已有看板时，只使用 `edit_dashboard` 做结构化修改。
   - 不使用旧版 `charts` 参数、`add_chart` 或 `remove_chart`。

5. 最终交付
   - 给出 dashboard 工具返回的 HTML 链接。
   - 简要说明数据口径、核心发现、交互方式和验证结果。

## v3 Spec 基本结构

```json
{
  "version": "3",
  "title": "经营分析看板",
  "filename": "business_dashboard",
  "layout": { "sidebar": true },
  "datasets": [],
  "views": [],
  "filters": [],
  "interactions": [],
  "exports": []
}
```

### Filter 写法

当前运行时只接受可真实执行的单选筛选器。`targets` 省略时作用于使用同一 dataset 的所有视图；指定时，目标视图必须使用同一 dataset。全部选项用空值表示，不写入显示标签作为默认值。

```json
{
  "id": "industry_filter",
  "type": "select",
  "label": "行业",
  "dataset": "industry_summary",
  "field": "行业大类",
  "targets": ["industry_sales_growth", "top_items"],
  "default": "",
  "all_label": "全部"
}
```

## Dataset 写法

```json
{
  "id": "industry_summary",
  "source": { "type": "csv", "path": "data/industry_summary.csv" },
  "key": ["行业大类"],
  "schema": [
    { "name": "行业大类", "type": "string", "role": "dimension" },
    { "name": "累计销售额_亿元", "type": "number", "role": "measure", "unit": "亿元" },
    { "name": "同比增速_百分比", "type": "number", "role": "measure", "unit": "%" }
  ]
}
```

字段命名建议：

- 指标名包含口径和单位，例如 `累计销售额_亿元`、`同比增速_百分比`。
- 层级字段保持同名关联，例如父表和子表都保留 `行业大类`。
- 时间字段统一格式，例如 `2025-12` 或 `2025-12-31`。

## View 写法

### KPI 卡片

```json
{
  "id": "kpi_summary",
  "type": "metric_cards",
  "title": "核心指标",
  "cards": [
    { "label": "累计销售额", "value": "7,276.57 亿元", "change": "-23.34%" },
    { "label": "零售业销售额", "value": "499.88 亿元", "change": "+16.46%" }
  ]
}
```

KPI 卡片只放最关键的 3 到 6 个指标。不要把所有明细都塞进 KPI。

### 通用笛卡尔图

柱形图、折线图、散点图、柱线组合图、双轴图都使用同一个通用写法：

```json
{
  "id": "industry_sales_growth",
  "type": "chart",
  "coordinate": "cartesian",
  "title": "2025年12月三大行业累计销售额与同比增速",
  "subtitle": "销售额为柱形，增速为折线",
  "dataset": "industry_summary",
  "layout": { "span": 12, "height": 420 },
  "x": { "field": "行业大类", "type": "category" },
  "axes": [
    { "id": "sales_axis", "orient": "y", "position": "left", "name": "销售额", "unit": "亿元" },
    { "id": "growth_axis", "orient": "y", "position": "right", "name": "同比增速", "unit": "%" }
  ],
  "series": [
    { "id": "sales", "name": "累计销售额", "field": "累计销售额_亿元", "mark": "bar", "axis": "sales_axis" },
    { "id": "growth", "name": "同比增速", "field": "同比增速_百分比", "mark": "line", "axis": "growth_axis" }
  ]
}
```

约束：

- `type` 使用 `chart`。
- `mark` 目前优先使用 `bar`、`line`、`scatter`。
- 双轴图必须明确左右轴和单位。
- 同一张图里不要混合太多量纲；超过 2 个量纲时拆成图表簇。

### 表格

明细表适合承接下钻结果或展示 Top N：

```json
{
  "id": "top_items",
  "type": "table",
  "title": "重点明细",
  "dataset": "industry_detail",
  "columns": [
    { "field": "行业中类", "label": "行业中类" },
    { "field": "累计销售额_亿元", "label": "销售额(亿元)" },
    { "field": "同比增速_百分比", "label": "同比增速(%)" }
  ],
  "layout": { "span": 12, "height": 360 }
}
```

## Interaction 写法

下钻是独立的一等对象，不能藏在单个 chart 里。

```json
{
  "id": "drill_industry_to_medium",
  "source": { "view": "industry_sales_growth", "event": "click" },
  "action": {
    "type": "drilldown",
    "target_dataset": "industry_medium",
    "match": {
      "source_field": "行业大类",
      "target_field": "行业大类"
    },
    "target_view": {
      "type": "chart",
      "coordinate": "cartesian",
      "title": "{{ value }} 行业中类销售额与同比增速",
      "x": { "field": "行业中类", "type": "category" },
      "axes": [
        { "id": "sales_axis", "orient": "y", "position": "left", "name": "销售额", "unit": "亿元" },
        { "id": "growth_axis", "orient": "y", "position": "right", "name": "同比增速", "unit": "%" }
      ],
      "series": [
        { "id": "sales", "name": "累计销售额", "field": "累计销售额_亿元", "mark": "bar", "axis": "sales_axis" },
        { "id": "growth", "name": "同比增速", "field": "同比增速_百分比", "mark": "line", "axis": "growth_axis" }
      ]
    }
  }
}
```

交互设计要求：

- 点击可下钻的图表，标题或最终说明中说明“点击柱/点可下钻”。
- 下钻后的图表使用与父级一致的编码方式。
- 父子图使用相同字段名做关联，避免模糊匹配。

## 商用布局规范

1. 首屏结构
   - 顶部：标题、时间范围、数据口径简述。
   - 上方：KPI 卡片。
   - 中部：1 到 2 个核心图。
   - 下方：支撑图、结构图、明细表。

2. 图表簇
   - 将逻辑相关的图放在同一区域。
   - 常见组合是 2 到 4 个区块。
   - 趋势图和结构图不要无理由混排。

3. 尺寸
   - 核心图使用 `span: 12`，高度 380 到 480。
   - 并列图使用 `span: 6`，高度 320 到 400。
   - 明细表使用 `span: 12`，高度 320 到 420。

4. 文本
   - 标题说清“对象 + 指标 + 时间/口径”。
   - 副标题补充单位、口径、筛选范围。
   - 不要在页面里堆砌使用说明；交互说明应短而直接。

## 配色规范

参考项目根目录 `设计原则及配色方案.md`。

默认商用色板：

- 深蓝灰 `#4F6980`
- 橙红 `#F47942`
- 深灰绿 `#638B66`
- 橘黄 `#FBB04E`
- 铁锈红 `#B66353`
- 浅蓝灰 `#849DB1`
- 浅灰褐 `#B9AA97`
- 深灰褐 `#7E756D`

使用规则：

1. 多类别对比：优先 `#4F6980`、`#F47942`、`#638B66`、`#FBB04E`。
2. 重点突出：主角用 `#F47942` 或 `#FBB04E`，背景系列用 `#B9AA97` 或 `#849DB1`。
3. 层级分组：父级用深色，子级用同色浅色，例如 `#4F6980` / `#849DB1`。
4. 语义映射：达标/盈利用 `#638B66`，未达标/亏损用 `#B66353` 或 `#F47942`，中性基准用 `#7E756D`。
5. 不要使用一整套单一蓝紫渐变作为主视觉。商业 BI 应克制、清晰、耐看。

当前工具会生成默认样式；如果需要强制颜色，优先通过数据口径和图表语义保持一致，必要时再使用高级配置。

## 图表选择指南

- 时间趋势：折线图。
- 类别对比：柱形图或条形图。
- 排名：横向条形图或表格。
- 占比：环形图，类别不要超过 5 个。
- 结构拆解：父级图 + 下钻子级图。
- 销售额 + 增速：柱形 + 折线双轴图。
- 明细核对：表格。

不要把一个图做成“什么都有”。当一个图需要超过 2 个指标、2 个轴或 6 个系列时，拆成图表簇。

## 验收标准

生成前：

- CSV 已写入 workspace。
- `datasets.schema` 中的字段名和 CSV 完全一致。
- 每个 `view.id` 唯一。
- 每个 `series.field` 存在于对应 dataset。
- 每个 `series.axis` 能在 `axes` 中找到。
- 下钻的 `source_field` 与 `target_field` 能真实关联。

生成后：

- HTML 文件生成成功。
- 首页能直接看见核心 KPI 和核心图。
- 下载链接和查看入口语义分离。
- 下钻图点击后应在同一个 HTML 看板内更新，而不是触发下载。
- 颜色、单位、标题、图例一致。
- 最终答复包含文件链接、核心发现、交互说明和验证结果。

## 错误处理

- 如果 `validate_dashboard_spec` 报字段缺失，先修 CSV 或 schema，不要绕过校验。
- 如果用户要求复杂交互，而当前工具能力不足，明确说明限制，并给出可落地替代方案；不要伪造交互。
- 如果已有看板无法被 `edit_dashboard` 读取，说明它不是 v3 看板；应重新生成 v3 看板，不要继续编辑旧 HTML。

## 最终答复格式

最终答复要简洁，包括：

1. 已生成或已修改的 HTML 看板链接。
2. 数据来源和口径摘要。
3. 核心发现 2 到 4 条。
4. 可用交互，例如筛选、点击下钻、导出。
5. 已执行的校验或测试。
