---
status: proposed
---

# Answer Spec 收敛为一套字段词汇，由一个动作逐字段更新

本 ADR 提议替换 `begin_answer_spec`/`revise_answer_spec` 的模型接口，并部分取代 ADR-0004 第 4 条的证据引用方式、ADR-0005 第 5 条的决策点声明方式。运行时的准入、连续性、探针与兑现规则不变。

## 背景

2026-09-26/27 两个会话中，`begin_answer_spec`/`revise_answer_spec` 共 19 次调用、11 次失败：

| 失败 | 次数 | 例子 |
| --- | --- | --- |
| 槽位引用本次调用的证据 localId，但调用里没带 `evidence` 数组 | 3 | 同一份只含 `spec` 的参数连续重发 3 次，每次都是 `references unknown evidence def-ind51` |
| `affects` 写成决策点名 | 3 | `affects: ["metric", "denominator"]` |
| 证据种类与假设种类不匹配 | 2 | `reviewed_definition` 支持 `data_property` |
| 在同一次调用里处置刚新增的假设 | 1 | `Cannot support unknown hypothesis h-src` |
| 引用未经引文核验的题面证据 | 1 | `request_… has no Runtime-verified quote` |

另有一次结果查询因 `output.columns` 与 SQL 别名不一致而被 CandidateCheck 拒绝，模型改别名后一次通过；它不属于上述耦合，见"考虑过的方案"。

这些失败不是模型粗心，而是接口要求模型在一次调用里编写一张带交叉引用的图：

- **五类实体**：槽位、证据、假设、Choice、决策点，外加 `notProbeable`。
- **三套连接**：本次调用内的 `localId`、假设与 Choice 的 `affects`、槽位依据三选一（推断 / `hypothesisId` / `evidenceIds`）。同一个"槽位 ↔ 假设"关系被正反各写一次。
- **两套名称体系**：7 个槽位名与 8 个决策点名描述同一组决定，却分别出现在 `affects` 和 `decisionPoints[].name` 里。
- **调用级原子性**：任何一处引用失败都会拒绝整次调用，且只报第一个错误；成功的调用平均 4.8 KB 参数。

2026-09-27 已经做了两项不改接口的缓解：名称越界时一次列出所有错误字段及其合法值；support 按 ADR-0006 由运行时判定是否已证实（见 ADR-0006 补充）。它们让错误更容易修正，但不减少概念。

## 决策

1. **一套字段词汇。** Answer Spec 是一组按固定路径命名的字段。8 个决策点并入所属槽位，成为槽位的子字段：

   | 决策点 | 字段路径 |
   | --- | --- |
   | `population` | `filters.population` |
   | `join_multiplicity` | `entity.joinMultiplicity` |
   | `count_grain` | `metric.countGrain` |
   | `denominator` | `metric.denominator` |
   | `time_field` | `time.field` |
   | `window` | `time.window` |
   | `ties` | `ranking.ties` |
   | `output_shape` | `output.shape` |

   另设 `source` 字段，承载同时影响多个槽位的数据来源不确定性（例如"用 fact 表关联维表，还是用 mart 汇总表"）。这是取消 `affects` 后跨槽位不确定项唯一的归属。

2. **每个字段自带状态和依据，不再有独立的假设、Choice 和决策点声明。**

   | 状态 | 写法 | 对应现有记录 |
   | --- | --- | --- |
   | 题面已规定 | `{ "value", "basis": "request", "quote" }` | 已核验的题面证据 |
   | 有引文依据 | `{ "value", "cite": [{ "source", "quote" }] }` | 已核验证据；`source` 为 `knowledge:<id>` 或 `schema:<table.column>` |
   | 观测依据 | `{ "value", "evidenceIds": ["evidence_…"] }` | `query_database` 登记的观测证据 |
   | 假定 | `{ "value", "basis": "assumed", "rationale" }` | 未证实的 Hypothesis |
   | 待定 | `{ "open": ["候选 1", "候选 2"] }` | Choice；运行时为每个候选发放 ID 供探针使用 |
   | 不适用 | `"n/a"` | `not_applicable` |

   决定一个待定字段，就把它改写为某个候选的值并附 `rationale`；探针、比较建议和偏离说明仍按 ADR-0005 执行。

   **普通歧义与重要歧义的区分不变。** 区分依据是探针输出，不是字段结构：待定字段的每个候选仍各自绑定一次探针；全部候选输出相同的字段可声明为等价，不需要理由、建议和披露；输出不同或未知的字段按决定性处理。原来由 `affects` 决定的两条规则改由字段路径推导：路径的第一段就是它影响的槽位（`metric.denominator` 影响 `metric`）；`source` 视为同时影响 `entity`、`metric`、`filters`。因此"决定性 Choice 影响核心槽位时须先有比较建议"（ADR-0005）与"未证实的决定不得确定统计总体"（ADR-0006）的适用范围与现在相同。

