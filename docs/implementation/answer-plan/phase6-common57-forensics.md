# Phase 6 共有 57 题专项取证

日期：2026-09-09  
范围：DeepSeek `legacy-r1` / `new-off-r1` / `new-on-r1` 的 57 个共同 `instanceId`；不新增模型/API 调用。

## 1. 候选假设披露“漏失”

### 结论

**已发布结果中没有候选假设披露漏失。**

- New-off：0/109。
- New-on：0/110。

先前报告的 New-off 5/114、New-on 11/121 是评测器分母错误，不是 Runtime 交付缺陷。旧实现以最后一次 `update_answer_spec` 的全部 candidate hypothesis 为分母，包括最终没有发布的任务；这些任务没有产生 DeliveryEnvelope，因此没有交付披露义务。

被错误计为漏失的任务：

- New-off：`local066`（max turns，未发布，2 条）、`local070`（无 export，1 条）、`local073`（无 export，2 条）。
- New-on：`local070`（无 export，1 条）、`local073`（无 export，5 条）、`local195`（max turns，2 条）、`local201`（provider error，1 条）、`local220`（provider error，2 条）。

### 修复

- `phase6-evaluate.mjs` 与 `phase6-partial-intersection.mjs` 仅在 `published_approved` / `published_with_disagreement` 且存在最终 SQL/CSV 时累计披露分母与漏失。
- Legacy 没有新 Disclosure 合同，报告为 N/A，而不是 100% 漏失。
- `phase6-evaluate.test.mjs` 新增“未发布 candidate hypothesis 不计为披露漏失”的回归断言。

## 2. Opaque revision handle 误用

### 精确事件

| Arm/case | 误用 | 后续结果 |
|---|---|---|
| New-off `local066` | 第一次 `mode=result` 遗漏 `revisionId` | Runtime 拒绝；随后使用 revision `3` 成功预览，但最终 max turns 未发布 |
| New-off `local074` | `mode=result, deliverIfEligible=true` 遗漏 `revisionId` | Runtime 拒绝；下一次带 revision `3` 成功并发布 |
| New-on `local170` | 第一次 `mode=result` 遗漏 `revisionId` | Runtime 拒绝；后续修正 SQL并带 revision `3`，成功发布 |
| New-on `local210` | 第一次 `mode=result` 遗漏 `revisionId` | Runtime 拒绝；下一次带 revision `3` 成功并发布 |

四次事件都不是 hash 泄露、raw revision 或新旧 handle 混用，而是模型漏传必填的条件字段。Runtime 的 fail-closed 行为正确，3/4 任务最终恢复发布。

### 根因

`query_database` 同时承载 exploration 与 result；其 JSON schema 将 `revisionId` 定义为 optional，因为 exploration 必须省略它。模型仅靠描述理解“result 时必填”，因此有偶发遗漏。

### 修复

- 为 `mode` 和 `revisionId` 添加模型可见的条件说明。
- `RESULT_OPAQUE_REVISION_REQUIRED` 错误加入当前 opaque revision 提示，并明确禁止 `specRef/hypothesisRefs/selectedDecisionRefs`。
- 增加遗漏 revision 的确定性回归测试；原有 mixed/forged binding 拒绝测试继续保留。

进一步把 schema 改成 discriminated union 或拆成两个工具可能更强，但会改变公开工具合同，当前不在无额外迁移验证下采用。

## 3. New-on 相对 New-off 的正确率差

共有 8 个 discordant case：

- New-on 改善（0→1）：`local059`、`local130`、`local209`。
- New-on 退化（1→0）：`local065`、`local077`、`local097`、`local195`、`local219`。

逐 trace 取证：

1. **8 个 discordant case 均无 registered detector anomaly。** 因此没有证据把它们的 SQL 差异归因于检测器警报或 interpretation injection。
2. 57 题中仅三个 New-on case 有 anomaly：
   - `local096`：`null_like_member_in_filter`，且发生两次 interpretation context patch；两臂均错。
   - `local131`、`local156`：`join_fanout`；两臂均错。
3. 唯一实际发生 interpretation injection 的 `local096` 没有改变官方正确性。
4. `local195` 的 New-on 为 max-turn/no-publication，属于可交付性差异，不是已观察到的错误 SQL 修正。
5. 其余 7 个 discordant case 都正常发布，但采用不同 SQL/口径；在独立随机模型运行中，这属于模型采样与推理路径差异。单次每题运行不能分离开关因果效应。

### 对先前结论的更正

- `-3.51pp` 是 New-on 与 New-off 的单次点估计，**不是已证实的检测器退化**。
- 所谓歧义召回 4%→12% 来自 Answer Plan 的 material decision proposal，不是 detector hit 指标；在本轮独立采样下也不能直接归因于检测器。
- 三个真正 detector-hit case 的净正确性变化为 0，但样本太少，不能证明检测器有效或无害。

