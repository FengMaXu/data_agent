---
status: proposed
---

# 报告级任务：共享口径一次声明，图表查询只声明差异

本 ADR 提议为包含多个图表查询的报告引入父子结构的 Report Task，以降低 ADR-0008 决策 4 带来的逐查询口径成本。它以 ADR-0007 的字段词汇为前提，在 ADR-0007 接受并实现之前不实施。发布规则、Candidate/Receipt 身份与 ADR-0008 的数据集引用均不变。

## 背景

ADR-0008 决策 4 要求图表数据通过数据集引用获取，由 Runtime 检查交付资格。这对所有画图路径都是新增要求，而不是现状：

- `demo-report` skill 允许的工具只有 `query_database`、`run_python`、`write_file`、`read_file`，不含 `publish_query_result`；报告数据以 CSV 写入工作区后交给 Python。
- v3 看板由 `materializeDashboardV3Spec` 按 dataset 的 `source.path` 读取工作区 CSV，或直接使用 spec 内联的 `rows`；dashboard skill 允许的工具不含发布工具。
- 聊天图表的数据由模型写入 `show_widget` 的 spec；“不能绕过查询结果的发布授权”只是工具提示，没有强制校验。

聊天图表通常一图一查询，改为先发布只多一步。报告与看板改为逐图发布后，一份含 N 张图的报告需要 N 次完整的 Answer Spec；本 ADR 针对的是这一场景。ADR-0007 记录的数据显示，该接口成功调用平均参数 4.8 KB，19 次调用中 11 次失败。

曾考虑以并发降低这一成本。核查结果表明并发大多已经具备，且不作用于主要成本：

| 层 | 现状 | 依据 |
| --- | --- | --- |
| 主 agent 工具执行 | 同一条助手消息中的多个工具调用并行执行 | `harness-factory.ts` 创建 `AgentHarness` 时未设置 `toolExecution`，Pi 0.85.1 默认 `"parallel"`；`runParallel` 依次准备调用后并发执行，不读取单个工具的 `executionMode` |
| answering 存储 | 每个会话的事务串行排队，但事务很短；SQL 在事务之外执行 | `PiSessionAnsweringStore.transact` 的队列；`result-execution.ts` 与 `exploration.ts` 中的 `sqlExecutor.run` 调用均不在 `transact` 回调内 |
| 多任务 | 一个会话可以有多个 Query Task，工具调用显式携带 `taskId` | CONTEXT.md“Query Task”；`tools/answering.ts` |
| 数据库 | MySQL MCP 查询连接池上限 3；Postgres 连接池由调用方注入 | `mcp-mysql/src/index.ts`；`mcp-pg/src/index.ts` |
| 子 agent | explorer 全局并发上限 12，子 agent 内部工具并行 | `delegation/concurrency.ts`；`child-harness.ts` |

主要成本发生在模型侧：每个查询各自的 Answer Spec 编写、失败重试、探索与发布，由主 agent 逐轮完成。并发缩短的是 SQL 等待时间，不减少模型轮次、token 与口径错误。尚未核实的是模型在实际报告任务中一轮发出多个查询调用的频率。

## 决策

1. **不为降低报告成本而给 answering 增加并发机制。** 现有并行执行已覆盖 SQL 等待；新增调度器不作用于模型侧成本。
2. **引入 Report Task。** 一份报告对应一个父任务，承载各图表共享的口径字段：按 ADR-0007 的字段词汇，通常为 `entity`、`metric`（含 `metric.denominator`、`metric.countGrain`）、`filters.population`、`time`、`source`。父任务的字段完整经过依据与处置流程。
3. **图表查询作为子任务继承父字段，只声明差异。** 子任务只写自己的字段，通常为 `groupBy`、`ranking`、`output.shape`。子任务覆盖父字段时必须附理由，Runtime 将其记录为偏离，并在报告中披露；未覆盖的字段与父任务保持一致，不允许静默改写。
4. **每个子任务保留独立的 Query Task 身份。** 子任务各自产出 Candidate 与 Receipt，发布规则、完整性校验与 ADR-0008 的 `DatasetRef` 不变。父任务本身不发布结果。
5. **父任务变更使子任务失效，由 Runtime 判定。** 子任务绑定父任务的某个 revision；父任务产生新 revision 后，绑定旧 revision 的子任务不能再执行 result 查询或发布，须重新绑定。已发布的 Receipt 保持不可变，报告须标明其所依据的父 revision 已被取代。这延续 ADR-0004 由 Runtime 拥有规格转换的原则。
6. **阻断按层级传递。** 父任务存在 `unhandled` 假设时，所有子任务的 result 查询与发布被阻断，这是 ADR-0003 第 3 条在父子结构上的直接适用；子任务自己的 `unhandled` 假设只阻断该子任务。exploration 不受阻断。
7. **澄清在父任务层面进行。** 共享口径的歧义只向用户询问一次，回答作为父任务字段的依据，由全部子任务继承。
8. **并发作为结构的副产品。** 父任务处置完毕后，子任务的 result 查询彼此独立，依赖已有的工具并行执行与数据库连接池。只有度量显示需要时，才引入额外的有界调度（可复用 `BoundedConcurrencyLimiter`）。
9. **不由子 agent 执行图表查询。** 子 agent 保持 `explorer`/`reviewer` 两种角色，explorer 不绑定 Query Task，口径决定仍由主 agent 做出。

