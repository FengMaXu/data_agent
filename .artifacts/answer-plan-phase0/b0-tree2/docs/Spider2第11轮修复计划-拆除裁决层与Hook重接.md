# Spider2 第 11 轮修复计划：拆除裁决层，检测器经 Hook 重接为"告知 + 强制备选"

> 状态：计划，待执行
> 取代：`docs/Spider2语义收敛方案-证据资格与确定性门控.md`（RFC，标记 superseded）
> 需新增 ADR：`docs/adr/0003-detect-inform-never-block.md`，修订 ADR-0002 中"无已校准版本时 fail-closed"与"门默认拥有阻断权"两条
> 证据：`docs/Spider2第9轮10题Trace逐题错误分析报告.md`、`docs/Spider2第10轮评测实验报告.md`、`docs/Spider2与Query Assurance测评转交文档.md`

---

## 0. 一页结论

| 项 | 内容 |
|---|---|
| 决策 | 不修补现有裁决层，不回退到 `105114d`。从 HEAD 开分支做外科手术式拆除 |
| 拆什么 | 门控阻断语义、校准准入、Reviewer 在交付路径、修复额度、任务状态机、Spec Hard 准入裁决 |
| 留什么 | Query Digest（sqlglot）、subagent 身份绑定与 Publication Receipt、审计记录、探针原语、Spider2 runner、题面确定性推导 |
| 加什么 | 四个 harness Hook 组成的薄适配层，把保留的检测器接为"在观测时刻告知模型 + 异常槽位强制多候选" |
| 硬阻断只剩两种 | subagent 身份不匹配；形状违规且该结果本来就得 0 分 |
| 交付政策 | 默认 deliver-with-disclosure；`unavailable` 永不阻断交付 |
| 执行方式 | 先拆后加，每阶段独立 Run ID 与 A/B；拆除阶段只验证交付恢复，不看准确率 |

---

## 1. 目标与非目标

### 1.1 目标

1. 恢复交付：固定 10 题的 SQL 覆盖回到 10/10，CSV 覆盖不低于第 9 轮的 4/10，`not_published_review_unavailable` 归零。
2. 把第 10 轮已验证有效的确定性检测（fanout、指纹不变、形状/多余列、未授权过滤）从"阻断"改为"在模型看到数据的同一时刻告知，并在异常槽位强制产出 ≥ 2 条语义不同的候选"。
3. 让每一个新增机制都能单独 A/B，任何一阶段可回退到上一阶段。
4. 把 runtime 非测试代码从约 10,400 行收缩到可解释的规模；被删除的代码要么无实测贡献，要么其职责被 Hook 层替代。

### 1.2 非目标

- 不承诺固定 10 题准确率目标。local003（运费先验）、local010/050（文档与 Gold 冲突、隐藏总体）、local032（反直觉口径）在任何机制下都只能做到"备选可见、选择有记录"。
- 不重建 LLM Reviewer 的交付权。Reviewer 模块保留用于离线 replay，不在运行时路径。
- 不做第二次大爆炸式重构。Phase 1 的止血 diff 必须小到能在一天内评审。

---

## 2. 决策依据（只列事实）

| 事实 | 出处 | 推论 |
|---|---|---|
| runtime 非测试代码：`105114d` 时 3,629 行 → HEAD 10,426 行；QA 层新增 14 文件约 6,800 行 | `git diff --shortstat 105114d HEAD` | 三分之二的代码属于 QA 层 |
| 第 8 轮（QA off）16/86；第 9 轮 0/10；第 10 轮 0/10 且 CSV 4→3、7 题 `not_published_review_unavailable` | 三轮报告 | QA 层三轮净贡献 ≤ 0 |
| 第 10 轮配置为 `mode: shadow`、`shadowDelivery: publish_with_disagreement`、`planner: false`、`calibration.eligible: false` | `config-round10-retry-v3.json` | 即使在 shadow 且允许带分歧发布，`unavailable` 仍阻断了 7 题 |
| 第 10 轮 audit：`gateCalibrationMissing: [g1,g2,g3,g4]`、`REVIEWER_FAILED: REVIEW_REASON_INVALID` | 第 10 轮报告 §4.3 | fail-closed on uncalibrated 与 Reviewer 协议错误共同制造 `unavailable` |
| ADR-0002："无已校准版本时 fail-closed" | `docs/adr/0002` | 未校准 → 阻断 → 无交付样本 → 无法校准：结构性死锁 |
| 第 10 轮 G3 正确检出 117601 vs 103886；G4 正确识别改别名指纹不变 | 第 10 轮报告 §4.2 | 检测器有效，动作（阻断）无效 |
| 唯一有实测收益的改动是第 3~4 轮基础设施修复（27% → 40.7%） | 转交文档 §0.2 | 这些改动早于 `105114d`，两条路线都保留 |
| `105114d → HEAD` 共 47 文件、+10,448/-671，混有产品端 QA 接线与非 QA 修复 | git | 整体回退会破坏产品端 |

