# Data Agent 启动期 KTX Ingest 设计与实施计划

> 历史说明：本文件是 V1 讨论稿。生产实施以 `ktx_semantic_context_component_migration_v2.md` 和 `ktx_semantic_context_component_development_plan_v2.md` 为准。

## 1. 文档状态

- 状态：方案设计完成，尚未实施
- Data Agent：`D:\data_agent`
- KTX 参考实现：`D:\data_agent\ktx`
- 当前移植模块：`C:\Users\Negan\Desktop\context_engine\ktx_semantic_calculator_mcp`
- 第一原则：保留 KTX 完整能力边界，以最少的新代码完成启动集成

## 2. 最终结论

Data Agent 启动时显式执行 Ingest，但不新建独立 Ingest 进程，也不拆分 KTX 查询链路。

最终运行形态是：

1. Data Agent 的 `MCPManager` 启动一个 KTX Semantic MCP 实例。
2. Data Agent 启动服务在 MCP 连接完成后调用该实例的 `sl_ingest({})`。
3. 前端停留在启动界面并展示 MCP progress，不静默进入聊天。
4. Ingest 完成且存在有效语义目录后，Agent 直接调用同一实例的 `sl_query`。
5. KTX 自行完成连接选择、方言生成、只读校验和数据库执行。
6. Data Agent 现有 MySQL MCP 不参与 KTX 的 Ingest 或语义查询链路。

```text
Data Agent
  |
  +-- 启动控制面 --------------------+
  |                                  |
  |   SemanticIngestStartupService   |
  |       -> sl_ingest                |
  |                                  v
  +-- Agent 查询面 ------------> KTX Semantic MCP（唯一实例）
                                      |
                                      +-- ktx.yaml
                                      +-- Ingest adapters
                                      +-- semantic-layer YAML
                                      +-- Semantic Compute
                                      +-- Dialect
                                      +-- QueryExecutor
                                      +-- Native connectors
```

这里的“技术上异步、产品上前台”是指：后端使用异步任务执行，使健康检查和进度 API 可访问；前端仍阻止用户进入分析界面，直到启动状态允许继续。

## 3. 核心架构决策

### 3.1 一个 KTX MCP 实例

`sl_ingest`、`sl_query`、`sl_discover`、`sl_read_source` 和 `sl_validate` 属于同一个 KTX Semantic MCP。

Data Agent 只负责启动和调用这个已连接实例。`SemanticIngestStartupService` 不创建子进程，也不维护第二个 MCP client。

### 3.2 保留 KTX 原生查询链

生产查询链固定为：

```text
sl_query
  -> 读取已验证的 semantic-layer YAML
  -> 根据 ktx.yaml connection.driver 选择方言
  -> Semantic Compute 生成 SQL
  -> KTX QueryExecutor
  -> 对应 native connector.executeReadOnly()
  -> 返回有界结果
```

MySQL 的执行链为：

```text
KtxMysqlDialect
  -> MySQL SQL
  -> read-only SQL guard
  -> maxRows 限制
  -> KtxMysqlScanConnector.executeReadOnly()
  -> mysql2 pool
```

不采用以下中转路径：

```text
KTX compile SQL -> Data Agent -> MySQL MCP -> execute_sql
```

该中转会拆断 KTX 的 QueryExecutor 契约、产生两套查询错误语义，并让 Agent 宿主承担不属于它的 SQL 编排责任。

### 3.3 KTX 原生 connector 负责数据库 Ingest

实时数据库 Ingest 直接使用 KTX 已有 connector 的 `introspect()`、采样和关系发现能力。

Data Agent 不调用 `list_tables`、`get_table_schema` 后再转换 schema snapshot，也不为 KTX 增加 MySQL MCP bridge。

### 3.4 `ktx.yaml` 是唯一 KTX 配置

不新增 `semantic-ingest.yaml` 或 `connections.yaml` 作为第二份生产配置。

KTX 的来源拓扑、数据库 driver、来源路径、映射和 Ingest 策略统一来自项目根目录的 `ktx.yaml`。Data Agent 只配置 KTX MCP 的启动命令和项目目录。

### 3.5 凭据只引用，不复制

`ktx.yaml` 使用 `env:` 或 `file:` 引用敏感值。Data Agent 在启动 MCP 前已经加载运行时数据库配置，因此只需把相同环境变量传给 KTX 子进程。

配置示例：

