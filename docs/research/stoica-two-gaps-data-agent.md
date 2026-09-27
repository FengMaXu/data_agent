# Two Key Gaps 与 Data Agent 设计对照

## 来源与范围

- Ion Stoica, [Two Key Gaps in Agentic Software Engineering](https://x.com/istoica05/status/2100950168333906251)。X 直连读取失败；经 FXTwitter 代理取得文章正文及其论文链接，原始响应与提取文本位于 `scratch/stoica-agentic-gaps/`。代理不作为额外独立证据。
- Krentsel et al., [Reality Is the Final Verifier: On Two Key Gaps in Agentic Software Engineering](https://arxiv.org/html/2609.12039v1)，2026-09-10，直接从 arXiv HTML 核对。
- 下述现状来自静态阅读当前代码及设计文档；没有运行评测，不声称建议已经提高正确率。双循环设计文档自身标注“架构设计，尚不表示实现或验收完成”。

## 核心结论

文章与 Answering 的语义保障方向一致，但外层 assurance 不仅是单次查询的 Answer Spec 修订：还要结合真实使用反馈，修订环境假设、评价方法及授权政策。不能以“已有双循环”断言两个 gap 已被解决。[论文 §§2、5；项目 `docs/answering_dual_loop_architecture_design.md` §§4–6]

## 三类差距

| 类型 | 论文含义 | Data Agent 中的对应（分析性映射） |
|---|---|---|
| Requirement gap | 记录需求 R 与实际意图 I 的差距 | Answer Spec 漏掉用户的统计总体、分母、时间口径或业务含义 |
| Model gap | 环境模型 M 与真实世界 W 的差距，非语言模型能力差距 | 假定字段唯一、数据完整及时、金额单位统一、查询快照一致，却与实际数据库不符 |
| Evaluation gap | 已给定 R/M，但检查器 E 错误接纳 P；在固定前提下原则上可缩小至关闭 | SQL 违反明确 Spec，但检查器只看结果形状，未发现过滤、连接或聚合错误 |

来源：论文 §§2.1–2.4。每类需要不同补救；加测试不能替代业务授权，加更多审阅 Agent 也不能补出所有审阅者都没有接触的真实需求或环境证据（§4.4）。

## 已有设计与能力

1. **定义与实现分离**：设计文档把外层定义收敛与内层保持规格的实现修复分开；主 Agent 推进两层，子 Agent 并非固定承担某层。[`docs/answering_dual_loop_architecture_design.md` §§1、3–5]
2. **不让模型自行认证**：Runtime 核验受信文本引文并控制增量修订。引文存在不证明引文支持命题，ADR 明确承认剩余风险。[`docs/adr/0004-runtime-owns-spec-transitions-and-evidence-admission.md`；`packages/runtime/src/answering/evidence-admission.ts::quoteAppearsIn/admitOne`]
3. **义务连续性**：未决项不能通过修订时省略而消失；最终查询需处理未知槽位、Hypothesis、Choice。推断槽位会披露，但不阻塞封存。[`packages/runtime/src/answering/qualification.ts::assertContinuity/sealForResult/inferredFacets`]
4. **不把观测当语义裁决**：默认 CandidateCheck 检查完整性、形状、身份；fanout 是有界观测，非业务判定。未知与不适用不能伪装为通过。[`candidate-checks.ts::DEFAULT_CANDIDATE_CHECKS`；`fanout-execution.ts::fanoutFindings`；ADR-0003]
5. **交付身份受控**：发布当前 Revision 绑定的不可变 Candidate，核验内容身份，不重跑 SQL。此能力保证交付一致性，不保证答案语义正确。[`publication.ts::publishCandidate/composeDisclosure`]
6. **评测已有分离基础**：Spider2 文档规定实验冻结、Episode/Score 分离、Spec 质量标签和固定分母；不能把已有 benchmark 分数直接当生产可靠性。[`evaluations/spider2/README.md`]

## 设计启发与建议（不是已实现承诺）

### 1. 将关键环境假设显式化

按影响记录唯一键、映射来源、单位、时区、数据更新时间、空值/哨兵、探针与结果快照范围，以及失效条件。优先复用现有 data_property/physical_mapping Hypothesis 和 Evidence/coverage，而非立即建立新状态权威。代码中的 schema_fact 当前不核验来源；fanout 的 snapshotScope 当前可为 probe_statement/unbound，所以不应将探针事实推广为所有未来数据事实。[论文 §§2.3、6.1；`evidence-admission.ts` schema_fact 分支；`fanout-check.ts` snapshotScope]

### 2. 让修复针对真正的故障对象

发布后反馈应关联原 Task、Revision、Candidate、Receipt 与可用上下文，再判断需改变 SQL（P）、业务定义（R）、环境假设（M）、检查器（E）还是使用政策。不要每次把失败变成更长 prompt 或“一律 DISTINCT”之类通用规则。此处是跨任务、跨版本的产品治理闭环，不要求新增 Agent Runner。[论文 §5；项目双循环文档 §§6–8]

### 3. 更有信息量的澄清与审阅

子任务按独立证据来源及待解问题分工。向用户展示备选口径及其影响，而非让多个模型对同一不完整 Spec 投票；涉及总体、分母及高风险用途时由有权限的人裁决。低风险、已授权的常规选择可以自动化，不要求人工审核所有步骤。[论文 §§4.4、6.2、6.4；ADR-0003/0004]

### 4. 评测答案之外，还评测假设变化与澄清

在隔离副本中构造合法的数据扰动、Schema/刷新变化、歧义问题、检查器故障与用户纠正序列。语义保持的变形测试应声明前提，不把重复事实行一概视为无影响。区分业务误解、环境误建模、SQL/检查缺陷及运行失败；统计正确交付、错误交付、合理澄清/暂停、人工成本和延迟。冻结开发集与留出评测，Gold 不成为运行时业务证据。[论文 §§5.2、6.1、6.4；`CONTEXT.md` Evidence Authority；Spider2 README]

### 5. 将学习变成有权限与失效机制的改进

沉淀的是带来源、作用域、负责人、验证测试和复审/失效条件的 lesson，不是自动晋升为业务定义的自然语言记录。合格的人确认后，分别落入业务定义、检查器、环境事实或政策；反证可以缩小或撤销适用范围。当前 KnowledgeWriter 提供 learning append、canonical 文档写入限制及审计，但不能仅凭这些机制就宣称具备完整 lesson 治理。[论文 §6.3；`packages/runtime/src/knowledge-write.ts`；`CONTEXT.md` Business Definition Proposal]

## 与 IDS 的关系

IDS 主要强化在给定规格下的代码—证明联合搜索；本篇解释即使该内层达到形式正确，需求与环境仍可能不充分。Answering 已承担需求澄清的一部分；下一步值得优先验证的是环境证据、真实反馈、评测独立性及风险分级，而非无条件增加 Reviewer 或宣称形式化保证。[IDS §§3–4、附录 H；本论文 §§2、5–6]