---

## 3. 设计原则

1. **检测与动作解耦。** 检测器（Digest、fanout、指纹、形状、过滤授权）是确定性代码，保留并复用；动作由 Hook 层决定，默认是"告知"。
2. **观测永不阻断交付。** `unavailable`、`inconclusive`、`not_applicable`、未校准，全部记录，全部交付。没有这一条就永远收不到校准样本。
3. **硬阻断只保护完整性，不裁决语义。** 允许阻断的只有：(a) 发布的 subagent 与最终预览不一致；(b) 形状违规且官方评分必然为 0（题面要求标量，候选返回 N 行；题面要求 Top-N，候选行数 ≠ N）。其余形状问题（多余列、列名）只告知。
4. **结构放进工具返回与注入消息，不放进系统提示词。** 模型的行为改变来自它在观测时刻收到的具体、即时、结构化信息，不来自 prose 规则。
5. **重新理解在新上下文里做。** 异常触发的解释枚举由一次独立的 planner 调用产出（只带题面 + DDL + 异常证据），再经 `prepareNextTurn` 注入 Solver，打破同一对话内的承诺偏差。
6. **Hook 是薄适配层。** 领域逻辑（检测器、Digest、Receipt）留在 runtime 对象里可离线 replay；Hook 只负责"在哪个生命周期点调用它、把结果放到哪"。
7. **先拆后加，分开归因。** 拆除阶段只验证交付恢复；每个 Hook 单独一轮。

---

## 4. 目标架构

### 4.1 生命周期与 Hook 映射

```text
用户/题目
  │
  ▼ prompt()                     ← 保留：注入 [ANSWER_SPEC_READ_ONLY]（题面确定性推导，只读上下文）
Solver 回合
  │
  ├─ query_database ─────────────► afterToolCall(query_database)
  │                                 · 事后按 Digest 判定 exploratory / candidate
  │                                 · 运行检测器 → 异常登记（绑定槽位）
  │                                 · 把异常条目附加进本次工具返回 content
  │                                 · 自动收割 observed data（行数、distinct、极值）
  │
  ├─ [下一轮 LLM 调用前] ─────────► prepareNextTurnWithContext
  │                                 · 若有新登记且未处置的异常：
  │                                   调用 planner（新上下文）枚举该槽位的可采解释
  │                                   注入 [INTERPRETATIONS] 消息 + 要求 ≥2 条指纹不同的候选
  │
  ├─ export_query / publish ─────► beforeToolCall(export|publish)
  │                                 · 硬阻断 A：subagent 身份不匹配
  │                                 · 硬阻断 B：形状违规且必然 0 分
  │                                 · 其余：放行，disclosure 随 Receipt 记录
  │                               → 工具内部：export-candidate 流式导出 + Publication Receipt
  │                               → afterToolCall(export).terminate = true
  │
  └─ subscribe ──────────────────► 审计：所有事件 → trace.json（保留现状）
```

### 4.2 模式简化

删除 `assurance.mode = off | shadow | enforce`。替换为：

```jsonc
"assurance": {
  "detectors": { "enabled": true },            // 检测器是否运行（Phase 3 起）
  "hooks": {
    "informOnQuery": true,                     // afterToolCall(query_database)
    "interpretationsOnAnomaly": true,          // prepareNextTurnWithContext
    "integrityBlocks": true,                   // beforeToolCall 两种硬阻断
    "terminateAfterExport": true
  },
  "delivery": "deliver_with_disclosure",       // 唯一运行时政策；"fail_closed" 作为产品可选项，不默认
  "reviewer": { "enabled": false }             // 运行时不调用 Reviewer；离线 replay 另有入口
}
```

