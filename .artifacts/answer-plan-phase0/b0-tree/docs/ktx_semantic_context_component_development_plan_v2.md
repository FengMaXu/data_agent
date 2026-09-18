# Data Agent ktx 语义上下文组件开发计划 V2

## 1. 计划状态

- 状态：实施中（数据库 Public Ingest、无 embedding LLM enrichment、readiness/manifest 发布保护、bundle ownership/delete-isolation slice 和 SemanticContext 旧 `runLocalIngest` 分支退休已实现；真实 MySQL 25 表与 SQLite production enriched Ingest-to-Query 已通过，P3 全量 conformance、projection ownership、安装态和 P8 全部门禁仍未完成，不能声明整体完成）
- 对应方案：`docs/ktx_semantic_context_component_migration_v2.md`
- 产品仓库：`D:\data_agent`
- **ktx** 工作区：`D:\data_agent\ktx`
- 原则：先恢复原始能力，再接产品生命周期，最后替换旧路径

本计划不以“代码已写”为完成标准。每个阶段必须通过对应退出门禁，最终必须在安装包环境完成 Ingest 到 Query 的真实闭环。

## 2. 总体验收目标

```text
Data Agent startup
-> bundled ktx Semantic MCP
-> sl_ingest(all configured sources)
-> validated semantic-layer YAML
-> Agent sl_query
-> original ktx semantic compute
-> dialect SQL
-> QueryExecutor
-> native read-only connector
-> bounded result
```

同时满足：

- 一个 MCP 实例；
- 一个 `ktx.yaml`；
- 一个 Data Agent 数据库连接注册表和一个默认 LLM profile；
- 一个生产查询链；
- 一个 active Ingest job；
- 无 Database MCP 中转；
- 无旧 Python Gateway fallback；
- 无开发机路径和用户侧运行时安装要求。

## 3. 阶段总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 基线、边界和契约冻结 | 部分完成 |
| P1 | 原始 ktx Semantic Context application | Query application 已实现；数据库已接回 Public enriched scan，真实 MySQL/SQLite 产物 E2E 已验证 |
| P2 | Semantic-only MCP 与完整 Query 链 | 实现完成，MCP/SQLite composition smoke 通过 |
| P3 | 多来源 Ingest、归属与 Last-Known-Good | 局部实现和 focused gates 通过，全量 conformance 待补 |
| P4 | Ingest MCP、并发和 Ingest-to-Query E2E | MySQL 25 表/SQLite production enriched Ingest-to-Query 通过；MySQL manifest/FK/no-fanout 证据已补，完整并发与 rollback 门禁待补 |
| P5 | Data Agent 后端启动集成 | 统一连接/LLM、catalog 复用、显式刷新、reconnect 与 focused tests 完成 |
| P6 | 前端启动体验 | 统一数据库设置、ingest/refreshing 状态、前端实际 SSE 查询链通过，完整视觉状态机待补 |
| P7 | 产品打包与安装环境验证 | sidecar、unpacked artifact 和 NSIS installer 构建通过，实机安装 smoke 待补 |
| P8 | 生产切换、旧路径删除与最终审计 | 局部实施（SemanticContext 旧 Ingest 分支已退休；全量 P8 待实施） |

依赖顺序固定为：

```text
P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7 -> P8
```

P3 可以在 P2 Query contract 稳定后并行开发局部测试，但 P4 前必须全部合并并通过共享 conformance。

## 4. P0：基线、边界和契约冻结

### 目标

在修改生产代码前，建立能证明“复用原始 **ktx** 而非重新实现”的测试基线。

### 任务

