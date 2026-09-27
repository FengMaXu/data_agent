# Spider2 Agent Evaluation

该目录是 Data Agent 与官方 Spider2-Lite 之间的薄适配层。它通过 DataAgentApplication 创建每题独立的 Pi Session/Lane，并只使用 Answering 的 begin/revise/execute/publish/inspect 链路；Reviewer 与实验性 Detector 仅作为离线观测配置，不进入在线发布授权。

历史进展和旧实验背景见：[Spider2 与 Query Assurance 测评转交文档](../../docs/Spider2与Query%20Assurance测评转交文档.md)。本页只描述当前 `ResolvedExperiment → EpisodeRecord → Evaluation` 入口。

## 存储建议

仓库代码位于 `D:/data_agent/evaluations/spider2`。Spider2 数据库和评测结果体积较大，默认放在：

```text
C:/data-agent-eval/
├── Spider2/   # 官方仓库，包含 spider2-lite/
└── runs/      # 本地评测结果
```

C 盘当前空间仍需由使用者确认。不要将本地数据库、云凭据或评测结果提交到本仓库。

## 准备

1. 将官方 Spider2 仓库放到 `C:/data-agent-eval/Spider2`，或修改本地配置。
2. 按官方说明下载 local SQLite 数据库。
3. 确保数据库位于以下任一受支持位置：
   - `<spider2-lite>/resource/databases/<db>.sqlite`
   - `<spider2-lite>/resource/databases/spider2-localdb/<db>.sqlite`
   - `backends.sqlite.databaseDir` 指定目录。
4. 安装 Spider2 官方评测依赖并准备 Python。
5. 先构建 Data Agent：`npm run build:runtime && npm run build:server`。
6. 设置模型密钥，例如 `OPENAI_API_KEY`。
7. 如需自定义，复制 `config.example.json` 为 `config.local.json`；该文件已被 Git 忽略。

评测 Runner 会将配置的 Python 解释器和每题独立工作区传给 Agent；纯查询评测默认不注册 Widget 和 Dashboard 工具，并按每题后端动态注入 SQL 方言提示。Runner 默认并行数为 3，可用配置中的 `concurrency` 覆盖。Episode 预算来自 `limits`，Answering 的修订/探索/结果实现/观测行预算来自 `queryTask`（未配置时使用显式的 Answering 默认策略）；两者都会写入 Manifest，不能依赖旧字段推断。

## 命令

```bash
# 单元测试
npm run test:eval:spider2

# 校验官方文件、数据库、文档和构建产物
npm run eval:spider2 -- preflight --backend sqlite --max-cases 20

# 执行 Gold SQL 兼容性检查和一次真实模型 canary；正式基线前必须通过
npm run eval:spider2 -- preflight --backend sqlite --gold-check 3 --model-canary

# 冻结本轮基线的 Prompt、Runtime、工具、Skills、模型和评测适配器
npm run eval:spider2 -- freeze

# 单题
npm run eval:spider2 -- run --instance-id local001

# 使用 config.local.json 中的命名模型配置切换同一单题
npm run eval:spider2 -- run --instance-id local003 --model-profile deepseek
npm run eval:spider2 -- run --instance-id local003 --model-profile gpt-5.5
npm run eval:spider2 -- run --instance-id local003 --model-profile gpt-6-luna

# 冻结后的基线冒烟
npm run eval:spider2 -- run --ids-file evaluations/spider2/smoke-local.txt --baseline --score

# 指定固定 ID 清单
npm run eval:spider2 -- run --ids-file evaluations/spider2/smoke-local.txt

# 评分和报告
npm run eval:spider2 -- score --run <run_id>
npm run eval:spider2 -- report --run <run_id>

# 离线测量题面 → Answer Spec 提取质量（默认选择全部 135 道 SQLite 题）
npm run measure:spec -- --lite-root C:/data-agent-eval/Spider2/spider2-lite

# 复核同配置 control/treatment 的 Phase 5 A/B（默认读取 C:/data-agent-eval/runs 下的 40 题配对运行）
npm run measure:phase5-ab

# 生成带 Gold 结构预填、等待人工复核的 135 题标签草稿
npm run measure:spec -- --lite-root C:/data-agent-eval/Spider2/spider2-lite --draft-labels docs/Spider2题面Spec标签草稿-135题.jsonl

# 校验标签 JSONL 的完整覆盖、题面哈希和槽位结构
npm run validate:spec-labels -- --validate-labels docs/Spider2题面Spec标签草稿-135题.jsonl

# 仅使用 reviewed/adjudicated 标签计算槽位级指标；draft 不会进入分母
npm run measure:spec -- --lite-root C:/data-agent-eval/Spider2/spider2-lite \\
  --labels docs/Spider2题面Spec标签复核候选-135题.jsonl \\
  --output docs/Spider2题面Spec提取质量-槽位候选.json \\
  --markdown docs/Spider2题面Spec提取质量-槽位候选.md

# 重新评分（不打开 Agent Session、不重跑 SQL）
npm run eval:spider2 -- rescore --run <run_id> --attempt <attempt_id>
```