```yaml
setup:
  database_connection_ids:
    - warehouse

connections:
  warehouse:
    driver: mysql
    host: env:MYSQL_HOST
    port: 3306
    database: env:MYSQL_DATABASE
    username: env:MYSQL_USER
    password: env:MYSQL_PASSWORD

  analytics_dbt:
    driver: dbt
    source_dir: analytics/dbt
    project_name: analytics

  business_metrics:
    driver: metricflow
    metricflow:
      repoUrl: https://example.test/metrics.git
      branch: main

ingest:
  adapters:
    - historic-sql
  workUnits:
    maxConcurrency: 1
    failureMode: continue
```

`connections` 的映射键就是稳定的来源或数据库身份，不再增加平行的 `sourceId` 概念。

## 4. 当前系统与目标差距

### 4.1 Data Agent

当前启动链为：

```text
Electron main.js
  -> 启动 FastAPI
  -> 等待 /health
  -> 加载 React

FastAPI lifespan
  -> app_runtime
  -> ConfigManager.startup()
  -> MCPManager.start()
  -> LLM Gateway warmup
```

当前缺少：

1. KTX Semantic MCP 配置。
2. MCP 连接后的启动 Ingest 服务。
3. Ingest progress 接收与状态 API。
4. React 启动门禁和重试界面。
5. `/agent/chat` 的语义目录就绪检查。
6. 对 KTX 工具的宿主调用与 Agent 可见性区分。

### 4.2 当前 KTX 移植模块

当前移植模块已经提供 `sl_discover`、`sl_read_source`、`sl_validate` 和 `sl_query`，但仍有两处关键差距：

1. 尚无配置驱动的统一 `sl_ingest` MCP 工具。
2. 当前生产执行装配只接受本地 `connections.yaml` 中的 SQLite/DuckDB，没有恢复原始 KTX 的 `ktx.yaml -> dialect -> QueryExecutor -> native connector` 链路。

因此，Data Agent 接入前必须恢复原始 KTX 查询装配。不能用 MySQL MCP bridge 掩盖这个移植缺口。

## 5. 范围

### 5.1 目标

1. Data Agent 每次启动时处理 `ktx.yaml` 中所有可 Ingest 的已配置连接。
2. 用户能看到连接级和阶段级进度。
3. KTX Ingest 与 KTX Query 使用同一项目配置、语义目录和 connector registry。
4. 重复启动无变化时快速返回 `unchanged`。
5. 一个来源不能删除其他来源或人工维护的语义产物。
6. Ingest 失败不破坏最近一次验证通过的目录。
7. Web、Electron 和 CLI 使用同一启动状态判断。
8. Data Agent 的语义查询始终走 KTX `sl_query` 完整链路。

### 5.2 非目标

第一阶段不增加：

1. 定时调度或常驻 Ingest daemon。
2. 分布式任务队列、持久化 job 数据库或事件总线。
3. 多连接并行 Ingest。
4. WebSocket；前端使用状态轮询。
5. 新数据库 driver 或新来源类型。
6. Data Agent 到 Database MCP 的 schema snapshot bridge。
7. Data Agent 的语义查询 wrapper 或 SQL 二次转发。
8. 与启动 Ingest 无关的新 LLM 推理功能。

## 6. 启动时序

```text
1. ConfigManager 载入 Data Agent 运行时配置和凭据环境变量
2. MCPManager 启动 Database MCP、KTX Semantic MCP 和其他服务
3. FastAPI 完成技术启动，/health 可访问
4. SemanticIngestStartupService 创建唯一 Ingest task
5. 调用已连接 KTX MCP 的 sl_ingest({})
6. KTX 读取 ktx.yaml，串行处理所有可 Ingest 连接
7. Data Agent 接收 MCP progress 并更新内存状态
8. KTX 完成目录校验并返回执行摘要
9. Data Agent 计算 ready / degraded / failed / skipped
10. React 根据状态进入聊天、显示警告或提供重试
```

`/health` 只表示后端进程存活，不等待 Ingest。业务就绪状态通过独立 API 暴露。

CLI 启动同样调用该启动服务，在进入交互前直接输出 progress。

## 7. `sl_ingest` 工具契约

### 7.1 输入

```json
{
  "connectionId": "optional"
}
```

语义：

- `{}`：按 `ktx ingest` 的既有语义处理全部已配置连接。
- `{"connectionId":"warehouse"}`：只处理指定连接，供失败重试和诊断使用。
- 不接受路径、driver、adapter、凭据或任意配置覆盖。

使用配置连接 ID 作为唯一选择键，不再引入 `sourceId`。

### 7.2 返回

KTX 返回执行结果，不返回 Data Agent UI 状态：

