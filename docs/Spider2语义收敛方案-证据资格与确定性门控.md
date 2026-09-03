# Spider2 语义收敛增量 RFC：证据资格与有界确定性门控

> 状态：superseded by `Spider2第11轮修复计划-拆除裁决层与Hook重接.md`
> 规范依赖：`CONTEXT.md`、`docs/adr/0001-query-assurance-responsibility-separation.md`、`docs/adr/0002-bounded-deterministic-query-gates.md`、`docs/Query Assurance架构设计V2.md`
> 证据来源：`docs/Spider2第9轮10题Trace逐题错误分析报告.md`、`docs/Spider2与Query Assurance测评转交文档.md`

## 1. 核心决定

本 RFC 不建立“任意复杂 SQL 的正确性证明系统”。它在现有 Query Assurance 上增加一组**有界确定性门**：只有证据前提合格、Query Digest 覆盖充分、机器能够判定的错误才获得阻断权。

首版只承诺阻断四类机械失败：

1. 最终形状、聚合层级或输出列违反 Hard Answer Contract；
2. 有确定性证据证明的未授权总体缩减；
3. Hard Measure/Population Contract 下可证明的 JOIN fanout 与度量粒度破坏；
4. 被反证的 Candidate，或未针对失败 claim 发生实质变化的重提。

业务度量误读、反直觉计数实体、隐藏总体及运行时证据与 Gold 冲突不属于确定性门能够保证解决的问题。它们继续由 Evidence Authority、用户澄清、Conversation-Blind Reviewer 和 Delivery Policy 处理。

## 2. 证据事实与修正

### 2.1 已确认事实

- 第 9 轮固定 10 题的官方 SQL 正确率为 0/10，固定分母 E2E 为 0/10。
- 成功导出的 local003、local032、local035、local050 也全部被官方判错，因此导出失败不能解释全部错误。
- 十题全部工具调用范围为 **16–77**；受 `CANDIDATE_COLUMNS_MISMATCH: expected []` 影响的六题为 **29–77**。
- local061 的 77 是全部工具调用数，不是 77 次同类重试。运行记录为 15 个工具错误，逐题报告定位到 13 次 `expected []` 导出调用。
- 第 9 轮运行状态为 10 题全部完成，现有运行级记录不足以支持“伴随 timeout”的表述。
- 第 8 轮 Shadow v2 的 5 次 Approved 全部对应官方错误结果，Reviewer 在 Calibration 前不能获得阻断或批准权。
- 第 9 轮存在“发现反证但不回滚主候选”和“重复同一候选逻辑”的行为。

### 2.2 不再采用的表述

- 不把一次提示词实验下降写成“所有提示词路线已被实验证伪”；
- 不把 `expected []` 的完整根因调用链写成已查清；
- 不声称新门控已经覆盖 6–7/10；
- 不把 local029/local032 与 local034/local037 归为同方向的候选 JOIN 膨胀；
- 不把 local050 的隐藏差异唯一确定为某一个总体口径。

“6–7/10”只能是待回放的覆盖假设，不是已实现效果或首因覆盖率。

## 3. 与现有 Query Assurance 的关系

现有架构已经定义或部分实现 Query Task、Answer Spec、Spec Authority、Query Digest、Validated Query Artifact、Conversation-Blind Reviewer、Review Token、Publication Authorization 和 Publication Receipt。

本 RFC 只增加：

1. Candidate 完整性与 Answer Contract 的职责分离；
2. Hard Constraint 的证据准入；
3. 方言感知、AST 驱动的 Query Digest；
4. G1–G4 有界确定性门；
5. 候选反证、一次修复和发布资格的代码约束；
6. `not_applicable` 与支持范围内 `unsupported` 的区分。

KTX 路径不进入自由 SQL Reviewer，只复用 Publication 和审计基础设施。

## 4. Agent 与 Runtime 的边界

Agent-facing 流程保持为：

```text
query_database
  → 选择精确 queryArtifactId
  → publish_query_result / export_query
  → 若被拒绝，最多修复一次
```

Agent 不创建 Query Task 状态，不修改 Answer Spec，不分类谓词，不编写具有裁决权的 Probe，也不提交 Query Digest。

从 Solver-facing `query_database` 中移除 `purpose=reconciliation|verification`。普通只读探索仍然允许，但只能形成 observed data 或 Physical Mapping/Cardinality Proposal，不能直接获得语义授权或发布权。

Answer Spec、证据校验、Query Digest、Probe、Candidate 失效和发布授权全部由可信 Runtime 管理。系统复杂度不能转嫁给 Agent。

## 5. Answer Spec 与证据资格

### 5.1 唯一 Evidence Authority

严格沿用 `CONTEXT.md`：

```text
用户澄清
> 已评审业务定义或语义模型
> 任务业务文档
> 请求原文
> Schema 正式约束
> 数据观察
> 模型推断
```

