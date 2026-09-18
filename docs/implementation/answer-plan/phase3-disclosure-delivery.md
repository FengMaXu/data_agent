# Answer Plan Phase 3：统一披露与交付验收记录

日期：2026-09-08

## 结论

Phase 3 的统一 `DisclosureRecord`、`DeliveryEnvelope`、Receipt 强绑定、CSV/inline × Server/Electron 四组合、故障恢复与幂等交付合同已经实现并通过确定性回放。候选存在但没有 anomaly 时仍会披露临时口径；不可用或不确定的核查不会被表述为“全部通过”。CSV 只包含答案数据，披露位于独立 JSON 附件。

实时固定十题 Smoke 的单次观测为 Delivered 8/10、Correct 1/10；两题达到 `max_turns`。这不是业务正确率达标声明，正确率、覆盖、成本和超时的最终门槛继续由 Phase 6 裁定。

## 冻结协议与实现

- 计划协议：`evidence-plan-v2`；任务会话 schema：`data-agent.answer-session@3`；Query Assurance durable state：schema 4。
- 披露策略：`disclosure-policy-v1`；统一交付对象：`DeliveryEnvelope`。
- `packages/runtime/src/disclosure.ts`
  - 仅从当前 Spec/Decision/Verification/review 状态生成规范化披露。
  - 披露未确认解释、未采用分支、检测 unavailable/inconclusive 和数据 snapshot/drift 状态。
- `packages/runtime/src/publication.ts`
  - Receipt 绑定 `disclosureHash`、policy、plan/spec/candidate/content identity、Decision binding 和 DeliveryEnvelope。
  - v2 Receipt 只进入 historical 索引，不被当作当前任务的完整发布。
- `packages/runtime/src/query-assurance.ts`、`query-assurance-store.ts`
  - schema 4 durable pending transaction 在外部发布前落盘，冻结完整 Candidate、ReviewToken、target、delivery surface 与 disclosure metadata。
  - pending 状态不对外显示为发布完成；恢复只能重放完全相同的冻结事务。
- `packages/runtime/src/export-candidate.ts`、`workspace.ts`
  - promotion 复制 immutable staging bytes；Receipt 最终持久化前不删除 staging。
  - staging 缺失时仅在现有目标文件 SHA-256 与 Candidate 内容 hash 精确一致时允许幂等恢复。
- `packages/runtime/src/agent-assembly.ts`
  - CSV 结果重执行不继承 preview snapshot；无 snapshot 时明确披露重执行时间和漂移风险。
  - CSV sidecar 与 inline 首次、已有 Receipt、fast-path resumed 使用同一披露/Envelope 规则。
  - 进程恢复直接重放持久化 Candidate，不重新执行可能已变化的数据库查询。
- `evaluations/spider2/lib.mjs`、`lib.test.mjs`
  - Runner 仍要求精确 Receipt/Artifact 关联；四种真实 `buildAgentTools` 组合共享合同。
  - Sidecar 实际字节 hash、幂等重试、CSV drift/inline snapshot、真实 Host 崩溃恢复均有回放。

## Phase 3 验收逐项

| 验收项 | 状态 | 可核查证据 |
|---|---|---|
| candidate 存在且 anomaly=0 仍显示未确认口径 | 通过 | `disclosure.test.ts`；`lib.test.mjs` 四组合 fixture |
| unavailable/inconclusive 不显示“全部通过” | 通过 | `disclosure.test.ts` verification 状态矩阵 |
| CSV 与 inline 均直接显示或提供披露访问 | 通过 | `agent-assembly.ts` inline renderer/CSV sidecar；`lib.test.mjs` 四组合及重试断言 |
| 跨候选、旧 revision/spec、内容/disclosure hash 错配拒绝 | 通过 | `query-assurance.test.ts` Phase-3 identity 负例；`lib.test.mjs` sidecar raw-byte hash |
| 数据成功、披露或最终状态持久化失败不产生完整 Receipt；重试一致 | 通过 | `query-assurance.test.ts` fault injection；`lib.test.mjs` real Host recovery |
| 导出成功立即停止时无需模型补充 | 通过 | DeliveryEnvelope/sidecar 由 Runtime 生成；四组合首次结果直接包含完整披露 |
| Server/Electron × CSV/inline 共四组合 | 通过 | `lib.test.mjs` 真实 `buildAgentTools` 参数化 4/4，并验证幂等重试 |
| Spider2 CSV 仅答案数据，披露独立且提取器仍验证精确 Receipt | 通过 | 四组合读取 CSV 与 `.disclosure.json`；`selectFinalSql`/`publishedCsvPath` 回放 |
| Fast-Path 自动披露，无额外必需模型往返 | 通过 | `agent-assembly.ts` existing/fast-path renderer；四组合第二次调用 Receipt 相同 |
| 共同回归门槛 | 通过（效果风险保留至 Phase 6） | 下述全量确定性回归和固定十题单次 Smoke |

## 故障与恢复矩阵

- 披露写入失败：data promotion 为 0、Receipt 为 0；修复后重试只发布一次。
- Receipt 最终持久化失败：pending 保持未完成；重启后使用 immutable staged bytes 完成原事务。
- 重启前数据库从 1 变化到 2：恢复不重新执行 SQL，公开 CSV 仍为原候选值 1。
- staging 被删除且目标被篡改：目标 SHA-256 不匹配，恢复失败并保持 pending。
- pending 中替换 Candidate、ReviewToken、delivery surface 或 disclosure metadata：`PUBLICATION_PENDING_IDENTITY_CONFLICT`。
- sidecar 写入内容 hash 与返回 hash 不一致、引用其他 Candidate/revision/spec/content：拒绝发布。

