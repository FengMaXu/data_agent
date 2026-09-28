# Spider2 第 6 轮 GLM-5.3-Flash 全量评测报告

## 1. 结论摘要

本轮将测试模型切换为 OpenRouter `z-ai/glm-5.3-flash`，完成 SQLite **135/135** 题正式全量评测。官方固定分母成绩为：

- SQL EX：**26/135，19.26%**；
- E2E EX：**22/135，16.30%**；
- CSV 交付：**40/135，29.63%**；
- completed：**32/135，23.70%**；
- timeout：**103/135，76.30%**。

与第 5 轮 `deepseek-chat` 全量结果相比：

- SQL：`49 → 26`，下降 **23 题、17.04 个百分点**；
- E2E：`49 → 22`，下降 **27 题、20.00 个百分点**；
- CSV：`120 → 40`，下降 **80 题、59.26 个百分点**；
- completed：`114 → 32`，下降 **82 题**；
- timeout：`16 → 103`，增加 **87 题**。

结论：**在当前 120 秒单题超时、并发 4、OpenRouter Chat Completions 配置下，`z-ai/glm-5.3-flash` 不适合作为 Data Agent 的默认 Spider2 模型。** 主要失败不是数据库工具执行，而是模型/API 多轮响应耗时：超时题平均约 115.6 秒消耗在非工具阶段，数据库工具执行合计仅约 4.8 秒。

![Spider2 Round 6 comparison](assets/spider2-round6-model-comparison.png)

## 2. 评测配置

| 项目 | 本轮配置 |
|---|---|
| Run ID | `spider2-local-round6-glm53-full-001` |
| 范围 | SQLite 135/135 |
| 模型 | `z-ai/glm-5.3-flash` |
| 接口 | OpenRouter OpenAI-compatible Chat API |
| 并发 | 4 |
| 单题超时 | 120 秒 |
| 最大轮数 | 20 |
| Spider2 commit | `c2521ae94a8da35776c408885f00c081687d1c84` |
| System Prompt SHA-256 | `7cea6eff…b9` |
| 数据集 SHA-256 | `67309a9c…67d9` |
| 官方评分器 SHA-256 | `78b13bd1…7118` |
| Model canary | HTTP 200，1.992 秒 |
| 正式运行状态 | completed，基础设施失败 0 |

本轮使用与第 5 轮 v2 定向复测相同的 System Prompt 和“只导出最小最终结果”评测追加提示。运行尾部 `local360` 超时后，主进程没有自动完成收尾；使用 `--resume` 复用已有 134 题并补齐该题，最终形成 135 题固定分母和官方评分。评分完成后还发现原挂起进程树残留了大量 MCP 子进程，已统一终止；这不改变评分结果，但暴露了 timeout/abort 后的进程清理缺陷。

复现注意：Manifest 中 Agent commit 为 `105114d`，但本轮提示词和评测追加提示存在未提交工作区改动；System Prompt 有独立哈希，评测追加提示则需要结合当前工作区版本识别。因此本轮具备结果证据，但代码快照的可复现性不如一次完全提交后的 formal run。

## 3. 核心指标对比

| 指标 | 第 4 轮 DeepSeek | 第 5 轮 DeepSeek | 第 6 轮 GLM-5.3-Flash | 第 6 轮相对第 5 轮 |
|---|---:|---:|---:|---:|
| SQL EX（固定 135） | 56/135，41.48% | 49/135，36.30% | **26/135，19.26%** | **-23，-17.04pp** |
| E2E EX（固定 135） | 55/135，40.74% | 49/135，36.30% | **22/135，16.30%** | **-27，-20.00pp** |
| SQL EX（已提交） | 56/133，42.11% | 49/135，36.30% | 26/113，23.01% | -13.29pp |
| E2E EX（已提交） | 55/123，44.72% | 49/120，40.83% | 22/40，55.00% | +14.17pp* |
| SQL 覆盖 | 98.52% | 100.00% | **83.70%** | -16.30pp |
| CSV 交付 | 91.11% | 88.89% | **29.63%** | -59.26pp |
| completed | 91.11% | 84.44% | **23.70%** | -60.74pp |
| timeout | 8.15% | 11.85% | **76.30%** | +64.45pp |
| 平均耗时 | 52.61 秒 | 57.45 秒 | **108.30 秒** | +50.85 秒 |
| 平均轮数 | — | 12.21 | **6.85** | -5.36 |
| 平均工具调用 | 17.21 | 17.21 | **10.24** | -6.97 |
| 整轮墙钟时间 | 30:08 | 33:28 | **62:03** | +28:35，约 +85% |

