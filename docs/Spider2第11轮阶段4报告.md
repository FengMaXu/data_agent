# Spider2 第 11 轮阶段 4 报告

> 状态：验收通过
> Run ID：`round11-p4-deepseek-003`
> 模型：默认 `deepseek-chat`（DeepSeek OpenAI-compatible API）

## 修复内容

P4 前修复了 SQLite MCP 子进程超时后的连接复用问题：SQLite 查询在服务端同步执行时，客户端请求超时并不会自动终止已经阻塞的子进程；后续查询会排队在同一个失效进程之后，最终把单题拖到任务超时。现在 `mcp-query-executor` 在识别 MCP 请求超时后关闭并替换 stdio worker，评测配置将单次 MCP 预览请求上限设为 20 秒。

同时补齐候选自身同时返回 `COUNT(*)` 与 `COUNT(DISTINCT ...)` 时的确定性差异观测，使异常告知不依赖第二次探针成功。

## 验证证据

- `npm run build:runtime`：通过。
- `npm run build:server`：通过。
- `npm run build:electron-host`：通过。
- `npm test --workspace=@data-agent/runtime -- src/detectors.test.ts`：5/5 通过。
- `npm test --workspace=@data-agent/server -- src/mcp-query-executor.test.ts`：2/2 通过；新增测试复现“请求超时后下一次查询必须恢复”的实际故障链。
- `npm run test:eval:spider2`：17/17 通过。

## 固定十题验收

| 指标 | 结果 | P4 门槛 |
|---|---:|---:|
| 完成题数 | 10/10 | 无 timeout |
| SQL 覆盖 | 10/10 | 不低于 P3 |
| CSV 覆盖 | 10/10 | 不低于 P3 |
| `not_published_review_unavailable` | 0 | 不增加 |
| 平均工具调用 | 24.8 | 相对 P3 23.8 增量 +1.0，≤ 8 |
| 注册异常的任务数 | 7/10 | 触发后统计 |
| 异常记录数 | 9 | 观察值 |
| 触发后至少两条不同指纹候选 | 7/7 = 100% | ≥ 70% |
| 解释 Hook 注入 | 7 | 已触发任务均注入 |
| 带有效引用的解释选择 | 2/7 = 28.6% | 记录观察，不设硬目标 |
| 官方 SQL/E2E | 0/10 | P4 不设准确率门槛 |

## 结论

P4 通过。`local003` 已从上一轮的 300 秒任务超时恢复为 137.5 秒完成；本轮十题全部完成并导出。触发异常的 7 个任务均在后续产生至少两条不同槽位指纹的候选，比例 100%，超过 P4 的 70% 门槛。官方准确率仍为观察指标，不作为本阶段通过条件。
