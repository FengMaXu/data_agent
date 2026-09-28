# Spider2 第 3 轮全量评测分析报告

## 1. 结论摘要

第 3 轮 SQLite 全量评测有效完成 135/135 题，无基础设施失败。修复后的固定分母端到端正确率从基线的 **28.15%（38/135）提升到 36.30%（49/135）**，净增 **11 题、8.15 个百分点，相对提升 28.9%**。

若采用基线报告剔除 `local275` 空 CSV 虚假得分后的审计口径，基线为 37/135；本轮相对审计基线净增 **12 题、8.89 个百分点**。

本轮最明确的改善不是单一 SQL 技巧，而是基础设施、工具路由和任务收敛：

- 工具错误从 273 次降至 61 次，下降 77.7%；
- SQL Guard 拦截从 122 次降至 5 次，剩余 5 次均为真实多语句请求，不再是 `UNION`/`REPLACE()` 误杀；
- SQLite 不支持函数错误从 37 次降至 0；
- Python 不可用错误从 27 次降至 0；
- Widget 调用从 15 次降至 0；
- 完成任务从 94 题增至 115 题；
- 平均工具调用从 18.27 次降至 16.04 次。

但语义正确性仍是主要瓶颈：116 个已提交 CSV 中仍有 67 个错误，其中 45 个结果形状不匹配 Gold，22 个形状相同但数值或业务语义错误。下一阶段应从“修工具链”转向“严格提取用户约束、输出列和结果粒度”。

## 2. 运行有效性

### 2.1 运行信息

| 项目 | 值 |
|---|---|
| Run ID | `spider2-local-improved-full-003` |
| 范围 | SQLite 135 题 |
| 并行度 | 3 |
| 模型 | `deepseek-chat` |
| Spider2 commit | `c2521ae94a8da35776c408885f00c081687d1c84` |
| Dataset SHA-256 | `67309a9c6517489fbb6d6b425d45ada79dd62d63b6b3476c84ddf9d4b02b67d9` |
| Evaluator SHA-256 | `78b13bd1be942b6e8026feab1d0a636f8798eaea0ffb1be23152edc70ff37118` |
| 执行状态 | `completed` |
| 完成题数 | 135/135 |
| 基础设施失败 | 0 |
| 执行墙钟时间 | 35 分 17 秒 |

结果目录：

`C:/data-agent-eval/runs/spider2-local-improved-full-003`

### 2.2 评分器编码问题

首次自动 SQL 评分在 Windows 下使用默认 GBK 读取 UTF-8 SQL，触发 `UnicodeDecodeError`，因此第一次生成的 SQL EX 为无效的 0 分。之后使用：

```bash
PYTHONUTF8=1 npm run eval:spider2 -- score --run spider2-local-improved-full-003
```

重新执行官方 SQL/CSV 评分并重建报告。本报告采用 `official_score/summary.json` 中 `scoredAt=2026-08-29T09:11:00.046Z` 的有效结果。

该问题属于评测 Runner 的跨平台编码缺陷，不是 Agent 正确率问题。后续应由 Runner 固定为 UTF-8，避免人工补跑。

### 2.3 可复现性限制

基线与本轮的 Spider2 数据集、官方评测器和模型一致，但存在两项比较限制：

1. 基线并行度为 1，本轮为 3，因此墙钟时间不能直接用于判断单题推理效率；平均单题耗时、工具调用和轮次仍可比较。
2. Manifest 只记录 Git HEAD，而本轮代码包含未提交改动；Manifest 未记录 Runtime dist、Server dist 和评测适配器哈希。因此当前证据足以核对本次结果，但不足以从 Manifest 单独完整还原 Agent 二进制版本。

## 3. 核心指标对比

| 指标 | 冻结基线 full-002 | 第 3 轮 full-003 | 变化 |
|---|---:|---:|---:|
| SQL EX（固定 135 题） | 38/135，28.15% | 49/135，36.30% | **+11 题，+8.15pp** |
| E2E EX（固定 135 题） | 38/135，28.15% | 49/135，36.30% | **+11 题，+8.15pp** |
| E2E EX（仅已提交） | 38/112，33.93% | 49/116，42.24% | **+8.31pp** |
| SQL 覆盖 | 135/135，100% | 135/135，100% | 持平 |
| CSV 覆盖 | 112/135，82.96% | 116/135，85.93% | **+4 题，+2.97pp** |
| completed | 94 | 115 | **+21** |
| max_turns | 25 | 12 | **-13（-52%）** |
| timeout | 16 | 8 | **-8（-50%）** |
| 平均单题耗时 | 59.79 秒 | 46.68 秒 | **-21.9%** |
| 平均轮次 | 13.31 | 11.39 | **-14.4%** |
| 平均工具调用 | 18.27 | 16.04 | **-12.2%** |
| 工具错误总数 | 273 | 61 | **-212（-77.7%）** |
| 墙钟时间 | 135 分 17 秒，并行 1 | 35 分 17 秒，并行 3 | -73.9%，主要受并行度影响 |

