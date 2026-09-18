# Phase 0 基线记录（B0）

状态：已关闭。本文记录 B0/B1、冻结 Smoke、共同回归与独立复核证据；业务正确率改善不属于本阶段结论。

## 工作区身份

- Git HEAD：`0117a658f4a2401d304a68d71162f7c8980e4ea0`
- Node：`v22.22.3`
- npm：`11.14.1`
- 方案文档 SHA-256：`280e0051b9780cc4a6cc43b58e0f8576d352da0ad865af776139a0918ef5796e`
- 已跟踪工作区补丁 SHA-256：`cf075ebf1f7ce4f0c7279a49b51d2bcf495ae1a53ab47daaaf6d1f7d0440f6d0`
- 工作区状态清单 SHA-256：`6b3fba94a03bf6545ede811e5247290ca9fb761d850874b8495799d6b284e204`

本工作区在目标启动前已有大量未提交及未跟踪文件。基线未执行 reset/clean，也没有声称 Git HEAD 能代表实际源码。已跟踪改动保存为本地 `.artifacts/answer-plan-phase0/B0-working-tree.patch`；未跟踪文件只列入状态清单，没有复制大体积或可能敏感的内容。

## 已执行的免费回归

执行时间：目标启动后的 B0 检查点。

```bash
npm test --workspace=@data-agent/runtime -- --run \
  src/query-assurance.test.ts \
  src/publication.test.ts \
  src/export-candidate.test.ts \
  src/agent-assembly.test.ts

npm run test:eval:spider2
```

结果：

- Runtime：4 files，87 tests，全部通过。
- Spider2 harness：30 tests，全部通过。
- Runtime 日志 SHA-256：`9ee2ea8b82ed368892b53c77321244783c860a72364115c07bb95a4da0decd0b`
- Spider2 harness 日志 SHA-256：`fd80444b648c8804044791780b54fd54cf6bd02dd5bab36d0a1301a7fb9ef176`
- B0 manifest SHA-256：`1c1d2a9cb0cedf1573063e38e14fbc4f82af00e535553bc7692cedf92e6be84d`

日志及 manifest 位于当前工作区本地忽略目录 `D:/data_agent/.artifacts/answer-plan-phase0/`。在本次 Phase 0 复核时再次确认三个文件存在且 hash 与上文一致。本文件保留摘要及 hash；若本地 Artifact 丢失，该证据立即降级为未验证，不能仅凭本文摘要声称可复现。正式阶段关闭报告需将必要日志复制到受控的持久验收位置。

## 历史运行集合化基线

新增只读脚本 `evaluations/spider2/baseline-report.mjs`，以 Manifest 的固定题目为分母，显式输出 Delivered Set、Correct Set、二者交集、已交付但错误及未交付集合。脚本不会运行模型或数据库，也不会把 Disclosure 当作官方正确性。

已对历史运行 `C:/data-agent-eval/runs/deepseek-10-after-spec-fanout-001` 生成报告：

- 分母：10；Delivered Set：9；Correct Set：0；未交付：`local032`。
- 该历史运行的 agentCommit 与当前 HEAD 相同，但 Manifest 不能代表当时未提交工作区源码，因此只作为历史 B0 参考，不冒充当前工作区实时基线。
- 报告位于本地 `.artifacts/answer-plan-phase0/B0-delivered-correct.json`。

测试：`node --test evaluations/spider2/baseline-report.test.mjs`，2/2 通过。

## 执行事故记录

曾执行 `npm run eval:spider2 -- run --help` 试图读取帮助。当时的 CLI 没有子命令 help 防护，将 `--help` 当作普通选项并触发默认全量选择。运行在 `local020` 因供应商 `402 Insufficient Balance` 中止，输出目录为 `C:/data-agent-eval/runs/spider2-mixed-20260907-080447Z`。随后已增加无副作用 help 分支及回归测试；该事故描述保留为历史事件。

该运行不是合格基线，不进入 Delivered/Correct Set，也不用于效果结论。后续禁止用该命令探测帮助；实时运行前必须显式给出 ids file、run-id、预算并完成 preflight。余额或凭据不可用时不再启动实时模型运行。

## B1 local032 实时单题证据

使用显式单题、run-id 及冻结预算运行：

```bash
npm run eval:spider2 -- run \
  --config .artifacts/answer-plan-phase0/phase0-b1-config.json \
  --instance-id local032 \
  --model-profile deepseek \
  --run-id answer-plan-phase0-b1-local032-001 \
  --score
```

冻结预算：300 秒、20 turns、50 tools、最多 6 次 exploration、provider timeout 30 秒、concurrency 1。

结果：

- completed；10 turns；18 tool calls；SQL/CSV 均生成。
- Publication Status：`published_with_disagreement`；没有 `REVIEW_CANDIDATE_BINDING_INVALID`。
- 审查能力未配置，Receipt 如实记录 `REVIEWER_NOT_CONFIGURED`，不冒充 Approved。
- 官方 SQL EX 与 E2E EX 均为 0/1。该运行只证明发布绑定故障在当前构建未复现，不证明业务答案正确。
- Manifest SHA-256：`a4f9ef797722676ab9914a5739998532a8994e10e14e252ad1f0d39d1633b33d`。
- Summary SHA-256：`4c701c9de9bf61c1d7c509a7e4c317fa373fbec90a3088128917a31433699c90`。
- Official score SHA-256：`61665133c65c4cdedb67ea19938177b29cc4c125fe932dd7f3c60fe4b861f83d`。
- Delivered/Correct report（严格校验版）SHA-256：`80783bf64c7ff92dfe0c5cf800a42b52f2f5de1e5838040db692073d27b2cba8`。

