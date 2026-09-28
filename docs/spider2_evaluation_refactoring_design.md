# Spider2 评测框架重构方案

> 状态：阶段 1–4 的代码落地与常规/受控验收已完成；Gold 兼容性检查（3 个 SQLite Gold SQL）和 API/Agent canary 已执行，但 Agent canary 未形成可评分 submission；完整 Spider2 rollout 仍需按显式、有预算的命令执行。  
> 基线：当前工作区源码及本地配置，包含尚未提交的 Answering Fanout、Spec Feedback、Tool Prompt Catalog 等改动。源码行为不等于当前 dist 或已部署实例行为。  
> 目标：让当前 Data Agent 的真实运行行为能够被可信记录、独立评分和公平比较，而非建设通用 Agent 评测平台。

## 1. 背景与结论

参考文章：[Hidden Technical Debt of AI Systems: Agent Evaluation Infrastructure](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)。

本文只采用文章的三个原则：

1. **实验可归因**：知道改变了什么、保持了什么，能够比较逐题改善与退化。
2. **观测可信**：结果、过程、成本和失败状态应来自真实执行，不能从展示文本或缺失字段猜测。
3. **记录可复用**：运行证据能够独立重评分、分析和转为回归用例，不能依赖重新调用模型才能解释历史结果。

不把文章提到的 checkpoint、环境分支、OTel、Dashboard、生产发布平台当作本项目必须补齐的清单。

**记录模型采用轻量的 `event + span + artifact`：event 保存离散事实，span 表达一段工作的归属、时序与调用结果，artifact 承载受控内容。首版使用本地 JSON/JSONL，不依赖 OpenTelemetry SDK 或后端。**

### 1.1 重构结论

保留生产运行链路，将现有 Spider2 Runner 收敛为四个职责明确的 Module：

```text
CLI
 ├─ Experiment：解析有效配置、确定实验身份
 ├─ Episode：运行一次真实 Agent attempt
 ├─ Record：保存可信观测与已授权交付物
 └─ Evaluation：离线评分、比较和报告
```

优先修复四类问题：

- 配置声明与实际运行行为不一致；
- 观测经过 Presentation 有损转换；
- 重试与恢复没有清晰的 attempt 身份；
- 报告脚本仍按不同代协议解释当前结果。

**先修好测量工具，再用实验决定 Agent 怎么改。**

### 1.2 本文性质

- 本文提出的是目标设计，不表示相关 Interface、命令、文件或测试已经存在。
- 当前行为以源码为主要证据；README 和旧评测方案仅用于识别历史约定与漂移。
- 本地设置描述针对未额外传入 CLI、环境覆盖的启动情形，不代表对运行中进程的检查结果。
- 重构不得借机改变 Answering 的业务语义、证据等级或发布授权。

## 2. 当前基线

### 2.1 实际装配路径

```text
evaluations/spider2/run.mjs
 → 准备每题 knowledge / workspace / MCP executor
 → DataAgentSessionApplication
 → createDataAgentSessionHost
 → Pi AgentHarness / Session / Lane
 → 当前 Answering
 → Result Candidate / Publication Receipt
 → Spider2 submission / 官方 evaluator
```

评测已经复用了生产 Session Runtime。应继续保留，而不是另写一套“专供评测”的 Agent。

### 2.2 当前设置与实际行为

| 项目 | 当前源码与本地设置 | 重构含义 |
|---|---|---|
| 主模型 | 默认本地配置通过 `DEFAULT_MODEL` 解析；Profile 可覆盖 | Manifest 记录解析后的实际模型配置，而非变量占位符 |
| 并发与外部预算 | 并发 3；每题 300 秒、30 轮、50 次工具调用 | 保留为 episode 级限制，明确其计数范围 |
| Answering 预算 | 默认 8 次修订、16 次探索、8 次结果实现、15 分钟、200000 观测行 | 独立于 episode 预算；必须显式记录，不得隐藏在默认值中 |
| 旧探索上限 | `maxExploratoryQueries` 没有接入当前 Answering 预算 | 删除失效字段或显式迁移，不能继续接受但不执行 |
| Fanout | Answering 内默认在适用条件下执行；默认只告知 | 不受旧 `assurance.detectors.enabled` 控制 |
| Spec Feedback | 需显式设置 `TYPESAFE_SPEC_ALIGNMENT=1` 且具备凭据 | 本地文件未启用该标志；不能因配置了假说比较就宣称已开启 |
| Hypothesis Advisor | 具备 Jev 凭据与对应实现时注册 | 当前本地设置满足凭据条件；注册不等于每题调用 |
| 子 Agent | Runner 显式 `enableSubagents: true` | 需要纳入有效配置、预算和成本记录 |
| Widget / Dashboard | Runner 未显式关闭，Core Tools 缺省开启 | 与 README 描述不一致；必须显式确定题目工具范围 |
| 工具提示 | Tool Prompt Catalog 按当前模型请求的工具集合动态注入 | `.pi/SYSTEM.md` Hash 不是完整模型输入身份 |
| 旧 Assurance | 部分配置只作为 offline metadata；旧 detector policy 被禁用 | 新运行配置不再保留无效开关 |

主要实现位置：

- `evaluations/spider2/run.mjs`：`loadConfig`、`profileFromConfig`、`createCaseRunner`。
- `packages/runtime/src/application/session-runtime.ts`：`createDataAgentSessionHost`。
- `packages/runtime/src/answering/service.ts`：`DEFAULT_QUERY_BUDGET_POLICY`、`InMemoryAnsweringOptions`。
- `packages/runtime/src/tools/core.ts`：工具注册条件。
- `packages/runtime/src/agent/tool-prompt-models.ts`：请求级工具提示拼接。

### 2.3 当前需要修复的具体接缝

#### A. Presentation 被当作完整执行证据