- [x] 数据库连接复用原始 `runKtxScan(mode=enriched, detectRelationships=true)` 语义，不进入 context-source WorkUnit runner；
- [x] context-source 继续使用 SourceAdapter / WorkUnit / reconciliation，并与数据库 scan 结果合成同一 catalog；
- [x] 数据库 scan 生成 `_schema` manifest、relationship profile 和 diagnostics（MySQL 25 表真实产物已验收）；
- [x] 正式 FK、验证通过的推断关系和复合关系进入最终 join graph（MySQL 真实 manifest 含 4 条 formal join，关系 accepted/review 产物已验收）；
- [x] 宿主提供原始 scan 所需的 LLM、embedding 和 relationship 配置投影（真实 MySQL/SQLite profile 运行已验收，`embeddings: skipped` 不阻塞）；
- [ ] 固定源码 commit、Apache-2.0 许可证和 runtime artifact 版本；
- [x] inventory 原始 Project Loader、Semantic Compute、Dialect、QueryExecutor、connector registry、Ingest orchestration；
- [x] inventory 当前 Data Agent MCP 生命周期、配置、tool bridge、Electron 和 PyInstaller 打包入口；
- [x] 冻结 `sl_query` input/result/progress schema；
- [x] 冻结 `sl_ingest` 和 `sl_ingest_status` schema；
- [x] 冻结 Data Agent `/startup/status` DTO；
- [x] 建立旧 Python Gateway 与私有 `dist` adapter caller inventory；
- [ ] 记录所有 production adapters/connectors 及其 conformance 状态；
- [x] 创建 `D:\data_agent\ktx\docs\semantic-context-component-development-log.md` 作为 active log；
- [x] 把 V2 方案加入两个项目的 active development log。

### 重点文件

```text
D:\data_agent\ktx\packages\cli\src\context\sl\local-query.ts
D:\data_agent\ktx\packages\cli\src\ingest-query-executor.ts
D:\data_agent\ktx\packages\cli\src\local-scan-connectors.ts
D:\data_agent\ktx\packages\cli\src\context\ingest\
D:\data_agent\src\mcp\manager.py
D:\data_agent\frontend\electron\main.js
D:\data_agent\build.spec
```

### 验证

- 原始 `compileLocalSlQuery` conformance 通过；
- 原始 `createKtxCliIngestQueryExecutor` connector lifecycle 测试通过；
- 契约 fixture 可以表达完整 Query、全量 Ingest、单连接重试、partial 和 degraded；
- caller inventory 有可重复执行的 `rg` 命令。

### 退出门禁

没有新增运行时代码；所有后续阶段的输入、输出、错误和完成标准无歧义。

## 5. P1：原始 ktx Semantic Context Application

### 目标

在 **ktx** 源码内建立一个受支持、可嵌入、与 CLI 参数解析无关的应用入口。

### 设计

建议目录：

```text
packages/cli/src/semantic-context/
  contracts.ts
  application.ts
  query-runtime.ts
  catalog-publisher.ts
```

只在真实职责需要时建立文件，不预建空目录或未来接口。

### 任务

- [x] 定义严格 Zod Query request/result/progress schema；
- [x] `QueryRuntime` 组合 `loadKtxProject`、managed semantic compute 和 QueryExecutor；
- [x] Project 在组件启动时加载一次，配置 reload 使用一个明确方法；
- [x] Query 请求完整映射 measures、dimensions、filters、segments、order、limit、include-empty 和 max-rows；
- [x] Query 始终显式 `execute: true`，compile-only 不进入 Agent 生产工具；
- [x] 使用原始 driver 到 dialect 映射；
- [x] 使用原始 connector registry，不新增数据库 SDK wrapper；
- [x] 建立由 semantic-only stdio entrypoint 直接引用的源码级模块，不新增 package export；
- [x] 删除当前方案中的私有 `dist` 动态导入需求；
- [x] 为 Runtime 增加 fake port conformance 和真实源码 composition smoke。

### 不做

- 不调用 `ktx sl query` 命令；
- 不重新实现 Python Planner；
- 不增加 HTTP server；
- 不引入 Database MCP adapter；
- 不保留第二套 `connections.yaml`。

### 验证

```powershell
cd D:\data_agent\ktx
pnpm --filter @kaelio/ktx run type-check
pnpm --filter @kaelio/ktx run test
pnpm run dead-code
pnpm run build
```

Focused tests 至少覆盖：

1. 完整 Query DTO 映射；
2. 缺失/多个 connection 的 fail-closed；
3. dialect 选择；
4. `execute: true` 与 `maxRows`；
5. progress 转发；
6. connector capability 拒绝；
7. 成功和失败后的 cleanup；
8. 非法 request/result schema 拒绝。

### 退出门禁

应用入口可由测试直接调用并完成原始 QueryExecutor 链，不依赖 CLI argv、MCP 或开发机 npm package。

## 6. P2：Semantic-only MCP 与完整 Query 链

### 目标

把 P1 应用入口以最小 MCP 工具集暴露，建立第一条可运行生产候选链。

### 建议目录

```text
packages/cli/src/semantic-context/
  mcp.ts
  stdio.ts
```

### 任务

