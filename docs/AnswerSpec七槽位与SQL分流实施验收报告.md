# Answer Spec 七槽位与 SQL 分流实施验收报告

> 对应方案：`docs/AnswerSpec七槽位与探索-结果SQL分流改动方案.md`
> 范围：Phase 0–5

## 结论

- Phase 0–4 的工程实现和自动化验收均通过；Phase 4 已补齐主 Agent 的 `update_answer_spec` 可执行写入链路，并移除产品/评测中的独立 Answer Spec Planner wiring。
- Phase 5 的 135 题离线七槽位评估已完成。
- Phase 5 的历史 40 题同配置 A/B 已完成复核，但不能作为当前 HEAD 的最终效果验收：旧 Trace 未记录显式 SQL mode，且 treatment 固定分母准确率 27.50% 低于 control 30.00%。
- 因此代码实现可以进入评审，但方案不应默认推广；当前 HEAD 的端到端效果验收仍需模型凭据后重新运行 control/treatment。

## Phase 0：七槽位 Spec、假设与版本

状态：通过。

已实现：

- `SevenFacetSpec`：`entity`、`metric`、`filters`、`groupBy`、`time`、`ranking`、`output`；
- `facetStatus`；
- 显式假设结构：`id/statement/basis/impact/scope/confidence/status`；
- `hypothesisBindings`，并强制假设 ID、JSON Pointer 路径和非空假设槽位的引用完整性；
- 稳定 `specHash`；
- Spec 版本变化后重新计算 hash；
- 生成槽位只填补确定性请求槽位中的空值，不覆盖已有非空可信值；
- Planner/模型输出不能把自身槽位状态提升为 `explicit/evidence_supported`。

证据：

- `packages/runtime/src/answer-spec.ts`
- `packages/runtime/src/answer-spec.test.ts`
- `packages/runtime/src/query-assurance.test.ts`

## Phase 1：探索/结果 SQL 显式分流

状态：通过。

已实现：

- `query_database.mode = exploration | result`；
- 缺省 mode 按 `exploration`；
- exploration 禁止携带 SpecRef/HypothesisRef；
- result 必须携带有效 `specVersion + specHash`；
- 旧 SQL 文本形状推断不再决定 Artifact 权限。

证据：

- `packages/runtime/src/tools-catalog.ts`
- `packages/runtime/src/agent-assembly.ts`
- `packages/runtime/src/query-assurance.ts`
- `packages/runtime/src/agent-assembly.test.ts`
- `packages/runtime/src/query-assurance.test.ts`

## Phase 2：Artifact 与发布绑定

状态：通过。

已实现：

- Artifact `kind = exploration | result_candidate`；
- exploration Artifact 为 `publishable=false`，且不绑定 Spec；
- result Artifact 绑定 Spec version/hash、SQL hash 和假设引用；
- CSV 与内联发布路径均拒绝 exploration Artifact；
- Spec 更新后旧 result Artifact 不可发布；
- Publication Registry 对缺失或失效 Spec hash 采用 fail-safe；
- 最终 SQL 选择必须有匹配 `Publication Receipt`，不再回退未发布预览；
- 同一 SQL 从 exploration 转 result 必须重新预览并生成新 Artifact。

证据：

- `packages/runtime/src/publication.ts`
- `packages/runtime/src/export-candidate.ts`
- `evaluations/spider2/lib.mjs`
- `packages/runtime/src/publication.test.ts`
- `evaluations/spider2/lib.test.mjs`

## Phase 3：Hook 路由适配

状态：通过。

已实现：

- exploration Artifact 不产生 Spec semantic observation；
- result candidate 继续进入现有检测/告知流程；
- D1/D2 已补齐 CTE 内显式非 DISTINCT `COUNT(relation.key)`：按查询块保留 JOIN/过滤，执行有界 `COUNT` vs `COUNT(DISTINCT)` 探针，并先验证 key 在源关系唯一；即使最外层 Digest 对 CTE 为 unsupported，也能登记 `join_fanout` 与 `count_distinct_divergence`；
- 不再仅依赖 `joinedRows > max(sideRows)` 判断父侧度量膨胀；候选已使用 `COUNT(DISTINCT)` 或源 key 本身非唯一时不误报；
- 发布前 Hook 对 exploration Artifact 做防御性拒绝；
- anomaly 注册、绑定、去重、候选指纹和解释注入均按 `specVersion` 隔离，旧 Spec 异常不污染新版本。

证据：

- `packages/runtime/src/hooks/assurance-hooks.ts`
- `packages/runtime/src/anomaly-registry.ts`
- `packages/runtime/src/fanout-probe.ts`
- `apps/server/src/mcp-query-executor.ts`
- `packages/runtime/src/hooks/assurance-hooks.test.ts`
- `packages/runtime/src/detectors.test.ts`
- `packages/runtime/src/fanout-probe.test.ts`
- `apps/server/src/mcp-query-executor.test.ts`

