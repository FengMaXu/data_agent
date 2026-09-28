# Answering Spec 验证反馈器开发方案

> 版本：v1.0  
> 状态：已实施（首版）；反馈默认告知，不修改 Spec、不改变 Ready 条件、不阻断结果或发布。  
> 目标：在生成或更新 Answer Spec 后，自动反馈题意偏离、无依据的口径和要求遗漏；不新增模型工具，不赋予模型判断业务裁决权。

## 0. 实施与验收证据

首版实现已落在当前源码。验收证据包括：

- `npm test`：全工作区构建及测试通过（runtime 215 tests passed，另有 1 个既有 skipped test；其余 workspace 测试通过）。
- `npm run typecheck`：全工作区类型检查通过。
- `npm run typecheck:negative --workspace=@data-agent/runtime`：负向类型用例通过。
- `npm run test:eval:spider2`：Spider2 评测适配器测试 42/42 通过。
- 聚焦测试覆盖：Jev 14 题协议严格解析、authority rank 与自证排除提示、HTTP/硬超时/取消、输入超限、提交失败不触发、反馈写失败、提交时 Evidence 快照隔离、Pi snapshot 往返、并发迟到反馈、Candidate 封存时覆盖冻结、Session Runtime 原题读取和发布披露。

以上是实现与结构/故障处理验收，不把 fake assessor、观测或测试 Gold 当作运行时业务证据；真实 JEV 服务仍只在入口显式配置并按报告状态披露。

## 1. 决策与边界

1. 反馈器是 Answering 内部模块，在 `begin/revise` **成功提交新 Revision 后**自动执行，不是通用 after-tool hook。
2. 对外仍为 `begin / revise / execute / publish / inspect`；`update_answer_spec` 的参数不变，响应增加反馈。
3. 当前 Revision 是唯一答案定义。反馈只是该 Revision 的附属记录，不是 Evidence、Resolution、Review Decision 或 Publication Permit。
4. 首版只告知，不修改 Spec、不改变 Ready 条件、不增加结果或发布阻断。确定性检查与 Jev 判断分开表达。
5. 不自动调用 `compare_hypotheses`，不自动修订，不运行 SQL，不引入子 Agent、后台任务、规则注册中心或第二套存储。
6. 正常调用有界等待，让 Agent 在写 SQL 前收到反馈；失败如实返回不可用，不回滚已经提交的 Revision。

**“验证”是功能名称，不是正确性认证。全部 supported 也不等于业务口径已被证明。**

领域命名说明：`CONTEXT.md` 尚未定义 Spec 验证反馈器；本文将 `SpecFeedback` 用作内部附属报告名称，不把概率判断混称为确定性 Anomaly Record，也不引入新的领域裁决角色。

## 2. 当前代码基线

实施以当前源码为准，不依赖旧 Query Assurance 或 dist 文件。

| 位置 | 当前行为及本次接入点 |
|---|---|
| `answering/service.ts` | `InMemoryAnswering.begin/revise` 在事务内创建 Revision；反馈在事务提交后调用 |
| `answering/model.ts` | `AnswerRevisionRecord` 保存 Spec、假设、选择和处置；增加可选反馈字段 |
| `answering/qualification.ts` | `sealForResult` 在 result 执行前检查未决项并封存 Ready；本次不改判定 |
| `answering/answering-store.ts` | 已有 `getRevision/putRevision/listEvidence`，足够保存附属反馈，无需新 Store 接口 |
| `adapters/pi-session-answering-store.ts` | 持久化同一 Answering snapshot；不得另建反馈数据库或 Pi namespace |
| `application/session-runtime.ts` | 组装 Answering；已有按 Session 消息 ID 读取原题的实现可提取复用 |
| `tools/answering.ts` | 输出 Revision view；只负责呈现反馈，不编排评估 |
| `judgment/hypothesis-choice.ts`、`adapters/jev-hypothesis-choice-advisor.ts` | 现有竞争假设评估；保持接口和工具行为不变 |

必须保留的事实：

