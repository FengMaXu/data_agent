# Query Assurance 架构设计 V2

## 1. 文档状态

- **状态**：当前规范设计
- **适用范围**：Data Agent 自由 SQL `query_database` 路径
- **历史提案**：`docs/Spider2语义错误架构级解法-从自我验证到职责分离.md`
- **审阅依据**：`docs/Spider2语义错误架构级解法审阅意见.md`
- **领域语言**：根目录 `CONTEXT.md`
- **有界门控增量**：`docs/Spider2语义收敛方案-证据资格与确定性门控.md`
- **补充决策**：`docs/adr/0002-bounded-deterministic-query-gates.md`

原始架构方案和审阅意见作为历史证据保留。本文件记录 grill-with-docs 访谈确认后的规范设计；有界确定性门控以增量 RFC 和 ADR-0002 为准。

## 2. 顶层目标

目标不是证明自由 SQL 正确，而是在用户可见交付前，用权威证据、确定性 Query Digest、有界确定性门和 Conversation-Blind Review 发现可证实的语义分歧。

系统必须：

1. 明确 Review Coverage 与每个确定性门的适用范围；
2. 允许 reviewer 弃权，并区分 `not_applicable` 与支持范围内的 `unsupported`；
3. 将审查结果绑定到被审查的查询和实际发布结果；
4. 区分确定性拒绝、语义拒绝、审查不可用和基础设施失败；
5. 根据产品或评测环境采用显式 Delivery Policy；
6. 永远不把“未发现分歧”或“没有检查能力”描述为“已证明正确”。

`Approved` 的规范含义是：

> 在当前 Answer Spec、Schema Evidence、Query Digest、Review Coverage 和 reviewer 能力范围内，未发现阻断级分歧。

## 3. 范围与非目标

### 3.1 包含

- 自由 SQL 查询的题意解释；
- SQL 与 Answer Spec 的结构、粒度和语义对齐；
- 少量内联结果和 CSV 导出的统一发布审查；
- 产品与 Spider2 共用的 Query Assurance 核心；
- 违反 Hard Contract 的形状、确定性未授权总体缩减、可证明 fanout 和未实质修复候选的有界门控；
- 不同环境的 Delivery Policy；
- Shadow Review、Enforced Review、Review Calibration 和运行时熔断。

### 3.2 不包含

- KTX 语义查询路径的重复 SQL 审查；
- 使用 Spider2 Gold 作为运行时证据；
- 证明任意 SQL 业务语义绝对正确；
- 要求任意复杂 SQL 在首版获得完整确定性门覆盖；
- 将一次用户纠正自动写成全局业务规则；
- 在首期启用 N-version 双 Solver；
- 通过 LLM 回译替代确定性 SQL AST。

KTX 路径继续使用其语义模型、批准字段和 semantic-layer validation。两条路径可共享 Publication Status/Receipt 概念，但不共享自由 SQL Reviewer。

## 4. Evidence Authority

发生冲突时，证据按以下顺序解释：

1. 用户明确说明或澄清；
2. 已审核业务定义或语义模型；
3. 题目附带业务文档中的明确规则；
4. 题目字面的明确约束；
5. Schema 正式结构约束，但只约束结构事实；
6. 数据探查证据；
7. planner、Solver 或 reviewer 的模型推断。

Spider2 Gold 只用于离线评分和事后标签，不能进入 Answer Spec、Query Digest 或 Reviewer 输入。

## 5. 总体架构

```text
Question + Clarification + Reviewed Models + Task Docs + Schema
                              │
                              ▼
                       QueryAssurance
                  prepareTask(task evidence)
                              │
                              ▼
                        Answer Spec
       Hard Constraints / Hypotheses / Ambiguities
                              │
                              ▼
Solver ── query_database ──► Validated Query Artifact
                              │
                              ▼
                     QueryDigestCompiler
                  AST + Schema Evidence
                              │
                              ▼
                 Hard/Structural Preflight
                              │
                              ▼
                     Private Candidate
             exact result metadata, not yet published
                              │
                              ▼
                Conversation-Blind Reviewer
                              │
                              ▼
                        Review Outcome
      Approved / Rejected / Needs Clarification / Abstained
                   or Review Unavailable
                              │
                              ▼
                       Delivery Policy
                              │
                              ▼
             Publication Receipt or no publication
```