- [x] 建立 semantic-only MCP server，不注册 Wiki、Memory、任意 SQL 或管理工具；
- [x] 注册 `sl_discover`、`sl_read_source`、`sl_validate`、`sl_query`；
- [x] handler 只调用 `SemanticContextApplication`；
- [x] Query tool 使用 approved refs、typed filters 和 bounded limit；
- [x] structured content 与 text content 保持一致；
- [x] stdio stdout 只输出 MCP protocol，日志只写 stderr；
- [x] 统一错误码：配置、catalog、query、connector、execution、budget；
- [x] 增加 MCP Client initialize/list/call smoke；
- [ ] 增加 `ktx.yaml -> semantic YAML -> SQLite` 真实 E2E。

### 验证

至少证明：

```text
MCP sl_query
-> application
-> compileLocalSlQuery
-> managed semantic compute
-> SQLite dialect
-> KTX QueryExecutor
-> SQLite native connector
-> rows
```

测试中对 Database MCP 使用 forbidden fake，任何调用都立即失败，以证明无中转。

当前已增加 MCP SDK in-memory initialize/list/call，以及 `ktx.yaml` SQLite native connector 的同实例组合 smoke；该 smoke 注入 fixture ingest publisher，仅证明 application、catalog、compute、dialect、QueryExecutor 和 connector 的组合，不替代生产 adapter 或安装包退出门禁。真实生产 adapter 的 MySQL 同实例闭环在 P4 opt-in E2E 中通过。

### 退出门禁

同一 MCP 进程可以 discover、read、validate、query；SQLite 真实 E2E 通过；工具表中没有非语义工具。

## 7. P3：多来源 Ingest、归属与 Last-Known-Good

### 目标

复用原始 **ktx** Ingest 能力，补齐自动启动所需的多来源安全和幂等性。

### 任务

- [ ] 以 `ktx.yaml` connection ID 作为唯一来源身份；
- [ ] production registry 显式注册全部已支持 adapters/connectors；
- [ ] 统一 detect、fetch、stage、diff、WorkUnit、project、reconcile、validate、finalize、archive；
- [x] 建立 artifact ownership 和 provenance（bundle ingest production slice；MetricFlow deterministic projection 已接入精确 raw dependency）；
- [x] 来源只能删除自己拥有的产物（ownership + current content hash gate；未登记/手工修改产物 fail-closed）；
- [x] 人工 YAML 不自动删除（无 ownership 或 hash mismatch 不进入 eviction candidates）；
- [x] 两个来源写同一 semantic source 时失败关闭（ownership conflict 在 squash 前检查）；
- [x] 支持文件内 semantic entity 删除（MetricFlow declaration deletion 仅在 ownership + current hash + 全部 raw dependencies 删除时执行）；
- [x] unchanged 不改写文件和状态（bundle runner no-op 与 scan artifact reuse）；
- [x] validation 失败完整 rollback（隔离 worktree 未 squash；ownership persistence failure 回退刚创建的 squash）；
- [ ] historic SQL 只产生 evidence，不批准 measure；
- [ ] numeric column 不自动成为 measure；
- [ ] 无 grain 的 candidate 不进入 executable catalog；
- [ ] LLM 只能产生 proposal，不直接写 active 文件；
- [x] raw snapshot、ownership 和 staging 按 connection ID 隔离。

### 共享 SourceAdapter conformance

每个 production adapter 必须通过：

```text
detect
fetch
scope
diff
chunk
project
provenance
validation
delete isolation
unchanged no-op
```

### 测试来源

- live database metadata；
- dbt；
- MetricFlow；
- LookML / Looker；
- Metabase；
- historic SQL；
- fixture adapter 仅用于 conformance，不进入生产 registry。

### 退出门禁

任一来源的更新、失败和删除不会破坏其他来源或人工 YAML；重复运行无文件变化；last-known-good 可证明保留。

当前已通过 artifact gates、diff-set、finalization-scope、source-adapter-registry 和 stage-1 raw-file focused tests；本批新增 SQLite ownership index、content-hash eviction gate、共享 raw dependency delete isolation、MetricFlow file-internal deletion/manual protection 和跨来源冲突 focused tests。仍未形成全部 production adapter 的统一 conformance 报告。

## 8. P4：Ingest MCP、并发和 Ingest-to-Query E2E

### 目标

在同一 Semantic MCP 中完成显式、后台、可观察的 Ingest，并验证同实例 Query。

### 任务

