# Spider2 第 11 轮修复计划：拆除裁决层，检测器经 Hook 重接为"告知 + 强制备选"

> 状态：Phase 0–6 已执行一轮；Phase 6 未通过（44/135 vs 基线 55/135）；本版为根据 Phase 6 逐题归因修订后的第 2 版，新增 Phase 1c 与 Phase 3'/4'/6' 修订
> 取代：`docs/Spider2语义收敛方案-证据资格与确定性门控.md`（RFC，标记 superseded）
> 需新增 ADR：`docs/adr/0003-detect-inform-never-block.md`，修订 ADR-0002 中"无已校准版本时 fail-closed"与"门默认拥有阻断权"两条
> 证据：`docs/Spider2第9轮10题Trace逐题错误分析报告.md`、`docs/Spider2第10轮评测实验报告.md`、`docs/Spider2第11轮阶段6与第4轮错题对比分析报告.md`、`docs/Spider2与Query Assurance测评转交文档.md`

---

## 0. 一页结论

| 项 | 内容 |
|---|---|
| 决策 | 不修补现有裁决层，不回退到 `105114d`。从 HEAD 开分支做外科手术式拆除 |
| 拆什么 | 门控阻断语义、校准准入、Reviewer 在交付路径、修复额度、任务状态机、Spec Hard 准入裁决 |
| 留什么 | Query Digest（sqlglot）、subagent 身份绑定与 Publication Receipt、审计记录、探针原语、Spider2 runner、题面确定性推导 |
| 加什么 | 四个 harness Hook 组成的薄适配层，把保留的检测器接为"在观测时刻告知模型 + 异常槽位强制多候选"；Runtime 自动数据画像作为检测器数据层；对抗性解释枚举器（无裁决权）作为多候选的来源；虚构化 few-shot 作为独立 arm |
| 硬阻断只剩两种 | subagent 身份不匹配；形状违规且该结果本来就得 0 分 |
| 交付政策 | 默认 deliver-with-disclosure；`unavailable` 永不阻断交付 |
| 执行方式 | 先拆后加，每阶段独立 Run ID 与 A/B；拆除阶段只验证交付恢复，不看准确率 |
| **Phase 6 第一轮结果** | `round11-full-c3-001`：44/135，未达 55/135。逐题归因：8 题是工程故障（5 题 API 连接错误被静默记为 completed；3 题发布路径仍被拦截）；`count_distinct_divergence` 触发 34 题、净收益 −1，把 max_turns 从 1 推到 13；`join_fanout` 4 命中 2 纠偏；`terminateAfterExport` 把 timeout 从 11 降到 1 |
| **第 2 版修订** | 新增 Phase 1c 修两个工程故障；检测器分级（只有结构性可证明的检测器能触发多候选）；D2 加 JOIN 前置条件并降为只告知；多候选周期预算感知且每题最多一次；Phase 6 必须带同配置同日 control arm |

---

## 1. 目标与非目标

### 1.1 目标

1. 恢复交付：固定 10 题的 SQL 覆盖回到 10/10，CSV 覆盖不低于第 9 轮的 4/10，`not_published_review_unavailable` 归零。
2. 把第 10 轮已验证有效的确定性检测（fanout、指纹不变、形状/多余列、未授权过滤）从"阻断"改为"在模型看到数据的同一时刻告知，并在异常槽位强制产出 ≥ 2 条语义不同的候选"。
3. 让每一个新增机制都能单独 A/B，任何一阶段可回退到上一阶段。
4. 把"数据探查""脏数据处理""few-shot""红队审查"四条建议以不违反原则 1–6 的形态落地：探查由 Runtime 自动完成且按 Digest 限定范围；脏数据的信息由检测器给、动作由多候选或用户澄清给；few-shot 只教推导结构且虚构化；红队只枚举备选不裁决。
4. 把 runtime 非测试代码从约 10,400 行收缩到可解释的规模；被删除的代码要么无实测贡献，要么其职责被 Hook 层替代。

### 1.2 非目标