## 6. 主 seam

调用者只依赖顶层 `QueryAssurance`，不直接管理 planner prompt、AST parser、Reviewer、缓存或 token。

```ts
interface QueryAssurance {
  prepareTask(
    input: TaskEvidence,
    signal: AbortSignal,
  ): Promise<PreparedQueryTask>;

  reviewForPublication(
    input: PublicationReviewRequest,
    signal: AbortSignal,
  ): Promise<ReviewOutcome>;
}
```

内部 seam 包括：

- `AnswerSpecGenerator`；
- `SpecAuthority`；
- `QueryDigestCompiler`；
- `InvariantProbeRegistry`；
- `ConversationBlindReviewer`；
- `ReviewCache`；
- `DeliveryPolicy`；
- `AssuranceAuditStore`。

这些是 `QueryAssurance` 的内部实现，不应扩散到 `agent-assembly.ts` 的调用界面。

## 7. Query Task

一个需要自由 SQL 回答的用户请求对应一个独立 `taskId`：

```text
一个 Query Task
= 一个用户数据库请求
= 一个 Answer Spec 版本链
= 多个 Validated Query Artifact
= 一条 review/repair 历史
= 最多一个最终 Publication Status
```

`sessionId` 仅表示聊天会话。一个会话可以包含多个 Query Task，不能继续用“最后成功 SQL”隐式表示当前任务。

Query Task 在路由器判定进入自由 SQL 路径后、第一次数据库调用前创建。KTX 路径不创建 Query Assurance Task。

生命周期状态由 Runtime 根据权威产物派生，不接受 Solver 修改：

```text
spec_pending
→ exploration
→ candidate_review
→ repair_available / awaiting_clarification / awaiting_authorization
→ published / closed_without_publication
```

不新增 Solver-facing task 状态工具。

## 8. Answer Spec

### 8.1 结构

```ts
interface AnswerSpec {
  taskId: string;
  specVersion: string;
  hardConstraints: HardConstraint[];
  hypotheses: Hypothesis[];
  ambiguities: Ambiguity[];
  conflicts: ConflictRecord[];
  provenance: EvidenceReference[];
}
```

Evidence Reference 必须可验证，而不只是自由文本来源：

```text
evidenceId
sourceKind / sourceIdentity
sourceRevision or fingerprint
locator
quotedValue or contentHash
authority
capturedAt
```

Answer Contract 的输出模式统一为 `scalar | top_n | grouped | detail`，行数使用可选 `{exact,min,max}`。输出列同时表示 semantic role 和可选 label/type/position；只有权威证据明确要求的展示属性才成为 Hard Constraint。

Measure/Population Contract 分槽表示计数或度量实体、source grain、aggregation、distinct、numerator/denominator、NULL、零分母、unit 和 rounding。每个槽位独立携带 hard/hypothesis/ambiguity 与 provenance，不能用数据基数反向创造业务口径。

### 8.2 Hard Constraint 准入

首版可以直接生成 Hard Constraint 的来源为：

1. 用户明确说明或澄清；
2. 已审核的结构化业务定义或语义模型；
3. 从任务文档或请求原文中确定性提取、且引用可验证的明确约束；
4. Schema 正式结构约束，但只能约束结构事实。

需要语义解释的题目或文档内容、字段名推断、权威总体选择、分母解释和孤儿键处理必须先进入 Hypothesis 或 Ambiguity。未独立校准的 LLM Spec 组件不能把自己的蕴含判断晋升为 Hard Constraint。

### 8.3 Spec 演进

Solver 不能修改 Answer Spec，只能提交引用可信 `evidenceId` 的 `SpecChangeProposal`。

- Spec Authority 从 Evidence Store 重新读取证据并自行确定 authority，忽略 Solver 自报级别；
- 合格 Proposal 产生新的 Answer Spec 版本；
- 正式权威证据出现时，Spec Authority 可以确定性晋升约束；
- 数据探查只能更新 Physical Mapping/Cardinality Evidence，不能创建业务 Hard Constraint；
- 模型解释只能保留为 Hypothesis 或转成 Ambiguity；
- 用户澄清可以生成 Hard Constraint 和新 `specVersion`；
- 每次变更必须记录可验证引用、证据版本和原因。