---

## 5. 分阶段计划

每阶段：独立分支提交 → 单元测试 → 固定 10 题新 Run ID → 与上一阶段 A/B → 记录到 `docs/Spider2第11轮阶段N报告.md`。

### Phase 0：分支与基线冻结（规模 S）

1. `git checkout -b round11/detect-inform` 自 HEAD。
2. 先处理工作区 14 个未提交文件：与拆除方向一致的（`query-gates.test.ts`、`calibration.*`、`query-assurance-store.*`）暂存到独立 WIP 提交，便于 Phase 1 一并处置；其余（`evaluations/spider2/lib.mjs` 等）单独提交。
3. `npm run build:runtime && npm run build:server && npm run test:eval:spider2` 通过。
4. 把第 9 轮 `spider2-local-round9-same10-no-limits-001` 和第 10 轮 `round10-tracefix-v10-c3` 的 `cases/*/result.json`、`trace.json`、`submissions/sql/*` 复制到 `C:/data-agent-eval/replay/round9-10/`，作为后续检测器离线 replay 语料。

验收：构建与现有测试通过；replay 语料目录就位。

### Phase 1a：政策级止血（规模 S，目标一天内可评审）

不删文件，只改交付决策，让 `unavailable` 不再阻断。

| 文件 | 改动 |
|---|---|
| `review-policy.ts` `DeliveryPolicy` | `unavailable` / `rejected` / `abstained` / `needs_clarification` 在任何模式下均返回 `publish_with_disagreement`；删除 `record_only` 分支对交付的影响 |
| `query-assurance.ts` 第 380 行附近 | 删除"Enforce is an earned mode"及校准检查对 `publishCandidate` 的前置条件 |
| `query-assurance.ts` `evaluateGates` 调用处（约 885 行） | 门结果只写入 audit 记录，不参与 `ReviewOutcome.availability` 与发布决策 |
| `agent-assembly.ts` `exportViaAssurance` / `publishInlineViaAssurance`（965、1105 行） | 删除 `SEMANTIC_DIFF_REPAIR_REQUIRED` 抛出；删除修复额度计数；`isExploratoryQuery` 不再影响候选资格 |
| `conversation-blind-reviewer.ts` 调用点 | 运行时默认不调用；配置 `reviewer.enabled=false` |
| Spider2 runner | `publicationStatus` 统计中 `published_with_disagreement` 计为交付；`not_published_review_unavailable` 若仍出现视为 bug |

验收（固定 10 题，新 Run ID `round11-p1a-001`）：

- SQL 覆盖 10/10；CSV 覆盖 ≥ 4/10；`not_published_review_unavailable` = 0；
- 平均工具调用数不高于第 9 轮的 35.8；
- 准确率不作为验收项（预期仍为 0/10）。

回退条件：交付未恢复 → 说明还有阻断路径未清，继续 Phase 1a，不进入 1b。

### Phase 1b：结构级拆除（规模 M）

Phase 1a 通过后，删除已成为死代码的路径。