- 不承诺固定 10 题准确率目标。local003（运费先验）、local010/050（文档与 Gold 冲突、隐藏总体）、local032（反直觉口径）在任何机制下都只能做到"备选可见、选择有记录"。
- 不重建 LLM Reviewer 的交付权。Reviewer 模块保留用于离线 replay，不在运行时路径。"对抗性红队"只以解释枚举器形态存在（§5 Phase 4），输出是备选读法而非 approve/reject。
- 不新增模型可选的 `profile_column` 工具。数据画像由 Runtime 自动完成（§5 Phase 3），不依赖模型决定调用。
- 不在系统提示词里加"数据可能有脏值，计算前先判断合理性"一类 prose 提醒。第 9 轮 local061 证明这类提醒会诱发未授权过滤（F1）。
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
| local035 模型在 toolCall 6–9 已看到 lat 45 / lng 121；local025 已看到 567 vs 568；仍照用 | 第 9 轮报告 §4.3、§4.7 | "看到数据"不是瓶颈，看到之后的动作才是；探查的价值在于喂给检测器和在解释形成前摄出 |
| local061 因"觉得 NO PROMOTION 不合理"而加 `promo_id<>999`，结果清空 | 第 9 轮报告 §4.10 | 泛化的"脏数据提醒"会诱发未授权过滤 |
| 第 8 轮 Shadow v2 五次 Approved 全错；第 10 轮 `REVIEW_REASON_INVALID` | 转交文档 §0.3、第 10 轮报告 §4.3 | 裁决型 Reviewer（无论措辞是否"对抗性"）不可用；LLM 可用的是"生成备选"而非"判定对错" |
| 建议中的两个 few-shot 官方示例分别是 `ga001`（ga4）和 `bq051`（new_york_ghcn），均在 spider2-lite 547 题内 | `spider2-lite.jsonl` 第 370、129 行 | 不在当前 SQLite 135 题内，但云端评测会污染；必须虚构化 |
| 唯一有实测收益的改动是第 3~4 轮基础设施修复（27% → 40.7%） | 转交文档 §0.2 | 这些改动早于 `105114d`，两条路线都保留 |
| **Phase 6：** `round11-full-c3-001` 44/135；E₄∩E₁₁ = 72，第 4 轮错题延续率 90% | 第 11 轮阶段 6 报告 §2 | 顽固错题不受外围机制影响，与§1.2 非目标一致；收益只能来自少数机械错误类 |
| **Phase 6：** 5 题（local007/008/009/019/020）首回合 `Connection error.`，0 工具调用，状态 `completed`，`--resume` 不重跑 | 阶段 6 报告 §4.1 | `classifyProviderFailure` 已匹配 `connection error`，但 `run.mjs` 只在 catch 路径把 `providerFailure` 转为状态；`prompt()` 正常 resolve 时不检查 |
| **Phase 6：** 6 题标为 `not_published_review_unavailable`，其中至少 3 题第 4 轮正确 | 阶段 6 报告 §4.1 | `run.mjs:443` 在无 Receipt 时按最后一条 audit 的 `reviewAvailability` 贴标签，把"从未导出"和"导出被拒"混为一谈；`publication.ts` 仍有 `REVIEW_TOKEN_MODE_STALE / SPEC_STALE / TASK_BUSY / AUTHORIZATION_MISMATCH` 四处非完整性 throw |
| **Phase 6：** `count_distinct_divergence` 34 题触发，触发题得分 13→12；max_turns 1→13；单题时长 +70.5% | 阶段 6 报告 §5 | `detectors.ts:82` 的 D2 无 JOIN 前置，对任何带 COUNT 的候选探针 COUNT vs COUNT(DISTINCT)；两者不等是分组计数的常态，不是异常；`hooks.ts:137` 对**任何** unresolved 异常触发解释枚举 |
| **Phase 6：** `join_fanout` 4 命中，2 题纠偏（local037/311） | 阶段 6 报告 §5.3 | 结构性可证明的检测器信噪比高；这是本计划唯一被实测证实的收益来源 |
| **Phase 6：** timeout 11→1 | 阶段 6 报告 §3 | `terminateAfterExport` 有效，保留 |
| **Phase 6：** 对照组是 6 周前的第 4 轮，预算不同（第 11 轮 20 turns / 50 tools / 300 s），无同日 hooks-off 对照 | `config-round11-p3-deepseek.json` | 11 题"纯语义倒退"中只有 local049/078 能归因到 Hook，其余无法与模型漂移区分 |
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
8. **信息与动作分开。** "数据有脏值"是信息，由检测器在观测时刻给出具体事实；"纳入还是排除"是动作，由多候选（Spider2）或用户澄清（产品）决定。任何把两者合并成一句 prose 规则的做法都会重演 local061。
9. **LLM 只做生成，不做裁决。** 需要 LLM 参与的唯一位置是"枚举候选没有实现的读法"；它的输出可被 Runtime 校验（引用是真实子串、候选指纹确实不同），且没有 approve/reject 语义。
10. **告知不是免费的。**（Phase 6 教训）一条告知如果触发多候选，成本是 3–8 个回合和一次“把对的改错”的机会。因此检测器分两级：**A 级**（结构性可证明：JOIN fanout、未授权过滤、漏最终聚合、加过滤后清空）才能触发多候选；**B 级**（统计性观察：count/distinct 分歧、实体数不一致、跨期集合、越界值）只告知。任何检测器升 A 级前，必须在 135 题上证明“触发题净得分 ≥ 0 且触发题 max_turns 增量 ≤ 1”。
11. **多候选周期预算感知。** 剩余回合/工具调用不足以完成“写一条备选 + 预览 + 导出”时，不注入解释枚举，直接带披露交付。把一道本来能交付的题推进 max_turns，比带着异常交付更糟。
12. **A/B 必须同配置同日。** 与几周前的历史轮比较只能看趋势，不能归因；每个全量阶段必须带一个 hooks-off 的 control arm。

---

## 4. 目标架构

### 4.1 生命周期与 Hook 映射

