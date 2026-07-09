# HTML 看板工具重构方案

## 1. 背景

本方案只针对 HTML 看板生成工具本身，不修改 `.agents/skills/dashboard/SKILL.md`。等工具契约、运行时和测试稳定后，再根据新工具设计更新 skill。

当前失败模式很明确：用户提出一个常规 BI 需求，例如“销售额柱形图 + 增速折线图 + 点击下钻”，但工具只暴露了几个松散能力：

- `chart_type="bar"` / `chart_type="line"`：简单图表。
- `chart_type="custom"`：直接传完整 ECharts option。
- `drilldown`：图表局部下钻配置。
- `echarts_option`：覆盖已有 ECharts option 的逃生口。

这些能力没有形成稳定的 BI 语义，导致 LLM 必须猜实现细节。生产级 HTML 看板工具应该让模型声明业务意图，而不是手写 ECharts 配置。

## 2. 目标

将当前 HTML 工具升级为生产级、Schema 驱动的 BI 看板运行时：

```text
workspace 数据文件
  -> 已验证 Dashboard Spec
  -> 类型化数据模型
  -> View 编译器
  -> 交互运行时
  -> 独立 HTML 看板
```

目标能力：

1. KPI 卡片。
2. 图表网格。
3. 组合图，支持柱形、折线、多轴。
4. 明细表和透视表。
5. 全局筛选。
6. 图表点击筛选。
7. 图表点击下钻。
8. 面包屑返回。
9. 一键重置状态。
10. 图表和表格共享同一套 Dashboard State。

这不是要做完整 Tableau 编辑器，而是要生成可消费、可交互、稳定可靠的 HTML BI 看板。

## 3. 设计原则

### 3.1 契约优先

先定义版本化 BI Spec，再扩展模板和交互。工具应该对模糊配置给出可修复的错误，而不是静默生成半残看板。

### 3.2 数据、视图、交互分离

数据集是数据集，图表只是 View，交互是独立规则。不要继续让每个 chart 自己带一套局部数据和局部下钻逻辑。

### 3.3 ECharts 是编译目标，不是主契约

LLM 应声明通用 `type="chart"`、`coordinate`、字段、mark、axis。工具负责编译成 ECharts option。`combo_chart` 只作为兼容别名保留，`echarts_option` 只保留为高级逃生口。

### 3.4 Dashboard State 一等化

筛选、选中项、下钻路径、当前视图数据都应是运行时状态。当前 `drilldown_data` 能用，但不足以支撑复杂 BI 交互。

### 3.5 结构化编辑替代 HTML 正则修改

`add_chart` / `remove_chart` 未来应修改嵌入 HTML 的 canonical spec，然后重新渲染。直接正则改 HTML 只能作为兼容路径。

## 4. 新 Spec 设计

引入内部 spec 版本，建议为 `version="3"`。`build_dashboard` 继续接收旧参数，并归一化到新结构。

```json
{
  "version": "3",
  "title": "Industry Sales Dashboard",
  "theme": "light",
  "layout": {
    "sidebar": true,
    "grid": { "columns": 12, "gap": 16 }
  },
  "datasets": [],
  "fields": [],
  "kpis": [],
  "views": [],
  "filters": [],
  "interactions": [],
  "exports": []
}
```

### 4.1 Datasets

Dataset 描述物理数据源、字段类型和关系。

```json
{
  "id": "industry_summary",
  "source": {
    "type": "csv",
    "path": "data/industry_summary.csv"
  },
  "key": ["行业大类"],
  "schema": [
    { "name": "行业大类", "type": "string", "role": "dimension" },
    { "name": "销售额_亿元", "type": "number", "role": "measure", "unit": "亿元" },
    { "name": "同比增速_百分比", "type": "number", "role": "measure", "unit": "%" }
  ]
}
```

下钻关系不应藏在单个 chart 里，而应作为 dataset 关系或 interaction 规则描述：