本轮 SQL EX 与固定分母 E2E EX 都是 49/135，但并非每题完全一致：

- `local157`：SQL 正确，但任务超时，未导出 CSV；
- `local218`：CSV 正确，但 SQL 在官方 Python SQLite 中因 `median()` 兼容性被判错。

因此固定分母 E2E 仍应作为主要交付指标。

## 4. 各项修复的实际效果

### 4.1 SQL Guard 修复成功

| Guard 错误 | 基线 | 第 3 轮 |
|---|---:|---:|
| `query_database` | 103 | 5 |
| `export_query` | 19 | 0 |
| 合计 | 122 | 5 |

第 3 轮剩余 5 次均为真实多语句 SQL，例如连续执行多个 `SELECT COUNT(*)`，应继续被只读单语句 Guard 拒绝。原有 `UNION` 和标量 `REPLACE()` 误杀已清零。

### 4.2 方言提示有效

- `NO_SUCH_FUNCTION`：37 → 0；
- `NO_SUCH_TABLE`：13 → 2；
- SQL 语法错误：23 → 12。

SQLite 方言提示和知识规则显著降低了 MySQL 函数、`information_schema` 等错误。当前剩余问题主要是列名、复杂 SQL 结构和超时，而不是全局方言误导。

### 4.3 Python、Widget 和导出链路恢复

| 工具 | 基线调用/错误 | 第 3 轮调用/错误 |
|---|---:|---:|
| `run_python` | 27/27 | 10/0 |
| `show_widget` | 15/7 | 0/0 |
| `export_query` | 161/23 | 121/0 |

Python 接线已恢复，纯查询评测中 Widget 已完全隐藏，最终导出工具没有执行错误。Analysis Skill 加载从 8 次降至 2 次，但仍有少量纯查询误加载，应继续观察。

### 4.4 Final Answer Contract 有效，但未完全解决形状问题

对已提交但错误的 CSV 与官方 Gold 进行形状比较：

| 指标 | 基线 | 第 3 轮 |
|---|---:|---:|
| 已提交 CSV | 112 | 116 |
| 正确 | 38 | 49 |
| 错误 | 74 | 67 |
| 错误且形状不匹配 | 64/74，86.5% | 45/67，67.2% |
| 错误但形状相同 | 10/74，13.5% | 22/67，32.8% |
| 全部提交中的形状匹配率 | 48/112，42.9% | 71/116，61.2% |

形状匹配率提升 18.3 个百分点，说明“标量、Top-N、分组或明细”的最终输出约束发挥了作用。但 45 个形状错误仍是最大的错误类别。

### 4.5 任务收敛明显改善

- 基线 41 题未正常完成，本轮降至 20 题；
- 25 个基线未完成任务在本轮转为 completed；
- 4 个基线 completed 任务在本轮退化为 timeout/max_turns；
- 本轮所有 20 个 timeout/max_turns 任务的 E2E 得分均为 0；
- `local073` 虽标记 completed，但未生成 CSV，说明“结束”与“完成交付”仍需进一步绑定。

## 5. 正确题变化

### 5.1 SQL EX 翻转

新增正确 18 题：

`local008, local009, local017, local019, local021, local023, local038, local039, local049, local055, local065, local070, local097, local157, local195, local201, local284, local300`

退化 7 题：

`local007, local081, local085, local131, local197, local229, local309`

净增 11 题。

### 5.2 E2E EX 翻转

新增正确 19 题：

`local008, local009, local017, local019, local021, local023, local032, local038, local039, local049, local055, local065, local070, local097, local195, local201, local218, local284, local300`

退化 8 题：

`local007, local081, local085, local131, local197, local229, local275, local309`

其中 `local275` 是基线空 CSV 被官方评分器误判通过的已知虚假得分，不属于真实能力退化。按审计口径，真实退化为 7 题，净增 12 题。

## 6. 当前主要问题

### 6.1 基础设施改善已转化为更大的“无工具错误”样本，但语义正确率没有同步提高

| 分组 | 基线 | 第 3 轮 |
|---|---:|---:|
| 无工具错误题数 | 49 | 91 |
| 无工具错误题 E2E 正确率 | 46.9% | 42.9% |
| 有工具错误题数 | 86 | 44 |
| 有工具错误题 E2E 正确率 | 17.4% | 22.7% |

修复成功地让更多任务进入“SQL 可以正常运行”的阶段，但无错误任务的条件正确率没有提高，反而受模型波动和语义退化影响略降。后续主要收益必须来自语义规划，而不是继续堆基础设施提示。

### 6.2 典型语义退化

退化案例显示 Agent 会用自己的推断覆盖用户的明确要求：

