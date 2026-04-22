---
name: dashboard
description: 生成交互式多图表 HTML BI 看板
when_to_use: 当用户要求生成看板、综合分析、导出报告、多图表对比时使用
allowed-tools:
  - execute_sql
  - build_dashboard
  - add_chart
  - remove_chart
  - show_widget
  - write_workspace_file
  - search_knowledge
  - read_knowledge_file
---

# HTML BI 看板生成（声明式数据驱动）

## 使用时机

用户明确要求"生成看板"、"综合分析"、"导出报告"、"多图表对比"时使用。

## 核心原则

> LLM 只描述意图，不搬运数据。数据留在 CSV 文件中，工具自动读取并构建图表。

## 执行流程

1. `execute_sql` × N → 执行多个查询
2. `write_workspace_file` × N → 每个查询结果存为 CSV
3. `build_dashboard(title, charts=[{chart_type, data_file, ...}])` → 生成 HTML
4. `show_widget(kind="file_link", ...)` → 展示文件链接
5. 输出分析结论

## chart_type 速查

| chart_type | 必需字段 |
|---|---|
| `line` | `data_file`, `x_column`, `y_columns` |
| `bar` | `data_file`, `x_column`, `y_columns` |
| `pie` | `data_file`, `name_column`, `value_column` |
| `scatter` | `data_file`, `x_column`, `y_column` |
| `radar` | `data_file`, `indicator_column`, `value_columns` |
| `custom` | `echarts_option`（直接传完整 ECharts 配置） |

## 图表配置示例

```python
charts = [
    {
        "title": "月度销售额趋势",
        "subtitle": "2024年1-12月",
        "chart_type": "line",
        "data_file": "data/monthly_sales.csv",
        "x_column": "月份",
        "y_columns": ["销售额"],
        "width": "50%"
    },
    {
        "title": "行业分布",
        "chart_type": "pie",
        "data_file": "data/industry.csv",
        "name_column": "行业",
        "value_column": "销售额",
        "width": "50%"
    }
]
```

## 追加图表（用户要求添加新图表时）

1. `execute_sql` → 查新数据
2. `write_workspace_file` → 存 CSV
3. `add_chart(dashboard_path, chart={...})` → 追加到现有看板

## 下钻配置

在图表对象的 `drilldown` 字段中配置：

```python
{
    "title": "区域销售",
    "chart_type": "bar",
    "data_file": "data/region_sales.csv",
    "x_column": "区域",
    "y_columns": ["销售额"],
    "drilldown": {
        "detail_data_file": "data/province_sales.csv",
        "detail_chart_type": "bar",
        "detail_x_column": "省份",
        "detail_y_columns": ["销售额"],
        "group_column": "区域"
    }
}
```

点击图表数据点时自动切换为对应下钻子图，无需额外 tool call。

## 主题选择

```python
build_dashboard(
    title="销售分析看板",
    charts=[...],
    theme="dark"  # 可选：'light'（默认）, 'dark', 'blue'
)
```

## 布局建议

- 2 个图表：`width="50%"`（并排显示）
- 3 个图表：`width="33.33%"`（三列）或 1 个 `100%` + 2 个 `50%`
- 4 个图表：`width="50%"`（2x2 网格）
- 单个大图：`width="100%"`

## 功能特性

- 用户可在看板中切换主题（浅色/深色/蓝色）
- 支持导出 PDF
- 图表自动适应容器大小
- 内嵌下钻交互（面包屑导航返回）

## 数据传递原则

- SQL 结果 → CSV 文件 → build_dashboard 自动读取，**全程 CSV，不走 JSON**
- CSV 比 JSON 节省 3-4 倍 token，加载速度更快
- 导出给用户的文件也用 CSV 格式（带 UTF-8 BOM 兼容 Excel）
