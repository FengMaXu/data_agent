# KTX 数据库语义层 Ingest 差距审计 V2

> 历史审计冻结说明：本文第 1、4、5、6、8、9 节记录的是 2026-08-12 修复前的 structural-only 运行证据，不再代表当前 SemanticContextApplication 的生产路由。2026-08-13 已退休直接 `runLocalIngest(adapter=live-database)` 分支和 `runKtxIngest(adapter=live-database)` 入口；当前数据库入口固定为 Public Ingest enriched scan。原始 context-source `runKtxIngest` 分支按 V2 设计保留。

## 1. 审计结论

当前 Data Agent 并未完整复用原始 KTX 的数据库语义层生成流程。

已经完整接入的是声明式查询执行链：Project Loader、Semantic Compute、Dialect、QueryExecutor、native connector 和 MCP 查询接口。数据库 Ingest 则接错了入口：原始 KTX 把数据库连接路由到 enriched scan，当前 Semantic MCP 却直接把 `live-database` 当成 context-source adapter，进入逐表 WorkUnit bundle runner。

因此，2026-08-11 的 25 表运行证明了结构采集、逐表 YAML 写入和 `row_count` 查询可执行，但没有证明原始 KTX 的数据库关系发现、关系验证、manifest 建图和深度 enrichment 已完成。

## 2. 对比基线

- 原始 KTX 上游基线：`45aa95d2cc121267bbbc8c184402a19573956dd4`
- 当前 KTX 工作区：`D:\data_agent\ktx`
- 当前 Data Agent 语义项目：`D:\data_agent\.data_agent\semantic-context`
- 当前真实运行：`local-msosifm9`

上游基线已经包含公共数据库 Ingest 主链；`packages/cli/src/semantic-context/application.ts` 是 V2 新增宿主入口。问题不是上游缺少建图能力，而是新增入口没有调用已有数据库主链。

## 3. 原始 KTX 数据库语义层完整流程

```text
ktx ingest <database connection>
-> buildPublicIngestPlan: database-ingest
-> enrichment preflight
   - default LLM
   - scan.enrichment.mode = llm
   - scan embeddings
-> runKtxScan(mode=enriched, detectRelationships=true)
-> structural introspection
   - tables / columns / PK / declared FK
   - raw snapshot
-> initial _schema manifest
-> enrichment
   - table and column descriptions
   - embeddings
   - formal FK acceptance
   - deterministic relationship candidates
   - optional LLM relationship proposals
   - target uniqueness / source coverage / violation profiling
   - database-side relationship validation
   - graph resolution and composite-key relationship detection
-> enrichment artifacts
   - descriptions.json
   - embeddings.json
   - relationships.json
   - relationship-profile.json
   - relationship-diagnostics.json
-> rewrite semantic-layer/<connection>/_schema/*.yaml
   - table/column metadata
   - forward and reverse joins
-> compose optional top-level overlays
   - measures / segments / descriptions / manual joins
-> semantic validation and declarative query
```

关键实现证据：

- `public-ingest.ts` 将数据库连接分类为 `database-ingest`，并调用 `runKtxScan`，而不是 context-source `runKtxIngest`。
- `local-scan.ts` 先进行结构采集，再运行 enrichment 和 relationship discovery。
- `relationship-discovery.ts` 合并正式外键、确定性候选、LLM 候选、统计验证和复合关系。
- `local-enrichment-artifacts.ts` 将确认关系写入 `_schema` manifest。
- `local-sl.ts` 以 `_schema` manifest 为 base，再合成顶层 overlay。
- `setup-context.ts` 要求 descriptions、embeddings、relationships 阶段及 manifest shard 完成，才把数据库 context 判为 ready。

## 4. 当前 Data Agent 实际流程

```text
sl_ingest
-> SemanticContextApplication.runIngestJob
-> enumerate ingest.adapters
-> runLocalIngest(adapter=live-database)
-> fetch raw database snapshot
-> one isolated WorkUnit per table
-> WorkUnit LLM writes one standalone YAML per table
-> reconciliation checks patch overlap/conflict
-> ordinary semantic syntax/reference validation
-> inject row_count when measures is empty
-> catalogReady=true when at least one source exists and compute validation passes
```

该路径绕过了 `buildPublicIngestPlan -> runKtxScan(enriched)`，没有生成 `_schema` manifest，也没有运行原始 relationship discovery、profiling、database validation 或 enrichment readiness gate。

## 5. 当前真实产物证据

当前数据库和原始快照均包含两条正式外键：

1. `dim_company_monthly_snapshot.company_id -> dim_company.company_id`
2. `dim_company_monthly_snapshot.industry_code -> dim_industry.industry_code`

当前发布结果：

- 25 个 standalone source；
- 0 个带 join 的 source；
- join 总数为 0；
- 原始 ingest 提案的业务 measure 总数为 0；
- `row_count` 是 V2 后加的确定性 fallback；
- 目前仅 `mart_industry_sales_summary` 的 4 个业务 measure 是运行后人工补充，不是本次 ingest 自动生成；
- 没有 `semantic-layer/default-mysql/_schema/` manifest。

