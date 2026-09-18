# Spider2 语义错误架构级解法审阅意见

> **状态**：审阅意见已完成决策访谈；确认后的规范设计见 `docs/Query Assurance架构设计V2.md`，架构决策见 `docs/adr/0001-query-assurance-responsibility-separation.md`。

## 1. 审阅范围

本次审阅基于以下文档及当前运行时代码：

- `docs/Spider2第5轮63题数据与形式均错误根因分析与改进建议.md`
- `docs/Spider2第7轮47题成功导出语义错误逐题分析报告.md`
- `docs/Spider2语义错误架构级解法-从自我验证到职责分离.md`
- `packages/runtime/src/agent-assembly.ts`
- `packages/runtime/src/tools-catalog.ts`
- `evaluations/spider2/run.mjs`
- `evaluations/spider2/lib.mjs`

## 2. 总体结论

**方向正确，但当前方案需要重大修改后才能进入实现。**

从“同一求解者自检”转向“职责分离、独立证据和确定性编排”是正确方向。第 7 轮已经证明，现有门禁只检查是否执行过 reconciliation，而不检查 reconciliation 的结论：运行时只是记录 SQL，导出时检查记录是否存在，并没有验证对账值是否成立（`agent-assembly.ts:472-474, 518-520`）。

但方案按文档原样实施，会出现四个严重问题：

1. 语义门禁最终 fail-open，实际上不再是门禁；
2. “盲回译”信息流存在内在矛盾；
3. Spec 把不确定推断冻结成了错误的强约束；
4. 尚未通过离线回放证明审查器具有可接受的准确率。

因此建议：

> **接受架构方向，拒绝当前 P0 实施顺序和接口设计。应先做 shadow review 与校准，再决定哪些检查有资格阻断导出。**

## 3. 值得保留的设计

### 3.1 当前验证验证的是流程，不是语义

现有 `JOIN_RECONCILIATION_REQUIRED` 只要求模型运行另一条查询，没有接收：

- 对账指标；
- 预期关系；
- 实际差值；
- 是否通过；
- 为什么通过。

因此第 7 轮 27 次 JOIN 门禁全部被“补一次动作”绕过，是现有实现的必然结果。

### 3.2 语义裁决不应作为求解者可自由调用的自助工具

文档区分：

- `sql_validate`：机器检查，可暴露给求解者；
- `semantic_validate`：独立审查，不暴露给求解者。

这个划分合理。关键不是“有没有工具”，而是工具是否具有独立证据和真正的否决权。

### 3.3 AST 比 EXPLAIN 更适合结构语义检查

文档对 EXPLAIN 的定位正确：它主要验证可执行性和执行计划，不能证明指标、粒度和总体正确。SQL AST/Digest 更适合抽取：

- 聚合表达式；
- GROUP BY；
- 窗口分区；
- 过滤条件；
- 输出血缘；
- LIMIT；
- 表和 JOIN。

### 3.4 编排者应为确定性代码

不引入 AutoGen、LangGraph 等框架是合理的。当前问题需要的是少量清晰的 seam，而不是更复杂的多智能体控制框架。

## 4. 阻断级问题

### P0-1：“两次拒绝后放行”使门禁失去语义

方案规定语义拒绝最多两次，仍分歧则放行导出（`Spider2语义错误架构级解法-从自我验证到职责分离.md:91-93, 175-177`）。

这会导致系统出现矛盾状态：

```text
审查结果：已知题目和 SQL 不一致
系统动作：仍然成功导出，并宣称任务完成
```

这不是防止重试螺旋，而是把“停止重试”和“批准导出”混成一件事。

建议改成四态决策：

```ts
type ReviewDecision =
  | { status: "approved"; warnings: ReviewWarning[] }
  | { status: "rejected"; diffs: SemanticDiff[]; retryable: boolean }
  | { status: "needs_clarification"; ambiguities: Ambiguity[] }
  | { status: "abstained"; reason: string };
```

达到重试上限后：

- **产品环境**：停止自动重试，要求用户确认或返回“无法可靠完成”，不能自动批准；
- **评测环境**：可提交最佳候选以避免零提交，但必须标记为 `submitted_with_known_mismatch`，不能记录为审查通过。

产品政策和评测政策必须分开。

### P0-2：“盲回译”信息流存在矛盾

文档提出：

1. 回译者只看 SQL、schema 和结果；
2. 裁决者看题目和回译；
3. 第二步可以是“同一调用的第二段”。

见架构方案 `:45-61`。

#### 问题 A：同一调用第二段不再盲