| 文件 | 处置 | 预计行数变化 |
|---|---|---|
| `query-gates.ts` | 保留 `evaluateG1/G2/G3/G4` 的**检测部分**与 `candidateSemanticFingerprint*`，重命名为 `detectors.ts`；删除 `GateApplicabilityContract` 阻断语义、`gateCalibrationMissing` 路径 | 974 → 约 400 |
| `calibration.ts`、`calibration.test.ts` | 删除。离线校准改用 replay 脚本直接统计检测器命中 | −261 / −128 |
| `review-policy.ts` | 删除 `ReviewModeController`、`AssuranceCircuitBreaker`、`calibrationRecordFromReports`；`DeliveryPolicy` 收缩为常量 | 274 → 约 40 |
| `query-assurance.ts` | 删除 `QueryTaskLifecycleStatus` 中 `candidate_review / repair_available / awaiting_clarification / awaiting_authorization`；删除 Review Token 与 Publication Authorization 的语义分歧匹配（`PUBLICATION_AUTHORIZATION_MISMATCH` 仅保留 subagent 身份比对）；保留 `prepareTask`、`registerPreview`、`publishCandidate` | 1160 → 约 500 |
| `answer-spec.ts` | 保留 `AnswerSpec` 类型、`deriveRequestAnswerShape` / `deriveRequestFilterConstraints` 消费路径；删除 `SpecChangeProposal` 权威裁决、`SOLVER_PROPOSAL_REQUIRES_AUTHORITY` 等准入逻辑（Proposal 概念在 Phase 4 以"解释选择记录"形式回归，不带阻断权） | 761 → 约 350 |
| `conversation-blind-reviewer.ts`、`review-cache.ts` | 移到 `packages/runtime/src/offline/`，从 `index.ts` 运行时导出中移除，仅 replay 脚本引用 | 位置变更 |
| `publication.ts` | 保留 Receipt、subagent 绑定；`PublicationStatus` 收缩为 `published / published_with_disclosure / not_published_integrity` | 331 → 约 200 |
| `agent-assembly.ts` | 删除 `queryTaskStateFor` 中修复额度与 `hasExported` 状态（Phase 2 由 `terminate` 替代）；删除 `[DELIVERY_REQUIRED]` followUp（Phase 2 由 Hook 替代）；`REVIEWER_SYSTEM_PROMPT` 移到 offline | 1484 → 约 1100 |
| `.pi/SYSTEM.md` | 删除 §1.3 第 2 步"一轮证伪"中"修订合同"字样与第 3 步"回到第 2 步修订"；证据优先级对齐 `CONTEXT.md` 七级；新增一句"探索结果只用于确认列名、值编码与基数，不据此新增过滤、排除值或改变统计实体" | — |
| 测试 | 对应删除；`query-assurance.test.ts`（637 行）按保留功能重写 | — |

验收：`npm run test --workspace=@data-agent/runtime` 通过；`npm run test:eval:spider2` 17/17；固定 10 题 `round11-p1b-001` 与 `p1a` 交付指标持平。

### Phase 2：Hook 适配层骨架（规模 S）

先接两个最简单、无判断的 Hook，验证 harness Hook 通路本身。

新文件 `packages/runtime/src/hooks/assurance-hooks.ts`：

```ts
export interface AssuranceHooks {
  beforeToolCall: readHarnessOptions["beforeToolCall"];
  afterToolCall: readHarnessOptions["afterToolCall"];
  prepareNextTurnWithContext: readHarnessOptions["prepareNextTurnWithContext"];
}
export function createAssuranceHooks(deps: { detectors; queryAssurance; planner?; audit; config }): AssuranceHooks;
```

在 `agent-assembly.ts` 的 `new DatareadHarness({...})` 处传入。

Phase 2 只实现：

- `afterToolCall(export_query | publish_query_result)` 成功 → `{ terminate: true }`；
- `subscribe` 中新增 `hook_fired` 审计事件，记录 Hook 名、工具名、动作、耗时。

验收：固定 10 题 `round11-p2-001`；导出成功后回合数不再增长（对比 p1b：导出成功后平均额外回合数 → 0）；trace 中出现 `hook_fired`。

### Phase 3：`afterToolCall(query_database)` 异常告知（规模 M）

#### 3.1 事后用途判定

删除 `isExploratoryQuery` 正则。每次 `query_database` 成功后，对 SQL 跑 Digest：

- 无聚合、无 JOIN、`LIMIT ≤ 20` 或仅访问 `sqlite_master` / `PRAGMA` → `exploratory`；
- 其他 → `candidate`，注册 subagent（现状逻辑）。

#### 3.2 检测器清单（全部确定性，全部绑定 Spec 槽位）