- [x] 注册 host-only `sl_ingest`；
- [x] 注册 read-only `sl_ingest_status`；
- [x] 实现单项目单 active job；
- [x] 重复 start 返回 active job；
- [x] 空输入处理全部可 Ingest connections；
- [x] 指定 connection ID 支持重试；
- [x] 连接按确定性顺序串行处理；
- [x] 复用 MCP progress，不增加第二种流协议；
- [x] Ingest 状态只存内存，不增加 job database；
- [ ] acquire/project 在 staging 执行；
- [x] finalization 使用一个 catalog mutex；
- [x] Query 在 finalization 外读取 last-known-good（Semantic Context 在成功 validation 后捕获稳定 catalog snapshot，刷新失败继续使用旧 snapshot）；
- [x] 首次无 catalog 返回 `semantic_catalog_not_ready`；
- [x] 增加结构型 Ingest 后立即 Query 的同实例 E2E；
- [x] 增加 enriched scan、关系建图和跨 source Query 的同实例 E2E；真实 MySQL 25 表和 SQLite production E2E 已通过，MySQL `_schema`/relationship artifacts、formal FK joins、`embeddings: skipped` 和 `has_fan_out: false` 已断言。

### 必测场景

1. 全来源 completed；
2. 单来源 unchanged；
3. partial；
4. 全部 failed；
5. 重复 start；
6. MCP 重启后校验并复用有效 catalog；无有效 catalog 或显式 retry 时重新 Ingest；
7. Query 与长时间 staging 并发；
8. Query 与 finalization 并发；
9. validation rollback；
10. Ingest -> validate -> Query。

同实例 SQLite fixture smoke 仍只证明 Query Runtime、native connector 和 no-Database-MCP；另有 opt-in 真实 SQLite/MySQL E2E，要求 managed runtime、真实 LLM 与 `embeddings.backend: none`。本批已执行：SQLite production lane 2 tests passed；MySQL 25-table lane 1 test passed，并检查 enriched report、manifest、关系 artifacts、formal joins、无 embedding 和跨 source no-fanout 查询。

2026-08-12 Data Agent 源码态运行对 `qianhai_data_analysis` 的 25 张表生成 standalone source，并通过前端 SSE 查询到 `mart_industry_sales_summary.row_count = 22`；该历史证据仍是 structural/row_count 产品链路证据。随后本批修复后的 opt-in MySQL lane 已独立生成 25-table enriched `_schema` manifest、4 条 formal joins、关系 artifacts，并完成同实例跨 source no-fanout 查询，不能将两批证据混为一谈。

### 数据库验证

- [x] SQLite 真实 E2E：production live-database adapter、managed compute、native connector 通过；
- [x] MySQL 真实 read-only E2E：25-table enriched scan、manifest/relationship artifacts 和同实例跨 source no-fanout 通过，作为 Data Agent 目标场景；
- 其他 native connectors：共享 conformance 必跑，需凭据的 live smoke 作为发布前 opt-in lane；
- 所有 driver 都必须证明 capability、budget 和 cleanup 行为。

### 退出门禁

一个 MCP 实例完成 `sl_ingest -> sl_validate -> sl_query`；数据库连接必须走 enriched scan，正式 FK 和验证关系进入 `_schema` manifest，并通过至少一个跨 source 查询证明 join 无 fanout；MySQL 路径使用 **ktx** native connector，Database MCP forbidden fake 未被调用。上述 P4 核心数据库验收已由 opt-in SQLite/MySQL lanes 通过；共享 conformance、并发 staging/finalization、rollback/LKG 等其他门禁仍未完成。

## 9. P5：Data Agent 后端启动集成

### 目标

由现有 MCP Manager 管理组件生命周期，Data Agent 按 catalog 状态显式启动或刷新 Ingest，并形成统一产品状态。

### 建议文件

```text
D:\data_agent\src\semantic_startup.py
D:\data_agent\src\api\startup.py
D:\data_agent\src\mcp\manager.py
D:\data_agent\src\mcp\config_models.py
D:\data_agent\src\config_manager.py
D:\data_agent\server.py
```

实际实现优先匹配现有模块边界；不为凑目录创建空模块。

### 任务