一次用户纠正只对当前 Query Task 直接生效。跨任务复用时只能生成 `BusinessDefinitionProposal`，经过业务审核后才能进入已审核语义模型或业务知识。

### 8.4 冲突结果

| 冲突对象 | 默认 Review Decision |
|---|---|
| Hard Constraint | Rejected |
| 已解决 Ambiguity | Rejected |
| 未解决 Ambiguity | Needs Clarification |
| Hypothesis | Warning 或 Needs Clarification |
| Reviewer 新发现但证据不足的问题 | Abstained 或 Warning |

低置信度 Hypothesis 不具备隐式否决权。

## 9. Query Digest

Query Digest 是由 SQL AST 和 Schema Evidence 生成的确定性结构描述，至少包含：

```text
tables
joins
aggregates
groupBy
filters
projections
outputLineage
windowPartitions
windowFrames
orderBy
limit
setOperations
nullHandling
```

每个 Digest 必须携带：

```text
dialect
parserVersion
queryDigestVersion
coverage
unsupportedNodes
lineageCompleteness
schemaEvidenceFingerprint
```

### 9.1 Parser 所有权

Data Agent 平台层提供共享 `sqlglot` 基础设施。可以复用现有受管 Python 分发物及固定版本，但自由 SQL 路径不调用 KTX Semantic MCP，也不依赖 KTX 语义查询是否可用。

`QueryDigestCompiler` 保持可替换 seam。

### 9.2 门适用范围与解析失败

每个确定性门必须声明版本化 Gate Applicability Contract：

- 查询明确不属于该门支持类别时记录 `not_applicable`，不得声称该 facet 已检查，并继续其他门与 Delivery Policy；
- 查询属于支持类别，但必需方言节点、Digest facet 或 lineage 无法产生时记录 `unsupported`，形成 Review Unavailable；
- 不用正则、回译或 tokenizer 降级结果伪装成完整 Digest；
- 只有必需 facet 为 `checked` 时，Query Digest 才能支持相应硬门通过；
- parser、规则和方言分别校准，某一方言达标不能授权另一方言。

因此，门外的复杂 SQL 不因该门而被阻断；门内解析失败也不能被 Reviewer 或用户授权包装成已通过。

## 10. Validated Query Artifact

`query_database` 返回内部使用的 Validated Query Artifact：

```ts
interface ValidatedQueryArtifact {
  taskId: string;
  queryArtifactId: string;
  normalizedSqlHash: string;
  schemaEvidenceFingerprint: string;
  previewMetadata: ResultMetadata;
  dataSnapshot?: string;
  createdAt: string;
  expiresAt: string;
}
```

Artifact 的查询数据属于 `Internal Evidence`，对 Solver 可见但不自动获得用户可见交付权。

系统保存所有 Artifact 的身份和元数据；原始预览行只保留最近有限数量并采用短 TTL。TTL 到期后不能发布，必须重新执行。不得继续使用“最后成功 SQL”作为身份。

## 11. 统一发布接口

首期工具面：

```text
query_database
  → 返回 queryArtifactId

publish_query_result(queryArtifactId)
  → 审查并发布少量内联结果

export_query(queryArtifactId, filename)
  → 兼容包装，审查并发布 CSV
```

`expected_rows/expected_columns` 不再由 Solver 提交，也不具有裁决权：

1. Export Candidate 的列完整性只与 Validated Query Artifact 的预览列比较，确保发布的仍是同一结果；
2. Shape Constraint 只来自 Answer Spec，并由 G1 独立检查；
3. 空或缺失的 Hard Output Contract 表示语义列约束未知，不表示 `expected []`；
4. Candidate 身份检查与 Answer Contract 语义检查不得共用同一个字段。

最终自然语言数据结论必须引用 Publication Receipt。若 Query Task 存在但没有可发布 Receipt，harness 不允许把任务作为成功数据回答结束，而应进入 `delivery_required`、澄清或失败说明。

## 12. 执行与发布流水线

```text
1. Spec Authority 准备当前 Answer Spec
2. Read-only / SQL safety gate
3. 执行内部预览，产生 Validated Query Artifact
4. Solver 将精确 queryArtifactId 交给 publish/export
5. 方言感知 Query Digest 编译与 Gate Applicability 判定
6. G1–G4 有界确定性门
7. 生成并完整物化私有 Export Candidate 或内联候选
8. 最终结果结构、身份和元数据检查
9. Conversation-Blind Review
10. Delivery Policy
11. 原子发布同一 Candidate，产生 Publication Receipt
```