3. **引用只剩服务端 ID。** 文本证据在引用处就地附引文，由运行时就地核验；取消模型可写的 `localId`。观测证据仍按 `query_database` 返回的 ID 引用。

4. **假设种类由字段路径决定。** 例如 `filters.population` 与 `metric.denominator` 为业务语义，`entity.joinMultiplicity` 与 `source` 为物理映射。模型不再声明种类，是否已证实按 ADR-0006（含补充）由运行时判定；ADR-0006 的统计总体规则作用于 `filters.population` 与 `entity`。

5. **一个动作，逐字段生效。** 唯一的写入工具是 `set_answer_spec { taskId?, fields: { <路径>: <字段> } }`。首次调用创建任务；之后按路径更新。每个路径独立校验、独立生效，结果逐路径返回，并附整张状态表：待定、未证实、未声明的字段。模型不再传 `baseRevisionId`，工具读取当前 Revision。

6. **连续性由运行时维持。** 改写一个已处置的字段必须附 `reason`，运行时自动记录为对原记录的取代（ADR-0004 的 supersede），审计链不依赖模型。

7. **输出列比对不变。** `output.shape` 声明 `columns` 时，CandidateCheck（`result_shape`）仍要求结果列数相同、逐位同名。

## 实施与验证

- **第一阶段，适配层。** `set_answer_spec` 把每个路径编译成对现有 `answering.begin`/`answering.revise` 的增量：假定字段生成 Hypothesis，待定字段生成 Choice，决策点由路径自动声明。领域记录、快照格式、探针、披露与发布不变，旧工具保留在开关后。
- **A/B。** 在 Spider2 开发集（`phase6-development-35-ids.txt`）上与现有工具对比：spec 工具调用错误率（本 ADR 背景中为 11/19）、到达首个 Ready Revision 的轮次、结果正确率不回退、披露率。
- **第二阶段，领域收敛。** A/B 成立后，再把领域模型的假设、Choice、决策点三类记录收敛为字段记录，并迁移旧快照。

## 考虑过的方案

- **只做名称校验和报错改进（已实施）。** 保留：它是后续任何方案的基线，但五类实体与三套连接仍在。
- **按关注点拆成六个原子工具**（登记证据、声明未决项、处置、声明决策点、改槽位、开始）。否决：数据上正交，时间上耦合——模型必须按"登记 → 声明 → 处置"的顺序调用，前一步返回的 ID 是后一步的输入；概念没有减少，工具却从 2 个增加到 6 个。
- **输出列只按列序与数量比对，或由运行时按声明改名。** 否决。逐位同名是发布内容的列名契约：发布的 CSV 表头就是结果列名。它还能发现列序错位——声明 `[a, b]` 而 SQL 给出 `[b, a]`；只比数量，或按位置改名，都会把错位静默地贴上错误的列名。实际代价是一次可修复的重试。真正的缺陷在报错：obstacle 只写 "Result columns do not match the declared output shape"，不给声明列与实际列，而且这句话排在约 2.7 KB 的尝试记录之后。应改进报错，而不是放宽检查；2026-09-27 已改为在 obstacle 首行同时给出声明列与实际列。
- **把决策点名加入 `affects` 的合法值。** 否决：两套名称体系合并成一个并集，模型仍需知道哪些名字是槽位、哪些是决策点，问题只是从报错变成语义混淆。

## 后果

- 模型需要掌握的概念从五类实体、三套连接收敛为"字段路径 + 字段状态"；交叉引用失败从结构上消失。
- 跨槽位的不确定性只能放在 `source` 字段；若出现 `source` 无法表达的跨槽位不确定项，需要扩展字段表，而不是恢复 `affects`。
- 每个路径独立生效意味着一次调用可能产生多个 Revision；Revision 数量增加，但每个 Revision 都满足 ADR-0004 的连续性不变量。
- ADR-0004 第 4 条"证据引用只能使用 Runtime 发放的 Evidence ID 或同一次调用内的 `localId`"改为"只能使用 Runtime 发放的 ID 或就地引文"；ADR-0005 第 5 条的决策点声明改为由字段状态推导，阻断规则不变。
- 字段路径表是固定、有限的；它和决策点清单一样让遗漏可见，但不保证声明正确。

## 补充（2026-10-05）：对照代码与看板会话的待定设计

本 ADR 仍未实施：代码中没有 `set_answer_spec`，模型接口仍是 `begin_answer_spec`/`revise_answer_spec`。以下事实对照 `develop`（#125 之后）的代码与 2026-10-01/02 三个看板会话的 transcript 核实。