## 实施与验证

前提：ADR-0007 接受并实现。字段继承与覆盖基于 ADR-0007 的字段路径实现。

实施前先度量：在 ADR-0008 首期完成后，用若干份真实报告按“逐查询完整流程”运行，记录每份报告的模型轮次、Answer Spec 调用次数与失败率、token、总耗时，以及一轮内发出多个查询调用的比例。度量表明成本显著时才实施本 ADR。

验收原则：

- 一份 N 图报告的规格编写量约为一次完整父规格加 N 次差异声明。
- 未覆盖的共享字段在所有子任务中一致；覆盖均有理由并出现在报告披露中。
- 父任务产生新 revision 后，绑定旧 revision 的子任务无法执行 result 查询或发布。
- 父任务存在 `unhandled` 假设时，所有子任务的 result 查询被阻断，exploration 不受影响。
- 父任务处置完毕后，子任务的 result 查询可在同一轮内并行执行。

## 考虑过的方案

- **给 answering 增加并发**：主 agent 的工具已并行执行，事务短、SQL 在事务外，瓶颈在模型侧，新增并发收益有限。
- **每张图交给一个子 agent 走完整流程**：口径决定分散在多个上下文中，同一报告的图表可能采用不同口径；子 agent 无法把澄清问题交还用户；与 explorer 不绑定 Query Task、主 agent 做出全部决定的委派约束以及 ADR-0001 的职责分离冲突。
- **一个 Query Task 产出多个结果**：破坏“一个任务、一个发布”的身份与完整性模型，ADR-0008 的 `DatasetRef` 也需随之改变。
- **报告查询跳过 Answer Spec**：报告是正式交付物，口径风险高于聊天中的单次查询；降低保障与 ADR-0001 相悖。
- **在现有五类实体接口上实现继承**：需要在槽位、证据、假设、Choice、决策点及其交叉引用之上再叠加父子引用，放大 ADR-0007 正在消除的复杂度。

## 后果

- 报告的口径成本从 N 份完整规格降为一份父规格加 N 份差异声明；同一报告内的图表口径默认一致，偏离显式可见。
- answering 需要新增父子任务关系、revision 绑定与失效规则，改动集中在任务与转换模块，但不改变 Candidate、Receipt 与发布策略。
- 父任务成为报告内所有图表的共同依赖：父任务口径出错会影响全部子任务，父任务变更会使子任务集中失效并需要重新执行。
- 本 ADR 的实施依赖 ADR-0007，并受实施前度量结果约束；在此之前，报告按逐查询完整流程运行，接受其成本。
- CONTEXT.md 需在本 ADR 接受时补充 Report Task 与图表查询（子任务）两个术语，并说明子任务与 Query Task 的关系。

## 补充（2026-10-05）：实施前度量与待定设计

本 ADR 仍未实施：代码中没有父子任务关系（`parentRevisionId` 只表示同一任务内的 Revision 链）。前提 ADR-0007 也仍为 proposed。以下事实对照 `develop`（#125 之后）的代码与 2026-10-01/02 的看板会话 transcript 核实。

### 度量

| 会话 | 主 agent 工具调用 / 轮次 | 子 agent 工具调用 | 说明 |
| --- | --- | --- | --- |
| 2026-10-01 `bf9a5144` | 108 / 70 | 33 | 一份看板；任务时间预算耗尽后用户要求重建任务 |
| 2026-10-01 `2f2a48b7` | 118 / 79 | 92 | 两份看板 |
| 2026-10-02 `59173005` | 46 / 36 | 76 | 一份看板 |

