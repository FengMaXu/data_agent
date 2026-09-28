# Answer Spec Runtime 重构设计逻辑审计

## 范围与结论

- **基线**：`0117a65`，即 `df6d74b^`，2026-09-18 重构前。
- **重构版本**：`df6d74b`，提交说明 `refactor: overhaul runtime and knowledge retrieval`。
- **后续核对**：`HEAD=9e41127` 与当前工作树。后续已提交功能、未提交实验改动与上述重构分开记述；本审计未修改运行时代码。
- **范围**：自由 SQL 的 Answer Spec 所有权、证据、歧义、查询及发布机制；不对整个 Runtime 重构的全部文件逐一评价。

**核心结论**：旧版由 Runtime 的 Query Assurance/Spec Authority 建立并持有 Answer Spec，主查询模型读取 Spec、提出证据或变更请求；重构版让主查询模型通过 `update_answer_spec` 提交七槽位 Proposal，Runtime 对其规范化、建版本并检查**当前版本**的未决项。修订时重建 Hypothesis/Choice 列表而不继承旧版，造成未决项可因省略而消失。这不是最近的消融开关引入的。

> 准确性限定：旧版的 `AnswerContract` 并不是现版同名同形的七字段结构；旧版还可以使用**独立模型 Planner** 补充初始 Spec。“Runtime 拥有 Spec”指它拥有任务准备、证据合并、状态转移和版本权，并不表示旧版所有语义内容均由无模型的确定性程序推导。旧版也不能据此宣称语义正确性已获证明。

## 设计逻辑对照

| 关注点 | 重构前 `0117a65` | 重构后 `df6d74b` | 设计影响 |
| --- | --- | --- | --- |
| 初始 Spec 的入口 | 用户请求进入 `QueryAssurance.prepareTask()`；Runtime 解析明确的输出形状、SQL 式过滤条件、收集有界语义证据，调用 `SpecAuthority.prepare()`；可选的独立 Planner 输出还要与可信任务证据合并。 | `update_answer_spec(kind="begin")` 要求主模型提交 `spec`、可选 `hypotheses/choices/evidence`；`begin()` 从 Proposal 构造首版。 | 从 Runtime 自动准备并交付只读 Spec，变为主模型显式提交答案定义；仍由 Runtime 分配 ID、存储版本。 |
| 七槽位/合同表达 | `AnswerContract` 包含 output、grain、measures、denominator、ranking、time、unit、rounding、joins 等结构化约束；约束有 hard/hypothesis 绑定。 | `AnswerSpec` 为 entity、metric、filters、groupBy、time、ranking、output；`metric` 主要是 kind/expression/unit，其他槽位多为表达式。 | 新的七字段并非旧字段逐项搬迁：分母、连接、舍入等不再有同等的独立合同字段，可能只能写入表达式或另行处理。不能将两版按字段名直接等同。 |
| Solver 与 Spec 的职责 | 旧提示明确要求模型不要自行创建、修改或宣称验证 Answer Spec；`PreparedQueryTask.answerSpec` 是给 Solver 的只读输出。 | 新提示要求任何数据库查询前调用 `update_answer_spec`，修订时提交完整 Proposal；模型工具暴露七槽位的可写输入。 | 主模型承担了槽位内容的提出与跨修订重复提交；Runtime 的“拥有版本”不再等于“独立决定版本内容”。 |
| 修订状态转移 | `SpecAuthority.applyClarification()`、`submitProposal()`、`resolveConflict()` 等从旧 Spec `cloneSpec()`；未指定替换时保留 hypotheses、ambiguities 及合同。 | `revise()` 虽读取 `previous` 并登记 parentRevisionId，但用 `buildSpec(input.spec)`、`createHypotheses(input.hypotheses ?? [])`、`createChoices(input.choices ?? [])` 构造新版本。 | 前一版未决事项不会自动保留；“未提及”实际等同从新版本删除，而不是“未作处置”。 |
| 证据的资格与绑定 | Solver 的 `submitProposal()` 要从可信 Evidence Store 解析 Evidence ID，并查验来源身份字段与权威资格；独立 Planner 的题面约束有引文匹配和降级为 hypothesis 的逻辑。 | 模型工具可提交证据 `kind/sourceRef`；`qualifyEvidence()` 按证据种类与假设种类匹配；未绑定 Hypothesis 的指定槽位由 `proposalFacet()` 默认挂请求文字证据。 | 证据**种类合格**不等于证据**内容支持该具体口径**；还需核对来源、引文和命题匹配。旧版其他可信调用入口亦需分别审查，不应概括为旧版所有入口都完备。 |
| 未决项资格检查 | 旧版分开记录 Hard Constraint、Hypothesis、Ambiguity/Conflict，并通过 Spec Authority 保留版本链；旧 ADR 要求未处置假设不得用于最终结果。 | `sealForResult()` 检查当前 Revision 的 unknown 槽位、未决 Hypothesis/Choice；没有检查“上一版未决项为何不在本版”。 | 当前版门禁本身能阻止**仍在当前版**的未决项；却无法防止省略导致的跨版本消失。旧版歧义保留机制与新版 Choice 门禁并非完全相同协议。 |
| 查询的独立核查 | 旧版有 Query Digest、G1–G4 检测、可配置的 Conversation-Blind Reviewer/Review Token、异常解释枚举等路径；审查模式和发布策略可配置。 | 重构后的主要候选检查为完整性、形状和身份；发布绑定 Ready Revision、不可变 Result Candidate 与 Receipt；没有等价的旧 Digest/盲审路径。 | 独立 SQL—题意比较的实现被替换/移除；新路径强化了 exploration 与最终 Candidate 的分离、结果对象及发布身份。不能只评价为“所有保障都减弱”。 |
| 提示与产品流程 | 旧 `.pi/SYSTEM.md` 指示 SQL 查询直接取得 `queryArtifactId`，按 Runtime Query Assurance 状态发布，不自行写 Spec。 | 新 `.pi/SYSTEM.md` 指示 begin/revise 七槽位后进行 exploration/result，再按 Candidate ID 发布。 | 提示同步改变了用户可见工作流，既是代码入口变化，也是职责变化的模型侧体现。 |

