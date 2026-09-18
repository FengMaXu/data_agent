# Answer Plan Phase 1：证据与可信状态所有权验收记录

日期：2026-09-08

## 结论

Phase 1 的 Runtime 实现、确定性协议回放、Host/Runner 合同和独立代码复核已经完成。实时 Smoke 的所有尝试均保留；最终单次运行观测到 7/10 严格可提取交付，低于 B1 的 10/10。其中两题在冻结 20 turns 内未完成，一题已经获得合法 Receipt、但旧 Runner 在后续错误导出后没有提取先前组合发布。后者已用确定性测试修复；不通过反复重跑覆盖该观测。

Phase 1 代码合同关闭。实时模型波动及最终修复后的累计 Smoke 继续作为下一阶段共同回归输入，不把本阶段的审计完整性包装成准确率改善。

## 实现与证据

### Runtime 所有权

- `packages/runtime/src/answer-session.ts`
  - 任务级冻结 `protocolVersion`、tool/prompt/Host/Runner 版本。
  - Runtime 所有的 `TrustedEvidenceRecord`、`ClaimRecord`、`VerificationRecord`、hypothesis→claim 映射、Usage Ledger、fast-path checkpoint。
  - Evidence 与 Verification 按 task 复合键隔离；跨任务 ID 复用不会共享内容或可信状态。
  - `user_confirmed` 仅由准确绑定 task/baseRevision/hypothesis 的 Host clarification event 产生，并只投影到新 revision。
- `packages/runtime/src/answer-spec.ts`
  - 旧 `TrustedEvidenceStore/submitProposal` 同样改为 `get(taskId,evidenceId)`；旧 adapter 不再允许跨任务证据引用。
  - Planner 的 request-wording 结构化值必须同时引用准确题面 quote；未引用的字符串、数字或布尔值降为 hypothesis。
- `packages/runtime/src/clarification.ts`
  - Host 事件一次性消费，并校验 task、base revision 和 hypothesis。
- `packages/runtime/src/query-assurance.ts`
  - 新协议拒绝 Solver 自报 trusted status；旧协议写入与 v2 写入不能在同一任务混用。
  - `beginPlan` 与 `convergeCandidate` 组合路径、revision/hash 校验、阶段 checkpoint、稳定阶段幂等键。
  - Host DB executor 当前明确为只读 at-least-once；崩溃恢复中的每个物理执行尝试分别记账，不冒充跨进程 exactly-once。
  - exploration 预算在 revision 已提交后耗尽时返回显式 warning，不再抛错导致 Agent 持有旧 specVersion。

### 持久化与安全

- `packages/runtime/src/query-assurance-store.ts`
  - schemaVersion 2 JSONL journal、链式 SHA-256；产品状态使用随机 sidecar key 的 HMAC-SHA256。
  - HMAC→普通 hash 降级默认拒绝。旧 hash migration 只有 Host 显式设置 `allowLegacyStateMigration` 才启用；Electron 仅响应一次性环境变量 `DATA_AGENT_ALLOW_LEGACY_ASSURANCE_MIGRATION=1`。
  - migration 后立即重写为单条 HMAC 记录。
  - 只在已有完整记录且文件末尾没有换行时忽略最后一条截断记录；此前所有记录仍需通过链和 MAC 校验。
  - 持久化 TaskEvidence 使用字段白名单，不保存原始结果行或文档正文；常见裸 provider token、标签凭据和 URL basic-auth 均过滤或拒绝。

### 预算与组合路径

- 模型工具调用与串行往返只在 `agent-assembly` 的模型工具边界记一次。
- coordinator 只记录其内部真实 database/probe 尝试，避免同一次组合调用重复计算模型往返。
- `maxToolCalls` 只在 Host 提供时进入任务账本。Spider Runner 传播原有冻结评测预算；Electron 产品入口不提供该上限。
- evaluation Host 使用 `forceCsvDelivery=true`；产品仍保持 ≤10 行内联、>10 行 CSV 的默认行为。
- Runner 的 `selectFinalSql` 支持从带精确 Receipt 的 `query_database(deliverIfEligible=true)` 组合发布提取唯一最终 SQL。
- publication terminator 识别组合发布，避免合法 Receipt 后继续执行并被后续失败调用遮蔽。

## Phase 1 验收逐项