| ID | 检测器 | 触发条件 | 绑定槽位 | 数据来源 | 第 9/10 轮命中 |
|---|---|---|---|---|---|
| D1 | join_fanout | Digest 含 JOIN 且度量为 `COUNT(*)/SUM/AVG`；Runtime 执行 `SELECT COUNT(*)` 对比连接结果行数与各侧事实表行数，连接结果 > 任一侧 | measure / grain | 同快照探针 | 034、037、029 |
| D2 | count_distinct_divergence | Digest 度量为 `COUNT(*)` 或 `COUNT(col)`；Runtime 同时计算 `COUNT(DISTINCT 主键候选)`；两者不等 | measure | 同快照探针 | 032、034、037 |
| D3 | entity_population_mismatch | Digest 的 FROM 事实表 distinct 外键数 ≠ 对应维度/实体表行数 | population | 同快照探针 | 025 |
| D4 | unauthorized_filter | Digest 过滤节点的列/值不在 `[ANSWER_SPEC_READ_ONLY]` 的 `deriveRequestFilterConstraints` 结果中，且不是结构性谓词（JOIN 键相等、`IS NOT NULL`、`rn = 1`） | filter | Digest vs Spec | 061 |
| D5 | null_like_member_in_filter | 过滤或排除的维度成员名匹配 `NO PROMOTION / UNKNOWN / N\/A / NONE / OTHER` | filter | 数据观察 | 061 |
| D6 | physical_bound_violation | 结果或中间列出现 lat ∉ [−90,90]、lng ∉ [−180,180]、负数量/负金额 | population | 数据观察 | 035 |
| D7 | shape_mismatch | 候选行数/列数与 Spec 的 `output` 不符；多余列（不在题面名词映射内） | final_shape | Digest vs Spec | 010、025、029、035、037 |
| D8 | intermediate_candidate | Spec 要求聚合值（AVG/MEDIAN/COUNT）而 Digest 最外层无对应聚合 | final_shape | Digest vs Spec | 025 |
| D9 | cross_period_set_mismatch | 两个比较期的实体集合（按 Spec 的 time 槽位）不相等 | population | 同快照探针 | 050 |
| D10 | empty_after_filter | 候选 0 行，且 Digest 含 D4 命中的过滤 | filter | 结果 | 061 |
| D11 | fingerprint_unchanged | 新候选 `candidateSemanticFingerprint` 与已登记异常绑定槽位上的指纹一致 | 该槽位 | Digest | 003、010、034 |

每个检测器有独立开关；探针类（D1/D2/D3/D9）受单任务预算限制：最多 5 次探针、单次扫描行数上限 200 万（超限记 `inconclusive`，不告知）。

#### 3.3 告知格式（附加进工具返回 content 末尾）

```text
[ANOMALY A-2 registered] join_fanout
  observed: joined_rows=117601, olist_order_payments=103886, olist_order_items=112650
  slot: measure
  status: unresolved
  note: 连接后行数超过任一侧事实表。当前 COUNT(*) 统计的是连接行，不是支付记录或订单。
```

约束：

- 一次工具返回附加全部新登记异常，不分批；
- 只陈述观测事实与绑定槽位，不给出"应该改成什么"；
- 同一异常 ID 不重复告知；后续候选若指纹在该槽位未变化，追加 D11 告知。

#### 3.4 异常登记表

新文件 `packages/runtime/src/anomaly-registry.ts`：

```ts
interface AnomalyRecord {
  id: string; detector: DetectorId; slot: SpecSlot;
  observed: Record<string, unknown>;
  status: "unresolved" | "acknowledged_with_choice" | "inconclusive";
  boundsubagentIds: string[];
  fingerprintAtDetection?: string;
}
```

写入 trace（`assuranceAuditRecords` 新增 `anomaly` 类型）。

验收（固定 10 题 `round11-p3-001`，与 p2 A/B）：

- 离线 replay：D1–D11 在第 9/10 轮 replay 语料上的命中与逐题报告一致，正确样本（Gold SQL 135 条经 Digest 后运行检测器）误报率 ≤ 5%；
- 运行时：**异常登记后，模型下一条候选在绑定槽位上的指纹变化率**（主指标，目标 ≥ 50%；第 9 轮为 0）；
- 交付指标不低于 p2；平均工具调用增量 ≤ 5。

### Phase 4：`prepareNextTurnWithContext` 解释枚举与多候选（规模 M）

#### 4.1 触发

回合结束时，异常登记表存在 `unresolved` 且本回合新登记（或 D11 命中）→ 触发。

#### 4.2 新上下文重推导