## Phase 4：单 Agent 提示词

状态：通过。

已实现：

- 主 Agent 使用七槽位 Spec；
- 新增模型可见的 `update_answer_spec`，由同一主 Agent 提交完整 `spec/facetStatus/hypotheses/hypothesisBindings`；
- 首次提交前禁止调用数据库；探索证据改变 Spec 后可再次提交并获得新版本/hash；
- 初始只读 Spec 为全 unresolved bootstrap，不再由请求正则抢先生成业务语义；
- 产品 Host 与 Spider2 Runner 不再 wiring 独立 Answer Spec Planner；
- 假设数量允许为 0；
- 删除“至少三个假设”和不可执行的跨角色命令；
- exploration 强制完全省略 SpecRef/HypothesisRef；result 强制绑定最新 Spec，并显式引用采用的候选假设。

证据：

- `.pi/SYSTEM.md`
- `packages/runtime/src/agent-assembly.test.ts`

## Phase 5：离线指标与 A/B

### 135 题七槽位离线评估

状态：完成。

| 槽位 | Coverage | Precision | Recall |
|---|---:|---:|---:|
| entity | 0.00% | — | 0.00% |
| metric | 79.26% | 59.81% | 47.41% |
| filters | 8.89% | 50.00% | 6.52% |
| groupBy | 2.22% | 0.00% | 0.00% |
| time | 10.34% | 0.00% | 0.00% |
| ranking | 10.00% | 100.00% | 10.00% |
| output | 22.22% | 60.00% | 13.33% |

报告：

- `docs/Spider2题面Spec提取质量-135题-槽位基线.md`
- `docs/Spider2题面Spec提取质量-135题-槽位基线.json`

结论：七槽位已经可测量，但确定性 request extractor 仍不足以提供高质量完整 Spec；主要运行时价值应来自主 Agent 的 Spec 生成和显式绑定，而不是继续增加正则。

### 同配置 A/B 复核

状态：已复核，当前 HEAD 最终效果验收未完成。

| 指标 | control | treatment |
|---|---:|---:|
| 固定分母官方 EX | 30.00% | 27.50% |
| CSV 覆盖 | 82.50% | 100.00% |
| 平均工具调用 | 21.375 | 22.65 |
| 用途未标注查询 | 431 | 469 |

报告：

- `docs/Spider2七槽位Phase5同配置AB评估.md`
- `docs/Spider2七槽位Phase5同配置AB评估.json`

限制：该 A/B 来自改动前的历史 40 题同配置运行，能够复核 Hook 的历史效果，但不能验证当前 HEAD 的显式 SQL mode 路由。当前环境没有可用模型凭据，无法诚实生成新的端到端运行。

## 验证命令

已通过：

```bash
npm test
npm run typecheck
npm run test:eval:spider2
npm run validate:spec-labels -- --validate-labels evaluations/spider2/spec-quality-labels.jsonl
npm run measure:spec -- --lite-root C:/data-agent-eval/Spider2/spider2-lite \
  --labels evaluations/spider2/spec-quality-labels.jsonl \
  --output docs/Spider2题面Spec提取质量-135题-槽位基线.json \
  --markdown docs/Spider2题面Spec提取质量-135题-槽位基线.md
npm run measure:phase5-ab
```

最近一次全仓结果：Runtime 51 个测试文件、292 个测试通过，1 个既有跳过；其余 workspace 测试通过。后续局部修改均按影响范围增量验证。主 Agent Spec 写入链路修复后：`answer-spec.test.ts`、`query-assurance.test.ts`、`agent-assembly.test.ts`、`tools-catalog.test.ts` 共 94 个测试通过；Runtime 与 Electron Host 编译通过；Spider2 Runner/Web Host 语法检查和 `lib.test.mjs` 22 个测试通过。CTE fanout 修复后增量验证：Runtime 相关 5 个文件 103/103，通过 Server MCP 集成测试 3/3，Runtime、Server、Electron Host 编译通过；使用 local003 历史错误 SQL 对真实 SQLite replay，观测 `COUNT(o.order_id)=110197`、`COUNT(DISTINCT o.order_id)=96478`，并登记 D1 `join_fanout` 与 D2 `count_distinct_divergence`。

## 剩余验收阻塞

当前仅剩外部端到端效果验收：

1. 提供与 control/treatment 配置对应的模型凭据；
2. 在当前 HEAD 上以同模型、同配置、同预算、同题集运行两个 arm；
3. 确认 Trace 中所有成功 `query_database` 均具有显式 mode；
4. 比较固定分母准确率、发布覆盖、探索查询、结果候选、修订次数、耗时和发布失败；
5. 只有当前 HEAD treatment 不低于同日 control，才把方案状态改为默认可推广。
