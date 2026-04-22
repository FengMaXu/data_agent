# 企业级数据智能体 (Enterprise Data Agent)

> 基于 Pi-Mono 框架构建的端到端企业级数据查询与分析智能体，支持 CLI 与 Web UI 双入口，面向数据查询、分析推演、报告生成与图表产出场景。

## 项目简介
本项目聚焦企业内部数据服务场景，将自然语言请求转化为可执行的数据任务链路，覆盖问题理解、上下文装配、工具调用、SQL 查询、安全校验、结果加工和分析输出等关键环节。系统支持以流式对话方式完成从数据获取到分析交付的端到端执行，帮助业务与分析人员将传统小时级的数据查询流程压缩为秒级响应。

## 核心价值
- **查询效率提升**：围绕高频数据问答与分析任务进行工程化封装，实现稳定、快速的查询响应与流式结果返回。
- **端到端自动执行**：从 SQL 生成、只读查询、数据落盘，到 Python 分析、图表生成与报告输出，形成完整任务闭环。
- **企业级分析协同**：支持知识库、技能、MCP 工具与工作区文件协同，使单次问答能够扩展为可复用的分析流程。
- **安全可控**：在数据库访问链路中内置 SQL 安全锁与只读约束，降低误操作风险，满足生产环境使用要求。

## 技术架构
### 1. 智能体执行框架
项目基于 Pi-Mono 框架实现统一的 Agent 运行时，通过 `src/agent/tool_assembly.py` 装配 MCP、本地知识、Skill 与工作区工具，并结合 `src/agent/agent_loop.py` 完成流式推理与工具调用执行。

### 2. 六层上下文结构
系统围绕企业数据分析任务构建分层上下文能力，用于提升查询准确性、分析一致性与可维护性：
- **结构化元数据层**：对接数据库元信息与表结构能力，支撑数据源识别与字段定位。
- **业务知识层**：沉淀业务口径、统计规则与常见陷阱，减少指标理解偏差。
- **查询模式层**：维护高频 SQL 模板与查询经验，提升常见问题的命中率与生成效率。
- **技能与生态层**：支持 Skill、Workflow 与 MCP Server 接入，扩展外部能力边界。
- **工作区执行层**：在隔离工作区中管理中间数据、分析脚本、图表和导出文件。
- **安全与学习层**：通过 SQL 审核、用户澄清、反馈采集与经验沉淀形成持续优化闭环。

### 3. MCP 与工具生态
系统通过 `src/mcp/registry.py`、`src/mcp/bridge.py` 和多种 Tool Provider 实现统一工具接入。除数据库工具外，还可桥接本地知识库工具、文件型 Skill、HTTP Hook 以及工作区读写与代码执行能力，形成可扩展的企业级 Agent 工具体系。

## 产品亮点
- **可打断与可重定向**：支持在任务执行过程中追加指令、实时纠偏，适合探索式分析和多轮协作场景。
- **经验持续沉淀**：通过 Learning Store 与反馈机制记录错误修正经验和查询教训，支持后续任务复用。
- **SQL 安全锁**：默认仅放行只读查询，自动拦截危险关键字、多语句与注入特征，保障数据库访问安全。
- **双端交互体验**：同时提供 CLI 与 Web UI。Web 端支持流式对话、工具调用展示、知识库浏览、工作区文件上传/下载与结果预览。

## 使用方式
- **CLI**：适合开发调试、命令行交互与本地快速验证。
- **Web UI**：适合业务用户与分析人员进行会话式查询、文件管理和结果查看。

---

## 🚀 快速开始 (Quick Start)

### 1️⃣ 环境准备
- **Python 3.13+
- **Node.js 18+

### 2️⃣ 启动后端服务 (Backend)
`ash
python server.py
# 服务器将运行在 http://localhost:8000
`

### 3️⃣ 启动前端界面 (Frontend)
`ash
cd frontend
npm install
npm run dev
# 前端页面将运行在 http://localhost:5173
`

---

## 📜 License
MIT License

## Clone And Install

This repository includes the backend, the web UI, and the Electron desktop
client source. A fresh clone can be installed with the steps below.

### Prerequisites

- Python `3.13+`
- Node.js `20+`
- npm `10+`
- Windows is required to build the desktop installer and packaged backend

### Backend setup

From the repository root:

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -e .
```

Optional development dependencies:

```bash
pip install -e ".[dev]"
```

### Frontend setup

```bash
cd frontend
npm install
```

### Run the web app in development

Backend:

```bash
python server.py
```

Frontend:

```bash
cd frontend
npm run dev
```

### Run the desktop app in development

Start the frontend dev server:

```bash
cd frontend
npm run dev
```

Then in a second terminal:

```bash
cd frontend
npm run electron:dev
```

### Build the Windows desktop installer

From `frontend/`:

```bash
npm run build:backend
npm run build:installer
```

The installer output is written to `frontend/release/`.

### Packaging notes

- Desktop logs are written under `%APPDATA%\\Data Agent`.
- The packaged backend uses PyInstaller `onedir` mode for faster first launch.
- Desktop API keys are stored with Electron `safeStorage`, not browser
  `localStorage`.