```text
用户/题目
  │
  ▼ prompt()                     ← 保留：注入 [ANSWER_SPEC_READ_ONLY]（题面确定性推导，只读上下文）
Solver 回合
  │  prepareTask                    · Schema Profile：每库一次，按 schema fingerprint 缓存（不注入）
  │
  ├─ query_database ─────────────► afterToolCall(query_database)
  │                                 · 事后按 Digest 判定 exploratory / candidate
  │                                 · Candidate Profile：只画像 Digest 中参与 ORDER BY / 极值 / AVG / 距离表达式的列
  │                                 · 运行检测器 → 异常登记（绑定槽位）
  │                                 · 把异常条目（含相关列画像）附加进本次工具返回 content
  │                                 · 自动收割 observed data（行数、distinct、极值）
  │
  ├─ [下一轮 LLM 调用前] ─────────► prepareNextTurnWithContext
  │                                 · 若有新登记且未处置的异常：
  │                                   调用解释枚举器（对抗性任务、新上下文、可换模型家族）
  │                                   产出 I0（候选已实现的读法）+ I1..In（候选未实现的读法，带引用）
  │                                   注入 [INTERPRETATIONS] 消息 + 要求 ≥2 条指纹不同的候选
  │                                 · 产品路径：D6/D5 类异常改为 ask_user_clarification，由用户裁决纳入/排除
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
  "detectors": {
    "enabled": true,                            // 检测器是否运行（Phase 3 起）
    "tierA": ["join_fanout", "unauthorized_filter", "intermediate_candidate", "empty_after_filter"],  // 可触发多候选
    "tierB": ["count_distinct_divergence", "entity_population_mismatch", "cross_period_set_mismatch",
              "physical_bound_violation", "null_like_member_in_filter", "shape_mismatch", "fingerprint_unchanged"], // 只告知
    "disabled": []                              // 逐检测器开关；manifest 必须记录生效集合
  },
  "interpretations": {
    "triggerTiers": ["A"],                      // 只有 A 级触发解释枚举；D5/D6 走固定分叉且计入周期数
    "maxCyclesPerTask": 1,                      // 每题最多一次多候选周期
    "minRemainingTurns": 6,                     // 预算感知：不足则不注入，直接带披露交付
    "minRemainingToolCalls": 10
  },
  "profile": {
    "schema": { "enabled": true, "cacheTtlHours": 24 },   // 每库一次，按 schema fingerprint 缓存
    "candidate": { "enabled": true, "p99SampleRows": 200000 } // 按 Digest 限定列；p99 只在采样上算
  },
  "hooks": {
    "informOnQuery": true,                     // afterToolCall(query_database)
    "interpretationsOnAnomaly": true,          // prepareNextTurnWithContext
    "integrityBlocks": true,                   // beforeToolCall 两种硬阻断
    "terminateAfterExport": true
  },
  "enumerator": {                              // 对抗性解释枚举器（Phase 4）
    "model": "${ENUMERATOR_MODEL}",            // 建议与 Solver 不同家族；单次结构化调用，不受多轮延迟影响
    "trigger": "on_anomaly",                   // on_anomaly | on_anomaly_and_pre_export（后者为 Phase 7 实验）
    "cacheKey": ["questionHash", "slot", "detector"]
  },
  "dirtyDataAction": "multi_candidate",        // Spider2: multi_candidate；产品: ask_user
  "delivery": "deliver_with_disclosure",       // 唯一运行时政策；"fail_closed" 作为产品可选项，不默认
  "reviewer": { "enabled": false }             // 运行时不调用裁决型 Reviewer；离线 replay 另有入口
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

### Phase 1c：Phase 6 暴露的两个工程故障（规模 S，**优先于一切后续工作**）

这两个故障合计吃掉 8 题，且都是 Phase 1a 宣称已解决但实际未解决的事。不修完不得重跑 Phase 6。

#### 1c.1 Runner 静默吞没 provider 错误

现状：`lib.mjs:165` `classifyProviderFailure` 已匹配 `connection error`，`createRecorder` 也已捕获 `providerFailure`；但 `run.mjs:568–575` 只在 `catch` 分支把它转为 `provider_error`。首回合 API 错误时 harness 的 `prompt()` 正常 resolve，走不到 catch，状态留在 `completed`。

修改：

| 位置 | 改动 |
|---|---|
| `run.mjs` `prompt()` resolve 后 | 硬规则：`recorder.providerFailure && toolCalls.length === 0` → `status = "provider_error"`，`error.provider = providerFailure`；`providerFailure && !csvGenerated` → 同上（覆盖 local004 类中途断连） |
| `lib.mjs` `createRecorder` | `providerFailure` 首次置位时同步 `terminalReason = "provider_error"`，不依赖 run.mjs 事后检查 |
| `--resume` | 确认 `provider_error` 在重跑集内（现状已是）；新增 `--resume-statuses` 显式参数，默认 `provider_error,resource_error,error` |
| 单测 | `lib.test.mjs` 新增：首回合 assistant `stopReason: error` + `errorMessage: "Connection error."` + 0 工具调用 → `provider_error` |

验收：对 `round11-full-c3-001` 执行 `--resume`，local007/008/009/019/020 被识别为可重跑；重跑后 5 题至少 4 题恢复 CSV（第 4 轮均 ≤ 11 turns 完成）。

#### 1c.2 发布路径残留拦截与标签混淆

两件事混在一个标签里，必须分开：

**(a) 标签错误。** `run.mjs:443` 在没有 Receipt 时，按最后一条 audit 记录的 `reviewAvailability` 贴 `not_published_review_unavailable`。模型根本没调用 `export_query`（如 local004 中途断连）也会得到这个标签。改为：

```text
not_published_no_export_call        模型未调用 export/publish
not_published_export_failed:<code>  调用了但工具抛错，附错误码
not_published_provider_error        provider 错误中断
not_published_integrity:<code>      仅限 §5 Phase 5 两种硬阻断
```

`not_published_review_unavailable` 从 `PublicationStatus` 枚举中删除；若仍出现，单测失败。

**(b) 真实拦截。** `publication.ts` 仍有四处非完整性 throw：`REVIEW_TOKEN_MODE_STALE`（259/303 行）、`REVIEW_TOKEN_SPEC_STALE`（266）、`PUBLICATION_TASK_BUSY`（269）、`PUBLICATION_AUTHORIZATION_MISMATCH`（298）；`query-assurance.ts:1051/1055` 的 `REVIEW_UNAVAILABLE: QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED` 是合法的完整性阻断但前缀误导。处置：

| throw | 处置 |
|---|---|
| `REVIEW_TOKEN_MODE_STALE`、`REVIEW_TOKEN_SPEC_STALE`、`PUBLICATION_AUTHORIZATION_MISMATCH` | 删除（Phase 1b 应删未删；mode 与 authorization 概念已不存在） |
| `PUBLICATION_TASK_BUSY` | 保留但改为等待而非抛错（同任务串行） |
| `QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED` | 保留，前缀改为 `INTEGRITY_`；返回给模型的 reason 附最近一次有效 `querysubagentId` |
| `publication.ts:306` `REVIEW_NOT_APPROVED` | `DeliveryPolicy.allowed` 已恒为 true，删除死代码 |

验收：对 local003/004/030/073/075/096 的 trace 逐题确认真实失败原因并归入新标签；`grep -rn "throw new Error" publication.ts query-assurance.ts export-candidate.ts` 的每一条都在计划里有归类（integrity / 协议 / 删除）；固定 10 题 + 这 6 题重跑，`not_published_review_unavailable` 不再出现。

### Phase F：虚构化 Few-shot（独立 arm，规模 S，可与 Phase 2 并行）

#### F.1 为什么这不是第 5 轮的重演

第 5 轮失败的是规则型提示词。Few-shot 是模式归纳，模型对"照这个结构推导"的遵循度高于对"遵守这条规则"。本项目未测过，所以作为独立 arm，不与 Hook 混在同一 Run。它与 Phase 3/4 的关系：Hook 给触发，few-shot 给响应模式——模型收到 D1 告知后，需要知道正确的响应是"度量先在自己的粒度上聚合，再按键连接"，而不是在外层加 WHERE（第 10 轮 local034 的实际行为）。

#### F.2 污染处置

建议中的两个"官方示例"是测试集实例 `ga001` 和 `bq051`。处置：全部改写为虚构领域（学生/选课/缴费、门店/订单/天气站），保留推导结构，改掉表名、实体名和具体数值。同时在 `evaluations/spider2/README.md` 登记 `promptDerivedFromInstances: [ga001, bq051]`，云端评测时固定排除这两题。**不得使用 Olist、IPL、任何当前 135 题所属库的表名。**

#### F.3 三个示例（约 750 token，放 `.pi/SYSTEM.md` 新增 §1.5"口径推导示范"）

表名已逐一核对，与 `C:/data-agent-eval/Spider2/spider2-lite/resource/databases/` 下全部 SQLite 库的表/视图名无冲突（`bookshop_sales`、`weather_posts`、`temp_readings`、`footfall`、`course_signups`、`tuition_payments`）。注意 `payments`、`purchases`、`stores`、`students`、`enrollment` 均与本地库冲突，不得使用。

| 示例 | 教什么 | 覆盖失效模式 | SQL |
|---|---|---|---|
| E1 人群与共购 | Target Cohort（先 DISTINCT 实体）→ Measure & Granularity → Output Contract（单行） | F4 形状、总体定义 | 压缩到 ≤ 6 行或省略 |
| E2 多级聚合 | Spatial Anchor → Unit Mapping（文档单位换算）→ Stage 1/2/3 各自聚合到日粒度再 JOIN → Output Contract（2 行） | **F5 fanout 的标准解法**、单位 | 保留 CTE 骨架，删掉不存在的便利列（如 `WHERE year = 2016`） |
| E3 异常后重推导 | 初始推导 → 观测到连接行数 > 事实表行数 → 重推导统计实体 → Stage 化。末尾"未做的事"：不因看到 `method='UNKNOWN'` 就加 `WHERE method<>'UNKNOWN'`；纳入/排除两种口径都算出来 | **F1 未授权过滤、F2 发现反证后重理解** | 无 SQL，只有推导 |

E3 的"观测:"行写法与 §3.3 的 `[ANOMALY ...] observed:` 同一种表述，让模型把运行时收到的告知和示例里的模式对上。

**以下为插入 `.pi/SYSTEM.md` 的正文（单一来源，Phase F 执行时原样粘贴）：**

````markdown
### 1.5 口径推导示范

写 SQL 前按下面的结构推导。示例中的表与数据均为虚构。

**示例一：人群与共购**

问：2023 年 3 月买过《潮汐》的读者，还一起买得最多的是哪本书？

推导：
- 人群：`bookshop_sales` 中 2023-03 买过《潮汐》的 `DISTINCT reader_id`
- 度量与粒度：这些读者购买的其他书（`title <> '潮汐'`），按 `title` 求 `SUM(qty)`
- 输出合同：1 行，书名 + 总数量

```sql
WITH cohort AS (
  SELECT DISTINCT reader_id FROM bookshop_sales
  WHERE title = '潮汐' AND ordered_on BETWEEN '2023-03-01' AND '2023-03-31')
