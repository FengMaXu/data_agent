# Data Agent 纯 TypeScript 单栈化重构实施方案 (基于 Pi 架构)

> **版本**：v2.0 (全景终极版)  
> **目标**：彻底剥离 Python 后端独立进程与 PyInstaller 打包依赖，重塑为基于 Pi 生态（`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`）的 Electron 主进程纯 TypeScript 单栈架构。

---

## 一、方案背景与核心收益

### 1.1 项目技术渊源与重构本质
通过对当前项目源码的分析，当前 `data_agent` 的 Python 后端核心实现**本身就是从 Pi 的 TypeScript 原版代码（`pi-mono`）翻译而来的**（源码顶部直接标注了出处）：

```python
# src/agent/agent_loop.py line 1-3
"""Agent Loop —— 事件驱动的智能体主循环
借鉴 pi-mono/packages/agent/src/agent-loop.ts 的双循环架构"""

# src/ai/base_provider.py line 1-3
"""LLM Provider 抽象基类与公共数据模型
借鉴 pi-mono/packages/ai 的 Provider Registry 模式"""

# src/agent/types.py line 1-3
"""Agent 核心类型定义
借鉴 pi-mono/packages/agent/src/types.ts"""
```

**结论**：将 Python 后端替换为 Pi 的 TypeScript 库，并不是“从零重写”，而是**直接回归原版成熟生态**，用官方维护的稳定 TS 库替代自行翻译维护的 Python 版本。

### 1.2 核心量化指标对比
| 指标 | 现存架构 (Python + Electron 双栈) | 重构后架构 (Pi 纯 TS 单栈) | 改进收益 |
| :--- | :--- | :--- | :--- |
| **运行时结构** | Chromium + Node.js + Python (328MB) | Chromium + Node.js (纯单栈) | 🔻 消除冗余 Python 运行时 |
| **通信机制** | HTTP / SSE (本地 8080 端口轮询) | **Electron IPC 内存级直接通信** | ⚡ 零网络开销、无端口冲突 |
| **内置工具总数** | **28 个（碎片化严重）** | **10 个（高内聚抽象）** | 🔻 **精简 64%** |
| **工具 System Prompt** | ~4,500 Token (大篇幅工具定义) | **~1,200 Token** | ⚡ **节省 70% 上下文与成本** |
| **解压后体积** | **~928 MB** | **~385 MB** | 🔻 **减少 58% (立减 543MB)** |
| **安装包体积 (NSIS)** | **~450 MB** | **~190 MB** | 🔻 **减少 58%** |
| **冷启动耗时** | 3 ~ 5 秒 (等待 FastAPI `/health`) | **< 500 毫秒 (瞬时拉起)** | ⚡ 启动提速近 10 倍 |
| **代码栈维护** | Python 3.13 + TS 5.9 (双套类型体系) | **统一 TypeScript (单一语言栈)** | 🛠 维护成本减半 |

---

## 二、Pi 生态与 Python 后端底层 1:1 映射与替代分析

### 2.1 LLM 适配层：`@earendil-works/pi-ai` ↔ `src/ai/`

`pi-ai` 是 Pi 生态中统一的模型网关层，已经原生内置了 30+ 模型厂商的调用、流式传输、思考链（Thinking Effort）与 Token 计费。

| Python 实现 (`src/ai/`) | Pi 实现 (`@earendil-works/pi-ai`) | 对照与替代关系 |
| :--- | :--- | :--- |
| `Role` enum (`system`, `user`, `assistant`, `tool_result`) | `UserMessage.role`, `AssistantMessage.role` | ✅ **1:1 对应** |
| `ToolCall` dataclass (`id`, `name`, `arguments`) | `ToolCall` interface (`id`, `name`, `arguments`) | ✅ **字段完全一致** |
| `ToolDefinition` (参数为 dict) | `Tool<TSchema>` | ✅ **增强**：Pi 版增加了 TypeBox 运行时 Schema 校验 |
| `Message` dataclass (多类型混杂) | `Message = UserMessage \| AssistantMessage \| ToolResultMessage` | ✅ **增强**：Pi 版为区分严谨的 TypeScript 联合类型 |
| `openai_provider.py` (473 行) | `api/openai-completions.ts` / `openai-responses.ts` | ✅ **完全覆盖**，支持更多 OpenAI 特性 |
| `anthropic_provider.py` (284 行) | `api/anthropic-messages.ts` | ✅ **完全覆盖**，支持 Prompt 缓存与 Thinking 模式 |
| `gateway.py` (手动路由分发) | `models.ts` + 内置 Provider 注册表 | ✅ **完全覆盖**，支持 30+ 厂商无缝切换 |

