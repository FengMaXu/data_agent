---
name: answer-spec
description: 数据查询的 Answer Spec 流程——建立七槽位、处置假设与歧义、探索与最终查询、发布
when_to_use: 每个需要从数据库取数、统计、排名或导出的请求，在第一次调用 begin_answer_spec 之前加载。口径问答、闲聊和纯结果加工不需要加载。
requires-tools:
  - begin_answer_spec
  - revise_answer_spec
  - query_database
---

# Answer Spec 流程

本 Skill 说明 Answering 协议的操作方法。语义分析方法（如何拆题、各槽位要回答什么问题、各类歧义专题）见知识库 `semantic-guide`；SQL 实现规则见 `sql-rules`。

## 1. 流程总览

1. 按需读取 `semantic-guide` 执行步骤和相关专题，拆题。
2. 业务定义、表结构、数据取值交给 `subagent` 的 explorer 收集（可在建立 Spec 前进行）：按 MECE 原则拆成互不重叠、合起来覆盖所需信息的子任务，每个子任务只问一个问题，并行派发；据报告形成七槽位。
3. 按 §6 的决策点清单逐项过一遍，题面没说死的项建成 Choice。
4. `begin_answer_spec` 建立 Spec，登记假设、Choice、证据和全部 8 个决策点；之后一律用 `revise_answer_spec` 修订。
5. 每个 Choice 的每个候选各跑一次探针（§7）；输出相同的 Choice 处置为 `equivalent`，输出不同的调用 `compare_hypotheses` 后用 `decide` 决定。
6. 处置全部未决项、声明全部决策点后，执行一次最终查询，得到 Result Candidate。
7. 发布 Candidate，并披露未证实的决定、推断槽位和数据限制。

## 2. 七槽位

| 槽位 | 内容 |
| --- | --- |
| `entity` | 统计实体与业务键 |
| `metric` | 指标、分子分母与聚合顺序 |
| `filters` | 资格总体与条件作用域 |
| `groupBy` | 分组维度 |
| `time` | 时间字段、窗口和边界 |
| `ranking` | 排序、Top N 和并列政策 |
| `output` | 结果形态、列与行数。`rowCount` 对 `scalar`、`top_n`、`grouped` 都会被核对，结果行数不符即被拒绝；`grouped` 只在题面确定了组数时声明（如"三大行业"），否则省略 |

槽位状态：

- `null`、缺失或 `{ "state": "unknown" }`：未知，会阻止最终查询。
- `{ "state": "not_applicable" }`：当前口径明确不适用。
- `{ "value": ..., "evidenceIds": [...] }`：有合格证据支持。
- `{ "value": ..., "hypothesisId": "..." }`：依赖一个假设，假设必须被处置。
- 纯值：模型推断，不阻断，但记入 `inferredFacets` 并在发布时披露。

已由用户或权威文档明确的内容直接写入槽位并引用证据，不重复登记为假设。

## 3. 建立 Spec（begin_answer_spec）

```json
{
  "spec": {
    "entity": { "value": { "name": "orders", "keyColumns": ["order_id"] }, "evidenceIds": ["q-orders"] },
    "metric": { "value": { "kind": "count" } },
    "filters": [
      { "value": "status = 'completed'", "hypothesisId": "completed-status" }
    ],
    "groupBy": [],
    "time": { "state": "not_applicable" },
    "ranking": { "state": "not_applicable" },
    "output": { "value": { "rowMode": "scalar", "rowCount": 1 } }
  },
  "evidence": [
    { "localId": "q-orders", "kind": "request_wording", "quote": "统计已完成订单数" }
  ],
  "hypotheses": [
    {
      "localId": "completed-status",
      "kind": "business_semantics",
      "statement": "status = 'completed' 表示业务已完成订单",
      "affects": ["filters"],
      "basis": "字段名推断，尚无业务定义",
      "impact": "改变订单资格总体"
    }
  ]
}
```