不新增 Solver 可修改的 task 工具，也不新增公开 Candidate 提交工具；`publish_query_result/export_query` 在内部完成 Artifact 晋升。普通探索 Artifact 默认没有发布资格。

### 12.1 Export Candidate

完整结果先流式写入用户不可见的 Export Candidate，再收集准确元数据并审查：

- Approved 或获得合法 Publication Authorization 后，原子发布同一份结果；
- 未发布 Candidate 在审查结束后立即删除；
- 取消、失败或 token 失效时必须删除；
- 不通过“审查后重新执行”生成另一批结果。

### 12.2 并发不变量

1. 一个 Artifact 最多产生一个成功 Publication Receipt；
2. 同一 taskId 同时只允许一个活动发布；
3. Review Token 单次消费；
4. 重复请求返回原 Receipt，不重复执行；
5. Spec 版本变化使旧 Review Token 失效；
6. 原子发布失败不得留下半文件。

## 13. Conversation-Blind Review

Reviewer 可以看到：

- 用户问题与澄清；
- Answer Spec；
- Schema slice 与正式关系证据；
- 规范化 SQL；
- Query Digest；
- 结果列、类型、行数、截断状态；
- NULL、min/max、distinct count 等必要统计摘要。

Reviewer 不能看到：

- Solver 对话；
- Solver 推理；
- Solver 自述；
- Solver 对普通探索查询的自证结论；
- Gold。

原始结果行默认不发送。只有数据策略明确允许时才发送脱敏样本。

### 13.1 Reviewer 输出

```ts
type ReviewDecision =
  | { status: "approved"; warnings: ReviewWarning[] }
  | { status: "rejected"; diffs: SemanticDiff[]; retryable: boolean }
  | { status: "needs_clarification"; ambiguities: Ambiguity[] }
  | { status: "abstained"; reason: string };

type ReviewOutcome =
  | { availability: "available"; decision: ReviewDecision }
  | { availability: "unavailable"; failure: ReviewFailure };
```

Provider timeout、非法结构和证据缺失不能转换为 Approved。

### 13.2 Semantic Diff

Rejected 时只向 Solver 返回结构化 Semantic Diff：

```json
{
  "aspect": "top_n_partition",
  "required": "全局 Top-3",
  "observed": "按 actor 分区的 Top-3",
  "evidence": {
    "constraintId": "HC-04",
    "digestPath": "windows[0].partitionBy"
  }
}
```

Semantic Diff 可以说明差异和证据位置，但不能生成替代 SQL或输出 Reviewer 推理链。无合法证据引用的 diff 不能阻断。

### 13.3 Review Coverage

标准覆盖维度：

```text
projection
grain
measure
population
join_cardinality
time_filter
time_window
ranking_partition
tie_policy
unit
rounding
entity_resolution
null_handling
```

每个维度记录：

```text
checked
not_applicable
unsupported
insufficient_evidence
```

新增维度必须更新 `reviewCoverageSchemaVersion`。

### 13.4 Confidence

- `reviewerScore`：模型原始分数，只用于调试；
- `calibratedConfidence`：历史 Calibration 中同类判断的实际准确率；
- `reviewCoverage`：本次实际检查内容。

Calibration 完成前不向产品用户展示数值 confidence。

## 14. LLM Back-translation 与 N-version

### 14.1 Back-translation

- Query Digest 必经；
- Conversation-Blind Reviewer 在 shadow 或 enforce 中运行；
- LLM Back-translation 首期只作为 shadow 辅助证据；
- Digest 解析失败时，回译可以帮助发现问题，但不能单独产生 Approved。

### 14.2 N-version

N-version 不属于首期 P1 承诺。只有同时满足以下条件时才进入特定高风险类别实验：

- 基础 Query Assurance 已完成 Calibration；
- 某类问题仍存在明显低 recall；
- 异构求解的错误相关性显著更低；
- 正确题提升能够覆盖成本。

两个 Solver 结果一致只能作为支持证据，不能直接等同于正确。

## 15. 有界确定性门与 Invariant Probe