### 2.2 Agent 核心循环：`@earendil-works/pi-agent-core` ↔ `src/agent/`

`pi-agent-core` 封装了标准的双循环 Agent 架构，当前项目的 `agent_loop.py` 是其直接翻版。

| Python 实现 (`src/agent/`) | Pi 实现 (`@earendil-works/pi-agent-core`) | 对照与替代关系 |
| :--- | :--- | :--- |
| `AgentLoopConfig` 配置类 | `AgentLoopConfig` interface | ✅ **1:1 对应** |
| `AgentContext` (systemPrompt, messages, tools) | `AgentContext` interface | ✅ **字段结构完全一致** |
| `AgentTool` (name, desc, params, execute_fn) | `AgentTool<TSchema>` (name, desc, params, execute) | ✅ **1:1 对应**，增加了并发控制与执行模式 |
| `AgentToolResult` (`content`, `is_error`, `details`) | `AgentToolResult<T>` (`content`, `is_error`, `details`) | ✅ **字段完全一致** |
| `AgentEvent` / `AgentEventType` 事件流 | `AgentEvent` / `AssistantMessageEvent` 联合类型 | ✅ **事件类型 100% 对齐** |
| 内循环打断机制 (`steering` 队列) | `getSteeringMessages` 回调钩子 | ✅ **机制完全一致** |
| 外循环追加机制 (`follow-up` 队列) | `getFollowUpMessages` 回调钩子 | ✅ **机制完全一致** |
| 轮次终止判断 (`shouldStopAfterTurn`) | `shouldStopAfterTurn` 钩子 | ✅ **机制完全一致** |
| 工具执行前后置钩子 (`before/afterToolCall`) | `beforeToolCall` / `afterToolCall` 钩子 | ✅ **机制完全一致** |
| 工具执行模式 (`sequential` / `parallel`) | `toolExecution: "sequential" \| "parallel"` | ✅ **原生内置支持** |

### 2.3 彻底省去 / 可直接删除的 Python 胶水代码清单

由于采用 Pi 纯 TS 单栈并改由 Electron IPC 直接通信，以下 **共计 ~6,156 行 Python 代码可以直接废弃删除**：

| 被删除/废弃的 Python 模块 | 预估代码行数 | 废弃原因 |
| :--- | :--- | :--- |
| `src/ai/*` (所有 LLM Provider 与网关) | ~1,500 行 | 彻底由 `@earendil-works/pi-ai` 替代 |
| `src/agent/agent_loop.py` | 777 行 | 彻底由 `@earendil-works/pi-agent-core` 替代 |
| `src/agent/types.py` & `event_stream.py` | ~600 行 | 彻底由 `pi-agent-core` 的原生类型与流替代 |
| `src/api/*` (FastAPI 路由与中间件) | ~3,000 行 | 废除本地 HTTP/SSE 服务，转为 Electron 内存 IPC |
| `server.py` (FastAPI 服务入口) | 200 行 | 主进程直接拉起，不再需要 Python Web 容器 |
| `build.spec` (PyInstaller 打包配置) | 100 行 | 消除 Python 二进制编译打包 |
| **可直接省去/删除总量** | **~6,177 行** | **大幅精简系统复杂度** |

---

## 三、总体架构与通信机制重构（HTTP/SSE ➔ Electron IPC）