`run` 可追加 `--score`，完成后立即执行官方 SQL/CSV 两种评分。正式发布运行使用 `--formal`；首轮基线必须使用 `--baseline`。旧 `--resume` 不再有隐含语义：请明确使用 `--continue`（同一 attempt，恢复 Pi 未完成 operation，不重置预算）或 `--retry`（新 Session/workspace/attempt，保留旧证据）。`--continue` 会拒绝实验身份或预算变化；`rescore` 只读取已保存提交物和 EpisodeRecord，不启动 Agent。全量归因运行至少设置 `--backend sqlite`；固定题目烟雾运行使用 `--ids-file`，避免误选云端题目。

模型切换使用 `modelProfiles` 配置和 `--model-profile <name>`。`gpt-6-luna` 通过 Derouter 的 OpenAI 兼容 Chat 接口接入，读取 `DEROUTER_API_KEY` 和 `DEROUTER_BASE_URL`；模型可用性仍需实际 canary 验证。每个 Profile 只保存 `apiKeyEnv/baseUrlEnv` 等非敏感配置，不得内联密钥；本机密钥可放在已忽略的 `evaluations/spider2/.env.local`。未显式传入 `--env-file` 时，Runner 依次加载项目 `.env` 和该本地文件。选中 Profile 后，主模型、Answer Spec Planner 和异常解释枚举器使用同一模型，Manifest 会记录 Profile 名称。

同一个主 Agent 通过 `begin_answer_spec` 建立、`revise_answer_spec` 修订七槽位 Spec；初始 `[ANSWER_SPEC_READ_ONLY]` 只是全 unresolved bootstrap，不能直接查询。首次 Spec 提交前，Runtime 拒绝任何数据库查询；探索证据改变口径时，主 Agent 再次提交并使用返回的新 `specVersion/specHash`。

查询工具显式区分两种用途：`mode="exploration"` 用于字段/值/基数等探索，必须完全省略 `specRef/hypothesisRefs`，生成的 Artifact 不绑定 Spec且不可发布；`mode="result"` 必须携带最近一次 Spec 更新返回的 `specRef.specVersion/specHash`，并显式列出采用的候选 `hypothesisRefs`，重新预览生成可发布结果 Artifact。省略 mode 时，模型可见的 `query_database` 默认按 exploration 处理；探索 Artifact 即使通过精确 ID 也不能导出或内联发布。

当前 Answering 仍采用“检测 + 告知 + 处置边界 + 披露”模型。Runner 将 Answering Fanout 显式传入 Runtime，默认开启且只提供 advisory 观测；旧 `assurance.detectors.*` 仅作为兼容的离线元数据，不会静默关闭 Fanout。`answering.fanout.enabled=false` 才会显式关闭。Spec Feedback 只有在配置 `"specFeedback": true`（或兼容的 `TYPESAFE_SPEC_ALIGNMENT=1`）且凭据可用时才标记为 resolved；Hypothesis Advisor 的注册和实际调用分别记录。所有能力在 Manifest 中分为 `configured/resolved/executed/coverage`，观察结果不等同于业务裁决。

`assurance.profile.schema/candidate` 是画像层的配置预留：画像由 Runtime 自动完成，不注册为模型可调用工具；候选画像只覆盖 Digest 中作为排序、极值或均值依据的列。当前 Runner 的 Manifest 会记录生效 Hook、检测器分级、解释周期与披露策略。

Few-shot 示例登记：`promptDerivedFromInstances: [ga001, bq051]`。这两个官方实例只用于抽象推导结构，已从提示示例中虚构化；云端评测必须排除 `ga001` 与 `bq051`，避免提示泄漏。

运行器会把模型 `stopReason=error` 及连接/网络错误记为 `provider_error`。遇到供应商错误、资源错误或权威终态未知，会保存已有证据并使运行不完整，不再把失败误记为 `completed`；旧记录不会通过 `--resume` 隐式重跑。正式运行只有在所有选定题目均得到有效执行结果后才允许评分；`timeout`、`max_turns` 属于 Agent 表现，仍计入完整分母。

