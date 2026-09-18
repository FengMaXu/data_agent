# 有界查询门控实现差距审计

## 审计范围

只读检查了当前工作树中的：

- 父规格：`.artifacts/bounded-query-gates-spec.md`
- 票据映射：`.artifacts/bounded-query-gates-ticket-map.json`
- `packages/runtime/src`
- `packages/electron-host/src`
- `apps/server/src`
- `evaluations/spider2`

未修改文件，未执行破坏性 Git 操作；不把当前未提交改动归因于某个新票据。

## 按票号结论

| 票号 | 状态 | 已实现行为 | 主要缺口 | 最小落地点/测试 |
|---|---|---|---|---|
| #57 | 部分实现 | `ExportCandidateStore` 校验列名、批次列稳定性、行宽和候选私有化；`reviewForPublication` 区分 Candidate 绑定与 Answer Contract。见 `packages/runtime/src/export-candidate.ts:70-150`、`query-assurance.ts` 的 `contractDiff`。 | 空 `outputColumns: []` 仍可能被作为候选期望列传入：`agent-assembly.ts:1020` 使用 `taskSpec?.outputColumns ?? ...`，空数组不会触发 `??`，导致正常结果与 `expected []` 不匹配。 | 先修复 `agent-assembly.ts:1020` 的空合同语义，再补 `export-candidate.test.ts`、`query-assurance.test.ts` 的空合同、零行、额外列测试。 |
| #58 | 部分实现 | 标量结果已有双重行数检查：`query-assurance.ts` 的 `contractDiff`，以及 `export-candidate.ts` 的 `expectedRows === "scalar"`。已有 `query-assurance.test.ts` 标量拒绝测试。 | 尚无独立 SQLite G1 gate；目前只是通用 ResultMetadata/Contract 比较，未验证最终聚合、SQLite 方言适用性和公开 Query Assurance seam 的完整发布流程。 | 在 `query-assurance.ts` 建立 SQLite scalar G1 决策表；扩展 `query-assurance.test.ts` 和 `agent-assembly.test.ts`，覆盖 `COUNT`、多行、零行、内联/CSV。 |
| #59 | 部分实现 | `contractDiff` 已检查部分 projection、row count、scalar、grain、aggregate function、ranking partition。 | 未检查 Top-N 的 `n`、排序表达式和 tie policy；未可靠检查漏最终聚合、额外输出列、列角色、窗口/CTE 最终形状。`query-digest.ts` 的默认实现仍是 tokenizer 摘要，不能满足完整 AST 形状合同。 | 新增公开 G1 seam，建议仍放在 `query-assurance.ts`；fixture 放 `query-assurance.test.ts` 和 `query-digest.test.ts`，不绑定内部 AST。 |
| #60 | 未实现 | Digest 会记录 `filters`；Answer Spec 支持 Hard Constraint/Hypothesis。 | 没有授权总体节点，也没有 `authorized/structural/disputed/unresolved` 状态，更没有根据证据阻断无授权过滤、INNER JOIN 总体丢失等 G2 行为。 | 在 `query-assurance.ts` 增加 Runtime-owned G2 applicability/decision；使用 `query-assurance.test.ts` 决策表覆盖请求过滤、文档授权、Schema structural、observed data 和无授权过滤。 |
| #61 | 部分实现 | `InMemoryQueryAssurance.claimAutomaticRepair()` 对同一 `taskId:specVersion` 限制一次修复；`agent-assembly.ts:1046-1049、1148-1150` 会在 Enforce 拒绝时触发修复。 | 没有失败 Candidate 的永久失效记录，没有局部 Semantic Fingerprint，也没有验证修复确实针对失败 claim；修复额度仅存内存。 | 在 Candidate/Query Assurance 状态中增加 failed-candidate identity 与 claim fingerprint；补 `query-assurance.test.ts`、`publication.test.ts` 的别名、格式、无关 CTE、相关过滤/聚合修复测试。 |
| #62 | 未实现 | `DigestJoin` 记录 JOIN 类型、来源和条件；存在通用 `InvariantProbeRegistry`。 | 没有 G3 Measure/Population Contract、Cardinality Evidence 或 COUNT/SUM/AVG 跨 JOIN fanout 证明；没有合法 1:N 与错误 fanout 区分。`InvariantProbeRegistry` 不是 G3 实现。 | 新增 G3 核心逻辑至 `query-assurance.ts` 或独立内部模块；公开验证仍通过 `query-assurance.test.ts`，fixture 覆盖预聚合、COUNT DISTINCT、AVG 分子/分母守恒。 |
| #63 | 部分实现 | Digest 有 `coverage`、`unsupportedNodes`、`lineageCompleteness`；Reviewer 有 `deriveReviewCoverageRequirements` 和 `runtimeDigestEvidence`，见 `conversation-blind-reviewer.ts:159-187、220-375`。 | 没有版本化 Gate Applicability Contract，也没有确定性 gate 的 `checked/not_applicable/unavailable` 三态流程。严格 parser 失败时 `recordPreview` 只生成 unsupported fallback digest，`reviewForPublication` 没有统一把必需确定性覆盖转换成 Review Unavailable。 | 在 `query-assurance.ts` 增加 Runtime-owned applicability；补 `query-assurance.test.ts`、`conversation-blind-reviewer.test.ts` 的门内、门外、门内解析失败测试。 |
| #64 | 未实现 | Agent 已经使用 Artifact ID；工具描述声称验证工具无发布权。 | Solver-facing 工具仍暴露 `sql_validate`、`semantic_validate`；`QUERY_DATABASE_PARAMETERS` 仍接受 `purpose: "reconciliation" | "verification"`，见 `tools-catalog.ts:8-23`、`agent-assembly.ts:1245-1306`。现有测试还明确要求 reconciliation/verification：`agent-assembly.test.ts:666-720`。这直接违反“移除自助 verification/reconciliation”的断代要求。 | 从 Solver 工具 catalog 和执行路径删除这两个 purpose/工具，保留普通探索；同步修改 `tools-catalog.test.ts`、`agent-assembly.test.ts`。 |
| #65 | 部分实现 | Token、SQL hash、Spec version、Schema fingerprint、Reviewer/Policy 版本被部分写入 `publication.ts`、`query-assurance.ts` 和审计记录；缓存 identity 也包含多个版本字段。 | 核心实现为 `InMemoryQueryAssurance` 和 `InMemoryAssuranceAuditStore`：`query-assurance.ts`、`assurance-audit.ts:57-106`。重启会丢失 Spec、Candidate、修复额度、Token、Receipt 和审计链。Token 也未完整绑定 parser/digest、coverage、证据版本。 | 复用现有 SQLite metadata 层实现追加式 Task Store；增加持久化/重启/旧 Token 失效测试，位置建议 `query-assurance.test.ts`、`publication.test.ts`、`runtime.test.ts`。 |
| #66 | 部分实现 | `calibration.ts` 能计算 recall、specificity、precision、repeat agreement、延迟、成本和 non-delivery；Spider2 有 `calibrate` 命令，见 `evaluations/spider2/run.mjs:761-809`。 | 没有生成固定 G1-G4 replay、正确/错误成对变异、近邻反例或按 gate/dialect 的校准报告。现有校准依赖外部 labels，不能证明确定性门本身的召回和误阻断。 | 增加 replay/变异 fixture 与 gate-level report；测试放 `packages/runtime/src/calibration.test.ts`，评测测试放 `evaluations/spider2/lib.test.mjs`。 |
| #67 | 未实现 | SQLite 方言类型、SQLite EXPLAIN 分支和通用 Query Assurance seam 存在；`sql_validate` 使用 `EXPLAIN QUERY PLAN`，见 `agent-assembly.ts:1194-1221`。 | 没有 SQLite G1-G4 确定性 Enforce 闭环，也没有持久化状态、不可绕过门失败和已校准资格证明。`apps/server/src/reference-sqlite-mcp.ts:103-107` 仍直接暴露原始 `export_query(sql)`，绕过 Query Assurance。 | 先完成 #57-#66 的核心 gate/持久化/replay，再为 SQLite 注册确定性 policy；补 `reference-sqlite-mcp.test.ts` 和最高层 Query Assurance E2E。 |
| #68 | 未实现 | `SqlDialect` 包含 `"mysql"`；Digest 可接受 MySQL；`dialectHint()` 有 MySQL 提示。 | 没有 MySQL 独立 parser coverage、gate 校准或 Enforce policy。Electron 主路径还固定使用 `databaseDialect: "mysql"`，见 `packages/electron-host/src/main.ts` 的运行时装配，但这不是 MySQL 门控。 | 复用 SQLite gate 核心，新增 MySQL parser/coverage fixture、独立校准 identity 和 `query-assurance` E2E。 |
| #69 | 未实现 | `SqlDialect` 包含 `"bigquery"`；Spider2 README 支持通过 MCP 接入 BigQuery。 | `evaluations/spider2/run.mjs:476-505` 仅装配通用 assurance/reviewer；没有 BigQuery 专属确定性覆盖、Enforce 资格或 unavailable 策略。 | BigQuery MCP adapter 先输出稳定 Digest/metadata，再新增独立 dialect 校准和正式提交 gate；测试放 `evaluations/spider2`。 |
| #70 | 未实现 | `SqlDialect` 包含 `"snowflake"`；Digest 有 Snowflake 通用测试。 | 没有 Snowflake 专属 gate、parser coverage、校准或 Enforce policy；README 只规定 MCP 执行契约。 | 按 #69 相同路径实现 Snowflake adapter、coverage fixture、独立 calibration identity 和 E2E。 |