### 3.1 架构拓扑图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Electron App (单个统一进程组)                       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    渲染进程 (Renderer Process)                        │  │
│  │    React 19 + Vite + ECharts + Tailwind                               │  │
│  │    通过 preload.cjs 的 window.dataAgent IPC 通道通信                  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │ Electron IPC (内存级双向事件流)       │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │                    主进程 (Main Process - Node.js 22)                 │  │
│  │                                                                       │  │
│  │   ┌───────────────────────────────────────────────────────────────┐   │  │
│  │   │                Electron IPC Bridge (路由与事件分发)            │   │  │
│  │   └───────┬──────────────┬──────────────┬──────────────┬──────────┘   │  │
│  │           │              │              │              │              │  │
│  │   ┌───────▼──────┐┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐       │  │
│  │   │pi-agent-core ││  MCP Manager││统一Dashboard││ 统一知识库  │       │  │
│  │   │(Agent主循环/ ││ (@model-    ││ 引擎 (V4)   ││(含错题本/   │       │  │
│  │   │ Tool调度/    ││  context-   ││(静态/语义   ││ 业务规范)   │       │  │
│  │   │ Skill加载)   ││  protocol)  ││ 自适应)     ││             │       │  │
│  │   └───────┬──────┘└─────────────┘└─────────────┘└─────────────┘       │  │
│  │           │                                                           │  │
│  │   ┌───────▼──────┐┌─────────────┐┌─────────────┐┌─────────────┐       │  │
│  │   │pi-ai (网关)  ││CodeExecutor ││SQL评估与澄清││安全配置/KTX │       │  │
│  │   │(OpenAI/Anth- ││(方案 A+B    ││(数据异常检测││(safeStorage/│       │  │
│  │   │ 30+ 厂商支持)││ 混合架构)   ││ 智能卡片)   ││ 守护进程)   │       │  │
│  │   └──────────────┘└─────────────┘└─────────────┘└─────────────┘       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心 IPC 通道列表

彻底移除本地端口监听（`127.0.0.1:8080`），前端通过 `window.dataAgent` 发起调用：

```typescript
// 1. 对话驱动与流式响应
ipcMain.handle('agent:chat', async (event, { sessionId, prompt, overrides }) => { ... });
ipcMain.handle('agent:steer', async (event, { sessionId, message }) => { ... });
ipcMain.handle('agent:stop', async (event, { sessionId }) => { ... });

// 2. 流式事件主动推流（替代原 HTTP SSE EventSource）
mainWindow.webContents.send(`agent:event:${sessionId}`, agentEvent);

// 3. MCP 与数据源管理
ipcMain.handle('mcp:list-servers', async () => { ... });
ipcMain.handle('mcp:add-server', async (event, config) => { ... });
ipcMain.handle('mcp:test-connection', async (event, config) => { ... });

// 4. 设置与硬件级安全密钥
ipcMain.handle('settings:get-llm', async () => { ... });
ipcMain.handle('settings:save-llm', async (event, secrets) => { ... });
ipcMain.handle('settings:get-python-runtime', async () => { ... });
ipcMain.handle('settings:set-python-runtime', async (event, config) => { ... });
```

---

## 四、核心工具体系重构方案（28 个 ➔ 10 个高内聚工具）

现存 28 个内置工具存在大量历史堆砌与碎片化（如 12 个知识/学习类工具各自为政，看板拆分为校验/构建/编辑 6 个工具）。重构将其收敛抽象为 **4 大领域共 10 个核心工具**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Data Agent 终极抽象工具箱 (10 个核心工具)                 │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│ 1. 工作区与计算 (3)   │ 2. 统一知识生态 (3)  │ 3. 呈现与可视化 (2)           │
├──────────────────────┼──────────────────────┼───────────────────────────────┤
│ • run_python         │ • search_knowledge   │ • generate_dashboard (V4统一) │
│ • read_file          │ • read_knowledge     │ • show_widget                 │
│ • write_file         │ • update_knowledge   │                               │
├──────────────────────┴──────────────────────┴───────────────────────────────┤
│ 4. 数据库与交互 (2)                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ • query_database (集成校验/预览/导出) • ask_user_clarification (智能澄清)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 详细工具契约定义

