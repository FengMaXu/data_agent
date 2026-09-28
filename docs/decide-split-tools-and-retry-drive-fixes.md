# 统一决定动作、拆分规格工具与主 Agent 重试推进修复方案

- 日期：2026-09-26
- 相关决策：ADR-0004、ADR-0005、ADR-0006（本方案新增）
- 触发：`wrong-submitted-34-20260926-deepseek-probes-r1` 的 trace 分析

## 1. 要修的问题

| 编号 | 问题 | 证据 |
|---|---|---|
| P1 | 主 Agent 的模型请求失败后，Pi 进入"等待重试"，但没有调用方继续推进，运行一直挂到任务超时 | local061、local299 分别在第 42、53 秒遇到 `terminated`，之后空等到 480 秒；上一轮 local263 相同 |
| P2 | `update_answer_spec` 248 次调用中 166 次失败，其中参数校验失败 93 次 | 把整个 `begin` 内容塞进 `spec` 18 次；begin/revise 联合类型的报错同时列出两种结构，模型难以定位 |
| P3 | Choice 的两种处置要求 Agent 预判证据资格，判断错误导致整次调用被拒 | 临时选择漏写理由 13 次；用观测数据正式选定 21 次；临时选择成功 0 次 |

## 2. 目标

1. 模型请求失败时，主 Agent 按 Pi 的重试策略重试；重试用尽后运行以错误结束，不再空等。
2. 建立规格和修订规格各有一个参数结构单一的工具；最常见的结构错误被自动修正或给出针对性提示。
3. Choice 只有一种决定动作；是否已证实由运行时判定。

## 3. 修复 1：主 Agent 推进重试（P1）

**位置：** `packages/runtime/src/facets/agent-controller.ts`。

**原因：** Pi 的 `lane.drive` 在请求失败且可重试时返回 `{ kind: "waiting", reason: "retry", notBefore }`，重试要等调用方到时间后再次 `drive` 才会发生。子 Agent（`delegation/child-harness.ts`）有这个循环，主 Agent 的 `AgentController.drive` 只调用一次。

**设计：**
- `drive` 在返回 `waiting` 时循环：
  - `reason: "retry"`：等到 `notBefore`；
  - 其他等待（deferred）：按 `pollAfterMs`（默认 250 毫秒）等待；
  - 单次等待不超过 1 秒，然后再次 `drive`，直到返回的不是 `waiting`。
- 中止由 Pi 负责：`requestAbort` 之后的 `drive` 会返回已结束的结果，循环自然结束。
- 重试用尽后运行以错误结束。评测 runner 已能把这种结束归类为 `provider_error`。

**测试：**
- faux provider 第一次返回错误、第二次正常：运行完成，模型被调用两次。
- 连续失败超过重试次数：运行以错误结束，而不是一直处于未结束状态。

## 4. 修复 2：拆分规格工具（P2）

**位置：** `packages/runtime/src/tools/answering.ts`，以及引用工具名的各处。

**设计：**
- `update_answer_spec` 拆为两个工具：
  - `begin_answer_spec`：参数为 `spec`、`hypotheses`、`choices`、`notProbeable`、`decisionPoints`、`evidence`；
  - `revise_answer_spec`：参数为 `taskId`、`baseRevisionId`、`spec`、`addHypotheses`、`addChoices`、`dispositions`、`notProbeable`、`decisionPoints`、`evidence`。
  - 两者都不再有 `kind` 字段。领域层仍是 begin/revise 两个用例，不变。
- 两个工具都实现 `prepareArguments`，在 Pi 校验参数之前修正常见结构错误。修正只移动或包装字段，不改变内容：
  - 顶层字段被放进 `spec` 里的（如 `spec.hypotheses`、`spec.choices`、`spec.evidence`、`spec.decisionPoints`），且顶层没有同名字段时，提到顶层；
  - `spec.filters`、`spec.groupBy` 写成单个对象或字符串时，包成数组；
  - 多余的 `kind` 字段直接去掉。
- 不能自动修正的错误仍由 Pi 报告；因为每个工具只有一种结构，报错只会列出这一种结构的问题。