如果题目在第二段进入同一 messages 上下文，模型仍然保留第一段 SQL 内容。此时已经不是信息隔离。

因此必须是两个独立调用，不能允许“同一调用第二段”。

#### 问题 B：独立调用又产生有损转译

如果裁决者只看回译文本、不看 SQL，那么所有被回译者遗漏的内容都会永久丢失，例如：

- `DISTINCT`；
- NULL 处理；
- `<` 与 `<=`；
- 窗口 frame；
- 隐藏过滤条件；
- JOIN 方向；
- 中间层去重。

因此“LLM 回译”不能称为 SQL 语义的 ground truth。架构方案 `:75` 的表述过强。

更好的信息流是：

```text
SQL
 ├─ 确定性 AST 编译器 → QueryDigest
 └─ 原始规范化 SQL

语义审查者输入：
题目 + Hard Spec + QueryDigest + 必要 SQL 片段 + schema slice

不输入：
Solver 对话、Solver 自述、Solver 验证结论
```

真正需要隔离的是求解者的解释和辩护，不是题目本身。语义审查者必须看到题目，否则无法审查。

LLM 回译可作为辅助证据，但不应成为唯一中间表示。

### P0-3：Spec 冻结了无法从题面确定的内容

文档中的 Spec 示例包含：

```json
{
  "authoritative_table": "match",
  "denominator": "全部客户，含当月无交易者"
}
```

见架构方案 `:105-123`。

这些内容通常不能仅从“题目 + DDL”可靠确定。它们可能依赖：

- 外部业务文档；
- 表数据分布；
- 主外键实际质量；
- 孤儿键情况；
- 业务事实表定义；
- 用户进一步澄清。

例如第 7 轮 `local003` 的 RFM 定义依赖外部文档；只给 planner `db_schema.md` 并不能解决业务口径缺失。

因此 Spec 必须区分三类字段：

```json
{
  "hard_constraints": {
    "explicit_projection": ["product_name"],
    "explicit_top_n": 3,
    "explicit_time_window": "2020"
  },
  "hypotheses": [
    {
      "claim": "match 是权威实体表",
      "confidence": 0.61,
      "evidence": "DDL primary key",
      "requires_validation": true
    }
  ],
  "ambiguities": [
    {
      "issue": "是否包含事实表孤儿 match_id",
      "resolution": null
    }
  ]
}
```

只有题面明确给出的约束可以被冻结并用于硬阻断。推断项不能成为不可修改的硬规范。

还需要一个受控修订协议：

- Solver 不能直接修改 Spec；
- Solver 可以提交结构化新证据；
- 独立 Spec adjudicator 决定修订、保留或转为歧义；
- 每次修订生成新 `specVersion` 并记录原因。

否则一个错误 Spec 会系统性阻断正确答案。

### P0-4：缺少 reviewer 自身的离线准确率验证

当前预期“可救 18–26 题”来自对 47 个错误案例的人工映射（架构方案 `:163-173`）。但第 7 轮报告的范围仅是“86 题中成功导出但错误的 47 题”，没有正确导出案例作为负样本（`Spider2第7轮47题成功导出语义错误逐题分析报告.md:8-10`）。

这无法估计：

- 正确查询被错误拒绝的比例；
- reviewer 是否只是倾向于输出 mismatch；
- 同一输入重复判断的稳定性；
- 发现错误后 Solver 是否真的能修正；
- 净 E2E 得分是否提高。

不能直接从文档分析进入硬门禁。正确顺序应是：

#### 阶段 1：历史回放，纯 shadow

输入：

- 47 个已知错误导出；
- 同轮所有已知正确导出；
- 固定 reviewer prompt；
- 不向 reviewer 提供 Gold。

统计：

| 指标 | 含义 |
|---|---|
| semantic error recall | 错误 SQL 被发现比例 |
| correct-query specificity | 正确 SQL 被放行比例 |
| mismatch precision | 被拒绝的 SQL 中真正错误比例 |
| abstain rate | 无法可靠判断比例 |
| repeat agreement | 同一案例重复判断一致率 |
| latency/token/cost | 实际开销 |

#### 阶段 2：在线 shadow

Reviewer 运行但不拦截，验证分布是否与历史回放一致。

#### 阶段 3：只硬化高精度规则

例如经过验证后：

- 明确要求名称但输出内部 ID；
- 明确要求单值但输出多行；
- 明确要求全局 Top-3，但 AST 中出现 `PARTITION BY actor`。

#### 阶段 4：才启用 LLM 语义阻断

