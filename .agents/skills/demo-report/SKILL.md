---
name: demo-report
description: 生成标准化数据分析报告的工作流 Skill
when_to_use: 当用户要求生成正式的数据分析报告、或者明确提到"报告"、"report"时使用
allowed-tools:
  - query_database
  - run_python
  - write_file
  - read_file
---

# 数据分析报告生成 Skill

## 目标

根据用户需求，生成一份结构化的数据分析报告。

## 执行流程

### 第一步：理解需求
- 确认分析主题与数据范围
- 如果用户没有明确指定，询问时间范围、维度和指标

### 第二步：数据获取
- 使用 `execute_sql` 查询所需数据
- 将结果通过 `write_workspace_file` 保存为 CSV（UTF-8 BOM）

### 第三步：分析与可视化
- 使用 `run_python` 执行 pandas 分析
- 生成至少一张图表，保存到 `OUTPUT_DIR`
- 配色使用专业商务风格

### 第四步：撰写报告
- 使用 `write_workspace_file` 生成 Markdown 报告
- 报告结构：摘要 → 数据概览 → 关键发现 → 图表 → 建议

## 报告模板

```markdown
# [主题] 数据分析报告

## 摘要
用一段话概括核心发现。

## 数据概览
| 指标 | 数值 |
|------|------|
| ... | ... |

## 关键发现
1. ...
2. ...

## 可视化

（嵌入图表）

## 建议
基于数据给出 2-3 条可操作的业务建议。
```

## 约束
- 所有数据必须基于实际查询结果，不得编造
- CSV 必须使用 UTF-8 BOM 编码
- 图表风格遵循 knowledge/doc/business.md 中的规范