评分前会检查官方 evaluator 源码并拒绝硬编码 `.decode("gbk")` 的版本，避免 UTF-8 提交在部分环境中被错误解码。Gold 兼容性预检同时固定 evaluator、dataset 和 Spider2 commit 指纹。

## 重构后的记录与验收

Spider2 Runner 现在将有效配置解析为 `ResolvedExperiment`，并为每个题目写入不可覆盖的 attempt 目录；结果、运行事实和评分分别保存：

```text
<runsRoot>/<run_id>/cases/<instance_id>/attempts/<attempt_id>/
├── attempt.json
├── record/events.jsonl
├── record/spans.vN.jsonl
├── record/artifacts.json
├── record/episode.json
├── session/
└── workspace/
```

`continue` 保持同一 attempt；`retry` 使用新 attempt 并保留 `retryOf`；评分使用独立 `ScoreRecord`。旧 `cases/<id>/result.json` 与 `trace.json` 仅作为不覆盖首个 attempt 的兼容投影。正式 SQL/CSV 只能通过 `ApplicationAgentAdapter.readPublicationSql/readPublication(receiptId)` 读取，不能从私有 ResultStore 或 Preview 拼接。

常规验收入口：

```bash
npm run test:eval:spider2
npm run build
npm run typecheck
```

真实模型 canary、Gold 兼容性预检和完整 Spider2 rollout 仍是显式、有预算的运行，不属于普通测试。当前 Gold 3/3 与 API canary 已通过；单题 Agent canary 的执行记录已落盘，但未形成可评分提交物，因此不能把它当作成功基线或全量 rollout 证据。

## 结果

```text
<runsRoot>/<run_id>/
├── manifest.json                 # ResolvedExperiment + fixed denominator
├── cases.jsonl                   # 兼容投影
├── summary.json
├── cases/<instance_id>/
│   ├── result.json               # 首个 attempt 的兼容投影
│   ├── trace.json
│   └── attempts/<attempt_id>/
│       ├── attempt.json
│       ├── record/events.jsonl
│       ├── record/spans.vN.jsonl
│       ├── record/episode.json
│       ├── session/
│       ├── knowledge/
│       ├── workspace/
│       └── submissions/{sql,csv}/
├── official_score/               # summary/evaluation/score-record；rescore 可复用
└── report.md
```

最终 SQL 选择规则：只选择带匹配 `Publication Receipt` 的交付调用，并通过授权的 Candidate SQL 投影读取；没有匹配 Receipt 时不回退到预览 SQL。未完成的工具调用不计入候选。`export_query` 只能选择 Artifact，完整结果先进入私有 Export Candidate，经 Query Assurance 后原子发布；Shape 和列证据来自 Artifact/Answer Spec，不接受 Solver 自报合同。最终 CSV 只接受与最终导出调用关联且非空的文件，不使用“第一个 CSV”兜底；零行结果必须保留 CSV 表头。发布状态标签使用 `published`、`published_approved`、`published_with_disagreement`、`not_published_no_export_call`、`not_published_export_failed:<code>`、`not_published_provider_error`、`not_published_integrity:<code>`；`not_published_review_unavailable` 已废弃，出现即视为 Runner bug。报告同时保留官方“已提交样本”分数和以本次固定题目数为分母的严格分数，未提交 SQL/CSV 的题目按错误计入严格分数；执行未知、记录不完整和 scorer unavailable 不会被伪装成答错。

## 同日 A/B 归因

### 七槽位语义规格消融

Runner 支持一个仅用于评测的实验因子：

```json
{
  "answering": {
    "semanticSpecMode": "required"
  }
}
```

- Treatment 使用 `required`（默认）：暴露 `begin_answer_spec` / `revise_answer_spec`，最终 result 必须通过七槽位、Hypothesis、Choice 和决策点 readiness。
- Control 使用 `disabled`：暴露无参数 `begin_query_task`，不暴露 `begin_answer_spec` / `revise_answer_spec` 和 `compare_hypotheses`；Runtime 创建带显式 unknown 语义槽位的 Query Task，并仅在该评测 arm 绕过语义 qualification。它不会把未知实体、指标或输出伪记成 `not_applicable`。exploration/result 分流、任务预算、不可变 Candidate、CandidateCheck、Fanout 能力、Receipt 和 CSV 授权发布链保持；依赖 Spec 的检查可能因没有语义输入而成为 `not_applicable`。
- `disabled` 只允许 evaluation composition 使用；产品 `DataAgentApplication` 不暴露该配置。
- SpecFeedback 在 `disabled` arm 强制不解析，因为不存在可评估的模型语义 Spec。

