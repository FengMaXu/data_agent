# Phase 6 DeepSeek 三臂共有 57 题评测

日期：2026-09-09  
性质：**部分、探索性配对评测；不具备正式推广资格**

## 数据与方法

- 输入运行：`answer-plan-phase6-legacy-r1`、`answer-plan-phase6-new-off-r1`、`answer-plan-phase6-new-on-r1`。
- 三臂分别有 57、62、61 个结果记录；按 `instanceId` 取严格交集后得到 57 题。
- 每题在每臂只保留一次观测；缺少最终结果提交按错误计分。
- 正确率采用 Spider2 官方 `exec_result` case score。
- 差值置信区间采用按 `instanceId` 配对的 10,000 次 cluster bootstrap。
- 歧义标签来自 `evaluations/spider2/spec-quality-labels.jsonl`；共有 25 个歧义正例。
- 可复现产物：`.artifacts/answer-plan-phase6/partial-common-57-report.json`。

## 汇总结果

| 指标 | Legacy | New-off | New-on |
|---|---:|---:|---:|
| 正确率 | 45.61% (26/57) | 47.37% (27/57) | 43.86% (25/57) |
| 合法交付率 | 87.72% (50/57) | 91.23% (52/57) | 91.23% (52/57) |
| 平均工具调用 | 23.04 | 24.14 | 23.11 |
| 平均 turns | 14.68 | 14.56 | 14.37 |
| 平均 token 记录 | 235,961 | 233,174 | 225,775 |
| 平均延迟 | 124.2 秒 | 120.9 秒 | 122.8 秒 |
| P95 延迟 | 307.5 秒 | 228.6 秒 | 262.9 秒 |
| provider error | 4 | 2 | 2 |
| timeout/max-turn | 7 | 3 | 3 |
| 歧义召回率 | 0% | 4% | 12% |
| 歧义精确率 | N/A | 25% | 60% |
| 已发布候选假设披露漏失率 | N/A（legacy 无该合同） | 0% (0/109) | 0% (0/110) |

`meanReportedCost` 在三臂 trace 中均为 0，不能据此声称实际 API 成本为零；这里只能比较 token 记录。

## 配对比较

### 架构：Legacy → New-off

- 正确率差：**+1.75pp**；95% bootstrap CI **[-7.02pp, +10.53pp]**。
- 交付率差：**+3.51pp**；95% CI **[-5.26pp, +14.04pp]**。
- 工具调用 +4.80%；token -1.18%；平均延迟 -2.63%；P95 延迟 -25.66%。

点估计有改善，但正确率 CI 下界低于冻结的 -3pp 非劣界限，**无法证明非劣**。

### 检测器消融：New-off → New-on

- 正确率差：**-3.51pp**；95% CI **[-14.04pp, +7.02pp]**。
- 交付率差：0pp；95% CI **[-5.26pp, +5.26pp]**。
- Answer Plan 中 material decision proposal 的标签召回率从 4% 上升至 12%，精确率从 25% 上升至 60%，但绝对召回仍低。

进一步逐题取证发现：57 题内 New-on 仅 3 题登记 detector anomaly（`local096`、`local131`、`local156`），只有 `local096` 发生 interpretation context injection；三题在 New-off 与 New-on 中均为错误。8 个正确率不一致题均没有登记 anomaly。因此不能把 -3.51pp 点估计解释为检测器导致的退化，也不能把 decision proposal 指标的变化解释为检测器收益；本轮差异主要被独立模型采样、不同推理路径和 `local195` 未交付所混杂。

### 最终产品：Legacy → New-on

- 正确率差：**-1.75pp**；95% CI **[-8.77pp, +3.51pp]**。
- 交付率差：**+3.51pp**；95% CI **[-5.26pp, +14.04pp]**。
- 工具调用 +0.30%；token -4.32%；平均延迟 -1.06%；P95 延迟 -14.50%。

最终产品点估计在成本和交付上较好，但正确率 CI 下界未达到 -3pp 非劣门槛。

## 协议与披露观察

- New-off 和 New-on 各有 2 个 case trace 出现 `OPAQUE_REVISION_REQUIRED`：`new-off/local066`、`new-off/local074`、`new-on/local170`、`new-on/local210`。四次均是 `mode=result` **遗漏** `revisionId`，不是提交 raw hash 或 mixed handle。Runtime 全部正确拒绝；后三题重试恢复并发布，`local066` 后续虽取得 result candidate，但最终耗尽 turns 未发布。
- 已发布结果的披露逐件核对后，New-off 为 0/109 漏失，New-on 为 0/110 漏失，均通过零漏失要求。
- 先前报告的 4.39%/9.09% 是评测器口径错误：把未发布任务（没有交付、因此不存在交付披露义务）也计入披露漏失。评测器已修正为仅以合法发布的候选假设作为分母，并新增未发布候选不计漏失的回归测试。

## 结论

这 57 道共有题支持以下谨慎结论：

1. 新协议提升了交付点估计，且没有观察到明显成本膨胀。
2. 新协议和最终产品均**没有足够证据满足正确率非劣门槛**。
3. New-on 相对 New-off 的 -3.51pp 不能归因于检测器：所有 8 个 discordant case 都没有 detector anomaly；唯一 interpretation injection 题在两臂均错。
4. 已发布结果披露完整性满足零漏失要求；此前漏失结论是评测器分母 bug，现已更正。
5. opaque handle 的问题是模型偶发遗漏 revisionId，Runtime fail-closed 和多数重试恢复有效；仍需改善 schema/错误引导以减少无效调用。
6. 当前仍 **不批准灰度推广**，原因是正确率证据不足和实验设计受提前终止/单次随机采样限制，而不是披露失败或已证实的检测器退化。

## 限制

- 只有一次重复，未满足原方案三次配对要求。
- 运行因供应商余额失败而提前终止，交集不是完整的冻结留出集，存在选择偏差。
- 57 个 cluster 的置信区间仍较宽。
- API 实际金额未被 trace 记录，不能完成美元成本验收。

因此本报告可用于当前工程决策与问题定位，但不能替代原 Phase 6 的正式统计验收。