`*` 第 6 轮已提交 E2E 分数 55% 存在严重选择偏差：只交付了 40 题，主要是更容易且更快完成的题目。正式比较必须使用固定 135 题分母的 16.30%，不能据此认为模型质量更高。

## 4. 同提示词下的模型对照

为了尽量隔离提示词变化，将第 5 轮 v2 的 86 个固定失败题与第 6 轮全量中的同一批 86 题比较。两者使用相同 System Prompt 哈希和相同“最小最终结果”追加提示，主要差异是模型。

| 指标 | DeepSeek v2 定向复测 | GLM-5.3-Flash 同批题 | 变化 |
|---|---:|---:|---:|
| SQL 正确 | 14/86 | 5/86 | -9 |
| E2E 正确 | 14/86 | 4/86 | -10 |
| CSV 交付 | 68/86 | 16/86 | **-52** |
| completed | 66/86 | 12/86 | **-54** |

GLM 保留了 DeepSeek v2 的 3 个正确题：

```text
local097  local202  local209
```

GLM 新增通过：

```text
local244
```

GLM 丢失了 DeepSeek v2 已通过的 11 题：

```text
local007  local020  local026  local039  local055  local059
local141  local157  local195  local228  local229
```

这组同提示词对照进一步说明，本轮下降不能主要归因于“最小结果”提示；模型/API 在多轮任务中的完成能力是更直接的差异来源。

## 5. 运行稳定性分析

### 5.1 状态与交付矩阵

| 状态 | 题数 | 有 SQL | 有 CSV | SQL 正确 | E2E 正确 | 平均耗时 |
|---|---:|---:|---:|---:|---:|---:|
| completed | 32 | 32 | 32 | 19 | 19 | 69.38 秒 |
| timeout | 103 | 81 | 8 | 7 | 3 | 120.40 秒 |

关键观察：

1. 22 题在超时前连 SQL 都没有形成；
2. 95 题没有 CSV；
3. 103 个 timeout 中只有 8 题在超时前完成导出；
4. 4 题 SQL 正确但没有 E2E 结果：`local021`、`local081`、`local128`、`local195`；
5. 如果任务能够在超时前正常 completed，E2E 为 `19/32=59.38%`，说明交付中断比已完成答案的值错误更严重。

### 5.2 超时贯穿整个运行，不是尾部单点退化

按原题目顺序分成三组，每组 45 题：

| 区段 | completed | timeout | CSV | E2E 正确 |
|---|---:|---:|---:|---:|
| 前 45 题 | 9 | 36 | 14 | 7 |
| 中 45 题 | 15 | 30 | 16 | 11 |
| 后 45 题 | 8 | 37 | 10 | 4 |

三个区段的 timeout 分别为 80.0%、66.7% 和 82.2%。因此问题从运行开始即存在，并非只在配额耗尽或运行尾部出现。

### 5.3 时间主要消耗在非工具阶段

根据轨迹中工具调用起止时间做近似分解：

| 状态 | 平均总耗时 | 平均工具执行并集 | 平均非工具时间 |
|---|---:|---:|---:|
| completed | 69.38 秒 | 4.64 秒 | 64.73 秒 |
| timeout | 120.40 秒 | 4.75 秒 | **115.64 秒** |

工具执行时间在 completed 与 timeout 中几乎相同。超时主要发生在模型响应、Agent 回合调度或 OpenRouter 上游等待阶段，而不是 SQLite 查询阶段。简单的单轮 “Reply with OK” canary 虽然 1.992 秒成功，但没有代表多轮工具调用任务的真实延迟。

## 6. 逐题正确性变化