```json
{
  "id": "industry_medium",
  "source": { "type": "csv", "path": "data/industry_medium.csv" },
  "parent": {
    "dataset": "industry_summary",
    "source_field": "行业大类",
    "target_field": "行业大类"
  }
}
```

### 4.2 Views

View 是可渲染区块。第一阶段应支持：

1. `metric_cards`
2. `chart`（通过 `coordinate` 表达 cartesian、后续可扩展 polar/geo）
3. `pie_chart`
4. `table`
5. `pivot_table`

组合图示例：

```json
{
  "id": "industry_combo",
  "type": "chart",
  "coordinate": "cartesian",
  "title": "2025年12月三大行业累计销售额与同比增速",
  "dataset": "industry_summary",
  "layout": { "span": 12, "height": 420 },
  "x": { "field": "行业大类", "type": "category" },
  "axes": [
    { "id": "sales_axis", "orient": "y", "position": "left", "name": "销售额", "unit": "亿元" },
    { "id": "growth_axis", "orient": "y", "position": "right", "name": "同比增速", "unit": "%" }
  ],
  "series": [
    {
      "id": "sales",
      "name": "累计销售额",
      "field": "销售额_亿元",
      "mark": "bar",
      "axis": "sales_axis"
    },
    {
      "id": "growth",
      "name": "同比增速",
      "field": "同比增速_百分比",
      "mark": "line",
      "axis": "growth_axis"
    }
  ]
}
```

### 4.3 Interactions

交互应作为一等对象，而不是塞进 chart 的 `drilldown` 字段。

```json
{
  "id": "drill_industry_to_medium",
  "source": { "view": "industry_combo", "event": "click" },
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
        { "id": "sales", "name": "累计销售额", "field": "销售额_亿元", "mark": "bar", "axis": "sales_axis" },
        { "id": "growth", "name": "同比增速", "field": "同比增速_百分比", "mark": "line", "axis": "growth_axis" }
      ]
    }
  }
}
```

关键点：顶层图和下钻图使用同一套 View 语法。这样“柱形图 + 折线图 + 双轴 + 下钻”成为明确契约，而不是靠 `custom` 猜。

## 5. 工具 API 设计

### 5.1 `build_dashboard`

主工具，继续保留。支持：

1. 旧的 `title/charts/kpis/filters` 参数。
2. 新的 `spec` 参数。

返回：

1. Markdown 下载链接。
2. 相对路径。
3. 可选预览 URL 元数据。
4. validation summary。
5. `spec_version` 和 `renderer_version`。

### 5.2 `validate_dashboard_spec`

新增可选工具。只验证 spec，不写 HTML。

价值：

1. 在渲染前发现字段缺失、轴引用错误、交互引用错误。
2. 给 LLM 返回可修复的错误路径。
3. 降低复杂看板生成失败率。

### 5.3 `edit_dashboard`

新增结构化编辑工具。读取 HTML 内嵌 canonical spec，执行 patch，再重新渲染。

```json
{
  "dashboard_path": "dashboards/example.html",
  "operations": [
    { "op": "replace_view", "view_id": "industry_combo", "view": {} },
    { "op": "add_interaction", "interaction": {} },
    { "op": "remove_view", "view_id": "old_chart" }
  ]
}
```

`add_chart` 和 `remove_chart` 暂时保留，后续改造成 `edit_dashboard` 的兼容包装。

## 6. 代码架构

建议将当前 `html_dashboard.py` 拆出清晰边界：

```text
src/agent/tool_providers/html_dashboard.py
  只负责工具注册、参数入口、结果格式化。

src/agent/tool_providers/dashboard_spec.py
  版本化 spec 归一化、兼容转换、验证。

src/agent/tool_providers/dashboard_data.py
  workspace 文件读取、CSV 解析、类型转换、字段检查。

src/agent/tool_providers/dashboard_compiler.py
  View spec -> 中间模型 -> ECharts option / table model。

src/agent/tool_providers/dashboard_interactions.py
  交互规则验证和运行时 payload 构建。

src/agent/tool_providers/dashboard_renderer.py
  HTML 渲染、资产声明、内嵌 JSON 数据块。
```

