# Answer Plan Phase 5：Interface 与 Prompt 收敛验收记录

日期：2026-09-09

## 结论

Phase 5 已把新任务收敛到统一 Answer Session Interface：模型只提交完整七槽位 envelope、`revisionId` 与 `candidateId`，Runtime 在内部解析并验证 Spec hash、Decision/Hypothesis/Claim binding、Candidate identity 与 Publication Receipt。当前模型工具不再接受旧 hash/ref 字段；legacy task 对当前模型工具只读，历史协议仍可读取和离线回放。

固定十题单次实时 Smoke 为 Delivered 9/10、Correct 0/10。覆盖相对 B1 下降 1 题、正确率持平，成本略高；该单次随机观测不满足推广结论，继续由 Phase 6 的冻结大样本与至少三次配对验收裁决。

## 冻结协议与实现

- 当前计划协议：`evidence-plan-v2`。
- Answer Session：`data-agent.answer-session@3`。
- 当前模型工具 schema：`answer-plan-tools-v4`。
- 当前 Prompt：`answer-plan-p6-evidence-decision-integrity`。
- Host/Runner protocol：`1` / `1`。
- 当前写路径：`update_answer_spec(baseRevisionId, complete envelope)`；结果查询：`query_database(sql, mode=result, revisionId)`；交付：`export_query(candidateId)` 或 `publish_query_result(candidateId)`。
- Runtime 内部继续保留并强制校验 `specHash`、Decision selection input hash、Query Artifact identity/content hash 和 Receipt binding；这些字段不进入当前模型工具 schema、只读计划 Prompt 或更新回执。
- `AnswerSessionAuthority.assertWritableProtocol` 同时检查 session schema、tool schema、Prompt、Host 和 Runner 版本。不兼容任务可读但当前写入明确返回 `ANSWER_SESSION_RUNTIME_VERSION_MISMATCH`。
- 恢复 schema v2 task 时保留持久化版本，不静默升级；当前 model tool 对 `answer-spec-legacy-v1` 明确返回 `ANSWER_SESSION_LEGACY_READ_ONLY`。legacy 写兼容仅留在深层测试/迁移 adapter，不与当前模型工具混写。
- `beginPlan`、result convergence 和 publication 在数据库调用前生成稳定阶段 idempotency key。Host adapter 接收该 key；同一进程复用相同 SQL/limit 的进行中或已完成 Promise，不同输入复用同 key 明确冲突。恢复 fixture 证明跨 QueryAssurance 重建后同 key 可由 Host durable cache 复用，物理执行一次；Host 无 durable result 时允许按相同 key 安全重试。
- Spider evaluator 与 baseline report 同时识别当前 `candidateId`、legacy `queryArtifactId` 和组合式 `query_database(deliverIfEligible=true)`，但拒绝混合 handle、错误 Receipt 或多发布分支。

## Prompt 验收

`.pi/SYSTEM.md` 已删除模型手抄 hash、自行提交 hypothesis/decision refs、自报 verified 状态的要求，并明确：

1. 首次数据库查询前提交完整 envelope；Runtime 返回不透明 `revisionId`。
2. exploration 不携带 revision/candidate binding；result 只携带最新 `revisionId`。
3. 交付只使用结果 SQL 返回的 `candidateId`。
4. Runtime 负责内部 hash、候选假设与已选解释绑定；模型不得重复提交这些状态。
5. exploration 返回可引用的 `observationEvidenceId`；该句柄只能绑定 observed-data 现象，不能自证业务解释。
6. Decision 声明 `affectedAspects`，并提交 `assumptionProfile` 与由其计数得到的 `assumptionVector`；material population 平局不得由 stable-order 产生选择。
7. JSON Pointer 示例 `/filters/0` 指向示例 envelope 中真实存在的数组元素；测试会解析示例 JSON 并逐条解析所有 binding path。
8. `update_knowledge` 示例使用真实 schema 字段 `operation/path/content`，不再使用不存在的 `action`。

`tools-catalog.test.ts` 同时验证 Prompt 禁止字段、工具 schema 禁止字段、必需字段和 JSON Pointer 有效性。

## 接口复杂度对比

### 模型必填字段

| 操作 | legacy/current 前的模型状态 | Phase 5 当前状态 | 变化 |
|---|---|---|---|
| 计划修订 | 完整七槽位 envelope + `baseSpecVersion`，且后续需记忆 `specVersion/specHash` | 完整七槽位 envelope + `baseRevisionId` | envelope 业务字段不减少；移除模型维护 hash |
| result query | `sql` + `mode` + `specRef{specVersion,specHash}`，并按情况重复 `hypothesisRefs/selectedDecisionRefs` | `sql` + `mode` + `revisionId` | 身份字段由嵌套双字段及重复 refs 收敛为一个 handle |
| CSV/inline delivery | `queryArtifactId` | `candidateId` | 数量不变，名称与 Candidate 语义统一 |
| 重试 | 模型需重建/重复内部身份字段 | 原参数 + 可选稳定 `idempotencyKey`；Runtime/Host 判定恢复 | 不再重建内部 binding |