### 6.1 E2E：第 5 轮 → 第 6 轮

**新增正确 4 题：**

```text
local097  local202  local209  local244
```

**保持正确 18 题：**

```text
local009  local022  local038  local041  local054  local058
local065  local071  local074  local085  local130  local193
local198  local199  local210  local221  local274  local329
```

**回归 31 题：**

```text
local004  local008  local018  local021  local023  local028
local030  local031  local049  local056  local068  local070
local072  local075  local078  local081  local099  local128
local132  local152  local163  local196  local197  local201
local218  local219  local262  local284  local300  local309
local310
```

净变化：`4 - 31 = -27`，对应 E2E `49 → 22`。

31 个回归题中：

- 25 题没有 CSV，主要为超时交付失败；
- 6 题有 CSV但结果错误：`local028`、`local031`、`local049`、`local056`、`local068`、`local196`。

因此约 81% 的回归首先表现为没有最终交付，而不是已交付值错误。

### 6.2 SQL：第 5 轮 → 第 6 轮

- 新增正确：5 题：`local097`、`local195`、`local202`、`local209`、`local244`；
- 保持正确：21 题；
- 回归：28 题；
- 净变化：`5 - 28 = -23`，对应 SQL `49 → 26`。

第 5 轮原有 49 个 E2E 正确题在本轮只保留 18 个，保留率为 **36.73%**。

## 7. 提示词改进的观察

本轮仍能看到最小结果提示的局部正向案例：

- `local202` 和 `local209` 继续通过；
- `local244` 从前两次失败变为通过；
- 已完成并导出的 40 题中有 22 题 E2E 正确。

但模型稳定性使提示词收益无法充分发挥：

- `local020`、`local039` 等第 5 轮 v2 已修复题，本轮在完成答案前超时；
- 规则执行错误数虽然下降，但主要因为平均轮数从 12.21 降到 6.85，模型更早超时，不能解释为工具使用质量提升；
- `EXPORT_SQL_NOT_VALIDATED` 从 62 次降至 14 次、查询错误从 43 次降至 7 次，同样受到工具调用减少的强烈影响。

## 8. 结论与建议

### 8.1 模型选择结论

当前配置下不建议采用 `z-ai/glm-5.3-flash`：

- 固定分母 E2E 仅 16.30%；
- 76.30% 题目超时；
- CSV 交付仅 29.63%；
- 相同提示词、相同 86 题上，DeepSeek v2 为 14 题正确，GLM 仅 4 题正确。

### 8.2 如果继续验证 GLM

1. 先做 15–20 题 pilot，不直接运行 135 题；
2. 将并发从 4 降至 1 或 2，验证 OpenRouter 上游并发延迟；
3. 将单题超时临时提高至 240 秒，区分“模型最终能完成但慢”与“无法收敛”；
4. 增加多轮工具调用 canary，而不是只测试单轮短回复；
5. 记录每次模型 API 请求耗时和上游 provider 元数据，定位 OpenRouter 路由延迟；
6. 继续保留 DeepSeek 作为当前已验证基线；
7. 提交当前提示词和评测器追加提示后再做正式基线，避免 Manifest commit 与实际工作区不一致；
8. 修复评测运行器在 timeout/abort 后未可靠退出并遗留 MCP 子进程的问题。

## 9. 证据文件

- 第 6 轮运行目录：`C:/data-agent-eval/runs/spider2-local-round6-glm53-full-001/`
- 官方评分：`C:/data-agent-eval/runs/spider2-local-round6-glm53-full-001/official_score/summary.json`
- 官方报告：`C:/data-agent-eval/runs/spider2-local-round6-glm53-full-001/report.md`
- 结构化分析：`C:/data-agent-eval/runs/spider2-local-round6-glm53-full-001/analysis/comparison-summary.json`
- 第 5→第 6 轮逐题对比：[`round6-glm53-vs-round5-case-comparison.csv`](../evaluations/spider2/round6-glm53-vs-round5-case-comparison.csv)
- 第 5 轮 v2 报告：[`Spider2第5轮版本2定向复测分析报告.md`](Spider2第5轮版本2定向复测分析报告.md)