SELECT title, SUM(qty) AS total_qty FROM bookshop_sales
WHERE reader_id IN (SELECT reader_id FROM cohort) AND title <> '潮汐'
GROUP BY title ORDER BY total_qty DESC LIMIT 1;
```

**示例二：多级聚合**

问：用离门店 (lat 31.23, lng 121.47) 最近的气象站，比较 2022 年高温日与非高温日的日均客流。高温日：最高气温 > 35℃。文档：`temp_tenths` 单位为 0.1℃。

推导：
- 锚点：`weather_posts` 中距离最近的 1 个站
- 单位：`temp_tenths / 10.0 > 35`
- 聚合层级：Stage 1 客流按日 `COUNT(*)`；Stage 2 气温按日 `MAX(temp_tenths)` 得 `is_hot`；Stage 3 两者按日 JOIN 后 `AVG(daily_visits)` 按 `is_hot` 分组。**度量先在各自粒度聚合，再按键连接。**
- 输出合同：2 行（高温 / 非高温），日均客流

```sql
WITH post AS (
  SELECT post_id FROM weather_posts
  ORDER BY (lat-31.23)*(lat-31.23) + (lng-121.47)*(lng-121.47) LIMIT 1),
daily_temp AS (
  SELECT day, MAX(temp_tenths)/10.0 > 35 AS is_hot FROM temp_readings
  WHERE post_id = (SELECT post_id FROM post) AND day BETWEEN '2022-01-01' AND '2022-12-31'
  GROUP BY day),
daily_visits AS (
  SELECT date(entered_at) AS day, COUNT(*) AS n FROM footfall
  WHERE entered_at >= '2022-01-01' AND entered_at < '2023-01-01'
  GROUP BY date(entered_at))