### 必须记忆的调用顺序

当前最小路径保持业务上必要的顺序，不用减少安全步骤冒充简化：

1. `update_answer_spec`；
2. 可选 exploration；若证据改变计划，回到 1 并使用最新 `revisionId`；
3. `query_database(mode=result, revisionId)`；
4. 按行数使用 `publish_query_result(candidateId)` 或 `export_query(candidateId)`。

组合快路径可把“计划修订 + 首次 exploration”和“result + delivery”分别收敛为一次工具往返。简单无 exploration 的显式路径仍为 3 次工具往返；组合路径最低为 2 次。Phase 5 没有通过绕过 Spec、结果 Artifact 或 Receipt 来减少往返。

### 重复状态与往返

- 模型重复维护的身份状态：从 `specVersion + specHash + hypothesisRefs + selectedDecisionRefs + queryArtifactId` 收敛为当前 `revisionId + candidateId`。
- 定向组合路径测试：3 次模型工具往返（含一次同 key begin 重试）、3 次数据库调用，其中重试没有重复 exploration 物理执行；执行阶段 key 均为 Runtime 生成的稳定 64 位标识。
- 固定十题单次 Smoke：平均 25.40 tool calls；B1 为 22.10（约 +14.9%），Phase 4 为 25.80（约 -1.6%）。平均时长 108740 ms；B1 为 106651 ms（约 +2.0%），Phase 4 为 139234 ms（约 -21.9%）。单次随机运行只作风险观测，不冒充 Phase 6 成本结论。

## Phase 5 验收逐项

| 验收项 | 状态 | 可核查证据 |
|---|---|---|
| 新任务统一 Answer Session Interface | 通过 | `answer-session.ts` protocol binding；`agent-assembly.ts` 当前工具入口；`tools-catalog.ts` v4 schema |
| 外部 opaque handle、内部全量 hash 验证 | 通过 | `tools-catalog.test.ts` 禁止旧字段；`agent-assembly.test.ts` opaque handle/不泄露 hash；既有 Query Assurance identity 负例 |
| 并发修订不静默覆盖 | 通过 | `query-assurance.test.ts` 同 base 并发仅一方成功，另一方 `ANSWER_PLAN_REVISION_CONFLICT` |
| 提交/执行/发布重试幂等且可恢复 | 通过 | begin 同 key 重试、result/evaluator/delivery recovery、immutable staged delivery、Host key 透传和物理调用复用 fixtures |
| Prompt 无手抄 hash、自报可信状态，Pointer 有效 | 通过 | `.pi/SYSTEM.md`；`tools-catalog.test.ts` Prompt/schema/Pointer 合同 |
| 旧读、新写、协议不混写 | 通过 | schema v2 restore 保留版本并拒写；legacy model-tool read-only；mixed protocol write rejection tests |
| Host/Runner/Tool/Prompt 版本不兼容明确拒绝 | 通过 | `ANSWER_SESSION_RUNTIME_VERSION_MISMATCH` 和恢复测试；版本冻结于 task protocol binding |
| Server/Electron × CSV/inline 共用合同 | 通过 | `evaluations/spider2/lib.test.mjs` 四组合真实 `buildAgentTools` 回放及 durable pending recovery |
| 接口复杂度报告 | 通过 | 本节字段、顺序、重复状态及往返/预算对比 |
| 共同回归门槛 | 通过（效果/成本风险保留 Phase 6） | 下述确定性全量回归与固定十题 Smoke |

## 确定性回归

当前工作区基准 commit：`0117a658f4a2401d304a68d71162f7c8980e4ea0`。

最终候选命令：

```bash
npm test --workspace=@data-agent/runtime -- --run
npm test --workspace=@data-agent/server -- --run
npm test --workspace=@data-agent/electron-host -- --run
npm test --workspace=@data-agent/contracts -- --run
node --test evaluations/spider2/*.test.mjs
npm run build --workspace=@data-agent/contracts
npm run build --workspace=@data-agent/runtime
npm run build --workspace=@data-agent/server
npm run build --workspace=@data-agent/electron-host
git diff --check
```

最终输出：Runtime 58 files / 413 passed / 1 skipped；Server 16 passed；Electron 10 passed；Contracts 5 passed；Spider harness 45 passed；四类 build 与 `git diff --check` 均 exit 0。唯一 skipped 是既有 Windows symlink 权限测试，不涉及本阶段合同。

日志位于 `.artifacts/answer-plan-phase5/`，SHA-256：