确定性门只在版本化 Gate Applicability Contract 的支持范围内获得阻断权：

- **G1 形状合同门**：最终聚合、行列形状、输出角色、Top-N、排序和额外列；
- **G2 总体影响授权门**：有确定性证据证明的未授权总体缩减；
- **G3 粒度/基数门**：Hard Measure/Population Contract 下可证明的 JOIN fanout 与度量传播破坏；
- **G4 候选反证门**：失败候选及未针对失败 claim 发生实质变化的重提。

阻断型探针由 Runtime 的版本化模板创建，不接受 Solver 提交的执行 SQL或 `blocking` 标记：

```ts
interface ProbeTemplate {
  id: string;
  version: string;
  requiredEvidence: EvidenceRequirement[];
  claimKind: string;
  evaluate(input: ProbeInput): ProbeOutcome;
}
```

```ts
type ProbeOutcome =
  | { status: "passed"; evidence: ProbeEvidence }
  | { status: "failed"; evidence: ProbeEvidence }
  | { status: "not_applicable"; missing: string[] }
  | { status: "unsupported"; reason: string }
  | { status: "inconclusive"; reason: string };
```

阻断权由 Gate Policy 根据 Hard Contract、正式 Schema 或同快照观测证据派生；Probe Outcome 本身不携带 blocking。Hypothesis 前提只能被 Probe 否定或形成 warning，不能自动确立另一业务口径。

语义粒度与物理基数分开：Measure/Population Contract 说明应该统计什么，Cardinality Evidence 说明当前关系的唯一性、覆盖率和 fanout。没有前者时，行数增加不能自动判错。

首版 JOIN 守恒只覆盖 Query Digest lineage 完整、计数或度量实体已有 Hard Contract、且正式约束或同快照 Probe 可以证明传播破坏的 `COUNT/SUM/AVG`。其他复杂 JOIN 对 G3 记录 `not_applicable`；属于支持类别但必需 lineage/Probe 不可用时形成 Review Unavailable。

从 Solver-facing 工具中移除 verification/reconciliation 模式。普通探索查询结果可以形成 observed data proposal，但不能满足 Runtime Probe 或获得裁决权。

## 16. Delivery Policy

### 16.1 产品

- Approved：正常发布；
- Rejected：允许一次 Automatic Semantic Repair；
- Needs Clarification：请求用户澄清；
- Abstained：提示证据不足并请求澄清；
- G1–G4 不可豁免失败：不发布；
- 必需 Digest/Probe unavailable：不发布，且 Publication Authorization 不能绕过；
- 确定性门全部通过但 LLM Reviewer unavailable：fail-closed；
- 无确认能力时只能 Shadow Review，或明确配置严格 fail-closed。

### 16.2 Spider2

- Approved：`published_approved`；
- 持续 Semantic Disagreement：可以 `published_with_disagreement`；
- 确定性门全部通过但仅 LLM Reviewer unavailable：可以提交，但不得记录 Approved；
- 不可豁免门失败或必需 Digest/Probe unavailable：不提交；
- Gold 只用于离线评分和事后标签。

### 16.3 Publication Status

```text
published_approved
published_with_disagreement
not_published_rejected
not_published_review_unavailable
```

不新增 `pass/qualified` 平行领域状态。Query Task 可以有等待澄清或等待授权的生命周期状态，但不替代 Review Decision、Review Outcome 和 Publication Status。

### 16.4 Publication Authorization

用户“仍然发布”只授权一个具有已披露 Semantic Diff 的精确候选，绑定：

```text
taskId
queryArtifactId
normalizedSqlHash
specVersion
semanticDiff hashes
candidate result identity
```

用户澄清会产生新的 Answer Spec 版本；Publication Authorization 不修改 Spec。机械门失败、证据伪造、Candidate 身份错误或必需确定性覆盖不可用不能授权。确认界面必须支持修改查询、补充业务说明、仅发布当前候选和取消。

## 17. 自动修复

同一 `specVersion` 下最多一次 Automatic Semantic Repair：

1. 第一个完整 Candidate 被确定性门或语义审查拒绝；
2. Solver 一次性收到全部 violation/Semantic Diff；
3. Solver 生成新 Artifact；
4. 新 Artifact 必须改变与失败 claim 相关的 Semantic Fingerprint，并重新审查；
5. 再次未通过则进入 Delivery Policy，不再自动修复。