```json
{
  "status": "completed",
  "startedAt": "...",
  "finishedAt": "...",
  "connections": [
    {
      "connectionId": "warehouse",
      "driver": "mysql",
      "status": "updated",
      "artifactsWritten": 12,
      "warnings": []
    },
    {
      "connectionId": "analytics_dbt",
      "driver": "dbt",
      "status": "unchanged",
      "artifactsWritten": 0,
      "warnings": []
    }
  ]
}
```

KTX 顶层状态：

- `completed`：所有选择的连接成功或 unchanged。
- `partial`：至少一个连接成功，至少一个连接失败。
- `failed`：没有连接成功，或配置在执行前失败。

连接状态：

- `updated`
- `unchanged`
- `failed`
- `skipped`

### 7.3 Progress

复用 MCP progress notification：

```json
{
  "progress": 0.4,
  "message": "Generating semantic sources",
  "connectionId": "warehouse",
  "driver": "mysql",
  "phase": "project",
  "completed": 1,
  "total": 3
}
```

不增加新的流式协议。

## 8. 工具可见性

宿主和 Agent 使用同一个 MCP session，但工具权限不同：

| 工具 | Data Agent 宿主 | LLM Agent |
|---|---:|---:|
| `sl_ingest` | 允许 | 不暴露 |
| `sl_validate` | 允许 | 默认不暴露 |
| `sl_query` | 允许 | 暴露 |
| `sl_discover` | 允许 | 暴露 |
| `sl_read_source` | 允许 | 暴露 |

Data Agent 的 MCP bridge 对 `server_type=semantic` 使用一个明确的小型 allowlist，只桥接查询所需工具。不要建设通用权限平台，也不要复制 KTX 工具实现。

工具名继续使用 `sl_` 命名空间；如 Data Agent 统一增加 MCP server prefix，则最终名称由现有 prefix 规则确定。

## 9. KTX Ingest 编排

`sl_ingest({})` 复用原始 `ktx ingest` 的编排语义：

1. 读取并校验 `ktx.yaml`。
2. 确定全部可 Ingest 连接。
3. 数据库连接优先，先获取实时 schema。
4. 再处理 dbt、MetricFlow、LookML、Looker、Metabase 等上下文来源。
5. 启用时处理 historic SQL。
6. 每个连接依次执行 detect、stage、diff、project、reconcile、write、validate 和 archive。
7. 汇总连接结果并发送 progress。

第一阶段串行处理连接，并把 `ingest.workUnits.maxConcurrency` 限制在单连接内部的既有 WorkUnit 行为，不新增跨连接并行写入。

适配器和 connector 必须由生产 composition 显式注册。测试 fixture adapter 不进入默认生产集合。

## 10. 产物归属与删除边界

启动时自动处理全部连接前，必须保证来源隔离。

最小归属模型：

```json
{
  "artifacts": {
    "semantic-layer/warehouse/orders.yaml": {
      "ownerConnectionId": "analytics_dbt",
      "rawPaths": ["manifest.json"]
    }
  }
}
```

规则：

1. `ownerConnectionId` 使用 `ktx.yaml` 中的连接 ID。
2. 来源只能更新或删除自己拥有的产物。
3. 没有归属记录的人工 YAML 永不自动删除。
4. 两个来源声明同一产物时失败关闭，不按执行顺序覆盖。
5. 实体删除基于投影前后的语义实体 diff，不能只依据原始文件是否存在。
6. raw snapshot 使用来源连接 ID 隔离，避免相同 adapter 的多个连接碰撞。
7. 归属状态和 YAML 使用原子文件写入。

优先复用原始 KTX 已有的 isolated diff、target policy 和 provenance 能力；只为当前移植缺失部分补最小状态，不重新设计第二套来源系统。

## 11. 目录一致性与并发

同一 KTX MCP 实例内部维护一个项目级 catalog mutex：

1. `sl_ingest` 从写入开始到完整目录校验结束持锁。
2. `sl_query`、`sl_discover`、`sl_read_source` 和 `sl_validate` 在访问目录时使用同一锁。
3. 因此查询不会读取到半写入状态。
4. 第一阶段允许语义查询短暂串行；Data Agent 是单用户桌面应用，不引入读写锁。
5. 后续只有性能数据证明该锁成为瓶颈时，才升级为读写锁或 catalog generation swap。

启动阶段聊天尚未开放，通常不会发生竞争。mutex 主要保护 degraded 状态下的人工重试以及未来其他客户端调用。

## 12. 校验与 Last-Known-Good