当前事件路径为：

```text
Pi 事件 → Presentation 投影 → nativeEventFromPresentation → createRecorder
```

Presentation 面向界面，不是无损运行记录：

- `nativeEventFromPresentation` 没有恢复完整 `message_end` 与模型 usage。
- `TranscriptProjector` 会将 `agent_error` 转为提示文本与 `agent.completed`。
- 等到 operation 不再 open，不等于已经获得成功终态和失败原因。
- Phase 6 从 `events[].message.usage` 读取成本，其输入假设与当前事件链不一致。

因此不能只改报告格式，必须先修复观测来源。

#### B. 交付物存在绕过正式读取 Interface 的分支

`collectArtifacts` 可读取私有 ResultStore 文件并手工拼接 CSV。项目已经提供 `ApplicationAgentAdapter.readPublication` 和 `ArtifactDirectory`，应直接复用。

#### C. `--resume` 不保证干净重试

当前 case 目录、session ID 与 transcript 目录被重复使用，Application 可以重新打开已有 Session；结果与 Manifest 又会更新。因此既不能简单称为“从头重跑”，也没有明确表达它继承了哪些状态。

#### D. 评分消费者没有同步当前协议

- 当前 Runner 支持无旧审批状态的 Receipt，并可记录 `publicationStatus: published`。
- `baseline-report.mjs`、Phase 6 仍主要识别旧审批状态。
- Phase 5 读取旧 `manifest.assurance`，当前 Runner 使用 `assuranceObserver` 与 `answering`。
- Phase 6 仍读取旧 `mode`、`decisionProposals` 等字段。
- Phase 6 中 `integrityNegativeContractsPassed` 被直接设为 `true`，不来自实际测试结果。

这些是测量正确性问题，优先于增加新指标。

## 3. 范围与非目标

### 3.1 保留

- 生产 Pi Session / Lane / AgentHarness 的执行、取消与恢复能力。
- Answering 的 `begin / revise / execute / publish / inspect` Interface。
- Query Task、Revision、Evidence、Candidate、Receipt 的权威与身份关系。
- 当前 Fanout、Spec Feedback、Hypothesis Advisor 和 Delegation 的职责。
- 每题知识和工作区隔离。
- Spider2 官方 verifier 与固定题目分母。
- 已有确定性测试、负向完整性测试和可复用统计方法。

### 3.2 本轮不做

- 不复刻博客中的通用 control-plane/data-plane 平台。
- 不恢复旧 Reviewer、Interpretation Enumerator 或旧 Query Assurance 状态机。
- 不为兼容 README 而重新实现旧 `calibrate` 命令。
- 不建设通用任务注册中心、插件系统、规则中心或独立评测数据库。
- 不引入任意环境 snapshot、浏览器状态回放或从任意 checkpoint 分支的系统。
- 不要求部署 OTel、评测 Dashboard 或自动发布回滚平台。
- 不调整业务口径以提高 Gold 得分，不向 Agent 注入 Evaluation Gold。
- 不在重构过程中静默关闭工具、改变预算或改变生产默认策略。

## 4. 必须保持的不变量

1. **Pi 是运行状态的唯一权威。** 评测层保存记录，但不重新实现运行、取消或恢复状态机。
2. **Answering 是查询业务状态的唯一权威。** 评测层不能修订 Spec、制造 Candidate 或生成 Receipt。
3. **Receipt 是交付读取依据。** 不按文件名、预览或“最后一次 SQL”猜测正式结果。
4. **Gold 只在离线评分侧。** 不进入知识装配、模型提示、Jev 输入或运行时检查。
5. **观察不等于裁决。** Fanout finding、Spec Feedback supported、已发布都不等于业务正确。
6. **未知必须保留。** 缺 usage、缺观察或缺检查报告不能自动转为 0、false、clear 或 passed。
7. **实验定义不可静默漂移。** 配置或题目集改变应产生新实验身份。
8. **同一个 attempt 的预算不能因恢复而重置。** 新 attempt 与恢复同一 attempt 必须明确区分。
9. **同一输入装配与同一记录来源。** 不单独拼一份“看起来相同”的 Manifest。
10. **不要求固定推理路径。** 过程评分围绕授权、身份、证据和恢复不变量，而非某个黄金工具调用顺序。

## 5. 目标 Module 与 Interface

以下名称和 Interface 为目标草图，可在实现时调整；不要求新增大量转发层。

### 5.1 Experiment

职责：将配置文件、CLI、环境引用、Runtime 默认值和任务资源解析成可执行的实验定义。

最小 Interface：

```ts
resolveExperiment(input): Promise<ResolvedExperiment>
```

内部负责：

- 校验配置并拒绝不支持的字段。
- 解析模型、工具、预算和能力开关。
- 确定固定题目集及 scorer 身份。
- 获取构建产物和任务资源身份。
- 生成用于运行与 Manifest 的同一份装配计划。

`ResolvedExperiment` 至少包含：

```text
schemaVersion
suite：题目集、数据集、题面版本
subject：实际模型、生成参数、Runtime/build 身份
capabilities：工具、Fanout、SpecFeedback、Advisor、Delegation
budgets：episode / queryTask / delegation
inputs：Prompt、知识、Skills、工具提示与数据库身份
scoring：scorer 版本、评分参数
attemptPolicy：continue / retry / 纳入主报告的规则
comparisonPolicy：固定因素、允许变化因素、重复与比较规则
```

凭据只以受控引用存在。持久化文件不得包含密钥或含凭据的 URL。

#### 生效值与执行状态分开

```text
configured：配置要求什么
resolved：实际装配了什么
executed：本次是否执行
coverage：是否适用、是否支持、是否完成
```

例如，Fanout 没触发不代表被禁用；SpecFeedback unavailable 不代表没有配置。

