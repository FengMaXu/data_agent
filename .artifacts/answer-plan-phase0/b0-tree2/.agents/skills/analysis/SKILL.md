---
name: analysis
description: 交互图表渲染 — 仅当用户明确要求画图或可视化时使用
when_to_use: 仅当用户明确要求“画图”“图表”“可视化”“趋势图”“折线图”“柱状图”“饼图”“保存图表”或“下载图表”时使用。纯数据查询、统计计算或 CSV 导出不要加载此 Skill。
allowed-tools:
  - query_database
  - show_widget
  - run_python
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
| 明确要求保存或下载图像文件 | 路径 B：Python 文件输出（仅当 `run_python` 在当前工具列表中） |

不要因为用户使用“分析”“计算”“平均”“报告”或“CSV”这些词就加载本 Skill。

## 路径 A：内联 Widget

1. `query_database` → 提取并验证图表数据
2. `show_widget(kind="chart", spec={...})` → 渲染图表
3. 输出简短的图表结论

`show_widget` 的当前合同只有以下 kind：`kpi`、`chart`、`table`、`steps`。参数名是 `spec`，不是 `config`。

最小合法示例：

```json
{
  "kind": "chart",
  "spec": {
    "title": "月度销售额",
    "data": [
      {"month": "1月", "sales": 100},
      {"month": "2月", "sales": 120}
    ],
    "series": [
      {"name": "销售额", "data": [100, 120]}
    ]
  }
}
```

- `kpi`：`spec` 至少包含数值型或字符串型 `value`，也可以使用 `data` 数组。
- `chart`：`spec` 使用 `data` 数组，或使用 `series` 数组。
- `table`、`steps`：`spec` 必须包含 `data` 数组。
- 不要把自然语言结论塞进 `data`；结论放在普通回答中。

## 路径 B：保存图像文件

1. `search_knowledge` → 检索业务规则和图表风格
2. `query_database` → 提取并验证数据
3. `write_file` → 必要时保存 CSV 中间文件
4. `run_python` → 用 pandas 读取 CSV，清洗、统计并用 matplotlib 绘图
5. `write_file` 或 Python 输出 → 将图像保存到用户指定位置
6. 输出图像文件链接和简短结论

如果当前工具列表没有 `run_python`，不要调用或重试它；改用已可用的查询工具，或说明无法生成文件图表。

## 图表规范

- 使用 `plt.savefig()` 保存，不使用 `plt.show()`。
- 配色专业、标注清晰、标题简洁。
- 图表数据必须来自已验证的查询结果。
- 文件下载链接使用普通 Markdown 链接，不用 Widget 代替文件交付。