| 验收项 | 状态 | 证据 |
|---|---|---|
| 自报确认、伪造 evidenceId、跨任务、旧 revision/hash 不能升级 | 通过 | `answer-session.test.ts`、`answer-spec.test.ts`、`query-assurance.test.ts` |
| observed enum 只支持物理存在，不建立业务映射 | 通过 | `answer-session.test.ts` semantic_assessment fixture |
| 真实澄清绑定准确 claim 并生成新 revision | 通过 | `clarification.test.ts`、`query-assurance.test.ts` |
| substring/high confidence/semantic supported 不能建 Hard Constraint | 通过 | `answer-spec.test.ts`、`answer-session.test.ts` |
| 恢复后证据、版本、核查关系保持且无凭据泄露 | 通过 | `query-assurance-store.test.ts`、`query-assurance.test.ts`、`answer-session.test.ts` |
| Interface 正负例和状态迁移 | 通过 | Runtime 全量 331 tests 中的 Phase 1 fixture |
| 简单 fixture 无额外必需模型往返；故障点可恢复 | 通过 | `agent-assembly.test.ts` 组合路径；`query-assurance.test.ts` evaluator/delivery/执行后无 Artifact 恢复 |
| 探索/探针记账且预算耗尽不循环 | 通过 | `answer-session.test.ts`、`query-assurance.test.ts`、`agent-assembly.test.ts` |
| 新旧 Host/Runner 协议合同及任务级隔离 | 通过 | Runtime、Server、Electron、Spider harness 回归 |

## 确定性回归

最终候选代码执行：

- Runtime build：通过。
- Runtime：53 files，331 passed，1 skipped。
- Server build：通过；5 files，16 passed。
- Electron build：通过；2 files，9 passed。
- Spider harness + baseline report：30 passed。
- `git diff --check`：通过，仅有工作区既存 CRLF 提示。

独立复核：

- 首轮发现 usage 重复计量、at-least-once 恢复计量、截断尾、HMAC 自动迁移及裸 token 问题，已修复。
- 二轮结论：`Merge verdict: OK with notes`。
- 最终复核发现旧 TrustedEvidenceStore 跨任务隔离遗漏，已修复。
- 修复复核结论：`Merge verdict: OK`（run `b9470903-7ed7-4e5a-acb2-c0f8096f2286`）。

## 实时 Smoke 与 B1 对比

冻结配置：`round8-shadow10-ids.txt`、DeepSeek profile、20 turns、50 tool calls、最多 6 次探索、300 秒、concurrency 3。

B1：

- Delivered Set 10/10；Correct Set 0/10。
- 平均时长 106651 ms；平均工具调用 22.1。

保留尝试：

- `answer-plan-phase1-shadow10-001`：初次 9/10；恢复暴露跨 task Evidence ID 冲突，修复后该运行达到 10 个合法发布。该运行跨越代码修复，不作为最终同构建结果。
- `answer-plan-phase1-shadow10-002`：暴露小结果组合发布走 inline、Runner 不识别组合 Receipt 的问题；保留，不作为最终结果。
- `answer-plan-phase1-shadow10-003`：执行期间命令中断并有多次恢复；用于定位组合发布后的终止问题，不作为最终结果。
- 最终单次、不重跑失败题：`C:/data-agent-eval/runs/answer-plan-phase1-final-shadow10-004`。
  - 运行摘要：8 个 published receipt，2 个 max_turns；平均时长 145927 ms，平均工具调用 25.6。
  - 严格评分提取：Delivered 7/10，Correct 0/10。
  - `local010`、`local034`：冻结 turn budget 内未发布。
  - `local050`：已经发布合法 Receipt，但旧 terminator 允许继续调用，后续失败 export 遮蔽评分提取；最终代码已增加组合发布终止与回放测试。

解释：Correct Set 未退化但仍为空；不能声称语义收益。实时工具调用和时长高于 B1，分别约 +15.8% 和 +36.8%，进入 Phase 6 成本门槛；Phase 1 不通过择优重跑掩盖该事实。确定性发布合同没有回退，实时模型交付波动已逐题留证。

## 残余风险与后续约束

1. 当前 DB Host 没有跨进程执行去重合同，因此恢复语义是只读 at-least-once；所有实际尝试必须继续计量。
2. Phase 2 以后任何修改若触及 revision、Evidence、Receipt 或组合发布，必须重新运行本记录中的定向回放。
3. 下一次阶段性 Smoke 必须使用当时冻结的单一代码状态，只运行一次正式样本；失败不逐题刷测。
4. Phase 6 必须改善或满足预冻结的全量正确率、成本和超时门槛；当前 10 题 Correct Set 为空不能用于宣称完成最终目标。
