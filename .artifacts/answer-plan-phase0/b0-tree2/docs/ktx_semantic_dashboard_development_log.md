
## 2026-08-18 — 收尾修正

- 收紧 V4 source 编译：catalog 中没有可执行 `table/sql` 的 source 直接报 `source_not_queryable`。
- 收紧视图布局校验：`span`、`height`、sidebar 和轴数量在编译前拒绝非法值，避免 HTML/CSS 注入和不可控布局。
- 修复前端宿主桥接的 React lint 级问题：dashboard handler 在 effect 前稳定声明，消息使用显式类型，旧 pointer listener 使用一次性监听。
- 完成最后回归：语义运行时与 API 测试 `10 passed`，Python 编译通过；前端 `npm test` 8 passed，`npm run build` 通过。
