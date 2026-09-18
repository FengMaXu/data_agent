## 问题陈述

自由 SQL Agent 可以生成语法正确、能够执行、甚至经过多轮自助 verification/reconciliation 的复杂查询，但仍可能误解用户要求的最终形状、总体、计数实体、聚合层级或 JOIN 后度量粒度。第 9 轮固定 Spider2 样本已经显示：同一 Solver 的重复验证经常只能证明候选自洽；模型即使看到反证，也可能不回滚主候选；无依据过滤、漏最终聚合、多余列和 JOIN fanout 仍会进入发布链路。

现有 Query Assurance 已具备 Query Task、Answer Spec、Query Digest、Validated Query Artifact、Review Token 和 Publication Receipt 等基础，但仍缺少一组能够直接约束候选发布资格的有界确定性门。当前 Candidate 列完整性还可能与 Answer Contract 混用，Query Digest 的严格 AST 覆盖不足，Solver 自助验证目的仍然存在，现有 Probe 也没有完整表达不可变 claim、证据前提和实质修复。

用户需要的不是一个声称证明任意复杂 SQL 正确的系统，而是在不把复杂流程转嫁给 Agent 的前提下，可靠阻断证据充分、机器可判的机械错误；对于系统明确没有能力判断的复杂语义，必须如实记录覆盖范围并交给澄清、Reviewer 和 Delivery Policy，不能静默伪装成已检查。

## 解决方案

在现有自由 SQL Query Assurance 上实现有界 G1–G4 确定性门，并保持 Agent-facing 流程为“查询、选择 Artifact、发布、最多修复一次”。Answer Spec、证据准入、Query Digest、Probe、Candidate 失效和发布授权全部由可信 Runtime 管理。

G1 检查最终形状与 Hard Answer Contract；G2 检查有确定性证据证明的未授权总体缩减；G3 检查 Hard Measure/Population Contract 下可证明的 JOIN fanout 和度量粒度破坏；G4 使被反证的 Candidate 失效，并要求修复候选针对失败 claim 发生相关实质变化。

每个门拥有版本化 Gate Applicability Contract。查询明确不在某门支持范围内时记录 `not_applicable`，不得声称已检查；查询属于支持范围但缺少必需 Digest、lineage 或 Probe 时形成 Review Unavailable。确定性门按规则和 SQL 方言分别测试、校准、启用和回滚。

本规格采用断代迁移，不保留旧裁决字段或 Solver 自报验证权。产品和 Spider2 共用 Query Assurance 核心，但使用不同 Delivery Policy。Conversation-Blind Reviewer 在本规格内继续 Shadow；只有独立满足校准要求后才能另行获得 Enforce 权限。

## 用户故事