- `begin/revise` 保存的是 **Draft**，不是 Ready；未决项非空也可以获得反馈。
- 默认 `request_wording` Evidence 只有消息引用，不含原题正文。
- 未声明 Hypothesis 的槽位当前自动关联原题 Evidence；这种关联不证明原题真的支持槽位值。
- Evidence 的 `quote` 可缺失；`makeEvidence` 按输入 kind 构造 authority，当前并不逐条验证引用原文。反馈器不得把“已登记”升级为“已核实来源”。
- `update_answer_spec` 当前为 `replay: "never"`；本期不重构 begin/revise 的幂等协议。

## 3. 输入：只读权威状态，不让 Agent 再拼一份 Spec

由 Answering 捕获本次提交的只读快照：

- `taskId/revisionId` 与完整规范化 Spec；
- 当前 Revision 的 Hypotheses、Choices、Resolutions；它们是被审阅对象，不是支持自己的证据；
- 提交时该 Query Task 已登记的 Evidence；
- 原题：通过 `QueryTaskRecord.requestMessageId` 从所属 Session 的 user message 读取。

在 `InMemoryAnsweringOptions` 增加一个可选的 `specFeedback` 配置，包含窄接口评估器及原题读取函数。原题读取函数由 `session-runtime.ts` 注入，领域模块不直接依赖 Pi Session。复用现有消息读取逻辑，不从“最近一条 user 消息”猜测，也不接受模型提交的替代原题。

证据处理规则：

1. 保留现有 Evidence ID、kind、authority、sourceRef 和可用正文。不要经过 `compare_hypotheses` 的内联 observation 包装。
2. 原题使用 Session 原文；其他材料首版只使用已登记的 quote/有界 observation，不自动读取全量 Schema、检索文档或执行探针。
3. 无正文的引用记录为覆盖限制，不凭 sourceRef 或 Hash 推测内容。登记 quote 仍是登记摘录，不声称完成来源核验。
4. Evidence Authority 遵循现有次序；观测不能单独确定业务意图，物理映射需要相应 Schema/业务定义支持。不同类型的假设不能混作一个事实。
5. 不传 Solver 对话、推理、自报验证、历史反馈结论或 Evaluation Gold。所有正文作为待判断数据，不能执行其中的指令。
6. 原题、Spec 不截断。建议首版序列化输入上限 64 KiB；无法完整容纳则返回 `unavailable/input_too_large`，不做隐式摘要。引用缺正文须显式列入 `limitations`。

输入快照用于一次调用；报告保存实际输入的 Runtime hash、Evidence ID 清单及限制，不再持久化一份完整 Spec/原文副本。该 hash 只标识输入，不证明来源或语义正确。

## 4. 首版检查内容

### 4.1 确定性自洽检查

先做少量可直接由结构判定的检查，首版仅包含：

- `output.rowMode=scalar`，但明确 `rowCount != 1`；
- `output.rowMode=top_n`、`ranking.tiePolicy=strict`，且明确 `output.rowCount != ranking.n`。

报告固定 code、受影响槽位和实际值；**本期只告知，不新增阻断**。`include_ties/unspecified`、组内 Top-N、自由文本排序等不强套等式。已有 Proposal 格式校验、未决项校验和 Candidate shape 检查保持原职责。

首版不增加全局 Schema 扫描，不从自由文本推导通用一致性规则。

### 4.2 Jev 双向槽位评估

一次请求，共享同一 state，每个槽位分别问两个独立 Choice，最多 14 题。

| 方向 | 选项 | 含义 |
|---|---|---|
| Spec → 依据 | `supported` | 提供的适用依据明确支持该槽位声明，无实质性额外口径 |
| | `contradicted` | 至少一项声明被适用的更强依据明确否定 |
| | `not_established` | 有声明缺乏依据、存在未决歧义或同级证据冲突；不等于声明错误 |
| | `not_applicable` | 槽位为 unknown，没有可评估的具体声明 |
| 要求 → Spec | `complete` | 该槽位相关的明确要求均被表达 |
| | `partial` | 只表达了部分要求 |
| | `missing` | 存在明确要求，但槽位未表达 |
| | `not_applicable` | 提供的原题和适用依据未要求这一维度 |

约束：