WorkUnit transcript 明确记录：快照 WorkUnit 读取并确认了两条外键，但因为目标 source 由 sibling WorkUnit 创建、当时不可见，主动写入 `joins: []`。Stage 4 reconciliation 随后没有执行跨 WorkUnit 关系回填。

## 6. 逐阶段差距矩阵

| 阶段 | 原始 KTX | 当前移植系统 | 判定 |
| --- | --- | --- | --- |
| 连接分类 | 数据库与 context source 分流 | 所有启用 adapter 统一进 bundle runner | 接错入口 |
| 结构采集 | 原生 scan/introspection | 已复用 introspection | 已有 |
| PK/grain | PK进入 manifest，grain由 base/overlay表达 | WorkUnit 基于 PK 写 grain | 部分已有 |
| 正式 FK | 确定性接受并生成双向 join | raw 中存在，但 WorkUnit 可选择不写 | 缺失 |
| 推断关系 | 名称/类型候选、LLM、统计验证 | 未运行 | 缺失 |
| 复合关系 | 专门候选和数据库验证 | 未运行 | 缺失 |
| 关系图解析 | 全库图级收敛 | 每表隔离，reconcile 只处理冲突 | 缺失 |
| 描述 enrichment | scan enrichment stage | WorkUnit 复制 DB comment/有限生成 | 非等价 |
| Embedding | enrichment 必需且有 readiness | 当前 `ktx.yaml` 未配置 | 缺失 |
| Base manifest | `_schema` shard | 25 个 standalone YAML | 产物模型错位 |
| 业务 measure | 来自声明源或 overlay，live scan 不盲猜 | 原始提案为空，后补 `row_count` | 仅 fallback |
| Validation | scan stage readiness + manifest + SL validation | source 存在且 compute valid | 门禁过弱 |
| LKG/ownership | scan 与 context ingest 各自生命周期 | bundle 侧局部接入 | 未闭环 |
| E2E | 应验证关系进入图并可跨源查询 | 只验证 `row_count + joins: []` | 覆盖错误 |
| UI ready | 深度数据库 context 完成 | `catalogReady` 即 ready | 状态失真 |

## 7. 为什么 PK 不会自动等于关系图

主键只证明一张表自身的唯一粒度。关系边至少还要确定来源列、目标列、方向和 cardinality。对于未声明外键的候选，还要验证目标唯一性、来源覆盖率、违规值和 fanout 风险；时间快照场景通常还需要复合键。

原始 KTX 正是通过 formal metadata、relationship profiling、database validation 和 composite relationship discovery 完成这些步骤。当前系统没有运行这些步骤，所以不能把“识别到 PK”解释成“已经建图”。

## 8. 测试覆盖为何没有发现

- Semantic MCP SQLite E2E 使用 fixture publisher，主动写入 `row_count` 和 `joins: []`。
- MySQL E2E 的确定性 Agent 同样主动写入 `row_count` 和 `joins: []`。
- Data Agent startup tests 直接 mock `catalogReady: true`。
- 现有验证只证明 Query Runtime、native connector、MCP 和宿主状态协调可运行，没有断言正式 FK 必须出现在最终 join graph。

## 9. 修复优先级

### P0：恢复正确入口

`SemanticContextApplication` 必须按 connection kind 分流：

- 数据库连接：复用原始 enriched scan 应用入口；
- dbt、MetricFlow、LookML、Looker、Metabase、historic SQL：复用 context-source bundle ingest；
- 两条分支仍由同一个 `sl_ingest` job 和 MCP 状态聚合。

不得在 Semantic MCP 内重新实现 relationship discovery。

### P0：恢复原始配置和 readiness

- 将宿主默认 LLM 投影到 scan enrichment；
- 增加统一 embedding 配置来源，或明确阻止 enriched scan，而不是静默降级；
- 数据库 ready 必须检查 scan report 的 descriptions、embeddings、relationships 和 manifest shards；
- `row_count` 只能表示 source 可执行，不能使结构型 catalog 自动成为 ready。

### P0：增加真实回归门禁

使用含正式 FK 和可验证复合候选的数据库 fixture，至少断言：

1. `_schema` manifest 已生成；
2. 两条正式 FK 形成正反向 join；
3. 关系统计/诊断产物存在；
4. 跨 source 声明式查询成功；
5. 删除一条 FK 后 diff 会更新关系图；
6. enrichment 或关系 validation 失败时不发布新 catalog；
7. 0-join 结构型结果不能被宿主标记为完整 ready。

### P1：业务指标来源

完成关系图后，再接入 dbt/MetricFlow/LookML、历史 SQL evidence 和人工 overlay 的指标治理。不得把所有数值列自动转为 measure，也不得把 `row_count` 当成业务语义完整性的替代品。

## 10. 修订后的验收定义

数据库 Ingest 只有同时满足以下条件才可声明完成：

1. 走原始 enriched scan 主链；
2. 正式 FK 和通过验证的推断关系已进入 `_schema` manifest；
3. scan enrichment 和 relationship stages 满足配置要求；
4. manifest + overlay 能通过 Semantic Compute validation；
5. 至少一个跨源查询 fixture 证明 join 可执行且无 fanout；
6. 业务问题所需 measure 有声明来源或受审 overlay；
7. 前端 ready 状态使用以上质量门禁，而不是仅检查 source 数量。