## 4. 错误题中的检测器漏检与能力缺口

这里把“应该命中”分为两类：**已有规则按设计应能发现但因覆盖不足漏掉**，以及**需要新增规则/结构化合同才能发现**。不能把所有错误 SQL 都归为检测器漏检。

### 4.1 已有规则的高置信漏检：`local114`

这是本轮最明确的现有规则漏检：

- 题目要求每个 region 的订单数；New-on 输出为 Midwest/Northeast/Southeast/West：`897/2357/2024/1634`，官方结果为 `9/21/10/10`。
- 同一 SQL 的 region 销售额与官方结果一致，说明问题集中在订单计数被连接粒度放大，而不是总体筛选。
- 候选 SQL 在 `web_region → web_sales_reps → web_accounts → web_orders` 多表连接后使用 `COUNT(o.id)`，应至少做订单键去重或执行 count-vs-count-distinct 证据检查。
- trace 已调度 `observed_join_fanout`，但结果为 `unsupported / JOINS_COVERAGE_UNSUPPORTED`，最终没有 anomaly。结论：这是 **JOIN coverage 不足导致的 detector false negative**，不是 detector 未定义风险。

### 4.2 结构化输出合同缺失导致的漏检

以下错误都可由已有 `shape_mismatch` / `intermediate_candidate` 在 AnswerSpec 具备硬输出合同时发现，但本轮模型只提交了自由文本七槽位 `output`，`answerContract` 均为空；因此 G1 在 trace 中全部为 `not_applicable`：

- `local060`：官方应为 4 行×2 列，实际 14 行×4 列。
- `local063`：官方为单值，实际 2 列。
- `local064`：官方为单值 `balance_diff`，实际 5 列。
- `local065`：官方为单值 `142`，实际 12 行×5 列明细；同时属于缺少最终聚合的 `intermediate_candidate`。
- `local131`：官方为每种风格的三个独立计数列，实际为一个合计列且包含额外零行。
- `local141`：官方 6 列，实际 5 列，缺少 quota year。
- `local194`：按官方 evaluator 为 3 行×2 列，实际 600 行×3 列。
- `local212`：官方只交付 driver_id，实际额外输出平均值列。
- `local219`：官方 2 列，实际额外输出 wins 列。

这些是 **contract coverage gap**；不是 SQL 执行器无法判断，而是结构化输出计划没有进入 Runtime gate。

### 4.3 需要新增规则的高置信语义漏检

- `local064`：只从 `ym_trans` 中有交易的客户计算平均值，遗漏无交易客户；属于 denominator/entity-population coverage，现有 `entity_population_mismatch` 只支持有限的 fact/entity 证据，未覆盖这种全体客户补全集。
- `local077`：没有冻结 `2018-09` 至 `2019-08` 的结束边界，且结果只有 4 行而官方为 12 行；需要时间窗口完整性/连续期间覆盖规则。
- `local170`：返回 34 个州，官方为 25 个；需要 cohort-set completeness / set-difference 规则。
- `local219`：`team_league` 只从 `home_team_api_id` 建立候选队伍，遗漏只作为客队出现的队伍；除输出合同外还需要 home/away union 的人口集合检查。
- `local097`、`local098`、`local167`、`local168`、`local169`、`local171`、`local196`：主要是年份解析、边界、指标公式或分母语义错误；当前 detector 没有足够的业务语义/金标准证据，不能诚实地称为现有规则漏检。

### 4.4 已命中但没有形成可行动结论的题

- `local131`、`local156`：都有 `join_fanout: inconclusive`，原因是探针预算/coverage 不足，不是完全没命中。
- `local096`：已命中 `null_like_member_in_filter`；命中没有修复错误，不代表漏检。
- `local066`、`local070`、`local073`、`local195`、`local201`、`local220`：没有可完成的最终候选或受到 max-turn/provider error 影响，不能进行语义 detector 的事后归因。

## 5. 当前决策

- 披露合同：本 57 题的已发布结果通过零漏失要求。
- Opaque handle：Runtime 安全性正确，模型易用性已做最小修复。
- 检测器：`local114` 暴露了现有 JOIN coverage 的明确缺口；结构化 output contract、人口集合和连续时间窗口是下一批优先级。
- 没有证据支持将 New-on 的总体点估计下降归咎于检测器；同时也没有效果证据支持默认开启。
- 建议继续以 New-off 作为候选默认配置；New-on 保持 shadow/关闭自动 interpretation，直到补齐上述确定性 fixture 并经预算批准进行重复配对试验。
