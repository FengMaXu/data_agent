# Spider2 与 Query Assurance 测评转交文档

> 目的：让接手人能够快速了解第 1～8 轮测试结论，并在 Windows 环境重新启动评测、评分、定位失败和分析 Query Assurance。
>
> 适用范围：`D:/data_agent` 中的 Data Agent + Spider2-Lite SQLite 评测。云端 BigQuery/Snowflake 仍需要单独配置 MCP，不在本文当前可复现范围内。

---

## 0. 先看结论

### 0.1 主线结论

1. **第 1～2 轮主要建立和修正基线，不能把第 1 轮原始分数当正式成绩。** 第 1 轮的 SQL/CSV 提取和评分覆盖不完整；第 2 轮才形成可审计的 135 题基线。
2. **第 3～4 轮证明基础设施修复有效。** SQLite 方言、SQL Guard、Python 接线、Widget 隐藏、CSV 提取和任务收敛明显改善，E2E 从审计基线约 27.41% 提升到第 4 轮 40.74%。
3. **第 5 轮提示词替换没有得到稳定收益。** E2E 回落到 49/135；第 5 轮 v2 在原失败集上挽救了 14 题，但只是 86 题定向复测，不能报告为新的全量成绩。
4. **第 6 轮 GLM-5.3-Flash 的主要问题是响应/多轮超时。** 在同类 120 秒限制下，timeout 达到 103/135，固定分母 E2E 只有 22/135。
5. **第 7～8 轮暴露了核心语义问题。** 模型可以成功执行和导出 SQL，但仍会误解粒度、分母、时间窗口、单位和输出列；同一求解器内的 reconciliation/verification 没有可靠纠正首因误读。
6. **Query Assurance 已完成 Runtime/Host/Spider2 接线，但第 8 轮 86 题主测试使用 `assurance.mode=off`，不能证明审查器带来的准确率提升。**
7. **DeepSeek Shadow 10 题的审查器曾运行起来，但 5 次 Approved 全部对应错误结果，说明 Reviewer 的可用性不等于语义判断有效性。**
8. **Qwen 当前最新 10 题测试已确认 OpenRouter Chat 路由和 API 可用，但模型没有进入稳定导出阶段。** 这次结果主要说明模型响应/收敛不适合当前预算，不是 Reviewer 召回率测试。

### 0.2 各轮结果总表

主指标统一优先看 **固定题目分母的 E2E（CSV）正确率**。`SQL` 是 SQL 文件正确率，`CSV` 是有效 CSV 交付数；定向复测不能与 135 题全量直接横向比较。