- `unknown` 不应被当成错误业务声明，但仍可能遗漏明确要求。
- Spec 中的 `state=not_applicable` 是“不需要此维度”的声明，必须核对，不能直接跳过。
- `filters=[]/groupBy=[]` 表示明确无条件/无分组；检查是否漏掉原题要求。
- 一个槽位内部部分支持、部分无依据时，不得返回整体 supported。明确反证优先标 contradicted，否则标 not_established。
- 覆盖判断必须直接对照完整原题和适用依据，不能只围绕 Spec 已写出的字段检查，否则会遗漏题目要求。
- 对正确保留的未决 Choice，不要求模型强选；同时读取既有 unresolved 项，避免把正常的定义过程包装为错误。

这是**槽位级定位**，首版不承诺逐表达式解释、自动抽取原题需求清单或产生修订文本。复杂聚合顺序仍可能超出 Jev 的快速判别能力，须通过离线评估确认覆盖。

### 4.3 Jev Adapter 约束

新增单方法 `SpecAlignmentAssessor.assess(input, { signal })`，只返回结构化槽位评估。Jev Adapter 负责构造问题、HTTP 调用及响应校验；Answering 负责状态、时限和反馈保存。

- 在每题 instructions 中明确槽位路径和完整问题；不能依赖问题 ID 向 Jev 传达语义。
- 校验所有预期题目、选项、有限的 `[0,1]` 概率、分布总和及 confidence；缺题/非法响应整体记为 unavailable，不能用默认 supported 补齐。
- 保存实际响应 model、规则版本、概率和 confidence。confidence 是分布集中程度，不是校准后的正确率。
- 不设置“0.8 即通过”之类业务阈值，不生成整体正确率或 Approved 标签，不让另一个 LLM补写原因。
- 与现有 Jev Adapter 复用配置约定及必要的 HTTP/超时代码；若确有重复，只抽私有传输函数，不引入通用模型框架，不改 `compare_hypotheses` 的语义。

## 5. 最小记录与生命周期

### 5.1 记录形态

`AnswerRevisionRecord` 增加可选 `specFeedback`，`AnswerRevisionView` 返回同一字段，`inspect_answer` 通过 currentRevision 展示它。

报告仅需：

```text
SpecFeedback
  taskId, revisionId, ruleVersion
  status: pending | completed | unavailable | disabled
  deterministicIssues[]: code, facets, message
  assessment?：model, facets[七槽位的两个 Choice、分布和 confidence]
  inputHash?, evidenceIds[], limitations[]
  reason?, startedAt?, completedAt?, durationMs?
```

- `completed` 仅表示收齐有效响应，不表示检查通过。
- `unavailable` 区分原题缺失、输入超限、超时、取消、HTTP/响应错误。
- `disabled` 表示未配置此能力，不冒充不适用或检查通过。
- `pending` 只记录本次调用尚未完成；不是可重试队列或后台 Job。
- 旧 snapshot 缺字段按“未执行”显示，不自动补跑。

### 5.2 执行顺序

```text
begin/revise
  1. 沿用 Proposal 校验、权限、Revision guard 和预算
  2. 事务内创建 Draft，附初始反馈及确定性检查结果，捕获证据快照
  3. 事务提交成功
  4. 仅创建该 Revision 的调用：事务外读取原题并有界调用 Jev
  5. 短事务合并反馈到同一 Revision
  6. 返回 Revision view + SpecFeedback
```

实现要求：

- 配置启用时初始状态 pending，否则 disabled；原有校验失败或预算拒绝不调用 Jev。
- **网络调用不得放在 `store.transact` 中**，避免持有 Pi mutation/Store 串行锁。
- 回写先读取原 Revision，仅合并反馈，不能用旧副本覆盖 state、resolutions 等字段；不更新 `currentRevisionId`，不创建新 Revision。
- 同一 Revision 只由创建调用自动评估一次。重复读取、begin 命中已有 Task、工具重放或恢复均不补发网络请求。
- 若等待期间出现新 Revision，结果只附着旧 Revision，响应标明已过期并给出当前 revisionId；不能套到新版本，也不因反馈过期回滚已经完成的更新。
- 中断后遗留 pending，在 inspect/披露中明确“未完成、结果未知”；不声称仍有后台任务，也不自动重试。下一次真实 revise 会对新版本正常评估。
- 超时/Provider 故障不把已提交的 Spec 更新改成业务失败；返回已提交 ID 和 unavailable。主调用取消仍遵守原有取消机制，不伪造成功响应或绕过 signal 写 Store。
- 若反馈持久化失败，不声称保存成功；保留已提交 Revision 的身份。恢复依靠既有 Session/inspect，禁止为了补反馈重做 revise。