#### 预算分工

- Episode 预算约束整体时长、主 Agent 轮次和明确范围内的工具调用。
- Query Task 预算沿用 Answering 的修订、探索、结果实现和观测行计数。
- Delegation 预算约束子任务数量、并发、时长和子任务工具使用。
- 父任务、子任务和 Fanout 探针共享的 Query Task 消耗仍由 Answering 计费。
- 总耗时截止时间与内部截止时间必须说明组合规则，不按某一配置字段推测整体无限制。
- 若要改变计数范围，作为独立行为变更评估，不混入纯重构基线。

### 5.2 Episode

职责：在固定实验定义下执行一个 task 的一次 attempt，等待真实终态并完成资源清理。

最小 Interface：

```ts
runAttempt(experiment, task, attempt): Promise<AttemptResult>
```

内部继续使用 `DataAgentSessionApplication`，而非新建评测 Agent。

必要工作：

1. 准备本 attempt 的 Session、知识、workspace 和 MCP。
2. 将解析后的配置传入生产 composition root。
3. 在执行开始前接入观测。
4. 提交 prompt，记录被接纳的 operation ID。
5. 等待权威终态，而非只轮询 open operations。
6. 超时后请求取消，区分已确认取消与取消结果未知。
7. 收集只读运行记录和已授权交付物。
8. 完成主/子运行及 MCP 清理。

评测层只控制“要运行哪个 attempt”，不管理 Pi 内部状态转换。

### 5.3 Record

职责：把生产运行证据一次归一化为稳定的、可审计的 `event + span + artifact` 记录，让多个报告复用同一份结构，不再分别配对工具事件或解析错误文本。

最小 Interface：

```ts
captureAttempt(source, destination): AttemptRecorder
// AttemptRecorder 保存追加式事件，完成后封存 EpisodeRecord 与 span 投影；不反向控制 Agent。
```

生产 Runtime 提供窄的只读 observation Interface，负责隔离 Pi 的具体事件与存储格式。评测脚本不能散落读取 Pi 私有 namespace 或直接解释其内部文件。

#### 5.3.1 三种记录的职责

| 记录 | 表达什么 | 当前场景 |
|---|---|---|
| Event | 某个时点发生的离散事实 | Revision 提交、Candidate 封存、Receipt 产生、实现障碍、span 开始/结束观察 |
| Span | 一段工作的归属、持续时间与调用结果 | Agent operation、模型请求、工具、SQL、Fanout、Jev、子 operation |
| Artifact | 需要引用的受控内容及身份 | SQL、知识摘录、模型输入输出、正式交付物；按授权和必要性保存 |

```text
Pi / Answering / Delegation 的真实事件与持久化状态
                       ↓
                只读 observation
                       ↓
             events.jsonl（追加事实）
                 ├─ spans.vN.jsonl（可重建投影）
                 ├─ artifacts.json（受控引用目录）
                 └─ episode.json（归一化摘要与完整性）
```

Span 是观测投影，不是第二套执行状态机；不能负责重试、取消、预算扣减或发布授权。Answering 的 Revision/Candidate/Receipt 继续是业务状态权威。

首版不部署 OTel。若以后需要外部追踪，只增加读取该模型的导出 Adapter，不让存储后端决定领域语义。

#### 5.3.2 Span 粒度与归属

一个 attempt 使用一个 trace，包含主 Agent 及本 attempt 的子运行。建议的逻辑层级：

```text
attempt
 └─ agent.operation
     ├─ model.request
     ├─ tool.update_answer_spec
     │   └─ jev.spec_alignment
     ├─ tool.compare_hypotheses
     │   └─ jev.hypothesis_choice
     ├─ tool.subagent
     │   ├─ child.operation
     │   │   ├─ model.request
     │   │   └─ tool.query_database
     │   │       └─ db.exploration_query
     │   └─ child.operation
     └─ tool.query_database
         ├─ db.result_query
         └─ answering.fanout
             └─ db.probe
```

- 首版覆盖 operation、模型请求、工具、子 operation、SQL、Fanout 和 Jev 调用，不为每个校验函数、Store 读写都创建 span。
- 只有实际发生的工作才创建执行 span。能力被禁用或不适用时记录配置/coverage，不伪造已执行的零时长 span。
- 父子关系表达实际调用归属。并行子 Agent 是并列 span；异步工作不得靠时间邻近猜父调用。
- Revision、Candidate、Receipt 跨越多次调用，用 `links` 引用，不强行挂成执行树。
- 在 Runtime 的受控观测上下文中传播 trace/span 关联，不给业务 ID 改格式，也不要求模型提供关联 ID。
- Retry 创建新 attempt 与 trace，并通过 `retryOf` 关联；Continue 保持同一 attempt/trace，恢复阶段可创建新的执行分段，不重置原预算。
- Rescore 使用独立评分记录；如记录评分 span，使用独立 trace 并链接原 attempt/产物，不重新打开已经封存的 Agent span。

#### 5.3.3 最小字段契约

以下为目标字段，不表示已实现；具体 TypeScript 枚举在实现时与当前 Interface 对齐。

| 字段 | 约束 |
|---|---|
| `schemaVersion / projectionVersion` | 区分记录格式与归一化规则版本 |
| `runId / caseId / attemptId / traceId` | 标识实验、题目与本次尝试 |
| `spanId / parentSpanId` | span 唯一身份和实际父调用；根为空，关联缺失须显式说明 |
| `kind / name` | 稳定类别及操作名，如 `model.request`、`tool.query_database` |
| `sessionId / operationId / invocationId` | 可用的权威执行身份，不凭字段名自行构造 |
| `startedAt / endedAt / durationMs` | 可缺失并附原因；不以记录接收时间代替实际执行时间 |
| `lifecycle / outcome` | 观测是否结束；调用完成、失败、取消或结果未知；开放时 outcome 尚未确定 |
| `links` | 带类型的 task/revision/candidate/receipt、其他 span 或前序 attempt 引用 |
| `usage` | token/cost、单位、计量范围及来源；允许未知，不以 0 补齐 |
| `inputRef / outputRef` | 受控 artifact 引用，不在 span 中重复保存完整结果 |
| `sourceRefs` | 指向原始观察或持久化事实，支持去重与追溯 |
| `observationCoverage` | 完整/部分/缺失及原因，与执行结果分开 |

