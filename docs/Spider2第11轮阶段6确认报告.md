# Spider2 第 11 轮阶段 6 确认报告

> 状态：135 题确认运行完成，但准确率主门槛未通过。
> Run ID：`round11-full-confirm-fewshot-001`
> 模型：`deepseek-chat`
> 后端：SQLite
> 并发：3
> 日期：2026-09-03

## 1. 运行有效性

- 题目：135/135。
- 最终 manifest：`completed`，`infrastructureFailures=[]`。
- 使用冻结 baseline lock：`202379479ab3ee2b81d5a329c975a8ead7ab134edbd2ad8ed491622a515e26ba`。
- 有效提示词为 few-shot 版本，`systemPromptSha256=eeb6eb6309d54e7e8b9b6f7834559a9bd7f52362fd813197bc9593016f07c515`。
- 运行期间曾出现 `Connection error` 和 HTTP 413，均通过 resume 恢复；最终没有 provider_error 结果或基础设施失败。
- 预算：`timeoutMs=120000`、`maxTurns=20`、`maxToolCalls=50`、`maxExploratoryQueries=6`。

## 2. 官方结果

| 指标 | 结果 | 阶段参考 |
|---|---:|---:|
| SQL 覆盖 | 129/135（95.56%） | — |
| CSV 覆盖 | 129/135（95.56%） | ≥123/135 |
| SQL EX（提交分母） | 46/129（35.66%） | — |
| SQL EX（固定分母） | 46/135（34.07%） | — |
| E2E EX（提交分母） | 47/129（36.43%） | — |
| E2E EX（固定分母） | 47/135（34.81%） | 历史参考 55/135 |
| timeout | 24 | 观察项 |
| max_turns | 6 | 观察项 |
| 平均工具调用 | 24.21 | 观察项 |
| 平均耗时 | 88.14 秒 | 观察项 |

SQL 与 E2E 仅在 `local218` 上有 1 题差异：SQL EX=0、E2E EX=1。

## 3. 结论

1. **135 题答题和评分已完成。**
2. **CSV 交付门槛通过：129/135，高于 123/135。**
3. **准确率门槛未通过：E2E 为 47/135，距离 55/135 少 8 题。**
4. few-shot 不能据此进入默认提示词：40 题配对样本中它相对 hooks 仅净增 1 题；本次全量又没有同日同配置的 135 题 hooks 对照，不能把全量结果中的差异归因于 few-shot。
5. 本次结果不支持“通过 P6 准确率验收”，目标保持 active。

## 4. 与前序结果的可比性

计划中的第一轮 P6 报告记录为 E2E 44/135、CSV 119/135；按该记录，本次表面上为 `+3` 和 `+10`。但两次预算与执行条件不同：第一轮为 `timeoutMs=300000`、并发 1，本次为 `timeoutMs=120000`、并发 3；因此该差异不能作为 few-shot 或 Hook 的因果增益。

此外，`round11-full-c3-001` 当前运行目录的 manifest、summary、report 与 official score 存在不一致（分别出现 44/48 和 119/124 等记录），本报告不把该旧 Run 用作严格统计对照，只引用已归档阶段报告的趋势值。

## 5. Hook 与异常机制分析

### 5.1 过度触发已明显收敛

本次仅登记 5 条异常，涉及 4 题，产生 4 次解释 Hook 注入，预算守卫跳过 0 次；没有第一轮 P6 的 `count_distinct_divergence` 大规模触发。相比第一轮归档的 43 条异常、41 次解释注入，说明 D2 前置条件、A/B 分级和每题一次周期限制生效。

| 检测器 | 题目 | 级别 | E2E | 结果状态 |
|---|---|---|---:|---|
| `join_fanout` | `local055` | A | 1 | completed |
| `physical_bound_violation` | `local070`、`local072` | B | 0、1 | timeout、completed |
| `fingerprint_unchanged` | `local070` | B | 0 | timeout |
| `null_like_member_in_filter` | `local096` | B | 0 | timeout |

其中只有 1 题属于 A 级 `join_fanout`；样本太小，不能据此重新估计检测器收益。`physical_bound_violation` 和 `null_like_member_in_filter` 触发了固定脏数据解释分支，共贡献 3 次解释周期中的相关路径；`local070`、`local096` 最终未得分，但不足以证明是 Hook 导致。

### 5.2 主要剩余问题是运行限制，不是异常爆炸

- 24 题 timeout 中有 21 题已经生成 CSV；6 题 max_turns 中有 5 题已经生成 CSV。
- 6 个未发布题为：2 题 `not_published_no_export_call`，4 题 `not_published_provider_error`。
- 4 个 `not_published_provider_error` 同时对应 3 个 timeout 和 1 个 max_turns，说明这些题既出现过 provider failure 信号，又以运行限制结束；当前发布状态分类仍有优先级混淆。
- 仅 6/135 题没有 CSV，故覆盖问题已明显小于准确率问题；但 timeout 率 24/135 仍然过高，且受 120 秒预算影响明显。

## 6. 阶段判定与后续

| 项目 | 判定 |
|---|---|
| 135 题运行完成 | 通过 |
| 基础设施失败 | 通过，最终为 0 |
| CSV 覆盖 ≥123/135 | 通过 |
| E2E ≥55/135 | 未通过，47/135 |
| few-shot 全量优于 hooks | 无法由本次单臂全量确认 |
| P6 整体 | 未通过准确率验收 |

按修复计划，下一步不整体回退，应继续做逐 Hook/运行限制归因：优先拆分 timeout 后已导出与未导出路径，修正 `provider_error` 与 `timeout/max_turns` 的发布标签优先级；随后再决定是否需要在统一预算下重跑同日 control/hooks 对照。当前不将 few-shot 设为默认效果，也不关闭目标。