1. 无变化时返回 `unchanged`，不改写 YAML 和归属状态。
2. 每个连接写入后校验目标语义目录。
3. 校验失败时回滚该连接本次写入。
4. 已经验证通过的目录始终可作为 last-known-good。
5. 后续连接失败不撤销此前已经验证通过的独立连接结果。
6. Data Agent 根据 KTX 执行摘要和最终 `sl_validate` 结果判断是否可 degraded。

## 13. Data Agent 启动状态

### 13.1 状态机

```text
checking
  -> ingesting
       -> ready
       -> degraded
       -> failed
  -> skipped
```

- `ready`：KTX 返回 completed，查询目录验证通过。
- `degraded`：本轮 partial/failed，但至少一个需要查询的目录仍验证通过。
- `failed`：没有可用语义目录，无法安全执行语义查询。
- `skipped`：没有配置或启用 KTX Semantic MCP，保持现有非语义模式。

KTX 的 `completed/partial/failed` 是执行结果；Data Agent 的 `ready/degraded/failed/skipped` 是产品就绪状态，两者不能共用一个枚举。

### 13.2 最小 API

```text
GET  /startup/status
POST /startup/semantic-ingest/retry
```

重试请求可选携带 `connectionId`。同一进程只允许一个 Ingest task；重复请求返回当前任务状态，不创建第二个任务。

### 13.3 聊天门禁

- `ready`：允许进入 Agent。
- `degraded`：允许进入，明确提示哪些连接使用旧目录或不可用。
- `checking`、`ingesting`：拒绝新聊天请求并返回未就绪状态。
- `failed`：拒绝语义分析并提供重试错误信息。
- `skipped`：保持当前普通数据分析能力。

后端必须执行同样的门禁，不能只依赖 React。

## 14. 前端体验

React 启动页轮询 `/startup/status`，展示：

1. 当前连接和阶段。
2. 已完成连接数和总连接数。
3. 每个连接的 updated、unchanged、failed 或 skipped 状态。
4. 首次失败时的错误摘要与重试按钮。
5. degraded 状态下不可用或未刷新的连接。

Electron 静态 loading 页面仍只等待 FastAPI 存活。来源级进度只在 React 实现，避免维护两套 UI。

界面不展示 adapter 内部步骤、文件路径或技术堆栈；详细信息进入日志。

## 15. Data Agent 现有 MySQL MCP 的位置

MySQL MCP 可以继续服务现有的普通 SQL、元数据工具和兼容调用，但它不是 KTX 语义链路的一部分：

```text
普通 SQL能力    -> Data Agent MySQL MCP
语义查询能力    -> KTX sl_query -> KTX native connector
语义 Ingest     -> KTX sl_ingest -> KTX native connector/adapters
```

两者可以连接同一个数据库，但使用不同的受控入口。凭据通过同一组环境变量引用，不在两个配置文件中保存两份明文。

是否最终迁移普通 SQL调用到 KTX 属于独立架构决策，不放入本次 Ingest 工作。

## 16. 错误与恢复

1. KTX MCP 未连接：使用现有 MCP startup/reconnect，不增加第二套重试框架。
2. `ktx.yaml` 无效：启动状态为 failed，返回字段级配置错误。
3. 数据库不可达：对应连接失败；其他连接是否继续由既有 failureMode 决定。
4. 来源转换失败：回滚该来源写入，保留有效目录。
5. 产物归属冲突：失败关闭，错误必须包含两个 owner connection ID。
6. 查询发生在 Ingest 期间：等待 catalog mutex，不读取中间状态。
7. 查询连接未完成有效 Ingest：`sl_query` 返回明确的 catalog-not-ready 错误。

## 17. 实施计划

### 阶段 1：冻结上游行为与契约

1. 以原始 KTX 的 `ktx ingest`、`sl_query`、driver registry 和 connector 行为建立 conformance baseline。
2. 冻结 `sl_ingest` 输入、结果和 progress contract。
3. 冻结 Data Agent 启动状态 DTO、聊天门禁和工具 allowlist。

验收：测试样例能够表达全量 Ingest、单连接重试、MySQL 原生查询和 partial/degraded 映射。

### 阶段 2：恢复 KTX 单一生产查询链

1. 让当前 MCP 从 `ktx.yaml` 读取连接和目录配置。
2. 复用原始 KTX 的 dialect、QueryExecutor 和 native connector composition。
3. `sl_query` 在生产装配中完成端到端只读执行。
4. 迁移测试后移除当前仅 SQLite/DuckDB `connections.yaml` 的重叠生产执行路径。

验收：MySQL `sl_query` 经过 KTX connector 返回有界结果，过程中没有调用 Data Agent MySQL MCP。

### 阶段 3：补齐多来源 Ingest 正确性

