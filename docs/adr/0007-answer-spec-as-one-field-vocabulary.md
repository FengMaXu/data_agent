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
