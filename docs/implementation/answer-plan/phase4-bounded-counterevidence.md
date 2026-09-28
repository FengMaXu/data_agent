# Answer Plan Phase 4：有界反证优先验收记录

日期：2026-09-08

## 结论

Phase 4 的规范计划投影、局部反证规则注册表、Risk Planner、任务级与规则级探针预算、Server/Electron 证据 adapter 和 shadow-only 授权不变合同已经实现。该能力只报告具备声明前提的局部反证；没有命中、parser/lineage 不支持或证据不足，均不会被包装为“SQL 已整体符合计划”或已证实语义错误。

固定十题实时 Smoke 单次观测为 Delivered 9/10、Correct 0/10；`local050` 达到 `max_turns`。相对冻结 B1 的实时模型覆盖与正确率均未达推广结论，保留至 Phase 6 配对效果验收；确定性协议回放无非预期交付回退。

## 冻结实现与协议

- 计划协议：`evidence-plan-v2`；任务会话 schema：`data-agent.answer-session@3`；Query Assurance durable state：schema 4。
- 反证策略：`bounded-counterevidence-v1`；启用规则：
  - `observed_join_fanout@1`
  - `unauthorized_population_exclusion@1`
  - `final_scalar_shape@1`
- `packages/runtime/src/answer-spec.ts`
  - `AnswerContract` 是受支持结构化计划字段的唯一可写来源；`canonicalSupportedPlan`、七槽位文本和兼容投影均由其生成。
  - 基础粒度、度量/聚合、分母、时间、排序/tie policy 可结构化表达；未知字段保持未知。
  - routine revision 保留 Runtime 所有的结构化合同以及候选 hypothesis/binding，并在投影完成后校验 JSON Pointer。
- `packages/runtime/src/counterevidence.ts`
  - 每条规则声明 `ruleVersion`、`dialects`、`requiredEvidence`、`supportedShapes`、`probeBudget` 和局部 `coverage`。
  - 结果状态区分 `counterevidence`、`no_counterevidence`、`not_applicable`、`unsupported`、`insufficient_evidence`、`unavailable`、`inconclusive`；所有新增规则 `blocking=false`。
  - Risk Planner 优先复用 D1/D2；只有缺少所需观察证据时才安排有界 probe，并为跳过记录 reason。
- `packages/runtime/src/query-assurance.ts`、`query-assurance-store.ts`
  - 将 plan、规则结果、population/cardinality observation 和实际预算账本绑定到 immutable Query Artifact 并持久化恢复。
  - probe 结果只进入 shadow 观测/披露，不改变既有身份完整性与合格确定性形状授权。
- `packages/runtime/src/agent-assembly.ts`
  - `ProbeExecutionControl` 在每次物理 SQL 之前记账；同时限制任务剩余预算和本次已调度规则声明调用数。
  - `ProbeRequest.rules` 将 fanout 与 population 入口分开，避免一个规则消耗另一个规则的预算。
  - 实际 `probeCalls` 从 durable ledger delta 计算；超预算记录 `PROBE_BUDGET_EXHAUSTED`，不把计划调用数冒充实际调用数。
- `apps/server/src/mcp-query-executor.ts`、`packages/electron-host/src/mcp-query-executor.ts`
  - 两 Host 使用同一 `ProbeRequest`、`ProbeExecutionControl` 和证据结构。
  - population effect 通过单条 conditional-aggregation statement 同时得到 baseline/filtered rows；证据必须携带精确 predicate 与 observation `snapshotId`。
  - 复合 AND/OR predicate 当前返回 inconclusive，不将整段 WHERE 的缩减错误归因到某个 disputed 子谓词。
- `packages/runtime/src/disclosure.ts`
  - 披露明确区分规则命中、未发现、不适用、不支持、证据不足、不可用和不确定；不会把局部 no-counterevidence 汇总成整体语义通过。

## Phase 4 验收逐项

