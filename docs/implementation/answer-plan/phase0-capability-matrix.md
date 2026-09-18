# Phase 0 Host / 交付能力矩阵

状态：Phase 0 已关闭；源码、合同测试、冻结 Smoke 与独立复核均有证据。Electron 真人 GUI 发布流保留为灰度前产品验收项。

| 路径 | Query Assurance 组合位置 | result preview | CSV | 内联 | Durable Assurance State | 当前证据与限制 |
|---|---|---:|---:|---:|---:|---|
| Electron 产品 Host | `packages/electron-host/src/main.ts` 创建并注入 QueryAssurance 与 Electron QueryExecutor | 是 | 是，QueryExecutor stream/run 后走 Runtime Publication | 是，使用内存 preview rows 后走相同 Publication 核心 | 是，`userDataDir/metadata/query-assurance-state.json` | 源码接线完整；`index.test.ts`/`main.test.ts` 9/9 通过，覆盖 IPC 与 Runtime 启动，但无 LLM 配置的自动测试不能代替真人 GUI 发布流。构建 bundle 只能由构建生成，禁止手改。 |
| Spider2 Runner | `evaluations/spider2/run.mjs` 每 case 创建独立 QueryAssurance 与 Server MCP executor | 是 | 是 | 工具存在，但官方提取主要依赖精确 Receipt 对应的最终 SQL/CSV | 是，每 case `query-assurance-state.json` | 当前 local032 单题及固定十题均取得 SQL/CSV/合法 Receipt；binding invalid 为 0。官方正确率分别为 0/1 与 0/10，故这里只证明交付链路，不宣称业务正确。 |
| Web Server transport | `apps/server/src/index.ts` 接收外部构造的 Runtime；自身不创建 QueryAssurance/Harness | 取决于调用方注入 | 取决于调用方注入 | 取决于调用方注入 | 取决于调用方注入 | 不是独立 Assurance composition root。不能将 transport 单测视为完整产品发布流验收。P1–P3 应决定是增加显式 coordinator factory，还是把“不支持独立运行”作为能力声明。 |
| Reference SQLite MCP | `apps/server/src/reference-sqlite-mcp.ts` 只提供数据库能力 | 是 | 否，刻意不暴露 raw `export_query(sql)` | 否 | 否 | 正确行为是由 Runtime 持有发布权；现有测试验证 raw export 不存在。它不是最终交付 Host。 |

## 共享不变量

以下行为应由 Runtime 合同统一保证，而不是在 Host 中重复实现：

1. exploration Artifact 不可发布。
2. result Artifact 绑定当前 Spec revision/hash；修订后旧候选失效。
3. CSV 与内联候选均需通过相同 Candidate/Artifact 身份检查并取得 Receipt。
4. 重复发布返回同一已完成 Receipt，不能生成相互矛盾的交付。
5. 未支持能力必须显式声明，不能在导出末端才表现为随机 Review failure。

## Phase 0 动态验证结果

- Runtime 共享合同：CSV/inline 正向、exploration、伪 hash、错误 Candidate、旧 Spec、错误 Receipt与重复发布均由定向测试覆盖。
- Server MCP executor：stream 的列、顺序、空结果与 preview 一致性测试通过。
- Electron：构建与 9 个 Host/IPC 测试通过；需要 LLM/GUI 的人工发布 smoke 延后到灰度前产品验收，不作为 Phase 0 的数据库发布核心阻塞。Runtime 的 CSV/inline 发布合同由共享工具测试承担。
- Spider2：local032 冻结单题与固定十题 Smoke 已完成；精确结果、hash 和 Delivered/Correct Set 见 `phase0-baseline.md`。