SELECT t.is_hot, AVG(v.n) AS avg_daily_visits
FROM daily_visits v JOIN daily_temp t ON v.day = t.day
GROUP BY t.is_hot;
```

**示例三：观测到异常后重推导**

问：各课程最常用缴费方式的缴费次数。

初始推导：`course_signups JOIN tuition_payments ON learner_id`，`COUNT(*) GROUP BY course_code, pay_method`

观测：joined_rows=41200, tuition_payments=36800, course_signups=12400

重推导：一名学员报多门课时，每笔缴费被重复计入每门课。"缴费次数"的统计实体是 `tuition_payments` 的行，不是连接行。改为：Stage 1 在 `tuition_payments` 上按 `(learner_id, pay_method)` 计数；Stage 2 再 JOIN `course_signups` 取 `course_code`，每笔缴费在每门课程下只计一次。

未做的事：数据里有 `pay_method = 'UNKNOWN'`，题面没有要求排除，因此不加 `WHERE pay_method <> 'UNKNOWN'`；若认为应排除，把纳入与排除两种口径都算出来，在回复中声明。
````

写作约束（修改示例时保持）：

- 每个示例都有"输出合同"或统计实体的明确陈述，这是教学核心；
- E2 的 CTE 里没有任何不存在于 DDL 的便利列（不写 `WHERE year = 2022`）；
- E3 不给 SQL，只给推导，避免模型拷贝而非归纳；
- E3 的"观测:"行格式固定为 `key=value, key=value`，与 Phase 3 告知一致；
- 不出现 approve/正确/错误一类裁决词，只描述推导与选择。

#### F.4 执行状态与验收（第 2 版修订）

**第一轮未执行。** 证据：`.pi/SYSTEM.md` 无 §1.5；`round11-full-c3-001` 的 `systemPromptSha256`（`99e2563c…`）与当前文件相同；`C:/data-agent-eval/runs/` 下无任何 fewshot run。阶段 6 报告中的所有结论均不含 few-shot 效应。

**不得插入正在进行的 P6' 两个 arm。** `round11-full-002-hooks/control` 已开始运行且提示词 hash 仍为 `99e2563c…`；此时修改 SYSTEM.md 会污染 hooks-vs-control 对比。

**执行形态：P6' 的第三个 arm + 一次 10 题烟雾。**

| 步骤 | Run ID | 配置 | 目的 |
|---|---|---|---|
| F-smoke | `round11-fewshot-smoke-001` | 固定 10 题；hooks 全开 + SYSTEM.md §1.5；与 `p5` 同预算 | 确认提示词无破坏；度量首候选异常登记数（D1/D8）vs p5；不看准确率 |
| F-arm | `round11-full-002-fewshot` | 135 题；与 `002-hooks` 同日同配置同预算，仅 SYSTEM.md 多 §1.5 | 度量 few-shot 在 hooks 之上的边际效应 |

为什么是"hooks + fewshot"而不是"fewshot alone"：F.1 的假设是 few-shot 提供对告知的响应模式，它的价值必须在有告知的配置上测。三 arm（control / hooks / hooks+fewshot）同日并行，同时回答"Hook 有没有用"和"few-shot 在 Hook 之上有没有用"。

验收：

- F-smoke：首候选 D1/D8 登记数 ≤ p5；CSV 覆盖不低于 p5；不达则修示例或放弃，不进 F-arm；
- F-arm 主指标：`fewshot` arm E2E − `hooks` arm E2E ≥ 0；A 级检测器触发题集内，`fewshot` 得分 ≥ `hooks` 得分；
- F-arm 次指标：首候选 D1/D8 登记总数下降；多候选周期数不升；
- 模型漂移控制：三 arm 同日；manifest 自动记录三个不同的提示词 hash（control/hooks 相同，fewshot 不同）。

预期：对 F5/F4（034、037、029、025、010 及全量中同类）首候选质量中等概率改善；对 F1/F2 取决于 E3，未测；对 003/032/050 无影响。边际效应合理预期 +0 到 +3。

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

#### 3.1b 数据画像层（检测器 D3/D6/D9 的数据来源）

新文件 `packages/runtime/src/profile.ts`，方言 provider + 缓存。**不做成模型可调用的工具**，理由：模型可选工具依赖模型决定调用，回到提示遵循问题；且 local035/025 证明"看到"不是瓶颈。

| 层 | 时机 | 范围 | 内容 | 注入 |
|---|---|---|---|---|
| Schema Profile | `prepareTask`，缓存未命中时 | 全库 | 各表行数；主键/外键 distinct 数；键列 null 率；数值/地理列 min/max | **不注入**，只供检测器查 |
| Candidate Profile | `afterToolCall(query_database)` 判定为 candidate 后 | 仅 Digest 中出现在 `ORDER BY`、`MAX/MIN`、`AVG/MEDIAN`、距离/差值表达式的列 | min / max / null_rate / distinct / p99（采样） | 仅当检测器触发或该列是最终结果的排序/极值依据时，附在告知里 |

方言 provider：

| 方言 | 行数 | 分布 | 备注 |
|---|---|---|---|
| SQLite | `COUNT(*)` | 全扫 `MIN/MAX/COUNT(DISTINCT)`；p99 在 `ORDER BY ... LIMIT/OFFSET` 采样 | 评测库小，全扫可接受；仍受 200 万行上限 |
| PostgreSQL | `pg_class.reltuples` | `pg_stats`（`null_frac`、`n_distinct`、`histogram_bounds`） | 现成统计，零扫描 |
| MySQL | `information_schema.tables.table_rows` | 主键范围采样；**禁止** `ORDER BY RAND()` | 采样上限 `p99SampleRows` |

缓存键 `(schemaFingerprint, table, column)`，TTL 按库配置；生产库 Schema Profile 可在连接建立后作为后台任务预热。成本并入 §3.2 的探针预算；超限记 `inconclusive`，不告知。

#### 3.2 检测器清单（全部确定性，全部绑定 Spec 槽位）

| ID | 检测器 | 触发条件 | 绑定槽位 | 数据来源 | 第 9/10 轮命中 |
|---|---|---|---|---|---|
| D1 | join_fanout | 两条保守路径：①平坦查询保留原有 JOIN 行数探针；②对 CTE/子查询内显式 `COUNT(relation.key)`，Runtime 保留该查询块的 JOIN/过滤，对比连接后的 `COUNT(key)` 与 `COUNT(DISTINCT key)`，并先验证 key 在源关系全表中唯一；连接后才出现重复即登记。该路径不依赖最外层 Digest 能否展开 CTE | measure / grain | 有界计数探针（≤200 万行） | 034、037、029、local003 回归 |
| D2 | count_distinct_divergence（**Phase 6 后修订**） | 仅消费 D1 探针生成的 fanout/many_to_many 证据；`countValue > distinctCountValue` 时登记。无 JOIN、候选已使用 `COUNT(DISTINCT ...)`、或 key 在源关系本身不唯一时均 `not_applicable` | measure | D1 同一探针证据 | 032、034、037；**Phase 6 误触 34 题，净 −1** |
| D3 | entity_population_mismatch | Digest 的 FROM 事实表 distinct 外键数 ≠ 对应维度/实体表行数（孤儿键） | population | Schema Profile + 同快照探针 | 025 |
| D4 | unauthorized_filter | Digest 过滤节点的列/值不在 `[ANSWER_SPEC_READ_ONLY]` 的 `deriveRequestFilterConstraints` 结果中，且不是结构性谓词（JOIN 键相等、`IS NOT NULL`、`rn = 1`） | filter | Digest vs Spec | 061 |
| D5 | null_like_member_in_filter | 过滤或排除的维度成员名匹配 `NO PROMOTION / UNKNOWN / N\/A / NONE / OTHER` | filter | 数据观察 | 061 |
| D6 | physical_bound_violation | Candidate Profile 中参与排序/极值/均值的列出现 lat ∉ [−90,90]、lng ∉ [−180,180]、负数量/负金额，或 max 与 p99 差距超过 p99−p1 的 10 倍 | population | Candidate Profile | 035 |
| D7 | shape_mismatch | 候选行数/列数与 Spec 的 `output` 不符；多余列（不在题面名词映射内） | final_shape | Digest vs Spec | 010、025、029、035、037 |
| D8 | intermediate_candidate | Spec 要求聚合值（AVG/MEDIAN/COUNT）而 Digest 最外层无对应聚合 | final_shape | Digest vs Spec | 025 |
| D9 | cross_period_set_mismatch | 两个比较期的实体集合（按 Spec 的 time 槽位）不相等 | population | 同快照探针 | 050 |
| D10 | empty_after_filter | 候选 0 行，且 Digest 含 D4 命中的过滤 | filter | 结果 | 061 |
| D11 | fingerprint_unchanged | 新候选 `candidateSemanticFingerprint` 与已登记异常绑定槽位上的指纹一致 | 该槽位 | Digest | 003、010、034 |

每个检测器有独立开关；探针类（D1/D2/D3/D9）受单任务预算限制：最多 5 次探针、单次扫描行数上限 200 万（超限记 `inconclusive`，不告知）。

#### 3.2b 检测器分级（Phase 6 后新增）

Phase 6 证明“告知 + 多候选”的成本是 3–8 回合加一次把对的改错的机会（local049/078）。因此检测器按“能否结构性地证明候选错了”分级：

| 级 | 含义 | 检测器 | 动作 | Phase 6 证据 |
|---|---|---|---|---|
| **A** | 结构性可证明：触发即意味着候选在该槽位上几乎肯定不符合题面 | D1 join_fanout、D4 unauthorized_filter、D8 intermediate_candidate、D10 empty_after_filter | 告知 + 可触发解释枚举与多候选 | D1：4 命中 2 纠偏，0 误伤 |
| **B** | 统计性观察：可能是异常也可能是常态，模型需要知道但不应被迫重做 | D2、D3、D5、D6、D7、D9、D11 | 只告知；不触发枚举；D5/D6 的固定分叉（§4.2b）仍可注入但计入周期数 | D2：34 触发，净 −1，max_turns +12 |

升级规则：任何 B 级检测器要升 A 级，必须先在 135 题同配置 control 对照下证明：触发题净得分 ≥ 0，且触发题 max_turns 增量 ≤ 1。降级规则：A 级检测器任一轮触发题净得分 < 0 → 自动降 B。manifest 必须记录生效的分级集合。

#### 3.3 告知格式（附加进工具返回 content 末尾）

```text
[ANOMALY A-2 registered] join_fanout
  observed: joined_rows=117601, olist_order_payments=103886, olist_order_items=112650
  slot: measure
  status: unresolved
  note: 连接后行数超过任一侧事实表。当前 COUNT(*) 统计的是连接行，不是支付记录或订单。
```

带画像的告知（D6 触发时）：

```text
[ANOMALY A-4 registered] physical_bound_violation
  column: geolocation_lat  min=-33.75  p1=-30.12  p99=-2.51  max=45.07  null_rate=0  out_of_bounds_rows=17
  column: geolocation_lng  min=-73.98  p1=-67.80  p99=-34.90  max=121.11  null_rate=0  out_of_bounds_rows=9
  slot: population
  status: unresolved
  note: 这两列是当前候选最大距离的计算依据。