调用 planner（独立 `completeSimple`，不带 Solver 对话），输入：题面、DDL 摘要、`[ANSWER_SPEC_READ_ONLY]`、该异常的 `observed`。JSON schema 强制输出：

```jsonc
{
  "slot": "measure",
  "interpretations": [
    { "id": "I1", "statement": "统计支付记录数（order_payments 行）", "evidence": { "type": "question_span", "quote": "支付次数" } },
    { "id": "I2", "statement": "统计商品行×支付行连接数", "evidence": null }
  ]
}
```

Runtime 校验：`quote` 必须是题面真实子串，否则该条 `evidence` 置空；`interpretations.length ≥ 2`，否则不注入。

#### 4.3 注入消息

```text
[INTERPRETATIONS for A-2 / slot=measure]
I1: 统计支付记录数（order_payments 行） — evidence: question "支付次数"
I2: 统计商品行×支付行连接数 — evidence: none
Required: submit one candidate per interpretation via query_database.
Digest must differ on slot=measure. Then choose one for export and state which interpretation it implements.
```

#### 4.4 多候选校验与选择记录

- `afterToolCall(query_database)` 对后续候选计算 `candidateSemanticFingerprintForClaim(digest, slot)`，确认 ≥ 2 条指纹不同；不足则再次告知（最多一次）。
- 导出时，Receipt 记录 `chosenInterpretation`、`alternativessubagentIds`、`evidence`。这就是"决策-证据对"的最终形态：不带阻断权，但可审计。
- 模型不选择或选择无引用 → 仍交付，Receipt 记 `disclosure: unresolved_interpretation`。

验收（`round11-p4-001`，与 p3 A/B）：

- 触发后产出 ≥ 2 条指纹不同候选的比例（目标 ≥ 70%）；
- 选择带有效引用的比例；
- 准确率首次纳入观察（不设目标）：预期 local025/029/034/037/061 中至少 2 题进入正确解释；
- 平均工具调用增量 ≤ 8，无 timeout 增加。

### Phase 5：`beforeToolCall(export|publish)` 最小硬阻断（规模 S）

只有两种：

| 阻断 | 条件 | reason 载荷 |
|---|---|---|
| INTEGRITY_subagent_MISMATCH | `querysubagentId` 不是本任务最近一次成功候选预览 | `{ code, expectedsubagentId, receivedsubagentId }` |
| SHAPE_ZERO_SCORE | Spec `output=scalar` 且候选行数 > 1；或 `output=top_n(n)` 且行数 ≠ n | `{ code, expected: {rows, shape}, observed: {rows, columns}, subagentId }` |

其他一切放行。SHAPE_ZERO_SCORE 阻断后允许模型重新预览并导出，不设额度（该错误本来就是 0 分，多试一次没有代价；但 D11 会告知指纹是否变化）。

验收（`round11-p5-001`）：阻断只在上述两种条件出现；交付指标不低于 p4。

### Phase 6：全量 135 题回归（规模 L，主要是运行时间）

- 配置冻结（`freeze`），`--baseline` 运行 `round11-full-001`；
- 对照基线：**第 4 轮 55/135**（历史最好），不是第 9/10 轮；
- 同时报告：固定分母 E2E、CSV 覆盖、异常登记数/题、指纹变化率、多候选产出率、timeout/max_turns、平均工具调用。

通过标准：E2E 不低于 55/135 且 CSV 覆盖 ≥ 123/135（第 4 轮水平）。低于则逐 Hook 关闭做归因。

---

## 6. 阶段指标总表