Event 至少携带事件 ID、类型、发生时间、记录时间、来源、关联 trace/span 和必要的业务引用。序列号只在声明的来源/流内保证顺序；不能把多个进程的到达顺序当作全局执行顺序。

Span 的 `outcome=completed` 只说明调用完成，不代表检查 clear、报告覆盖充分、答案正确或允许发布。领域 coverage、ImplementationObstacle.executionOutcome 和离线 Correctness 分别保留，不能合并成一个 `error`。

#### 5.3.4 归一化、去重与恢复

- 从 Pi 真实事件与持久化状态获取终态、usage，不从 UI 文本反推。内部检查需最小被动观测时，在其调用 Seam 采集，不恢复旧通用 Hook 框架。
- 在运行过程中追加落盘，避免只在 finally 写入。Span 由 start/end/恢复确认等事件归一化；不要求同步维护另一份可写执行状态。
- 用权威 invocation/request 身份和来源事件身份关联；相同持久化调用的恢复记录不能再次计费。发生了新的实际外部调用，则是新的 span，即使 SQL 或 Prompt 相同。
- 对重复、乱序事件做幂等归一化；相互冲突的终态保留冲突及覆盖限制，不用“最后一条覆盖”隐藏问题。
- 只有 start 没有 end 表示观察尚不完整，不等于失败。结合 Pi/Answering 持久化状态核对；仍无法确认则保留 unknown，不自动重新执行。
- Runtime 已确认结束但结束时间缺失时，可确认 outcome，duration 仍未知；不能编造时间补齐。
- 运行中投影可重建。封存后若获得迟到证据，追加来源记录并生成新投影版本，保留旧版本；报告绑定具体投影版本，不改写原报告依据。
- 观测写入失败不能改变生产业务裁决；评测运行须标记记录不完整，按实验政策拒绝正式比较，不能悄悄当作完整成功。

#### 5.3.5 耗时与费用规则

**耗时：**

- Attempt 延迟取实际起止墙钟区间，不能累加所有 span。
- 父 span 包含子工作等待，父子 duration 不直接相加；并行子 span 也不相加成总延迟。
- 单进程 duration 优先使用单调时钟；跨进程保留时钟来源与限制，不凭时间戳先后推断精确等待或关键路径。
- 只有覆盖完整且时钟可比较时，才可从父区间扣除子区间的并集估算非子调用耗时；首版不要求计算通用关键路径或 exclusive time。
- 报告区分 Agent 工具调用次数、内部 SQL 执行次数和 Fanout 探针次数。

**Usage / cost：**

- 优先绑定到实际模型/Jev 请求。主 Agent、子 Agent、Advisor 与 SpecFeedback 分类统计。
- 父 span 可展示派生汇总，但标记为 aggregate，不能与叶调用再次累加。
- Session 累计 stats 不能直接当本次 operation 成本；按明确范围或无并发歧义的起止增量计算。只有总计而无请求拆分时保留在已知范围，不能平均分摊到子 span。
- Provider-reported 与估算费用分开，估算应附价格版本、单位与币种；缺数据为 unknown，不填 0。
- 汇总给出已知小计与缺失覆盖率；覆盖不足时不宣称总成本为已知小计。

#### 5.3.6 Artifact 与数据保护

- Span 中只存必要属性和引用，完整 SQL、知识与模型内容按任务需要保存在受控位置；不因采用 span 就默认额外采集模型内部推理或敏感正文。
- Artifact 目录记录身份、内容类型、Hash、访问类别及脱敏/截断情况，不接受任意路径绕过读取授权。
- 私有观察 Artifact 与正式发布 Artifact 分开；记录中出现某个 resultRef 或 Hash 不授予读取权。正式交付继续走 §7 的 Receipt 授权路径。
- 密钥、授权头和连接凭据不得进入事件、span 或 artifact 属性。内容摘要/Hash 也不能代替权限控制。
- 首版记录所列关键生命周期事件，不对其静默采样；正文可以限量并标注截断。保存为 JSON/JSONL，不引入独立存储服务。

### 5.4 Evaluation

职责：从封存记录和已授权产物离线评分、比较和生成报告。

最小 Interface：

```ts
scoreAttempt(record, scorer): Promise<ScoreRecord>
compareExperiments(left, right, policy): ComparisonReport
```

- 不运行 Agent。
- 不修改 EpisodeRecord。
- 不从模型文本或旧工具参数推测交付状态。
- 官方 SQL 模式可能自行执行提交 SQL，但不重跑 Agent，也不改变 Runtime Candidate。
- 每次重评分生成独立 ScoreRecord，绑定 scorer、输入 artifact 和运行参数。
- 不为了通用化先建立 verifier registry；当前官方 evaluator 和本地过程检查已经足够。
- Evaluation 统一读取绑定版本的 EpisodeRecord、span 投影与领域事件；报告不再各自配对 start/end 或推断父子调用。
- 归一化错误在 Record Module 修复一次；重建投影后生成新报告版本，不静默改变既有报告。

## 6. 有效输入与实验身份

### 6.1 不能只冻结 `.pi/SYSTEM.md`

当前实际输入还包括：