## 关键审计发现

### P1：Publication Authorization 可以绕过 Review Unavailable

`packages/runtime/src/review-policy.ts` 的 `DeliveryPolicy.decide()` 将：

```ts
const authorizationCanOverride =
  Boolean(authorization) &&
  (unavailable || rejected || abstained);
```

因此在 Enforce 模式下，用户 Authorization 可使 `ReviewOutcome.availability === "unavailable"` 的候选获得发布资格。父规格明确要求：必需确定性覆盖 unavailable、Review Unavailable 或机械门失败不能由用户授权绕过。最小修复是移除 `unavailable` 分支，仅允许授权处理明确披露的非机械 Semantic Diff。

应补 `packages/runtime/src/review-policy.test.ts`：Enforce + unavailable + authorization 必须拒绝。

### P1：所谓 sqlglot Digest 仍由 tokenizer 生成结构

`packages/runtime/src/query-digest.ts` 的 `createSqlglotQueryDigestCompiler()` 先调用 sqlglot 规范化 SQL，然后再次调用：

```ts
createQueryDigestCompiler().compile({ ...input, sql: payload.sql })
```

最终 `sources/joins/measures/groupBy/outputLineage` 仍来自 `createQueryDigestCompiler()` 的 tokenizer 解析，不是 AST 遍历。却把 `parserEngine` 标为 `"sqlglot"`。这会使 #59、#63 及后续方言 gate 误以为拥有 AST coverage。