| 验收项 | 状态 | 可核查证据 |
|---|---|---|
| 客户等权与订单加权可表示为不同计划选择 | 通过 | `answer-spec.test.ts` 的 distinct canonical plans；`decision-scenarios.test.ts` 和 `decision-e2e.test.ts` 的 customer/order weighting fixtures |
| 每条启用规则具备错误命中、正确反例、合法近似、不支持、证据不足 fixture | 通过 | `counterevidence.test.ts` 7 个合同/矩阵测试；三条规则分别覆盖要求的正反例和边界状态 |
| parser 不支持、空 expected、review reason 无效不冒充语义错误 | 通过 | `counterevidence.test.ts` 的 unsupported/empty expected/invalid reason fixtures；结果为 unsupported、insufficient 或 inconclusive |
| 预聚合/去重合法 JOIN、权威排除、内层标量聚合不被简单特征误杀 | 通过 | `counterevidence.test.ts` 的 deduplicated/pre-aggregated、authorized exclusion、inner scalar fixtures |
| shadow 检查开关不改变合法候选发布授权 | 通过 | `agent-assembly.test.ts` “keeps new counterevidence observations shadow-only”；身份/形状负例由 `query-assurance.test.ts` 独立回放 |
| 同一计划的七槽位/answerContract 投影一致；未知字段不补造 | 通过 | `answer-spec.test.ts` canonical projection、unknown omission、structured hypothesis binding tests |
| 探针超预算停止且披露，实际调用全部记账 | 通过 | `agent-assembly.test.ts` task budget、recovery、per-rule two-call cap；第三次物理 SQL 前拒绝且 ledger delta=2 |
| Server/Electron 同能力返回一致状态，跳过有 reason | 通过 | 两 Host `mcp-query-executor.test.ts` 的真实 SQLite MCP 回放；共同 Runtime 合同；`ProbeRequest` 分离入口 |
| 共同回归门槛 | 通过（效果风险保留 Phase 6） | 下述确定性全量回归及固定十题单次 Smoke |

## 证据资格与保守边界

1. JOIN fanout 只有在权威 Digest、相关聚合形状和具 snapshot binding 的 cardinality evidence 同时成立时才报告局部反证；预聚合或去重抵消时为 no-counterevidence。
2. population effect 必须与 G2 disputed predicate 精确匹配。单条 statement 保证 baseline 与 filtered count 来自同一查询观察；缺 `snapshotId` 为 inconclusive。复合谓词暂不拆解，明确返回 `COMPOUND_DISPUTED_PREDICATE_UNSUPPORTED`。
3. scalar rule 只比较权威输出合同与实际一行一列形状；内层已完成标量聚合不会因“外层无聚合”被误杀。
4. 所有局部规则均无发布阻断权。既有 spec/candidate/revision/content identity 与合格确定性输出形状阻断保持独立且不因 shadow 开关放宽。

## 确定性回归

当前工作区基准 commit：`0117a658f4a2401d304a68d71162f7c8980e4ea0`。

Phase 4 核心实现与测试清单 SHA-256（不含本文）：`45c39db59231996928bfe1f6ed7e649153e2008bfd911e14fc9abf03adfe0883`。清单覆盖 AnswerSpec、Counterevidence、Query Assurance/store、Agent assembly、Disclosure 与 Server/Electron adapters 的实现及测试。

已跟踪工作区 patch SHA-256（最终增量复核前检查点）：`db45739b2906d48f9c0846438a2ef956cf22121bc018f3ad5b4ea44fe385e23e`。工作区包含目标启动前既有改动，不能将该 hash 的全部差异归因于 Phase 4。

最终候选命令与输出：

```bash
npm test --workspace=@data-agent/runtime -- --run
# 58 files passed; 407 passed, 1 skipped
npm test --workspace=@data-agent/server -- --run
# 5 files passed; 16 passed
npm test --workspace=@data-agent/electron-host -- --run
# 3 files passed; 10 passed
npm test --workspace=@data-agent/contracts -- --run
# 2 files passed; 5 passed
node --test evaluations/spider2/*.test.mjs
# 43 passed, 0 failed

npm run build --workspace=@data-agent/contracts
npm run build --workspace=@data-agent/runtime
npm run build --workspace=@data-agent/server
npm run build --workspace=@data-agent/electron-host
# 四项均 exit 0

git diff --check
# exit 0；仅既有 CRLF 转换提示
```

日志位于 `.artifacts/answer-plan-phase4/`，SHA-256：

- Runtime：`52c8caf5c709c23564b9adbf105c5280b0d16120e21a41ab7ff86c447ba671b1`
- Server：`e8ea11b97d94b941c4a96d5c7744dcac86f3abad506ec0d93adff000f0c7d012`
- Electron：`81747f87acc48cf7163d67d32918253cab4a0f3d874c58421f0eabb9d0ab8d30`
- Contracts：`f2cbf2dbb7c8108923484fea392fa3cdfc539f682e5ab2d3c990a48d54914c71`
- Spider harness：`b93db9751e3d23c7f3c655b0db52abeda9f9a6d360ebe63e343fa3de633589e1`
- `git diff --check`：`50c498ee6857b1f6c2b9d7a46b0507657486c7c544a0682977a92fc6c93fdc8d`