#### 领域 1：工作区与计算类 (3 个)
1. **`run_python(code: string, description?: string)`**：
   在沙盒中执行 Python 脚本，采用 **A+B 混合调度**（优先外部/Conda，保底 Standalone）。
2. **`read_file(path?: string)`**：
   读取工作区文件；不传 `path` 时默认列出当前工作区文件树（合并不必要的 `list_workspace`）。
3. **`write_file(path: string, content: string)`**：
   向工作区写入文件（CSV、脚本、文本产物）。

#### 领域 2：统一知识生态类 (3 个)
4. **`search_knowledge(query: string, category?: "business"|"schema"|"rules"|"templates"|"learnings")`**：
   统一检索业务指标、表结构、SQL 规范、查询模板与历史错题反思（替代原有的 7 个搜索工具）。
5. **`read_knowledge(path: string)`**：
   按相对路径读取指定知识库文档全文（如 `doc/business.md`、`doc/learning.md`）。
6. **`update_knowledge(path: string, content: string, mode: "append"|"replace")`**：
   统一更新知识库（沉淀纠错教训、补充业务术语、修正规则）。

#### 领域 3：呈现与可视化类 (2 个)
7. **`generate_dashboard(spec: object, edit_path?: string)`**：
   * **V4 规范大一统**：统一支持离线静态分析（`inline`）与数仓实时联动（`semantic`）。
   * **内联校验与自愈**：内部静默校验，不合法直接返回修正指导，合法直接生成/更新 HTML，**消除原 `validate` + `build` 的多余推理轮次**。
8. **`show_widget(kind: "kpi"|"chart"|"table"|"steps", spec: object)`**：
   在对话流中内联展示交互式轻量 UI 卡片。

#### 领域 4：数据库与交互类 (2 个)
9. **`query_database(sql: string, export_to_csv?: boolean, filename?: string)`**：
   参数化合并 `execute_sql` 与 `export_sql_to_csv`：
   * `export_to_csv=false`（默认）：安全只读空跑，返回受控前几行数据预览；
   * `export_to_csv=true`：全量流式写入工作区 CSV，不污染上下文。
10. **`ask_user_clarification(question: string, options?: string[])`**：
    意图模糊时弹出结构化选择卡片或自由输入框。

#### 元能力下沉（3 个工具 ➔ 0 个，直接由 Pi 底座原生吸收）
* 原 `activate_skill`、`tool_search` 彻底废除，依托 Pi 原生的 **`loadSkills`**（agentskills.io 标准）与提示词模板管理，不再占用显式 Agent Tool 名额。

---

### 4.2 工具迁移映射全景表

| 现存工具名称 (28个) | 重构后归属工具 (10个) | 重构优化方式 |
| :--- | :--- | :--- |
| `read_file` | **`read_file`** | 保留并增强 |
| `write_file` | **`write_file`** | 保留 |
| `list_workspace` | **`read_file(path="")`** | 缺省参数合并 |
| `run_python` | **`run_python`** | 接入 A+B 混合调度 |
| `validate_dashboard_spec` | **`generate_dashboard`** | 融入内部自校验机制，省去 1 轮交互 |
| `build_dashboard` (V3) | **`generate_dashboard`** | 统一为 V4 静态特例 |
| `edit_dashboard` | **`generate_dashboard`** | 传入 `edit_path` 实现原位更新 |
| `validate_semantic_dashboard_spec` | **`generate_dashboard`** | 融入内部自校验机制 |
| `build_semantic_dashboard` (V4) | **`generate_dashboard`** | 统一为 V4 语义模式 |
| `show_widget` | **`show_widget`** | 保留 |
| `search_knowledge` | **`search_knowledge`** | 成为全能知识检索入口 |
| `read_knowledge_file` | **`read_knowledge`** | 保留 |
| `write_knowledge_file` | **`update_knowledge`** | 统一为知识库写入接口 |
| `edit_knowledge_file` | **`update_knowledge`** | 统一为知识库写入接口 |
| `search_query_patterns` | **`search_knowledge(category="templates")`** | 归入统一知识检索 |
| `search_business_context` | **`search_knowledge(category="business")`** | 归入统一知识检索 |
| `grep_context` | **`search_knowledge`** | 废弃重复的 grep，走分块检索 |
| `search_column_metadata` | **`search_knowledge(category="schema")`** | 归入统一知识检索 |
| `save_column_metadata` | **`update_knowledge`** | 归入统一知识写入 |
| `search_past_learnings` | **`search_knowledge(category="learnings")`** | 错题本合并入知识库 |
| `save_learning` | **`update_knowledge`** | 错题本合并入知识库 |
| `record_user_feedback` | **`update_knowledge`** | 归入统一经验沉淀 |
| `execute_sql` | **`query_database(export=false)`** | 合并为参数化查询 |
| `export_sql_to_csv` | **`query_database(export=true)`** | 合并为参数化查询 |
| `request_user_clarification` | **`ask_user_clarification`** | 保留 |
| `activate_skill` | ❌ **下沉至 Pi 底座** | 由 Pi 的 `loadSkills` 原生注入 |
| `tool_search` | ❌ **下沉至 Pi 底座** | 依托 Pi 延迟工具机制 |
| `call_webhook` | ❌ **移除/转为内部系统调用** | 不作为大模型高频工具 |