| 阶段 | 运行目录 | 范围 / 模型 | SQL 正确 | E2E 正确 | CSV 交付 | 状态概括 | 结论 |
|---|---|---|---:|---:|---:|---|---|
| 第 1 轮：初始基线尝试 | `spider2-local-baseline-full-001` | SQLite 135，DeepSeek | 6/25（仅提交样本） | 6/21（仅提交样本） | 21/135 | completed 130、max_turns 4、timeout 1；仅少量 SQL 被采集 | **不纳入正式趋势**；暴露了最终 SQL 提取/评测覆盖问题 |
| 第 2 轮：审计基线 | `spider2-local-baseline-full-002` | SQLite 135，DeepSeek | 原始 38/135；审计后 37/135 | 原始 38/135；审计后 37/135 | 原始 112；有效 111 | completed 94、max_turns 25、timeout 16 | 形成正式基线；主要瓶颈是收敛、输出粒度、SQL Guard 和方言 |
| 第 3 轮：基础设施修复 | `spider2-local-improved-full-003` | SQLite 135，DeepSeek | 49/135 | 49/135 | 116/135 | completed 115、max_turns 12、timeout 8 | E2E 从审计基线 37/135 提升到 49/135；工具错误大幅下降 |
| 第 4 轮：交付/校验增强 | `spider2-local-round4-full-002` | SQLite 135，DeepSeek | 56/135 | 55/135 | 123/135 | completed 123、max_turns 1、timeout 11 | 交付率和结果形状改善，但新增导出一致性保护带来大量重试 |
| 第 5 轮：提示词替换 | `spider2-local-round5-full-001` | SQLite 135，DeepSeek | 49/135 | 49/135 | 120/135 | completed 114、max_turns 5、timeout 16 | 未达到第 4 轮；提示词更长不等于语义更准确 |
| 第 5 轮 v2：失败集定向复测 | `spider2-local-round5-v2-failed-001` | SQLite 86，DeepSeek | 14/86 | 14/86 | 68/86 | completed 66、max_turns 5、timeout 15 | 挽救 14 题，但不是 135 题全量成绩；交付率反而下降 |
| 第 6 轮：模型替换 | `spider2-local-round6-glm53-full-001` | SQLite 135，GLM-5.3-Flash | 26/135 | 22/135 | 40/135 | completed 32、timeout 103 | 主要失败是多轮响应超时；不适合作为当前默认 Spider2 模型 |
| 第 7 轮：语义错误集 | `spider2-local-round7-failed86-001` | SQLite 86，DeepSeek | SQL 评分曾被 GBK 问题中断 | 16/86 | 63/86 | completed 62、timeout 21、max_turns 3 | 47 个“成功导出但语义错误”案例证明自我验证不能解决首因误读 |
| 第 8 轮：失败集复测 | `spider2-local-round8-failed86-001` | SQLite 86，DeepSeek，QA off | 16/86（84 个 SQL 提交） | 16/86 | 67/86 | completed 67、timeout 16、max_turns 3 | 交付稳定性比第 7 轮改善，但准确率仍为 16/86；不能作为 QA 收益实验 |
| 第 9 轮：固定 10 题无限制 | `spider2-local-round9-same10-no-limits-001` | SQLite 10，DeepSeek，QA off | 0/10 | 0/10 | 4/10 | completed 10；单题工具调用 16–77 | 导出成功的 4 题也全错；`expected []` 引发大量重试；详见第 9 轮逐题报告 |
| 第 10 轮：G1~G4 门控 | `round10-tracefix-v10-c3` | SQLite 10，DeepSeek，shadow + 门控 | 0/10 | 0/10 | 3/10 | completed 9、timeout 1；7 题 `not_published_review_unavailable` | 检测器有效但"检测即阻断"导致死循环；未校准 fail-closed 是结构性死锁；触发第 11 轮拆除 |
| 第 11 轮 P6：拆除裁决层 + Hook | `round11-full-c3-001` | SQLite 135，DeepSeek，20 turns / 50 tools / 300 s | 44/135 | 44/135 | 119/135 | completed 121、max_turns 13、timeout 1 | 未达第 4 轮 55；8 题为工程故障（provider 错误被记为 completed、发布路径残留拦截）；`count_distinct_divergence` 误触 34 题；`join_fanout` 4 命中 2 纠偏；无同日 control，与第 4 轮的差异不能归因。详见阶段 6 对比报告与第 11 轮修复计划第 2 版 |

### 0.3 第 8 轮之后的 Query Assurance 试验

| 试验 | 运行目录 | 结果 | 正确解读 |
|---|---|---|---|
| DeepSeek Shadow 初次运行 | `spider2-local-round8-shadow10-001` | 10 题均未有效发布；多数为 Reviewer 协议/运行错误 | 不是模型语义结论，先修协议 |
| DeepSeek Shadow v2 | `spider2-local-round8-shadow10-v2-001` | 10 题；SQL 10/10；CSV 8/10；E2E 1/10；5 次 Approved、3 次 Abstained、2 次 Unavailable | 5 次 Approved 全部对应官方错误结果，Reviewer 产生严重假阳性；尚不能 Enforce |
| Qwen 初次 OpenRouter 尝试 | `spider2-local-round8-shadow10-openrouter-qwen38max-001` | 旧配置/路由诊断运行，不作为正式比较 | 当时 Provider 记录仍为 openai，不能与修正后运行比较 |
| Qwen 修正后运行 | `spider2-local-round8-shadow10-openrouter-qwen38max-v2-001` | 10/10；SQL 9/10；CSV 0/10；timeout 1、max_turns 7、completed 2；Reviewer decisions 0 | OpenRouter Chat API 已打通，但 Qwen 在当前多轮预算内不稳定；未产生可分析的 Reviewer 样本 |

Qwen 修正后运行的证据目录：

```text
C:/data-agent-eval/runs/spider2-local-round8-shadow10-openrouter-qwen38max-v2-001/
```

对应配置：

```text
C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json
```

该配置使用 300 秒单题超时、20 turns、并发 2；普通配置文件仍是 120 秒版本：

```text
C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max.json
```

---

## 1. 代码和数据位置

