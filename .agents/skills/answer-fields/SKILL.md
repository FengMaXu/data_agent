---
name: answer-fields
description: 数据查询的 Answer Spec 流程（字段接口）——按字段路径设置口径、探针与决定、最终查询、发布
when_to_use: 每个需要从数据库取数、统计、排名或导出的请求，在第一次调用 set_answer_spec 之前加载。口径问答、闲聊和纯结果加工不需要加载。
requires-tools:
  - set_answer_spec
  - query_database
---

# Answer Spec 流程（字段接口）

本 Skill 说明用 `set_answer_spec` 建立和修改 Answer Spec 的方法。语义分析方法（如何拆题、各字段要回答什么问题、各类歧义专题）见知识库 `semantic-guide`；SQL 实现规则见 `sql-rules`。

## 1. 流程总览

1. 按需读取 `semantic-guide`，拆题。
2. 业务定义、表结构、数据取值交给 `subagent` 的 explorer 收集，每个子任务只问一个问题，并行派发。
3. 一次 `set_answer_spec`（不带 `taskId`）写下全部字段：7 个槽位、8 个子字段，必要时加 `source`。题面没说死的字段写成待定。
4. 每个待定字段的每个候选各跑一次探针（§5）。输出全部相同的字段由系统视为等价，不用处理；输出不同的，调用 `compare_hypotheses` 后写入决定。
5. 状态表显示“没有待处理的字段”后，执行一次最终查询，得到 Result Candidate。
6. 发布 Candidate，并披露未证实的字段和数据限制。

## 2. 字段路径

| 路径 | 内容 |
| --- | --- |
| `entity` | 统计实体与业务键 |
| `metric` | 指标、分子分母与聚合顺序 |
| `filters` | 过滤条件列表，没有写 `"n/a"` |
| `groupBy` | 分组列表，没有写 `"n/a"` |
| `time` | 时间范围与边界 |
| `ranking` | 排名 `{n, orderBy, tiePolicy?}`，没有写 `"n/a"` |
| `output` | 输出形态 `{rowMode, rowCount?, columns?}`；写了 `columns` 时，结果列须逐位同名 |
| `filters.population` | 哪些行和实体算在内；零值、空值实体要不要纳入 |
| `entity.joinMultiplicity` | 连接后会不会重复计数，要不要去重 |
| `time.field` | 用哪个事件的时间字段；区间两端含不含 |
| `metric.countGrain` | 按行、按实体还是按事件计数 |
| `metric.denominator` | 比率或平均的分母；分母为 0 怎么处理 |
| `time.window` | 滚动或累计窗口从哪里开始 |
| `ranking.ties` | 并列时取一个还是全部取 |
| `output.shape` | 输出几行、几列、什么粒度 |
| `source` | 同时影响实体、指标、过滤的数据来源不确定性（例如用明细表还是汇总表） |

8 个子字段每次都要声明，不适用的写 `"n/a"`；全部声明之前不能执行最终查询。子字段与 `source` 的 `value` 写一句话说明口径。

## 3. 字段写法

| 状态 | 写法 | 系统怎么处理 |
| --- | --- | --- |
| 不适用 | `"n/a"` | — |
| 题面已规定 | `{ "value", "basis": "request", "quote" }` | `quote` 必须在原题中逐字出现 |
| 有引文依据 | `{ "value", "cite": [{ "source", "quote" }] }` | 见下表 |
| 观测依据 | `{ "value", "evidenceIds": ["evidence_…"] }` | 引用 `query_database` 探索返回的 evidenceId |
| 假定 | `{ "value", "basis": "assumed", "rationale" }` | 记为未证实，发布时披露 |
| 待定 | `{ "open": ["候选 1", "候选 2"] }` | 系统为每个候选发放探针 ID |

槽位也可以直接写值（如 `"output": { "rowMode": "scalar", "rowCount": 1 }`），视为推断，发布时披露。`ranking`、`output` 的值是对象，不能写成待定；对应的歧义写在 `ranking.ties`、`output.shape`。

引文来源：

| `source` | 含义 | `quote` |
| --- | --- | --- |
| `knowledge:<knowledgeId>` | 系统授权的业务文档 | 必填，文档中逐字出现 |
| `schema:<表.列>` | 表结构事实 | 可选 |
| `clarification:<clarificationId>` | `ask_user_clarification` 的回答 | 必填，回答中逐字出现 |
| `message` | 用户本轮消息 | 必填，消息中逐字出现；原始问题用 `basis: "request"` |

是否已证实由系统按依据判定：业务口径（总体、分母、计数粒度、窗口、并列、输出形状）只认原题、业务文档和用户确认；观测数据和表结构只能证实物理映射与数据性质。依据不够格时记为未证实并披露，不会失败。

**统计总体**：`filters.population` 在会话提供澄清工具时不能只靠假定或观测，须引用原题、业务文档或用户确认，或先用 `ask_user_clarification` 询问用户。

## 4. 修改与决定

- **只写要变的路径。** 未写的路径保持不变。每个路径独立校验、独立生效，失败的路径不影响其他路径；按返回的 `✗` 原因只重发失败的路径。
- **决定待定字段**：写 `{ "value": "<候选原文>", "rationale", "evidenceIds"? }`。`rationale` 写把每个候选放回题面逐词检验的结论（`semantic-guide` 的“候选对照”）。`compare_hypotheses` 的明显倾向（`[ADVICE_LEAN]`）是默认答案；改选时须附 `"adviceOverride": { "reason", "evidenceIds" }`。
- **改写已设置的字段**须附 `"reason"`，系统记为对原记录的取代。
- 写入任何字段都会产生新的 Revision，上一版未发布的结果候选随之失效；先把字段写完，再执行最终查询。

## 5. 探索、探针与最终查询

```text
query_database(kind="exploration", taskId, sql, limit?)
query_database(kind="exploration", taskId, sql, probe={ choiceId, alternativeId })
query_database(kind="result", taskId, revisionId, sql)
```

- 待定字段的 `choiceId` 和每个候选的 `alternativeId` 见 `set_answer_spec` 返回的状态表。
- 探针 SQL 按该候选的口径计算**最终输出**，不是中间量。`[CHOICE_PROBE] output=...` 相同表示两个候选给出同一个答案。探针不占探索次数。
- 探索只验证可能改变答案的未决点，每次解决一个问题；探索产物不能发布。
- 最终查询绑定状态表所在的当前 `revisionId`，只执行一次，生成不可变的 Result Candidate。CandidateCheck 拒绝时修正 SQL；结果与未采纳候选的探针输出相同时以 `CHOICE_NOT_REALIZED` 拒绝，改 SQL 实现已采纳的候选。
- `[IMPLEMENTATION_OBSTACLE]` 按 `kind` 判断：技术失败在预算内修 SQL；业务判断、映射不足、预算耗尽或执行结果未知时回到取证、澄清或说明限制。

## 6. 发布

- 行数 ≤ 10：`publish_query_result(candidateId, format="inline")`
- 行数 > 10：`export_query(candidateId, format="csv")`

发布不会重跑 SQL。回复中说明结果对应的口径，并转述 `[DISCLOSURE]` 中未证实的字段、推断槽位和检查限制。
