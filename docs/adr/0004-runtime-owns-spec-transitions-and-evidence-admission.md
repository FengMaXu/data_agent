---
status: accepted
---

# Runtime 持有 Answer Spec 的状态转移与证据准入

## 背景

`df6d74b` 把 Answer Spec 的入口改为主模型调用 `update_answer_spec`，并以七槽位 Proposal 起草、修订 Spec。审计（`docs/answer-spec-runtime-refactor-audit-20260918.md`）确认了一个缺口：`revise` 从模型提交的完整 Proposal 重建 Hypothesis/Choice 列表，上一版的未决项只要被省略就会消失，而 `sealForResult()` 只检查当前版本。

复核代码后还发现三处同源问题：

1. 模型可以提交 `user_confirmation`、`reviewed_definition`、`task_document` 证据，Runtime 不核验来源就登记；`qualifyEvidence()` 只看证据种类。模型因此能自己造出最高权威的"证据"。
2. `begin` 自动登记的题面证据没有引文，但 ID 会通过槽位依据返回给模型；业务语义假设接受 `request_wording`，因此引用这个 ID 就能"证明"任何业务假设。
3. 没有绑定假设的槽位，默认依据被写成题面证据，模型推断看起来像题面明文。

另外，每次 `revise` 都会重新生成 Hypothesis/Choice ID，同一个未决项跨版本没有稳定身份。

这些问题的共同根源是：模型同时是提议者、证据提供者和处置者。版本号和门禁由 Runtime 维护，但下一版的内容和证据资格实际由模型决定。

## 决策

1. **模型负责提议，Runtime 负责转移。** `begin` 仍由模型起草初始 Spec；`revise` 不再提交完整新状态，而是提交对当前版本的增量：槽位补丁、新增 Hypothesis/Choice、对已有项的处置（Disposition）和新证据。Runtime 从当前版本复制出新版本再应用这些增量，未提及的内容一律原样保留。
2. **Hypothesis、Choice 和 Alternative 的 ID 只在创建时发放一次，并跨版本保持不变。** 已有的 Resolution 随项目一起保留。
3. **未决项只能通过显式处置离开未决状态**，处置方式只有四种：
   - `support` / `refute`：依据必须合格。
   - `select`：依据必须合格。
   - `provisional`：必须披露，且不得用于影响 `entity` 或 `filters` 的总体选择。
   - `supersede`：由本次新增或现有的项承接原项的全部受影响槽位，并写明理由。

   Runtime 在事务内检查连续性不变量：上一版中每个未决项，在新版中要么仍然未决，要么有本次处置记录。项目只能通过 `supersede` 从新版中移除。
4. **证据准入由 Runtime 决定。**
   - 文本类证据（`request_wording`、`user_confirmation`、`task_document`、`reviewed_definition`）必须带引文。Runtime 通过受信来源读取原文，逐字核验引文后才登记为已核验证据；无法核验的一律拒绝。
   - `request_wording` 只能引用本任务的原始请求消息。
   - `user_confirmation` 只能引用 Host 提供的当前操作用户消息，并且不能是原始请求消息。
   - 文档类证据只能引用组合根明确授权的知识文档。文档的权威等级由组合根配置，不取自模型、文档内容或 frontmatter。
   - `query_observation` 只能由 Runtime 在探索查询时登记。
   - `qualifyEvidence()` 只接受已核验的文本类证据、`schema_fact` 和 Runtime 登记的观测证据。
   - 证据引用只能使用 Runtime 发放的 Evidence ID 或同一次调用内的 `localId`，不再按 `sourceRef` 匹配。
5. **槽位依据必须如实标注。** 槽位依据分三种：绑定 Hypothesis、引用合格证据、模型推断（`inference`）。遵循 ADR-0003，推断依据不阻断结果查询，但会进入 Revision 视图和发布披露。

## 考虑过的方案

- **只在 `revise` 中把省略的未决项自动补回。** 否决：模型仍可引用题面证据或自造证据来"解决"未决项，门禁只是换了一种绕过方式。
- **恢复旧版 Spec Authority、Planner、Query Digest 和盲审整套路径。** 否决：成本高，而旧版同样依赖独立模型生成语义内容。本 ADR 只收回转移权和证据准入权，这两项才是阻止自我认证所必需的。
- **让 Runtime 从题面确定性抽取初始槽位。** 暂缓：可以作为后续增强；诚实标注依据已经能区分题面明文和模型推断。
- **把命题与证据内容的相关性也做成硬门禁。** 否决：没有确定性判定方法。引文核验只能证明原文里确实有这句话，不能证明它支持当前命题。这部分由 SpecFeedback/Jev 提供咨询性核对，并作为已知剩余风险记录。

## 后果

- `update_answer_spec(kind="revise")` 的参数不兼容旧版：`hypotheses`/`choices` 改名为 `addHypotheses`/`addChoices`，新增 `dispositions`，`spec` 变为可省略字段的补丁。旧式调用会因 schema 校验失败而收到明确错误，不会被静默当作删除处理。
- Answering 新增受信的 `EvidenceSource` 端口。未配置时，文本类证据无法核验，只能依靠 `schema_fact`、观测证据、临时选择或用户澄清来处置未决项。
- 大多数任务的发布会带上推断槽位的披露。这是如实披露，不是新增的阻断。
- 旧快照中没有核验记录的文本证据不再具备资格，不会被追溯提升；已经封存的 Revision 和已发布的 Receipt 不受影响。
- 剩余风险：`schema_fact` 暂不核验来源，但只能支持物理映射和数据性质假设；引文与命题的相关性不做确定性判定。
- 取代 `df6d74b` 中"修订提交完整 Proposal"和"模型可登记任意种类证据"的做法；ADR-0001 中 Solver 不得直接修改 Spec 的职责分离意图，改由"增量提议 + Runtime 转移"实现。

## 修订（2026-10-01）：用户对澄清的回答可作为 `user_confirmation`

决策中“`user_confirmation` 只能引用 Host 提供的当前操作用户消息”漏掉了 `ask_user_clarification`：用户的回答在同一操作内作为工具结果返回，不是新的用户消息，于是唯一可引用的消息只剩原始请求，而原始请求不算确认。需要澄清的统计总体决定因此永远无法被证实，模型只能反复追问。

- 用户回答澄清时，Host 把“问题、选项、回答”记录在发起提问的 Session 中（每个 clarificationId 一条），先于模型看到回答。模型不能写入这份记录。
- `user_confirmation` 的来源可以是当前操作的用户消息，也可以是一条已记录的澄清回答：模型以 `clarificationId` 指名，Runtime 读取该 Session 的记录并逐字核验引文。未回答、超时、其他 Session 的澄清以及不在回答原文中的引文一律拒绝。
- 核验方式记为 `clarification_answer_quote`，与 `user_message_quote` 同属用户权威。原始请求仍然只能作为 `request_wording`。