1. 作为数据查询用户，我希望标量问题只能发布一行一列的最终答案，以便不会收到中间分组明细。
2. 作为数据查询用户，我希望 Top-N 结果遵循明确的排名、数量和并列语义，以便不会收到不稳定或超出请求范围的结果。
3. 作为数据查询用户，我希望最终结果只包含我请求的业务列，以便诊断字段、内部 ID 和中间计数不会泄漏到交付物。
4. 作为数据查询用户，我希望系统确认最终聚合已经完成，以便“平均值”不会被错误交付为待平均的明细。
5. 作为数据查询用户，我希望无依据新增的过滤和排除条件在发布前被发现，以便系统不会静默缩小业务总体。
6. 作为数据查询用户，我希望已授权业务概念的物理字段和值映射可审计，以便数据库观察不会反向创造业务规则。
7. 作为数据查询用户，我希望 JOIN 导致订单级或事实级度量重复时能够被阻断，以便结果不会因 fanout 被放大。
8. 作为数据查询用户，我希望合法的 1:N 或 N:M 业务口径不会仅因行数增加而被自动判错，以便机器检查不会替我发明计数实体。
9. 作为数据查询用户，我希望系统无法判断复杂 SQL 时如实披露覆盖不足，以便“未检查”不会被表示成“已通过”。
10. 作为数据查询用户，我希望复杂 SQL 不因某个明确不适用的窄门而全面失去查询能力，以便有界门控不会退化为通用拒绝器。
11. 作为数据查询用户，我希望用户澄清能够生成新的 Answer Spec 版本，以便后续候选按最新意图重新审查。
12. 作为数据查询用户，我希望一次性发布授权只适用于已披露分歧的精确 Candidate，以便机械错误或后来修改的查询不能复用授权。
13. 作为数据查询用户，我希望内联结果和 CSV 遵循相同的发布规则，以便更换交付形式不能绕过门控。
14. 作为数据查询用户，我希望发布内容就是被检查的同一 Candidate，以便审查后重新执行不会产生不同结果。
15. 作为 Agent，我希望继续只使用查询和发布工具，以便不需要手工维护 claim、Probe、谓词分类或状态机。
16. 作为 Agent，我希望每次成功预览得到稳定的 `queryArtifactId`，以便明确选择最终候选。
17. 作为 Agent，我希望发布失败时一次返回全部可行动 violation，以便不通过多轮猜谜修复门控。
18. 作为 Agent，我希望 violation 指向 Spec 槽位、Digest 路径和失败 claim，以便唯一一次修复能够针对真实分歧。
19. 作为 Agent，我希望系统区分基础设施失败与候选语义失败，以便连接中断或 Artifact 过期不会消耗修复额度。
20. 作为 Agent，我希望换别名或格式不能伪装成实质修复，以便重复候选不会重新获得发布资格。
21. 作为 Agent，我希望用户澄清或新权威证据产生新 Spec 后重置修复额度，以便真正的新信息可以被采用。
22. 作为 Agent，我希望普通探索查询仍然可用，以便编写复杂 SQL 不被 Answer Spec 准备阶段阻断。
23. 作为 Agent，我希望探索结果不会自动成为发布候选，以便中间检查不会被误交付。
24. 作为 Agent，我希望系统不要求我运行 verification/reconciliation 目的查询，以便减少循环自证和无效工具调用。
25. 作为 Spec Authority，我希望 Solver 只能引用可信 Evidence Store 中的证据提交 Spec Change Proposal，以便 Solver 不能自报 authority。
26. 作为 Spec Authority，我希望重新读取证据并自行验证引用、版本和来源，以便伪造引用不能生成 Hard Constraint。
27. 作为 Spec Authority，我希望用户澄清和已评审结构化业务定义能够生成 Hard Constraint，以便明确业务要求具有阻断资格。
28. 作为 Spec Authority，我希望需要语义解释的题目和文档内容先成为 Hypothesis 或 Ambiguity，以便未校准模型不能固化自己的误读。
29. 作为 Spec Authority，我希望 Schema 只建立 Structural Fact，以便字段结构不会越权决定业务总体或分母。
30. 作为 Spec Authority，我希望 observed data 只更新 Physical Mapping 或 Cardinality Evidence，以便数据观察不会创造业务过滤。
31. 作为 Spec Authority，我希望来源冲突成为独立 Conflict Record，以便较低优先级证据不会被静默删除。
32. 作为业务负责人，我希望任务内纠正不会自动升级成跨任务业务定义，以便一次对话不会污染后续查询。
33. 作为 Runtime，我希望 Candidate 列完整性只和 Artifact 预览列比较，以便空 Answer Contract 不再产生 `expected []`。
34. 作为 Runtime，我希望 G1 独立比较 Answer Contract 与 Query Digest/最终 Candidate，以便身份完整性和语义形状不共享裁决字段。
35. 作为 Runtime，我希望 Query Digest 由固定版本、方言感知的 AST parser 生成，以便 tokenizer 或模型回译不能伪装完整语义结构。
36. 作为 Runtime，我希望 Query Digest 记录 coverage、unsupported nodes 和 lineage completeness，以便每个门只对自己真正理解的 facet 负责。
37. 作为 Runtime，我希望 Gate Applicability 由可信策略决定，以便 Solver 不能把最终 SQL标记为门外查询来绕过检查。
38. 作为 Runtime，我希望 G2 为总体影响节点计算 authorized、structural、disputed 或 unresolved 状态，以便授权与证据不足具有不同结果。
39. 作为 Runtime，我希望 G3 分开使用 Measure/Population Contract 与 Cardinality Evidence，以便物理基数不能反向决定业务计数口径。
40. 作为 Runtime，我希望首版 G3 聚焦 Query Digest lineage 完整的 `COUNT/SUM/AVG` 跨 JOIN 场景，以便阻断权保持有界且可测试。
41. 作为 Runtime，我希望阻断型数据 Probe 与 Candidate 共享事务快照或稳定 dataSnapshot，以便数据变化不会被误判为 SQL 反证。
42. 作为 Runtime，我希望 Probe Outcome 不携带自报 blocking 字段，以便 Gate Policy 根据证据前提派生阻断权。
43. 作为 Runtime，我希望 Probe Instance 在执行前冻结 claim、Spec、Candidate、Digest、快照和模板版本，以便失败条件不能事后修改。
44. 作为 Runtime，我希望失败 Candidate 在相同 Spec 和证据版本下永久不可发布，以便反证能够真正约束决策。
45. 作为 Runtime，我希望修复 Candidate 的局部 Semantic Fingerprint 必须针对失败 claim 变化，以便无关 SQL 改写不能恢复资格。
46. 作为 Runtime，我希望 `publish_query_result` 和 `export_query` 在内部完成 Artifact 晋升，以便不增加 Agent 工具往返。
47. 作为 Runtime，我希望同一 Spec 最多一次 Automatic Semantic Repair，以便门控不会引发新的无限重试。
48. 作为 Runtime，我希望旧 Spec、Token、Authorization 和未发布 Candidate 在断代升级后失效，以便新旧裁决规则不能混用。
49. 作为平台运维人员，我希望规则和 SQL 方言分别获得 Enforce 资格，以便一个方言的 parser 成功不能授权另一个方言。
50. 作为平台运维人员，我希望新规则异常时回滚到最近已校准版本，以便确定性门不会简单 fail-open。
51. 作为平台运维人员，我希望没有可回滚规则时必需检查 fail-closed，以便安全故障不会静默恢复发布。
52. 作为平台运维人员，我希望产品 Enforce 使用持久化、追加式 Query Task Store，以便进程重启不会丢失 Spec、修复额度或授权链。
53. 作为平台运维人员，我希望 Audit Record 保存身份、版本、裁决和非敏感摘要，以便问题可复核而不永久保存原始结果行。
54. 作为平台运维人员，我希望 Probe 扫描量、耗时和数量受预算控制，以便门控不会使复杂 SQL 成本失控。
55. 作为平台运维人员，我希望必需 Probe 因预算无法完成时形成 inconclusive，而不是跳过后 Approved。
56. 作为产品负责人，我希望机械门失败不能通过 Publication Authorization 绕过，以便用户授权不会破坏系统身份和可解释性保证。
57. 作为产品负责人，我希望 Semantic Diff 可以通过修改、澄清或精确授权处理，以便真实业务分歧仍有明确出口。
58. 作为 Spider2 评测负责人，我希望 Gold 只用于离线评分，以便运行时门控不发生答案泄漏。
59. 作为 Spider2 评测负责人，我希望不可豁免门失败或必需确定性覆盖不可用时不提交，以便硬门不会成为纯记录机制。
60. 作为 Spider2 评测负责人，我希望确定性门通过但仅 LLM Reviewer 不可用时仍可按独立政策提交，并明确记录未获 Approved，以便评测完成率和审查状态不混淆。
61. 作为校准负责人，我希望确定性门与 LLM Reviewer 分别校准，以便确定性规则不受 Reviewer 模型状态牵连。
62. 作为校准负责人，我希望正确候选与错误候选都进入 replay，以便门控召回提高不会掩盖误阻断。
63. 作为校准负责人，我希望每个支持模式都有正例、邻近反例和等价改写，以便规则不是针对单个历史 SQL 硬编码。
64. 作为校准负责人，我希望报告错误发布、E2E、误阻断、non-delivery、修复、延迟和成本，以便不能用单一正确率掩盖退化。
65. 作为安全审查人员，我希望 Solver 自报 evidence、Digest、hash 和 predicate status 都不具有权威性，以便候选作者不能修改裁决输入。
66. 作为安全审查人员，我希望跨信任域的权威对象使用签名或 MAC，以便普通内容哈希不会被误认为来源认证。
67. 作为隐私负责人，我希望 Probe 只保留必要聚合观测，以便门控不会创建新的原始数据副本。
68. 作为维护者，我希望 G1–G4 的公开行为通过一个最高层 Query Assurance seam 验证，以便测试不绑定内部状态机实现。
69. 作为维护者，我希望复杂 SQL 明确在门外时记录 `not_applicable`，以便有界能力不会被误解为故障。
70. 作为维护者，我希望支持范围内解析失败记录 Review Unavailable，以便 parser 缺口不会被 Reviewer 或用户授权伪装成确定性通过。