- knowledge catalog 与每题业务/Schema 文档；
- `rules.md`、`semantic_guide.md`、`learning.md` 等内容；
- Skills 内容及授权工具集合；
- Tool Prompt Catalog 的 snippets/guidelines；
- 子 Agent 的任务输入及工具范围；
- 模型请求的实际 active tools；
- Jev 模型、配置与规则版本；
- Answering 和 Delegation 的有效默认预算。

目标设计保存内容指纹和受控内容引用。请求级动态工具集合应留有观测，避免把基础 Prompt Hash 冒充完整请求 Hash。

### 6.2 初始状态的最小定义

对当前只读查询任务，不建设通用环境快照。只需要固定：

- 数据库文件或数据包的可核验身份；
- 任务知识与 Schema 内容；
- 本 attempt 的干净 workspace 和 Session；
- 相关 Runtime/build、工具与 Prompt 身份。

本地 SQLite 能校验内容时应校验实际内容，而非仅相信配置中的 Hash 字符串。云数据库若无法固定 snapshot，应报告初始状态稳定性限制，不能宣称确定性可复现。

知识写入、文件写入保留为 attempt 内状态；不得自动传播到其他题或重试。首版记录相关调用与必要内容引用，不要求逐文件系统调用 snapshot。

### 6.3 构建一致性

Runner 当前依赖 dist。预检应证明：

- 本轮实际运行的构建产物来自声明的源码/依赖输入；
- Manifest 保存的是实际加载产物身份；
- 未提交改动不能只用 HEAD commit 代替。

可采用构建时生成的 provenance 文件，将源码/lockfile 指纹与 dist 指纹关联。生产和评测不各自实现一套构建身份规则。

### 6.4 比较身份

身份分为固定因素与实验因素，而不是要求两轮所有 Hash 相同：

- 同题单、同初始数据、同 scorer 通常属于固定因素。
- 本轮要验证的模型、Prompt 或能力开关属于允许变化因素。
- 未声明的差异应使比较标为不可归因，不能只输出分数增减。
- 输入文件必须按内容版本保留，不能只引用后续会覆盖的全局 `_baseline` 锁文件。

## 7. 交付物采集

### 7.1 唯一路径

```text
Answering Publication Receipt
 → ApplicationAgentAdapter.readPublication(receiptId)
 → ArtifactDirectory 授权读取及内容完整性检查
 → 保存正式交付内容
 → Spider2 submission
```

应删除新运行路径中的：

- 直接猜测私有 ResultStore 路径；
- 从 Preview 拼完整结果；
- 手工实现第二套 CSV 编码；
- 无 Receipt 时退回最后一次查询或任意 CSV 的兜底。

SQL 来源为 Receipt 绑定的 Candidate 只读投影。若现有 Application Interface 未暴露所需 SQL，在 Runtime 内增加最小授权投影；不得由评测层任意读取 Candidate Store。

### 7.2 交付类型与评分类型

- Spider2 当前任务约定要求 CSV，应显式保留为任务要求。
- Runtime 支持 inline 不代表所有任务都必须接受 inline。
- 没有 CSV 但确实发布了 inline，应分别记录“已发布”和“未满足本任务的交付格式”，不能当作没有 Receipt。
- 零行结果只要完整并保留必要表头，就不能仅因零行被判为交付失败；正确性由 scorer 决定。
- 已成功发布后又发生 cleanup 错误，应保留发布事实，另记清理失败，不能互相覆盖。

## 8. Attempt、恢复与重试

### 8.1 三种不同操作

| 操作 | 定义 | 身份及状态 |
|---|---|---|
| Continue | 继续同一个未完成 attempt | 相同 attempt，使用 Pi 的恢复机制，不重置预算 |
| Retry | 新建一次尝试 | 新 attempt、新 Session/workspace，保留旧记录 |
| Rescore | 对保存的产物重新评分 | 不调用 Agent，生成新 ScoreRecord |

新 CLI 命名可以为 `continue / retry / score`，但必须等实现后才对外承诺。旧 `--resume` 不应继续保留模糊语义；提供明确迁移提示。

### 8.2 存储建议

```text
<run>/
  experiment.json
  inputs/
  cases/<caseId>/
    attempts/<attemptId>/
      attempt.json
      events.jsonl          # 追加式事实与 span 生命周期观察
      spans.v1.jsonl        # 版本化归一化投影，可由事实重建
      artifacts.json        # 内容身份、受控引用与访问类别
      episode.json          # 摘要及绑定的记录/投影版本
      session/
      knowledge/
      workspace/
      submissions/
  scores/<scoreRunId>/
  comparisons/<comparisonId>/
```

这是评测存储组织，不是新的生产持久化体系。Pi Session、Answering 和 ResultStore 仍由原有 Adapter 管理。

### 8.3 生命周期规则

- attempt 创建时记录实验身份、输入身份和初始状态来源。
- 运行中追加事件，完成后封存终态；已封存记录不覆盖。
- Continue 必须校验配置和输入身份，不得在相同 attempt 下换模型或预算。
- 无法确认执行结果时保留 unknown，不自动重新执行可能已有结果的操作。
- Retry 总是显式记录 `retryOf` 和原因，不复用旧 Session 历史。
- 原 Manifest 的固定题目集不因局部重试缩小。
- 不通过评分后挑选更好的 attempt。
- 预先定义纳入主报告的 attempt 政策；性能性失败不因重试成功从原报告中消失。
- 因基础设施故障需要替换 attempt 时，记录替换依据并遵守冻结政策，保留原始失败证据。
- 多次重复实验是不同计划内重复，不与故障重试混为一谈。

## 9. 统一记录与评分语义

### 9.1 EpisodeRecord 四个正交维度

