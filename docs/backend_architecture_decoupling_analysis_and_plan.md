# Data Agent 后端目标架构与重构计划：以 Pi AgentHarness 为执行内核

> **版本**：v2.1  
> **更新日期**：2026-09-12（QA 瘦身与强类型内核修订）  
> **目标**：在不重复实现 Agent Runtime 的前提下，以最小强类型 Answering 内核取代当前膨胀的 Query Assurance 协调层，使业务能力高度解耦、原子功能正交、状态权威唯一，并保持总体设计简洁。  
> **目标基线**：Pi `main` 提交 [`71dca871bc80b6bc97be37f0ca3189399d651fff`](https://github.com/earendil-works/pi/tree/71dca871bc80b6bc97be37f0ca3189399d651fff)，对应仓库包版本 `0.85.1`。  
> **重要前提**：本项目当前依赖 `@earendil-works/pi-agent-core@0.83.0`。本文描述目标设计，不假定 `0.83.0` 与 Pi main 的 Harness API、Session 格式或恢复语义兼容。

---

## 1. 架构结论

**系统中只有一个产品 Agent：Data Agent。** `AgentHarness` 不是另一个 Agent，而是 Data Agent 内部使用的 Pi 执行内核，角色类似框架或运行库。Data Agent 不再另外实现 Runner、运行状态机、队列、取消、重试、恢复或 Pi 事件镜像，而是直接组合 `AgentHarness` 完成这些执行机制。

目标结构为：

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│ Electron Renderer / Web UI                                       │
│ 只消费窄命令 Service 与只读状态投影，不接触 Harness/Session/凭证 │
└───────────────────────────────┬──────────────────────────────────┘
                                │ IPC / HTTP / Chord Remote Service
┌───────────────────────────────▼──────────────────────────────────┐
│ Application Host                                                 │
│ SessionDirectory / SessionManagement / 路由 / 身份与权限         │
│ 不解释 Agent 事件，不执行数据业务规则                            │
└───────────────────────────────┬──────────────────────────────────┘
                                │ attach session
┌───────────────────────────────▼──────────────────────────────────┐
│ DataAgent Session Host                                           │
│                                                                  │
│  Pi AgentHarness                                                 │
│  ├── Session：会话树、持久状态、Usage                            │
│  ├── AgentLane：模型配置、队列、单 Operation 所有权              │
│  ├── Operation：accept / drive / requestAbort / result           │
│  ├── Hooks：显式拦截点                                           │
│  └── Tools：调用 Data Agent 业务 Module                          │
│                                                                  │
│  Data Agent 业务 Module                                          │
│  ├── Answering：Query Task / Answer Spec / Candidate / Publish   │
│  ├── Workspace                                                   │
│  ├── Knowledge                                                   │
│  ├── Python                                                      │
│  ├── Presentation Compiler                                      │
│  └── Clarification Dialogs                                      │
│                                                                  │
│  Chord Session Facets                                            │
│  ├── AgentController                                            │
│  ├── Transcript                                                 │
│  ├── QueryTaskProjection                                        │
│  ├── ArtifactDirectory                                          │
│  └── ClarificationDialogs                                       │
└──────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│ External Adapters                                                │
│ Models / SQL Executor / Filesystem / Python Process / Storage    │
└──────────────────────────────────────────────────────────────────┘
```

核心判断：

1. **Data Agent 是唯一的产品 Agent；Pi AgentHarness 是它内部唯一的 Agent 执行内核。**
2. **Data Agent 自己定义数据回答业务语义，不重复实现 Agent 生命周期基础设施。**
3. **业务能力通过 Service 或直接依赖组合；Tool 只是模型 Adapter。**
4. **Presentation 只看到有意暴露的命令和投影，不看到 Harness 原生对象。**
5. **插件化只用于真实存在的多贡献者或跨运行环境能力，不把所有文件都抽象成插件。**
6. **QA 不再维护第二套运行状态机；只保留 Answer Spec、Evidence、Hypothesis/Choice、Resolution、Result Candidate、Finding 和 Publication Receipt。**
7. **强类型只消灭非法状态和无资格状态转换，不伪装成业务真值证明。**
8. **实施顺序是“先验证 Pi 最小地基，再在纵向迁移中对 QA 做减法”；既不先在旧架构上重写 QA，也不把旧 QA 原样搬入新架构。**

---

## 2. Pi 原生运行时中必须直接复用的能力

### 2.1 Session、Lane 与 Operation

Pi 的运行模型不是一个带 `activeRun` 的 Agent 类，而是：

```text
Session
├── 不可变 Entry Tree
├── 当前 Values / Lists
├── Usage Ledger
└── 多个 AgentLane
     ├── model / thinking / active tools
     ├── ordered inbox
     └── 至多一个当前 Operation
```

Pi 的 `AgentLane` 已提供：

```ts
accept(request, context)
drive({ operationId }, context)
requestAbort(operationId, context)
inspectExecution(context)
getResult(operationId, context)

prompt(...)
resume(context)
abort(context)
steer(...)
followUp(...)
nextRun(...)
cancelQueued(...)
watch(context)
```

真实接口见 [`AgentLane`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/agent-harness.ts#L538-L580)。

因此删除此前目标设计中的自建：

```text
Runs
RunHandle
AgentEngine
EngineEvent
运行级 AbortController 管理器
运行队列
运行恢复状态机
```

这些自建抽象会重复 Pi 的职责，并制造两个运行权威。

### 2.2 接受工作与执行工作分离

Pi 将一次 Operation 分成：

```text
accept
  └── 原子记录 Operation 意图，不启动 Hook/模型/工具/定时器

drive
  └── 获得或加入 Lane 所有的执行 pass，从持久状态继续执行
```

`accept` 成功后即使进程在 `drive` 前退出，Operation 也可以恢复。`drive` 的调用者只是观察者；调用者自己的 Context 取消不会取消整个 Operation。持久取消必须使用带 `operationId` 的 `requestAbort`。

设计依据：[`accept/drive` 语义](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/harness.md#L718-L736) 与 [`Drive` 所有权](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/harness.md#L875-L921)。

Data Agent Host 不再把 HTTP/IPC 请求生命周期等同于 Agent Operation 生命周期。

### 2.3 持久化程序计数器

Pi 将 Operation 当前状态保存为完整判别联合，包括：

```text
starting
checkpoint
assistant.ready
assistant.effect_pending
assistant.retry_wait
tools
deferred.suspended
deferred.effect_pending
summary.deciding
summary.ready
summary.effect_pending
summary.retry_wait
navigation.ready_to_commit
```

真实类型见 [`OperationState`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/session/types.ts#L179-L329)。

Data Agent 不得再用以下变量镜像这些事实：

```text
activeRun
isAgentBusy
currentToolCall
pendingFollowUp
retryAttempt
currentMessageId 所决定的运行身份
```

UI 展示状态来自 `AgentLane.watch()` 的 coherent snapshot 与后续事件，不从宿主自建状态机推导。

### 2.4 Intent → Effect → Settlement

模型请求和工具调用由 Pi 负责：

```text
持久化 Effect Intent
        ↓
执行外部 Effect
        ↓
持久化完整 Outcome 与下一状态
```

工具调用支持稳定 `invocationId`、进度 checkpoint、memo，以及 `replay: "safe" | "never"`。真实接口见 [`AgentHarnessToolInvocation`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/types.ts#L83-L127)。

Data Agent 工具不再自行实现“崩溃后是否重试工具”的框架，但业务 Service 必须对自己的副作用提供幂等语义。

### 2.5 Snapshot、Event 与 Hook

三者用途严格区分：

| 机制 | 用途 | 不能承担 |
|---|---|---|
| Snapshot | 给消费者完整当前视图 | 执行业务命令 |
| Event | 已提交状态与生命周期的被动观察 | 持久化权威、驱动执行 |
| Hook | 在指定执行点拦截或转换 | 任意业务状态仓库、通用工作流引擎 |

Pi Event 不从持久历史自动重放，Listener 失败不回滚已提交状态。断线恢复依赖新 Snapshot，而不是重放全量 AgentEvent。参见 [`Events`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/harness.md#L1144-L1164)。

---

## 3. Data Agent 的最小业务模型

这里不是把系统拆成“Pi Agent”和“Data Agent”两个 Agent。Data Agent 是完整产品；它的 Session Runtime 内部由两类实现组成：

```text
Data Agent（唯一产品 Agent）
├── 执行机制：直接使用 Pi AgentHarness
└── 数据业务：由 Answering 等 Data Agent Module 实现
```

Pi 的 `AgentHarness` 包只提供 Session、Lane、Operation、Tool invocation 和 Hook 等执行原语，不提供数据查询业务语义。因此以下概念必须由 Data Agent 的 Answering Module 定义：

```text
Query Task
Answer Spec Revision
Evidence
Hypothesis / Choice
Resolution
Exploration Observation
Result Candidate
Finding
Publication Receipt
Disclosure
```

不再把 Claim、Hypothesis Mapping、Verification、Disposition、Decision Trace、Export Candidate 和 Review Token 都设计为彼此独立的可写领域对象。能由其他事实确定的内容一律作为只读投影计算。

这些概念全部归属一个深 Module：**Answering**。

### 3.1 Answering 对外 Interface

```ts
export interface Answering {
  begin(input: BeginAnswer, context: BusinessContext): Promise<AnswerRevisionView>;
  revise(input: ReviseAnswer, context: BusinessContext): Promise<AnswerRevisionView>;
  execute(input: ExecuteQuery, context: BusinessContext): Promise<QueryExecutionView>;
  publish(input: PublishCandidate, context: BusinessContext): Promise<PublicationReceipt>;
  inspect(input: InspectAnswer, context: BusinessContext): Promise<AnswerTaskView>;
}
```

外部调用者不获得：

```text
setTaskStatus
setApproved
setHypothesisHandled
recordClaimVerification
selectAlternative
replaceCandidate
reserveProbeBudget
getMutableStore
publishRawPath
```

这些不是独立业务能力，而是 Answering 内部不变量的实现细节。

### 3.2 唯一规范 Answer Spec

当前实现同时维护 `SevenFacetSpec`、`facetStatus`、`hypothesisBindings`、`AnswerContract`、`hardConstraints` 和 legacy `outputColumns/rowMode/rowCount`。目标设计只保留一个规范七槽位表示；每个槽位自身携带依据，不再旁挂另一份状态表或 JSON Pointer 绑定表。

```ts
type NonEmpty<T> = readonly [T, ...T[]];

type Facet<T> =
  | { readonly state: "unknown" }
  | { readonly state: "not_applicable" }
  | {
      readonly state: "specified";
      readonly value: T;
      readonly basis:
        | { readonly kind: "evidence"; readonly evidenceIds: NonEmpty<EvidenceId> }
        | { readonly kind: "hypothesis"; readonly hypothesisId: HypothesisId };
    };

interface AnswerSpec {
  readonly entity: Facet<EntitySpec>;
  readonly metric: Facet<MetricSpec>;
  readonly filters: readonly Facet<FilterSpec>[];
  readonly groupBy: readonly Facet<GroupingSpec>[];
  readonly time: Facet<TimeSpec>;
  readonly ranking: Facet<RankingSpec>;
  readonly output: Facet<OutputSpec>;
}
```

说明：

- `unknown` 表示证据不足，不能解释成“没有”；
- `not_applicable` 必须是显式判断，不是 `null` 的别名；
- 假设和槽位直接关联，不再同时维护 `scope + hypothesisBindings.paths`；
- 输出形状、单位、舍入等都属于 `OutputSpec/MetricSpec` 的字段，不再另建 `AnswerContract` 平行写模型；
- 若工具边界暂时继续接受旧七槽位字符串，Tool Adapter 必须一次性规范化为上述内部类型，旧形状不得进入领域实现。

### 3.3 强类型身份、证据和假设处置

所有重要身份使用不可混用的品牌类型：

```ts
declare const brand: unique symbol;
type Id<K extends string> = string & { readonly [brand]: K };

type TaskId = Id<"TaskId">;
type RevisionId = Id<"RevisionId">;
type HypothesisId = Id<"HypothesisId">;
type EvidenceId = Id<"EvidenceId">;
type QualifiedEvidenceId = Id<"QualifiedEvidenceId">;
type ChoiceId = Id<"ChoiceId">;
type AlternativeId = Id<"AlternativeId">;
type CandidateId = Id<"CandidateId">;
```

品牌构造器不从 Runtime public surface 导出。来自模型、IPC、HTTP 或持久化的数据必须先经过 TypeBox 解码和 Store 查找，不能靠 `as HypothesisId` 获得可信身份。

Evidence 使用判别联合区分资格：

```ts
type Evidence =
  | UserConfirmationEvidence
  | ReviewedDefinitionEvidence
  | TaskDocumentEvidence
  | RequestWordingEvidence
  | SchemaFactEvidence
  | QueryObservationEvidence;

type HypothesisKind = "business_semantics" | "physical_mapping" | "data_property";

interface Hypothesis<K extends HypothesisKind = HypothesisKind> {
  readonly id: HypothesisId;
  readonly kind: K;
  readonly statement: string;
  readonly affects: NonEmpty<FacetName>;
  readonly basis: string;
  readonly impact: string;
}
```

Hypothesis 不保存 `status` 和不参与政策的模型 `confidence`。处置只记录不可变 Resolution：

```ts
type Resolution =
  | { readonly outcome: "supported"; readonly hypothesisId: HypothesisId; readonly proof: NonEmpty<QualifiedEvidenceId> }
  | { readonly outcome: "refuted"; readonly hypothesisId: HypothesisId; readonly proof: NonEmpty<QualifiedEvidenceId> }
  | { readonly outcome: "provisional"; readonly hypothesisId: HypothesisId; readonly choiceId: ChoiceId; readonly disclosureRequired: true };
```

`qualifyEvidence(hypothesis, evidence)` 是唯一能产生 `QualifiedEvidenceId` 的内部函数。最低资格矩阵为：

| Hypothesis 类型 | 可支持它的证据 | 不能单独支持它的证据 |
|---|---|---|
| `business_semantics` | 用户确认、审核业务定义、任务文档中的明确措辞 | Schema、观测数据、模型自报 |
| `physical_mapping` | 审核语义模型、正式 Schema；观测只可支持值存在性 | 仅凭枚举值推断业务含义 |
| `data_property` | Schema 约束、绑定快照的查询观测 | 未绑定自然语言描述 |

强类型能够证明的是“Resolution 引用了符合该 Claim 类型的合格证据”，不能证明业务含义在现实中绝对正确。

### 3.4 Hypothesis 与 Choice 分离

Hypothesis 是可以被支持或反驳的命题；Choice 是多个合理解释中必须选择一个。两者不得再通过庞大的 `DecisionAlternative + assumptionProfile + assumptionVector + selectionTrace` 结构互相模拟。

```ts
interface Choice {
  readonly id: ChoiceId;
  readonly affects: NonEmpty<FacetName>;
  readonly alternatives: NonEmpty<ChoiceAlternative>;
}

type ChoiceResolution =
  | { readonly outcome: "selected"; readonly choiceId: ChoiceId; readonly alternativeId: AlternativeId; readonly proof: NonEmpty<QualifiedEvidenceId> }
  | { readonly outcome: "provisional"; readonly choiceId: ChoiceId; readonly alternativeId: AlternativeId; readonly disclosureRequired: true };
```

选择规则固定为：合格高权威证据唯一确定 → 用户选择 → 允许的字面 provisional；否则保持 unresolved。`assumptionVector` 必须删除，因为它完全可由结构化 alternative 推导；模型提交的 stable ordering 不拥有裁决权。

### 3.5 创建、修订与 Ready Typestate

首次提交规格时原子创建 Query Task 与第一个 Revision：

```ts
interface BeginAnswer {
  requestMessageId: string;
  spec: AnswerSpecProposal;
  requestId: string;
}

interface ReviseAnswer {
  taskId: TaskId;
  baseRevisionId: RevisionId;
  spec: AnswerSpecProposal;
  requestId: string;
}
```

规则：

- `requestMessageId` 由可信应用解析为当前会话中的用户消息；模型不能提交任意问题文本替换用户原文；
- 首次 `begin` 不要求预先存在的空 Revision；
- `revise` 使用乐观并发控制；过期版本返回 `REVISION_STALE`；
- Runtime 生成正式 ID、验证证据资格、写 Resolution 并计算投影；模型不写 hash、handling status、selection state；
- 一个 Query Task 可跨多个 Pi Operation 继续，不能把 Task ID 等同于 Operation ID。

最终执行前由 Answering 封存 Revision：

```ts
interface DraftRevision { readonly state: "draft"; readonly revisionId: RevisionId }
interface ReadyRevision { readonly state: "ready"; readonly revisionId: RevisionId; readonly ready: Id<"ReadyRevision"> }

type SealResult =
  | { readonly ok: true; readonly revision: ReadyRevision }
  | { readonly ok: false; readonly unresolvedHypotheses: readonly HypothesisId[]; readonly unresolvedChoices: readonly ChoiceId[] };
```

只有 Answering 内部 `sealForResult()` 可以产生 `ReadyRevision`。跨进程调用仍以 opaque `revisionId` 为输入，由 Runtime 重新读取并验证；品牌类型不替代持久化检查。

### 3.6 查询执行类型

```ts
type ExecuteQuery =
  | { readonly kind: "exploration"; readonly taskId: TaskId; readonly sql: string; readonly limit: number }
  | { readonly kind: "result"; readonly taskId: TaskId; readonly revisionId: RevisionId; readonly sql: string };
```

Tool TypeBox Schema 也必须使用同构判别联合，而不是 `mode? + revisionId?` 条件可选字段。现有评测已经出现 result 调用遗漏 revision handle；此类非法组合应在 Schema 解码阶段失败。

领域 Artifact 同样使用判别联合：

```ts
type QueryArtifact =
  | { readonly kind: "exploration"; readonly evidenceId: EvidenceId; readonly preview: BoundedResult }
  | { readonly kind: "candidate"; readonly candidateId: CandidateId; readonly revisionId: RevisionId; readonly resultRef: PrivateResultRef };
```

因此 exploration 在类型上不能传给发布用例。

### 3.7 统一发布

```ts
interface PublishCandidate {
  candidateId: CandidateId;
  format: "auto" | "inline" | "csv";
  requestId: string;
}
```

只有一个发布用例。`export_query` 与 `publish_query_result` 如需短期保留模型兼容名称，必须调用同一个 `Answering.publish()`，不得重复身份检查或政策判断。

`publish()` 不接收 SQL、结果行、任意目标路径、模型提交的 Review Token/hash 或“我已验证”布尔值。当前 `ReviewToken` 收缩为 Answering 内部不可伪造的 `PublicationPermit`；它只证明候选完整性和交付政策已经被检查，不携带整套 Reviewer 配置副本。

---

## 4. Agent Tool 的目标设计

### 4.1 Tool 是 Adapter，不是业务 Module

每个 Tool 只负责：

1. TypeBox Schema；
2. 输入边界验证；
3. 将 `AgentHarnessToolInvocation` 转为业务调用身份；
4. 调用一个业务 Interface；
5. 把结果编码为模型可读内容。

```ts
export function createAnsweringTools(answering: Answering): AgentHarnessTool<DataAgentToolContext>[] {
  return [
    createBeginAnswerTool(answering),
    createReviseAnswerTool(answering),
    createQueryDatabaseTool(answering),
    createPublishResultTool(answering),
    createInspectAnswerTool(answering),
  ];
}
```

### 4.2 模型边界使用最小 Proposal，不暴露领域状态

模型提交的是 Proposal，不是已经可信的领域对象。`update_answer_spec` 使用 begin/revise 判别联合：

```ts
type UpdateAnswerSpecProposal =
  | {
      readonly kind: "begin";
      readonly spec: SevenFacetProposal;
      readonly hypotheses: readonly HypothesisProposal[];
      readonly choices: readonly ChoiceProposal[];
    }
  | {
      readonly kind: "revise";
      readonly taskId: string;
      readonly baseRevisionId: string;
      readonly spec: SevenFacetProposal;
      readonly hypotheses: readonly HypothesisProposal[];
      readonly choices: readonly ChoiceProposal[];
    };
```

`HypothesisProposal` 只包含 `localId/kind/statement/affects/basis/impact/proposedEvidenceIds`。模型不再提交：

```text
status / handlingStatus / confidence
hypothesisBindings / JSON Pointer
claimRefs / selectedAlternativeId
assumptionVector / selectionTrace
specHash / reviewToken / publication policy
```

Runtime 将 local ID 映射为正式品牌 ID，验证 evidence handle 与资格，生成 Resolution 和只读 disposition。Tool 返回 opaque `taskId/revisionId`；模型不能自行构造内部领域对象。

`query_database` 的 TypeBox Schema 同样改为严格判别联合：

```ts
Type.Union([
  Type.Object(
    { kind: Type.Literal("exploration"), taskId: Type.String(), sql: Type.String(), limit: Type.Optional(Type.Integer()) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("result"), taskId: Type.String(), revisionId: Type.String(), sql: Type.String() },
    { additionalProperties: false },
  ),
]);
```

### 4.3 Tool Context 不保存活动业务状态

```ts
interface DataAgentToolContext {
  sessionId: string;
  principal: Principal;
  workspaceScope: WorkspaceScope;
}
```

禁止放入：

```text
activeTask
specVersion
specHash
hasExported
explorationCount
queryAssuranceStore
DataAgentRuntime
全部 Service 的 locator
```

业务任务身份通过 Tool 参数显式传递；可信执行身份来自 Pi invocation：

```ts
interface BusinessContext {
  principal: Principal;
  sessionId: string;
  lane: string;
  operationId: string;
  invocationId: string;
  signal: AbortSignal;
}
```

其中：

- `operationId` 表示当前 Agent Operation；
- `invocationId` 表示稳定工具调用；
- `taskId` 表示数据回答业务任务；
- 三者禁止复用为同一种 ID。

### 4.4 replay 与幂等政策

| 工具 | 建议 replay | 业务要求 |
|---|---|---|
| read/search | `safe` | 允许重复读取 |
| exploration query | `safe` | `invocationId` 重放返回同一逻辑 Observation；不能重复登记 Evidence |
| result query | `safe`，仅在业务幂等实现后 | 同一 invocation 返回同一 Candidate/未知执行状态，不盲目生成第二个 Candidate |
| publish | `safe`，仅在 Receipt 幂等实现后 | 同一 invocation 返回同一 Receipt，不重跑 SQL |
| workspace write | 默认 `never` | 若以后提供 compare-and-set/内容哈希幂等，可单独调整 |
| knowledge append | 默认 `never` | 必须避免重复追加 |
| Python | 默认 `never` | 除非执行被明确设计为可恢复只读任务 |

Pi 不提供外部副作用 exactly-once，但 Answering 不再为所有工具复制一套通用执行状态。Pi Operation/Invocation 保存 effect intent、checkpoint 与 settlement；Answering 只在创建 `ResultCandidate` 和 `PublicationReceipt` 时，以稳定 `invocationId` 做领域幂等并返回已有记录。

外部 Adapter 如果不能判断副作用是否已发生，应把 `outcome_unknown` 原样返回给 Pi Operation；不得由 Answering 再建一套 `not_started/running/settled` 状态机，也不得自动重跑可能已产生副作用的远程操作。

### 4.5 工具注册不建设微内核

内置工具使用显式组合：

```ts
const builtins = [
  ...createWorkspaceTools(workspace),
  ...createKnowledgeTools(knowledge),
  ...createPythonTools(python),
  ...createAnsweringTools(answering),
  ...createPresentationTools(presentation),
];
```

启动时验证名称唯一、Schema 合法、权限声明完整。

只有在确实支持第三方动态贡献时，才采用 Pi/Chord 的 Contribution Registry：创建新 Draft、按稳定顺序重放贡献、验证、由 Host 一次性安装。Facet 不直接调用 `harness.setTools()`。该模式依据 Pi 的 [Contribution Registry 设计](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/plugins.md#L428-L453)。

---

## 5. Hooks 的精确使用方式

### 5.1 允许的 Data Agent Hook

| Hook | Data Agent 用途 | 限制 |
|---|---|---|
| `before_run` | 注入该次运行稳定的产品规则、能力清单和受信上下文摘要 | 不创建 Query Task，不执行 SQL |
| `before_tool` | 全局禁用能力、权限防御、参数替换后的再次验证 | 核心业务规则仍在业务 Module 内检查，不能只依赖 Hook |
| `after_tool` | 统一截断/脱敏模型可见结果、附加非权威呈现信息 | 不修改 Query Task 权威状态 |
| `before_run_end` | 只读查询本 Operation 关联 Task 是否存在未完成交付；必要时返回 follow-up | 仅作 UX 续跑；使用 Pi Hook/Operation 的有界执行语义，不在 Answering 建立 claim 状态；不承担完整性授权 |
| `transform_context` | 请求级上下文压缩或模型消息转换 | 不写持久业务事实 |
| `before_request` | Provider 请求参数和可观测性 | 不承担查询政策 |

Pi 将 Hook 输出分为 pass-local、request-local 和 transition-consumed。Data Agent 必须按这些重复执行语义实现，不能假定 Hook exactly-once。参见 [Hook 持久性](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/harness.md#L1166-L1206)。

`before_run_end` 的交付续跑不是安全机制。Hook 只调用 `Answering.inspect()` 读取状态，并使用 Pi 当前 Operation/Hook 的有界 follow-up 能力限制次数；不得向 Answering 写入 `claimContinuation`、`reminderSent` 或新的业务 phase。

若当前 Pi 版本不能为该 Hook 提供满足需求的持久有界元数据，则首期允许提醒在崩溃边界重复或缺失，而不是新增一套 QA checkpoint。真正的交付完整性只由 `Answering.execute(result)` 和 `Answering.publish()` 的前置条件保证；绝不能因为提醒已发送或未发送而授权发布。

### 5.2 替换现有 Harness 继承

删除：

```ts
class DataAgentHarness extends AgentHarness {
  override prompt(...) { ... }
  override abort(...) { ... }
  override skill(...) { ... }
}
```

替换为：

```text
AgentHarness 原生 AgentLane
├── before_run：运行输入准备
├── before_run_end：有界、非授权性的交付提醒
├── before_tool / after_tool：跨工具政策
├── Resources：Skills / Prompt Templates
└── Lane activeToolNames：有效工具集合
```

Skill 的工具权限由：

```text
Host 授予工具 ∩ Skill 允许工具 ∩ 当前 Lane activeToolNames
```

得到。Skill 无权恢复 Host 未安装或已禁止的工具。

---

## 6. Chord 业务组合

### 6.1 为什么使用 Chord，而不是通用 DI 容器

Pi 当前使用 Chord 表达跨 Session Worker、Server 与 Presentation 的业务能力。Chord 提供：

- Facet：某项功能在一个运行环境中的切片；
- Service：一所有者、多消费者的稳定类型能力；
- ReplicatedState：单一权威状态的只读投影；
- Context：调用级取消和调用信息；
- Remote Service：跨进程调用和订阅；
- 生命周期：依赖排序、激活、反向清理与 shape-preserving reload。

见 [`@earendil-works/chord`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/chord/README.md#L1-L65)。

Pi `coding-agent` 中基于 Chord 的 client/server Service slices 当前明确标为 **experimental**，见其 [实现状态说明](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/experimental/services/README.md#L1-L25)。Data Agent 采用的是 Chord 的组合原则和公开原语，不直接依赖 `coding-agent/src/experimental/*` 的内部实现，也不把其实验协议当成稳定兼容承诺。

使用边界：

- 真实需要跨进程或被多个 Facet 消费的能力才定义为 Service。
- 只有一个固定调用者的纯函数直接 import。
- 只有一个实现且不跨边界的内部对象直接构造和注入。
- 不创建通用 Repository、Manager、Engine Service。

### 6.2 Host Scope

#### Application Host

负责：

```text
SessionDirectory
SessionManagement
用户身份与 Session 访问授权
Session Worker 生命周期
IPC/HTTP 连接与路由
数据库凭证和平台资源装配
```

不负责：

```text
解析 Pi AgentEvent
推导工具状态
Answer Spec 修订
SQL 候选身份
发布政策
```

#### Session Host

一个 Session Host 独占一个可写 Pi Session，持有：

```text
AgentHarness
main AgentLane
Answering
Workspace
Knowledge
Python
Presentation Compiler
Session Facets
```

Pi 明确采用“一个打开的 Session 只有一个可写 Owner”，多执行流通过 Lane 表达，而不是多个进程共同写 Session。

第一阶段可以让 Session Host 与 Electron main/Web server 同进程运行；接口和所有权保持不变。只有出现隔离、崩溃恢复或并行资源需求时再迁移到独立 Worker，不预先承担多进程复杂度。

#### Presentation Host

Electron Renderer 与 Web UI 只消费：

```text
AgentController
Transcript
QueryTaskProjection
ArtifactDirectory
ClarificationDialogs
```

不能访问：

```text
AgentHarness
AgentLane
Pi Session
SQL Executor
数据库凭证
私有 ResultStore 路径
Query Task 可写 Store
Hook Registry
完整 Tool Registry
```

这与 Pi 的 Presentation 安全 Facade 设计一致：Presentation 不获得原始 Harness，而只获得 `AgentController` 等语义 Service。参见 [Pi Facet 权限边界](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/plugins.md#L287-L376)。

### 6.3 目标 Service

#### AgentController

按 Pi 的窄控制语义定义 Data Agent 自己的稳定 Service contract，并由 Session Facet 适配 `AgentLane`。不要直接 import `coding-agent/src/experimental/services/agent-controller.ts`：

```ts
interface AgentController {
  prompt(request, context): Promise<OperationResponse>;
  requestAbort(operationId, context): Promise<void>;
  steer(request, context): Promise<QueueResponse>;
  followUp(request, context): Promise<QueueResponse>;
  nextRun(request, context): Promise<QueueResponse>;
  cancelQueued(entryId, context): Promise<CancelQueueResponse>;
  resume(context): Promise<OperationResponse>;
}
```

参考接口见 Pi 的 [`AgentController`](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/experimental/services/agent-controller.ts#L1-L54)。Data Agent 借鉴其权限形状，但独立版本化自己的 contract；不能重新发明一个暴露 Pi 全部能力的远程 Harness。

#### Transcript

```ts
interface TranscriptState {
  snapshot: LaneTranscriptSnapshot | null;
  event: LaneWatchEvent | null;
}

interface Transcript {
  readonly state: ReplicatedState<TranscriptState>;
}
```

客户端先 hydration 完整 Snapshot，再应用增量。断线、Session 切换或导航 rebase 时重新获取完整 Snapshot，不尝试从旧事件补齐未知间隙。

#### QueryTaskProjection

```ts
interface QueryTaskProjectionState {
  activeTaskId: string | null;
  tasks: Array<{
    taskId: string;
    requestMessageId: string;
    currentRevisionId: string;
    phase: "spec" | "exploration" | "candidate" | "published" | "closed";
    pendingClarifications: number;
    latestCandidateId?: string;
    publicationId?: string;
  }>;
}

interface QueryTaskProjection {
  readonly state: ReplicatedState<QueryTaskProjectionState>;
  inspect(taskId: string, context: Context): Promise<AnswerTaskView>;
}
```

这是只读投影，不是 TaskStore，不允许 UI 直接写 `phase`。

#### ArtifactDirectory

仅列出已发布且当前 Principal 有权访问的 Artifact：

```ts
interface ArtifactDirectory {
  readonly state: ReplicatedState<PublishedArtifactSummary[]>;
  resolve(publicationId: string, context: Context): Promise<AuthorizedArtifact>;
}
```

不暴露私有 Candidate 路径。

#### ClarificationDialogs

澄清是 Session 所有的 keyed Service instance，而不是服务器向某一个 UI 做反向 RPC：

```text
Agent Tool 创建 Clarification Dialog instance
→ 所有连接的 Presentation 观察到该实例
→ 任一合格用户提交回答
→ Session Authority 原子确定唯一答案
→ Tool 继续
→ 同一 close 函数处理成功、取消和错误清理
```

没有 Presentation 连接时，Dialog 仍由 Session 拥有；是否等待、超时或失败由产品政策决定。

### 6.4 ReplicatedState 不是业务存储

Chord ReplicatedState 只表示权威最新值的复制：

- 不是事件历史；
- 不是数据库；
- 不是 CRDT；
- 不是多写者状态；
- Worker 重启后必须从权威存储重新生成完整值。

参见 [Pi ReplicatedState 语义](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/plugins.md#L394-L426)。

---

## 7. Answering 的状态权威与存储

### 7.1 默认使用 Pi Session 的应用状态能力

Query Task 是 Session 所有的业务事实，默认与该 Session 一起恢复、分支和关闭。目标设计不再额外建设 Query Assurance 数据库、JSONL hash journal 或 QA checkpoint 状态机，而是在 `AnsweringStore` Interface 后使用 Pi Session 的应用命名空间实现。

Pi Session 已提供：

```text
Entries        不可变会话/自定义记录
Values         可替换的当前状态
ValueLists     有生命周期的追加记录
Mutation line  单 Session 串行原子提交
Operation      accept/drive/recovery/cancel/effect checkpoint
Usage          通用 Agent 使用量
```

Data Agent 建议只使用以下业务命名空间：

```text
data-agent.answering.task
data-agent.answering.revision
data-agent.answering.evidence
data-agent.answering.resolution
data-agent.answering.candidate
data-agent.answering.publication
data-agent.answering.index
```

不再建立 `data-agent.answering.operation`、`FastPathCheckpoint` 或通用工具状态；这些事实属于 Pi Operation。Answering 业务代码只依赖自己的 Store Interface：

```ts
interface AnsweringStore {
  transact<T>(
    command: (state: AnsweringTransaction) => Promise<T>,
    context: BusinessContext,
  ): Promise<T>;

  inspect(taskId: TaskId, context: BusinessContext): Promise<AnswerTaskRecord | undefined>;
  list(query: TaskListQuery, context: BusinessContext): Promise<AnswerTaskSummary[]>;
}
```

`PiSessionAnsweringStore` 是 Session Host 内部 Adapter，负责把领域读写映射为 Pi `Value<T>`、`ValueList<T>` 和原子 Session commit。领域层不知道 namespace、key grammar、Pi `SessionMutation` 或 Backend。

| 数据 | 权威存储 |
|---|---|
| 会话 Entry、Agent Operation、Lane 队列、取消、模型调用和通用 Usage | Pi Session 的 `pi.*` 状态 |
| Query Task、Revision、Evidence、Resolution、Candidate 元数据、Receipt | 同一 Pi Session 的 `data-agent.answering.*` 应用状态 |
| 查询完整行数据和待发布二进制 | 私有 ResultStore |
| UI 当前展示 | Chord ReplicatedState 投影，可从 Session 重建 |
| Tool replay checkpoint/memo | Pi Invocation；不复制到 Answering |
| 跨 Session 搜索和运营统计 | 可重建索引或投影，不是写入权威 |
| Reviewer/Detector 离线评估产物 | evaluation/telemetry 存储，不进入 Answering 权威 |

只有出现以下已确认需求时，才把 Answering 权威迁移到独立数据库：

- 一个 Query Task 必须跨 Session 共同编辑；
- 多个 Worker 必须并发写同一 Query Task；
- Query Task 有独立于 Session 的保留、迁移或权限生命周期；
- 需要不打开 Session 就对全部任务做强一致事务查询。

如果只是全局列表、运营统计或搜索，建立可重建投影，不引入第二写入权威。

### 7.2 Session 内的最小领域记录

```text
Value<QueryTaskRecord>
  key = taskId
  requestMessageId, currentRevisionId,
  latestCandidateId?, publicationId?, lifecycle

ValueList<AnswerRevisionRecord>
  key = taskId
  revisionId, parentRevisionId, spec,
  hypotheses, choices, createdAt

ValueList<EvidenceRecord>
  key = taskId
  evidenceId, kind, authority, sourceRef,
  contentHash, observedAt

ValueList<ResolutionRecord>
  key = taskId
  resolutionId, revisionId, subjectId,
  outcome, qualifiedEvidenceIds, disclosureRequired

Value<ResultCandidateRecord>
  key = candidateId
  taskId, revisionId, resultRef,
  resultSchema, rowCount, contentHash,
  findings, createdByInvocationId

Value<PublicationReceiptRecord>
  key = publicationId
  taskId, candidateId, revisionId,
  format, publicRef, disclosureRef,
  policyVersion, createdByInvocationId

ValueList<TaskId>
  namespace = data-agent.answering.index
  key = tasks
```

不再持久化以下可推导或由 Pi 已持有的数据：

```text
Hypothesis.status
HypothesisHandlingStatus
ClaimRecord/HypothesisClaimMapping
SelectionTrace/AssumptionVector
QueryOperationRecord/FastPathCheckpoint
TaskUsageLedger 的 Pi 重复副本
Prepared/Review/Publish 的中间 phase 镜像
```

事务规则：

- 创建 Task 与首个 Revision 在一次 Session commit 中完成；
- 修订 Revision 与更新 `currentRevisionId` 在一次 commit 中完成；
- Evidence 和 Resolution 创建后不可修改；Disposition 每次读取时推导；
- Result Candidate 元数据与 Task 当前指针在一次 commit 中完成；
- Publication Receipt 与 Task 发布指针在一次 commit 中完成；
- Revision、Evidence、Resolution、Candidate 和 Receipt 均为追加或创建后不可变记录；
- `QueryTaskRecord` 不复制 Pi Operation 的 phase、queue、cancel、retry 或 checkpoint；
- 同一 `invocationId` 再次创建 Candidate/Receipt 时返回已有领域记录，不创建第二份；
- Candidate 只能绑定由 `sealForResult()` 产生的当前 Ready Revision；
- 知道 opaque ID 不等于有权限；每次操作验证 Principal、Session 和 Task 所属关系；
- ReplicatedState 从上述记录生成，不成为第二写入入口。

### 7.3 ResultStore 与 Result Candidate

大型结果不能写入 Pi Session Value。ResultStore 只保存不可变数据对象，不保存业务资格：

```ts
interface ResultStore {
  createPrivate(input: ResultStream, context: BusinessContext): Promise<PrivateResultObject>;
  openPrivate(ref: PrivateResultRef, context: BusinessContext): Promise<ResultStream>;
  openAuthorized(
    ref: PrivateResultRef,
    receipt: PublicationReceiptRecord,
    context: BusinessContext,
  ): Promise<ResultStream>;
  discard(ref: PrivateResultRef, context: BusinessContext): Promise<void>;
}
```

当前 `ValidatedQueryArtifact + ExportCandidate` 合并为一个 `ResultCandidateRecord`：

```text
ResultStore 保存 bytes/typed rows
Pi Session 保存 Candidate 身份、Revision、schema、hash、ResultRef 和 Findings
```

不再创建一个 preview artifact 后重新流式执行 SQL生成第二个 Export Candidate。Result Query 只执行一次，并同时产出完整私有结果与有界 preview。

Session 和 ResultStore 不能伪装成跨介质 ACID：

```text
先写私有不可变对象
→ 再在 Session 中提交 Result Candidate 引用
→ 发布从同一对象编码 inline/CSV
→ Receipt 授权读取
→ 未被 Session 引用的私有对象由 GC 回收
```

必须覆盖以下故障：

- ResultStore 成功、Session commit 失败：形成私有孤儿，由 GC 回收；
- Session 有 Candidate 引用、ResultStore 对象丢失：标记 Candidate `corrupt` 并阻止发布，不重新执行 SQL冒充原结果；
- Receipt 已提交、调用响应丢失：相同 invocation 找回原 Receipt；
- 发布目标已存在但 hash 不同：拒绝覆盖。

---

## 8. 查询与发布执行协议

### 8.1 Exploration

```text
Pi Tool invocation
  → Answering.execute(kind=exploration)
  → 验证 Task、权限、SQL 只读约束和有界 limit
  → SqlExecutor 执行有界查询
  → 注册 QueryObservationEvidence
  → 返回 observationEvidenceId 与有界数据
  → Pi settlement 持久化工具 Outcome
```

特点：

- 不要求 Ready Revision；
- Observation 永远不可发布；
- 数据观测不能自动提升为业务定义；
- Pi invocation memo/checkpoint 负责工具重放；Answering 不再记录平行 operation checkpoint；
- 业务层只保证同一 invocation 不重复登记 Evidence。

### 8.2 Ready Revision 与 Result Candidate

```text
Pi Tool invocation
  → Answering.execute(kind=result)
  → 按 revisionId 读取当前 Revision
  → qualify/derive Resolutions
  → sealForResult()
  → 仅 Ready Revision 继续
  → SqlExecutor 执行一次完整结果流
  → 私有 ResultStore 同时生成完整结果与 bounded preview
  → 运行最小 CandidateCheck 集合
  → 短事务重新检查 current revision
  → 原子登记 ResultCandidateRecord
  → 返回 candidateId + preview + findings/disclosures
  → Pi settlement 持久化工具 Outcome
```

首批在线 `CandidateCheck` 只保留：

1. SQL 只读与执行完整性；
2. Result schema/row shape 与明确 OutputSpec 的冲突；
3. 在完整 Query Digest 与合格基数证据下可证明的 JOIN fanout；
4. Candidate、Revision、ResultRef 和 content hash 身份一致性。

其他 Detector、Reviewer 和解释枚举默认移出在线主路径，作为 shadow/evaluation observer；没有效果证据前不重新获得阻断权。

外部 SQL 执行和文件流不能在 Pi Session mutation transaction 中等待。I/O 前后都重新检查 Revision。若执行期间 Spec 被修订：

- 私有 Result 可以作为孤儿等待 GC；
- 不得登记为当前 Revision 的 Candidate；
- 返回 `REVISION_STALE_AFTER_EXECUTION`；
- 不自动用新 Revision 重跑。

### 8.3 Typed ResultStore

Result Query 只执行一次：

```text
数据库结果流
   └── 完整 typed private result
         ├── 同步生成 bounded preview
         ├── inline encoder
         └── CSV encoder
```

必须保留：

- 列顺序；
- NULL；
- 整数与大整数；
- Decimal 精度；
- 日期时间类型及原始时区语义；
- 完整性状态；
- 内容 hash。

禁止：

- 发布时重跑 SQL；
- 从 preview 前 N 行生成“完整 CSV”；
- 将所有值先转 JavaScript number；
- 将截断或未完整结束的结果登记为 Candidate。

### 8.4 Publication

```text
Answering.publish(candidateId)
  A. 读取 ResultCandidate 并验证 Principal、当前 Revision 和 ResultRef
  B. 由内部 authorize() 产生不可伪造 PublicationPermit
  C. 从同一封存结果生成 inline/CSV 与 Disclosure
  D. 短事务重新验证并写 Publication Receipt
  E. 只有 Receipt 授权的引用可以被下载或内联读取
```

`PublicationPermit` 是模块内部 typestate，不是模型参数，也不需要复制 Reviewer model/prompt/parser 的所有版本。需要审计的 observer 版本写入 Finding/Audit 投影，不进入发布身份核心。

故障矩阵：

| 故障时点 | 行为 |
|---|---|
| A/B 前失败 | 无用户可见产物 |
| 私有呈现内容写完、Receipt 前崩溃 | 私有孤儿，由 GC 回收 |
| Receipt 前 Revision 改变 | 拒绝发布 |
| Receipt 已提交、响应丢失 | 相同 invocation/requestId 找回原 Receipt |
| 客户端下载断开 | 重读同一已发布对象，不重跑 SQL |

公开下载路由必须以 Receipt 授权，不能保留可猜测私有路径的静态文件入口。

---

## 9. Query Assurance 瘦身方案

### 9.1 当前复杂度判断

当前工作区中与 QA 直接相关的主要生产文件约 8,700 行，尚未计入 `agent-assembly.ts` 和测试。行数不是验收指标，但以下重复职责说明复杂度是真实的：

| 当前设计 | 重复或多余之处 | 目标动作 |
|---|---|---|
| `SevenFacetSpec + facetStatus + AnswerContract + legacy shape` | 同一语义多份可写表示 | 合并为唯一强类型 AnswerSpec |
| `Hypothesis + Claim + Mapping + Verification + Disposition` | 同一假设身份和状态多次包装 | 只存 Hypothesis + Resolution，Disposition 推导 |
| `Ambiguity + Decision + Alternative` | 多选解释和真假命题混杂 | 分为 Hypothesis 与 Choice |
| `assumptionProfile + assumptionVector` | 后者完全可推导，模型容易自相矛盾 | 删除 vector；必要信息由 Runtime 推导 |
| Gate/Detector/Probe/Counterevidence/Anomaly | applicability/outcome/finding 多套词汇和调用链 | 合并为 CandidateCheck + Finding |
| `ValidatedQueryArtifact + ExportCandidate` | 同一结果两套身份并可能二次执行 | 合并为 ResultCandidate |
| ReviewToken 携带全部版本与候选副本 | 与 Candidate/Receipt 重复 | 收缩为内部 PublicationPermit |
| online Reviewer/Calibration/Circuit Breaker | ADR-0003 后默认无发布权 | 移至 evaluation/shadow observer |
| `FastPathCheckpoint/TaskUsageLedger` | 重复 Pi Operation/Usage | 删除 |
| JSONL hash/HMAC QA StateStore | 重复 Pi Session 权威 | 只读迁移后删除 |
| legacy/new protocol 与 V2/V3 Schema 并存 | 迁移结构进入长期核心 | 隔离在 compatibility adapter，按退出条件删除 |
| 三十余个 optional QueryAssurance 方法 | 调用者必须知道内部顺序，Module 过浅 | 收敛为 Answering 五个用例 |

### 9.2 现有实验给出的谨慎结论

现有评测不能证明全部 QA 机制无效，但足以否定“默认全部迁入新架构”：

- [Phase 6 共有 57 题部分配对结果](./implementation/answer-plan/phase6-partial-common-57-evaluation.md)中，New-off 相对 Legacy 正确率差为 `+1.75pp`，95% CI 为 `[-7.02pp, +10.53pp]`，未达到预注册非劣门槛；
- [同一批专项取证](./implementation/answer-plan/phase6-common57-forensics.md)显示 New-on 相对 New-off 正确率点估计为 `-3.51pp`，且只有 3 题登记 detector anomaly，命中题正确性净变化为 0；该结果不能证明 detector 有害，也不能证明它有在线收益；
- [unresolved-hypothesis reminder/decision 的 10 题观测](./implementation/unresolved-hypothesis-final-metrics.json)中，处理组平均 turns、tool calls、tokens 和 latency 均明显增加，官方正确数没有改善；由于样本和任务选择有限，只能把它视为“复杂机制尚未证明收益”，不能视为最终效果结论；
- 已验证价值主要集中在身份完整性、不可发布 exploration、披露不漏失和确定性 shape 错误，而不是庞大的在线裁决流水线。

因此迁移政策是：**安全不变量默认迁移；实验性检测与 Reviewer 默认不迁移；需要重新进入在线路径的能力必须提供独立效果证据。**

### 9.3 一个深 Answering Module，而不是多个自治 Engine

```text
answering/
├── public.ts                  # Answering Interface 与只读 Views
├── service.ts                 # 五个用例和跨 I/O 编排
├── model.ts                   # 强类型 Spec/Evidence/Hypothesis/Choice/Resolution
├── qualification.ts           # Evidence 资格矩阵与 Ready seal
├── candidate-checks.ts        # 最小在线 CandidateCheck
├── publication.ts             # authorize/encode/receipt
├── answering-store.ts         # 领域 Store Interface
├── pi-session-store.ts        # Session Host 内部 Adapter
└── result-store.ts            # typed immutable result
```

Query Digest compiler 可以作为 `candidate-checks.ts` 的内部纯函数依赖保留；它不是外部业务 Interface。Reviewer、校准、复杂 Detector 和离线解释器放在 `evaluations/` 或 observer package，通过只读 Candidate Snapshot 工作。

### 9.4 统一 CandidateCheck 结果

```ts
type CheckOutcome =
  | { readonly kind: "confirmed"; readonly finding: Finding }
  | { readonly kind: "clear" }
  | { readonly kind: "not_applicable" }
  | { readonly kind: "unknown"; readonly reason: CheckUnknownReason };

interface CandidateCheck {
  readonly id: CheckId;
  evaluate(input: CandidateCheckInput): CheckOutcome;
}
```

规则：

- Check 不能修改 Spec、Resolution 或 Candidate；
- `unknown/not_applicable` 不能伪装为 clear；
- Finding 是否阻断由 Answering 内单一 Publication Policy 决定；
- 首期阻断权只给完整性和已明确的必然 shape 冲突；
- 新 Check 默认 shadow，完成 fixture、覆盖声明和效果评估后才进入在线集合；
- 不再通过 Detector → Anomaly → Interpretation → Decision 的多级对象链改变同一业务状态。

### 9.5 强类型的边界

强类型必须用于：

1. Task/Revision/Hypothesis/Evidence/Candidate ID 不可混用；
2. 外部工具输入判别联合；
3. Observation 不能作为 Business Hypothesis 的合格支持证据；
4. Draft Revision 不能进入 result；
5. Exploration Artifact 不能进入 publish；
6. PublicationPermit 只能由内部完整性检查产生；
7. 对持久化联合类型做 exhaustive switch。

强类型不能用于声称：

- 用户意图已经被证明；
- LLM 输出因为通过 JSON Schema 就成为可信证据；
- SQL 与业务语义完全一致；
- 品牌类型可以替代跨进程身份检查；
- 一个高级泛型系统可以替代业务澄清。

实现只复用现有 TypeBox 和 TypeScript，不引入 fp-ts/Effect、通用状态机框架、类型级 SQL DSL或复杂 proof tree。

---

## 10. 原子能力边界

### 10.1 Workspace

```ts
interface Workspace {
  read(scope, path, range, context): Promise<BoundedFile>;
  write(scope, request, context): Promise<FileReceipt>;
  list(scope, path, context): Promise<WorkspaceEntry[]>;
}
```

负责路径作用域、符号链接策略、原子文件替换和配额；不理解 Query Task 或模型。

### 10.2 Knowledge

```ts
interface Knowledge {
  search(query, scope, context): Promise<KnowledgeHit[]>;
  read(ref, range, context): Promise<KnowledgeExcerpt>;
  propose(change, context): Promise<KnowledgeProposalReceipt>;
}
```

“模型建议”不能直接成为已审核业务定义。追加 Learning 与发布 Business Definition 使用不同操作和权限。

### 10.3 Python

```ts
interface PythonRuntime {
  execute(job, scope, context): Promise<PythonJobResult>;
}
```

负责进程、超时、输出上限、环境变量和工作区权限。不负责选择什么时候应运行 Python。

Python 的 cwd 不是安全沙箱。若需要隔离数据库凭证或私有 ResultStore，必须使用真实进程权限、容器或受控文件描述符，不能只依赖目录约定。

### 10.4 Presentation Compiler

```ts
function compileDashboard(
  spec: DashboardSpec,
  datasets: ReadonlyMap<string, Dataset>,
): CompiledDashboard;

function encodeCsv(
  schema: ResultSchema,
  rows: AsyncIterable<TypedRow>,
): AsyncIterable<Uint8Array>;
```

编译函数不读 Workspace、不执行 SQL、不发布文件。应用用例负责：

```text
加载已授权 Dataset → compileDashboard → Workspace.write
```

---

## 11. 包和代码布局

不为了目录图生成空类。以下文件在承载真实职责时创建。

```text
packages/runtime/src/
  public.ts                         # Host 可见的最小入口；不 re-export Pi
  application/
    host.ts                         # Session attach/routing；无业务规则
    session-runtime.ts              # 组装一个 Session Host

  answering/
    public.ts                       # Answering Interface 与只读 Views
    service.ts                      # 五个用例和跨 I/O 编排
    model.ts                        # Spec/Evidence/Hypothesis/Choice/Resolution
    qualification.ts                # 证据资格与 ReadyRevision seal
    candidate-checks.ts             # 最小在线检查集合
    publication.ts                  # authorize/encode/receipt
    answering-store.ts              # 领域 Store Interface
    pi-session-answering-store.ts   # Pi Session Adapter
    result-store.ts                 # typed immutable result

  capabilities/
    workspace/
    knowledge/
    python/
    presentation/

  agent/
    harness-factory.ts              # AgentHarness.create 与 main lane
    hooks.ts                        # 只注册允许的原生 Hooks
    resources.ts                    # Skills/Prompt Templates
    tool-context.ts

  tools/
    answering.ts
    workspace.ts
    knowledge.ts
    python.ts
    presentation.ts
    registry.ts                     # 静态内置表；需要插件时才接贡献 Draft

  facets/
    session/
      agent-controller.ts
      transcript.ts
      query-task-projection.ts
      artifact-directory.ts
      clarification-dialogs.ts
    host/
      session-directory.ts
      session-management.ts

  adapters/
    sql/
    result-storage/
    filesystem/

  # 在线核心之外；只读消费 Candidate Snapshot
evaluations/
  assurance/
    reviewers/
    detectors/
    calibration/

packages/contracts/src/
  commands.ts                       # IPC/HTTP 不可信输入 Schema
  events.ts                         # 对外 DTO，不导出 Pi 类型
  dto.ts

packages/electron-host/src/
  main.ts                           # Electron 生命周期、safeStorage、窗口
  transport.ts                      # IPC ↔ Application Host

apps/server/src/
  http.ts                           # HTTP/SSE ↔ Application Host
```

### 11.1 `@data-agent/contracts`

继续保持 TypeBox 和 wire DTO 中立，不放：

- Pi `AgentEvent`；
- Chord Facet 实现；
- SQLite Row；
- 私有文件路径；
- Answering 内部状态类型。

Chord Service Token 第一阶段位于 Runtime 内部。只有当前端真正直接运行 Chord Presentation Host 时，再提取一个窄的 application-service-contracts 包；不提前新增包。

### 11.2 Runtime Public Surface

Runtime 不再从单个 `index.ts` 重导出全部实现。

允许 Host 使用：

```ts
createDataAgentApplication(options)
DataAgentApplication
HostRequestContext
ApplicationEvent/Response DTO
```

禁止 Host 使用：

```text
createDataAgentHarness
buildAgentTools
InMemoryQueryAssurance
PublicationRegistry
Pi Session Repo
AgentEvent
内部 Detector/Store
```

---

## 12. 现有机制的明确处置

| 现有机制 | 目标动作 | 目标归属 |
|---|---|---|
| `DataAgentHarness extends AgentHarness` | 删除 | Pi AgentLane + 原生 Hooks |
| `agent-assembly.ts` 中创建所有工具与业务状态 | 删除 | Session Runtime 只装配；工具和业务 Module 分离 |
| Prompt 前自动 `prepareTask` | 删除 | 首次 `begin/update_answer_spec` 原子创建任务 |
| `activeTask` 注入 toolContext | 删除 | Tool 参数显式 taskId/revisionId |
| `[DELIVERY_REQUIRED]` 字符串控制分支 | 删除控制意义 | `before_run_end` 返回 follow-up；状态来自 Answering |
| 工具闭包里的预算/hasExported/mainAgentSpecDeclared | 删除 | Pi Usage/Operation + Answering Candidate/Receipt |
| Runtime 解析 `AgentEvent` 并重建 Agent 状态 | 删除 | `lane.watch()` + Transcript projection |
| Electron/Web 各自管理 Harness Resolver | 删除 | Application/Session Host |
| Electron Host 依赖 pi-agent-core | 删除 | Runtime Session Host 内部依赖 Pi |
| `export_query` 与 `publish_query_result` 两套流程 | 合并 | `Answering.publish()` |
| 探索结果可能原地升级 | 禁止 | 不同 Artifact 类型 |
| 发布时重跑 SQL | 禁止 | 私有封存 ResultStore |
| `query-assurance.ts` 作为类型来源 | 删除反向依赖 | 类型归各自领域所有者 |
| `facetStatus + hypothesisBindings + AnswerContract + legacy shape` | 合并/删除 | 唯一强类型 AnswerSpec |
| `ClaimRecord + Mapping + Verification + Disposition` | 合并/推导 | Hypothesis + Resolution |
| `Decision + assumptionProfile/vector + selectionTrace` | 收缩 | Choice + ChoiceResolution |
| Gate/Detector/Probe/Counterevidence 多层链 | 合并 | CandidateCheck + Finding |
| `ValidatedQueryArtifact + ExportCandidate` | 合并 | ResultCandidate + ResultRef |
| `FastPathCheckpoint/TaskUsageLedger` | 删除 | Pi Operation/Usage |
| `JsonFileQueryAssuranceStateStore` | 停止写入并迁移后删除 | PiSessionAnsweringStore |
| `ReviewModeController/Calibration/CircuitBreaker/ReviewCache` | 退出在线核心 | evaluation/shadow observer |
| `ReviewToken` 复制完整配置身份 | 收缩 | 内部 PublicationPermit |
| Reviewer 默认拥有发布权 | 禁止 | 可选 Finding Provider，不进入默认授权链 |
| 全部 Runtime 实现从 `index.ts` 暴露 | 收窄 | `public.ts` |

---

## 13. 收益、风险与关键权衡

### 13.1 主要收益

| 收益 | 形成原因 | 验证方式 |
|---|---|---|
| 消除双运行时 | Pi 独占 Operation，Answering 不再维护 checkpoint/queue/cancel | 崩溃、断连、abort、replay 场景测试 |
| 消除多份 QA 状态 | Spec 唯一表示，Hypothesis 状态由 Resolution 推导 | 删除旧投影后结果一致；非法组合不可构造 |
| 发布身份更强 | Result Query 一次执行，Candidate 直接绑定 ResultRef | Preview/CSV hash、schema、row count 一致 |
| 模型工具更易用 | 判别联合替代条件可选字段和复杂 Decision payload | schema 拒绝非法组合；工具错误率下降 |
| 业务变化局部化 | Answering 五个用例隐藏证据、检查和发布顺序 | 变更演练不扩散到 Host/Tool/UI |
| 在线成本可控 | Reviewer/实验 Detector 退出默认主路径 | tool/turn/token/latency 与旧基线比较 |

### 13.2 主要风险和控制

| 风险 | 级别 | 控制措施 | 停止条件 |
|---|---|---|---|
| Pi `0.83 → 0.85` API/Session/打包不兼容 | 高 | 独立 Upgrade Spike；固定确切版本 | accept/drive/recovery 或 Electron 打包无法通过 |
| 把旧 QA 原样搬入 Pi，短期复杂度叠加 | 高 | 迁移白名单；未证明能力不迁移 | 新路径仍存在 QA checkpoint/JSON state machine |
| 先在旧架构瘦身导致二次重写 | 高 | 先完成 Pi 最小地基和 Answering Interface | 瘦身工作仍需决定旧持久化/恢复机制 |
| Pi Session 业务锁定 | 中 | 领域只依赖 AnsweringStore；Pi 类型不越过 Adapter | 出现明确跨 Session 多写者需求时重新选存储 |
| Session 与 ResultStore 非 ACID | 高 | 私有对象先写、Session 后提交、hash 校验、孤儿 GC | 无法可靠检测丢失对象或幂等找回 Receipt |
| 强类型演变成泛型框架 | 中 | 只编码七项非法状态；不用高级 proof tree/状态机库 | 调用者必须理解泛型推导才能完成普通用例 |
| Answering 成为上帝类 | 中 | 外部只有五个用例；内部使用纯函数和私有协作者 | Host/Tool 开始按内部步骤手工编排 |
| 历史任务迁移丢失证据链 | 中 | 旧任务只读或一次性迁移；不双写 | 无法验证旧 ID/Result/Receipt 绑定时禁止可写升级 |
| Reviewer/Detector 退出造成漏报 | 中 | 先作为 shadow observer 保留离线对照 | 若证明对高风险样本有稳定净收益再重新接入 |
| 同进程首期缺少故障隔离 | 低到中 | 保持 Service seam；有真实隔离需求后再拆 Worker | 不预先承担远程 Chord 复杂度 |

### 13.3 明确接受的权衡

```text
Pi 运行时复用          > 自主控制每个运行细节
单 Session 权威        > 立即获得跨 Session 强查询
一个深 Answering       > 多个可独立编排的浅 Service
静态同进程组合         > 预先建设远程插件平台
不可变 Result Candidate > 发布时节省私有存储
强类型状态转换         > 允许调用者自由拼接内部步骤
离线/Shadow Reviewer   > 未经校准的在线裁决能力
```

重构成功标准不是实现所有框图，而是：**删除第二套运行权威和多份 QA 语义状态，同时不引入第三套基础设施。**

## 14. Pi 版本升级前置阶段

项目当前锁定 `0.83.0`，目标设计依据 Pi main `0.85.1`。不得直接修改生产代码假装接口兼容。

### 14.1 建立升级 Spike

在独立分支验证：

1. `AgentHarness.create(options, context)`；
2. `Session` 与 `JsonlSessionRepo` 创建、打开和关闭；
3. `AgentLane.accept/drive/requestAbort/watch`；
4. `AgentHarnessToolInvocation` memo/checkpoint/replay；
5. Hooks 的注册和重复执行语义；
6. Memory、JSONL、SQLite 后端选择；
7. Windows/Electron 打包兼容；
8. 当前 `PiJsonlSessionStore` 数据能否迁移；
9. 模型凭证仍不会泄漏到 Python 子进程；
10. `watchSession` 当前仍未实现时，不把它列为依赖。

### 14.2 固定版本

验证完成后固定正式 release/tag 或确切 commit，不在生产直接跟随 `main`。

记录：

```text
pi-agent-core version
pi-ai version
chord version
storageVersion
session migration version
hook contract version
```

### 14.3 Session 迁移政策

三选一并明确：

1. 离线一次性迁移；
2. 老 Session 只读浏览，新 Session 使用新格式；
3. 放弃旧 Session，但保留导出。

禁止：

- 新旧 Harness 同时写一个 Session；
- 通过兼容 Adapter 永久维持两套可写权威；
- 未验证格式就原地打开生产 Session。

---

## 15. 实施计划：运行时最小地基先行，QA 随迁随减

不采用两个极端：

```text
错误 A：先在旧运行时上完整瘦身 QA → Pi 接入后再次改持久化、恢复和接口
错误 B：先把现有 QA 原样搬进 Pi → 旧复杂度 + 新运行时 + 兼容层同时存在
```

采用纵向替换：先验证 Pi 的最小地基，再建立强类型 Answering 内核，每迁移一项必要 QA 能力就删除对应旧实现。

### 阶段 0：冻结不变量与 Pi Upgrade Spike

不改 QA 主体，先完成：

- 把六条必要业务不变量转成 characterization tests；
- 固定兼容 Pi 版本；
- 最小 Session Host PoC；
- Lane `accept/drive/abort/resume/watch` 验证；
- Tool invocation 崩溃恢复和幂等验证；
- Pi Session application Value/ValueList 原子提交验证；
- Session 数据迁移决策；
- Electron/Web 构建报告。

退出条件：不存在未决的 Harness API、Session 格式、恢复和打包兼容问题。Spike 不通过则停止后续迁移，不在旧 QA 中提前复制 Pi 语义。

### 阶段 1：纯强类型 Answering 内核

不接模型、不接 Pi，使用 `InMemoryAnsweringStore` 测试：

```text
begin → revise → qualify evidence → resolve/seal
      → exploration/result candidate → publish
```

交付：

- `Answering` 五用例 Interface；
- 品牌 ID、判别联合和 exhaustive switch；
- 唯一规范 AnswerSpec；
- Hypothesis/Choice/Resolution；
- ReadyRevision typestate；
- AnsweringStore Interface 与内存 Adapter；
- ResultStore Interface 与内存/临时文件 Adapter；
- 最小 CandidateCheck；
- PublicationPermit/Receipt。

本阶段只迁移安全不变量，不迁移 Reviewer、复杂 Detector、QA checkpoint、JSON journal 或 legacy rollout。

退出条件：领域实现不导入 Pi、Electron、Web、Tool Schema；非法状态有编译期负例和运行时解码负例。

### 阶段 2：最小 Pi 纵向闭环

交付一条真实可运行路径：

```text
用户请求
→ Pi Operation
→ Answering.begin/revise
→ exploration
→ sealForResult
→ result 一次执行
→ ResultStore
→ publish
→ PublicationReceipt
```

同时交付：

- `PiSessionAnsweringStore`；
- `AgentHarnessTool` Adapter；
- `query_database` 判别联合 Schema；
- Candidate/Receipt invocation 幂等；
- `before_run_end` 有界非授权提醒；
- 删除 `DataAgentHarness` 继承。

退出条件：取消和恢复由 Pi 场景覆盖；工具不保存 Query Task 权威状态；新路径中不存在 QA 自建 operation checkpoint。

### 阶段 3：选择性迁移 QA，并同步删除旧实现

迁移白名单：

- Evidence Authority；
- 七槽位 Answer Spec；
- exploration/result 区分；
- Query Digest compiler；
- 明确 OutputSpec 的 shape 检查；
- 有充分 Digest/基数证据的 JOIN fanout；
- Publication Receipt 与 Disclosure。

重写后迁移：

- Hypothesis/Verification → Hypothesis + Resolution；
- Ambiguity/Decision → Choice；
- Gate/Detector/Probe/Counterevidence → CandidateCheck；
- ValidatedQueryArtifact/ExportCandidate → ResultCandidate。

默认不迁移：

- FastPathCheckpoint/TaskUsageLedger；
- JsonFileQueryAssuranceStateStore；
- AnswerPlanRolloutAuthority；
- assumptionVector/selectionTrace；
- 在线 Reviewer Calibration/Circuit Breaker；
- 自动 interpretation injection；
- 未证明净收益的 Tier-B detectors。

每完成一个替换，立即删除旧写路径和旧状态，不等到最后统一清理。

### 阶段 4：Tool 与 Host 切换

交付：

- `update_answer_spec → Answering.begin/revise`；
- `query_database → Answering.execute`；
- `export_query/publish_query_result → Answering.publish`；
- Electron/Web 共用 Application Host；
- 删除两套 Harness Resolver 和 Host 侧 Pi Event 状态镜像；
- IPC/HTTP 只做鉴权、验证、路由和编码。

切换按 Task 隔离：切换前任务留在旧路径完成或只读；切换后创建的任务只走新路径。禁止同一 Task 双写旧 QA Store 和 Pi Session，也禁止任务中途切换协议。

### 阶段 5：Session Facets 与只读投影

交付：

- AgentController；
- Transcript；
- QueryTaskProjection；
- ArtifactDirectory；
- ClarificationDialogs。

第一阶段保持同进程。Presentation 只使用窄 Service，不导入 Harness、SQL Executor、AnsweringStore 或私有 ResultStore。远程 Chord 和独立 Worker 不作为切换前置条件。

### 阶段 6：删除 compatibility 与评估可选能力

删除：

- `answer-spec-legacy-v1/evidence-plan-v2` 可写协议；
- V2/V3 Tool Schema 并存；
- 旧 `agent-assembly.ts` 状态闭包；
- 旧 QueryAssurance Interface/StateStore；
- 旧 Candidate/ReviewToken 双身份；
- legacy/new 双写或中途切换开关。

保留的旧任务 Adapter 必须只读、有删除条件和审计。Reviewer/Detector 只有在独立重复配对评测证明高风险样本净收益、成本可接受且无系统性发布失败后，才能以 CandidateCheck 或 observer 形式重新进入在线路径。

---

## 16. 验收标准

### 16.1 依赖约束

自动 AST 检查：

```text
capabilities  不得 import agent / answering / host / tools
answering     不得 import Pi / Electron / HTTP / Tool Schema
agent/tools   不得 import AnsweringStore / ResultStore 具体实现
facets        不得直接修改 Answering Store
electron-host 与 apps/server 不得 import Pi AgentEvent / AgentHarness
contracts     不得 import Pi / Chord / SQLite
presentation 不得 import Harness / Session / SQL Executor / 凭证
```

允许关系：

```text
Session Runtime → Pi + Answering + Capabilities + Tools + Facets
Tools           → 业务 Interface
Facets          → 窄业务 Interface/只读投影
Answering       → SqlExecutor/Store Adapter Interface
Host            → Runtime Public Surface
```

### 16.2 强类型与边界测试

必须通过编译期负例和运行时解码负例证明：

- `TaskId/RevisionId/HypothesisId/EvidenceId/CandidateId` 不可互传；
- 普通字符串不能绕过内部构造器成为可信品牌 ID；
- `QueryObservationEvidence` 不能直接构造 Business Hypothesis 的 supported Resolution；
- 空证据数组不能构造 supported/refuted Resolution；
- Draft Revision 不能传给 result executor；
- Exploration Artifact 不能传给 publish；
- 外部 `query_database` Schema 不接受 `kind=result` 且缺少 `revisionId`，也不接受 exploration 携带 result-only 字段；
- 对每个持久化判别联合执行 exhaustive switch，新变体未处理时编译失败；
- `answering/` 生产代码不存在跨可信 seam 的 `as any` 或导出的品牌构造器。

Runtime 包在完成内核迁移后启用 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 和 `noFallthroughCasesInSwitch`；若旧代码暂时阻塞，必须记录为有截止条件的迁移项，不能通过大面积断言绕过。

### 16.3 状态权威测试

必须证明：

- Agent Operation 只由 Pi Session 决定；
- Query Task 只由 AnsweringStore 决定；生产 Adapter 将其原子映射到当前 Pi Session 的应用状态；
- UI 投影删除后可从权威状态重建；
- 工具重放不会重复 Candidate、Evidence 或 Publication；通用 Usage 和 checkpoint 只由 Pi 记录；
- 旧 Operation ID 不能取消新 Operation；
- 旧 Revision Candidate 不能作为当前 Revision 发布；
- Exploration Artifact 永远不可发布；
- Host 断线不隐式取消持久 Operation；
- Session Worker 重启可恢复已接受 Operation；
- 不可安全重放的副作用被标记为未知，不自动重复。

### 16.4 发布一致性测试

必须覆盖：

- Result SQL 只执行一次；
- Preview 和 CSV 来源于同一封存 Artifact；
- 截断/部分结果不能成为完整 Candidate；
- Receipt 提交前崩溃无用户可见结果；
- Receipt 提交后响应丢失可找回同一 Receipt；
- 猜测文件路径不能绕过 Receipt；
- 大整数、Decimal、NULL、时间和列顺序保持一致；
- 发布过程不调用 SqlExecutor。

### 16.5 变更演练

| 变更 | 应修改 | 不应修改 |
|---|---|---|
| 新增 Excel 发布格式 | Encoder、格式注册、测试 | SQL 执行、Harness、Spec Authority |
| 新增检测规则 | `candidate-checks.ts` 或离线 observer 与测试 | Host、Tools、Publication 事务 |
| 新增模型工具 | 本 Tool、静态注册/贡献、测试 | 其他 Tool、Harness 子类（已不存在） |
| 修改发布阈值 | 新 policyVersion 与测试 | Prompt 控制、Electron/Web |
| 新增 Web Presentation | Presentation Facet/Transport | Query Task、SQL、Agent Operation |
| 更换数据库 | SqlExecutor Adapter | AgentHarness、Answer Spec、UI |
| 升级 Pi Provider | Session Runtime 配置与兼容测试 | Answering 业务逻辑 |

### 16.6 不采用的伪指标

不以以下指标代表架构成功：

- 单文件小于 300 行；
- 类数量越多越好；
- 所有东西都有 Interface；
- 新增工具只修改一个文件；
- 目录层级越深越解耦；
- 仅凭 import cycle 为零宣称运行正确。

真正指标：

- 业务规则只有一个权威实现；
- 调用者不需要掌握内部操作顺序；
- 一个变化不会扩散到无关 Module；
- 失败和恢复行为由稳定身份与持久状态决定；
- UI、Host、模型和数据库不会互相泄漏实现类型。

---

## 17. 对原 v1/v2 方案的修正

| 原方案 | v2.1 判断 |
|---|---|
| 自建组合式 `DataAgentRunner` | 删除；重复 Pi AgentLane/Operation |
| 中立 `DriverEvent` 全量映射 Pi Event | 删除；使用 Lane Snapshot + Event，Presentation 消费 Transcript 投影 |
| QA 五阶段自治 Engine | 删除；保留一个 Answering 深 Module，内部纯计算按职责组织 |
| QA 内部保留 Gate/Detector/Probe/Counterevidence 多层结构 | 继续做减法；合并为 CandidateCheck + Finding |
| SevenFacet/AnswerContract/legacy shape 并存 | 删除平行写模型；只保留唯一强类型 AnswerSpec |
| Hypothesis/Claim/Verification/Disposition 分层持久化 | 只持久化 Hypothesis + Resolution；Disposition 推导 |
| Decision assumption profile/vector 和 selection trace | 删除可推导与伪精确字段；使用 Choice/ChoiceResolution |
| QA 自建 checkpoint、usage ledger 和 JSON journal | 删除；运行状态归 Pi，业务状态归 PiSessionAnsweringStore |
| ValidatedQueryArtifact 与 ExportCandidate 双身份 | 合并为一次执行产生的 ResultCandidate |
| Reviewer/Calibration/Circuit Breaker 位于在线核心 | 移至 evaluation/shadow observer；默认不拥有发布权 |
| 全工具 Provider 插件化 | 收缩；内置静态组合，多贡献者时才使用 Contribution Registry |
| Host 直接拥有 Harness 生命周期 | 删除；Session Host 独占 Harness |
| 类型统一下沉到 `qa/contracts/types.ts` | 删除；类型归概念所有者，wire contracts 单独存在 |
| 通过 Wrapper 替代继承 | 改为直接使用原生 AgentLane 与 Hooks，不增加镜像 Runner |
| 先瘦身 QA 或先完整迁运行时 | 两者都拒绝；先验证 Pi 最小地基，在纵向迁移中随迁随删 |
| 用行数和文件数验收 | 改为依赖、权威、非法状态、恢复和变更演练验收 |

---

## 18. 仍需单独决策的问题

这些不是本文可以伪装成已确定的实现事实：

1. Pi `0.83.0 → 0.85.x` 的实际 Session 兼容性；
2. 第一阶段使用 JSONL 还是 SQLite Pi Session Backend；
3. Session Host 首期同进程还是独立 Worker；
4. 前端首期直接使用 Chord Remote Service，还是由现有 IPC/HTTP DTO 做 Adapter；
5. ResultStore 使用 SQLite blob、应用私有文件还是对象存储；
6. 未连接 Presentation 时 Clarification 的超时与失败政策；
7. Python 是否需要容器级隔离；
8. 历史 Session、QA JSON journal 和 Publication 的一次性迁移/只读保留策略；
9. 旧模型 trace 是否仍需独立兼容回放工具，及其最终删除日期。

推荐默认：

```text
首期同进程 Session Host
+ Pi JSONL/SQLite 以升级 Spike 结果选择
+ 现有 IPC/HTTP 作为 Chord/Application Service Adapter
+ 应用私有 ResultStore
+ 明确超时的 Clarification
+ Reviewer/复杂 Detector 默认仅作为离线或 shadow observer
```

只有出现真实跨进程隔离或动态插件需求后，再启用完整远程 Chord 部署。

---

## 19. 最终设计原则

```text
Data Agent（唯一产品 Agent）
├── Pi AgentHarness：内部执行内核，负责 Session/Lane/Operation/Tool 可靠运行
├── Answering：数据回答业务内核，负责答案如何形成并发布
├── Capabilities：原子执行与纯计算
├── Tools：模型调用业务能力的 Adapter
├── Chord Services：向不同运行环境暴露窄业务能力
├── Presentation：展示，不拥有业务权威
└── Host：身份、生命周期与路由，不解释数据业务
```

高度解耦不是把一个 Data Agent 拆成两个 Agent，也不是把 Pi 藏在更多 Wrapper 后面；而是在同一个 Data Agent 内，让 AgentHarness 只承担执行机制，让 Answering 只承担数据业务规则，让 Presentation 只看到语义 Service。

最终目标是：

> **Agent 执行状态不在业务代码中重复，业务状态不在 Tool 和 Hook 中重复，Presentation 不从底层事件猜业务事实，新增能力不引入新的全局协调机制。**
