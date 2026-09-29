---
name: analysis
description: 交互图表渲染 — 仅当用户明确要求画图或可视化时使用
when_to_use: 仅当用户明确要求“画图”“图表”“可视化”“趋势图”“折线图”“柱状图”“饼图”“保存图表”或“下载图表”时使用。纯数据查询、统计计算或 CSV 导出不要加载此 Skill。
allowed-tools:
  - query_database
  - show_widget
  - render_chart
  - write_file
  - search_knowledge
  - read_knowledge
---

# 交互图表渲染

本 Skill 只处理用户明确要求的图表或可视化，不是所有数据分析任务的默认步骤。先完成用户要求的数据查询，再选择一种输出路径。

## 路径选择

| 用户意图 | 路径 |
|---------|------|
| 明确要求聊天内图表或可视化 | 路径 A：内联 Widget |
| 明确要求保存或下载图像文件 | 路径 B：`render_chart` 输出 SVG 文件 |

不要因为用户使用“分析”“计算”“平均”“报告”或“CSV”这些词就加载本 Skill。

## 路径 A：内联 Widget

1. `query_database` → 按 answer-spec 流程取数，在查询中把数据聚合到图表需要的粒度
2. `publish_query_result` 或 `export_query` → 发布结果，记下返回的 `receiptId`
3. `show_widget(kind="chart", spec=<ChartSpec>)` → 渲染交互图表
4. 输出简短的图表结论，并写明返回的 `[NOTICE]`、`[DISCLOSURE]`、`[SEMANTICS]`

`show_widget` 的当前合同只有以下 kind：`kpi`、`chart`、`table`、`steps`。参数名是 `spec`，不是 `config`。

`chart` 的 `spec` 是 ChartSpec v1，数据通过 `receiptId` 引用已发布的结果，不要把数据行写进 spec。最小合法示例：

```json chart-spec
{
  "version": 1,
  "title": "月度销售额",
  "data": { "kind": "publication", "receiptId": "<receiptId>" },
  "fields": { "sales": { "type": "quantitative", "label": "销售额", "storage": "raw", "unit": "元", "additivity": "additive" } },
  "chart": { "mark": "cartesian", "x": { "field": "month" }, "layers": [{ "type": "bar", "y": { "field": "sales" } }] }
}
```

- `chart`：聊天图表最多容纳 5000 行；更大的结果先在查询中聚合，或改用路径 B。类目很多时可以加 `"viewport": { "mode": "scroll", "window": 20 }`，让图表可以滚动查看。
- `kpi`：`spec` 至少包含数值型或字符串型 `value`，也可以使用 `data` 数组。
- `table`、`steps`：`spec` 必须包含 `data` 数组。表格的数值列需要显示为百分比、带单位或换算量级时，在 `spec.fields` 中按列名声明字段语义（与 ChartSpec 的 `fields` 写法相同）；未声明的数值按原样显示。
- 不要把自然语言结论塞进 `data`；结论放在普通回答中。

## 路径 B：保存图表文件

1. `search_knowledge` → 检索业务规则和图表风格
2. `query_database` → 按 answer-spec 流程取数，在查询中把数据聚合到图表需要的粒度
3. `publish_query_result` 或 `export_query` → 发布结果，记下返回的 `receiptId`
4. `render_chart(spec, fileName)` → 渲染为 `charts/<fileName>.svg`
5. 输出文件链接、图注和简短结论

最小合法示例：

```json chart-spec
{
  "version": 1,
  "data": { "kind": "publication", "receiptId": "<receiptId>" },
  "fields": { "sales": { "type": "quantitative", "label": "销售额", "storage": "raw", "unit": "元", "additivity": "additive" } },
  "chart": { "mark": "cartesian", "x": { "field": "month" }, "layers": [{ "type": "line", "y": { "field": "sales" } }] }
}
```

- 度量字段必须声明 `type: "quantitative"`、`storage` 与 `additivity`；工具不聚合、不补零，出错时按返回的错误码与建议修改查询或 spec。
- 返回的 `[NOTICE]`、`[DISCLOSURE]`、`[SEMANTICS]` 写进图注。
- 不使用 Python 绘图。

## 图表规范

- 标注清晰、标题简洁；配色由工具统一提供，不要自行指定。
- 图表数据必须来自已发布的查询结果。
- 文件下载链接使用普通 Markdown 链接，不用 Widget 代替文件交付。