- [x] 增加内置 `server_type=semantic` MCP 配置；
- [x] 增加唯一 `semanticProjectDir` 配置，指向 Electron userData 下的可写 **ktx** 项目；
- [x] 缺少有效 `ktx.yaml` 时进入 skipped，不猜测或生成隐式 connection；
- [x] MCP Manager 启动唯一 Semantic MCP；
- [x] 提供 host-side tool call，不经过 Agent tool bridge；
- [x] MCP ready 后先 `sl_validate`；无有效 catalog 时显式调用 `sl_ingest`，已有 catalog 则直接复用；
- [x] 轮询 `sl_ingest_status` 并维护唯一内存启动状态；
- [x] Ingest 完成后调用 `sl_validate`；
- [x] 映射 ready、degraded、failed、skipped；
- [x] 增加 `GET /startup/status`；
- [x] 增加 `POST /startup/semantic-ingest/retry`；
- [x] 同一进程禁止重复 startup task；
- [x] Agent tool allowlist 只暴露 discover、read、query；
- [x] semantic catalog 未就绪时后端执行门禁；
- [x] MCP reconnect 后状态恢复为 checking 并重新协调；
- [x] 用户显式 retry 对现有 catalog 执行后台 refresh，查询继续使用 last-known-good；
- [x] 建立 Data Agent 统一连接注册表，默认 Database MCP 与 Semantic MCP 共用连接定义；
- [x] 将旧单数据库配置迁移到注册表，并以结构化 YAML 维护受管 `ref`；
- [x] 复用现有默认 LLM profile，映射 Anthropic 和 OpenAI-compatible provider；
- [x] 数据库与 LLM secret 通过环境注入，不写 `ktx.yaml`、日志和状态 DTO。

### 验证

Focused pytest 覆盖：

1. MCP ready 后无有效 catalog 时启动一次 Ingest，已有有效 catalog 时不重复 Ingest；
2. 重复 startup/retry 不创建第二任务；
3. completed -> ready；
4. partial + last-known-good -> degraded；
5. no catalog -> failed；
6. no semantic configuration -> skipped；
7. reconnect；
8. tool allowlist；
9. chat/query 后端门禁；
10. secret redaction；
11. 多连接增删改、默认连接切换和旧配置迁移；
12. KTX 外部连接引用与默认 LLM profile 解析。
13. 显式 retry 刷新已有 catalog，长时间 ingest polling 不受旧 5 分钟主机超时限制。

### 退出门禁

Data Agent 后端不创建第二个 MCP client、不启动第二个 **ktx** 进程、不调用 Database MCP 完成语义操作。

## 10. P6：前端启动体验

### 目标

让用户看到显式 Ingest 状态，同时保持 UI 简洁。

### 任务

- [x] React 启动页轮询 `/startup/status`；
- [x] 显示当前 connection、phase、completed/total；
- [x] 显示 updated、unchanged、failed、skipped 摘要；
- [x] failed 提供重试；
- [x] degraded 明确不可用 connection；
- [x] refreshing 显示后台同步并允许继续使用 last-known-good；
- [x] ready 后进入现有分析界面；
- [x] 首次 checking/ingesting 阻止语义分析；
- [x] UI 不显示绝对路径、credential、SQL 或 adapter 内部细节；
- [x] Electron loading page 仍只负责等待 FastAPI health，不复制 Ingest UI。

### 验证

- React component/state tests；
- API mock 覆盖完整状态机；
- Playwright 覆盖首次成功、失败重试、degraded；
- 前端真实 `/agent/chat` SSE 覆盖 semantic discover、read、query，且禁止 Database MCP；
- 桌面和常用窗口尺寸无文本重叠。

### 退出门禁

产品上不是静默 Ingest；用户能理解当前状态和恢复动作，但界面不暴露实现细节。

## 11. P7：产品打包与安装环境验证

### 目标

使 Semantic MCP 在没有源码、系统 Node、系统 Python 和包管理器的用户机器运行。

### 构建产物

```text
dist/ktx-semantic-context/
  node/
  app/
  node_modules/
  python-runtime/
  licenses/
  manifest.json
```

### 任务