- 假设分三类，分开登记：`business_semantics`（业务含义）、`physical_mapping`（字段/表映射）、`data_property`（数据性质）。
- 会相互排斥的解释必须建成 `choices`，每个 Choice 至少两个备选；Hypothesis 只用于可以单独被支持或反驳的假定，不要把互斥解释拆成几条假设。新增项用本次调用内的 `localId` 互相引用。
- 新增假设可带 `proposedEvidenceIds`，等同于建立时 `support`：有合格证据时记为已证实，否则记为未证实并在发布时披露；引用不存在的证据才会被拒绝。
- `affects` 只写槽位名（`entity`、`metric`、`filters`、`groupBy`、`time`、`ranking`、`output`）；`denominator`、`output_shape` 等决策点名写在 `decisionPoints`。
- `hypotheses`、`choices`、`evidence`、`decisionPoints` 与 `spec` 并列放在顶层，不要放进 `spec`。
- Choice 要先探针再决定，所以建立时一般不直接决定；只有全部候选都用 `notProbeable` 声明无法单独执行时，才能在建立时用 `decidedAlternativeId` + `decisionRationale`（可附 `decisionEvidenceIds`）直接决定。
- 同一次调用中写 `decisionPoints`（见 §6），例如 `[{ "name": "time_field", "status": "choice", "choiceId": "time-event" }, { "name": "ties", "status": "fixed_by_request", "quote": "列出所有并列的" }, { "name": "window", "status": "not_applicable" }]`。

## 4. 证据

证据由系统核验后才登记，任何一条核验失败，整次调用被拒绝。

| 种类 | 填写 | 核验 | 可支持 |
| --- | --- | --- | --- |
| `request_wording` | `quote` | 必须是原始问题中的逐字片段 | 业务语义 |
| `user_confirmation` | `quote`；引用澄清回答时加 `sourceRef` | 用户本轮消息中的逐字片段（`sourceRef` 省略或写 `message`），或 `ask_user_clarification` 回答中的逐字片段（`sourceRef` 填返回的 `clarificationId`）；其他写法会被拒绝；原始问题不算确认 | 业务语义 |
| `task_document` / `reviewed_definition` | `sourceRef`=knowledgeId，`quote` | 只接受系统授权的业务文档，引文逐字出现在文档中 | 业务语义；已审核定义还可支持物理映射 |
| `schema_fact` | `sourceRef`，可附 `quote` | 不核验 | 物理映射、数据性质 |
| 探索观测 | 引用 `[EXPLORATION_EVIDENCE] evidenceId` | 由探索查询登记 | 数据性质 |

- 给证据写 `localId`，在同一次调用中用 `localId` 引用；之后用系统返回的 Evidence ID 引用。不能按 `sourceRef` 引用。
- 观测数据不能单独支持业务语义假设；通用规则、指引、查询模式和学习记录不是业务证据。
- 题目涉及计算方法或公式（如业务文档、外部知识中的计算说明、指标公式）时，自己用 `read_knowledge` 读取原文相关章节，逐步照原文实现；子 Agent 只用来定位章节，不要依赖它对公式的转述。
- 不要在 `evidence` 中提交 `query_observation`、Preview 或自行构造的观察结果。

## 5. 修订（revise_answer_spec）

修订只提交变化，系统在当前版本上应用。没有提到的槽位、假设和选择原样保留，不要重复提交。

```json
{
  "taskId": "<返回的 taskId>",
  "baseRevisionId": "<当前 revisionId>",
  "spec": { "time": { "value": { "expression": "order_date", "boundary": "inclusive" }, "evidenceIds": ["q-year"] } },
  "evidence": [{ "localId": "q-year", "kind": "request_wording", "quote": "2023 年" }],
  "dispositions": [
    { "action": "support", "hypothesisId": "<已有 ID>", "evidenceIds": ["<已登记的证据 ID>"] }
  ]
}
```

- `spec`：只写要替换的槽位；`filters`、`groupBy` 按整个列表替换。
- `addHypotheses` / `addChoices`：只放新增项。
- `dispositions`：用返回视图中的 ID 处置已有项，每项每次最多一个处置。

