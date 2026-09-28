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