### 1.1 Git 仓库

```text
D:/data_agent
```

关键目录：

```text
D:/data_agent/
├── packages/runtime/                 # Query Assurance、Agent Assembly、Reviewer
├── apps/server/                      # Reference SQLite MCP、Query Executor
├── packages/electron-host/           # Electron Host 接线
├── evaluations/spider2/              # Spider2 Runner、配置、评测单元测试
├── knowledge/doc/                    # 通用 rules.md、learning.md
├── docs/                             # 设计、轮次报告、本文档
└── .pi/SYSTEM.md                     # Agent 系统提示词
```

### 1.2 外部评测资源

不要把下面目录提交到 Git：

```text
C:/data-agent-eval/
├── Spider2/                          # 官方 Spider2 仓库及 spider2-lite
├── runs/                             # 每轮运行结果
├── .venv/Scripts/python.exe          # 官方评分 Python 环境
├── openrouter-qwen.env               # 本地模型密钥，不入库
├── config-round8-shadow10-openrouter-qwen38max.json
└── config-round8-shadow10-openrouter-qwen38max-long.json
```

默认数据和评分器位置：

```text
C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl
C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/evaluate.py
C:/data-agent-eval/Spider2/spider2-lite/resource/databases/
```

当前 10 题 ID 清单已放入仓库，便于复现：

```text
evaluations/spider2/round8-shadow10-ids.txt
```

内容为：

```text
local003
local010
local025
local029
local032
local034
local035
local037
local050
local061
```

### 1.3 当前版本注意事项

当前工作区在交接时仍有未提交改动。历史运行的 `manifest.json` 只记录 Git HEAD，不一定覆盖当时构建的 Runtime/Server dist 和工作区源码。因此：

- 复现历史结果时，以运行目录里的 `manifest.json`、配置、`summary.json`、`official_score` 和日志为准；
- 开始新的正式基线前，先执行 `git status`，确认要纳入实验的改动，提交后再 build；
- 不要把“Manifest 的 agentCommit 相同”理解为运行时二进制完全相同；
- 正式比较必须固定 Prompt、Runtime、工具、Skills、模型、题目、预算、并发和评分器版本。

---

## 2. Query Assurance 当前架构

自由 SQL 路径与 KTX 语义层路径严格分开。本文的 Spider2 评测走 **SQL 路由**，不调用 KTX 语义模型。

### 2.1 SQL 路由流程

```text
题目
  ↓
创建 Query Task
  ↓
准备每题隔离知识库、DDL、Workspace、Session
  ↓
Solver 调用 search/read/query_database
  ↓
成功预览 → 不可变 Validated Query Artifact
  ↓
Export Candidate
  ↓
Conversation-Blind Reviewer（shadow/enforce 时）
  ↓
Delivery Policy
  ↓
Publication Receipt / CSV
  ↓
官方 SQL / E2E 评分
```

核心对象：

- **Answer Spec**：题目解释的版本化表示，分为 Hard Constraint、Hypothesis、Ambiguity；不能把模型推断自动当成业务事实。
- **Query Digest**：确定性提取 SQL 的来源、过滤、度量、分组、窗口、排序、Limit、投影和覆盖范围。
- **Conversation-Blind Reviewer**：看到题目、Answer Spec、Schema、SQL、Digest 和受控结果证据，但看不到 Solver 对话、推理和自报验证结论。
- **Review Outcome**：区分 `available` 与 `unavailable`；Unavailable 不是 Approved。
- **Publication Receipt**：绑定一个精确 Artifact、Answer Spec、Schema fingerprint 和 Review Outcome 的发布凭据。

### 2.2 QA 模式

| `assurance.mode` | 行为 |
|---|---|
| `off` | 不产生 Review Decision；只保留基础交付/审计行为 |
| `shadow` | 记录 Reviewer 决策，是否影响发布取决于 Delivery Policy；用于采集 precision/recall，不可直接启用 Enforce |
| `enforce` | Reviewer 决策参与发布阻断；必须先完成 Calibration，当前配置 `calibration.eligible=false`，不可使用 |

注意：

- `Approved` 不是数学意义上的正确证明；它只表示在当前 Spec、Digest、证据和 Reviewer 能力范围内没有发现阻塞分歧。
- `published_with_disagreement` 不是 `published_approved`。
- Reviewer 不可用、Reviewer Abstained、Solver 没有导出和官方结果错误要分别统计，不能合并成“审查失败”。