## 确定性回归

当前工作区基准 commit：`0117a658f4a2401d304a68d71162f7c8980e4ea0`。

Phase 3 相关源文件内容清单 SHA-256：`e337a34c00bf7e38d169839eb91fa5da285c9e73151707a02c59701d17dd426e`。计算方式：按排序路径名、NUL、文件 bytes、NUL 串联；清单包括 disclosure/publication/query-assurance/store/export-candidate/agent-assembly/workspace 和 Spider Runner 的实现及测试，不包含本文以避免自引用。

可复现命令与最终候选输出：

```bash
npm test --workspace=@data-agent/runtime -- --run
# 57 files passed; 386 passed, 1 skipped

npm test --workspace=@data-agent/server -- --run
# 5 files passed; 16 passed
npm test --workspace=@data-agent/electron-host -- --run
# 2 files passed; 9 passed
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

最后一次 durable metadata/authorization 收紧后还执行：

```bash
npm run build --workspace=@data-agent/runtime
npm test --workspace=@data-agent/runtime -- --run src/query-assurance.test.ts src/query-assurance-store.test.ts src/export-candidate.test.ts
# 3 files passed; 79 passed
node --test --test-name-pattern='real Server|real Host recovery' evaluations/spider2/lib.test.mjs
# 2 passed, 0 failed
```

实时 Smoke 命令：

```bash
npm run eval:spider2 -- run --config .artifacts/phase2/config.json --ids-file evaluations/spider2/round8-shadow10-ids.txt --model-profile deepseek --run-id answer-plan-phase3-final-shadow10-001 --formal --score
node evaluations/spider2/baseline-report.mjs --run C:/data-agent-eval/runs/answer-plan-phase3-final-shadow10-001
```

对应制品目录：`C:/data-agent-eval/runs/answer-plan-phase3-final-shadow10-001`。

唯一 skipped 是 Windows workspace symlink 权限相关既有测试；不属于 Phase 3 必需合同。四组合、恢复、篡改和披露测试均未跳过。

## 实时 Smoke 与 B1 对比

冻结配置：`round8-shadow10-ids.txt`、DeepSeek profile、20 turns、50 tool calls、最多 6 次探索、300 秒、concurrency 3。正式单次运行：`C:/data-agent-eval/runs/answer-plan-phase3-final-shadow10-001`；没有逐题重跑或择优替换。

- 8 completed、2 max_turns（local003、local025）。
- Delivered Set：`local010, local029, local032, local034, local035, local037, local050, local061`，8/10。
- Correct Set：`local032`，1/10。
- 固定分母 SQL/End-to-End EX：0.1（1/10）；submitted-only：0.125（1/8）。
- 平均时长 153477 ms；平均工具调用 25.30。
- 相对 B1（Delivered 10/10、Correct 0/10、106651 ms、22.1 calls）：交付 -2，正确 +1，时长约 +43.9%，工具调用约 +14.5%。两项交付退化均为模型在冻结 20 turns 内 `max_turns`，不是确定性 Receipt/Runner 故障；不得据此声称非劣或成本达标。
- 8 个发布均为 `published_with_disagreement`，说明披露合同生效，而非“核查全部通过”。
- 运行结束后的最后两项修改只收紧 durable recovery 的目标内容 hash 和 pending 完整身份冻结；未改变正常 SQL/模型路径。修改后已重跑全部确定性测试和四 Host/交付回放，不用再次随机 Smoke 覆盖原观测。

可核查文件：`manifest.json`、`report.md`、`scores.json`、`baseline-report.json`（同一 run 目录）。

## 独立复核

- 首轮复核发现 CSV snapshot 冒充、pending 不持久、inline 仅摘要、v2 Receipt 被当作完整发布；已整改。
- 二轮复核发现恢复依赖 SQL 重执行、pending 放宽 Candidate identity、重试丢失披露；已整改。
- 三轮复核发现 staging 缺失时未校验目标内容、pending 未冻结 token/surface/metadata；已整改并补负例。
- 最终确认：run `a3266edc-6c8c-41df-ac5a-6f9a509d61cc`，`No issues found`，`Merge verdict: OK with notes`。Notes 仅为固定十题覆盖/正确率/延迟继续由 Phase 6 验收，不阻塞 Phase 3 工程合同关闭。

## 残余风险与后续约束

1. 固定十题仅有 8/10 交付、1/10 正确，延迟和工具调用均高于 B1；Phase 6 必须按预冻结全量配对门槛验收。
2. CSV 无数据库 snapshot 时只能保证“此次重执行 Candidate”的内部字节一致，不能证明它与 preview 是同一数据时点；披露会明确标出这一限制。
3. durable recovery 依赖私有 staging 或未篡改的公开目标至少一者存在；二者都缺失时保持 pending/integrity failure，不会重执行 SQL 猜测恢复。
4. 后续阶段修改 Receipt、DeliveryEnvelope、Candidate promotion、fast-path 或 Runner 提取时，必须重跑本阶段四组合、故障恢复和跨身份负例。
