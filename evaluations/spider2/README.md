# Spider2 Agent Evaluation

该目录是 Data Agent 与官方 Spider2-Lite 之间的薄适配层。它通过 DataAgentApplication 创建每题独立的 Pi Session/Lane，并只使用 Answering 的 begin/revise/execute/publish/inspect 链路；Reviewer 与实验性 Detector 仅作为离线观测配置，不进入在线发布授权。

完整的第 1～8 轮进展、Query Assurance 试验、启动命令和结果分析流程见：[Spider2 与 Query Assurance 测评转交文档](../docs/Spider2与Query%20Assurance测评转交文档.md)。

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

评测 Runner 会将配置的 Python 解释器和每题独立工作区传给 Agent；纯查询评测默认不注册 Widget 和 Dashboard 工具，并按每题后端动态注入 SQL 方言提示。Runner 默认并行数为 3，可用配置中的 `concurrency` 或命令行 `--concurrency` 覆盖。评测默认不设置任务总时间、Agent 轮数、工具调用数或探索查询数上限；如配置了对应限制则按配置执行。达到已配置轮次预算的 60% 且尚未导出时，查询结果会附加交付提醒。

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

# 基于冻结运行和外部人工标签生成 Calibration 报告
npm run eval:spider2 -- calibrate --run <run_id> --labels <labels.jsonl>
```

`run` 可追加 `--score`，完成后立即执行官方 SQL/CSV 两种评分。正式发布运行使用 `--formal`；首轮基线必须使用 `--baseline`。`--resume` 默认只重跑 `provider_error,resource_error,error`，可用 `--resume-statuses provider_error,timeout` 显式指定集合；对已有运行使用 `--ids-file` 时会保留原始题目分母并合并未重跑结果。全量归因运行至少设置 `--backend sqlite`；固定题目烟雾运行使用 `--ids-file`，避免误选云端题目。

模型切换使用 `modelProfiles` 配置和 `--model-profile <name>`。每个 Profile 只保存 `apiKeyEnv/baseUrlEnv` 等非敏感配置，不得内联密钥；本机密钥可放在已忽略的 `evaluations/spider2/.env.local`。未显式传入 `--env-file` 时，Runner 依次加载项目 `.env` 和该本地文件。选中 Profile 后，主模型、Answer Spec Planner 和异常解释枚举器使用同一模型，Manifest 会记录 Profile 名称。

同一个主 Agent 通过 `update_answer_spec` 生成并版本化七槽位 Spec；初始 `[ANSWER_SPEC_READ_ONLY]` 只是全 unresolved bootstrap，不能直接查询。首次 Spec 提交前，Runtime 拒绝任何数据库查询；探索证据改变口径时，主 Agent 再次提交并使用返回的新 `specVersion/specHash`。

查询工具显式区分两种用途：`mode="exploration"` 用于字段/值/基数等探索，必须完全省略 `specRef/hypothesisRefs`，生成的 Artifact 不绑定 Spec且不可发布；`mode="result"` 必须携带最近一次 Spec 更新返回的 `specRef.specVersion/specHash`，并显式列出采用的候选 `hypothesisRefs`，重新预览生成可发布结果 Artifact。省略 mode 时，模型可见的 `query_database` 默认按 exploration 处理；探索 Artifact 即使通过精确 ID 也不能导出或内联发布。

当前 Assurance 配置采用“检测 + 告知 + 处置边界 + 披露”模型：`assurance.detectors.enabled` 总开关，`detectors.tierA/tierB/disabled` 控制检测器分级；只有 A 级异常默认触发 `interpretations` 多候选周期。`interpretations.maxCyclesPerTask`、`minRemainingTurns`、`minRemainingToolCalls` 分别限制每题周期数和预算守卫。`assurance.hooks` 可独立开关 `informOnQuery`、`informOnUnresolvedHypotheses`、`interpretationsOnAnomaly`、`integrityBlocks`、`terminateAfterExport`，用于同配置归因实验；其中 `informOnUnresolvedHypotheses` 是显式 opt-in，缺省为 `false`，只有配置里显式写 `true` 才开启。提醒按 taskId + revisionId + hypothesisSet 去重，每题最多三次。exploration 不受未处置假设影响；当前 revision 或 Result Artifact 存在 `handlingStatus=unhandled` 时，result SQL、CSV 导出与内联发布会在执行前阻塞。CLI 可用 `--disable-hook <name>` 强制关闭、`--enable-hook <name>` 强制开启任一 Hook，Manifest 记录生效值；`dirtyDataAction` 支持 Spider2 的 `multi_candidate`，`delivery` 默认是 `deliver_with_disclosure`。`assurance.enumerator`（或兼容的 `plannerLlm`）可配置独立解释枚举模型；它只生成备选解释，不做裁决。

`assurance.profile.schema/candidate` 是画像层的配置预留：画像由 Runtime 自动完成，不注册为模型可调用工具；候选画像只覆盖 Digest 中作为排序、极值或均值依据的列。当前 Runner 的 Manifest 会记录生效 Hook、检测器分级、解释周期与披露策略。

Few-shot 示例登记：`promptDerivedFromInstances: [ga001, bq051]`。这两个官方实例只用于抽象推导结构，已从提示示例中虚构化；云端评测必须排除 `ga001` 与 `bq051`，避免提示泄漏。

运行器会把模型 `stopReason=error` 及连接/网络错误记为 `provider_error`。遇到供应商错误，或正式运行中的资源/基础设施错误，会保存已有证据并立即终止，不再把失败误记为 `completed`；首回合 0 工具调用且无 CSV 的可疑旧 `completed` 记录也可由 `--resume` 识别。正式运行只有在所有选定题目均得到有效执行结果后才允许评分；`timeout`、`max_turns` 属于 Agent 表现，仍计入完整分母。

评分前会检查官方 evaluator 源码并拒绝硬编码 `.decode("gbk")` 的版本，避免 UTF-8 提交在部分环境中被错误解码。Gold 兼容性预检同时固定 evaluator、dataset 和 Spider2 commit 指纹。

## 结果

```text
<runsRoot>/<run_id>/
├── manifest.json
├── cases.jsonl
├── summary.json
├── cases/<instance_id>/
│   ├── knowledge/
│   ├── workspace/
│   ├── result.json
│   └── trace.json
├── transcripts/<instance_id>/
├── submissions/sql/<instance_id>.sql
├── submissions/csv/<instance_id>.csv
├── official_score/
└── report.md
```

最终 SQL 选择规则：只选择最后一次已完成且成功、带匹配 `Publication Receipt` 的 `export_query` 或 `publish_query_result`，并关联到同一 `queryArtifactId` 的 result `query_database` SQL；没有匹配 Receipt 时不回退到预览 SQL。未完成的工具调用不计入候选。`export_query` 只能选择 Artifact，完整结果先进入私有 Export Candidate，经 Query Assurance 后原子发布；Shape 和列证据来自 Artifact/Answer Spec，不接受 Solver 自报合同。最终 CSV 只接受与最终导出调用关联且非空的文件，不使用“第一个 CSV”兜底；零行结果必须保留 CSV 表头。发布状态标签使用 `published_approved`、`published_with_disagreement`、`not_published_no_export_call`、`not_published_export_failed:<code>`、`not_published_provider_error`、`not_published_integrity:<code>`；`not_published_review_unavailable` 已废弃，出现即视为 Runner bug。报告同时保留官方“已提交样本”分数和以本次固定题目数为分母的严格分数，未提交 SQL/CSV 的题目按错误计入严格分数。

## 同日 A/B 归因

未决假设提醒的最小 A/B 只改变一个变量：`informOnUnresolvedHypotheses`。

```text
Control：   --disable-hook informOnUnresolvedHypotheses
Treatment： --enable-hook  informOnUnresolvedHypotheses
```

两端必须同题单、同模型 Profile、同预算、同日运行，且不逐题择优重跑；Control 不注入任何未决假设提醒，Treatment 每题最多注入三次。报告需给出交付率、官方正确率、Turns、Tool Calls、Token、Hook 注入率、处置响应率、阻塞恢复率与 Artifact 绑定率，并交叉核对 Manifest 中的 Hook 生效值。旧版“一次提醒且 unresolved 可交付”的 A/B 不作为当前 Result Boundary 的验证。

Phase 6' 全量回归必须使用同一配置、同一预算、同一模型和同一天的三个 Run ID：`control` arm 设置 `assurance.detectors.enabled=false`、`assurance.hooks.interpretationsOnAnomaly=false`，但保留 `integrityBlocks` 与 `terminateAfterExport`；`hooks` arm 开启检测器与解释 Hook；`fewshot` arm 在 hooks 基础上增加 `.pi/SYSTEM.md` 的虚构化 §1.5。三组 Manifest 都必须使用 `--baseline` 冻结指纹，并报告固定分母 E2E、CSV 覆盖、A 级触发题集得分、多候选周期数、预算跳过数、`timeout/max_turns` 和平均工具调用。提示词变更后的 few-shot arm 必须先通过固定 10 题 smoke，未通过不得进入全量。

## 云数据库

BigQuery 和 Snowflake 通过 `backends.<backend>.mcp` 配置现有 MCP 进程。该 MCP 必须实现 Data Agent 当前数据库契约：

- `execute_query_preview`
- `execute_query_export_batch`

配置中的参数支持 `{db}`、`{instance_id}`、`{spider2Repo}`、`{spider2LiteRoot}` 占位符。凭据通过环境变量传递，不写入配置或运行 Manifest。