## 实现决策

- 本规格是现有自由 SQL Query Assurance 的增量，不重新建立第二套 Task、Spec、Artifact、Reviewer 或 Publication 领域模型。
- 产品 Query Assurance 是核心语义；Spider2 只提供独立 Delivery Policy 和离线校准场景。
- KTX 语义查询不进入自由 SQL Reviewer，只复用 Publication Status、Receipt 和审计基础设施。
- 唯一 Agent-facing 流程保持为查询、选择精确 Artifact、调用内联或 CSV 发布，以及最多一次修复。不新增 Solver 可修改的 Task 工具或公开 Candidate 提交工具。
- 从 Solver-facing 查询工具中移除 verification/reconciliation 目的。普通探索保留，但不产生权威 Probe 或发布资格。
- Candidate 结果完整性与 Answer Contract 语义检查分离。Candidate 只与 Artifact 的列和结果身份对账；G1 单独检查 Hard Output Contract。
- 空或缺失的 Hard Output Contract 表示未知，不表示零列。本规格首先修复 `expected []` 路径，并覆盖空合同、零行结果、列变化和额外列。
- Evidence Authority 严格采用领域词汇表中的顺序。Gold 只用于离线评分，永远不是运行时证据。
- Evidence Reference 必须具有稳定身份、来源版本、可验证 locator 和内容身份。引用存在性与语义蕴含分别处理。
- Spec Authority 拥有 Answer Spec 版本。Solver Proposal 只能引用可信证据；Runtime 重新验证 authority。用户澄清、已评审结构化业务定义和确定性提取的明确要求可以成为 Hard Constraint。
- 未校准的 LLM Spec 组件不能把语义蕴含判断晋升为 Hard Constraint。数据观察只能更新 Physical Mapping 或 Cardinality Evidence。
- 不新增 `supported/assumed/conflicted`。使用 Hard Constraint、Hypothesis、Ambiguity 和 Conflict Record 表达证据状态。
- Query Digest 是唯一规范术语；不新增 AST Digest。权威 Digest 由固定版本的方言感知 AST parser 生成，并携带 SQL、Schema、parser、dialect、coverage 和 lineage 身份。
- tokenizer、正则或模型回译可以作为 Shadow 诊断，但不能将必需 facet 标记为 checked。
- 每个门拥有版本化 Gate Applicability Contract。门外查询为 not applicable；门内缺失必需覆盖为 unavailable。Applicability 由 Runtime 决定，不能接受 Solver 自报。
- G1 比较 Hard Answer Contract、Query Digest、预览元数据和完整 Candidate。它覆盖最终聚合、行模式、行数约束、输出角色、额外列、Top-N、排序和并列语义。
- 未由权威证据明确要求的展示标签、类型和顺序不成为 Hard Constraint。输出 alias 不能替代完整 lineage。
- G2 使用结构化总体影响节点，并由可信控制面赋予 authorized、structural、disputed 或 unresolved 状态。disputed 被拒绝；unresolved 进入澄清或弃权，不能 Approved。
- 已授权概念的 Physical Mapping 可以由 Schema 或受控 observed data 支持，但数据观察不能授权新增过滤。
- G2 的首版阻断权只覆盖 Applicability Contract 明确支持且可确定性归类的总体缩减。未覆盖的复杂 CASE、集合运算或嵌套总体语义不声明 checked。
- G3 将 Measure/Population Contract 与 Cardinality Evidence 分开。前者回答统计什么，后者回答关系实际唯一性、覆盖率和 fanout。
- G3 只有在语义 Contract 为 Hard、关系级 Query Digest 和度量 lineage 完整，并且正式或同快照证据证明候选破坏 Contract 时才硬阻断。
- G3 首版聚焦 `COUNT/SUM/AVG` 跨 JOIN 的可证明 fanout，不把所有行数增长视为错误，也不从数据自动选择业务计数实体。
- 阻断 Probe 由 Runtime 的版本化模板生成。Outcome 为 passed、failed、not applicable、unsupported 或 inconclusive；阻断权由 Gate Policy 推导。
- Probe Instance 在执行前冻结并绑定 claim、Spec、Candidate、Digest、Schema/数据快照和模板版本。执行后只追加 observation、Evidence Reference 和 verdict。
- 阻断型数据 Probe 必须与 Candidate 共享事务快照或稳定数据快照；无法共享时不得直接否定 Candidate。
- 失败 Candidate 在同一 Spec 和证据版本下永久不可发布。修复必须改变失败 claim 对应的局部 Semantic Fingerprint，或绑定新的权威 Spec/证据版本。
- 同一 Spec 只允许一次 Automatic Semantic Repair。Candidate 的确定性或语义拒绝消耗额度；TTL、事务和基础设施故障不消耗额度。
- `publish_query_result` 和 `export_query` 接收精确 Artifact ID，并在可信 Runtime 内部完成 Candidate 晋升、完整物化、G1–G4、Reviewer、Delivery Policy 和原子发布。
- 用户澄清创建新 Spec；Publication Authorization 不修改 Spec，只绑定一个已披露 Semantic Diff 的精确 Candidate。
- 不使用 `pass/qualified` 平行状态。Review Decision、Review Outcome、Publication Status 和 Runtime 派生生命周期各自保持单一职责。
- 产品中不可豁免门失败或必需 Digest/Probe unavailable 时不发布且不能授权绕过。确定性门通过但 LLM Reviewer unavailable 时产品 fail-closed。
- Spider2 中不可豁免门失败或必需确定性覆盖 unavailable 时不提交；只有确定性门通过后，语义 disagreement 或 LLM Reviewer unavailable 才可按独立政策提交且不得记录 Approved。
- 产品 Enforce 要求持久化、追加式 Query Task Store。内存实现仅用于测试、开发和 Shadow。
- 影响裁决的 Spec、Evidence Admission、Digest、parser、dialect、Gate、Probe、Schema、Reviewer 和 Delivery Policy 版本全部进入 Token、缓存与 Audit 身份。
- 本规格采用 schema major 断代迁移，不提供旧字段 fallback。部署前排空或关闭在途 Task；旧 Token、Authorization 和未发布 Candidate 失效；已发布 Receipt 作为历史审计保留。
- 确定性门按规则和方言分别校准。规则异常时回滚到最近已校准版本；无可回滚版本时必需检查 fail-closed，不按单题关闭门。
- Conversation-Blind Reviewer 在本规格内继续 Shadow。新版 Spec、Digest、Conflict 或 Probe 摘要会产生新的 Calibration identity；Reviewer Enforce 是后续独立决策。
- 实施按 S0 Candidate 完整性、S1 Query Digest、S2 Evidence/Contract、S3 G1、S4 G2、S5 G3/G4、S6 生命周期与发布、S7 replay/Shadow/Enforce 的顺序推进。
- 每阶段先运行单元和变异测试，再运行冻结候选 replay 和 Shadow E2E；达到预注册门槛后才按规则和方言进入 Enforce。