| 处置 | 写法 | 条件 |
| --- | --- | --- |
| 支持 | `{ "action": "support", "hypothesisId", "evidenceIds" }` | 至少引用一条已登记的证据。有合格证据时记为已证实，否则记为未证实并在发布时披露，证据不够格不会导致失败 |
| 反驳 | `{ "action": "refute", "hypothesisId", "evidenceIds" }` | 证据必须合格：反驳会让依赖该假设的槽位失效 |
| 决定 | `{ "action": "decide", "choiceId", "alternativeId", "rationale", "evidenceIds"? }` | `rationale` 必填：写明为什么这个候选最符合题面、什么排除了其他候选。可附证据：有合格证据时记为已证实，否则记为未证实并在发布时披露，证据不够格不会导致失败 |
| 等价 | `{ "action": "equivalent", "choiceId" }` | 全部候选的探针输出相同才接受；无需理由和披露 |
| 取代 | `{ "action": "supersede", "targetId", "replacementIds", "reason" }` | 替代项（新增 `localId` 或已有 ID）的 `affects` 必须覆盖原项 |

- `decide` 的结果不是 `compare_hypotheses` 的明显倾向时，必须加 `"adviceOverride": { "reason", "evidenceIds" }`：写明倾向为什么不对，并引用至少一条已登记的证据（可以是探针或探索观测）。
- `decide` 之前，该 Choice 的每个候选都要有探针或 `notProbeable`；配置了 `compare_hypotheses` 时，输出不同（或未知）且影响 `metric`、`entity`、`filters`、`groupBy`、`time` 的 Choice，还要先有比较建议。
- 影响统计总体（`entity`/`filters`）的 Choice 和业务语义假设（`business_semantics`）：会话提供澄清工具时，未证实的决定会被拒绝，需要合格证据或用 `ask_user_clarification` 询问用户；不提供澄清工具时，允许未证实的决定，发布时披露。
- `notProbeable`：`[{ "choiceId", "alternativeId", "reason" }]`，只用于确实无法单独执行的候选。
- `decisionPoints`：只写要新增或改写的决策点，其余沿用。
- 依赖被反驳或被取代假设的槽位、引用被取代项的决策点，必须在同一次修订中改写。
- 已处置的项不能再次处置；需要改判时用 `supersede`。
- 修订被拒绝时不会产生任何改动，也不消耗修订次数；按错误信息修正后重试。

## 6. 决策点与歧义处置

### 决策点清单

每条查询都要做下面 8 个决定。建立 Spec 时逐项声明，全部声明之前不能执行最终查询：

| 决策点 | 要回答的问题 |
| --- | --- |
| `population` | 哪些行和实体算在内；零值、空值实体要不要纳入 |
| `join_multiplicity` | 连接后会不会重复计数，要不要去重 |
| `time_field` | 用哪个事件的时间字段；区间两端含不含 |
| `count_grain` | 按行、按实体还是按事件计数 |
| `denominator` | 比率或平均的分母是什么；分母为 0 怎么处理 |
| `window` | 滚动或累计窗口从哪里开始；前面数据不足时怎么算 |
| `ties` | 并列时取一个还是全部取；按什么规则取 |
| `output_shape` | 输出几行、几列、什么粒度 |

每项声明为以下之一：

- `fixed_by_request`：附 `quote`，必须是原始问题中逐字出现、能直接定下这一项的片段；
- `not_applicable`：这一项与本题无关；
- `choice`：附 `choiceId`，由某个 Choice 决定；
- `assumed`：附 `hypothesisId`，由某个假设决定。

可附 `observationEvidenceIds` 说明依据的数据检查。

### 数据异常检查

声明 `join_multiplicity`、`count_grain`、`ties`、`denominator` 之前，派一个 explorer 查：键是否重复、同一实体同一时间点是否有多条记录、分母是否可能为 0、实体是否跨多个组（州、队伍）、取值编码是否不规范。有异常的项，优先建成 Choice 并做探针。