---

## 3. 一次评测如何启动

以下命令在 PowerShell 中执行。Git Bash 也可以使用同样的 npm 命令，但路径写法可按 shell 调整。

### 3.1 环境检查

```powershell
Set-Location D:\data_agent

Test-Path C:\data-agent-eval\Spider2\spider2-lite\spider2-lite.jsonl
Test-Path C:\data-agent-eval\Spider2\spider2-lite\evaluation_suite\evaluate.py
Test-Path C:\data-agent-eval\.venv\Scripts\python.exe
Test-Path C:\data-agent-eval\openrouter-qwen.env
```

模型环境文件只需要包含以下形式，不能把密钥写入 JSON 或 Git：

```text
OPENROUTER_API_KEY=<实际密钥>
```

如果是 DeepSeek/OpenAI，替换配置中的 `provider`、`model`、`apiKeyEnv` 和 `baseUrl`，不要复用错误的 API wire format。

### 3.2 构建和本地测试

Runner 使用已构建的 Runtime 和 Server dist，因此每次源码改动后至少执行：

```powershell
npm run build:runtime
npm run build:server
npm run test:eval:spider2
```

`npm run test:eval:spider2` 当前应为 17/17 通过。Runtime 测试可单独执行：

```powershell
npm run test --workspace=@data-agent/runtime
```

完整 `npm test` 会并行启动多个 Vitest workspace；在当前 Windows 会话中曾出现进程级退出码 `3221225794`，但没有看到断言失败。遇到该问题时先单独执行目标 workspace，不要把进程崩溃当作语义测试失败。

### 3.3 Preflight 和模型 Canary

复现当前 Qwen 配置时，建议使用 300 秒版本：

```powershell
npm run eval:spider2 -- preflight `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --backend sqlite `
  --max-cases 10 `
  --model-canary
```

Preflight 至少检查：

- Spider2 数据集、官方 evaluator、Gold 文件存在；
- SQLite 数据库和每题 DDL 可解析；
- 当前 Python 路径存在；
- 模型密钥已加载；
- `--model-canary` 返回 HTTP 200。

如果要做正式基线，再执行 Gold 兼容性检查：

```powershell
npm run eval:spider2 -- preflight `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --backend sqlite `
  --gold-check 3 `
  --model-canary
```

### 3.4 启动当前 10 题测试

不要复用已经存在的 Run ID。当前 Qwen 配置的复现命令：

```powershell
npm run eval:spider2 -- run `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --backend sqlite `
  --ids-file evaluations/spider2/round8-shadow10-ids.txt `
  --run-id spider2-local-round8-shadow10-openrouter-qwen38max-next-001 `
  --concurrency 2 `
  --score
```

参数含义：

- `--config`：明确指定实验配置，不依赖 `config.local.json`；
- `--env-file`：加载模型密钥；
- `--backend sqlite`：只选本地 SQLite；
- `--ids-file`：固定 10 道题，避免每次样本不同；
- `--run-id`：唯一运行名；
- `--concurrency 2`：当前 Qwen 测试使用的并发；供应商不稳定时降到 1；
- `--score`：运行结束后自动执行 SQL/E2E 官方评分并生成 `report.md`。

如果只想快速单题调试：

```powershell
npm run eval:spider2 -- run `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --backend sqlite `
  --instance-id local029 `
  --run-id debug-local029-next-001
```

如果是已有运行的供应商/资源错误续跑：

```powershell
npm run eval:spider2 -- run `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --backend sqlite `
  --ids-file evaluations/spider2/round8-shadow10-ids.txt `
  --run-id <已有run_id> `
  --resume `
  --score
```

`--resume` 只会自动重跑 `provider_error`、`resource_error` 和 `error`；`timeout`、`max_turns` 属于模型表现，不会被当成基础设施错误自动替换。要重新测试这些题，使用新的 Run ID。

### 3.5 单独评分和生成报告

如果运行时没有加 `--score`，执行：

```powershell
$env:PYTHONUTF8 = "1"

npm run eval:spider2 -- score `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --run <run_id>

npm run eval:spider2 -- report `
  --config C:/data-agent-eval/config-round8-shadow10-openrouter-qwen38max-long.json `
  --env-file C:/data-agent-eval/openrouter-qwen.env `
  --run <run_id>
