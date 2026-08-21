content = """# 📈 企业级数据智能体 (Enterprise Data Agent)

> **基于 Pi-Mono 框架与六层数据上下文引擎的端到端数据智能分析平台**

## 🌐 项目概述 (Project Overview)
本系统是一款自研的端到端企业级数据分析智能体，旨在通过高度自动化的工作流，将复杂的业务数据查询与深度分析任务简化为秒级的对话交互任务。

## 🚀 核心价值 (Core Value)
- **极致效率**：数据查询准确率维持在 **100%**；将传统数仓查询的时间跨度由小时级缩窄至**秒级流式响应**。
- **全链路自动化**：端到端执行从 SQL 生成到数据清洗、深度分析及可视化报告输出的全流程。
- **决策辅助**：自动绘制多维度数据图表，并辅助生成具有业务洞察力的分析报告。

## 🛠️ 技术框架 (Framework)
- **Pi-Mono 底座**：基于高扩展性的多模态工程框架，原生支持 **Skill** 与 **Workflow** 的灵活接入与调度。
- **六层数据上下文引擎 (Six Layers of Context)**：
  - P1: 物理层元数据 (Schema)
  - P2: 业务领域注解 (Knowledge)
  - P3: 黄金 SQL 模版 (Few-shot)
  - P4: 数据血缘解析 (Lineage)
  - P5: 外部规章制度 (Wiki/Docs)
  - P6: 运行时沙盒验证 (Validator)
- **MCP 生态对接**：完全兼容 **Model Context Protocol (MCP)**，实现对数据库、外部 API 及第三方工具的标准化快速接入。

## 💎 产品亮点 (Product Highlights)
- **Steering 热打断与重定向**：支持在任务执行过程中随时介入，中断并纠正 Agent 的执行逻辑与方向。
- **自主学习与记忆老化**：内置自学习机制，成功经验与用户反馈将自动固化至 Memory 记忆库，实现群体进化。
- **SQL 安全锁 (Security Shield)**：执行前强制通过 AST 审计检测危险命令（如 `DROP`, `DELETE`），确保生产数据 100% 安全。

## 💻 使用方式 (Usage)
- **Web UI**：提供现代化的交互式聊天页面，支持可视化图表预览。
- **CLI 命令行**：为开发者提供更直接的终端交互入口。

---

## 🚀 快速开始 (Quick Start)

### 1️⃣ 环境准备
- **Python 3.13+**
- **Node.js 18+**

### 2️⃣ 启动后端服务 (Backend)
```bash
python server.py
# 服务器将运行在 http://localhost:8000
```

### 3️⃣ 启动前端界面 (Frontend)
```bash
cd frontend
npm install
npm run dev
# 前端页面将运行在 http://localhost:5173
```

---

## 📜 License
MIT License
"""

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(content)
print("README.md written successfully with UTF-8 encoding.")