### 处置 Choice

1. 每个候选跑一次探针（§7）。输出相同的 Choice 直接处置为 `equivalent`，不用再比较或取证。
2. 输出不同的 Choice，按 `semantic-guide` 的“候选对照”把每个候选放回题面逐词检验，写出哪个短语排除了哪些候选。
3. 当前工具目录提供 `compare_hypotheses` 时，传入 `taskId` 和 `choiceId` 请求比较；系统会附上各候选的探针输出。建议不是证据，但它的明显倾向（结果中的 `[ADVICE_LEAN]`）是默认答案：采纳它；只有手上有能排除它的具体证据时才改选，并写 `adviceOverride`。
4. 用 `decide` 决定，`rationale` 写上一步的对照结论；手上有合格证据就一并附上。是否已证实由系统判定，未证实的决定会在发布时披露。影响统计总体的 Choice 在有澄清工具时需要合格证据或用户确认（§5）。

## 7. 探索与最终查询

```text
query_database(kind="exploration", taskId, sql, limit?)
query_database(kind="exploration", taskId, sql, probe={ choiceId, alternativeId })
query_database(kind="result", taskId, revisionId, sql)
```

探针：

- 探针 SQL 按该候选的口径计算**最终输出**（其他 Choice 取当前处置，未处置的取当前倾向），不是中间量。
- 系统读取完整输出并计算输出标识（忽略列名、列顺序、行顺序，数值按两位小数比较），结果中的 `[CHOICE_PROBE] output=...` 相同就表示两个候选给出同一个答案。
- 探针不占探索次数，每个任务最多 24 次；同一候选再跑一次会替换旧记录。

探索：

- 信息收集优先委派 explorer：它返回 Markdown 报告，不占用主上下文的原始结果；报告只提供信息，结论由你判断。
- explorer 的查询不登记为任务证据。需要用观测支持 `data_property` 假设时，自己执行一次 `query_database(kind="exploration")`，引用返回的 evidenceId；引用业务定义时使用报告中的逐字引文和 knowledgeId。
- 只验证字段、值编码、时间范围、连接基数等可能改变答案的未决点；每次解决一个问题，保持有界。
- 探索产物不能发布，也不会自动改变 Spec；发现需要改口径时先 `revise`。

SQL 是当前唯一的生产查询路径：不要调用未安装的语义层工具，也不要在同一任务中切换到另一套查询协议。

最终查询：

- 只能绑定当前 Revision，且其未知槽位、未决假设、未决选择都已处置，8 个决策点都已声明。
- 结果与某个未采纳候选的探针输出相同时，系统以 `CHOICE_NOT_REALIZED` 拒绝：让 SQL 实现已采纳的候选，或带理由修订处置后再查。
- 只执行一次，生成不可变的 Result Candidate；截断、部分完成或与明确输出形态冲突的结果不能成为 Candidate。
- CandidateCheck 拒绝时修正 SQL；只有业务证据确实改变口径时才修订 Spec。
- `[SPEC_FEEDBACK]` 只提供核对信息：据此取证，有合格依据才修订，不为让反馈变绿而反复改口径。
- `[IMPLEMENTATION_OBSTACLE]` 按 `kind` 判断：技术失败在预算内修 SQL；业务判断、映射不足、预算耗尽或执行结果未知时回到取证、澄清或说明限制，不自动重跑未知结果。
- 修订、探索、最终查询和观测行数共享同一任务预算，修订和委派都不会重置预算。

## 8. 发布

- 行数 ≤ 10：`publish_query_result(candidateId, format="inline")`
- 行数 > 10：`export_query(candidateId, format="csv")`

发布不会重跑 SQL，也不能用 Preview 拼接完整结果。回复中说明结果对应的口径，并转述 `[DISCLOSURE]` 中未证实的决定、推断槽位和检查限制。`inspect_answer(taskId)` 可读取任务的只读投影。