两组必须使用同一基础配置、同一题单/模型/预算/数据和同日运行，只改变 `--semantic-spec-mode`。无交互评测中，两组均使用相同的 `--disable-clarification`：模型不再看到 `ask_user_clarification`，并获得相同的无交互提示；产品默认仍保留此工具。这样不会让澄清等待耗尽每题超时预算，也不能把缺失业务证据推断成确定口径。两组都必须关闭 SpecFeedback（配置 `"specFeedback": false`，且不要设置 `TYPESAFE_SPEC_ALIGNMENT=1`），否则 required arm 会额外运行 Spec assessor，无法把差异归因于七槽位。分别执行：

```bash
npm run eval:spider2 -- freeze --semantic-spec-mode required --disable-clarification
npm run eval:spider2 -- freeze --semantic-spec-mode disabled --disable-clarification
npm run eval:spider2 -- run --baseline --semantic-spec-mode required --disable-clarification --run-id <required_run> --ids-file <ids>
npm run eval:spider2 -- run --baseline --semantic-spec-mode disabled --disable-clarification --run-id <disabled_run> --ids-file <ids>
```

Runner 为 disabled arm 使用独立的 `agent-surface-lock.semantic-spec-disabled.json`，避免两个 Prompt/工具面互相覆盖。Manifest 中必须核对：

```text
capabilities.semanticSpec.resolved = required | disabled
answering.semanticSpecMode = required | disabled
answering.promptProfile = semantic-spec-required | semantic-spec-disabled
observedCapabilities.tools.coverage = complete
observedCapabilities.tools.observedCases = observedCapabilities.tools.expectedCases = 题单数量
observedCapabilities.tools = begin_answer_spec + revise_answer_spec | begin_query_task （两组均不含 ask_user_clarification）
capabilities.clarification.resolved = false
inputs.config.sha256 = <same base config content>
inputs.database.sha256 = <same declared database-pack digest, when configured>
observedInputs.databases[*].sha256 = <same per-case database content>
baselineLockSha256 = <present>
```

Phase 5 comparator 会比较模型、题单、scoring、预算、并发、除 Prompt 外的输入身份、配置内容和逐题实际数据库身份。语义规格消融要求每题都有 `state=known` 的数据库 digest；缺失/未知身份或任一 digest 不同，都会令 `sameExperimentalInputs=false`。路径差异不影响内容身份比较。这是一项 gate-level 消融，不是 legacy 裸 SQL：不能移除 Query Task、Candidate 或 Receipt 后再把差异归因于七槽位。

### 未决假设提醒 A/B

未决假设提醒的最小 A/B 只改变一个变量：`informOnUnresolvedHypotheses`。

```text
Control：   --disable-hook informOnUnresolvedHypotheses
Treatment： --enable-hook  informOnUnresolvedHypotheses
```

两端必须同题单、同模型 Profile、同预算、同日运行，且不逐题择优重跑；Control 不注入任何未决假设提醒，Treatment 每题最多注入三次。报告需给出交付率、官方正确率、Turns、Tool Calls、Token、Hook 注入率、处置响应率、阻塞恢复率与 Artifact 绑定率，并交叉核对 Manifest 中的 Hook 生效值。旧版“一次提醒且 unresolved 可交付”的 A/B 不作为当前 Result Boundary 的验证。

Phase 6' 全量回归必须使用同一配置、同一预算、同一模型和同一天的三个 Run ID；旧 `assurance.detectors.*` 只作为离线比较元数据，若要改变在线 Fanout 必须显式切换 `answering.fanout.enabled`。Hook/提示词 arm 的差异必须写入 ResolvedExperiment，三组 Manifest 都必须使用 `--baseline` 冻结指纹，并报告固定分母 E2E、CSV 覆盖、A 级触发题集得分、多候选周期数、预算跳过数、`timeout/max_turns` 和平均工具调用。提示词变更后的 few-shot arm 必须先通过固定 10 题 smoke，未通过不得进入全量。

## 云数据库

BigQuery 和 Snowflake 通过 `backends.<backend>.mcp` 配置现有 MCP 进程。该 MCP 必须实现 Data Agent 当前数据库契约：

- `execute_query_preview`
- `execute_query_export_batch`

配置中的参数支持 `{db}`、`{instance_id}`、`{spider2Repo}`、`{spider2LiteRoot}` 占位符。凭据通过环境变量传递，不写入配置或运行 Manifest。
