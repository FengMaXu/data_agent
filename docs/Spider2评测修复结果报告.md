# Spider2 评测修复结果报告

## 1. 报告范围

本报告记录依据 `docs/Spider2评测改进建议.md` 对 Data Agent、Spider2 评测适配器及评测运行环境进行的修复，以及当前已完成的验证结果。

评测后端：SQLite
Spider2 版本：`c2521ae94a8da35776c408885f00c081687d1c84`

## 2. 修复结果总览

### P0 基础设施

1. **数据库方言动态化**：增加 SQLite/MySQL/BigQuery/Snowflake 方言提示，评测时按实例注入 SQLite 方言。
2. **SQL Guard 修复**：允许合法 `UNION`、`UNION ALL` 和标量 `REPLACE()`；继续拦截 `INSERT`、`REPLACE INTO`、`DROP` 等写操作。
3. **Python 与可选工具接线**：评测正确传入 Python 解释器和工作区；评测模式隐藏 `show_widget` 与 `generate_dashboard`。
4. **Widget 合同统一**：统一为 `kpi/chart/table/steps`，数据入口为 `spec`。
5. **评测知识库继承基础规则**：不再用空壳覆盖 `rules.md` 和 `learning.md`，而是保留通用规则并追加评测范围规则。
6. **最终 SQL 提取修复**：`selectFinalSql` 只接受已完成、非错误且包含 SQL 的工具调用。
7. **评测器边界修复**：空结果 CSV 保留表头；拒绝零字节 CSV；修复 `maxTurns` 多执行一轮的问题。

### P1 Agent 行为

8. **Final Answer Contract**：增加结果粒度、最终变换、SQL 复验和导出后停止规则。
9. **SQLite 方言知识**：加入日期、除法、字符串、分页、NULL 等 SQLite 规则。
10. **导出完成信号**：`export_query` 成功后返回 `taskComplete` 和停止可选工具的提示。
11. **不可用 Python 熔断**：Python 不可用时明确禁止重试，并提示回退到 SQL。
12. **Skill 工具交集约束**：Skill 声明的工具只能收窄当前已注册工具，不会重新引入隐藏工具。

### P2 语义正确性

13. **SQL 语义自检**：增加粒度、JOIN 基数、浮点除法、窗口边界、Tie-breaker、NULL 和时间边界检查。
14. **Analysis Skill 触发收紧**：仅在用户明确要求图表或可视化时使用，不再匹配普通查询、统计和导出任务。

### P3 稳定性与知识治理

15. **重复错误早停**：相同工具错误连续出现时，返回策略切换提示，避免无限重复调用。
16. **学习记录治理**：清理占位和重复内容，标注方言适用范围，并对重复 `append_learning` 做去重。

## 3. 自动化验证

已完成以下验证：

- Runtime 测试：115 通过，1 跳过。
- Server 测试：14 通过。
- Spider2 评测器测试：12 通过。
- Skill、SQL Guard、空结果 CSV、Python 不可用和重复错误熔断测试通过。
- `npm run build:distribution`：通过。
- `git diff --check`：通过。

## 4. 修复后冒烟评测

运行目录：

`C:/data-agent-eval/runs/spider2-local-improved-full-001`

运行规模：10 个 SQLite 任务。

| 指标 | 结果 |
|---|---:|
| SQL 正确 | 4/10 |
| 端到端正确 | 4/10 |
| CSV 生成 | 8/10 |
| 已完成 | 8/10 |
| 超时 | 1/10 |
| 达到 max turns | 1/10 |
| 平均工具调用 | 14.9 次 |
| Python 不可用错误 | 0 次 |
| Widget 合同错误 | 0 次 |

该冒烟结果用于确认修复链路生效，不作为 135 题正式成绩。由于模型调用具有随机性，不能将该 10 题结果直接与历史冒烟结果做因果性比较。

## 5. 第 3 轮全量评测结果

全量运行 `spider2-local-improved-full-003` 已完成 SQLite 135/135 题，无基础设施失败。

| 指标 | 冻结基线 | 第 3 轮 | 变化 |
|---|---:|---:|---:|
| SQL EX（固定分母） | 38/135，28.15% | 49/135，36.30% | +11 题，+8.15pp |
| E2E EX（固定分母） | 38/135，28.15% | 49/135，36.30% | +11 题，+8.15pp |
| CSV 覆盖 | 112/135，82.96% | 116/135，85.93% | +4 题，+2.97pp |
| completed | 94 | 115 | +21 |
| 工具错误 | 273 | 61 | -77.7% |
| 平均工具调用 | 18.27 | 16.04 | -12.2% |

按基线报告剔除 `local275` 空 CSV 虚假得分后的审计口径，正确题从 37 增至 49，净增 12 题。

详细全量结果见 `docs/Spider2第3轮全量评测报告.md`；未通过 86 题的逐案例推理审计见 `docs/Spider2第3轮未通过题目推理审计报告.md`。

## 6. System Prompt 与工具清单的单一事实来源

已删除 `DATA_AGENT_SYSTEM_PROMPT`、`TOOL_NAME_MAPPING` 和 `formatToolMapping()`。

当前约束为：

- `.pi/SYSTEM.md` 是唯一完整 System Prompt；
- `tools-catalog.ts` 是规范工具清单；
- `runtimeCapabilitiesPrompt()` 只描述当前 Harness 实际注册的工具，不做旧工具名映射；
- 找不到 `.pi/SYSTEM.md` 时显式抛出 `SYSTEM_PROMPT_NOT_FOUND`，不再静默降级到残缺提示词。

## 7. 相关文件

- `docs/Spider2第3轮全量评测报告.md`
- `docs/Spider2评测改进建议.md`
- `docs/Spider2基线评测报告.md`
- `docs/Spider2工具路由错误分析.md`
- `evaluations/spider2/run.mjs`
- `evaluations/spider2/lib.mjs`
- `packages/runtime/src/agent-assembly.ts`
- `packages/runtime/src/sql-guard.ts`
- `packages/runtime/src/tools-catalog.ts`
- `apps/server/src/reference-sqlite-mcp.ts`