`chart_builder.py` 先作为 legacy adapter 保留，等新 compiler 稳定后再收缩。

## 7. HTML 运行时设计

生成 HTML 中应嵌入独立 JSON 块：

```html
<script id="dashboard-spec" type="application/json">...</script>
<script id="dashboard-data" type="application/json">...</script>
<script id="dashboard-compiled-views" type="application/json">...</script>
<script id="dashboard-interactions" type="application/json">...</script>
```

前端运行时维护：

1. `filters`
2. `selection`
3. `drillStack`
4. `viewData`
5. `compiledOptions`

图表和表格都从 Dashboard State 渲染，而不是只 set 一次静态 ECharts option。

## 8. 生产级要求

### 8.1 校验

必须校验：

1. Dataset 是否存在。
2. 字段是否存在。
3. mark 类型是否支持。
4. axis 引用是否存在。
5. interaction 引用的 view/dataset 是否存在。
6. drilldown match 字段是否存在。
7. 文件路径是否越过 workspace。
8. 文件类型和文件大小是否超限。

错误要给出可定位路径：

```text
views[2].series[1].axis references unknown axis id 'growth'
```

### 8.2 兼容

旧输入继续可用：

```json
{
  "title": "Sales",
  "charts": [
    {
      "title": "Monthly Sales",
      "chart_type": "bar",
      "data_file": "data/monthly.csv",
      "x_column": "month",
      "y_columns": ["sales"]
    }
  ]
}
```

兼容归一化规则：

1. 每个唯一 `data_file` 生成一个 dataset。
2. 每个 legacy chart 生成一个 view。
3. legacy `drilldown` 尽量转换成 interaction。
4. 转换不了的复杂 `echarts_option` 标记为 escape hatch。

### 8.3 安全

1. 所有标题、标签、文本转义。
2. 不从 spec 执行任意 JS。
3. `echarts_option` 只当数据，不允许函数。
4. 文件读取限制在 session workspace 内。
5. 外部依赖通过 asset manifest 显式声明。

### 8.4 性能

1. 小中型数据可嵌入 source rows。
2. 设置行数和字节大小上限。
3. 大数据在工具端预聚合，只嵌入交互所需数据。
4. 点击交互只重算受影响 view，不全量重算。

### 8.5 可观测性

每个 HTML 看板包含 metadata：

1. `spec_version`
2. `renderer_version`
3. `generated_at`
4. `dataset_count`
5. `view_count`
6. `interaction_count`
7. asset mode

工具返回结果中包含 validation warnings 和 output path。

## 9. 实施阶段

### Phase 0 - 基线锁定

目标：重构前锁住现有行为。

交付：

1. 补现有 `build_dashboard`、`add_chart`、`remove_chart` 测试。
2. 补一个现有 drilldown fixture。
3. 补一个现有 custom fallback fixture。

验证：

1. 现有测试通过。
2. 生成 HTML 仍包含 `charts-data`、图表容器、sidebar。
3. App 预览仍可打开 HTML。

### Phase 1 - Spec v3 校验层

目标：加入新契约，不改变渲染输出。

交付：

1. 扩展 `dashboard_spec.py`，支持 `spec.version="3"`。
2. 增加 datasets、views、fields、interactions 校验。
3. 增加 `validate_dashboard_spec` 工具。
4. 旧参数归一化保持可用。

验证：

1. 无效字段返回明确错误路径。
2. 旧输入归一化后仍可生成旧式 HTML。
3. 不修改 skill。

### Phase 2 - Dataset Loader 和类型化数据模型

目标：统一数据读取和字段类型。