```

`PYTHONUTF8=1` 是历史 Windows 评分兼容措施。第 7 轮曾因官方 SQL evaluator 按默认 GBK 读取 UTF-8 文件而中断；当前评分前保留该环境变量更稳妥。

### 3.6 正式基线冻结

正式基线不是普通开发调试运行。流程是：

```powershell
npm run eval:spider2 -- preflight `
  --config <config> `
  --env-file <env-file> `
  --backend sqlite `
  --gold-check 3 `
  --model-canary

npm run eval:spider2 -- freeze `
  --config <config> `
  --env-file <env-file>

npm run eval:spider2 -- run `
  --config <config> `
  --env-file <env-file> `
  --ids-file <fixed_ids_file> `
  --run-id <baseline_run_id> `
  --baseline `
  --score
```

冻结后 Prompt、Runtime dist、工具、Skills、模型、评测适配器或 Spider2 指纹变化都会阻断 `--baseline`。开发调试阶段不要加 `--baseline`，否则会把未完成改动混入正式比较。

---

## 4. 结果目录和字段

每个 Run 的结构：

```text
C:/data-agent-eval/runs/<run_id>/
├── manifest.json
├── cases.jsonl
├── summary.json
├── cases/<instance_id>/
│   ├── knowledge/              # 该题隔离知识库
│   ├── workspace/              # 该题隔离工作区
│   ├── result.json             # 单题汇总
│   └── trace.json              # 事件、工具调用、QA 审计记录
├── transcripts/<instance_id>/  # Pi JSONL 对话事件
├── submissions/sql/            # 最终 SQL 提交
├── submissions/csv/            # 有效 CSV 提交
├── official_score/
│   ├── sql.log
│   ├── exec_result.log
│   └── summary.json
└── report.md
```

### 4.1 `summary.json`

首先看：

- `total`：选中的题数；
- `statuses`：`completed`、`timeout`、`max_turns`、`provider_error` 等；
- `sqlCoverage`：是否形成最终 SQL 文件；
- `csvCoverage`：是否形成有效 CSV；
- `publicationStatuses`：发布结果计数；
- `averageDurationMs`、`averageToolCalls`：成本和收敛信号。

`completed` 只表示 Agent 回合结束，不等于 CSV 已交付，更不等于结果正确。

### 4.2 `official_score/summary.json`

同时查看两种分数：

- `sql`：SQL 文件官方正确率；
- `execResult`：CSV/E2E 官方正确率；
- `fixedDenominator`：以本次固定题目数为分母，未提交题目按错误计入；这是跨轮次的主要比较口径；
- `submittedTotal`：仅已提交样本的数量，容易高估结果，不得单独用于比较。

例如：10 题只提交 1 个 SQL 且该题错误时，官方“已提交分母”是 0/1，但固定分母应看 0/10。

### 4.3 单题 `result.json`

常用字段：

```text
status                 # completed / timeout / max_turns / provider_error ...
turns                  # Agent 回合数
 toolCalls              # 工具调用数
toolErrors             # 工具错误数
finalSql               # 最终提取的 SQL，可能为空
csvGenerated           # 是否形成有效 CSV
csvError               # CSV 采集错误
publicationStatus      # 发布状态
assuranceAuditRecords  # Query Assurance 审计记录
```

QA 审计重点字段：

```text
reviewAvailability     # available / unavailable / off
reviewMode             # off / shadow / enforce
decision.status        # approved / rejected / needs_clarification / abstained
queryArtifactId        # 审查和发布绑定的 Artifact
specVersion
schemaEvidenceFingerprint
queryDigestVersion
publicationStatus
```

`assuranceAuditRecords` 是**每个候选/审查动作一条记录**，不能直接按记录条数当作题目数。统计 Reviewer 时，应按最后一次候选或 `queryArtifactId` 去重。

---

## 5. 如何分析一轮结果

### 5.1 固定顺序

按以下顺序，避免一开始就被某一道 SQL 带偏：

1. `manifest.json`：确认题目、模型、Provider、Prompt/代码指纹、预算和并发；
2. `summary.json`：确认完成率、SQL/CSV 覆盖和平均成本；
3. `official_score/summary.json`：记录 SQL、E2E 和固定分母成绩；
4. `report.md`：查看自动列出的失败题；
5. `cases.jsonl`：按题目切片 status、CSV、工具错误和审查状态；
6. 单题 `result.json` / `trace.json`：还原真实工具调用顺序；
7. `transcripts/<id>/`：只作为调试辅助，不把 Solver 自报“已验证”当成语义证据；
8. 离线对照 Gold SQL/CSV，区分数据语义、输出形状、交付和评测器问题。