Gold 永远不是运行时证据。

### 5.2 Spec Authority

- Solver 只能提交引用可信证据的 Spec Change Proposal；
- Spec Authority 重新读取证据并自行确定 authority，忽略 Solver 自报级别；
- observed data 只能更新 Physical Mapping 或 Cardinality Evidence，不能创建业务 Hard Constraint；
- 用户澄清和已评审业务定义可以产生新 Hard Constraint 与新 Spec 版本；
- 需要语义解释的题目或文档内容先进入 Hypothesis 或 Ambiguity；
- 未校准的 LLM Spec 组件不得把自己的蕴含判断晋升为 Hard Constraint。

不新增 `supported/assumed/conflicted` 平行状态。权威要求、暂定解释、未决选择和来源冲突分别使用 Hard Constraint、Hypothesis、Ambiguity 和 Conflict Record。

引用存在性只证明 provenance，不自动证明引用必然蕴含某项业务决策。

## 6. Query Digest 与适用范围

不新增 `AST Digest`。权威产物统一称为 **Query Digest**；AST 是 QueryDigestCompiler 的实现来源。

权威 Query Digest 必须由固定版本的方言感知 parser 生成，并记录 SQL hash、dialect、parser、schema fingerprint、coverage、unsupported nodes 和 lineage completeness。Solver 自报摘要、回译或 tokenizer 降级结果不能伪装成完整 Digest。

每个门声明版本化 Gate Applicability Contract：

- 查询明确不属于该门支持类别：记录 `not_applicable`，不声称该 facet 已检查，继续其他门与 Delivery Policy；
- 查询属于支持类别，但必需 Digest、lineage 或 Probe 无法产生：记录 `unsupported/inconclusive`，形成 Review Unavailable；
- 只有必需 facet 为 `checked` 时才能支持硬门通过；
- 规则与方言分别校准和 Enforce。

这使复杂 SQL 仍可查询，同时避免把有限覆盖包装成通用保证。

## 7. G1–G4

### 7.1 G1：形状合同门

G1 使用 Answer Contract 与最终 Candidate 共同检查：

- scalar、Top-N、grouped、detail 的最终行粒度；
- 必需列、额外诊断列、输出角色和完整 lineage；
- 最终聚合是否完成；
- 排序、LIMIT 与 tie policy；
- 完整 Candidate 的准确行数、列、类型和顺序。

用户未明确的展示标签和列顺序不得被模型自动升级为 Hard Constraint。Top-N 边界存在未解决并列时进入 Needs Clarification 或 Abstained，不用静默 tie-breaker替代业务语义。

Candidate 列完整性与 G1 分开：前者只保证发布结果仍对应同一 Artifact，后者才检查 Answer Contract。空合同不能解释为 `expected []`。

### 7.2 G2：总体影响授权门

可信控制面将候选中的总体影响节点归为：

```text
authorized | structural | disputed | unresolved
```

- authorized：映射到 Hard Constraint，并有物理字段和值证据；
- structural：正式 Schema 或关系语义证明其不代表新增业务过滤；
- disputed：与 Hard Constraint 明确冲突，Rejected；
- unresolved：证据不足，Needs Clarification 或 Abstained，不能 Approved。

数据观察可以证明已授权概念的物理编码，但不能反向创造业务过滤。Solver 分类只是一项无权威 Proposal。

首版只给 Applicability Contract 明确支持、且 Runtime 能确定性归类的总体缩减阻断权；未覆盖的复杂 CASE、集合运算或嵌套语义不得声称已检查。

### 7.3 G3：粒度、基数与度量传播门

语义粒度与物理基数分开：

- Measure/Population Contract 说明应该统计什么；
- Cardinality Evidence 说明关系的唯一性、覆盖率和实际 fanout。

只有语义 Contract 为 Hard、Query Digest lineage 完整，并且正式或同快照证据证明候选传播方式破坏该 Contract 时，G3 才硬阻断。

首版优先覆盖 `COUNT/SUM/AVG` 跨 JOIN 的可证明 fanout。合法 1:N/N:M 不会因行数增加自动判错；数业务实体还是连接行必须来自语义证据。

### 7.4 G4：反证与实质修复门

阻断型 Probe 来自 Runtime 的版本化模板，Solver 不提供执行 SQL 或 blocking 标记。工具错误、超时、预算不足和空回执都只能是 inconclusive。

Probe Instance 在执行前绑定 claim、Spec、Candidate、Digest、快照和模板版本并冻结。失败后：

- 原 Candidate 在相同 Spec 和证据版本下永久不可发布；
- 新 Candidate 必须改变与失败 claim 相关的 Semantic Fingerprint，或绑定新的权威 Spec/证据版本；
- 换别名、改格式或重复同一逻辑不算修复；
- 阻断型数据 Probe 必须与 Candidate 共享事务快照或稳定 dataSnapshot。