交付：

1. 新增 `dashboard_data.py`。
2. 支持 CSV 类型转换。
3. 校验 workspace 路径和字段 schema。
4. 生成可复用 dataset map。

验证：

1. 缺字段在渲染前失败。
2. 数字、逗号、空值、百分比解析一致。

### Phase 3 - View Compiler

目标：从 View Spec 编译到 ECharts/Table runtime model。

交付：

1. 新增 `dashboard_compiler.py`。
2. 实现通用 `type="chart"` + `coordinate="cartesian"`。
3. 将 `bar/line/pie` 迁入同一 compiler。
4. `echarts_option` 变成覆盖层，不再作为核心路径。

验证：

1. 通用 cartesian chart 可通过 series mark 编译出柱形、折线、散点、组合图和双 y 轴。
2. legacy bar chart 输出不退化。

### Phase 4 - Interaction Runtime v2

目标：实现 Tableau-like 的生成式交互。

交付：

1. 模板 JS 加入 dashboard state runtime。
2. 实现 `click-to-filter`。
3. 实现 `drilldown` + breadcrumb。
4. 下钻目标支持通用 chart 和 `table`。
5. 实现 reset。

验证：

1. 点击父级行业后过滤子 dataset 并渲染下钻 view。
2. 面包屑返回父级。
3. reset 恢复初始视图和筛选。

### Phase 5 - 结构化编辑

目标：让增量修改可靠。

交付：

1. HTML 内嵌 canonical spec。
2. 增加 `edit_dashboard`。
3. 修改 dashboard 时从 spec 重渲染。
4. `add_chart/remove_chart` 改为 wrapper。

验证：

1. 删除再新增 view 后，sidebar 和 interactions 不丢。
2. HTML 中 embedded spec 与渲染结果一致。

### Phase 6 - 浏览器级 QA

目标：让 UI 回归可见。

交付：

1. Browser smoke tests。
2. 桌面和移动端 viewport 检查。
3. ECharts canvas 非空检查。
4. combo chart + drilldown fixture。

验证：

1. 测试能证明图表渲染非空。
2. 点击下钻端到端通过。

### Phase 7 - 更新 skill

目标：工具稳定后再更新模型说明。

交付：

1. 修改 `.agents/skills/dashboard/SKILL.md`。
2. 写入 datasets、views、interactions、通用 chart 示例。
3. 移除 `custom`/`drilldown` 的误导性表述。

验证：

1. 模型能不写 raw ECharts 完成目标看板。
2. skill 示例走新生产路径。

## 10. 验收场景

必须能通过结构化工具参数完成以下需求：

> 生成一个看板，包含 KPI 卡片、增速趋势折线图、销售额柱形 + 增速折线双轴组合图。点击三大行业任一行业后，下钻到行业中类，并用同样的销售额柱形 + 增速折线组合图展示。

验收标准：

1. KPI 卡片正常渲染。
2. 增速趋势折线图正常渲染。
3. 组合图中销售额为柱形，增速为折线，左右双轴清晰。
4. 点击行业大类进入行业中类下钻图。
5. 面包屑可返回父级。
6. HTML 可在独立浏览器和 app 预览弹窗中查看。
7. 核心路径不需要 `custom` 图或手写 ECharts option。

## 11. 明确不做

1. Phase 0-6 不修改 `dashboard` skill。
2. 不做完整拖拽式 BI 编辑器。
3. 常规看板不要求模型写 JavaScript。
4. 新路径未稳定前，不删除旧输入兼容。
5. 不再把 raw `echarts_option` 作为组合图和下钻的官方方案。

## 12. 下一步

优先做 Phase 0 和 Phase 1：

1. 补现有行为基线测试。
2. 加 Spec v3 校验和归一化。
3. 保持渲染输出不变。

验证稳定后，再继续完善通用 chart mark 体系和 Interaction Runtime v2。