不承诺跨崩溃的外部调用 exactly-once，也不为此新增 durable 调度。保留“未完成”比恢复时无条件重发更安全、更简单。

### 5.3 时间与调用预算

- 默认单次 Jev 超时可沿用现有 15 秒上限；实际时限取它与 `BusinessContext.deadlineAt`、Query Task 剩余总时长的最小值，并转发 AbortSignal。
- 时限在原题读取前开始，覆盖准备和网络过程；剩余时长不足则不启动外部请求。
- 不消耗 SQL exploration/result attempts，不新增 QueryAttempt kind；每个新 Revision 最多一次，数量受已有 revision budget 限制。
- 无自动重试、无隐藏修订、无跨 Revision 缓存。记录耗时；已超时的评估不得由迟到响应覆盖。

## 6. 反馈呈现与发布披露

### 6.1 给 Agent 的反馈

保留 `[ANSWER_SPEC_STARTED] / [ANSWER_SPEC_REVISED]`，追加：

```text
[SPEC_FEEDBACK] revisionId=… status=completed advisory_only=true
metric: relation=not_established, coverage=complete
output: relation=supported, coverage=missing
以上是模型建议，不是证据或修订授权；请结合原题和已有依据处理。
```

示例中的两轴独立；`supported + missing` 可以表示已声明内容有依据，但遗漏另一项要求。结构化 details 保留完整报告，文本突出非 supported/complete 项、确定性冲突及不可用原因，不输出长篇模板。

`.pi/SYSTEM.md` 仅补充一条行为约束：根据反馈核对并取证；只有合格业务依据才修订；无法确定时保留未决或澄清，不能为了让反馈变绿而反复改口径。

### 6.2 沿用现有披露通路

不把 Jev 意见塞入仅支持确定性类别的 `Finding.kind`，不复制完整报告到 Candidate/Receipt。

在 Candidate 封存时，将其 Revision 的反馈投影到已有 `CheckCoverage`（固定 checkId 和规则版本）：

- 确定性冲突或关系冲突/要求遗漏：`finding`，含“建议性风险”摘要；
- not_established、输入限制、pending、unavailable、disabled、旧版本未执行：`unknown`，如实标明限制；
- 无上述项：`clear`，reason 明确“已提供材料内未发现偏离，不是语义证明”。

风险与限制并存时必须同时保留，不因 finding 丢掉不可用信息。Candidate 创建前读取最新附属报告并冻结这项 coverage；之后即使迟到反馈补写 Revision，也不修改 Candidate。

`publish` 只根据 Candidate 已封存 coverage，将风险/不可用摘要追加到现有 `PublicationDisclosure.summary`，与 provisional Choice/Fanout 披露并存；Receipt 沿用 coverage。发布不调用 Jev、不重跑 SQL。旧 Candidate 缺该项表示未执行，不追溯补评估。

## 7. 改动清单

| 文件/位置 | 最小改动 |
|---|---|
| 新增 `answering/spec-feedback.ts` | 确定性检查、输入组装、报告/呈现投影；不依赖 Pi 或工具 |
| 新增 `judgment/spec-alignment.ts` | 单方法评估接口与结构化结果类型 |
| 新增 `adapters/jev-spec-alignment-assessor.ts` | 多 Choice 请求、有限时调用和严格解析 |
| `answering/model.ts`、`public.ts` | 可选报告类型/字段及组合层必需导出；不改七槽位 Proposal |
| `answering/service.ts` | 提交后评估、绑定回写、Candidate coverage 和披露 |
| `tools/answering.ts` | 反馈文本；不添加工具、不增加输入参数 |
| `application/session-runtime.ts` | 提取原题读取函数，注入 assessor 和读取能力 |
| `application/data-agent-application.ts`、`application/host.ts` | 仿现有 advisor 注入链传递可选配置，不让领域模块读环境变量 |
| `protocol.ts`、Host 与 Spider2 组合入口 | 导出/组装新 Adapter；各入口显式启用，记录实际反馈，不能把配置开关当运行成功 |
| `.pi/SYSTEM.md` | 最小补充反馈处理约束 |