## 8. 发布流程与政策

```text
1. Spec Authority 准备 Answer Spec
2. Agent 执行只读 SQL，获得 Validated Query Artifact
3. publish/export 接收精确 queryArtifactId，并在内部晋升 Candidate
4. Query Digest 与 Gate Applicability
5. G1–G4 和完整 Candidate 检查
6. Conversation-Blind Review
7. Delivery Policy
8. 原子发布同一 Candidate，生成 Publication Receipt
```

同一 Spec 版本最多一次 Automatic Semantic Repair。Candidate 被确定性门或语义审查拒绝会消耗额度；TTL 过期、事务回滚和明确基础设施失败不消耗额度。用户澄清或新权威证据产生新 Spec 后重置额度。

产品与 Spider2 的关键区别：

| 结果 | 产品 | Spider2 |
|---|---|---|
| 不可豁免门失败或必需 Digest/Probe unavailable | 不发布，不能授权绕过 | 不提交 |
| 已披露 Semantic Diff | 修复、澄清或授权精确 Candidate | 可提交但记录 disagreement |
| 确定性门通过，仅 LLM Reviewer unavailable | fail-closed | 可提交但不得记录 Approved |

用户澄清会修改 Spec；Publication Authorization 不修改 Spec，只授权一个精确 Candidate，并记录 `published_with_disagreement`。不使用 `pass/qualified` 平行状态。

## 9. 实施顺序

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| S0 | 分离 Candidate 完整性与 Answer Contract | `expected []` 路径消失，空合同/零行/列变化测试通过 |
| S1 | AST 驱动 Query Digest 与方言 coverage | unsupported 不伪装 checked |
| S2 | 证据引用、Spec Authority、Contract | Hard admission、Proposal、Conflict、版本测试通过 |
| S3 | G1 | 历史形状样本与正确反例 replay 通过 |
| S4 | 有界 G2 | 无授权过滤命中，结构谓词和未决语义不被误判 |
| S5 | G3/G4 与固定 Probe | fanout、重复候选、事后改判据测试通过 |
| S6 | 生命周期、持久化、Delivery Policy、审计 | 不可豁免失败无逃生门，Candidate 原子发布 |
| S7 | replay、Shadow、Enforce E2E | 达标后按规则和方言渐进 Enforce |

每阶段依次执行单元/变异测试、冻结候选 replay、Shadow E2E；达到预注册门槛后才能 Enforce。Conversation-Blind Reviewer 继续 Shadow，重新 Enforce 另立校准任务。

本变更采用 schema major 断代升级，不兼容旧裁决对象。旧 Token、Authorization 和未发布 Candidate 失效；已发布 Receipt 只作为历史审计保留。

## 10. 验证与报告

确定性门准入要求：

- 机械合同 fixture 的阻断与放行均为 100%；
- 已复核正确候选非阻断 specificity ≥ 99%，且单侧 95% 置信下界 ≥ 98%；
- hard-block diff precision ≥ 99%；
- 声称支持的历史机械模式召回率为 100%；
- 固定评测集净 E2E 不下降；
- non-delivery 与 timeout 增量分别不超过 1 个百分点。

报告依次给出：不可豁免门绕过与错误发布、官方 SQL/E2E、正确候选误阻断与 non-delivery、Review Outcome 分布、修复是否实质消解 claim，以及延迟/工具调用/扫描量/成本。

固定十题只是回归集。任何“可拦”“覆盖”表述在实现 replay 前都必须标记为设计预测。Gold 只用于离线评分，不能倒灌为运行时证据。

## 11. 预期边界

| 案例 | 首版可能检查的机械问题 | 不承诺解决的语义问题 |
|---|---|---|
| local003 | 候选反证是否真正改变 | Monetary 权威口径 |
| local010 | 标量形状、最终聚合 | 有向/无向与文档/Gold 冲突 |
| local025 | 漏最终 AVG、交付中间明细 | 567/568 总体选择 |
| local029 | 多余列、粒度与 Hard Contract 差异 | 订单还是支付连接行 |
| local032 | distinct 与计数实体差异显式化 | 反直觉连接行口径 |
| local034 | 可证明 fanout | — |
| local035 | 多余诊断列、形状 | 异常值是否纳入 |
| local037 | 可证明 fanout、多余列 | — |
| local050 | 假设与分歧显式化 | 隐藏总体或聚合顺序 |
| local061 | 无授权排除、工具错误不作证据 | — |

该表是待验证的规则—案例映射，不是正确率承诺。

## 12. 一句话结论

**Agent 只负责产生候选并最多修复一次；可信 Runtime 用 Evidence Authority、Answer Spec、Query Digest 和有界确定性门阻止可证明的机械错误。门外复杂语义不得伪装成已检查，也不被错误包装成通用 SQL 正确性保证。**