| 阶段 | 主指标 | 门槛 | 回退动作 |
|---|---|---|---|
| 1a | `not_published_review_unavailable` 数 | = 0 | 继续清阻断路径 |
| 1a | CSV 覆盖 | ≥ 4/10 | 同上 |
| 1b | 测试通过 + 交付指标持平 1a | — | 恢复被误删模块 |
| 2 | 导出后额外回合数 | → 0 | 检查 `terminate` 传播 |
| 3 | 异常后绑定槽位指纹变化率 | ≥ 50% | 检查告知是否进入 content、检测器是否触发 |
| 3 | Gold SQL 误报率 | ≤ 5% | 收紧对应检测器 |
| 4 | ≥2 条不同指纹候选产出率 | ≥ 70% | 检查注入是否到达、schema 校验是否过严 |
| 5 | 阻断仅两类 | 100% | — |
| 6 | E2E vs 第 4 轮 | ≥ 55/135 | 逐 Hook 关闭归因 |

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| Phase 1a 后仍有隐藏阻断路径（如 export-candidate 的 `expectedColumns` 空合同） | `expectedColumns` 空时跳过比对；grep 全部 `throw new Error` 路径列清单，逐条归类为 integrity / 语义 / 协议 |
| 告知过多导致上下文膨胀与轮次增加 | 每异常只告知一次；探针预算 5 次；D6/D9 可按方言/数据规模关闭 |
| 模型把 `[INTERPRETATIONS]` 当噪音忽略 | Phase 4 主指标直接测量这一点；若 < 30%，改为在 `afterToolCall` 返回中重复一次 |
| planner 重推导给出的解释同样错误 | 只要求枚举 ≥ 2 条，不要求正确；错误解释会在 Receipt 留下记录，供离线分析 |
| `transformContext` 修剪推理导致 tool_call/tool_result 配对断裂 | 本计划**不使用** `transformContext`；列为 Phase 7 候选，需单独设计 |
| 探针在大表上成本高（local035 100 万行） | 行数上限 200 万；超限 `inconclusive`；D6 用 `MIN/MAX` 单次扫描 |
| 删除代码破坏 Electron host 接线 | Phase 1b 前 grep `packages/electron-host/src` 对 runtime 导出的引用；保留导出名、内部实现收缩 |
| Spider2 与产品政策分歧 | 产品 `delivery: fail_closed` 作为显式可选项；默认与 Spider2 一致，避免两套行为 |

---

## 8. 文档与 ADR 变更

1. 新增 `docs/adr/0003-detect-inform-never-block.md`（status: accepted），内容：
   - 确定性检测器保留，动作默认为告知；
   - `unavailable` 不阻断交付；
   - 硬阻断仅限完整性与必然 0 分形状；
   - 取代 ADR-0002 中"无已校准版本时 fail-closed"与门默认阻断权；ADR-0002 其余（`not_applicable` 与 `unsupported` 区分、Digest 由固定版本 parser 生成）继续有效。
2. `docs/Spider2语义收敛方案-证据资格与确定性门控.md` 顶部加 `状态：superseded by 第11轮修复计划`。
3. `CONTEXT.md` 新增术语：Anomaly Record、Interpretation、Disclosure；`Query Assurance` 定义改为"准备语义证据、检出并告知异常、记录解释选择、按完整性规则发布"。
4. `evaluations/spider2/README.md` 更新配置 schema 与新增指标字段。
5. `.pi/SYSTEM.md` 按 Phase 1b 表修改；总长度不增加。

---

## 9. 明确不做

- 不新增 task 工具或 read 侧状态机。
- 不让 read 提交 Digest、Probe 或 Spec 修改。
- 不在运行时调用 Reviewer；不把 Reviewer 结论作为交付条件。
- 不为单题把 Gold 值、字段名或口径写入 Prompt、Skill、文档或检测器。
- 不使用 `transformContext` 修剪模型推理（列为后续独立设计）。
- 不在 Phase 6 之前修改 135 题基线配置。

---

## 10. 执行顺序速查

```text
P0  分支 + WIP 归类 + replay 语料           → 构建通过
P1a 止血：unavailable 不阻断                → 10 题交付恢复（CSV ≥ 4, unavailable = 0）
P1b 拆除：删死代码、改提示词 4 处            → 测试通过、交付持平
P2  Hook 骨架：terminate + 审计              → 导出后不再空转
P3  afterToolCall 告知 + 检测器 D1–D11       → 指纹变化率 ≥ 50%，Gold 误报 ≤ 5%
P4  prepareNextTurn 解释枚举 + 多候选        → ≥2 候选率 ≥ 70%
P5  beforeToolCall 两种硬阻断                → 只此两类
P6  135 题全量 vs 第 4 轮 55/135             → 不低于基线
```

每一步一个 Run ID，一份阶段报告，一次 A/B。任何一步不达门槛，停在该步归因，不带着问题进下一步。
