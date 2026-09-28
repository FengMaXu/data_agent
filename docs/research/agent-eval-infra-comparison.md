# Research: 当前仓库与文章所述 Agent Evaluation Infrastructure 的差异

## Summary

文章把 agent 评测基础设施定义为同时具备 **control plane**（任务选择、实验/扰动、消融、replay、verifier、聚合、回归跟踪、dashboard、release gate）和 **data plane**（模型、harness、runtime、工具、memory、环境状态、结构化 trace、snapshot/state delta）的体系，而非一个最终分数。[原文](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)

本仓库已经有一套相当扎实但范围较窄的 Spider2 离线评测适配层：隔离运行、官方 SQL/CSV verifier、结构化逐题记录、固定分母报告、环境/代码指纹冻结、preflight/canary 和若干 A/B 分析工具。它尚不是文章描述的全生命周期平台：没有证据表明存在逐步环境 state-delta/snapshot、确定性 replay、生产反馈回灌、统一任务注册/切片 dashboard 或由 CI 执行的发布门禁。尤其应以 `run.mjs` 为现状准绳：README/config 中的 reviewer、detector、interpretation、calibration 大量内容目前只是历史文档、离线 metadata 或配置占位。

## Findings

### 1. 文章的比较基准

文章的关键标准不是“有没有 benchmark 分数”，而是：

1. **控制面与数据面分离**：控制面负责 task/config/gate、实验设计、ablation、replay、verifier、聚合和 ship/rollback 决策；数据面负责实际 rollout 与可观测证据。[原文：control plane / data plane](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)
2. **rollout/trace 是核心工件**：trace 应结构化记录每一步 tool、arguments、observation、latency、cost 和 action 造成的 state delta，通常类似 OpenTelemetry spans；console log 或 final answer 不够。[原文：structured trace](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)
3. **评测面不止 output**：至少覆盖 output、trace、memory、environment，另有 mechanistic interpretability；agent 改变环境，因此需要 snapshot/diff，而非只判最终输出。[原文：five surfaces / state delta](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)
4. **task 与 harness 解耦、实验可归因**：固定 task/scorer，切换 model/runtime/tools/harness；保存可审计、可复现、可 replay 的 experiment record。[原文：decouple task from harness](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)
5. **闭环**：线上 incident/trace 经脱敏、标注、附 state delta 后晋升为 regression case，离线 eval 反过来 gate release。[原文：production incident capture](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)

### 2. 已经实现

1. **[已实现] 独立 case runtime 与统一真实应用路径。** Spider2 adapter 为每题准备独立 knowledge/workspace/session，使用 `DataAgentSessionApplication` 和 web adapter 驱动真实 Answering 路径，而非 mock 一个只产答案的函数；这是文章所说 data plane/harness 的有效子集。`evaluations/spider2/run.mjs:L574-L646`；目录定位见 `evaluations/spider2/README.md:L1-L5`。

2. **[已实现] 结构化 trace，但范围是消息/工具事件而不是完整环境 diff。** recorder 保存 canonical events、tool name、args、result、error、开始/结束时间和 duration；逐题写入 `trace.json`。`evaluations/spider2/lib.mjs:L482-L558`；`evaluations/spider2/run.mjs:L680-L721`。这比日志强，能够分析工具轨迹、延迟和失败。

3. **[已实现] 可复现身份与 baseline freeze。** baseline surface 对 agent commit、system prompt、runtime dist、skills、SQLite MCP、query executor、runner/lib、Spider2 commit、dataset、evaluator、model、limits、concurrency 做 hash/identity，并在 baseline 运行前严格比较。`evaluations/spider2/run.mjs:L738-L805`。run manifest 另记录 dataset/evaluator/runner/system-prompt hash、model、题目分母与 limits。`evaluations/spider2/run.mjs:L836-L878`。

4. **[已实现] verifier、固定分母和结果身份完整性。** runner 顺序调用 Spider2 官方 SQL 与 exec-result evaluator，并把未提交题算入 frozen manifest 分母；`baseline-report.mjs` 还要求 publication status、tool call、artifact 和 receipt 精确关联，并校验官方 aggregate 与逐题分数一致。`evaluations/spider2/run.mjs:L936-L988`；`evaluations/spider2/baseline-report.mjs:L28-L57,L65-L150`。对应负例测试覆盖缺失 receipt、混用 handle、矛盾 aggregate、错误分母等，见 `evaluations/spider2/baseline-report.test.mjs:L28-L118`。