## 测试决策

- 最高、主要验收 seam 是公开 Query Assurance 编排。测试从准备 Query Task、记录 Artifact、请求发布到产生 Review Outcome/Receipt，验证用户可观察行为，而不绑定内部状态机实现。
- Agent 工具集成是第二个必要 seam，用于证明 Agent 仍然只需查询、选择 Artifact、发布和最多修复一次，并证明内联与 CSV 无绕过路径。
- Query Digest compiler 使用独立的公开输出 fixture seam，因为方言 coverage、unsupported nodes 和 lineage 是门控资格的直接输入。
- 除 Query Digest fixture 外，不新增低层测试 seam；Spec Authority、Probe Registry、Candidate Store 和 Delivery Policy 优先通过 Query Assurance 合同测试覆盖。
- S0 测试覆盖空 Hard Output Contract、合法零行结果、预览与 Candidate 列不一致、额外业务列和额外诊断列。测试区分 Artifact 完整性错误与 G1 语义错误。
- Answer Spec 测试覆盖用户澄清、已评审业务定义、任务文档、请求原文、Schema、observed data 和模型推断的准入差异，以及无效 Evidence Reference、同级冲突和 Spec 版本演进。
- Spec Change Proposal 测试证明 Solver 自报 authority 被忽略，可信 evidenceId 会被 Runtime 重新读取，observed data 不会创建业务 Hard Constraint。
- Query Digest 多方言 fixture 覆盖 CTE、子查询、JOIN、聚合、窗口、QUALIFY、DISTINCT、集合运算、NULL 和输出 lineage。测试只断言公开 Digest 与 coverage，不绑定 parser 私有 AST。
- Gate Applicability 测试区分三种外部行为：门内 checked、门外 not applicable、门内 unsupported/unavailable。任何门外查询都不得被记录为 checked。
- G1 决策表覆盖 scalar、Top-N、grouped、detail、漏最终聚合、多余列、缺列、列角色、LIMIT、排序和边界并列。正确候选与相邻错误变异成对出现。
- G2 决策表覆盖题目明确过滤、文档授权过滤、物理编码映射、Schema structural predicate、无授权排除、INNER JOIN 总体丢失和 unresolved 映射。数据中“看见一个值”不能成为业务授权。
- G3 fixture 同时包含合法 1:N、合法连接行口径、事实度量被维度 fanout、预聚合修复、COUNT 与 COUNT DISTINCT、AVG 分子分母守恒及 unsupported 复杂 JOIN。
- Cardinality Evidence 测试区分 formal constraint 与 observed snapshot。当前快照未见重复不能升级为跨快照唯一约束。
- Probe 测试覆盖五种 Outcome、证据前提不足、执行前冻结、工具错误/超时、快照不一致和执行后篡改失败条件。
- G4 测试对失败 SQL生成别名变更、格式变更、无关 CTE 重排、相关过滤修复、相关聚合修复和 Spec 版本变化，验证局部 Semantic Fingerprint 的外部资格结果。
- 修复预算测试证明同一 Spec 只有一次 Candidate 修复，基础设施失败不消耗额度，用户澄清产生新 Spec 后额度重置。
- Candidate 晋升测试证明探索 Artifact 不能直接绕过门；发布内部晋升保持 SQL hash、结果身份、Schema fingerprint 和有效快照。
- Publication 测试覆盖不可豁免失败、Semantic Diff、Needs Clarification、Abstained、必需确定性 unavailable、仅 LLM Reviewer unavailable，以及产品/Spider2 的不同结果。
- Authorization 测试证明用户只能授权精确 Semantic Diff Candidate，不能绕过机械门、伪造证据、Digest 不可用或 Candidate 身份错误。
- 断代迁移测试证明旧 Token、Authorization、Candidate 和旧字段调用被明确拒绝，不存在静默 fallback 或新旧节点混合裁决。
- 持久化与重启测试证明 Enforce Task 可以恢复 Spec、修复额度、Probe、Token 和审计链；无法恢复时 fail-closed。
- 并发测试覆盖同 Task 单一发布、Token 单次消费、重复请求幂等、Spec 更新导致旧 Token 失效、取消和原子发布失败。
- 安全测试覆盖 Solver 伪造 evidence、Digest、predicate status 和 hash，跨信任域对象认证，SQL/Schema/数据中的指令文本，以及 Audit 中原始结果排除。
- 资源测试覆盖 Probe 数量、扫描量和耗时预算。必需 Probe 超预算必须产生 inconclusive/unavailable，不能跳过后 Approved。
- 历史 replay 使用第 9 轮错误 Candidate 和已复核正确反例，分别报告 G1–G4 claim，不用 Gold 作为 Runtime 输入。
- 变异测试从正确 SQL 生成新增/删除过滤、COUNT/DISTINCT 互换、JOIN 前后移动聚合、增删 GROUP BY、修改 LIMIT/tie policy、LEFT/INNER 互换及纯别名/格式变异。
- 每阶段按单元/变异、冻结 replay、Shadow E2E、Enforce E2E 顺序执行；不得合并上线后一次性归因。
- 确定性门 Enforce 的预注册门槛为：机械 fixture 阻断与放行 100%；正确候选非阻断 specificity 至少 99% 且单侧 95% 置信下界至少 98%；hard-block diff precision 至少 99%；声称支持的历史机械模式 recall 为 100%；固定集净 E2E 不下降；non-delivery 和 timeout 增量分别不超过一个百分点。
- 失败报告必须同时给出不可豁免门绕过、错误发布、官方 SQL/E2E、正确候选误阻断、non-delivery、Review Outcome、修复是否实质消解 claim、延迟、工具调用、扫描量和成本。
- Prompt 快照只作为辅助证据；主要验收永远基于公开 Query Assurance 和 Agent 工具行为。