- `local081`：用户明确要求排除折扣，本轮 SQL 却乘以 `(1-discount)`；
- `local085`：要求三列且为百分比，本轮增加 `total_orders`，并输出 0–1 比率而非百分数；
- `local131`：要求分别统计第 1、2、3 偏好，本轮合并成一个总次数；
- `local197`：要求最大月环比差异一条记录，本轮 `LIMIT 10`；
- `local007`：用户要求对年、月、日差分别取绝对值，本轮改成借位日期差算法；
- `local309`：要求按年度累计积分，本轮改用赛季末 standings；
- `local229`：复杂 partnership 分段和个人得分口径仍不稳定。

这些问题不能通过增加 Spider2 单题答案解决。应增加通用的“用户约束逐项锁定”过程：过滤条件、包含/排除项、计算公式、单位、输出列、行数和排序都必须在 SQL 中逐项对应。

### 6.3 剩余工具错误结构

第 3 轮 61 次工具错误中：

- `query_database`：48 次；其中缺失列 19、语法错误 12、查询超时 5、真实多语句拦截 5、缺失表 2，其余 5；
- `read_knowledge` 路径错误：9 次；
- 调用不存在的旧工具 `read_knowledge_file`：3 次；
- 调用不存在的 `check_connection`：1 次。

`.pi/SYSTEM.md` 仍列出了 `read_knowledge_file`、`edit_knowledge_file`、`write_knowledge_file`、`save_learning` 等非当前工具名。虽然已删除 `TOOL_NAME_MAPPING`，System Prompt 本身尚未完全切换到 `tools-catalog.ts` 的规范名称，这是下一项明确修复。

### 6.4 未完成和未导出

本轮 12 个 max_turns、8 个 timeout；CSV 缺失 19 题。所有未完成题 E2E 均为 0。需要：

- 把“已成功得到最终结果”与“必须立即导出并结束”绑定得更强；
- 对查询超时增加更早的 SQL 简化策略；
- 对完成但未导出的任务增加运行时交付检查，而不只依赖 Prompt。

## 7. 下一轮改进优先级

### P0：评测可信度

1. Runner 启动官方 Python 评分器时强制 `PYTHONUTF8=1`。
2. Manifest 增加工作树 diff 哈希、Runtime dist、Server dist、Skills 和评测适配器哈希；不能只记录 Git HEAD。
3. 基线与改进轮使用相同并行度，以便比较延迟和供应商限流影响。

### P1：工具单一事实来源

1. 将 `.pi/SYSTEM.md` 中所有旧工具名替换为当前规范名。
2. 工具文档尽量由 `tools-catalog.ts` 生成或校验，禁止 Prompt、Skill、Runtime 再次漂移。
3. 删除不存在的 `check_connection` 暗示，并明确外部文档应使用 `read_file`、知识库文档使用 `read_knowledge`。

### P1：语义与输出契约

在生成 SQL 前建立通用约束表，并在导出前逐项复核：

- 必须包含和必须排除的条件；
- 用户指定的公式是否原样实现；
- 百分比、比率、货币和时间单位；
- 必须输出的列与禁止增加的中间列；
- 标量、Top-N、每组一行或明细的目标粒度；
- 最大/最小是按有符号值还是绝对值；
- Tie-breaker 和时间相邻关系。

### P2：SQL 稳定性

1. 针对缺失列错误，要求先从 `doc/db_schema.md` 确认精确列名。
2. 对复杂递归 CTE、相关子查询和大窗口查询增加超时前简化策略。
3. 对成功预览后的 SQL 禁止在未复验的情况下修改后直接导出。

## 8. 最终判断

本轮修复取得了真实且可量化的提升：官方固定分母 E2E 从 28.15% 提升到 36.30%，基础设施错误大幅下降，任务完成率和结果形状均明显改善。原改进建议中关于 SQL Guard、方言、Python、Widget、最终 SQL 提取和知识库继承的判断得到验证。

但尚未达到原先预估的 40%–46%。主要原因已经从基础设施转移为语义约束执行和最终输出精确性。下一轮若继续只增加方言或工具提示，边际收益会很低；应集中解决“严格按用户公式和输出形状执行”的通用规划能力。

## 9. 证据位置

- 本轮 Manifest：`C:/data-agent-eval/runs/spider2-local-improved-full-003/manifest.json`
- 本轮汇总：`C:/data-agent-eval/runs/spider2-local-improved-full-003/summary.json`
- 官方评分：`C:/data-agent-eval/runs/spider2-local-improved-full-003/official_score/summary.json`
- 自动报告：`C:/data-agent-eval/runs/spider2-local-improved-full-003/report.md`
- 每题结果与 Trace：`C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/`
- 冻结基线：`C:/data-agent-eval/runs/spider2-local-baseline-full-002/`