必须设置最低 precision/specificity 门槛。

## 5. 重要设计问题

### P1-1：性质探针并不“独立于解读”

文档列出的探针（架构方案 `:145-153`）都有隐含前提。

| 探针 | 可能错误的原因 |
|---|---|
| 百分比求和约等于 100 | 分组可能不互斥、不完备，或每行分母不同 |
| 分组总和等于全表总和 | 题目可能明确过滤、去重或只计算子集 |
| Top-N 行数=N×分区数 | ties、分区不足 N 行、过滤后空分区都会破坏公式 |
| 锚点度必须大于 0 | 零边可能正是正确结果 |
| 结果在底层 min/max 内 | SUM 天然可能大于底层最大值 |

因此每个探针都需要：

```ts
interface InvariantProbe {
  preconditions: Predicate[];
  execute(...): ProbeResult;
}
```

只有前提被确定性证明后才能执行；否则返回 `not_applicable`，而不是 pass/fail。

### P1-2：AST 无法单独判断 1:N 关系和自动构造守恒查询

文档提出从 AST 自动识别度量列并生成 JOIN 前后 SUM 对账（架构方案 `:224-235`）。

AST 可以识别 SQL 结构，但无法单独知道：

- 哪张表是什么业务粒度；
- 哪个键真正唯一；
- 关系是 1:1、1:N 还是 N:M；
- fan-out 是否是题目要求的；
- SUM 是否应守恒；
- 外连接丢行是否符合业务语义。

这需要额外的关系证据：

```text
DDL PK/FK
+ 唯一约束
+ 实际 cardinality profile
+ 已验证业务关系
+ QueryDigest
```

自动对账只能支持受限模式，例如：

```text
单事实表
+ 一个维表
+ 明确 FK→唯一键
+ 度量列完全来自事实表
+ 无 DISTINCT/窗口/递归/多层聚合
```

不满足时应返回 `unsupported/abstain`，不能回退到当前已经证明无效的“让模型跑一次 reconciliation”。

### P1-3：不要降级 `EXPORT_SQL_NOT_VALIDATED`

文档建议将它降级为警告以节省 turn（架构方案 `:157-161`）。

但当前检查仍有重要价值：保证导出的 SQL 与最后成功预览的 SQL 完全一致（`agent-assembly.ts:503-510`）。

这不是语义校验，而是执行完整性/TOCTOU 防护。应该消除的是“模型必须重复查询”的仪式，不是完整性保证。

建议改为：

```text
query_database
  → 返回 queryId / SQL fingerprint / preview metadata

export_query
  → 接受 queryId
  → 验证 SQL hash 未变
  → 不要求模型重新运行同一 SQL
```

这样既保留保护，又不消耗额外 turn。

### P1-4：当前拟议 seam 无法取得所需输入

文档建议直接给 `AgentAssemblyDeps` 增加：

```ts
semanticReviewer({ sql, schemaSummary, resultPreview, question })
```

但当前：

- `AgentAssemblyToolContext` 只有 `sessionId`，见 `agent-assembly.ts:184-189`；
- `QueryTaskState` 只保存 SQL 字符串，没有 question、spec、schema version、结果预览，见 `agent-assembly.ts:252-259`；
- `export_query` 当前负责流式写文件，语义审查直接塞进去会进一步扩大其职责。

这是一个浅 interface，会让：

- 任务上下文管理；
- LLM 调用；
- SQL 解析；
- 审查缓存；
- 重试政策；
- CSV 发布

全部集中到 `agent-assembly.ts`。

建议建立独立的深 module：

```ts
interface QueryReviewEngine {
  review(
    submission: QuerySubmission,
    signal: AbortSignal
  ): Promise<ReviewDecision>;
}
```

```ts
interface QuerySubmission {
  taskId: string;
  question: string;
  answerSpec: AnswerSpec;
  specVersion: string;
  schemaVersion: string;

  dialect: DatabaseDialect;
  normalizedSql: string;
  sqlHash: string;
  digest: QueryDigest;

  resultMetadata: {
    columns: string[];
    rowCount?: number;
    truncated: boolean;
    summaries?: ColumnSummary[];
  };

  attempt: number;
}
```

`export_query` 只负责：

1. 验证已批准的 review token 与 SQL hash 一致；
2. 流式执行；
3. 原子发布 CSV。

### P1-5：N-version 的“一致即高置信”不成立

文档写道“两个求解者结果一致 → 直接导出”（架构方案 `:133-141`）。

两个同模型实例共享：

- 相同训练偏差；
- 相同 schema；
- 相同系统提示；
- 相同缺失业务知识。