---

## 五、7 大核心业务板块 TypeScript 移植方案

除去已由 Pi 覆盖和删除的通用层外，项目特有的业务逻辑按以下 7 大板块移植：

### 1. BI Dashboard 编译与渲染引擎（统一 V4 架构）
* **设计原则**：**消除 V3/V4 双轨制，统一为 Canonical V4 架构**。
* **TS 模块规划**：
  * `src/dashboard/contract.ts`：定义统一 V4 Spec 规范（`title`, `parameters`, `data`, `views`, `layout`）。
  * `src/dashboard/compiler.ts`：将 Spec 编译为 ECharts 规范化图表配置（KPI卡、折线、柱状、饼图、热力图、表格）。
  * `src/dashboard/renderer.ts`：生成单文件自包含 HTML 报表。
  * **自适应机制**：
    * **静态数据特例 (原 V3)**：`data: { type: "inline", rows: [...] }`，HTML 内置轻量 JS 过滤，**完全离线独立运行**。
    * **语义查询模式 (原 V4)**：`data: { type: "semantic", query }`，通过 DTBridge 监听参数变更，**动态触发 KTX 增量刷新**。

---

### 2. MCP 客户端与多数据源连接池
* **TS 模块规划**：
  * 采用官方 **`@modelcontextprotocol/sdk`** 原生 TypeScript SDK。
  * `src/mcp/manager.ts`：管理 MySQL / PostgreSQL / SQLite 等数据源的 MCP 进程生命周期与连接池。
  * `src/mcp/sql_guard.ts`：AST 级危险 SQL 拦截（禁止 DROP/TRUNCATE/无限制全表扫描）。
  * 动态将已连接数据源的 Tools 注入 `pi-agent-core` 的上下文工具箱。

---

### 3. Workspace 与代码沙盒执行器（方案 A + B 混合架构）
* **TS 模块规划**：
  * `src/workspace/code_executor.ts`：基于 Node.js `child_process.spawn` 异步执行数据分析脚本。
  * **A + B 混合调度策略**：
    1. **优先级 1 (方案 A - 自定义)**：读取用户在前端设置中指定的 Python 解释器（Conda、venv 等）；
    2. **优先级 2 (方案 A - 自动探测)**：自动探测系统环境已有的 `python3` / `python` / `conda`；
    3. **优先级 3 (方案 B - 保底内置)**：无外部 Python 时，自动降级调用随客户端打包附带的极简 Standalone Python 绿色包。
  * `src/workspace/file_tools.ts`：工作空间会话文件沙盒管理与产物捕获（图表图片、CSV 导出等）。

---

### 4. 统一知识库与上下文检索工具链
* **TS 模块规划**：
  * 整合全部知识与学习沉淀至 `knowledge/` 目录：
    * `knowledge/doc/business.md` (业务口径)
    * `knowledge/doc/db_schema.md` (数据字典)
    * `knowledge/doc/rules.md` (编写规范)
    * `knowledge/doc/query_patterns.md` (查询模板)
    * `knowledge/doc/learning.md` (**错题本/纠错经验沉淀，已完全合并**)
  * `src/knowledge/retriever.ts`：基于 BM25 和关键词的高性能分块检索器，支持 Agent 按需查询或动态注入系统提示词。