```

这就是"脏数据提醒"的唯一合法形态：具体到列、到行数、到分布，发生在该列被用作结论依据的时刻。不写"建议排除"——纳入/排除是 Phase 4 的解释分叉。

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

### Phase 4：`prepareNextTurnWithContext` 对抗性解释枚举与多候选（规模 M）

#### 4.0 为什么是"枚举器"而不是"红队 Reviewer"

裁决型 Reviewer 已失败两次（第 8 轮五次 Approved 全错；第 10 轮协议失败制造 `unavailable`）。把 prompt 从"评估"改成"攻击"，输出仍是 approve/reject，会失败第三次。LLM 擅长的是"给出候选没考虑的另一种读法"，不擅长"判定哪种读法对"。因此本阶段的 LLM 组件是**对抗性解释枚举器**：任务是找出候选漏掉的读法，没有 approve，所以没有假 approve；输出可校验；在新上下文运行，没有 Solver 的承诺偏差。

边界：它不写 SQL。两条候选由 Solver 写，Runtime 校验指纹不同。否则就是两个 Solver 没有仲裁。

#### 4.1 触发（Phase 6 后修订）

现状 `hooks/assurance-hooks.ts:137` 对 `anomalyRegistry.unresolved(taskId)` 中**任何**未注入记录都触发——这就是 D2 的 34 次触发全部变成多候选周期的直接原因。改为四个条件同时满足：

1. 异常来自 **A 级**检测器（`interpretations.triggerTiers`）；
2. 本题多候选周期数 < `maxCyclesPerTask`（默认 1）；
3. 剩余回合 ≥ `minRemainingTurns`（默认 6）且剩余工具调用 ≥ `minRemainingToolCalls`（默认 10）；不满足时不注入，在下一次工具返回里附一行 `[BUDGET] interpretation cycle skipped; export current candidate with disclosure`；
4. 本回合新登记（或 D11 命中 A 级异常的绑定槽位）。

成本与 A 级异常数成比例。Phase 6 下 A 级触发只有 4 + 少量 D4/D8/D10，预计周期数从 34 降到 ≤ 10。

#### 4.2 新上下文对抗性枚举

调用枚举器（独立 `completeSimple`，不带 Solver 对话；配置 `enumerator.model`，建议与 Solver 不同家族以去相关；缓存键 `(题面 hash, slot, detector)`），输入：题面、DDL 摘要、`[ANSWER_SPEC_READ_ONLY]`、候选 Digest、该异常的 `observed`（含画像）。JSON schema 强制输出：

```jsonc
{
  "slot": "measure",
  "implemented": { "id": "I0", "statement": "统计商品行×支付行连接数" },   // 由候选 Digest 反推，Runtime 校验与 Digest 一致
  "alternatives": [                                                          // 候选未实现的读法
    { "id": "I1", "statement": "统计支付记录数（order_payments 行）", "evidence": { "type": "question_span", "quote": "支付次数" } },
    { "id": "I2", "statement": "按订单去重后计数", "evidence": null }
  ]
}
```

Runtime 校验：`quote` 必须是题面真实子串，否则该条 `evidence` 置空；`alternatives.length ≥ 1`（加上 I0 ≥ 2 种读法），否则不注入；`I0` 与候选 Digest 在该槽位上一致，不一致则丢弃本次枚举（枚举器读错了候选）。

#### 4.2b 脏数据分叉（D5/D6 触发时的固定枚举）

D5（空值型成员）和 D6（物理越界）的解释分叉是固定的，不需要调用枚举器，Runtime 直接生成：

```text
[INTERPRETATIONS for A-4 / slot=population]
I0: 使用全部记录（当前候选） — evidence: 题面未提及排除
I1: 排除物理越界坐标（17 + 9 行） — evidence: none in question; physical constraint only
```

按 `dirtyDataAction` 配置分流：

| 配置 | 行为 | 适用 |
|---|---|---|
| `multi_candidate` | 注入上述分叉，要求两条候选，选择记入 Receipt | Spider2（无用户） |
| `ask_user` | 调用 `ask_user_clarification`："发现 17 条坐标超出物理范围，是否排除？"；用户回答进入 Spec 作为 Hard Constraint | 产品 |

同一个检测器、同一条告知，两种动作。这是"脏数据处理"在产品里的正确形态：由用户裁决，不由模型猜。

#### 4.3 注入消息

```text
[INTERPRETATIONS for A-2 / slot=measure]
I0 (current candidate): 统计商品行×支付行连接数 — evidence: none
I1: 统计支付记录数（order_payments 行） — evidence: question "支付次数"
I2: 按订单去重后计数 — evidence: none
Required: submit ONE additional candidate for the interpretation you consider best-supported, other than I0.
Digest must differ from I0 on slot=measure. Then export either I0 or the new candidate and state which interpretation it implements.
```

与 Phase 6 代码的差异：`hooks.ts:167` 现写的是 `submit one candidate per interpretation`——三条解释就要三条候选，这是回合膨胀的第二个来源。改为**只要一条备选**，且明确 I0 仍可导出，避免模型认为必须放弃当前候选。

#### 4.4 多候选校验与选择记录

- `afterToolCall(query_database)` 对后续候选计算 `candidateSemanticFingerprintForClaim(digest, slot)`，确认 ≥ 2 条指纹不同；不足则再次告知（最多一次）。
- 导出时，Receipt 记录 `chosenInterpretation`、`alternativessubagentIds`、`evidence`、`enumeratorModel`。这就是"决策-证据对"的最终形态：不带阻断权，但可审计。
- 离线指标：枚举器的 `alternatives` 中是否出现了 Gold 的读法（只在离线对照，Gold 不进运行时）。这是枚举器质量的直接度量，也是换模型家族的对比依据。
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

#### 第一轮结果（`round11-full-c3-001`）

| 指标 | 第 4 轮 | 第 11 轮 P6 | 判定 |
|---|---:|---:|---|
| E2E 固定分母 | 55/135 | 44/135 | **未通过** |
| CSV 交付 | 123 | 119 | 下降 |
| max_turns | 1 | 13 | 恶化 |
| timeout | 11 | 1 | 改善（`terminateAfterExport`） |
| 平均工具调用 / 时长 | 17.2 / 52.6 s | 20.8 / 89.7 s | 恶化 |
| 逆转题 → 挣回题 | — | 19 → 8 | 净 −11 |

逐题归因（阶段 6 报告 §4）：19 道逆转题中 8 道是工程故障（Phase 1c），11 道为语义逆转，其中只有 local049/078 能归因到 D2 误触，其余 9 道无法与 6 周模型漂移区分。挣回的 8 道中 2 道（local037/311）直接归因 D1，1 道（local026）归因 `terminateAfterExport`。

#### 第二轮要求（Phase 1c + 3' + 4' 完成后）

- **三个 arm 同日、同配置、同预算并行**：`round11-full-002-control`（`detectors.enabled=false`、`interpretationsOnAnomaly=false`，保留 `terminateAfterExport` 与 Phase 1c 修复）、`round11-full-002-hooks`（全开）、`round11-full-002-fewshot`（全开 + SYSTEM.md §1.5，见 Phase F.4）；
- 预算与第 4 轮对齐：确认第 4 轮 `manifest.limits`，三个 arm 均使用该预算；若第 4 轮 maxTurns > 20，不得用 20。**已知问题**：已开始的 `002-hooks/control` 使用 `timeoutMs: 120000`，而 `c3-001` 为 300000；第 4 轮在 120 s 下 timeout 11 题。若第 4 轮实际为 120 s，002 可继续；否则 002 作废，三 arm 以统一预算重开 `003`；
- 配置冻结（`freeze`），两个 arm 均 `--baseline`；
- 报告：固定分母 E2E、CSV 覆盖、分检测器触发题集与该集在两个 arm 的得分差、多候选周期数、预算跳过次数、timeout/max_turns、平均工具调用。

通过标准（主次分开）：

| 层级 | 标准 |
|---|---|
| 主 | `hooks` arm E2E ≥ `control` arm E2E，且 `hooks` arm max_turns 增量 ≤ 2 |
| 主 | 每个 A 级检测器的触发题集：hooks 得分 ≥ control 得分 |
| 主（few-shot） | `fewshot` arm E2E ≥ `hooks` arm E2E；不达则 few-shot 不进入默认提示词 |
| 次 | `control` arm E2E ≥ 55/135（证明拆除 + Phase 1c 后基础能力未退化；低于则先查模型漂移，用第 4 轮配置同日重跑一次） |
| 次 | CSV 覆盖 ≥ 123/135 |

不再单独以“≥ 55/135”作为主标准：与 6 周前的历史轮比较只能看趋势，归因必须靠同日 control。低于主标准则逐检测器关闭做归因，不整体回退。

### Phase 7 候选（不在本计划承诺内，各自需要独立设计）

| 候选 | 目的 | 为什么现在不做 |
|---|---|---|
| 导出前无触发枚举（`enumerator.trigger = on_anomaly_and_pre_export`） | 触及 local003 这类**没有任何检测器会触发**的先验缺口；是唯一可能碰到它的机制 | 每题多一次调用；伪备选会浪费轮次；完全未验证。先用离线指标"枚举列表是否出现 Gold 读法"在 replay 语料上测，再决定是否上线 |
| `transformContext` 修剪 Solver 推理 prose | 直接移除承诺偏差的载体 | tool_call/tool_result 配对风险；需单独设计替换策略 |
| Schema Profile 注入上下文 | 让模型在写第一条 SQL 前就看到孤儿键和行数 | 大 schema 上下文膨胀；先验证检测器路径是否已足够 |
| 题面→Spec 提取质量度量与提升 | 72 道顽固错题（第 4 轮延续率 90%）的唯一入口；先在 135 题上统计 `deriveRequestAnswerShape` / `deriveRequestFilterConstraints` 各槽位的非空率与与 Gold 形状的一致率（离线） | 这是一个独立的提取器工程，不是 Hook；需要先有度量再决定投入 |

---

## 6. 阶段指标总表

| 阶段 | 主指标 | 门槛 | 回退动作 |
|---|---|---|---|
| 1a | `not_published_review_unavailable` 数 | = 0 | 继续清阻断路径 |
| 1a | CSV 覆盖 | ≥ 4/10 | 同上 |
| 1b | 测试通过 + 交付指标持平 1a | — | 恢复被误删模块 |
| F | 首候选异常登记数（D1/D8）vs p1b | 下降 | 改写示例或放弃该 arm；不影响主线 |
| 2 | 导出后额外回合数 | → 0 | 检查 `terminate` 传播 |
| 3 | 异常后绑定槽位指纹变化率 | ≥ 50% | 检查告知是否进入 content、检测器是否触发 |
| 3 | Gold SQL 误报率 | ≤ 5% | 收紧对应检测器 |
| 3 | 画像探针超预算比例 | ≤ 10% | 收紧 Candidate Profile 列范围或降低采样 |
| 4 | ≥2 条不同指纹候选产出率 | ≥ 70% | 检查注入是否到达、schema 校验是否过严 |
| 4 | 枚举器 I0 与候选 Digest 一致率 | ≥ 90% | 枚举器读不懂候选，换模型或修输入 |
| 4 | 离线：alternatives 中出现 Gold 读法的比例 | 观察，不设门槛 | 作为换模型家族的对比依据 |
| 1c | `--resume` 识别首回合 provider 错误 | 5/5 | — |
| 1c | `not_published_review_unavailable` 出现次数 | = 0（枚举已删） | — |
| 1c | 发布路径 throw 逐条归类覆盖 | 100% | — |
| 3' | D2 触发题数（135 题） | ≤ 8（第一轮 34） | 收紧前置 |
| 3' | 每个 A 级检测器：触发题净得分 vs control | ≥ 0 | 降 B 级 |
| 4' | 多候选周期数 / 135 题 | ≤ 10（第一轮 34） | 检查分级与预算守卫 |
| 4' | 预算守卫跳过后仍交付的比例 | ≥ 90% | 检查跳过后的告知行 |
| 5 | 阻断仅两类 | 100% | — |
| 6 | hooks arm E2E − control arm E2E | ≥ 0 | 逐检测器关闭归因 |
| 6 | hooks arm max_turns 增量 | ≤ 2 | 收紧 `minRemainingTurns` |
| 6 | control arm E2E | ≥ 55/135 | 查模型漂移，同日重跑第 4 轮配置 |
| F-smoke | 首候选 D1/D8 登记数 vs p5 | ≤ | 修示例或放弃，不进 F-arm |
| F-arm | fewshot arm E2E − hooks arm E2E | ≥ 0 | few-shot 不进默认提示词 |
| F-arm | A 级触发题集内 fewshot vs hooks | ≥ | 同上 |

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
| Spider2 与产品政策分歧 | 产品 `delivery: fail_closed` 作为显式可选项；默认与 Spider2 一致，避免两套行为；脏数据动作由 `dirtyDataAction` 分流，检测器与告知共用 |
| 画像在生产大表上成本高 | Schema Profile 后台预热 + 缓存；Candidate Profile 只画 Digest 引用的结论依据列；PG 用 `pg_stats` 零扫描；MySQL 主键范围采样；p99 只在采样上算 |
| 画像告知诱发未授权过滤（模型看到越界值就加 WHERE） | 告知不写"建议排除"；D4 会对新增过滤再次登记；E3 示例以反例形式演示；纳入/排除必须两条候选都算 |
| 枚举器退化为裁决器（输出里出现"推荐 I1"一类判断） | JSON schema 不提供任何 preference/verdict 字段；注入消息只列读法和引用；发现则视为 bug |
| Few-shot 示例泄露测试集 | 虚构化 + README 登记 `promptDerivedFromInstances`；云端评测固定排除 ga001/bq051；示例不得使用当前 135 题所属库的表名 |
| 枚举器与 Solver 同模型导致错误相关 | `enumerator.model` 可配不同家族；单次结构化调用不受第 6 轮多轮延迟问题影响；离线指标对比 |
| **（Phase 6 实发）**检测器过度触发把对的改错 | 检测器分级（§3.2b）；B 级只告知；升级需同配置 control 证明净得分 ≥ 0；注入消息明确 I0 仍可导出 |
| **（Phase 6 实发）**多候选周期把题推进 max_turns | `maxCyclesPerTask=1`；`minRemainingTurns/ToolCalls` 预算守卫；只要求一条备选而非每解释一条 |
| **（Phase 6 实发）**Runner 把 provider 错误记为 completed，逃过 `--resume` | Phase 1c.1 硬规则 + 单测；任何 0 工程调用的 completed 在报告中单列为可疑 |
| **（Phase 6 实发）**发布状态标签把“未导出”和“被拒”混为一谈，掩盖真实原因 | Phase 1c.2 新标签集；删除 `not_published_review_unavailable` 枚举 |
| **（Phase 6 实发）**与历史轮比较无法区分机制效应与模型漂移 | 全量阶段必须带同日同配置 control arm；主标准改为 hooks vs control |

---

## 8. 文档与 ADR 变更

1. 新增 `docs/adr/0003-detect-inform-never-block.md`（status: accepted），内容：
   - 确定性检测器保留，动作默认为告知；
   - `unavailable` 不阻断交付；
   - 硬阻断仅限完整性与必然 0 分形状；
   - 取代 ADR-0002 中"无已校准版本时 fail-closed"与门默认阻断权；ADR-0002 其余（`not_applicable` 与 `unsupported` 区分、Digest 由固定版本 parser 生成）继续有效。
2. `docs/Spider2语义收敛方案-证据资格与确定性门控.md` 顶部加 `状态：superseded by 第11轮修复计划`。
3. `CONTEXT.md` 新增术语：Anomaly Record、Interpretation、Disclosure；`Query Assurance` 定义改为"准备语义证据、检出并告知异常、记录解释选择、按完整性规则发布"。
4. `evaluations/spider2/README.md` 更新配置 schema（`profile`、`enumerator`、`dirtyDataAction`、`detectors.tierA/tierB`、`interpretations.*`）与新增指标字段；新增 `promptDerivedFromInstances: [ga001, bq051]` 登记与云端评测排除规则；发布状态标签集改为 Phase 1c.2 定义；全量阶段报告模板必须含 control arm 列。
4b. `docs/Spider2与Query Assurance测评转交文档.md` §0.2 总表补充第 9、10、11-P6 三行；§9 常见误判新增“0 工具调用的 completed”与“`not_published_review_unavailable` 不等于被拒”两条。
5. `.pi/SYSTEM.md` 按 Phase 1b 表修改；Phase F 新增 §1.5 三个虚构示例（约 600 token），其余部分不增加。
6. `CONTEXT.md` 补充术语：Schema Profile、Candidate Profile、Interpretation Enumerator（明确"无裁决权"）。

---

## 9. 明确不做

- 不新增 task 工具或 read 侧状态机。
- 不让 read 提交 Digest、Probe 或 Spec 修改。
- 不在运行时调用 Reviewer；不把 Reviewer 结论作为交付条件。
- 不为单题把 Gold 值、字段名或口径写入 Prompt、Skill、文档或检测器。
- 不使用 `transformContext` 修剪模型推理（列为后续独立设计）。
- 不在 Phase 6 之前修改 135 题基线配置。
- 不让任何 B 级检测器触发多候选；不在没有同配置 control 证据的情况下升级检测器。
- 不再以历史轮（第 4 轮）作为机制效应的归因依据；它只是趋势参考。
- 不在 Phase 1c 完成前重跑全量。

---

## 10. 执行顺序速查

```text
P0  分支 + WIP 归类 + replay 语料           → 构建通过
P1a 止血：unavailable 不阻断                → 10 题交付恢复（CSV ≥ 4, unavailable = 0）
P1b 拆除：删死代码、改提示词 4 处            → 测试通过、交付持平
PF  虚构 few-shot（独立 arm，可与 P2 并行）  → 首候选 D1/D8 下降
P2  Hook 骨架：terminate + 审计              → 导出后不再空转
P3  afterToolCall 告知 + 画像层 + D1–D11     → 指纹变化率 ≥ 50%，Gold 误报 ≤ 5%
P4  prepareNextTurn 对抗性枚举 + 多候选 + 脏数据分叉 → ≥2 候选率 ≥ 70%，I0 一致 ≥ 90%
P5  beforeToolCall 两种硬阻断                → 只此两类
P6  135 题全量（第一轮）                    → 44/135，未通过；逐题归因见阶段 6 报告