它们很可能独立地产生相同错误。结果一致只能作为一条支持证据，不能直接等同于高置信。

应比较的不只是最终值，还包括：

- 两份 Answer Spec；
- 权威实体总体；
- 分子/分母；
- JOIN grain；
- QueryDigest；
- 性质探针结果。

若两者结果相同但语义计划不同，也应进入仲裁。

### P1-6：成本估算方式不成立

“2 次 LLM 调用相对于 21.17 次工具调用约 +10%”不能成立（架构方案 `:95-97`）。

数据库工具调用与 LLM 调用的成本、延迟不是同一量纲。还没有计算：

- schema 输入 token；
- SQL 和结果输入 token；
- reviewer 输出；
- 失败重试；
- 并发时 rate limit；
- provider timeout；
- Spec 生成调用；
- N-version 额外完整求解成本。

应该用实际指标：

```text
总输入 token / 题
总输出 token / 题
LLM 调用数 / 题
P50/P95 延迟
provider error rate
美元成本 / 正确题提升
```

### P1-7：缺少数据泄露和 prompt injection 设计

方案把 schema、SQL 和结果前五行发送给外部模型，但没有定义：

- PII/敏感字段脱敏；
- 是否允许跨境发送数据；
- 行值是否真的有必要；
- 数据内容中的 prompt injection；
- SQL 注释中的提示注入；
- 审查日志保留策略。

默认应只发送：

- schema slice；
- AST digest；
- 输出列；
- 行数；
- 类型和统计摘要。

原始数据行应是策略控制的可选输入。SQL 注释应先移除，所有数据库内容必须作为不可信数据封装。

## 6. 建议的修订架构

```text
Question + DDL + task business docs
             │
             ▼
      AnswerSpecGenerator
  hard constraints / hypotheses /
      ambiguities / confidence
             │
             ▼
Solver ── query_database ──► ValidatedQueryArtifact
             │                SQL hash + preview metadata
             │
             ▼
      QueryDigestCompiler
   AST + schema/relationship evidence
             │
             ▼
       QueryReviewEngine
  ┌──────────────┬─────────────────┐
  │ deterministic│ semantic reviewer│
  │ validators   │ conversation-blind
  └──────────────┴─────────────────┘
             │
  approved / rejected /
  clarification / abstained
             │
             ▼
       ExportPublication
    hash/token check → CSV
```

核心变化：

1. 不再用 LLM 回译作为唯一 SQL ground truth；
2. Spec 只冻结明确约束，推断项保留置信度；
3. Reviewer 对 Solver 对话盲，但可以直接看题目；
4. Reviewer 失败和 reviewer 判定失败必须分开；
5. 停止重试不等于批准导出；
6. SQL hash/token 保证审查、预览和导出是同一条 SQL；
7. 产品与评测使用相同 review module，只使用不同的最终决策政策。

## 7. 推荐的新实施顺序

### P0-0：修 evaluator 编码问题

保持原计划。

### P0-1：建立离线 review replay harness

先回放：

- 47 个已知错误案例；
- 同轮全部正确案例；
- 不改变 Solver；
- 不阻断导出。

这是当前最缺的一步。

### P0-2：实现 TaskContext + QueryDigestCompiler

先解决 question、spec、schema、result evidence 如何可靠流入审查 module。

### P0-3：shadow semantic review

记录：

- verdict；
- diffs；
- confidence；
- abstain；
- token/耗时；
- 与实际正确性标签的混淆矩阵。

### P0-4：硬化高精度确定性规则

只启用已证明低假阳性的规则。

### P1：引入 Hard/Soft Answer Spec

不要直接实现“全部字段不可变”的 Spec。

### P1：语义 reviewer 转 enforce

达到预设 precision/specificity 门槛后再启用。

### P2：高风险 N-version

最后实施，并把“一致”作为证据而不是直接批准条件。

## 8. 最终评价

这份方案最有价值的部分，是把问题从“模型不够仔细”提升到了“验证证据和裁决权不独立”。这是正确的架构转向。

但当前版本仍把三个未经证明的东西当成了权威：

- LLM 回译被当成 SQL ground truth；
- planner 推断被当成不可变 Spec；
- 双模型一致被当成正确性。

建议把架构中心从“多上下文”进一步收敛为：

> **独立证据来源 + 明确置信度 + 可弃权裁决 + SQL 指纹绑定 + 分环境失败政策。**

在完成上述修改之前，不建议按原文档的 P0-1 直接上线硬语义门禁。
