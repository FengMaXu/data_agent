---
name: dashboard
description: 生成商用级别的 HTML BI 快照看板
allowed-tools:
  - query_database
  - generate_dashboard
  - search_knowledge
  - read_knowledge
---

# 商用级 HTML BI 快照看板

## 目标

生成可以直接交付给业务人员、数据分析师或管理层的独立 HTML 看板：清晰的数据叙事、统一的视觉编码、稳定的布局。HTML 看板本身就是交付物，下载链接只作为文件获取入口；不要把复杂看板拆成 widget 卡片。

看板是**快照**：每个视图的数据都来自一次已发布的查询结果，生成后不再变化。本 Skill 只描述 `generate_dashboard` 当前实际支持的能力，不要向用户承诺“暂不支持”中列出的功能。

## 当前能力

| 支持 | 暂不支持（不要写进 spec，也不要向用户承诺） |
| --- | --- |
| KPI 卡片、柱形、折线、散点、柱线组合、双 y 轴、堆叠、横向条形、环形饼图、热力图、直方图、箱线图、瀑布图、桑基图、树图、表格 | 页面筛选器、点击下钻、交叉联动 |
| 图表 tooltip、图例、随窗口缩放；视图半宽或整行 | 自定义高度、导出按钮 |
| 按完整 spec 重新生成并覆盖已有看板 | 读取已有看板后局部修改 |
| — | 实时刷新、语义查询绑定 |

## 推荐流程

1. **理解需求**：明确核心问题（趋势、结构、对比、排名、明细）、受众、时间范围与粒度。用户没有说明但数据可以推断时，先做合理假设，并在最终答复中写明。
2. **取数并发布**：每个视图需要的数据按 answer-spec 流程用 `query_database` 查询，**在查询中聚合到视图需要的粒度**，再用 `publish_query_result` 或 `export_query` 发布，记下返回的 `receiptId`。多个视图可以共用同一个结果。
3. **设计 spec**：见下文结构与视图写法。
4. **校验并生成**：`generate_dashboard(operation="validate", spec)`，通过后 `operation="create"`。
5. **最终答复**：见文末格式。

## 调用方式

```text
generate_dashboard(operation, spec, editPath?)
```

- `operation`：`"validate"` 只校验，成功返回 `dashboard spec valid`；`"create"` 生成新看板，返回 `[DASHBOARD_CREATED] dashboards/<filename>.html`；`"edit"` 用完整 spec 重新生成并覆盖 `editPath`（形如 `dashboards/<name>.html`）。
- `edit` 不读取旧看板，必须提供修改后的**完整** spec。旧版（v3）看板也用这种方式按新 spec 重建。
- 失败时返回 `DASHBOARD_SPEC_INVALID` 和逐条的 `[错误码] 说明 (路径)；建议：…`，按错误修改查询或 spec 后重试，不要绕过校验。

## Spec 结构

```json dashboard-spec
{
  "version": 1,
  "title": "2025年12月三大行业经营分析",
  "subtitle": "数据截至 2025-12-31",
  "filename": "industry_dashboard",
  "views": [
    {
      "id": "kpi_summary",
      "type": "kpi",
      "title": "核心指标",
      "data": { "kind": "publication", "receiptId": "<receiptId>" },
      "fields": {
        "total_sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive", "label": "累计销售额" },
        "yoy": { "type": "quantitative", "storage": "ratio", "additivity": "non_additive", "label": "同比增速" }
      },
      "cards": [{ "value": { "field": "total_sales" }, "delta": { "field": "yoy", "label": "同比" } }]
    },
    {
      "id": "industry_sales",
      "type": "chart",
      "chart": {
        "version": 1,
        "title": "三大行业累计销售额",
        "data": { "kind": "publication", "receiptId": "<receiptId>" },
        "fields": { "sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive", "label": "累计销售额" } },
        "chart": { "mark": "cartesian", "x": { "field": "industry" }, "layers": [{ "type": "bar", "y": { "field": "sales" } }] }
      }
    }
  ]
}
```

- 必填：`version: 1`、`title`、至少一个视图。`filename` 省略时按内容生成文件名。
- 每个视图有唯一的 `id`（字母、数字、`_`、`-`）和 `type`：`chart`、`table`、`kpi`。
- 数据一律是 `{ "kind": "publication", "receiptId": "<receiptId>" }`，引用已发布的结果。不要把数据行写进 spec，也不要引用工作区里的 CSV。
- `width`：`"half"` 或 `"full"`。缺省时图表半宽（桌面端每行两个），表格与 KPI 整行。视图按 `views` 中的顺序排列：KPI 在前，核心图其次，支撑图与明细表在后。

## 字段语义

度量字段必须在 `fields` 中声明语义，工具据此换算与显示单位，不会猜测：