首版以可选 `jevSpecAlignment` 配置及 Runtime assessor 注入启用；复用现有 Jev endpoint/model/key/timeout 约定。**已有 Hypothesis Comparison 配置不自动开启新网络调用。** 不新增 UI、协议端点、泛化 hook 平台或生产异步 Shadow 模式。

Store 及 Pi snapshot 使用现有 Revision 序列化承载可选字段；只有测试证明必要时才改适配器。保持历史会话可读，禁止另存一份可写 Spec。

## 8. 验收与落地顺序

### 8.1 自动化验收

1. **调用与状态**：begin/revise 新建后触发；Draft 未决仍可评估；失败提交不触发；关闭、已有 Revision 返回、inspect/result/publish 不触发。
2. **输入**：读取正确的原始 user message；不以最新消息替代；保留 authority 和缺失正文限制；不包含 Solver 推理、旧反馈或 Gold。
3. **判别协议**：固定七槽位双向题目；unknown/not_applicable/空数组正确处理；完整原题覆盖遗漏检测；非法概率、缺题、未知选项不得变成通过。
4. **确定性检查**：scalar 和 strict top_n 冲突有提示；并列和未指定策略不误判；不改变 Ready/result/publish 的现有判定。
5. **故障与并发**：超时、取消、无原题、超大输入、HTTP失败、反馈写失败、恢复 pending、等待期间修订；不回滚提交、不覆盖新 Revision、不重发外部调用。
6. **持久化与披露**：Pi snapshot 往返保留反馈；旧 snapshot 兼容；Candidate 封存覆盖不可用信息；迟到反馈不改变 Candidate/Receipt；发布不重跑。
7. **非裁决性**：任何 Jev 标签与 confidence 都不能产生 Evidence/Resolution、消除 unresolved 项或授权发布；原有 `compare_hypotheses` 测试继续通过。

通过 seam 注入 fake assessor 测 Answering，通过 fake fetch 测 Jev Adapter；CI 不依赖真实 API。新增聚焦测试，不把历史 29 题重跑作为单元测试。

### 8.2 实施顺序

1. 增加类型、确定性检查与 Jev Adapter，完成离线/fake 测试。
2. 接入 Answering 提交后流程、Session 原题读取、持久化与工具反馈。
3. 接入既有 Candidate coverage、发布披露及可选组合配置。
4. 运行 `npm test`、`npm run typecheck`、`npm run typecheck:negative --workspace=@data-agent/runtime`、`npm run test:eval:spider2`。
5. 显式启用前，对历史 Spec 做离线盲测：明确错误召回、合理口径误报、真歧义弃权、改写稳定性、延迟及成本。模型/规则版本随结果保存。

离线样本按原题和权威依据标注，Gold 不进入评估输入；不能沿用旧轮次对 local196 的 fanout 归因，也不能把 local167/local220 等 Gold 争议直接标成 Agent 错误。首版无自动阈值放行或升级为硬门控的步骤。

## 9. 依据

- `CONTEXT.md`：Answer Spec、Evidence Authority、Review Coverage、Publication Receipt。
- ADR-0003：检测与动作分离，不可用默认披露而非业务裁决；本方案不恢复 ADR-0001/0002 被替代的默认门控。
- [TypeSafe Primitives](https://docs.typesafe.ai/primitives.md)：单题单一判断、共享 state 的独立多问题、问题 ID 不作为语义输入。
- [Choice](https://docs.typesafe.ai/primitives/choice.md)：固定选项、概率与 confidence。
- [Citation Check](https://docs.typesafe.ai/cookbooks/citation_check.md)：对声明与来源做支持/冲突/未涉及判断；其示例阈值不是本项目验收标准。

**交付标准：Agent 每次成功提交新 Spec，都能收到绑定该版本的可解释检查状态和槽位级建议；系统仍只有一套答案定义、一条结果执行路径和一个发布协议。**