换别名、改格式或重排无关 CTE 不算实质修复。用户澄清或权威证据导致 `specVersion` 变化后，修复额度重置；Solver 自行改写 Hypothesis 不得重置。TTL 过期、事务回滚和明确基础设施失败不消耗语义修复额度。

## 18. 安全与隐私

- SQL 解析前移除非语义注释；
- 问题、Schema、SQL、统计摘要分别进入结构化字段；
- 数据库内容一律标记为不可信数据；
- Reviewer 输出使用严格 JSON Schema，并禁止未知字段；
- 非法输出最多做一次基础设施重试；
- 原始结果行默认不发给 Reviewer，也不写入 Audit Record；
- 未发布 Candidate 审查结束后立即删除；
- 调试环境保留候选时必须显式开启短 TTL；
- Review Token 与缓存不能包含数据库凭据。

## 19. 缓存与版本

Review cache key 至少包含：

```text
task/question hash
Answer Spec schema/version
Evidence Admission Policy version
schemaEvidenceFingerprint
normalizedSqlHash
queryDigestVersion
parser engine/version/dialect
Gate Policy and Applicability Contract version
Probe Template version
reviewerModel
reviewerPromptVersion
reviewPolicyVersion
reviewCoverageSchemaVersion
Delivery Policy version
```

任一影响裁决的版本变化后必须重新审查。产品 Enforce 使用持久化、追加式 Query Task Store；内存实现仅用于测试、开发和 Shadow。状态无法恢复时 fail-closed，不重新推断 Approved。

有界门控增量采用 schema major 断代升级：部署前排空或关闭在途 Query Task，旧 Review Token、Authorization 和未发布 Candidate 全部失效；已发布 Receipt 只作为历史审计保留。禁止新旧节点混合裁决或运行时 fallback。

## 20. Assurance Audit Record

每个候选记录：

```text
taskId
queryArtifactId
sqlHash
Answer Spec schema/version
Evidence Admission Policy version
schemaEvidenceFingerprint
queryDigest/parser/dialect version
Gate Policy and Applicability Contract version
Probe Template/version/outcomes
reviewerModel/promptVersion
reviewPolicyVersion
reviewAvailability
ReviewDecision
ReviewCoverage
SemanticDiffs/violations
repairAttempt
PublicationStatus
latency/tokens/cost
reviewMode
```

不默认保存原始结果行或 Solver 推理。Evidence Store 保存可复核引用所需的受控内容；Audit Record 默认只保存 ID、版本、哈希、裁决和非敏感摘要。

## 21. 运行模式与熔断

### 21.1 默认模式

| 环境 | 初始默认 | 校准后 |
|---|---|---|
| 开发 | shadow | shadow/enforce 可配置 |
| 产品 | shadow | 达标后逐步 enforce |
| Spider2 对照基线 | off | 保持固定基线 |
| Spider2 实验组 | shadow 或 enforce | 按实验配置 |
| Reviewer 不可用的安装环境 | off，并显式报告能力缺失 | 不伪装为 shadow |

### 21.2 Calibration 失效

以下版本变化使受影响层的 Calibration 失效：

```text
reviewerModel / reviewerPromptVersion
queryDigestVersion / parserVersion / dialect
reviewCoverageSchemaVersion
reviewPolicyVersion / Delivery Policy version
Hard Constraint admission policy
Gate Policy / Applicability Contract version
Probe Template version
```

LLM Reviewer 失效后降级到 shadow。确定性门的新版本失效时回滚到同方言最近已校准版本；没有可回滚版本时将必需检查标记 unavailable，而不是 fail-open。

### 21.3 Assurance Circuit Breaker

触发信号：

- Review Unavailable 比例超过阈值；
- parser、Probe 或 reviewer 的错误/timeout 激增；
- 用户确认推翻 reviewer 的比例显著升高；
- 抽样人工审计 specificity 或 hard-block precision 低于准入线；
- P95 延迟、扫描量或成本超过预算。

触发后：

- LLM Reviewer 从 enforce 自动降到 shadow；
- 确定性门回滚到最近已校准规则/方言版本，无可回滚版本时 fail-closed；
- 保留 Audit Record 并发出运维告警；
- 不按单题关闭规则；
- 不自动恢复 enforce，必须重新校准或人工批准。