## 范围外

- 证明任意复杂 SQL 的业务语义绝对正确。
- 在本规格内让 Conversation-Blind Reviewer 获得 Enforce 权限。
- 重新调优 Reviewer prompt 或通过同一个 LLM 生成校准真值。
- 将 Spider2 Gold 作为 Answer Spec、Query Digest、Probe 或 Reviewer 的运行时输入。
- 对 KTX 查询重复运行自由 SQL Reviewer。
- 首版为任意 N:M、多层窗口、递归、复杂 CASE 或集合运算生成通用守恒证明。
- 让 Solver 创建具有阻断或放行权的 Probe、谓词分类、Digest 或合同。
- N-version Solver、LLM Back-translation 的阻断权或“两个 Solver 一致即正确”。
- 将任务内用户纠正自动升级为全局业务定义。
- 允许用户授权绕过 Candidate 身份、证据真实性、必需确定性覆盖或 G1–G4 不可豁免失败。
- 兼容旧 Answer Contract、Probe blocking、Solver expected columns 或旧 unavailable 发布开关。
- 同时开启所有 SQL 方言的 Enforce；每个方言必须独立取得资格。
- 在本规格中完成产品端澄清/授权界面的视觉实现；本规格只提供稳定的领域合同和状态。
- 把第 9 轮十题上的预测命中写成已经实现的 6–7/10 覆盖率。

## 补充说明

- 本规格是已接受“自由 SQL 查询采用职责分离的 Query Assurance”架构的增量，核心新决定是“有界确定性门控而非通用语义证明”。
- 现有 Query Assurance 基础设施工作由 #41 及其子任务 #43–#55 提供。本规格应复用已有 seam，并在实现前协调 #44、#45、#54、#55 中已过时的准入、parser 降级、校准和 verification 描述。
- 第 9 轮事实边界为：官方 SQL/E2E 0/10；十题工具调用范围 16–77；受 `expected []` 影响的六题为 29–77；local061 的 77 是全部调用，逐题报告定位到 13 次相关导出调用；现有运行级记录不支持 timeout 结论。
- local034/local037 是可直接观察的 JOIN fanout 样本；local029/local032 是计数粒度偏离官方口径，不能和前两题写成同方向的候选膨胀。
- local003、local032、local050 等业务口径问题继续属于证据、澄清和 Reviewer 范围；本规格不承诺确定性命中。
- 实施里程碑为 S0 Candidate 完整性、S1 Query Digest、S2 Evidence/Contract、S3 G1、S4 G2、S5 G3/G4、S6 生命周期/发布、S7 校准/Enforce。每个阶段可独立交付、回放和回滚。