1. 使用连接 ID 建立产物归属。
2. 修正跨来源删除、文件内实体删除和重名冲突。
3. 修正 unchanged no-op。
4. 隔离 raw snapshot 和归属状态。
5. 保证失败回滚与 last-known-good。

验收：一个来源的更新或删除不影响其他来源和人工 YAML；重复运行不产生文件变化。

### 阶段 4：增加统一 `sl_ingest`

1. 复用 `ktx ingest` 的配置发现和执行顺序。
2. 显式注册全部既有生产 adapters/connectors。
3. 串行编排全部已配置连接。
4. 增加 MCP progress、执行摘要和 catalog mutex。
5. 将 `sl_ingest` 标记为 mutating、host-only 能力。

验收：一个空参数 MCP 调用可处理 `ktx.yaml` 中全部可 Ingest 连接，并且同实例随后可执行 `sl_query`。

### 阶段 5：接入 Data Agent 后端

1. 在 MCP 配置中增加一个 `server_type=semantic` 的 KTX Server。
2. 将 Data Agent 环境变量传给 KTX MCP，不复制明文凭据。
3. 实现 `SemanticIngestStartupService` 和唯一任务锁。
4. 为 MCP call 增加 progress callback。
5. 增加状态 API、重试 API和聊天后端门禁。
6. Agent 工具桥接只允许 `sl_query`、`sl_discover`、`sl_read_source`。

验收：MCPManager 只启动一个 KTX 进程；启动服务调用 `sl_ingest`，Agent 随后直接调用同实例的 `sl_query`。

### 阶段 6：前端、CLI 与发布验证

1. 实现 React 启动进度、失败重试和 degraded 提示。
2. CLI 在进入交互前输出同一启动服务的进度。
3. 验证 Web、Electron、CLI 和 Electron 打包后的 Node/Python sidecar。
4. 更新两个项目的开发计划、开发日志、WORKLOG 和相关 ADR。

验收：用户启动 Data Agent 后看到全部连接的 Ingest 过程，目录可用后进入分析，语义查询由 KTX 完整执行。

## 18. 测试矩阵

至少覆盖：

1. `sl_ingest({})` 处理 MySQL、dbt、MetricFlow、LookML 和 historic SQL 配置。
2. 数据库连接先于依赖它的上下文来源执行。
3. unchanged 重跑不改写目录。
4. 一个来源删除实体不影响其他来源。
5. 人工 YAML 不被自动删除。
6. 两个来源声明同一产物时失败关闭。
7. 校验失败回滚并保留 last-known-good。
8. 同一 KTX MCP 完成 Ingest 后执行 MySQL `sl_query`。
9. MySQL 查询使用 KtxMysqlDialect、read-only guard、maxRows 和 native connector。
10. Ingest 与查询并发时查询不读取中间目录。
11. `sl_ingest` 不出现在 Agent 工具列表。
12. `sl_query` 不调用 Data Agent MySQL MCP。
13. KTX 从 env 引用凭据，结果和日志不泄露凭据。
14. 首次失败、partial、degraded、skipped 和重试状态转换。
15. 重复启动或重试不创建第二个 Ingest task/KTX 进程。
16. Electron 开发与打包环境均能启动 KTX Node/Python runtime。

## 19. 简洁性约束

实现必须保持：

1. 一个 `ktx.yaml`，不增加平行来源配置。
2. 一个 KTX MCP 实例，不增加 Ingest sidecar。
3. 一条 KTX 查询链，不经过 MySQL MCP 转发。
4. 一个 Data Agent 启动服务，不为 Web、CLI、Electron 复制逻辑。
5. 一个项目级 catalog mutex，不提前建设读写锁。
6. 一个状态查询接口配合轮询，不增加 WebSocket。
7. 复用原始 KTX adapters、dialects、QueryExecutor 和 connectors，不做本地重写。
8. 只补当前移植缺失的 composition、归属和启动集成。

## 20. 完成定义

满足以下条件后，本模块才算完成：

1. Data Agent 启动自动处理 `ktx.yaml` 中全部已配置来源，而不是只处理 dbt。
2. 用户能看到连接级进度、失败原因和重试入口。
3. Agent 不会在语义目录不可用时开始语义分析。
4. `sl_ingest` 与 `sl_query` 运行在同一个 KTX MCP 实例。
5. MySQL 语义查询由 KTX 方言和 native connector 端到端执行。
6. 多来源不会互相覆盖或误删产物。
7. 刷新失败不会破坏最近一次有效目录。
8. Web、CLI、Electron 和打包环境通过验证。
9. 行为变更具有聚焦测试，并同步更新两个项目的开发记录。