5. **[已实现] preflight 与局部 gate。** formal/baseline run 要求 Gold compatibility；baseline 还要求 surface lock，并执行 model canary。preflight 检查 dataset、evaluator、gold、runtime/server dist、数据库/外部知识和云后端配置。`evaluations/spider2/run.mjs:L790-L826,L1111-L1179`。这是“运行准入门禁”，但不是已证实的 CI/release gate。

6. **[已实现] 失败分类、resume 和可审计报告。** provider/resource/timeout/max-turn 等状态分开，基础设施失败可使 formal run incomplete；报告包含 SQL/CSV coverage、publication status、latency、tool-call、官方与固定分母得分。`evaluations/spider2/run.mjs:L646-L679,L910-L934,L1005-L1082`。

7. **[已实现] 离线标注与 scorer 可靠性边界。** spec-quality 只让 `reviewed/adjudicated` 标签进入正式语义指标，draft/pending 不进入分母，并显式将 Gold shape 限定为结构证据，不能冒充语义正确性。`evaluations/spider2/spec-quality.mjs:L102-L181,L457-L566,L669-L743`。这是文章“区分 agent failure 与 scorer failure”方向上的良好实践。

8. **[已实现] package 入口清楚，但 eval 不在通用 `test`/`verify:backend` 中。** 根 scripts 提供 `eval:spider2`、`measure:spec`、`measure:phase5-ab`、`validate:spec-labels`、`test:eval:spider2`；普通 `test` 仅执行各 workspace 的 test，`verify:backend` 也没有调用 Spider2 eval。`package.json:L9-L27`。

### 3. 局部实现

1. **[局部实现；中风险] control/data plane 只在 Spider2 单一 benchmark 内成形。** dataset/scorer 与 app runtime 有一定解耦，model profile、case selection、limits、并发可配置；但 task schema 仍直接读取 Spider2 JSONL，未见跨 benchmark 的 task registry、统一 perturbation/ablation 定义或通用 verifier registry。`evaluations/spider2/lib.mjs:L47-L92`；`evaluations/spider2/run.mjs:L806-L878`。

2. **[局部实现；高风险] trace 不等于文章要求的 rollout observability。** 当前记录工具调用及结果、latency，但逐题 result 中没有统一 token/cost 字段；workspace 仅保留最终目录，未见每一步文件、DB row、env、secret、cookie、git ref 的 snapshot/delta。`evaluations/spider2/run.mjs:L690-L721`；`evaluations/spider2/lib.mjs:L482-L558`。因此可以回答“调用了什么”，不能普遍回答“每一步改变了什么环境状态”。

3. **[局部实现；高风险] resume 不是 deterministic replay。** `--resume` 按状态重跑 case、复用原分母，但它会重新调用模型/runtime；未见从冻结 snapshot 和已录 observation 做逐步重放、或比较同一 trace pattern 的 replay engine。`evaluations/spider2/run.mjs:L807-L833,L881-L934`。

4. **[局部实现；中风险] 有实验比较工具，但当前 Phase 5 A/B 代码面向旧 manifest。** `phase5-ab.mjs` 能比较相同 dataset/model/limits/instance IDs、逐题 score delta 与 trace routing；但它读取 `manifest.assurance`，而当前 runner 写的是 `assuranceObserver`，且 online 路径已改为 `answering`。`evaluations/spider2/phase5-ab.mjs:L12-L34,L206-L270` 对比 `evaluations/spider2/run.mjs:L849-L871`。因此脚本能力存在，是否适用于当前 HEAD 需先验证/迁移，不能把历史 A/B 当当前控制面已经贯通。

5. **[局部实现；中风险] 报告有 aggregate 和 failure list，但无通用 slice/regression dashboard。** 当前 summary/report 汇总 backend/status/publication/coverage/latency/tool calls/anomaly，并列出失败 case；未见按任务能力、用户群、工具、memory 状态等任意 slice 的趋势存储或 dashboard。`evaluations/spider2/run.mjs:L1005-L1082`。

6. **[局部实现；高风险] release gate 只在 CLI 内。** `freeze`、Gold compatibility、surface lock、model canary 能阻断 formal/baseline run，但根 package 的默认 test/verify 链没有 Spider2，且当前工作树不存在 `.github` 目录。因此仓库内未实现由 CI 执行的 Spider2 release gate。`package.json:L9-L27`；`evaluations/spider2/run.mjs:L790-L826`。