—— 第 2 版修订后的续行顺序 ——
P1c Runner provider 错误状态 + 发布路径残留 throw + 标签集  → --resume 识别 5/5；review_unavailable 枚举删除
P3' D2 加 JOIN 前置、删回退路径；检测器分 A/B 级        → D2 触发 ≤ 8/135；manifest 记录分级
P4' 只 A 级触发；maxCyclesPerTask=1；预算守卫；只要一条备选 → 周期数 ≤ 10/135
PF' F-smoke：10 题 hooks + §1.5，对照 p5            → 首候选 D1/D8 ≤ p5；不达则不进 F-arm
P6' 同日同配置三 arm（control / hooks / hooks+fewshot），预算对齐第 4 轮
                                              → hooks ≥ control；fewshot ≥ hooks；control ≥ 55；max_turns 增量 ≤ 2
```

注：Phase F 在第一轮从未执行（提示词 hash 与全量运行相同，无 fewshot run）；第 2 版把它安排为 P6' 的第三个 arm，而不是插在前面，因为它的假设是"在告知之上提供响应模式"，必须在 hooks 开启的配置上测边际效应；且正在进行的 002 双 arm 不能被提示词变更污染。

预期：Phase 1c 单独可追回约 8 题（阶段 6 报告估计 52/135）；P3'/P4' 消除 D2 误触可追回 local049/078 并降低 max_turns；D1 的 2 题收益保留。合理预期是 hooks arm 在 55–58 之间，与 control 差距在 +1 到 +3；fewshot 在 hooks 之上 +0 到 +3。**72 道顽固错题不在本计划任何阶段的预期内**；它们需要题面→Spec 的提取质量（Phase 7 候选），不是更多 Hook。

每一步一个 Run ID，一份阶段报告，一次 A/B。任何一步不达门槛，停在该步归因，不带着问题进下一步。
