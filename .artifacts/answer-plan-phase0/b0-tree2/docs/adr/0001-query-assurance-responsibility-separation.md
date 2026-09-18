---
status: accepted
---

# 自由 SQL 查询采用职责分离的 Query Assurance

自由 SQL 路径不再依赖 Solver 自报合同和自助 reconciliation 作为语义正确性依据。系统采用共享的 Query Assurance 核心：Answer Spec 区分 Hard Constraint、Hypothesis 与 Ambiguity；确定性 Query Digest 描述 SQL；Conversation-Blind Reviewer 不读取 Solver 对话；Review Outcome 与实际发布通过 Artifact、Spec、Schema Evidence 和 Review Token 绑定。产品与 Spider2 共用审查核心，但分别采用 require-confirmation/fail-closed 和 submit-with-disagreement 的 Delivery Policy。

## Considered Options

- 继续增加同一 Solver 上下文中的清单、verification 和 reconciliation：已在 Spider2 第 5、7 轮证明只能形成自洽检查，无法可靠发现首因误读。
- 用 LLM Back-translation 作为语义 ground truth：存在有损转译和错误相关性，只保留为可选 shadow 证据。
- 用不可变 planner Spec 直接阻断：会把推断错误固化为系统错误，因此只有权威证据可生成 Hard Constraint。
- 两次拒绝后 fail-open：会发布已知分歧，明确拒绝。

## Consequences

- 所有自由 SQL 用户可见交付，包括少量内联结果和 CSV，都需要 Publication Receipt；KTX 语义查询不进入该 SQL Reviewer。
- Enforced Review 必须经过 Review Calibration，并在模型、prompt、parser、Digest 或政策版本变化后重新校准。
- 产品在 unresolved disagreement 时需要用户确认能力，否则只能 shadow 或严格 fail-closed。
- Query Assurance 增加延迟、成本和审计状态，但换取独立证据、可弃权裁决、明确覆盖范围和可回滚的阻断权。