- `type: "quantitative"`，`storage`：存储值的含义（`raw` 原值、`ratio` 0.12 表示 12%、`percent` 12 表示 12%），`additivity`：`additive` 或 `non_additive`（比率、均值、单价都是不可加）。
- 可选 `unit`（如 `"亿元"`）、`label`、`magnitude`（如 `{ "stored": 1, "shown": 100000000 }` 把元显示为亿元）。
- 空值保持为空：折线断开、柱留空、表格单元格留白，不会按 0 画。
- 字段语义由你声明，工具会在看板页脚和返回中如实标注“来自模型声明，未经业务定义核实”。
- 工具会用发布时扫描得到的数值范围核对声明，可疑时返回 `[CHECK]`（例如声明为比率却出现 5234）并显示在视图下方。先核对声明：有误就改正 spec，用 `edit` 重建看板。

## 视图写法

### 图表（`chart`）

`chart` 是一个完整的 ChartSpec v1，写法与 `render_chart`、`show_widget` 相同：标题、副标题写在 ChartSpec 里。

```json dashboard-view
{
  "id": "industry_sales_growth",
  "type": "chart",
  "width": "full",
  "chart": {
    "version": 1,
    "title": "三大行业累计销售额与同比增速",
    "subtitle": "销售额为柱形，增速为折线",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": {
      "sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive", "label": "累计销售额" },
      "yoy": { "type": "quantitative", "storage": "ratio", "additivity": "non_additive", "label": "同比增速" }
    },
    "chart": {
      "mark": "cartesian",
      "x": { "field": "industry" },
      "layers": [
        { "type": "bar", "y": { "field": "sales" } },
        { "type": "line", "y": { "field": "yoy", "axis": "right" } }
      ]
    }
  }
}
```

长表中一个指标按某个维度拆成多条线或多组柱时，用图层的 `series`：

```json dashboard-view
{
  "id": "industry_trend",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "三大行业同比增速走势",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": { "yoy": { "type": "quantitative", "storage": "ratio", "additivity": "non_additive", "label": "同比增速" } },
    "chart": {
      "mark": "cartesian",
      "x": { "field": "month" },
      "layers": [{ "type": "line", "y": { "field": "yoy" }, "series": { "field": "industry", "order": ["批发业", "零售业", "餐饮业"] } }]
    }
  }
}
```

环形饼图只用于可加指标的完整构成，值不能为负、不能有空值：

```json dashboard-view
{
  "id": "industry_share",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "三大行业销售额构成",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": { "sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive" } },
    "chart": { "mark": "pie", "category": { "field": "industry" }, "value": { "field": "sales" } }
  }
}
```

两个维度交叉比较一个指标时用热力图：每个 (x, y) 单元格一行，缺失的组合留白。颜色有正负含义时用 `scale: "diverging"` 并声明中点 `midpoint`（与数据同单位，如同比的 0），否则用默认的顺序色阶：

```json dashboard-view
{
  "id": "growth_heatmap",
  "type": "chart",
  "width": "full",
  "chart": {
    "version": 1,
    "title": "各行业月度同比增速",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": {
      "yoy": { "type": "quantitative", "storage": "ratio", "additivity": "non_additive", "label": "同比增速" },
      "month": { "type": "temporal", "grain": "month", "zone": "floating" }
    },
    "chart": { "mark": "heatmap", "x": { "field": "month" }, "y": { "field": "industry" }, "color": { "field": "yoy", "scale": "diverging", "midpoint": 0 } }
  }
}
```

分布用直方图或箱线图，分箱与统计量都在查询中算好，工具不分箱、不计算统计量：

```json dashboard-view
{
  "id": "order_amount_hist",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "订单金额分布",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": {
      "bin_start": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "additive", "label": "订单金额" },
      "bin_end": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "additive" },
      "orders": { "type": "quantitative", "storage": "raw", "unit": "单", "additivity": "additive", "label": "订单数" }
    },
    "chart": { "mark": "histogram", "start": { "field": "bin_start" }, "end": { "field": "bin_end" }, "value": { "field": "orders" } }
  }
}
```

```json dashboard-view
{
  "id": "price_box",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "各区域单价分布",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": {
      "p_min": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "non_additive" },
      "p_q1": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "non_additive" },
      "p_median": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "non_additive", "label": "单价" },
      "p_q3": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "non_additive" },
      "p_max": { "type": "quantitative", "storage": "raw", "unit": "元", "additivity": "non_additive" }
    },
    "chart": { "mark": "boxplot", "category": { "field": "region" }, "min": { "field": "p_min" }, "q1": { "field": "p_q1" }, "median": { "field": "p_median" }, "q3": { "field": "p_q3" }, "max": { "field": "p_max" }, "whisker": "min_max" }
  }
}
```

