---
name: analysis
description: 数据分析与可视化 — ECharts 交互图表或 matplotlib 文件输出
when_to_use: 当用户要求画图、趋势图、折线图、柱状图、饼图、可视化、保存图表、下载图表时使用
allowed-tools:  - query_database
  - show_widget
  - run_python  - write_file
  - search_knowledge  - read_knowledge
---

# 数据分析与可视化

## 路径选择

| 用户意图 | 路径 |
|---------|------|
| "画图"、"趋势图"、"折线图"、"柱状图"、"饼图"、"可视化" | 路径 A：内联 ECharts |
| "保存图表"、"下载"、"发给我"（单图） | 路径 B：文件输出 |

默认使用路径 A（内联 ECharts），除非用户需要可下载文件。

## 路径 A：内联 ECharts（聊天气泡内交互图表）

1. `execute_sql` → 提取数据
2. `show_widget(kind="echarts", config={完整 ECharts option})` → 渲染交互图表
3. 输出分析结论

ECharts config 示例（折线图）：
```json
{
  "tooltip": {"trigger": "axis"},
  "legend": {"data": ["销售额"]},
  "xAxis": {"type": "category", "data": ["1月","2月","3月"]},
  "yAxis": {"type": "value", "name": "亿元"},
  "series": [{"name": "销售额", "type": "line", "data": [100, 120, 95]}]
}
```

**ECharts 规范**：
- `config` 字段传完整的 ECharts option 对象（含 xAxis、yAxis、series、tooltip、legend）
- 数据直接内嵌在 `config.series[].data` 中，不使用 show_widget 的 data/series/columns 字段
- 支持所有 ECharts 图表类型：line / bar / pie / scatter / radar 等
- 用户可点击图表元素进行下钻分析

## 路径 B：文件输出（需要可下载文件时）

1. `search_knowledge` → 检索业务规则
2. `execute_sql` → 提取原始数据
3. `write_workspace_file` → 将结果保存为 CSV（**禁止用 JSON 中转**）
4. `run_python` → 用 pandas 读取 CSV，分步执行：
   - 第一步：`pd.read_csv()` 加载 + 清洗
   - 第二步：统计计算
   - 第三步：绘制图表（保存到 OUTPUT_DIR，图表风格参考 `doc/business.md` 的"图表风格"）
5. 输出分析结论 + 业务建议

**图表规范**：
- 使用 `plt.savefig()` 保存，**不要** `plt.show()`
- 文件名使用 OUTPUT_DIR：`os.environ['OUTPUT_DIR']`
- 配色专业、标注清晰、标题简洁

## 数据传递原则

- SQL 结果 → CSV 文件 → pandas 读取，**全程 CSV，不走 JSON**
- CSV 比 JSON 节省 3-4 倍 token，加载速度更快
- 导出给用户的文件也用 CSV 格式（带 UTF-8 BOM 兼容 Excel）