### 4. 仅文档规划、配置占位或当前未接线

1. **[当前未接线；严重] README/config 描述的全套 reviewer/detector/interpretation 不是当前 online 行为。** `config.example.json` 虽配置 shadow mode、多个 tier A/B detector、interpretation、profile 和 calibration，但代码将 detector policy 的 `enabled` 强制为 `false`，interpretation 的 cycles/budget 强制为 `0`，hook 白名单只有 `integrityBlocks` 与 `terminateAfterExport`，并明确称这些值只是 offline-observer metadata。`evaluations/spider2/config.example.json:L7-L62`；`evaluations/spider2/run.mjs:L162-L196`。

2. **[当前未接线；严重] online 主路径是 Answering publication integrity + fanout/spec-feedback，不是 README 所述全套 QA。** case result 明示 `reviewerOnline:false`；online detector 信号来自实际 tool result 中的 fanout report，spec feedback 也只是从 tool result 聚合；`assuranceAuditRecords` 与 `hookEvents` 当前写空数组，interpretation/unresolved hook count 固定为 0。`evaluations/spider2/run.mjs:L500-L551,L680-L721`。manifest 同时把 legacy switches 放进 `assuranceObserver.mode="offline"`，不赋予发布权限。`evaluations/spider2/run.mjs:L849-L871`。

3. **[文档与代码偏差；严重] README 宣称的 hooks/多候选周期与当前 runner 冲突。** README 说五种 hook 均可 CLI 开关、tier detector 会触发 interpretation、多候选与预算守卫生效；当前代码只接受两个 hook，detector 永远 disabled，interpretation cycles 为 0。`evaluations/spider2/README.md:L104-L116` 对比 `evaluations/spider2/run.mjs:L162-L196`。

4. **[未落地；严重] `calibrate` 命令写在 README/package 使用说明中，但当前 CLI 不接受。** README 给出 `npm run eval:spider2 -- calibrate ...`；然而 `usage()` 只列 `preflight|freeze|run|score|report`，`main()` 也只 dispatch 这五个，其余抛 `UNKNOWN_COMMAND`。`evaluations/spider2/README.md:L82-L89`；`evaluations/spider2/run.mjs:L1181-L1206`。因此不能据文档声称 calibration pipeline 已实现。

5. **[历史文档，不是当前保证；高风险] 转交文档本身记录 reviewer 曾有严重假阳性。** 文档称 DeepSeek Shadow v2 的 5 次 Approved 全部对应官方错误结果，并明确“尚不能 Enforce”；同时说明第 8 轮主测试为 QA off。`docs/Spider2与Query Assurance测评转交文档.md:L15-L24,L47-L55`。这进一步说明 reviewer calibration 目前不能作为 release authority。

6. **[未发现落地证据；高风险] production feedback / incident promotion。** 未见线上 trace 抽样脱敏、人工标注、代表性 incident 自动晋升 regression suite，或 offline task distribution 持续更新的实现；这与文章闭环要求差距最大。[原文：production incident capture](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/)

7. **[配置占位；中风险] schema/candidate profile。** README 已明确称 `assurance.profile.schema/candidate` 是“配置预留”；当前 runner 也没有把这些 config 转成独立 profiler/control-plane 服务。`evaluations/spider2/README.md:L113-L116`；`evaluations/spider2/config.example.json:L50-L53`。

### 5. 无法确认

1. **[无法确认；中风险] 仓库外 run 产物的当前可重放性。** README 把数据库和 runs 放在 `C:/data-agent-eval`，不提交仓库；未实际运行正式模型、官方 evaluator 或检查那些历史目录，故历史分数只按文档引用，不能当本次验证结果。`evaluations/spider2/README.md:L7-L17`。
2. **[无法确认；中风险] token/cost 是否在底层 runtime transcript 的其他文件存在。** `run.mjs` 的标准 `result.json/trace.json/summary.json` 没有统一暴露，但本次未穷尽 runtime 所有存储实现。

## 差异矩阵