| 维度 | 示例状态 | 来源 |
|---|---|---|
| Execution | completed、budget_exhausted、provider_failed、infra_failed、cancelled、unknown | Pi 终态、预算与实际故障 |
| Publication | published、not_published、invalid、unknown | Receipt 和授权产物读取 |
| Correctness | correct、incorrect、unavailable | 绑定输入的离线 scorer |
| Coverage / Process | checked、finding、unknown、not_applicable、disabled 等 | 对应版本的检查及过程记录 |

字段枚举在实现时结合当前类型确定，不应直接替换生产领域枚举。EpisodeRecord 是评测只读归一化结果。

### 9.2 核心报告

每轮至少报告：

- 固定题目数、有效执行数、基础设施失败数、记录缺失数；
- 正式交付率和满足题目格式的覆盖率；
- 官方正确率与固定分母正确率；
- 单题改善、退化与不变集合；
- 主/子 Agent/Jev 的调用、token、成本与缺失覆盖率；
- 总延迟、p95、超时与取消确认情况；
- 修订、探索、结果实现和探针消耗；
- Fanout、SpecFeedback 的 configured/executed/coverage 状态；
- 按稳定 span kind 分组的耗时、调用量、失败率与观测完整率，区分工具总时长、内部 SQL、Jev 和子 Agent；
- 开放/终态未确认 span、缺失父关联及来源冲突数量，不把记录缺失解释为工作未发生。

耗时与费用的汇总统一遵循 §5.3.5。A/B 可直接比较同类 span 的分布；不同检查适用范围或调用选择造成的样本变化需披露，不能只比较平均值后归因。

有 provider/infra/scorer/记录缺失时，不把未知项静默计为正确或错误。正式比较先判断是否具备完整有效数据；不完整运行只提供明确标注的诊断结果。Agent 在有效执行中未提交或预算耗尽，仍按已冻结的固定分母政策计入。

### 9.3 过程检查

围绕当前协议的不变量：

- 是否先建立 Spec 再查询；
- 未决项存在时是否越过结果执行边界；
- 探索 Artifact 是否被错误发布；
- 发布是否绑定当前 Revision、Candidate 和结果；
- 未知执行结果是否被自动重跑；
- 子 Agent 是否尝试超出授权范围；
- 检查 unavailable 是否被冒充 clear；
- 检测或反馈是否被当作 Evidence 或语义批准。

需注意：尝试违规并被 Runtime 拒绝，与违规实际成功是两种事件。报告同时保留，不能把“被成功拦截”直接计成系统完整性失效。

### 9.4 统计比较

- 优先逐题配对和明确的切片，如复杂聚合、口径歧义、Fanout 适用性、Delegation 使用情况。
- 复用现有 clustered bootstrap，而不是另建统计框架。
- 只有实验身份和数据完整性满足比较条件时，才给出正式效果判断。
- 重复数、阈值和主指标在运行前冻结，不从结果反向挑选。
- 非确定性模型/API 调用不承诺位级一致；“可复现”首先指输入可恢复、条件可核验和统计可比较。

### 9.5 历史兼容

- 新报告只读取当前 EpisodeRecord。
- 历史格式由单独的版本 Adapter 转换，不在每个报告里继续堆叠兼容分支。
- 不能恢复的字段标记 unknown，并列明限制。
- 不自动把旧 `published_approved` 转成当前语义正确性标签。
- 不把旧阶段 A/B 的结论直接推广到当前配置。
- Phase 5、Phase 6、baseline-report 的共同解析与指标逻辑迁入 Evaluation；旧脚本可短期保留为显式历史入口，随后删除重复实现。
- `integrityNegativeContractsPassed` 必须来自绑定构建的实际测试证据；没有证据时 unavailable，不能硬编码通过。

## 10. 当前能力的受控实验

本轮重构不预设哪个能力有效，也不一次运行全排列。围绕最新能力，每轮提出一个问题。

| 实验因素 | 要回答的问题 | 必须同时观察 |
|---|---|---|
| Spec Feedback | 是否减少题意遗漏或无依据声明？ | 交付、正确率、修订、延迟、反馈不可用率 |
| Hypothesis Advisor | 是否改善互斥假说的处理？ | 是否保留应澄清项、调用成本、无依据强选 |
| Delegation | 是否改善有界探索/独立审阅？ | 主子调用量、报告覆盖、超时、总成本 |
| Fanout 告知 | 是否帮助避免度量复制问题？ | 适用范围、unknown、探针预算、合法重复误导 |
| 工具提示/知识策略 | 是否减少无效读取并保留必要依据？ | 重复内容引用、首条 SQL 延迟、正确率 |

Fanout、SpecFeedback 均保留当前 advisory 性质。不通过实验配置关闭发布完整性或允许 Gold 进入运行时。

### 10.1 少量必要的扰动

利用当前已存在的 Seam，不建立通用故障注入平台：

- SQL executor：一次超时、明确失败、结果未知、空结果；
- SpecAlignmentAssessor：不可用、超时、非法响应；
- 任务知识装配：低权威经验与更高权威材料冲突；
- Delegation：失败、取消未确认、覆盖不足或过期报告；
- 发布读取：内容 Hash 不匹配或产物不可用。

区分两种用途：

1. **确定性测试**验证程序是否正确处理状态与错误。
2. **真实模型小样本实验**验证 Agent 收到这些观察后如何行动。

前者通过不能冒充后者有效，后者也不能替代程序完整性测试。

## 11. 测试与验收

### 11.1 保留现有测试，补充真实接缝

当前 `npm run test:eval:spider2` 已覆盖 66 项测试，并包含一条真实生产 Application → Receipt → EpisodeRecord → Evaluation 的受控集成测试；`npm run build`、`npm run typecheck`、Runtime 222 项测试、架构 gate 和 SQLite preflight 均已通过。Gold 兼容性检查已对 `local003/local004/local008` 得到 3/3；API canary 也通过。随后执行的两个单题真实 Agent canary 均已保存 EpisodeRecord，其中一个完成了 Agent 执行但未形成提交物，另一个在知识探索后正常结束且未导出；这证明记录链路可用，但不能替代成功的端到端基线或完整 rollout。

