# Spider2 第 11 轮阶段 3 报告

> 状态：运行验收完成（历史 Gold SQL 资源覆盖存在限制）
> 运行 Run ID：`round11-p3-deepseek-003`
> 模型：默认 `deepseek-chat`（DeepSeek OpenAI-compatible API）

## 已完成

- 新增 `AnomalyRegistry`，按任务和观测去重，绑定 Answer Spec 槽位、Query Artifact、候选指纹与 D11 未变化异常。
- 新增确定性 `detectAnomalies` 适配，覆盖 G1/G2 形状与过滤观测、JOIN fanout、COUNT 与 DISTINCT 实值差异（仅在 Runtime 探针提供两者时触发）、实体总体、空结果过滤、空值样成员、物理边界、跨期集合、中间候选和指纹未变化。
- `afterToolCall(query_database)` 通过内部观测载荷运行检测器，结果补丁在返回 content 末尾附加异常事实、槽位、状态和说明；异常同时写入评测 `result.json`/`trace.json`。
- 查询探针预算按任务限制为最多 5 次；服务端与 Electron MCP 适配增加有界 JOIN 基数探针，使用最多 2,000,001 行的 bounded count，超限时不作结论。
- JOIN 探针只对 Schema 中确认的物理表运行，并串行执行；聚合查询按聚合前 JOIN 人口计数，避免 CTE 别名和聚合结果行数误判。
- 派生的有符号 `change/delta/diff/variance` 数值不被误报为负金额/数量。
- 运行器增加异常数量、检测器分布、槽位指纹多样性和解释 Hook 注入统计。

## 验证证据

- `npm run build:runtime`、`npm run build:server`、`npm run build:electron-host`：通过。
- `npm test --workspace=@data-agent/runtime -- src/detectors.test.ts`：4/4 通过。
- `npm run test:eval:spider2`：17/17 通过。
- 独立探针烟测：Brazilian E-Commerce 聚合 JOIN 观测到 `103886` 与 `112650` 侧表、聚合前连接行 `117601`，产生 fanout 证据。
- 历史 replay：round9/round10 固定十题、每题最多 5 个非探索候选，共 100 个候选；当前检测器登记 3 个 `join_fanout` 观测。
- Gold SQL 资源实际提供 24 个 local SQL 文件，其中 23 个可在当前 SQLite 运行；23 个均无异常，误报率 `0/23 = 0%`。其余 112 个 local 题只有 Gold CSV，没有对应 Gold SQL，不能伪称为 135 条 Gold SQL。

## 固定十题运行结果

`round11-p3-deepseek-003` 使用默认 DeepSeek 完整跑完固定十题：

| 指标 | 结果 | P3 门槛/对照 |
|---|---:|---:|
| SQL 覆盖 | 10/10 | 不低于 P2 的 10/10 |
| CSV 覆盖 | 10/10 | 不低于 P2 的 10/10 |
| `not_published_review_unavailable` | 0 | 0 |
| 平均工具调用 | 23.8 | P2 为 21.9，增量 +1.9 ≤ 5 |
| 注册异常 | 2 | 运行时实际触发 |
| 解释 Hook 注入 | 2 | 两次异常均触发 |
| 异常后首个绑定候选指纹变化 | 2/2 = 100% | ≥ 50% |
| 完成/超时 | 10/10 | 无新增超时 |

官方 SQL/E2E 评分为 `1/10`；准确率不是 P3 的通过门槛，但作为观察记录保留。P3 的 replay 与运行时门槛已满足；Gold 误报证据按实际可用的 24 个 Gold SQL 资源报告，资源覆盖不足本身列为限制，不扩大分母。