| 文章所需能力 | 仓库状态 | 证据与判断 |
|---|---|---|
| Task + harness 解耦 | 局部实现 | Spider2 dataset/scorer 与 app runtime 分开；尚无跨 benchmark task registry。 |
| 隔离 rollout runtime | 已实现 | 每题独立 workspace/session/application。 |
| 结构化 trace | 已实现（不完整） | 工具 args/results/duration 有记录；非 OTel span，缺统一 cost 与环境 delta。 |
| Snapshot / step state diff | 仅最终 workspace，逐步 diff 未落地 | 未见每步文件/DB/env 状态快照。 |
| Verifier | 已实现 | 官方 SQL/CSV evaluator + strict fixed denominator + receipt linkage。 |
| Judge calibration | 仅文档/历史试验，当前 CLI 未落地 | `calibrate` 不在 dispatcher；历史 reviewer 假阳性严重。 |
| Experiment/ablation | 局部实现 | model profile、frozen surface、旧 A/B 工具存在；当前 manifest schema 已分叉。 |
| Replay | 局部实现 | resume 是重新执行，不是冻结 observation/state 的 deterministic replay。 |
| Regression tracking/dashboard | 局部/未落地 | 单 run report 有；跨 run slice/trend dashboard 未见。 |
| Release gate | CLI 局部实现；CI 未落地 | formal/baseline gate 有；默认 npm verify 不含 eval，当前工作树也没有 `.github` 目录。 |
| Production feedback loop | 未发现 | 无 incident → regression suite 证据。 |
| Memory/environment evaluation | 未落地或无法确认 | 没有专门 memory scorer 和环境状态 delta verifier。 |

## 建议优先级

1. **P0：纠正文档与 CLI 契约。** README/config 按“online 已接线 / offline metadata / planned”拆开；删除或实现 `calibrate` 命令；给 current manifest schema 加测试，避免 `phase5-ab.mjs` 继续读取旧 `assurance`。
2. **P0：建立真实 CI release gate 的可验证证据。** 至少把无凭据的 eval unit tests、manifest/schema contract、baseline-report integrity、spec label validation 接进 CI；昂贵 Spider2 rollout 可做受控 scheduled/manual gate，但发布决策必须绑定 run identity 与阈值。
3. **P1：补齐 state observability。** 为 tool step 记录统一 span、token/cost、输入/输出 artifact hashes，并对 workspace/DB 可变状态生成前后 snapshot/delta；敏感字段需 redaction policy。
4. **P1：实现 replay 和 regression registry。** 区分“resume 新 rollout”和“用冻结 observations/snapshot replay”；失败应携 task version、environment snapshot、verifier version、root-cause slice。
5. **P1：在 reviewer 获得 authority 前完成 calibration。** 先定义人工 adjudicated set、precision/false-reject/stability/latency/cost 阈值和 circuit breaker；在历史 Approved 全错的问题解决前保持 `reviewerOnline:false`。
6. **P2：生产闭环与切片趋势。** 统一 offline/production trace schema，把脱敏 incident 晋升为版本化 regression task，并按 backend、能力、工具、failure mode、model/harness 版本展示趋势。

## Sources

- Kept: [Hidden Technical Debt of AI Systems: Agent Evaluation Infrastructure](https://leehanchung.github.io/blogs/2026/06/13/hidden-technical-debt-agent-evaluation-infra/) — 直接定义比较框架：control/data plane、trace/state delta、replay、release gate、production feedback。
- Kept: `evaluations/spider2/run.mjs` — 当前 CLI、online/offline 行为、manifest、trace/result、freeze/preflight/score/report 的最高权重实现证据。
- Kept: `evaluations/spider2/lib.mjs` — task selection、官方评分辅助、publication identity、recorder 实现。
- Kept: `evaluations/spider2/spec-quality.mjs` — label admission、离线语义指标与 Gold 使用边界。
- Kept: `evaluations/spider2/baseline-report.mjs` 与 `.test.mjs` — baseline integrity 与测试证据。
- Kept: `evaluations/spider2/README.md`、`config.example.json`、`docs/Spider2与Query Assurance测评转交文档.md` — 用于识别文档/配置计划与现状偏差，不单独作为实现证明。
- Kept: `package.json` — 根级 scripts 与默认验证链证据。
- Dropped: 第三方 SEO/聚合页 — 与目标文章或本仓库无直接一手关系。
- Dropped: GitHub 搜索中的同名 data-agent 仓库 — 非 `FengMaXu/data_agent`，不能作为证据。

## Gaps

本次未执行模型调用、Spider2 官方评分或仓库外历史 run 校验；已运行 `npm run test:eval:spider2`，42 项测试全部通过。当前工作区原本已有大量未提交改动；本次只新增本研究文件，未改动已有实现文件。在有外部数据/凭据时仍需执行 `preflight --gold-check --model-canary` 和正式冻结运行，才能验证真实端到端结果。