新增测试优先跨越调用者真实使用的 Interface，不继续只用旧工具 JSON fixture 验证旧解析器。

### 11.2 必须覆盖的验收案例

| 编号 | 案例 | 验收结果 |
|---|---|---|
| T01 | 改变一个能力开关 | Runtime 实际装配与 Manifest 同步改变 |
| T02 | 传入无效或已废弃配置 | 明确失败，不静默忽略 |
| T03 | 当前 Application 中发生 provider failure | 记录真实失败，不因 UI completed 变为执行成功 |
| T04 | 主 Agent + 子 Agent + Jev 调用 | usage 分开记录、汇总不重复；未知成本不填 0 |
| T05 | 新协议 Candidate + Receipt + 授权读取 | 正确识别交付，并与报告一致 |
| T06 | 已发布零行 CSV | 保留表头，不仅因零行判交付失败 |
| T07 | 有 Preview 但无 Receipt | 不生成正式 submission |
| T08 | Retry 已有 case | 新 Session/workspace，旧证据保留 |
| T09 | Continue 未完成 attempt | 保持输入身份，预算不重置 |
| T10 | 取消后终态未知 | 保留 unknown，不自动新开 SQL 执行 |
| T11 | scorer 异常 | Correctness unavailable，不冒充答错 |
| T12 | 历史记录缺必要字段 | 显式 unknown，不补 0/clear/passed |
| T13 | Fanout/SpecFeedback 没有执行 | configured 与 executed 不混淆 |
| T14 | 记录中断或进程崩溃 | 保存已落盘事件，标记完整性；不伪造终态 |
| T15 | 测试报告缺失 | 完整性 gate unavailable，不硬编码通过 |
| T16 | 未声明实验因素发生变化 | 拒绝正式归因或清楚标为不可比 |
| T17 | 源码已改但构建产物过期 | 正式运行预检失败 |
| T18 | 交付后 cleanup 失败 | 保留交付事实，独立记录 cleanup 故障 |
| T19 | 两个子 Agent 并行执行 | 父子归属明确；总延迟不等于子 span 时长之和 |
| T20 | 工具内 SQL 与 Fanout 探针 | 正确关联子 span，工具调用与数据库调用分别计数 |
| T21 | 重复/乱序事件与恢复补记 | 投影幂等，已有调用不重复计费；真实新调用保留新 span |
| T22 | 只有 span start、无权威终态 | 保留 unknown/部分覆盖，不编造结束时间或自动重跑 |
| T23 | 父 span 汇总与叶调用 usage 同时存在 | 费用不重复累计；未知部分有明确覆盖率 |
| T24 | Revision/Candidate/Receipt 跨多次调用 | 通过 links 关联，不伪造执行嵌套关系 |
| T25 | 封存后出现迟到或冲突证据 | 新投影保留来源与版本，旧报告依据不被覆盖 |
| T26 | 受控内容与敏感字段 | 私有引用不能绕过 Receipt；凭据不进入 trace |
| T27 | Rescore 记录评分 span | 独立 trace 链接原产物，不重新打开 Agent attempt |
| T28 | 相同事件集重复重建 span 投影 | 除明确的生成元数据外，身份、计数和分析结果一致 |

还必须有一条**使用当前生产装配、可控模型/工具依赖的 Application → EpisodeRecord → 报告集成测试**，验证事件、状态和当前协议贯通。之后再做少量真实模型 canary，不直接从 fixture 测试通过跳到全量评测。

### 11.3 验证入口

- 无凭据的评测契约、记录和报告测试应纳入常规验证入口。
- 真实模型 canary 和完整 Spider2 运行保留为显式、有预算的命令。
- 不要求把每次昂贵 rollout 放入普通 `npm test`。
- 可以后续接入 CI，但 CI 接线不是本轮架构成立的前置条件。

## 12. 文件组织建议

先保持在现有目录内，不新增独立 package：

```text
evaluations/spider2/
  run.mjs                 # 薄 CLI，保留既有入口
  experiment.mjs          # 有效配置、输入身份、比较约束
  episode.mjs             # attempt 执行和清理
  record.mjs              # event/span/artifact schema、归一化与封存
  evaluation.mjs          # 官方评分、指标与配对比较
  adapters/
    spider2.mjs           # 题目与资源、官方 evaluator 适配
    legacy-record.mjs     # 历史格式显式迁移
  *.test.mjs
```

Runtime 只做必要改动：

| 位置 | 改动 |
|---|---|
| `application/session-runtime.ts` | 显式传入现有 Answering/Delegation 有效策略，提供真实装配信息 |
| `application/host.ts` | 提供窄的只读运行观测与必要的授权 Candidate 投影 |
| `agent/harness-factory.ts` 或现有 facet | 在 Pi 内部接缝生成稳定 observation，不改变 Pi 的运行权威 |
| `facets/artifact-directory.ts` | 复用现有授权读取，不另建 CSV 编码路径 |
| Answering / Delegation 实现 | 原则上保留语义，仅补必要只读观察；不为评测建立第二份状态 |

具体文件名可以按最终复杂度合并。Module 的价值是把配置、执行记录与评分规则集中到清晰 Interface 后面，不是把大文件机械拆成许多转发文件。

## 13. 分阶段实施

### 阶段 1：修复测量链路

工作：

- 明确当前 EpisodeRecord schema。
- 接入真实终态与 usage，停止 UI 事件反向转换。
- 落地 §5.3 的 event/span/artifact 契约、必要 span 层级、links 与幂等投影；先修复事实来源，再形成 span，不给有损 UI 记录简单套壳。
- 用 `readPublication` 采集正式产物。
- 统一当前 Receipt/Publication 的报告解释。
- 将缺失、unknown、unavailable 与 0/false 区分。