Gold 只能用于**离线评测和误差分析**，不能在运行时注入 Prompt、Knowledge 或 Reviewer。

### 5.2 一条命令查看基础汇总

PowerShell：

```powershell
$run = "C:\data-agent-eval\runs\<run_id>"
Get-Content "$run\summary.json"
Get-Content "$run\official_score\summary.json"
Get-Content "$run\report.md"
```

Git Bash：

```bash
RUN='C:/data-agent-eval/runs/<run_id>'
cat "$RUN/summary.json"
cat "$RUN/official_score/summary.json"
cat "$RUN/report.md"
```

### 5.3 推荐的逐题统计脚本

在 Git Bash 或能运行 heredoc 的终端执行。它会统计状态、SQL/CSV 覆盖、QA availability/decision，并列出需要优先审计的题目：

```bash
python - 'C:/data-agent-eval/runs/<run_id>' <<'PY'
import json
import pathlib
import sys
from collections import Counter

run = pathlib.Path(sys.argv[1])
rows = [json.loads(line) for line in (run / 'cases.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]

def decision_status(record):
    decision = record.get('decision')
    if isinstance(decision, dict):
        return decision.get('status')
    return decision

status = Counter(row.get('status') for row in rows)
publication = Counter(row.get('publicationStatus') for row in rows)
review_availability = Counter()
review_decisions = Counter()
case_review = {}

for row in rows:
    # 同一 Artifact 可能有多次审查；保留最后一条用于题目级概览。
    latest_by_artifact = {}
    for record in row.get('assuranceAuditRecords') or []:
        artifact = record.get('queryArtifactId') or f"no-artifact:{record.get('auditId')}"
        latest_by_artifact[artifact] = record
    latest = list(latest_by_artifact.values())
    case_review[row.get('instanceId')] = latest
    for record in latest:
        availability = record.get('reviewAvailability')
        if availability:
            review_availability[availability] += 1
        decision = decision_status(record)
        if decision:
            review_decisions[decision] += 1

print('cases:', len(rows))
print('status:', dict(status))
print('publication:', dict(publication))
print('sql coverage:', sum(bool(row.get('finalSql')) for row in rows), '/', len(rows))
print('csv coverage:', sum(bool(row.get('csvGenerated')) for row in rows), '/', len(rows))
print('review availability:', dict(review_availability))
print('review decisions:', dict(review_decisions))
print('\npriority cases:')
for row in rows:
    if (row.get('status') != 'completed'
        or not row.get('finalSql')
        or not row.get('csvGenerated')
        or row.get('publicationStatus') in {'not_published_review_unavailable', 'not_published_rejected'}):
        print(row.get('instanceId'), {
            'status': row.get('status'),
            'sql': bool(row.get('finalSql')),
            'csv': bool(row.get('csvGenerated')),
            'publication': row.get('publicationStatus'),
            'toolErrors': row.get('toolErrors'),
            'error': (row.get('error') or {}).get('message'),
        })
PY
```

解释统计时注意：同一题可以有多个 Query Artifact；Reviewer 指标必须先确定“按候选统计”还是“按题目最终候选统计”。做 Calibration 时使用固定的候选标签和 identity，不要把所有中间审查记录直接混入分母。

### 5.4 逐题审计顺序

对一题进行人工/离线审计时，按以下顺序：

1. **是否交付**：有没有有效 CSV；是否 0 字节；是否在 timeout/max_turns 前完成；
2. **SQL 是否可执行**：工具错误、SQLite 方言、列名、表名、单语句限制；
3. **输出合同**：标量/Top-N/分组/明细、列数、列白名单、排序、行数；
4. **粒度**：最终一行代表什么实体；JOIN 是否把一行放大成多行；
5. **分子/分母**：平均、比例、增长率是否来自同一事件集合；空集合如何处理；
6. **时间窗口**：展示期、基线期、LAG/rolling 是否保留必要的历史数据；
7. **单位和公式**：百分比 0–1/0–100、货币转换、绝对值、边界和四舍五入；
8. **Query Assurance**：Reviewer 是否 available；是否有具体 Digest/Spec 证据；Approved 是否被 Gold 证明为假阳性；
9. **分类**：`Resource`、`Schema`、`SQL`、`Semantic`、`Agent`、`Delivery`、`Evaluator`。