- [x] 新增确定性 build script，使用 `pnpm` 构建 **ktx**；
- [x] 固定并复制 Node 22 runtime；
- [x] 预构建并复制 managed Python runtime；
- [x] 复制 production dependencies 和 native modules；
- [x] 为 `better-sqlite3` 等 native dependency 执行 Windows rebuild/verification；
- [x] 生成包含版本、hash、license 的 manifest；
- [x] 将 runtime 目录加入 Electron `extraResources`；
- [x] Electron 启动后端时传入 runtime/resource 绝对路径；
- [x] Electron 创建或解析 userData 下的可写 semantic project directory；
- [x] PyInstaller 后端根据显式 resource path 配置 MCP command；
- [x] 开发模式与 packaged 模式只在路径解析不同，业务逻辑相同；
- [ ] 增加 unpacked 和 NSIS installed smoke；
- [ ] 验证无网络首启；
- [ ] 验证卸载不删除用户 `ktx.yaml`、semantic catalog 和 Data Agent workspace；
- [x] 汇总 Apache-2.0 和依赖许可证。

### 不采用

- 不依赖用户全局 Node/Python；
- 不在首次启动执行 `pnpm install`；
- 不使用私有开发机绝对路径；
- 不采用 Node SEA；
- 不要求 Data Agent Python 进程加载 Node module。

### 验证矩阵

| 环境 | 启动 | Ingest | Query | 退出清理 |
| --- | ---: | ---: | ---: | ---: |
| 开发源码 | 必须 | 必须 | 必须 | 必须 |
| PyInstaller backend | 必须 | 必须 | 必须 | 必须 |
| Electron unpacked | 必须 | 必须 | 必须 | 必须 |
| NSIS 安装后 | 必须 | 必须 | 必须 | 必须 |
| 无系统 Node/Python | 必须 | 必须 | 必须 | 必须 |
| 无网络首次启动 | 必须 | 必须 | 必须 | 必须 |

### 退出门禁

在干净 Windows 环境中安装后完成 `startup -> ingest -> query -> shutdown`，不访问开发机目录，不残留子进程。

已验证 sidecar manifest、固定 Node/Python 目录、unpacked 文件布局和 NSIS installer 构建；unpacked/NSIS 的真实启动、安装后无网络首启、卸载数据保留和子进程清理仍未通过实机门禁。标准 electron-builder 输出目录在本机遇到 Windows `EPERM rename`，本轮使用显式 Electron temp source 的构建 workaround 产出并验证了最终 artifacts，未把该 workaround 当作干净环境证明。

## 12. P8：生产切换、旧路径删除与最终审计

### 目标

将新组件设为唯一生产语义链，删除重叠实现和临时迁移代码。

### 任务

- [x] SemanticContextApplication 不再暴露或调用旧的直接 `runLocalIngest` fixture/production orchestration；`runKtxIngest(adapter=live-database)` 直达 bundle 的旧入口也已拒绝，统一经 Public Ingest Plan 分流；
- [ ] 生产 MCP 配置切到 bundled Semantic MCP；
- [ ] 删除旧 `SemanticGateway` 查询 caller；
- [ ] 删除旧 `python -m semantic_runtime` production invocation；
- [ ] 删除旧 local SQLite/DuckDB warehouse production registry；
- [ ] 删除 `connections.yaml` 生产配置；
- [ ] 删除 npm 私有 `dist` 动态 import adapter；
- [ ] 删除迁移期间 temporary wrapper 和 test-only production exports；
- [ ] inventory Data Agent、**ktx**、scripts、tests 和 build config；
- [ ] 确认 Query 不调用 Database MCP；
- [ ] 确认只有一个 Semantic MCP 进程；
- [ ] 更新 README、架构文档、运行手册、开发日志、WORKLOG 和第三方声明；
- [ ] 运行完整回归和发布 smoke。

### 删除门禁

旧路径只能在以下条件全部满足后删除：

1. P1-P7 全部退出门禁通过；
2. production caller 已切换；
3. installed smoke 通过；
4. caller inventory 为零；
5. 不需要 compatibility fallback。

### 最终验证

```text
ktx:
  type-check
  focused tests
  full tests
  dead-code
  build
  Python semantic-layer tests
  Python daemon tests

Data Agent:
  focused startup/MCP tests
  full pytest
  frontend type-check/build
  Playwright startup flow
  PyInstaller smoke
  Electron unpacked smoke
  NSIS installed smoke
  real MySQL read-only E2E
```

### 退出门禁

旧符号和生产 caller inventory 为零；新组件是唯一语义 Ingest/Query 路径；所有完成定义有测试或安装环境证据。

## 13. 跨阶段测试矩阵

### Query

