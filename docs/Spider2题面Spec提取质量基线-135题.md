# 题面 → Answer Spec 提取质量基线（SQLite 135 题）

> 历史报告：已被 `docs/Spider2题面Spec提取质量-135题-槽位基线.md` 取代，不作为当前七槽位评估证据。

生成时间：2026-09-05T00:43:27.313Z

> 本报告是离线基线，不调用模型、数据库或 Query Assurance Hook。它首先测量当前两个确定性提取器能提取什么，以及输出行数是否与 Gold 结果形状一致；不把 Gold 反向注入运行时。

## 1. 总览

| 槽位/指标 | 非空或通过 | 比率 | 说明 |
|---|---:|---:|---|
| answerShape.rowMode | 30/135 | 22.22% | 当前提取器输出的 rowMode |
| answerShape.rowCount | 30/135 | 22.22% | 当前提取器输出的 rowCount |
| answerShape.columns | 0/135 | 0.00% | 当前提取器不输出列合同 |
| Gold 行数一致（固定分母） | 18/135 | 13.33% | 与任一 Gold 变体的行数一致 |
| Gold 行数一致（已预测子集） | 18/30 | 60.00% | 仅在提取器给出 rowCount 的题中计算 |
| filters 有输出 | 6/135 | 4.44% | 至少提取一个过滤约束的题 |
| 过滤约束总数 | 12 | — | 所有题合计 |
| 明显 SQL 语法形状通过 | 12/12 | 100.00% | 诊断指标，不是语义 Precision |

## 2. Answer Shape 细分

- 预测分布：scalar=22，top_n=8。
- 缺失预测：105 题。
- 已预测但与 Gold 行数不一致：12 题。
- 当前无法测量完整行列形状：提取器没有输出 columns；Gold 形状仍保留在逐题记录中。

### 行数预测错误

| 题目 | 预测 rowMode / rowCount | Gold 变体行×列 |
|---|---|---|
| local061 | scalar / 1 | 12×2 |
| local075 | scalar / 1 | 9×6 |
| local078 | top_n / 10 | 20×3 |
| local081 | scalar / 1 | 4×3 |
| local171 | scalar / 1 | 8×2 |
| local195 | top_n / 5 | 1×1 |
| local230 | top_n / 4 | 3×2 |
| local263 | scalar / 1 | 2×3 |
| local331 | scalar / 1 | 3×2 |
| local336 | scalar / 1 | 4×2 |
| local344 | scalar / 1 | 4×2 |
| local358 | scalar / 1 | 5×2 |

## 3. Filter 提取诊断

- 当前 `deriveRequestFilterConstraints` 在 12 个输出中，只有 12 个符合严格 SQL 谓词形状；0 个属于明显的普通英文短语误匹配。
- 典型问题是把英文介词 `in` 当作 SQL `IN`。
- 语义 Precision/Recall 暂不计算（报告中为 null），因为尚未有经过复核的题面过滤条件标签。

| 题目 | 明显误提取语句 |
|---|---|
| 无 | — |

## 5. 方法边界与下一步

1. 本轮已经完成确定性基线：135 题的非空率、行数兼容率和明显过滤误提取率。
2. Gold CSV 能直接提供行数、列数和列名，但当前提取器只提供 rowMode/rowCount，因此完整列合同一致率必须先扩展提取器输出或建立独立人工标签。
3. 下一步应建立版本化人工标签，至少覆盖 output、grain、measure、denominator、ranking、time、unit、rounding、joins 和 filters，再计算槽位级 Precision、Recall、过度约束率及 Hard-binding error。
4. Gold 文件缺失题目：无。