## 具体缺口：未决 Choice 被修订省略

在默认 **required** 模式的最小复现中，上一版本有 1 个未决 Choice；下一次 `revise` 省略 `choices` 后，新版未决 Choice 为 0，结果查询可以生成 Candidate。实现路径如下：

1. `revise()` 使用 `input.choices ?? []` 重建新版本的 Choice，并同样重建 Hypothesis。
2. `sealForResult()` 只对当前 Revision 调用 `unresolvedChoices()` / `unresolvedHypotheses()`。
3. 因此此前未决的 Choice 没有得到 selected/provisional Resolution，仍可从最新版中消失；门禁仅看到空列表。

Spider2 `local141` Trace 中，第一次成功修订后有 **6 个未决 Hypothesis、2 个未决 Choice**。随后探索了年度配额 `SUM` 与 `MAX` 的不同结果；下一次成功修订未提交这两类事项，返回的未决数量均为 0，后续最终 SQL 使用 `SUM(subtotal)`。Trace 能证明发生的调用和状态变化，**不能证明模型内部动机**；该次数据探索也不能单独裁定 `subtotal` 与 `totaldue` 的业务语义。此次复现不依赖 disabled 消融模式或 Jev 建议。

相关离线材料：`C:/data-agent-eval/runs/semantic-spec-30-20260923-deepseek-required/cases/local141/attempts/attempt-001/trace.json`；最小复现与 Trace 是诊断依据，不是业务定义证据。

## 时间与适用性边界