`bf9a5144` 中，重建任务后的 7 个视图按“修改口径 → 结果查询 → 发布”逐个完成，占约 30 轮。模型尝试过把它们并行：一次发出 4 条结果查询，4 条都因为一个任务只有一个输出形状而未通过 `result_shape`；一次发布 4 个候选，3 个因为一个任务只能发布一次而被拒；另 3 条结果查询撞上结果次数预算。这正是背景中描述的成本，满足“度量表明成本显著”的实施条件。主 agent 一轮内并行发出多个调用已经很常见（同一会话中多次一轮 4 条查询），印证决策 1。

同一会话中还有 10 次 60 秒查询超时，原因是数据源整行重复（见 ADR-0007 补充待定 5），不属于本 ADR 处理的成本；评估本 ADR 的收益前，应先在修复后的数据上重跑同一看板任务，把两类成本分开。

### 待定设计

1. **共享的是指标定义，不是一个指标。** 决策 2 把 `metric` 列为父任务字段，但看板各视图的指标通常不同（同一份看板有差评率、物流超期率、出库耗时、运费费率等）。父任务应承载一组具名指标定义（各自含分子、分母、计数粒度），子任务的 `metric` 引用其中一个名字；子任务自定义指标按决策 3 视为覆盖。`entity`、`filters.population`、`time`、`source` 仍按原决策由父任务承载。父子字段的划分应固定成表，而不是“通常为”。

2. **工具接口。** 尚未设计。方向：沿用 ADR-0007 的 `set_answer_spec`，父任务以一个标记创建，子任务带 `parentTaskId` 创建；子任务的状态表同时显示继承字段及其父 Revision。

3. **证据跨任务引用。** 观测证据按任务存放与查找（`AnsweringStore.getEvidence(taskId, evidenceId)`）。子任务的字段若要以父任务的探索结果为依据，解析证据时须同时查找所绑定父 Revision 的证据；否则同一探索要在每个子任务里重跑。

4. **澄清继承已有机制。** 澄清回答按会话查找（`clarification:<id>`，见 ADR-0007 补充待定 1），父任务字段引用它即可，子任务继承字段而不是重新引用证据。决策 7 不需要新的准入机制。

5. **预算分层。** 预算按 Query Task 计：8 次 Revision、16 次探索、8 次结果、15 分钟（从任务创建起算的墙钟时间，包含模型思考与查询超时）（`budget.ts`）。需要规定父任务与各子任务各自独立计费，子任务的时间从子任务创建起算；不设报告级总预算，直到度量显示需要。

6. **刷新与父任务取代。** ADR-0010 的刷新重新执行原 Receipt 所属的同一个已封存 Revision，不检查它是否仍是当前 Revision（`refresh.ts`）。按决策 5，父任务产生新 Revision 后，子任务不能再执行结果查询或发布；刷新属于哪一种需要规定。方向：刷新仍允许（它不改变口径，只更新数据），但新 Receipt 的 Disclosure 须标明所依据的父 Revision 已被取代。

7. **公共基础集合不由父任务承载。** 各子任务重复计算的去重或清洗子查询，不在父任务中以 SQL 片段共享；整行重复这类缺陷在数据层修复（ADR-0007 补充待定 5），`source` 只指向数据库中已存在的关系。

## 实施记录（2026-10-05）

本 ADR 在 ADR-0007 字段接口（`specInterface: "fields"`）之上实现，状态仍由维护者决定。与上文相比的取舍：

- **工具接口**：`set_answer_spec` 增加 `report: true`（建报告任务）、`parentTaskId`（建图表查询）、`rebind: true`（重新继承）。图表查询改共享字段时，字段的 `reason` 即偏离理由。领域层只在逐步写入（`steps`）时接受建立报告任务和图表查询。
- **共享字段固定为**：`entity`、`filters`、`time` 三个槽位，`population`、`join_multiplicity`、`time_field`、`window` 四个决策点，以及 `metrics.<名字>` 指标定义。`source` 在第一阶段编译为影响实体、指标、过滤的 Hypothesis，写在报告任务上时，其未处理状态按决策 6 阻断全部图表查询。
- **指标定义的分母与计数粒度写在定义的值里**（`{ kind, expression, denominator?, countGrain? }`），没有单设 `metrics.<名字>.denominator` 子路径；引用了写明分母或计数粒度的定义时，图表查询对应的决策点按继承声明。
- **每个图表查询的 Revision 记录它继承自哪一个父 Revision**，刷新据此判断补充待定 6 的“父 Revision 已被取代”，而不是看任务当前的绑定。