## 22. Review Calibration

### 22.1 数据分层

1. 开发回放集：Round 7 的 47 个错误案例和同轮正确案例；
2. 冻结 Spider2 验证集：reviewer prompt 冻结后使用；
3. 外部泛化集：BIRD mini-dev 或其他未参与规则设计的数据集；
4. Gold 只用于事后标签；
5. reviewer prompt 每次修改都生成新版本。

### 22.2 评估层级

Case level：

- 错误案例是否被拦截；
- 正确案例是否被误拦。

Aspect level：

- Semantic Diff 的 aspect 是否真实；
- required/observed/evidence 是否准确；
- 是否遗漏主要错误。

Enforce 候选规则的 Aspect-level 标注采用两名独立标注者，分歧由第三方裁决；标注者不能看到 reviewer 自信分数。

### 22.3 首期准入线

```text
correct-query specificity ≥ 98%
mismatch precision ≥ 90%
repeat agreement ≥ 95%
semantic error recall：记录，但不作为首期阻断准入条件
净 E2E 正确题数必须提升
未交付/timeout 比例上升不超过 1 个百分点
P95 额外延迟不超过 20 秒或基线的 25%，取更宽者
单题平均 LLM token 成本上升不超过 30%
```

首期优先低误杀，而不是高召回。

### 22.4 有界确定性门准入线

```text
机械合同 fixture 阻断与放行均为 100%
已复核正确候选非阻断 specificity ≥ 99%，且单侧 95% 置信下界 ≥ 98%
hard-block diff precision ≥ 99%
声称支持的历史机械模式召回率 = 100%
固定评测集净 E2E 不下降
未交付/timeout 比例上升分别不超过 1 个百分点
```

规则、适用范围和阈值必须在 Enforce E2E 前冻结；未达标规则只能 Shadow，不允许按单题豁免。

### 22.5 Reviewer 模型策略

1. 首期 shadow 使用与 Solver 相同的模型、温度 0 和严格结构化输出；
2. 少量异构 reviewer 仅作离线对照；
3. 根据错误相关性和 specificity 决定是否异构；
4. 不预设异构模型一定更好。

## 23. 实施顺序

### S0：Candidate 完整性

分离 Artifact 列完整性与 Answer Contract。空合同、零行结果、Artifact 列变化和额外输出列测试通过，`expected []` 路径消失。

### S1：Query Digest

实现 AST 驱动、方言感知的 Query Digest、coverage、unsupported nodes、完整 lineage 和多方言 fixture。tokenizer 只能作为 Shadow 诊断，不能伪装 checked。

### S2：证据与 Contract

实现可验证 Evidence Reference、Spec Change Proposal 准入、Conflict Record、扩展 Answer Contract 和版本化 Evidence Admission Policy。

### S3：G1

实现形状、最终聚合、输出角色、Top-N、tie policy、排序和完整 Candidate 检查。

### S4：G2

实现有界 Population Effect、Physical Mapping Evidence 和总体影响四态。只给 Applicability Contract 明确支持且可确定性归类的节点阻断权。

### S5：G3/G4

实现 Measure/Population Contract、Cardinality Evidence、固定 Probe Template、同快照约束、失败 claim 和 Semantic Fingerprint。

### S6：生命周期与发布

实现派生 Query Task 状态、持久化可信 Store、一次修复、产品/Spider2 Delivery Policy、原子发布和 Audit Record。

### S7：Calibration 与渐进 Enforce

每阶段依次运行单元/变异测试、冻结候选 replay、Shadow E2E；达到预注册门槛后才按规则和方言进入 Enforce E2E。Reviewer 继续 Shadow，重新 Enforce 另立校准任务。

LLM Back-translation、异构 reviewer 和 N-version 只在后续证据支持时实验。

## 24. 里程碑

### M1：Infrastructure Ready

- taskId、Answer Spec、Artifact、Digest、Gate Applicability 和 Audit Record 串通；
- Agent-facing 工具面保持 `query_database → publish/export → 最多一次修复`；
- shadow 可运行。

### M2：Calibrated

- 错误和正确案例完成 case/aspect 标注；
- 各规则和方言达到各自准入线；
- 外部集未显著退化；
- non-delivery、扫描量、成本与延迟有真实数据。