- `df6d74b` 已引入 `update_answer_spec` 的完整 Proposal、修订重建列表与当前版门禁；本缺口的核心路径在该提交中已存在。
- 随后的 `8c003bd` 加入 Jev 假说比较建议；`9e41127` 加入 fanout 检查和咨询性质的 SpecFeedback 等。它们没有恢复未决项的跨版本保留。Jev 建议及反馈均不能替代业务证据。
- 当前**未提交**的评估改动包含语义 Spec 消融开关；默认产品路径仍是 required。不得把实验开关算作 9 月 18 日重构的起因，也不得把单次 A/B 差异解释为稳定因果效果。
- `CONTEXT.md` 将 Spec Authority 定义为管理版本、决定假设如何被证据提升或保留的权威，Solver 只能提议证据、不能直接修改 Spec；`docs/adr/0001-query-assurance-responsibility-separation.md` 反对 Solver 自报合同；`docs/adr/0003-detect-inform-never-block.md` 对未处理假设和检测告知另有要求。当前实现与这些文档的职责表述存在需要澄清的偏差。ADR 的设计意图与两个版本的实际实现须分别看待。

## 后续决策建议（本次未实施）

1. 先确认目标 Interface：模型可提交哪些发现、证据及变更**建议**；哪些初始槽位可以由 Runtime 从题面/受审业务依据提取；独立 Planner 如何只补充、不覆写可信内容。
2. 无论最终入口采用何种形态，Runtime 都应从当前版本管理状态转移：未决项默认保留；解决、撤销或改变影响总体/指标的选择必须显式记录处置及合格依据；检查跨版本连续性。
3. 区分短期的跨版本不变量修补与长期的 Spec Authority 恢复。**仅把模型的完整 Proposal 改成增量 patch，并不能恢复原设计的 Runtime 所有权。**
4. 对生产 Interface 添加回归测试：修订省略未决 Choice/Hypothesis 不会令其消失；证据资格、内容和命题关联不够时不能升级；已发布/候选内容始终绑定当前有效版本。验证不以 Gold 改写业务语义。

## 可复核的代码依据

以下版本前缀均为提交引用，可用 `git show <提交>:<路径>` 复核；行号针对所列提交，而不是当前工作树。

- `0117a65:packages/runtime/src/agent-assembly.ts:1538–1549`：Runtime 在模型执行前准备任务；`:583–633`：Planner 输出规范化、合并与独立生成；`:161–191`：保守解析显式过滤和输出形状。
- `0117a65:packages/runtime/src/query-assurance.ts:484–557`：任务证据、可选 Planner、可信证据合并和 fallback；`:150–168`：旧 Query Assurance Interface；`:791–998`：候选评审与绑定。
- `0117a65:packages/runtime/src/answer-spec.ts:76–165,281–311`：旧结构化合同与 Spec Change Proposal；`:466–509`：约束绑定及题面引文检查；`:585–595,607–746`：`cloneSpec`、Spec Authority、提议证据资格与修订。
- `0117a65:.pi/SYSTEM.md:33–42`：模型不得自行创建或修改 Spec 的旧指令。
- `df6d74b:packages/runtime/src/answering/model.ts:105–170,240–278`：新七槽位、Proposal 和 Choice Resolution 类型。
- `df6d74b:packages/runtime/src/tools/answering.ts:131–188,314–359`：模型可提交的 `begin/revise` Interface。
- `df6d74b:packages/runtime/src/answering/service.ts:372–385,446–540`：槽位依据默认值、Spec/Hypothesis/Choice 构造；`:631–700`：开始任务与完整修订重建；`:860–886,1129–1217`：结果门禁与发布。
- `df6d74b:packages/runtime/src/answering/qualification.ts:33–52,54–109`：证据种类资格、当前 Revision 未决项与封存。
- `df6d74b:packages/runtime/src/answering/candidate-checks.ts:39–76`：新 Candidate 检查范围。
- `df6d74b:.pi/SYSTEM.md:21–68`：七槽位 Proposal 和修订的模型侧指令。
