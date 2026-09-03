---
status: accepted
---

# 自由 SQL 采用有界确定性门控而非通用语义证明

本 ADR 补充 ADR-0001。自由 SQL Query Assurance 只让证据前提合格、Query Digest 覆盖充分且机器可判的规则产生确定性观测；默认动作由 ADR-0003 规定为告知，完整性和必然零分形状除外。每个门都声明版本化适用范围。查询明确在门外时记录 `not_applicable`，不得声称已检查；查询位于支持范围内但缺少必需 Digest、lineage 或 Probe 时记录 Review Unavailable。Agent 只提交候选并最多修复一次，Answer Spec、谓词授权、Probe、候选失效和发布权全部由可信 Runtime 管理。

## Considered Options

- 对任意复杂 SQL 一律要求完整确定性证明：覆盖能力不足时会让 Data Agent 大量无法交付，并把 parser 局限误写成业务错误。
- 将未支持查询静默放行：会把“没有检查能力”伪装成“已通过”。
- 继续依赖 Solver verification/reconciliation：既有 Spider2 样本表明它经常只能证明候选自洽，不能获得裁决权。

## Consequences

- 首版只承诺阻断违反 Hard Answer Contract 的形状、确定性未授权总体缩减、可证明的 JOIN fanout，以及未实质修复的被反证候选。
- 复杂业务口径仍由 Evidence Authority、用户澄清、Conversation-Blind Reviewer 和 Delivery Policy 处理。
- 必需确定性覆盖不可用时应记录为 `unavailable` 或 `inconclusive` 并披露；不得伪装成 Approved。完整性或必然零分形状的硬阻断按 ADR-0003 执行。
- 门按规则和 SQL 方言分别校准、启用与回滚；校准缺失不再默认 fail-closed，不按单题关闭规则。