**同步修改：**
- `harness-factory.ts` 的控制面工具名单、`skills.ts` 的已知工具名单；
- `answer-spec` Skill（`requires-tools` 和正文）、`.pi/SYSTEM.md`；
- 评测：
  - `run.mjs` 的修订次数统计和"是否执行了语义规格"的判断；
  - `experiment.mjs` 的工具集；
  - `phase5-ab.mjs` 的工具集对照；
  - `phase6-*` 只分析历史轨迹，保持不变。
- 所有引用 `update_answer_spec` 的测试。

**测试：**
- 两个工具的参数结构各自正确，旧工具名不再注册；
- `prepareArguments`：嵌套在 `spec` 里的字段被提到顶层；`groupBy` 的单个对象被包成数组；顶层已有同名字段时不覆盖。

## 5. 修复 3：统一的决定动作（P3，ADR-0006）

**位置：** `answering/model.ts`、`transition.ts`、`deps.ts`、`service.ts`、`tools/answering.ts`、`application/session-runtime.ts`。

**设计：**
- 新增处置 `{ action: "decide", choiceId, alternativeId, rationale, evidenceIds?, adviceOverride? }`。
- 建立 Choice 时的直接决定统一为 `decidedAlternativeId` + `decisionRationale` + `decisionEvidenceIds`。
- 处理顺序：
  1. ADR-0005 的前提照旧检查：探针或不可探测声明、必须先有比较建议、偏离倾向要有说明。
  2. `rationale` 必填，最少 20 字。
  3. 解析 `evidenceIds`：不存在的 ID 拒绝（`EVIDENCE_REJECTED`）；存在但不能支持该候选（种类不符或引文未核验）的，不报错。
  4. 至少一条合格证据时，记为 `selected`，附证明和理由；否则记为 `provisional`，附理由，并记下所引证据作为参考（`citedEvidenceIds`），发布时披露。
  5. 影响 `entity` 或 `filters` 的 Choice 在结果为未证实时：
     - `populationDecisions: "require_evidence"` 时拒绝，并提示取证或询问用户；
     - `populationDecisions: "allow_disclosed"` 时接受。
- `InMemoryAnsweringOptions` 新增 `populationDecisions`，默认 `"require_evidence"`。组合根在会话不提供澄清工具时设为 `"allow_disclosed"`。评测使用 `--disable-clarification`，所以是后者。
- 领域层保留 `select`、`provisional` 处置，用于兼容；模型工具只暴露 `decide`。
- 视图不变：`status` 为 `selected` 表示已证实，`provisional` 表示未证实。
- `answer-spec` Skill 的处置表改为：`decide` 一行、`equivalent`、`support`/`refute`、`supersede`。

**测试：**
- 附合格证据时记为 `selected`；
- 附观测证据支持业务语义时不报错，记为 `provisional` 并保留所引证据；
- 不附证据时记为 `provisional`；引用不存在的证据时拒绝；缺理由时拒绝；
- 统计总体 Choice：`require_evidence` 下未证实被拒，`allow_disclosed` 下接受并在发布披露中出现；
- 建立 Choice 时的直接决定走同一套规则；
- ADR-0005 的前提检查对 `decide` 同样生效（缺探针、缺建议、偏离倾向）。

## 6. 实施顺序

1. §3 主 Agent 重试推进
2. §5 领域层的 `decide` 与统计总体规则
3. §4 工具拆分，同时把工具参数改为 `decide`
4. Skill、系统提示、评测脚本、`CONTEXT.md`
5. 全量测试与分发构建

## 7. 验收

- **单元和集成测试：** 覆盖 §3–§5 列出的每条规则。
- **评测重跑：** 在你的终端里运行，题单与上一轮相同（34 题）。对比以下指标：
  - 规格工具调用的失败率（上一轮为 166/248）
  - 超时数，以及其中因请求中断导致的超时数（上一轮为 2）
  - 平均耗时和工具调用数
  - 正确率
  - 未证实决定的数量，以及其中统计总体类的数量
