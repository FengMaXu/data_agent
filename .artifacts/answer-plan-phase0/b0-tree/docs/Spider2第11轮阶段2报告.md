# Spider2 第 11 轮阶段 2 报告

## 结论

P2 已通过固定十题验收：成功发布后 Hook 返回 `terminate: true`，每题均有单次发布 Hook 记录，trace/result 中出现 `type: hook_fired`。

## 实现

- 新增 `packages/runtime/src/hooks/assurance-hooks.ts`，通过当前 pi-agent-core 的 `harness.on("tool_call"|"tool_result"|"context")` 接线，不使用计划中不存在的 `DatareadHarness` options API。
- 默认 Hook 仅在成功且带 Publication Receipt 的 `export_query`/`publish_query_result` 结果后终止回合。
- Hook telemetry 通过 runner 的 `hookEvents` 写入 `result.json` 与 `trace.json`；telemetry 失败不会改变工具结果。
- 新增 Hook 单元测试，覆盖发布成功、错误/阻断结果、非发布工具、接线与解除接线。

## 固定十题证据

Run ID：`round11-p2-001`

- 10/10 completed
- SQL coverage：10/10
- CSV coverage：10/10
- publication status：10/10 `published_with_disagreement`
- 每题发布 Hook 数：1/1，且最后工具调用为成功发布
- 平均工具调用：21.9；P1a 为 23.7
- trace 中每题存在 `hook_fired`，发布事件的 `action=patch`

## 残余风险

当前 Hook 仅完成 P2 无判断路径；P3 的 query_database 异常检测、P4 解释枚举和 P5 两种完整性阻断尚未接入。