- [ ] measure、dimension、granularity；
- [ ] filter、segment、order、limit、include-empty；
- [ ] 单连接自动选择；
- [ ] 多连接要求 connection ID；
- [ ] invalid semantic ref；
- [ ] dialect mapping；
- [ ] fan-out/chasm 规则；
- [ ] max rows；
- [ ] read-only guard；
- [ ] timeout/error normalization；
- [ ] connector cleanup；
- [ ] progress；
- [x] SQLite real E2E（production live-database + managed compute + native connector）；
- [x] MySQL real E2E（25-table enriched report/manifest/relationship/no-fanout lane）。

### Ingest

- [ ] 全连接发现；
- [ ] 单连接重试；
- [ ] adapter registry；
- [ ] added/modified/deleted/unchanged；
- [x] file-internal entity deletion（MetricFlow focused gate）；
- [x] ownership isolation（SQLite ownership + content hash）；
- [x] manual YAML protection；
- [ ] duplicate proposal；
- [x] cross-source conflict；
- [x] validation rollback（focused runner gate）；
- [x] last-known-good（stable query snapshot focused path）；
- [x] raw/provenance isolation；
- [ ] constrained LLM tools；
- [ ] repeated job idempotency；
- [ ] process restart recovery。

### Data Agent 与发布

- [x] host-only Ingest；
- [x] Agent tool allowlist；
- [x] startup state mapping；
- [x] retry；
- [x] reconnect；
- [x] semantic readiness gate；
- [x] secret redaction；
- [x] no Database MCP call；
- [x] one MCP process；
- [ ] no system runtime dependency；
- [ ] no network first start；
- [ ] clean shutdown；
- [ ] installed artifact hash/license verification。

## 14. 复杂性预算

实施过程中遵守以下硬约束：

1. 不新增第二个 Node package，除非现有 `@kaelio/ktx` 无法形成可测试的发布入口，并先用 ADR 证明独立生命周期。
2. 不新增 Ingest sidecar；Ingest 和 Query 同进程。
3. 不新增状态数据库；单 job 状态在内存。
4. 不新增 WebSocket；前端轮询现有 HTTP API。
5. 不新增远程服务和端口；使用 stdio MCP。
6. 不新增平行事实源；Data Agent 连接注册表和默认 LLM profile 是宿主配置源，`ktx.yaml` 只保存 **ktx** 项目策略与环境引用。
7. 不重写 KTX adapters、dialects、planner、executor 或 connectors。
8. 不保留旧新 fallback；迁移完成后直接删除旧路径。
9. 不为未来来源预建抽象；新来源通过现有 registry 和 conformance 接入。
10. 每个新增模块必须有至少两个真实生产调用方职责，或清晰的独立生命周期；否则合并到最近的应用模块。

## 15. 开发记录要求

每个阶段完成后同时更新：

```text
D:\data_agent\开发日志.md
D:\data_agent\docs\ktx_semantic_context_component_development_plan_v2.md
D:\data_agent\ktx\docs\semantic-context-component-development-log.md
C:\Users\Negan\Desktop\context_engine\WORKLOG.md（仅当迁移/删除参考模块）
```

每批记录：

```md
## YYYY-MM-DD：阶段和批次

### Decision

### Implemented

### Verification

### Residual / Risk

### Next exact step
```

不得把 fake conformance 写成 live endpoint 已验收，也不得把“模块可导入”写成“安装产品可用”。

## 16. 最终 Definition of Done

- [ ] V2 方案中所有生产功能已实现；
- [ ] P0-P8 全部退出门禁通过；
- [ ] 所有 production adapters/connectors 通过共享 conformance；
- [ ] SQLite 和 MySQL 真实端到端通过；
- [x] Data Agent 首次无有效 catalog 时显式 Ingest，后续启动校验复用，前台状态完整；
- [x] Ingest 与 Query 使用同一个 MCP 和 `ktx.yaml`；
- [x] Database MCP 与 Semantic MCP 使用同一连接注册表，Semantic Ingest 复用现有默认 LLM profile；
- [ ] last-known-good、rollback、ownership 和并发安全通过测试（ownership/rollback/LKG focused gates 已有；全量并发矩阵仍待补）；
- [x] Agent 工具权限符合 allowlist；
- [ ] 安装包无系统运行时和网络首启依赖；
- [ ] 旧 Python Gateway 和重叠执行路径已删除；
- [ ] no-fallback、no-Database-MCP、single-process inventory 通过；
- [ ] 文档、日志、许可证、发布说明和运维手册完成；
- [ ] 用户可以安装 Data Agent，等待显式 Ingest 完成，然后直接进行声明式语义分析。