唯一 skipped 是 Windows workspace symlink 权限相关既有测试；不属于 Phase 4 必需合同。真实 Host probe、预算、规则矩阵、授权不变和恢复测试均未跳过。

## 实时 Smoke 与 B1 对比

命令：

```bash
npm run eval:spider2 -- run --config .artifacts/phase2/config.json \
  --ids-file evaluations/spider2/round8-shadow10-ids.txt \
  --model-profile deepseek \
  --run-id answer-plan-phase4-final-shadow10-001 --formal --score
node evaluations/spider2/baseline-report.mjs \
  --run C:/data-agent-eval/runs/answer-plan-phase4-final-shadow10-001 \
  --output C:/data-agent-eval/runs/answer-plan-phase4-final-shadow10-001/baseline-report.json
```

冻结配置：固定 10 题、DeepSeek profile、20 turns、50 tools、最多 6 次 exploration、300 秒、concurrency 3。保留全部尝试，没有逐题重跑或择优替换。

- 9 completed、1 max_turns（`local050`）。
- Delivered Set：`local003, local010, local025, local029, local032, local034, local035, local037, local061`，9/10。
- Correct Set：空集，0/10。
- SQL/CSV coverage：90%；固定分母 SQL/End-to-End EX：0/10。
- 平均时长 139234 ms；平均工具调用 25.80。
- 相对 B1（Delivered 10/10、Correct 0/10、106651 ms、22.1 calls）：交付 -1、正确持平、平均时长约 +30.5%、平均工具调用约 +16.7%。唯一交付退化是模型在冻结 20 turns 达到 `max_turns`，不是确定性 Receipt/Runner 故障；仍不得据此宣布可交付性或成本达标。
- 9 个发布均为 `published_with_disagreement`；Registered anomalies 与 Interpretation Hook injections 均为 0。这次题集没有观测到反证命中，不构成规则 recall/precision 结论，实际误报率由 Phase 6 风险集测量。

制品目录：`C:/data-agent-eval/runs/answer-plan-phase4-final-shadow10-001`。关键 hash：

- Manifest：`270c6cc1217fb6092462dddb764f34a4bf4b7b34d6cde572a2fef36c9455a60b`
- Summary：`613d010611241a29798b374d388facdfcad3f2f3e7025fd205fc89a99fc442cc`
- Report：`3fe7cd6a41c886fd2ba4b6747dbabe17a93c93c1662f2ef243772ea48c9ce0cb`
- Official score：`707ba907dd3bdfb03b6460a373c6bf2939b4651a8cbfe480248889c85424f99d`
- Delivered/Correct report：`91efe3cd30e9419cef5a7670dd8a3227338ba56f6be000e5ef0feb85ef9e47df`

## 独立复核

- 首轮复核指出 production path 未采集 D2 population observation、结构化 candidate hypothesis 在 routine revision 丢失；已整改。
- 二轮复核指出每规则预算未强制、复合谓词可能错误归因、两个独立查询冒充同一 snapshot；已整改为 Runtime 本地规则 cap、精确 predicate binding、复合谓词 inconclusive、单 statement conditional aggregation。
- 第三次 reviewer 运行因子代理基础设施失败，没有输出，因此不冒充有效复核。
- 全量复核后的三个 P1 已按用户要求只做增量复核：run `11a54aba-a2bc-424b-a1a6-71a156a95299`，逐项确认 mixed-rule 逐规则限额、Server/Electron parity、population exact binding 均为 PASS；`No issues found`，`Incremental verdict OK`。复核未重复运行全量测试，使用的是整改后已执行的 Runtime 58、Server 3、Electron 1 定向结果。

因此 Phase 4 必需项关闭，Phase 5 可以启动。

## 残余风险与后续约束

1. 固定十题实时 Smoke 仅 9/10 交付且 0/10 正确，平均工具调用较 B1 高约 16.7%；Phase 6 必须按冻结大样本、至少三次配对及成本/超时门槛验收。
2. population probe 当前仅支持可安全改写的简单单表 WHERE；复合谓词、复杂查询、parser/lineage 缺失均保守 abstain，不扩展成通用 AST 白名单。
3. `snapshotId` 是单 statement SQL 与观察结果的确定性指纹，用于绑定该证据记录，不是数据库长期 snapshot token，也不证明后续发布时数据未漂移。
4. 新增反证规则仍为 shadow-only；若后续提升为 blocking，必须另行校准误报、批准政策并重跑 Phase 3 交付授权矩阵和 Phase 6 检测器消融。
5. 后续阶段修改 AnswerContract 投影、Artifact evidence、ProbeExecutionControl、Host adapter 或 Disclosure 时，必须重跑本阶段受影响验收。
