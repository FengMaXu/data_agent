# 企业级数据智能体 (Enterprise Data Agent)

支持 `CLI`、`Web UI` 与 `Electron` 桌面端的数据智能体，面向企业内部的数据查询、分析推演、报告生成和工作区协作场景。

## 项目简介

本项目基于 Pi-Mono 架构构建统一的 Agent 运行时，将自然语言请求转化为可执行的数据任务链路。系统覆盖问题理解、上下文装配、工具调用、SQL 查询、安全校验、结果加工、图表生成与分析交付等关键环节，适合企业内部数据服务、探索式分析和可复用的数据工作流搭建。

## 当前能力

- 支持同一 `session_id` 下的会话恢复、工作区映射和最小 transcript 保留
- 支持流式对话、工具调用展示、`stop` / `steer` / follow-up 协作流程
- 支持工作区文件上传、下载、附加提问和会话级文件管理
- 支持知识库、Skill、MCP 工具与本地工作区协同
- 提供桌面客户端，内置后端启动、引导配置、密钥安全存储和日志落盘
- 桌面端打包后的后端使用 PyInstaller `onedir` 模式，减少首次启动等待时间

## 核心价值

- **查询效率提升**：围绕高频数据问答与分析任务进行工程化封装，实现稳定、快速的查询响应与流式结果返回。
- **端到端自动执行**：从 SQL 生成、只读查询、数据落盘，到 Python 分析、图表生成与报告输出，形成完整任务闭环。
- **企业级分析协同**：支持知识库、技能、MCP 工具与工作区文件协同，使单次问答能够扩展为可复用的分析流程。
- **安全可控**：在数据库访问链路中内置 SQL 安全锁与只读约束，降低误操作风险，满足生产环境使用要求。

## 目录概览

- `server.py`：FastAPI 服务入口，默认启动 API 服务
- `main.py`：CLI 入口
- `src/api/agent.py`：会话 runtime、chat / steer / stop / clear、SSE 事件桥接
- `src/api/tasks.py`：任务及其会话层级的创建、查询、更新与删除
- `src/api/workspace_api.py`：会话产物的上传、下载与内部文件访问
- `src/agent/agent_loop.py`：Agent loop、工具执行、stop / steering 检查点
- `src/config_manager.py`：配置读写与运行时配置管理
- `frontend/`：Vite + React 前端与 Electron 桌面端代码
- `frontend/electron/main.js`：桌面端主进程、后端拉起、日志与密钥存储
- `workspace/`：会话工作区与生成产物目录

## 环境要求

- Python `3.13+`
- Node.js `20+`
- npm `10+`
- Windows
  说明：Web 开发不强依赖 Windows，但桌面客户端安装包构建当前面向 Windows。

## Clone 后安装

### 1. 安装后端依赖

在仓库根目录执行：

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -e .
```

如需开发测试依赖：

```bash
pip install -e ".[dev]"
```

如需构建桌面端安装包，还需要安装 PyInstaller：

```bash
pip install pyinstaller
```

### 2. 安装前端依赖

```bash
cd frontend
npm install
```

## 本地开发

### 启动 Web 版

后端：

```bash
python server.py
```

默认监听：

- API：`http://localhost:8080`
- Health：`http://localhost:8080/health`

前端：

```bash
cd frontend
npm run dev
```

默认前端地址：

- Web UI：`http://localhost:5173`

### 前后端联调

前端通过 `VITE_API_BASE_URL` 连接后端。需要显式指定时，可在 `frontend/.env.local` 中配置：

```bash
VITE_API_BASE_URL=http://localhost:8080
```

如果不配置，前端默认走同源路径，适合反向代理或生产部署。

### 启动 CLI

```bash
python main.py
```

CLI 与 Web 共用统一的 Agent 运行时，适合本地调试与工具链验证。

## 桌面客户端开发

### 开发模式启动

先启动前端开发服务器：

```bash
cd frontend
npm run dev
```

然后在第二个终端启动 Electron：

```bash
cd frontend
npm run electron:dev
```

桌面端会自动分配本地后端端口，并在主进程中拉起后端服务。

### 首次启动与引导配置

- 桌面端首次启动会进入引导流程，提示配置必要的模型密钥
- 已保存的密钥使用 Electron `safeStorage` 加密存储，而不是浏览器 `localStorage`
- 桌面端启动时会等待内置后端健康检查通过后再加载主界面

## 构建 Windows 桌面安装包

在 `frontend/` 目录执行：

```bash
npm run build:backend
npm run build:installer
```

也可以使用一条命令完整构建：

```bash
npm run build:desktop
```

构建产物位置：

- 安装包输出目录：`frontend/release/`
- PyInstaller 中间产物：`build/pyinstaller/`
- 打包后的后端目录：`dist/data_agent_server/`

## 日志与运行时说明

- 桌面端日志写入 `%APPDATA%\Data Agent`
- 主进程日志文件为 `desktop_main.log`
- 后端日志会写入同一目录，便于排查首次启动、健康检查和运行期问题
- 安装包内的后端采用 PyInstaller `onedir` 模式，避免 `onefile` 每次启动都进行大体积自解压

## 任务、会话与工作区约定

- 用户界面按“任务 → 会话”组织；创建任务时不会自动创建会话
- 只有用户主动新建会话后，任务下才会出现可对话的会话
- 会话名称由第一条用户消息自动生成，格式为 `XX月XX日_第一条消息`
- 每个会话使用稳定 `session_id`，生成文件不在侧边栏单独展示
- 后端工作区目录仍为 `workspace/<session_id>/`，仅作为会话执行与产物存储
- 后端会在每个会话工作区下写入轻量快照 `.session_snapshot.json`
- `/agent/clear` 会清空会话上下文与快照，但默认不删除工作区文件
- `/workspace/files?session_id=<id>` 只返回当前会话工作区文件
- 通过输入框上传的文件会自动加入 `attached_files`，随聊天请求发送给后端

## 技术架构

### Agent 运行时

项目通过 `src/agent/tool_assembly.py` 装配 MCP、本地知识、Skill 与工作区工具，并结合 `src/agent/agent_loop.py` 完成流式推理与工具调用执行。

### 分层上下文

系统围绕企业数据分析任务构建分层上下文能力，用于提升查询准确性、分析一致性与可维护性：

- 结构化元数据层：支撑数据源识别与字段定位
- 业务知识层：沉淀业务口径、统计规则与常见陷阱
- 查询模式层：维护高频 SQL 模板与查询经验
- 技能与生态层：支持 Skill、Workflow 与 MCP Server 接入
- 工作区执行层：管理中间数据、分析脚本、图表和导出文件
- 安全与学习层：通过 SQL 审核、用户澄清与反馈沉淀持续优化

### 工具生态

系统通过 MCP Registry、Tool Provider、本地知识工具与工作区代码执行能力形成可扩展的企业级 Agent 工具体系。

## License

MIT License
