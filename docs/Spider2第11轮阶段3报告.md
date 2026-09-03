# Spider2 第 11 轮阶段 3 报告

> 状态：实现完成，固定十题验收待补跑
> 目标 Run ID：`round11-p3-001`

## 已完成

- 新增 `AnomalyRegistry`，按任务和观测去重，绑定 Answer Spec 槽位、Query Artifact、候选指纹与 D11 未变化异常。
- 新增确定性 `detectAnomalies` 适配，覆盖 G1/G2 形状与过滤观测、JOIN fanout、COUNT 与 DISTINCT 实值差异（仅在 Runtime 探针提供两者时触发）、实体总体、空结果过滤、空值样成员、物理边界、跨期集合、中间候选和指纹未变化。
- `afterToolCall(query_database)` 通过内部观测载荷运行检测器，结果补丁在返回 content 末尾附加异常事实、槽位、状态和说明；异常同时写入评测 `result.json`/`trace.json`。
- 查询探针预算按任务限制为最多 5 次；服务端与 Electron MCP 适配增加有界 JOIN 基数探针，使用最多 2,000,001 行的 bounded count，超限时不作结论。
- 运行器增加异常数量、检测器分布、槽位指纹多样性和解释 Hook 注入统计。

## 验证证据

- `npm run build:runtime`、`npm run build:server`、`npm run build:electron-host`：通过。
- `npm run test --workspace=@data-agent/runtime`：51 个测试文件通过，266 通过、1 跳过。
- `npm run test:eval:spider2`：17/17 通过。
- 本地集成烟测确认 fanout 探针证据会产生 `A-1 / join_fanout` 并附加到 `query_database` 返回。

## 固定十题运行

`round11-p3-002` 已启动并完成 4 题后因 OpenRouter 余额不足而停止：4/4 已完成并导出，随后 `local032` 收到供应商 402，不能将该运行视为完整验收。原 `round11-p3-001` 是旧配置/旧代码运行，不作为本阶段证据。

因此以下门槛尚未宣称通过：离线 D1-D11 命中对照、Gold 误报率、异常后指纹变化率和完整十题交付 A/B。补充运行需要可用的模型额度后使用固定 ID 清单重新执行。