不能因为 SQL 执行成功、reconciliation 成功或模型文字说“已验证”就直接判定语义正确。

---

## 6. Query Assurance 专项评估流程

目标不是只看“Reviewer 有没有返回 JSON”，而是测量它在**已知正确和已知错误候选**上的行为。

### 6.1 必须分别统计

| 指标 | 含义 |
|---|---|
| Reviewer available | 能否产生结构合法的 Review Outcome |
| unavailable | Provider、解析、Spec 或证据不足导致无法裁决 |
| approved | Reviewer 放行候选 |
| rejected | Reviewer 发现结构化语义分歧 |
| needs_clarification | 当前证据不足，需要补充澄清 |
| abstained | Reviewer 明确弃权 |
| error recall | 已知错误候选中被 rejected 的比例 |
| false-positive rate | 已知正确候选中被 rejected 的比例 |
| approved false-positive | 已知错误候选被 approved 的比例 |
| publication effect | QA 是否改变 CSV 发布结果 |
| latency/cost | 每个候选额外的延迟和费用 |

### 6.2 当前可用证据

DeepSeek Shadow v2：

- Approved：`local010`、`local029`、`local034`、`local035`、`local050`；这 5 题官方结果均错误；
- Abstained：`local025`、`local032`、`local037`；
- Unavailable/未完成：`local003`、`local061`；
- 结论：当前 Reviewer 存在严重假阳性，不能进入 Enforced Review。

Qwen v2：

- 10 题中没有有效 Reviewer decision；
- 原因首先是 Solver 没有进入成功导出/候选发布阶段，且所有审查记录为 unavailable；
- 结论：Qwen v2 不能用于估计 Reviewer recall/precision，只能用于评估模型 API、延迟和任务收敛。

### 6.3 Calibration 前禁止做什么

- 不要因为 Reviewer 返回 `approved` 就启用 `mode=enforce`；
- 不要把 `unavailable` 改写成 `approved with warning`；
- 不要使用 Gold 答案作为运行时 Reviewer 的“正确答案上下文”；
- 不要把同一模型的 Solver 和 Reviewer 一致当作独立证据；
- 不要只在错误样本上评估 Reviewer，必须有正确样本负例；
- Prompt、模型、Digest parser、ResultEvidence、Review policy 任何一个版本变化后，都要重新校准。

---

## 7. 各轮详细报告索引

### 基线和第 3～5 轮

- [Spider2 基线评测报告](Spider2基线评测报告.md)
- [Spider2 评测修复结果报告](Spider2评测修复结果报告.md)
- [Spider2 第 3 轮全量评测报告](Spider2第3轮全量评测报告.md)
- [Spider2 第 4 轮全量评测报告](Spider2第4轮全量评测报告.md)
- [Spider2 第 4 轮改进建议](Spider2第4轮改进建议.md)
- [Spider2 第 5 轮全量评测报告](Spider2第5轮全量评测报告.md)
- [Spider2 第 5 轮版本 2 定向复测分析报告](Spider2第5轮版本2定向复测分析报告.md)
- [Spider2 第 5 轮未通过题模式分析](Spider2第5轮未通过题模式分析.md)

### 第 6～8 轮

- [Spider2 第 6 轮 GLM5.3Flash 全量评测报告](Spider2第6轮GLM5.3Flash全量评测报告.md)
- [Spider2 第 7 轮 47 题成功导出语义错误逐题分析报告](Spider2第7轮47题成功导出语义错误逐题分析报告.md)
- Spider2 第 8 轮 86 题分析报告：`C:/data-agent-eval/runs/spider2-local-round8-failed86-001/evaluation-analysis.md`
- 运行器说明：[evaluations/spider2/README.md](../evaluations/spider2/README.md)

### Query Assurance 设计和决策

- [Query Assurance 架构设计 V2](Query%20Assurance架构设计V2.md)
- [ADR 0001：职责分离](adr/0001-query-assurance-responsibility-separation.md)
- [Spider2 语义错误架构级解法](Spider2语义错误架构级解法-从自我验证到职责分离.md)
- [Spider2 语义错误架构级解法审阅意见](Spider2语义错误架构级解法审阅意见.md)

---