验收：

- 当前 Application → Record → Report 集成测试通过。
- Provider failure、零行 CSV、无 Receipt、子 Agent usage 等案例正确。
- 同一运行被各报告消费时得到一致的交付与执行判断。
- 并行 span 耗时、父子 usage 去重、未结束 span 和迟到证据版本化案例正确；无需 OTel 后端。

### 阶段 2：固定有效实验身份

工作：

- 实现 `ResolvedExperiment`。
- 用同一结果装配 Runtime 和 Manifest。
- 清除新运行路径的无效 Assurance 开关。
- 明确 Widget/Dashboard、子 Agent、Jev、Fanout 与预算。
- 保存知识、工具提示、Skills、数据库及构建身份。
- 补配置与装配契约测试。

验收：

- 所有对外配置都有效或被明确拒绝。
- 能说明当前实验究竟只改变了哪个因素。
- 构建过期、输入变化和未声明差异能被识别。

### 阶段 3：修正 attempt 生命周期

工作：

- 区分 Continue、Retry、Rescore。
- 引入独立 attempt 目录与不可覆盖记录。
- 冻结纳入主报告的 attempt 政策。
- 保持恢复预算与未知执行结果处理规则。

验收：

- 重试不继承旧 Session，不覆盖历史证据。
- Continue 不重置预算或切换配置。
- Rescore 不调用 Agent，且不会修改 EpisodeRecord。

### 阶段 4：收敛比较器与回归集

工作：

- 将 Phase 5/6 和 baseline-report 的共同逻辑迁入 Evaluation。
- 提供显式 legacy Adapter，删除新路径的旧协议猜测。
- 添加少量符合当前能力的扰动/恢复用例。
- 用一个单因素小样本实验验证整条链。

验收：

- 比较报告给出逐题改善/退化、成本与覆盖限制。
- 无效或不完整运行不能得到正式推广判断。
- 统计指标能追溯到 task、attempt、产物与 scorer 身份。

## 14. 迁移与兼容策略

1. 不批量改写历史 run 文件。
2. 新格式使用显式 `schemaVersion`，不能依靠字段存在与否无限猜测。
3. 历史转换输出单独保存，保留原始记录引用和转换版本。
4. 首轮同时对同一个已保存 attempt 生成旧报告与新报告，定位解释差异；不为对齐分数修改新语义。
5. 旧报告错误解释当前 Receipt 时，以权威产物和当前协议为依据，不追求表面一致。
6. 新运行入口遇到旧无效配置，给出明确迁移说明；不要宣称某开关已生效。
7. 工具范围或预算默认值需要变更时，单独提交行为变更和实验记录，不隐藏在文件拆分中。
8. 不在实施重构时覆盖工作区已有未提交业务改动。

## 15. 完成定义

本轮重构完成意味着：

- 每次运行可以说明实际输入、能力、预算与初始状态。
- 运行失败、观测失败、交付失败和评分失败不再混为一谈。
- 当前协议的交付物只通过 Receipt 授权读取。
- 主/子 Agent 与 Jev 开销有明确来源和缺失标记。
- 统一 span 能解释模型、工具、SQL、内部检查和子运行的归属；报告复用投影而非各自解析原始事件。
- Span 不拥有执行控制权，耗时/费用不重复计算，未知终态和覆盖限制不会被结构化格式掩盖。
- 恢复与重试不会混入不可见上下文或覆盖旧证据。
- 报告只消费统一记录，不再各自猜测不同代工具协议。
- 至少一个当前能力的受控实验能够在该链路上完成并可追溯。

**不以增加指标数、增加测试文件数或搭出通用平台为完成标准。**

## 16. 参考与代码索引

### 外部思路

- [Han Lee：Hidden Technical Debt of AI Systems: Agent Evaluation Infrastructure](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)

### 当前实现

- `evaluations/spider2/run.mjs`：`loadConfig`、`createCaseRunner`、`collectArtifacts`、`nativeEventFromPresentation`、`currentBaselineSurface`、`runCommand`、`scoreCommand`。
- `evaluations/spider2/lib.mjs`：`createRecorder`、`selectFinalSql`、`fixedDenominatorScore`。
- `evaluations/spider2/baseline-report.mjs`：交付和官方分数完整性检查。
- `evaluations/spider2/phase5-ab.mjs`：旧 Manifest 比较逻辑。
- `evaluations/spider2/phase6-evaluate.mjs`：旧过程指标、bootstrap 与推广判断。
- `packages/runtime/src/application/host.ts`：Session 装配与 `readPublication`。
- `packages/runtime/src/application/session-runtime.ts`：Answering、工具与 Delegation composition root。
- `packages/runtime/src/agent/harness-factory.ts`：Pi Session Host 与工具提示接入。
- `packages/runtime/src/facets/transcript.ts`：Presentation 有损投影。
- `packages/runtime/src/facets/artifact-directory.ts`：Receipt 授权读取。
- `packages/runtime/src/answering/service.ts`：当前预算、Fanout 与 Spec Feedback 调用。
- `packages/runtime/src/adapters/pi-session-answering-store.ts`：既有权威状态持久化。
- `packages/runtime/src/delegation/child-harness.ts`：子运行终态与 usage。
- `packages/runtime/src/agent/tool-prompt-catalog.ts`、`tool-prompt-models.ts`：动态工具提示。

### 领域约束与相关设计

- `CONTEXT.md`。
- `docs/adr/0003-detect-inform-never-block.md`。
- `docs/answering_fanout_module_development.md`。
- `docs/answering_spec_feedback_development.md`。

代码位置以符号名为定位依据，实施时重新核对；本文不把历史文档中的规划视为当前实现。