---

### 5. SQL 智能评估与歧义澄清交互
* **TS 模块规划**：
  * `src/interaction/sql_evaluator.ts`：SQL 执行产物健康度评估（空集、极值异常、行数膨胀检测）。
  * `src/interaction/clarification.ts`：当用户意图模糊时，生成结构化澄清选项，通过 IPC 驱动前端弹出交互卡片。

---

### 6. 本地持久化与会话存储
* **TS 模块规划**：
  * 直接复用 `pi-agent-core` 的 **`JsonlSessionRepo`** 原生模块，支持高性能 JSONL 会话持久化。
  * 天然支持会话树分支切换（Branching）与超长上下文自动压缩摘要（Compaction）。

---

### 7. 全局安全配置与 KTX 语义层管理
* **TS 模块规划**：
  * `src/config/manager.ts`：API Key 采用 Electron 原生 **`safeStorage`**（Windows DPAPI 硬件级加密）；通用配置存入 `userData/config.json`。
  * `src/semantic/daemon.ts`：主进程通过子进程管理 `extraResources/ktx-semantic-context` 的启停、端口分配与健康探针。

---

## 六、技能系统 (Skills) 适配方案

* **标准规范**：Pi 原生 100% 遵循 **[Agent Skills Specification (agentskills.io)](https://agentskills.io)**。
* **零成本兼容**：
  * 现有的 `.agents/skills/` 目录下所有包含 YAML Frontmatter 的 `SKILL.md` 文件**无需任何改动**。
  * 主进程直接调用 `loadSkills(env, ['./.agents/skills', '~/.data_agent/skills'])` 自动完成目录扫描与 XML 注入。

---

## 七、分阶段落地路线图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             6 阶段实施时间表                                 │
├────────────┬───────────────────────────────────────────────┬────────────────┤
│ 阶段       │ 核心任务与交付物                              │ 预计周期       │
├────────────┼───────────────────────────────────────────────┼────────────────┤
│ **阶段一** │ 工程底座改造、引入 Pi 核心依赖、IPC 通道搭建    │ 0.5 周 (3天)   │
│ **阶段二** │ CodeExecutor (A+B)、统一知识库与文件工具迁移   │ 0.5 周 (3天)   │
│ **阶段三** │ MCP 多数据源客户端生态迁移 (@modelcontext)     │ 0.5 周 (3天)   │
│ **阶段四** │ 统一 Canonical Dashboard (V4) 编译与渲染器移植│ 1.0 周 (5天)   │
│ **阶段五** │ SQL 智能评估、交互澄清与 Session 持久化       │ 0.5 周 (3天)   │
│ **阶段六** │ 前端 IPC 客户端适配、清理 Python 后端、打包发布│ 0.5 周 (3天)   │
├────────────┴───────────────────────────────────────────────┴────────────────┤
│ **总计**   │ 彻底去 Python 化、全功能投产                  │ **3.5 周**     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 八、验证与验收标准

1. **功能完整性**：
   * 提示词对话、打断（Steering）、追加（Follow-up）流式交互正常。
   * 10 个高内聚核心工具调用流畅，无工具找不到或语义混淆现象。
   * 外部 Python 与 Standalone Python 均可正常执行数据分析代码并生成图表。
   * 能够连接 MySQL/SQLite 数据源并执行安全受控的查询与 CSV 导出。
   * 能生成统一 V4 交互式 Dashboard（离线静态模式可导出，在线语义模式可参数联动）。
   * 知识库与错题本检索无缝工作。
2. **性能与体积达标**：
   * 应用解压体积在 **380MB 左右**，安装包体积在 **190MB 左右**。
   * 启动应用在 **500 毫秒内** 完成初始化，无端口占用和网络防火墙拦截风险。
   * 单轮对话工具定义 Token 占用从 ~4500 降至 **~1200**。