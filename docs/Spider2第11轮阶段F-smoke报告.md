# Spider2 第 11 轮 Phase F-smoke 报告

> 状态：通过 smoke，可进入 P6' 的 few-shot arm
> Run ID：`round11-fewshot-smoke-001`
> 对照：`round11-p5-deepseek-001`
> 后端：SQLite
> 模型：`deepseek-chat`
> 题目：固定 10 题

## 验收结果

| 指标 | P5 对照 | F-smoke | 判定 |
|---|---:|---:|---|
| 题目数 | 10 | 10 | 完成 |
| SQL 覆盖 | 10/10 | 10/10 | 不下降 |
| CSV 覆盖 | 10/10 | 10/10 | 通过 |
| 首候选 D1/D8 登记数 | 1 | 0 | 通过（不增加） |
| 注册异常总数 | 6 | 0 | 观察 |
| 解释 Hook 注入 | 4 | 0 | 观察 |
| 状态 | completed=10 | completed=10 | 通过 |

官方准确率不作为 F-smoke 门槛；两次烟雾均为 0/10，仅保留为观察项。

## 可复现指纹

- P5 `systemPromptSha256`：`99e2563c8c21c38da7a744537411f55dafb09309486b8b003c7b7823f0035343`
- F-smoke `systemPromptSha256`：`eeb6eb6309d54e7e8b9b6f7834559a9bd7f52362fd813197bc9593016f07c515`
- F-smoke `concurrency`：3
- F-smoke `limits`：`timeoutMs=300000`、`maxTurns=20`、`maxToolCalls=50`、`maxExploratoryQueries=6`

F-smoke 的并行度按当前执行要求使用 3；P5 历史运行使用并行度 1，因此本报告只判定 smoke 的不破坏性和 D1/D8 不增加，不把准确率或异常差异归因于 few-shot。满足“未增加首候选 D1/D8、CSV 不下降、10 题正常完成”的条件，允许进入全量 `round11-full-003-fewshot`。