- 直方图每行一个分箱（左闭右开、互不重叠），区间重叠返回 `BIN_OVERLAP`。
- 箱线图每个类目一行，五个统计量须满足 最小值 ≤ Q1 ≤ 中位数 ≤ Q3 ≤ 最大值，否则返回 `STAT_ORDER_VIOLATION`；`whisker` 必须写明须线含义（`min_max` 或 `iqr_1_5`），会随图说明。

从期初到期末的增减拆解用瀑布图：每一步的起点 `start` 与终点 `end` 都由查询算好（累计在 SQL 中完成），按行顺序衔接；合计行（`total` 列为 true）从 0 开始：

```json dashboard-view
{
  "id": "profit_bridge",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "利润变动拆解",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": {
      "run_start": { "type": "quantitative", "storage": "raw", "unit": "万元", "additivity": "non_additive" },
      "run_end": { "type": "quantitative", "storage": "raw", "unit": "万元", "additivity": "non_additive", "label": "利润" }
    },
    "chart": { "mark": "waterfall", "step": { "field": "item" }, "start": { "field": "run_start" }, "end": { "field": "run_end" }, "total": { "field": "is_total" } }
  }
}
```

- 每一步的 `start` 须等于上一步的 `end`，合计行须从 0 开始且等于上一步的 `end`，否则返回 `RANGE_INCONSISTENT`。柱上标注的是查询给出的 `end`。

流向（如转化路径）用桑基图，层级构成用树图。两者都属于部分与整体，度量须可加、完整、非负：

```json dashboard-view
{
  "id": "funnel_flow",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "访问到付费的流向",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": { "users": { "type": "quantitative", "storage": "raw", "unit": "人", "additivity": "additive", "label": "人数" } },
    "chart": { "mark": "sankey", "source": { "field": "from_stage" }, "target": { "field": "to_stage" }, "value": { "field": "users" } }
  }
}
```

```json dashboard-view
{
  "id": "sales_tree",
  "type": "chart",
  "chart": {
    "version": 1,
    "title": "行业销售额构成",
    "data": { "kind": "publication", "receiptId": "<receiptId>" },
    "fields": { "sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive", "label": "销售额" } },
    "chart": { "mark": "treemap", "path": [{ "field": "sector" }, { "field": "industry" }], "value": { "field": "sales" } }
  }
}
```

- 桑基图每条流向（来源、去向）一行；流向成环返回 `FLOW_CYCLE`。节点大小是连线之和。
- 树图只接受叶子行，每行带完整路径（最多 4 层）；上层面积是叶子之和。路径重复返回 `DUPLICATE_KEY`。

图表约束（工具以结构化错误返回，不会自行修复）：

- **同一个 x 值（或 x 加系列值）只能有一行**，否则返回 `DUPLICATE_KEY`。在查询中聚合到图表粒度；散点图允许重复坐标。
- 堆叠、百分比堆叠、饼图要求度量可加、完整、非负，否则返回 `NON_ADDITIVE_PART_OF_WHOLE`、`INCOMPLETE_PART_OF_WHOLE`、`NEGATIVE_IN_PART_OF_WHOLE`。
- 类别太多时用 ChartSpec 的 `selection: { "kind": "top_n", ... }` 显式声明 Top-N，或在查询中筛选；不能与饼图、堆叠同时使用。
- 同一张图不超过 2 个量纲（左右两个 y 轴）；超过时拆成多张图。

### KPI 卡片（`kpi`）

每张卡片显示结果中**一个单元格**，不做求和或平均。结果只有一行时直接引用字段；有多行时用 `where` 选出唯一的一行。增速、占比等要在查询中算好，放在 `delta` 字段：

```json dashboard-view
{
  "id": "kpi_by_industry",
  "type": "kpi",
  "title": "分行业销售额",
  "data": { "kind": "publication", "receiptId": "<receiptId>" },
  "fields": {
    "sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive", "label": "销售额" },
    "yoy": { "type": "quantitative", "storage": "ratio", "additivity": "non_additive" }
  },
  "cards": [
    { "label": "批发业", "value": { "field": "sales" }, "delta": { "field": "yoy", "label": "同比" }, "where": { "industry": "批发业" } },
    { "label": "零售业", "value": { "field": "sales" }, "delta": { "field": "yoy", "label": "同比" }, "where": { "industry": "零售业" } }
  ]
}
```

- 卡片最多 8 张。`label` 缺省时用字段的 `label` 或列名。
- 匹配不到行返回 `KPI_ROW_NOT_FOUND`，匹配到多行返回 `KPI_ROW_AMBIGUOUS`。

### 表格（`table`）

表格显示结果的全部行（每个结果最多 5000 行）。`columns` 省略时显示全部列；在 `fields` 中声明的数值列按语义格式化并右对齐，未声明的按原值显示：