最小修复是让 sqlglot adapter 输出固定结构化 AST facets，或在未能生成完整 AST facets 时明确标记对应 coverage 为 `unsupported`，不得标记 checked。

### P1：Solver 自助验证仍然可用并被测试鼓励

`tools-catalog.ts` 暴露：

- `sql_validate`
- `semantic_validate`
- `query_database.purpose = reconciliation`
- `query_database.purpose = verification`

`agent-assembly.test.ts:666-720` 还验证 JOIN reconciliation 和 verification 记录。这与 #64 及父规格“Agent 只查询、选择 Artifact、发布、最多一次修复”的流程冲突，且会继续制造候选自证循环。

### P1：Enforce 状态不是持久化状态

`InMemoryQueryAssurance` 的以下状态都只存在内存：

- `artifacts`
- `taskEvidence`
- `repairAttempts`
- `PublicationRegistry` 中的 tokens/receipts
- `InMemoryAssuranceAuditStore.records`

进程重启后，旧 Token、修复次数和发布幂等信息全部丢失；这直接阻塞 #65 和 #67。

### P1：当前没有 G2/G3/G4 确定性实现

当前 `reviewForPublication()` 只实际做了：

1. Candidate 与 Artifact 绑定；
2. `contractDiff()` 的有限 G1-like 检查；
3. 可选通用 invariant probe；
4. LLM Reviewer 调用；
5. Publication Token/Policy。

没有总体缩减、JOIN fanout、失败 Candidate 永久失效或 Semantic Fingerprint gate。因此不能把当前 `shadow/enforce` 配置称为 G1-G4 Enforce。

## 最小可落地顺序

建议按以下顺序落地，避免先扩展方言再重复返工：

1. **#57：S0 Candidate 完整性**
   - 修复空合同/空列语义。
   - 明确 Candidate identity 与 Answer Contract 分离。
2. **#58：SQLite scalar G1**
   - 先形成一个最高层 Query Assurance 发布测试。
3. **#59：完整 G1**
   - 扩展最终形状、Top-N、排序、tie、聚合和额外列。
4. **#63：Applicability/unavailable**
   - 在所有 gate 前建立 Runtime-owned applicability contract。
5. **#60：G2**
   - 建立授权总体节点和证据状态。
6. **#62：G3**
   - 只实现首版可证明的 COUNT/SUM/AVG 跨 JOIN fanout。
7. **#61：G4 与一次修复**
   - 失败 Candidate、claim fingerprint、实质变化和修复预算。
8. **#64：移除旧 Solver 验证面**
   - 删除 verification/reconciliation 目的和自助验证工具，防止新 gate 被旧流程绕过。
9. **#65：持久化与完整版本身份**
   - SQLite Task Store、追加审计、重启恢复、断代失效。
10. **#66：Replay/校准**
    - 正例、邻近反例、等价改写、G1-G4 分项报告。
11. **#67：SQLite Enforce 资格闭环**
    - 确定性门、不可绕过 Publication Policy、SQLite 独立校准。
12. **#68-#70：按方言逐一扩展**
    - MySQL、BigQuery、Snowflake 各自 parser coverage、校准 identity、回滚和 Enforce 资格。

## 残余风险

- 当前 `apps/server/src/reference-sqlite-mcp.ts` 的原始 `export_query(sql)` 仍可能被独立 MCP 客户端直接调用，不能视为已受 Query Assurance 保护。
- 当前 Electron 装配虽创建 Query Assurance，但使用内存实现，重启一致性尚未满足。
- Digest tokenizer 对 CTE、子查询、集合运算、窗口、QUALIFY 和输出 lineage 的覆盖不足；不应将其结果作为确定性 gate 的 checked 证据。
- Spider2 当前配置默认 `shadow`，且 `run.mjs` 主要记录 Reviewer/Calibration 信息，不能证明 deterministic gate 已取得 Enforce 资格。
- 只读审计未运行测试命令；建议父会话在修复后执行 runtime、Electron、server 和 Spider2 的完整测试矩阵。