运行目录：`C:/data-agent-eval/runs/answer-plan-phase0-b1-local032-001`。

## B1 定向回归

- Runtime 6 files：94/94 通过。
- Server 2 files：4/4 通过。
- Spider2 harness：35/35 通过。
- Runtime、Server、Electron Host 构建通过。
- 详细日志位于 `.artifacts/answer-plan-phase0/B1-*-focused.log`；正式关闭前生成并记录最终 hash。

## B1 固定十题 Smoke

运行：`C:/data-agent-eval/runs/answer-plan-phase0-b1-shadow10-001`。

配置与单题相同，题集固定为 `evaluations/spider2/round8-shadow10-ids.txt`，concurrency=3。结果：

- 10/10 completed，SQL/CSV/合法 Receipt 覆盖 10/10。
- `REVIEW_CANDIDATE_BINDING_INVALID`：0。
- Delivered Set：十题全部；Correct Set：空集。
- 官方 SQL EX 与 E2E EX：0/10。发布完整性恢复不代表语义准确率改善，P6 仍必须单独验收。
- Manifest SHA-256：`3f0b7ec4d89cf4e4ce34ae1e7aa631a31b701b64d27a9400b4fcc9e72a6205c0`。
- Summary SHA-256：`0241283af8345b5859d81534fea82f6f3fdb025a019276ddbb968ba142ff88a7`。
- Official score SHA-256：`3a2dc094e7682de25933cb66d8646eb65366ccb553b3e30b1426a58870d22f51`。
- Delivered/Correct report（严格校验版）SHA-256：`a8ccaca2ba36c39aab231b1aee561a7ad4a506aa7e2993dea40b3a222a6cff1f`。

## B1 工作区检查点

- 工作区 patch SHA-256：`b8e54556917c7022c9cf80d0f11315bfaa49c1d6ac6ea6a2c1c3c355d29fc1d7`。
- 状态清单 SHA-256：`fcfbaa6059731993bcd61549cbec3d8449cf80f1d573a1b2488a4a9b7ccb0b3e`。
- Runtime 定向日志 SHA-256：`d11c7122eccffa8f68eecf8da6d9bbd2f137ceab7ae1d1c2f8f9990284a2c8a6`。
- Server 定向日志 SHA-256：`84bf72677f91c8fe00acb67d269925beb0036e8a6b7f19e1b5a8644fb92f3205`。
- Spider2 harness 日志 SHA-256：`4c2926c837e8a21df4e11f53ad7fec9e9fce3c696ad6a8382134321f632bf17f`。

注意：patch 包含目标启动前的既有未提交改动，不能用它把全部差异归因于本阶段；B0/B1 hash 用于防止无记录覆盖。

## Phase 0 关闭记录

最终实现检查点在写入本关闭元数据前生成，避免自引用 hash：

- B1 final patch SHA-256：`0a001b19ead419d836879819170bb745091efddca87b85262f334c5c9d440d01`。
- B1 final status SHA-256：`c476996f0da81536b7dde7bc0ed4321be39a3a641a8057456bcda3a861846dbf`。
- Runtime 5 files：115/115，日志 SHA-256 `763e92f043d6ddefe506ea56733670e0c29dbb81e6c9da76c669e197a29a6652`。
- Server 2 files：12/12，日志 SHA-256 `b8f72dc14cabcc9881a578a4c7087b0029162949f695d047187c8b6afcdd1caa`。
- Electron 2 files：9/9，日志 SHA-256 `ab31e85410354c6476712462f762f08631a502012fd9c1ba630024af5a174d0e`。
- Baseline report：7/7，日志 SHA-256 `9a8d23fe2b2bf19fc73faefb5def60d98b56060373f0e83e443768125befa0c0`。
- Runtime、Server、Electron 构建通过。
- 最终独立复核 run `272396c9-d731-4384-8bb2-02c066dbed89`：`Merge verdict: OK`，无未关闭 finding。

逐项结论：

1. 当前资源下 local032 真实单题可合法发布，满足线上故障复测；历史私有候选缺失仅限制对旧失败字段的考古结论。
2. exploration、伪 hash、错误 Candidate、旧版本、错误 Receipt 均有拒绝测试；重复合法发布幂等。
3. 三类 Host 的适用构建/核心回归通过；Electron 真人 GUI 流明确保留为灰度前产品验收，不冒充已执行。
4. Manifest、固定题单、预算、身份 hash、固定分母、B0/B1、协议回放、Delivered/Correct Set 均已冻结。
5. 当前十题 Delivered Set 为 10/10，Correct Set 为空；该事实进入后续逐题回归，未被包装成准确率改善。

因此 Phase 0 必需项关闭，Phase 1 可以启动。
