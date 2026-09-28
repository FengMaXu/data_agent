# Answer Plan Phase 2：解释选择与离线 Tie-Breaker 验收记录

日期：2026-09-08

## 结论

Phase 2 的 Decision/Alternative 状态模型、三种策略、离线确定性选择、SQL/Artifact/Candidate/Receipt 绑定、真实 SQLite 业务 fixture、固定分母机制评测和 Runner 唯一分支提取均已实现。阶段关闭以最终独立复核无阻塞 finding 为前提；实时 Smoke 观测仍为 Correct Set 0/10，不能声称语义准确率改善，继续进入 Phase 6 的最终效果门槛。

## 2026-09-11 后续加固

local061 Trace 证明 v1 可在两个 material population alternatives 的自报向量相同、无权威证据时由稳定排序选回旧口径。当前写协议已升级为：

- `decision-normalization-v2` / `literal-minimum-assumption-v2` / `literal-defaults-v2`；
- 模型提交 `affectedAspects`、`assumptionProfile` 与 `assumptionVector`，Runtime 从规范化假设 ID 列表派生计数并拒绝不一致或非法数值；
- exploration Artifact 显式返回 Runtime 已登记的 `observationEvidenceId`，可被 Decision 引用，但 `observed_data` 不获得业务定义支持权；
- material population 在权威支持、最小假设和冻结默认后仍平局时，stable-order 只排序、不选择，Decision 保持 `pending_clarification`，result/publication 均不能由该平局关闭。

下文 v1 内容保留为当时阶段冻结记录，不代表当前运行版本。

## 冻结协议

- 计划协议：`evidence-plan-v2`；持久化 schema：`data-agent.answer-session@3`。
- Decision policy：`interactive-clarify-v1`、`literal-with-disclosure-v1`、`strict-resolved-only-v1`。
- 离线选择：`literal-minimum-assumption-v1`。
- 候选规范化：`decision-normalization-v1`。
- 通用默认：`literal-defaults-v1`。
- Receipt 同时记录任务 delivery/decision policy、每个 Decision 的实际 selection policy、输入 hash、规范化版本、未选分支及 default/stable fallback 标记；零 Decision 使用 `not-applicable-v1`，但仍记录任务策略。

## 实现证据

- `packages/runtime/src/decision-selection.ts`
  - 展示 ID/输入位置不参与规范身份；规范内容 hash 生成 Alternative ID，去重并稳定排序。
  - 顺序：合格反证排除 → 唯一适用权威支持 → 冻结额外假设向量 → 字段受限通用默认 → 规范内容稳定排序。
  - Verification 保留 `supported/refuted` 极性和 claim 绑定；观察值、schema presence、model inference 不升格业务支持。
  - 未解决权威冲突保持 `pending_clarification`，不进入最少假设兜底；全候选被反证时为 `no_eligible_alternative`。
  - 第 3–4 步选择始终为 `provisional_literal/provisional_unresolved`，未选项只披露、不标记 refuted。
- `packages/runtime/src/query-assurance.ts`
  - Decision 纳入 Spec hash；引用必须是任务/当前 revision 可用的 Claim/Evidence。
  - interactive/strict 拒绝调用方伪造已选择状态；Host clarification event 是用户选择的唯一可信入口。
  - `convergeCandidate` 在计量和 `executeResult` 前统一检查 conflict/no-eligible/策略未决；直接 `recordPreview` 走相同检查。
  - Result Artifact 和 Export Candidate 必须精确匹配 `selectedDecisionRefs` 与 selection input hashes；选择变化使旧 Artifact 失效。
- `packages/runtime/src/agent-assembly.ts`
  - Runtime 从任务级 Trusted Evidence 与 Verification 构造资格输入，不再固定传空证据。
  - 无澄清能力默认 literal-with-disclosure；显式 interactive 下，重要未决在结果 SQL 前返回 `DECISION_CLARIFICATION_REQUIRED`。
- `packages/runtime/src/publication.ts`、`export-candidate.ts`
  - Receipt/Candidate 保存选定分支、未选分支和策略回放元数据。
- `evaluations/spider2/lib.mjs`
  - `selectFinalSql` 只接受唯一成功交付；拒绝多个成功 Receipt、Artifact/Receipt Decision binding 缺失或错配，不按调用/文件顺序择优。
  - 失败的后续导出不遮蔽唯一合法交付。
- `evaluations/spider2/run.mjs`
  - 同时从显式 `export_query` 和 `query_database(deliverIfEligible=true)` 组合发布读取已发布 CSV 路径。

## Phase 2 验收逐项

