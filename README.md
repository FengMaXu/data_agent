# 企业级数据智能体 (Enterprise Data Agent)

支持 `Web UI` 与 `Electron` 桌面端的数据智能体。目标是释放数据价值：让每个对数据感兴趣、但不懂 SQL 或数据建模的人，都能用自然语言查询数据，得到正确、看得懂的答案和洞察。

## 项目简介

本项目基于 Pi-Mono 架构构建统一的 TypeScript Agent 运行时（`@data-agent/runtime`），将自然语言请求转化为可执行的数据任务链路。系统覆盖问题理解、上下文装配、工具调用、SQL 查询、安全校验、结果加工、图表生成与分析交付等关键环节，适合企业内部数据服务、探索式分析和可复用的数据工作流搭建。

## 当前能力

- 支持同一任务下的多会话、会话恢复、工作区映射与 Pi JSONL transcript 持久化
- 支持流式对话、工具调用展示、`stop` / `steer` / follow-up 协作流程与澄清问答
- 支持工作区文件上传、下载、附加提问和会话级文件管理
- 支持知识库（BM25 检索）、Skill、MCP 工具与本地工作区协同
- 提供 Electron 桌面端（TypeScript 主进程 + IPC 版本化通道）与 Fastify Web Host
- 内置 Python 数据运行时 pack（分析/可视化），通过 MCP 服务器访问 MySQL/PostgreSQL/SQLite
- 图表与 HTML 看板：基于已发布结果生成图表、看板和报告

## 核心价值

- **不懂 SQL 也能查数**：用户只需用自然语言提问；理解题意、取证、写 SQL、核对与执行都由智能体完成。
- **答案可信**：用户无法自己核对 SQL，所以正确性优先于功能广度。口径逐项记录（Answer Spec），有歧义时比较候选读法或询问用户，SQL 须落实已确定的口径，未经证实的部分在交付时披露。
- **看得懂、能纠正**：答案附带业务语言的口径说明，例如"活跃客户按近 30 天有下单计"，而不是 SQL；用户可以直接指出哪里不对。
- **从数字到洞察**：在结果之上给出对比、趋势、异常、图表和报告，而不只是一张表。
- **安全可控**：只读查询、结果绑定发布凭证（Publication Receipt），应用不直连业务库。

## 路线图

**不做**：BI 场景的语义层，包括集成 KTX 语义层、摄入 Power BI / LookML 等 BI 模型、维护指标层。业务知识从使用中积累，不靠预先建模。

按优先级：

| 优先级 | 方向 | 内容 | 状态 |
| --- | --- | --- | --- |
| P0 | 不丢答案 | 交付不受工具上限影响、记录未作答任务停在哪一步（#192）；限制首次写 Spec 之前的取证开销（#193） | #192 已完成 |
| P1 | 答案正确 | 假定须给出另一读法并转为候选（#194）；独立的读法枚举（#195）；只针对 SQL 实现错的小规则（#196）。以 Spider2 作为长尾问题正确率的代理评测 | 待开发 |
| P1 | 看得懂、能纠正 | 交付时的口径说明一律用业务语言；歧义澄清用业务语言提问；用户纠正能定位到具体口径并重算 | 待立项 |
| P2 | 业务知识积累 | 用户的澄清与纠正沉淀为业务定义草稿，经评审后可作为证据被后续问题直接引用（目前 `update_knowledge` 只能写学习记录和草稿，没有评审和引用） | 待立项 |
| P2 | 洞察 | 在已发布结果上自动给出对比、趋势与异常，并生成图表或报告 | 待立项 |
| P3 | 清理 | 评估并移除不再需要的语义层存量：语义资产查看器、`semantic.sources.*` 协议、启动期 Ingest 状态与 `IngestJobPort` 桩、KTX 相关设计文档 | 待立项 |

## 目录概览

- `packages/contracts`：版本化协议契约（命令/事件 envelope、RequestContext）
- `packages/runtime`：共享 DataAgentRuntime（Pi AgentHarness、元数据、会话、知识、看板、MCP 监管）
- `packages/electron-host`：Electron 主进程与 IPC 适配器
- `packages/mcp-mysql` / `packages/mcp-pg` / `apps/server`：MCP 参考服务器与 Fastify Web Host
- `frontend/`：Vite + React 渲染层与 electron-builder 打包配置
- `packages/electron-host/preload.cjs`：渲染层版本化运行时桥
- `scripts/`：发行构建、打包、冒烟与 A–K 门禁脚本
- `tests/contract-fixtures/`：语言无关的行为契约 fixtures（Gate A）
- `docs/`：架构决策、组件设计与 A–K 门禁报告

## 环境要求

- Node.js `20+`
- npm `10+`
- Windows（桌面安装包构建当前面向 Windows；Web 开发不限）

## Clone 后安装

```bash
npm install
npm run build
```

## 运行

### Web Host（开发）

```bash
node apps/server/dist/index.js
```

### Electron 桌面端（开发）

```bash
node scripts/build-distribution.mjs   # 生成 frontend/electron-host/*.cjs（构建产物，不入库）
cd frontend
npx electron electron-host/main.cjs
```

### 桌面端打包

```bash
# 1. Python 运行时：基于 uv 管理的独立 CPython（可拷到任意机器），不能用 venv（pyvenv.cfg 绑定本机 Python）
node scripts/prepare-python-runtime-source.mjs              # → .tmp/python-runtime-source
node scripts/build-python-runtime.mjs .tmp/python-runtime-source dist/python-runtime
# 2. 应用构建与打包（只复制主进程需要的模块，better-sqlite3 取 Electron 版预编译包）
node scripts/build-distribution.mjs
node scripts/package-electron-manual.mjs
# 产物：frontend/release-manual/win-unpacked/ 与 Data Agent Setup.exe
```

### 测试与门禁

```bash
npm test                                # 全部 TS 套件
python -m pytest tests                  # 契约 fixtures（如保留 Python 环境）
node scripts/run-clean-env-gates.mjs    # Gate C 干净环境全链路
node scripts/measure-budgets.mjs        # Gate K 预算测量
```

## 构建产物

- `frontend/release*/win-unpacked/`：未打包 Electron 应用（app.asar + python-runtime pack）
- `frontend/release*/Data Agent Setup.exe`：NSIS 安装包
- `docs/gate-metrics.json`：组件体积与启动延迟基线

## 架构说明

- 统一运行时：Electron IPC 与 Web HTTP 复用同一 `DataAgentRuntime` 命令面与契约 schema
- 版本化协议：所有命令/事件使用 `protocolVersion` envelope
- MCP 优先：所有数据库查询/导出经 MCP 服务器，应用不直连业务库
- 历史决策见 `docs/pure_typescript_pi_refactor_plan.md` 与 `docs/adr/`