```json dashboard-view
{
  "id": "industry_detail",
  "type": "table",
  "title": "重点行业明细",
  "data": { "kind": "publication", "receiptId": "<receiptId>" },
  "columns": [
    { "field": "industry_name", "label": "行业中类" },
    { "field": "sales", "label": "销售额" },
    { "field": "yoy", "label": "同比增速" }
  ],
  "fields": {
    "sales": { "type": "quantitative", "storage": "raw", "unit": "亿元", "additivity": "additive" },
    "yoy": { "type": "quantitative", "storage": "ratio", "additivity": "non_additive" }
  }
}
```

## 设计方法与硬约束

1. 先判数据形状，再选视图。至少比较两个能承载同一数据的候选，按业务问题、标签容量和阅读速度选择，不按“哪个图最炫”选择。
2. 每个视图只承担一个独立结论。标题写清“对象 + 指标 + 时间/口径”，不写“柱状图”等图型名；单位、口径、筛选范围写进副标题。
3. 图表不诚实时拒绝：占比类别超过 5 个时改用排序后的柱形图或表格；超过 6 个系列时拆图。
4. 一张看板回答一个业务问题；简约胜于炫技，优先 KPI、折线、柱形、环形、表格。

| 数据形状 | 视图 |
| --- | --- |
| 3–6 个头部指标 | `kpi` |
| 单指标有序时间序列 | `chart`：`line` 图层 |
| 一个指标按一个维度分组的趋势 | `chart`：`line` 图层加 `series` |
| 已排序的类目比较、少类目比较 | `chart`：`bar` 图层（查询中排好序）；标签长时 `orientation: "horizontal"` |
| 2–3 个可比系列 | `chart`：`bar` 图层加 `series`，或多个 `bar` 图层 |
| 绝对量 + 比率 | `chart`：`bar` 图层 + `line` 图层（`axis: "right"`） |
| 围绕零点的正负值 | `chart`：`bar` 图层 |
| 不超过 5 类的完整构成 | `chart`：`pie` |
| 类目与数值的关系、逐项分布 | `chart`：`scatter` 图层 |
| 两个维度交叉的一个指标（行业 × 月份） | `chart`：`heatmap` |
| 一个数值的分布 | `chart`：`histogram`（分箱由查询给出） |
| 多组数值分布的比较 | `chart`：`boxplot`（统计量由查询给出） |
| 期初到期末的增减拆解 | `chart`：`waterfall`（累计由查询给出） |
| 阶段之间的流向与转化 | `chart`：`sankey` |
| 多层级的完整构成 | `chart`：`treemap` |
| 可核对的明细、带多个指标的排名 | `table` |

## 配色

工具按系列顺序使用本项目八色商用色板，与聊天图表和报告图表一致：

`#4F6980` 深蓝灰、`#F47942` 橙红、`#638B66` 深灰绿、`#FBB04E` 橘黄、`#B66353` 铁锈红、`#849DB1` 浅蓝灰、`#B9AA97` 浅灰褐、`#7E756D` 深灰褐。

需要按维度值固定颜色时，在图层的 `series.colors` 中指定（如 `{ "批发业": "#4F6980" }`）。同一个维度值在不同图中要保持同一颜色：在每张图中写相同的映射，或让系列顺序保持一致。语义映射：达标/盈利用 `#638B66`，未达标/亏损用 `#B66353` 或 `#F47942`，中性基准用 `#7E756D`。

## 验收

生成前：

- 每个视图的数据都已发布，`receiptId` 来自发布工具的返回。
- 每个 `view.id` 唯一；引用的列都在对应结果中。
- 图表数据已在查询中聚合到图表粒度；KPI 引用的是查询算好的单元格。
- `validate` 返回 `dashboard spec valid`。

生成后：

- `create` 返回了 HTML 路径。
- 标题、单位、图例、颜色一致。

## 错误处理

- `DASHBOARD_SPEC_INVALID`：按错误列表修改 spec 或查询，不要绕过校验。
- `CHART_DATA_UNSUPPORTED`：视图的数据不是已发布结果。先发布，再引用 `receiptId`。
- `DASHBOARD_TOO_MANY_ROWS`：结果超过 5000 行。在查询中聚合，明细用 `export_query` 提供下载。
- 用户要求筛选、下钻、实时刷新等暂不支持的能力时，明确说明限制，给出可落地的替代方案（例如按切片拆成多张图、附上明细表），不要伪造交互。

## 最终答复格式

1. 看板 HTML 链接。
2. 数据来源和口径摘要，包括所做的假设；把返回中的 `[NOTICE]`、`[DISCLOSURE]`、`[SEMANTICS]` 如实转述。
3. 核心发现 2 到 4 条。
4. 已执行的校验。