- Runtime：`8d41e11e30c9c669eff1580bff5e731a5e510d8df3b948fe291f23fb44935ea2`
- Server：`17babee3cfe09216eec057d2ec0c5d4e59a5c22470788283681076af3876ceb8`
- Electron：`58eba5305301230781292860faff32c0b8f710593c149dee5f4607e01a532258`
- Contracts：`987c3e6d78d974bdc7e2884c58b466c1726ae614725fbaff43ca1a37c74b1947`
- Spider harness：`f28a4bf7359013b5488fea9b4bcf6c4ac10e1c054b51b8167133e1368752a4e2`
- build（contracts/runtime/server/electron）：`e45ace9895e7db40b57ab1a91037ed172a27e3b4b66c50b6fb7f9f4a989060ba` / `a7e60c32cd1b890fdfa588c2f45c693254e4bd67d61563d4d1f1d0ad27f0580f` / `3b9aff1c8182b2ebd76be81e181a3b36b17ad68fa2f9211f42522599cabe9744` / `ee6ef91fbb8a71e07a4aebbbbf053053ef22129630569aa168b29a4c8e59c2de`
- `git diff --check`：`50c498ee6857b1f6c2b9d7a46b0507657486c7c544a0682977a92fc6c93fdc8d`。

## 实时 Smoke 与 B1 对比

最终身份一致运行：`C:/data-agent-eval/runs/answer-plan-phase5-final-shadow10-004`。

```bash
npm run eval:spider2 -- run --config .artifacts/phase2/config.json \
  --ids-file evaluations/spider2/round8-shadow10-ids.txt \
  --model-profile deepseek \
  --run-id answer-plan-phase5-final-shadow10-004 --formal --score
node evaluations/spider2/baseline-report.mjs \
  --run C:/data-agent-eval/runs/answer-plan-phase5-final-shadow10-004 \
  --output C:/data-agent-eval/runs/answer-plan-phase5-final-shadow10-004/baseline-report.json
```

冻结配置：固定 10 题、DeepSeek profile、20 turns、50 tools、最多 6 次 exploration、300 秒、concurrency 3。保留全部尝试，无逐题重跑或择优替换。

- 9 completed、1 max_turns（`local010`）。
- Delivered Set：`local003, local025, local029, local032, local034, local035, local037, local050, local061`，9/10。
- Correct Set：空集，0/10。
- SQL/CSV coverage：90%；固定分母 SQL/End-to-End EX：0/10。
- 平均时长 108740 ms；平均工具调用 25.40。
- 相对 B1：交付 -1、正确持平、时长约 +2.0%、工具调用约 +14.9%。相对 Phase 4：交付持平、正确持平、时长约 -21.9%、工具调用约 -1.6%。
- 全部 9 个交付均具合法精确 Receipt；未交付题为 `max_turns`，不是 binding invalid。

关键 hash：

- Manifest：`2593de3273359af75f0258225dc027ad629b7125d6455329e5b8342f0457c6ee`
- Summary：`95097ac23a05abdb34e3c87241bcdba27de3ecf702d3431614339dde29e096be`
- Report：`09e26bd421e29965039d66003c098225a04ab570a9d1edce82ee878bc881eb8c`
- Official score：`c798eed37b2b4c24b03a400debeda6f4c6d7b1347d85b488d47a625505483f79`
- Delivered/Correct report：`72d4341e34bcf638c22902f1095ea64ecf4d3af43045dc8fe1ed706932df999b`。

此前 `-002/-003` 运行暴露 evaluator 仍按 legacy `queryArtifactId` 提取当前 `candidateId` 的迁移缺口；该缺口已加入确定性回归并修复。它们不作为最终 Phase 5 效果证据，也未择优替换 `-004` 的题级结果。

## 独立复核

首次 Phase 5 独立复核指出四项 P1：旧 schema 恢复被静默升级、legacy 可从当前模型工具写入、执行 key 未透传 Host、缺少阶段报告。前三项代码整改后由同一 reviewer 做限定增量复核：三项均 PASS，`No remaining code-level P1/P2`，`Incremental verdict: OK with notes`；本报告关闭第四项。复核特别保留：当前 MCP executor 接收但不持久缓存 execution key，跨进程无可复用结果时选择按同 key 重试，而非承诺数据库无法提供的 exactly-once。

## 残余风险与后续约束

1. 单次 Smoke 仍只有 9/10 交付、0/10 正确，且平均工具调用高于 B1；必须由 Phase 6 大样本、多次配对和冻结阈值验收，Phase 5 不宣布效果达标。
2. Runtime 进程内可复用同 key Promise；跨进程复用依赖 Host durable cache。当前 MCP Host 只接收 key，没有持久结果时会安全重试，因此只承诺 idempotent identity，不承诺数据库 exactly-once。
3. legacy deep adapter 仅为历史读取、回放和显式迁移保留；不得重新接回当前 model tool。
4. 修改 current tool schema、Prompt、TaskProtocolBinding、Candidate/Receipt handle 或 evaluator 提取逻辑时，必须重跑本阶段 opaque-handle、恢复、Host parity 和 baseline exact-publication 回归。