**新的度量。** 三个会话中 `begin_answer_spec`/`revise_answer_spec` 共 58 次调用、19 次失败（按工具返回的错误文本统计，为近似值），失败类别与本 ADR 背景一致：引用未知 Choice、决策点引用已移除的假设、决定统计总体的 Choice 缺少合格证据、用户确认无法核实。

**待定 1：用户确认在字段状态中没有写法。** 决策 2 的“有引文依据”只列出 `knowledge:<id>` 与 `schema:<table.column>`。现有准入已经支持两种用户确认：`clarification:<id>` 指向本会话某次澄清的回答，省略来源时绑定 Host 提供的当前用户消息（`evidence-admission.ts`、`tools/answering.ts` 的 `confirmationSource`）。澄清回答按会话查找，因此同一会话的后续 Query Task 可以引用。`cite[].source` 应增加 `clarification:<id>` 与 `message`（当前用户消息）两种取值。现有接口有一个陷阱应一并消除：任何非空 `sourceRef` 都被当作澄清 id，2026-10-01 会话中模型写 `sourceRef: "current request"` 被解析为 `clarification:current request` 而失败。

**待定 2：等价由谁判定。** 决策 2 写“可声明为等价”，没有给出写法。现有转换在模型提交 `equivalent` 处置时检查各候选的探针指纹是否全部相同，不同则拒绝（`transition.ts`）。既然判定完全依据 Runtime 已持有的指纹，字段模型中应由 Runtime 在最后一个候选的探针登记后自动把该字段解析为等价，模型不需要也不能声明。

**待定 3：逐路径生效与结果候选的关系。** 结果查询与发布都要求候选所属的 Revision 是当前 Revision（`result-execution.ts`、`publication.ts`）。决策 5 让每个路径独立产生 Revision，因此任何字段写入都会使此前未发布的候选失效。保留这一规则：结果候选只对应一个完整的 Revision；工具返回的状态表应在存在失效候选时明确列出。

**待定 4：一个任务只有一个输出形状，也只能发布一次。** `output.shape` 每个任务只有一个；发布时只要任务已有 Receipt 且候选不同就拒绝（`publication.ts` 检查 `task.publicationId`），即一个 Query Task 一生只发布一次，而不是报错文字所说的“每个 revision 一次”。看板会话中模型把多张图塞进一个任务（`metric.kind: "composite"`、`output.columns: ["view", "dimension", "metric_value"]`），随后 4 条结果查询全部未通过 `result_shape` 检查，并行发布的 4 个候选中 3 个被拒。多输出由 ADR-0009 解决，本 ADR 不扩展字段表；报错文字应改为“每个 Query Task 只发布一次”。

**待定 5：数据质量不进入字段表。** 2026-10-01 会话所用的 olist 各表每行都存了两份（`olist_orders` 每个 `order_id` 恰好 2 行；`olist_order_items` 225,300 行，整行去重后 112,650 行）。模型把“各表先整行去重”写进 `filters`，在每个子查询中使用 `SELECT DISTINCT *`，导致 10 次 60 秒超时并耗尽任务时间预算。整行重复不是业务口径，不应由 Answer Spec 的字段承载，也不应由每条查询各自补偿；它属于数据层缺陷，应在数据源修复。CONTEXT.md 定义的 Schema Profile（含键基数）目前没有实现；实现后它可以把“声明键不唯一”作为结构事实报告给 solver，但修复仍在数据层。

## 第一阶段实施记录（2026-10-05）

第一阶段按“实施与验证”在开关后实现（`specInterface: "fields"`，默认 `legacy`）。与上文决策相比，有三处实现上的取舍：

- **一次调用落一个 Revision。** 决策 5 的“每个路径独立校验、独立生效”保留，但各路径作为同一次调用的有序步骤依次应用到上一步的结果上，被拒的步骤跳过，成功的步骤合并为一个 Revision，只计一次 Revision 预算。若每个路径各产生一个 Revision，写十几个字段就会耗尽预算（默认 8 次），且每次写入都使未发布的候选失效。后果一节“一次调用可能产生多个 Revision”因此不再成立。
- **槽位的“假定”记为推断。** 七个槽位写 `basis: "assumed"` 或直接写值时，记为推断槽位（Inferred Facet），发布时披露，不建 Hypothesis。这样 ADR-0006 统计总体规则的适用范围与旧接口相同；若槽位假定也建业务语义 Hypothesis，`entity`、`filters` 的假定在有澄清工具时会被拒绝，比现在更严。子字段与 `source` 的值都编译为 Hypothesis，`filters.population` 的假定仍受该规则约束。
- **文档引文不要求模型区分文档种类。** `cite` 的 `knowledge:<id>` 按组合根为该文档配置的种类（任务文档或已审核定义）准入。

A/B 由维护者执行（Spider2 运行器的 `--spec-interface legacy|fields`）。