### M3：Enforced

- 只有达标规则和方言获得阻断权；
- 产品确认流程可用；
- Spider2 disagreement 与 unavailable 状态可审计；
- `not_applicable`、`unsupported` 与 `checked` 不混用；
- 不存在静默 fail-open；
- 确定性门可回滚到最近已校准版本，Reviewer 可回滚到 shadow，且不丢失 Audit Record。

M1 完成不能替代架构方案完成。

## 25. 测试策略

1. `QueryAssurance` interface 合同测试；
2. QueryDigestCompiler 多方言 fixture、AST 变异和 coverage 测试；
3. Evidence Reference、Hard Constraint admission 和 Conflict Record 判定表；
4. G1–G4 的正例、邻近反例、等价改写和失败 claim 测试；
5. Reviewer adapter 录制响应测试；
6. Export Candidate 原子发布、身份绑定与清理测试；
7. Product/Spider2 Delivery Policy 和 unavailable 分层测试；
8. 历史 replay shadow 与少量真实 provider opt-in E2E。

测试通过公开 seam 验证行为。内部 prompt 快照只能作为辅助证据。

## 26. 当前实现补充（结构化 Contract、值证据、有界门控）

本节只记录当前代码基线，不表示所有方言和规则都已完成 Calibration。未校准规则不能获得 Enforce 阻断权。

当前代码已把以下接口约束落地：

1. `AnswerSpec.answerContract` 提供 `output`、`grain`、`measures`、`denominator`、`ranking`、`time`、`unit`、`rounding` 槽位。每个槽位携带 `binding`（`hard`/`hypothesis`）和 provenance；规划器生成的值默认是 hypothesis，只有带可验证题面引用或权威输入才能成为 hard。
2. `ResultMetadata.resultEvidence` 提供完整数值列证据；原始行默认不发送，数值证据受预算限制并显式标记 `numericCompleteness`，不完整证据不能支持 `result_values=checked`。
3. `ReviewCoverage` 由 Runtime 根据 Digest 确定性生成 applicability challenge。Reviewer 必须覆盖全部 facet；`checked` 必须引用实际 Digest path，结果值 facet 还必须引用完整 numeric evidence。Runtime 对标准 Reviewer 和自定义适配器执行二次校验。
4. `query_database` 只暴露 bounded preview，Artifact 的 Digest、Schema 和候选证据由 Runtime 复用；Solver-facing 工具面不包含 `sql_validate`、`semantic_validate` 或 `purpose=reconciliation|verification`。数据库 MCP 只提供内部预览、批量读取、EXPLAIN 和正式 Schema，原始 `export_query(sql)` 不再由 SQLite MCP 直接提供。
5. 已实现 G1–G4 的有界门结果、门适用性版本、同快照/正式 Schema 基数证据接口、候选语义指纹与一次修复记忆。Shadow 不产生 `published_approved`；Hard Contract/Structural Fact 的确定性失败仍阻断，LLM 语义阻断权和确定性门的 Enforce 资格均需对应 Calibration。
6. 产品和 Spider2 使用追加式 Json File Query Task Store；状态身份包含 reviewer、parser、Digest、Gate Applicability、Probe、Evidence Admission 和 policy 版本。版本不匹配时只保留历史审计，不恢复旧 Artifact、Candidate、Token 或 Receipt。持久状态不保存原始预览行。

这些实现不能把 `Approved` 变成绝对正确证明；它们收紧的是证据接口和发布权，不是人为制造 Gold oracle。

## 27. 明确拒绝的方案

- 让 Solver 自己提供具有裁决权的语义合同；
- 将 LLM Back-translation 当成 SQL ground truth；
- Reviewer 与 Solver 共享对话历史；
- 两次拒绝后静默 fail-open；
- 把 reviewer provider timeout 当成 Approved；
- 只审查 CSV 而允许自然语言绕过；
- 仅按 SQL hash 缓存审查结果；
- 无前提运行通用性质探针；
- 对任意复杂 JOIN 自动生成守恒查询；
- 把用户单次纠正自动升级为全局业务定义；
- 在 Calibration 达标前默认 enforce；
- 把门外复杂 SQL 伪装成已检查；
- 在门内必需 Digest/Probe unavailable 时允许授权绕过；
- 把 N-version 一致等同于正确。