## 8. 交接后的推荐工作顺序

### 如果目标是继续测模型

1. 先跑 `npm run build:runtime && npm run build:server`；
2. 用 `preflight --model-canary` 确认 Provider/模型/API wire format；
3. 先单题 `local029` 或 `local050`，确认能生成 CSV；
4. 再跑固定 10 题，使用新 Run ID；
5. 先看 timeout/max_turns/CSV coverage，再看正确率；
6. Qwen 若仍无 CSV，优先减少工具探索和多余 Planner/验证调用，不要先修改 Reviewer 结论。

### 如果目标是继续测 Reviewer

1. 先使用已知正确和已知错误的历史候选做离线 Replay；
2. 确保每个候选都有题目、Answer Spec、Schema、SQL、Digest 和受控结果证据；
3. 统计 available/unavailable、Approved/Rejected/Abstained 及 Gold 对照；
4. 优先修正 `approved false-positive`，再讨论阻断策略；
5. 完成 Calibration 后才考虑 per-facet Enforce；
6. 保留 Circuit Breaker，任何延迟、可用性或假阳性恶化都回退 Shadow。

### 如果目标是继续提高 Spider2 准确率

优先级应是：

1. 题目原文约束 → Answer Spec 的自动提取质量；
2. 最终粒度、分子/分母、时间基线、单位和输出列的通用约束；
3. Reviewer 的结果证据和覆盖协议；
4. Solver 的探索/导出收敛；
5. 最后再做模型替换或 Prompt 微调。

不要针对单道题把 Gold SQL、Gold 数值或字段值写进全局 Prompt、Skill 或业务文档。

---

## 9. 常见误判

| 现象 | 正确解释 |
|---|---|
| `completed` | Agent 回合结束，不保证有 CSV 或正确结果 |
| SQL coverage 100% | 形成了 SQL 文件，不代表 SQL 正确 |
| CSV coverage 高 | 交付稳定，不代表业务语义正确 |
| 已提交分母分数高 | 可能遗漏了大量未提交题，优先看 fixed denominator |
| Reviewer `available` | Reviewer 成功返回结构，不代表判断准确 |
| Reviewer `approved` | 当前证据范围内未发现分歧，不是正确性证明 |
| `published_with_disagreement` | 已带分歧发布，不是 Approved 发布 |
| `query_database` 成功 | SQL 可执行，不等于符合题意 |
| reconciliation 成功 | 当前解释下的查询自洽，不等于题目语义正确 |
| Canary 200 | 单轮 API 可达，不代表多轮工具任务延迟足够 |
| 第 5 v2 14/86 | 失败集定向结果，不是 135 题全量成绩 |
| `completed` 且 0 工具调用 | 几乎肯定是首回合 provider 错误被吞没（第 11 轮 5 题）；在 Phase 1c 修复前必须人工排查 transcript，不计入模型语义错误 |
| `not_published_review_unavailable` | 第 11 轮前的 runner 在无 Receipt 时按最后一条 audit 贴此标签，“模型从未调用 export”和“导出被拒”都会得到它；不等于被阻断，必须看 trace 里有无 export 调用 |
| 与历史轮（如第 4 轮）直接比较得出机制效应 | 相隔数周、预算不同、同名模型可能已漂移；只能看趋势，归因必须靠同日同配置 control arm |

---

## 10. 交接验收清单

接手人完成以下项目后，才算真正接管：

- [ ] 能在 `D:/data_agent` 构建 Runtime 和 Server；
- [ ] 能通过 Spider2 evaluator 单元测试 17/17；
- [ ] 能通过 SQLite preflight；
- [ ] 能通过模型 canary，并确认 provider/API format；
- [ ] 能单题运行并得到 `result.json`、`trace.json` 和日志；
- [ ] 能对 10 题 Run 执行 score/report；
- [ ] 能区分 submitted denominator 和 fixed denominator；
- [ ] 能从 `cases.jsonl` 统计 timeout、max_turns、CSV 和 QA availability；
- [ ] 能从 `trace.json` 区分 SQL、Semantic、Delivery、Reviewer 和 Evaluator 问题；
- [ ] 新实验使用新的 Run ID，并保存配置、manifest、summary、official score 和 report；
- [ ] 正式实验前已处理工作区未提交改动和 Manifest 可复现性问题；
- [ ] 没有把模型密钥、Gold 答案或大体积数据库提交到 Git。