| 验收项 | 状态 | 可核查证据 |
|---|---|---|
| 互斥选项不能同时选；不存在/被替换选项拒绝 | 通过 | `decision-selection.test.ts`、`query-assurance.test.ts` Decision binding cases |
| 未采用不标 refuted；临时采用不变 confirmed | 通过 | `decision-selection.test.ts` provisional/unselected assertions |
| SQL 绑定 revision/选项；改选使旧候选失效 | 通过 | `query-assurance.test.ts` exact refs + stale hash |
| 五类重要交互歧义进入澄清；取消/超时不确认 | 通过 | `query-assurance.test.ts` 参数化 weighting/tax/freight/time/NTILE；cancel/expire fixtures |
| 澄清工具不可用行为明确 | 通过 | `agent-assembly.test.ts` no-guessing fallback、capability omission；无工具时默认 literal policy |
| 无交互均记录 provisional/unresolved、无自我确认 | 通过 | `decision-scenarios.test.ts` 6 cases；`decision-e2e.test.ts` |
| 零 Decision 请求正常交付且 Receipt 冻结策略 | 通过 | `query-assurance.test.ts` 三策略参数化 Receipt |
| 固定输入、排列/展示 ID 变化结果一致且版本可回放 | 通过 | `decision-selection.test.ts`；持久化恢复 test |
| 运费、客户权重、税、时间、NTILE fixture 记录选项/理由 | 通过 | `decision-scenarios.test.ts`、`decision-e2e.test.ts` |
| fixture 执行真实 SQL 并只发布选定 CSV | 通过 | `decision-e2e.test.ts` 的 in-memory SQLite 小表，5/5 Spec→Artifact→Candidate→Receipt→CSV |
| conflict/no-eligible 不执行 result SQL | 通过 | `query-assurance.test.ts` fast-path executeResult 调用数与 DB ledger 均为 0 |
| 评分提取只交付唯一匹配分支；无可用解释留分母 | 通过 | `lib.test.mjs` 多 Receipt/缺失/错 binding 负例；holdout no-eligible case |
| 选择器无 Gold/score/case ID；统计 fallback/留出准确率 | 通过 | `decision-selection-eval.mjs` 只传 `{decision,evidence}`；`phase2-decision-selection-eval.json` |
| 通过共同回归门槛 | 通过（实时退化已留证） | 下述确定性回放与单次 Smoke；确定性组合 CSV 提取故障已修复并测试 |

## 机制留出评测

冻结输入：`evaluations/spider2/decision-selection-holdout.json`。报告：`phase2-decision-selection-eval.json`。

- 固定分母 6；预期选择/失败状态 6/6。
- 选定并可提交 5；no-eligible 1，保留在分母。
- 未选分支披露完整 6/6。
- frozen-default fallback 0/6；stable-order fallback 0/6。两条路径另由选择器定向 fixture 覆盖。

该小集合只验收冻结机制，不是自然语言歧义发现召回或 Spider2 语义准确率证明。

## 确定性回归

Phase 2 相关文件内容清单 SHA-256：`34a38dfcc18deca5aabd7655f4f3d36785979879715d0ea82330a6cb0923317f`（按排序路径名、NUL、文件 bytes、NUL 串联；清单为本记录“实现证据”所列 Runtime/Runner/评测源和评测 JSON，不包含本文，避免自引用）。当前工作区基准 commit：`0117a658f4a2401d304a68d71162f7c8980e4ea0`。

最终候选代码执行：

- Runtime：56 files，374 passed，1 skipped。
- Server：5 files，16 passed。
- Electron：2 files，9 passed。
- Spider/evaluator harness：42 passed。
- Contracts、Runtime、Server、Electron build：通过。
- `git diff --check`：仅工作区既有 CRLF 提示，无 whitespace error。

## 实时 Smoke 与 B1 对比

冻结配置：`round8-shadow10-ids.txt`、DeepSeek profile、20 turns、50 tool calls、最多 6 次探索、300 秒、concurrency 3。正式单次运行：`C:/data-agent-eval/runs/answer-plan-phase2-final-shadow10-001`，不逐题重跑。

观测：

- 状态：8 completed、2 max_turns（local025、local050）。
- 运行时获得 8 个合法 publication receipts；原始 Runner 提取 Delivered 6/10，Correct 0/10。
- local034/local035 的组合发布 Receipt 含真实 `targetPath/relativePath`，但当时 Runner 只从显式 `export_query` 复制 CSV，故漏提取 2 题。该确定性故障已修复为从组合发布提取路径，并添加 harness 回放；不修改原运行、不用重跑覆盖原观测。按最终提取器可确定恢复的集合为 8/10，但阶段记录仍保留原始 6/10。
- 平均时长 123713 ms；平均工具调用 24.7。相对 B1 的 106651 ms / 22.1，约 +16.0% / +11.8%；相对 Phase 1 单次 145927 ms / 25.6 有下降。成本和超时最终仍由 Phase 6 门槛裁定。
- Correct Set 仍为空；Phase 2 只关闭选择与身份机制，未证明业务准确率收益。

## 独立复核

- 首轮：发现证据未进入选择、Receipt 策略版本错误、interactive/strict 可伪造选择、frozen defaults 缺失、业务 fixture 非端到端、冲突降格；全部整改。
- 二轮：发现冲突仍自动兜底、Verification 极性丢失、零 Decision Receipt 无策略、fixture 使用常量 SQL、评测指标缺失；全部整改。
- 三轮：发现 fast-path 先执行后阻断、Runner 未强制唯一 Decision 交付、交互矩阵/关闭记录不完整；全部整改。
- 最终复核链：`5ec1e411-7849-4a39-b3ea-163af2d730ea` → `abbb873e-76b0-4e5d-a2c4-07eab2be790b` → 修复确认 run `7748818b-b35f-4f25-ae08-a31c86c0918c`。
- 最终结论：`No issues found`，`Merge verdict: OK`；复核未独立执行 shell，命令结果由主会话提供并由 reviewer attested。

## 残余风险与后续约束

1. 人工 6-case 只是机制留出集；不同模型候选生成差异和自然问题歧义召回不在 Phase 2 的 100% 声明内，Phase 6 必须测量。
2. 同义 alternative 的通用语义去重仍是已披露限制；不引入通用语义解析器。
3. 实时 Smoke Correct Set 0/10，且有 2 个 max_turns；不得把 6/6 机制 fixture 包装成业务效果。
4. Phase 3 修改 Receipt/Disclosure/DeliveryEnvelope 后必须重跑本阶段 Artifact/Candidate/Receipt、唯一提取和三策略零 Decision 回放。
