# Data Agent 运行时问题定位与 13 核心工具审查汇总报告

> **编制时间**：2026-08-26  
> **审查范围**：2026/8/25 23:53 后所有交互问题、知识库/检索缺陷、会话流转与 13 个核心本地工具实现细节。  
> **修复实施计划**：[`current_issues_remediation_plan.md`](./current_issues_remediation_plan.md)

---

## 目录
1. [对话交互与前端展示问题](#1-对话交互与前端展示问题)
2. [知识库检索与读取设计缺陷](#2-知识库检索与读取设计缺陷)
3. [13 个核心工具实现审查与成熟度评估](#3-13-个核心工具实现审查与成熟度评估)
4. [MCP 外部扩展与 Skill 体系现状](#4-mcp-外部扩展与-skill-体系现状)
5. [问题代码位置与修复建议清单](#5-问题代码位置与修复建议清单)

---

## 1. 对话交互与前端展示问题

### 1.1 首字输出延迟大 / 缺乏 LLM 预热
- **现象**：用户发送问题后，前端长时间无文本响应（首字输出慢）。
- **根因分析**：
  1. **宿主层按需冷启动**：在 Web 宿主中，Agent Harness 未在服务启动时并行预热，而是在接收到第一条用户请求时才延迟初始化（Lazy Init）。
  2. **多轮 ReAct 工具链往返**：在输出最终回答前，Agent 会连续调用 `search_knowledge`（可能多次）与 `query_database`，每次工具调用都需要经历一次完整的 LLM 请求 + 工具执行 + 结果注入，导致首字打字前存在多次网络与推理往返。
- **代码位置**：
  - [`scripts/start-web-host.mjs`](file:///d:/data_agent/scripts/start-web-host.mjs) (`resolveAgentHarness`)
  - [`packages/runtime/src/agent-assembly.ts`](file:///d:/data_agent/packages/runtime/src/agent-assembly.ts)

### 1.2 多轮工具调用产生空白 Agent 头像气泡
- **现象**：在两轮工具调用之间，聊天区域多出一个带有机器人头像、但消息体完全为空的空白气泡。
- **根因分析**：
  在 Pi Agent 的多轮循环（ReAct Loop）中，当上一轮工具（如 `search_knowledge`）执行完毕进入下一轮工具（如 `query_database`）时，后端会触发新的 `message_start` 事件。前端为其新建了一个 `AgentMessage`，但由于该轮大模型仅发起了工具调用而未产生文本段落，前端依然渲染了该消息节点，导致只显示头像而无文本气泡。
- **代码位置**：
  - [`frontend/src/components/ChatArea.tsx:624-647`](file:///d:/data_agent/frontend/src/components/ChatArea.tsx#L624-L647)（消息流缓冲管理）
  - [`frontend/src/components/ChatArea.tsx:1014+`](file:///d:/data_agent/frontend/src/components/ChatArea.tsx#L1014)（消息列表渲染逻辑）

### 1.3 详细信息面板中「工具参数」被空对象 `{}` 覆盖
- **现象**：在右侧详细信息面板中，工具执行结果正常展示，但「工具参数」始终显示为 `{}`。
- **根因分析**：
  在前端事件转换文件 `chat-events.ts` 中，工具结束事件 `agent.tool_finished` 被映射为 `tool_result` 时硬编码传递了 `arguments: {}`。而 `ChatArea.tsx` 使用 `event.arguments ?? existing.arguments` 进行合并，由于 `{}` 为真值（Truthy），导致初始在 `tool_started` 接收到的真实参数（如 `sql: "SELECT ..."`）在执行完成瞬间被覆盖为空对象。
- **代码位置**：
  - [`frontend/src/api/chat-events.ts:28-30`](file:///d:/data_agent/frontend/src/api/chat-events.ts#L28-L30)
  - [`frontend/src/components/ChatArea.tsx:798`](file:///d:/data_agent/frontend/src/components/ChatArea.tsx#L798)

### 1.4 会话自动命名机制丢失（始终显示为“新会话”）
- **现象**：新建会话并发送提问后，左侧栏会话标题没有自动更新为提问摘要（如 `08月20日_查询...`），依然停留在「新会话」。
- **根因分析**：
  在 TS 运行时重构中，会话历史下沉至 Pi JSONL 存储层，前端移除了原有的 `persistTranscript` 快照保存钩子。旧版中依据用户首条提问自动触发重命名的逻辑挂载在旧钩子上，在剥离快照时被遗漏，导致新建会话没有发起 `session.rename`。
- **代码位置**：
  - [`frontend/src/hooks/useSession.tsx:371-379`](file:///d:/data_agent/frontend/src/hooks/useSession.tsx#L371-L379)
  - [`frontend/src/components/ChatArea.tsx`](file:///d:/data_agent/frontend/src/components/ChatArea.tsx) (`handleSend`)
  - [`packages/contracts/src/index.ts:52`](file:///d:/data_agent/packages/contracts/src/index.ts#L52) (`SessionRenameCommandSchema`)

---

## 2. 知识库检索与读取设计缺陷

### 2.1 `search_knowledge` 剥离 Chunk 摘要与行号
- **现象**：知识库中明明包含对应场景的历史 SQL 模板，搜索后模型却无法直接使用，仍需多次检索或调用 `read_knowledge`。
- **根因分析**：
  底层 BM25 检索明明切出了带有 `title`、`startLine`、`endLine` 和 `text` 的 Chunk，但工具实现层直接将输出格式化为 `hits.map(h => `${h.path} (score ${h.score})`)`，**彻底剥离了正文片段**。模型拿到纯文件名后无法获知具体内容，被迫发起第二轮工具调用。
- **代码位置**：
  - [`packages/runtime/src/agent-assembly.ts:103-106`](file:///d:/data_agent/packages/runtime/src/agent-assembly.ts#L103-L106)
  - [`packages/runtime/src/knowledge.ts:76-100`](file:///d:/data_agent/packages/runtime/src/knowledge.ts#L76-L100)

### 2.2 `read_knowledge` 粗暴全量读取
- **现象**：第二次调用 `read_knowledge` 读取知识库时，返回长达数百行的超大文本。
- **根因分析**：
  `read_knowledge` 仅支持传入 `path`，底层通过 `fs.readFile` 全量读取。以 `doc/query_patterns.md` 为例，长达 489 行（约 24KB），一次性全量塞进 Prompt，造成 Token 浪费与推理延迟。
- **代码位置**：
  - [`packages/runtime/src/agent-assembly.ts:107-111`](file:///d:/data_agent/packages/runtime/src/agent-assembly.ts#L107-L111)

---

## 3. 13 个核心工具实现审查与成熟度评估

### 3.1 工具概览与评级

| 序号 | 工具名 | 架构定位 | 当前实现状态 | 成熟度 | 核心缺陷与限制 |
| :--- | :--- | :--- | :--- | :---: | :--- |
| 1 | `list_workspace` | 工作区列表 | 基础可用 | ⚠️ 偏简陋 | 仅返回平铺路径字符串，无体积、修改时间及目录树分层 |
| 2 | `read_file` | 工作区文件读取 | 基础可用 | ⚠️ 偏简陋 | 无行号切片（`startLine`/`endLine`）与体积上限防御，易撑爆上下文 |
| 3 | `write_file` | 工作区文件写入 | 基础可用 | ⚠️ 偏简陋 | 仅支持全量覆盖，无局部 Patch 或行级别编辑能力 |
| 4 | `run_python` | Python 脚本执行 | 较完整 | 🟢 良好 | 具备临时隔离、输出捕获与 120s 超时；单次调用无持久 REPL 状态 |
| 5 | `search_knowledge` | 知识库检索 | 严重缺陷 | 🔴 缺陷 | **仅返回文件名，剥离了 Chunk 文本与行号**，逼迫模型二次读取 |
| 6 | `read_knowledge` | 知识库读取 | 严重缺陷 | 🔴 缺陷 | **无切片全量读入**，遇到数百行模板文档直接全量灌入 Prompt |
| 7 | `update_knowledge` | 知识库更新/学习 | 较完整 | 🟢 良好 | 具备白名单路径限制与 `.audit.log` 审计记录；缺少模式更新合并 |
| 8 | `load_skill` | 技能动态加载 | **未实现** | 🛑 空占位 | **仅在元数据目录声明，`buildAgentTools` 根本未编写执行体** |
| 9 | `generate_dashboard` | BI 看板生成 | 较完整 | 🟢 良好 | 具备 V4 规范校验与 HTML 渲染；但 edit 模式只是全量覆盖 |
| 10 | `show_widget` | 行内卡片挂载 | 未打通 | 🔴 简陋占位 | 仅在后台返回 `[widget:...]` 字符串，未广播结构化事件至前端 |
| 11 | `query_database` | 数据库只读查询 | 较完整 | 🟢 良好 | 具备只读校验与截断；MySQL 子查询封装导致 `SHOW`/`DESC` 报错 |
| 12 | `ask_user_clarification`| 结构化追问 | 完整 | 🟢 优秀 | 具备异步挂起、超时控制、Promise 机制与前端交互联动 |
| 13 | `export_query` | 全量数据导出 | 基础可用 | ⚠️ 偏简陋 | 内存一次性拉取 10 万行并拼接 CSV 写入，缺少流式写入保护 |

### 3.2 深度审查要点

1. **`load_skill` (100% 缺失)**:
   - [`packages/runtime/src/tools-catalog.ts:28`](file:///d:/data_agent/packages/runtime/src/tools-catalog.ts#L28) 虽有声明，但在 [`packages/runtime/src/agent-assembly.ts:81-163`](file:///d:/data_agent/packages/runtime/src/agent-assembly.ts#L81-L163) 中完全漏掉了该工具的实现。
2. **`show_widget` (前端协议断层)**:
   - 仅执行 `text(`[widget:${p.kind}] ${JSON.stringify(p.spec)}`)`，未通过 Runtime 广播 `widget` 事件，前端无法渲染卡片。
3. **`query_database` (DDL/自省语句语法冲突)**:
   - 底层 MCP 采用 `SELECT * FROM (${trimmed}) __preview LIMIT ...` 包装，导致 `DESCRIBE table_name` 或 `SHOW TABLES` 抛出 MySQL 语法异常。模型需改用 `SELECT FROM information_schema` 或查阅 `doc/db_schema.md`。

---

## 4. MCP 外部扩展与 Skill 体系现状

### 4.1 MCP 体系的架构演进与现状
- **Database MCP**：已按最新架构收敛为 `@data-agent/mcp-mysql`，统一由 `query_database` 和 `export_query` 提供服务，去除了多层中转；
- **KTX MCP**：已下沉为文件系统数据契约（`.data_agent/semantic-context/`），由 Runtime 直接解析，消除了独立进程；
- **QCC MCP**：属于外部工商查询服务，在纯 TS 宿主（[`scripts/start-web-host.mjs`](file:///d:/data_agent/scripts/start-web-host.mjs)）中暂未配置挂载。

### 4.2 Skill 体系的三大未接通断点
1. **扫描目录错位**：[`packages/runtime/src/index.ts:210`](file:///d:/data_agent/packages/runtime/src/index.ts#L210) 扫描的是 `.data_agent/runtime-web/skills`（物理空目录），而真实技能文件位于 `.agents/skills/`；
2. **执行体缺失**：`buildAgentTools` 缺少 `load_skill` 工具执行逻辑；
3. **提示词无感知**：`DATA_AGENT_SYSTEM_PROMPT` 没有任何 Skill 元数据注入。

---

## 5. 问题代码位置与修复建议清单

```
====================================================================================================
 优先级   问题分类           涉及文件                                                   核心修复建议
====================================================================================================
 [P0]     工具参数覆盖       frontend/src/api/chat-events.ts (L28-30)                   tool_result 移除 arguments: {} 硬编码，透传真实参数
                             frontend/src/components/ChatArea.tsx (L798)
----------------------------------------------------------------------------------------------------
 [P0]     检索正文丢失       packages/runtime/src/agent-assembly.ts (L103-106)          search_knowledge 返回 title, startLine, snippet
----------------------------------------------------------------------------------------------------
 [P0]     技能工具未实现     packages/runtime/src/agent-assembly.ts (L81-163)          在 buildAgentTools 中实现 load_skill 工具
                             packages/runtime/src/index.ts (L210)                       将 skillsRoot 修正为仓库根目录 .agents/skills
----------------------------------------------------------------------------------------------------
 [P1]     空白气泡渲染       frontend/src/components/ChatArea.tsx (L624-647, L1014+)    合并同一轮次工具调用，过滤无内容的纯头像气泡
----------------------------------------------------------------------------------------------------
 [P1]     会话自动命名丢失   frontend/src/components/ChatArea.tsx (handleSend)          首条提问自动生成 "MM月DD日_提问" 并调用 session.rename
                             frontend/src/hooks/useSession.tsx (L371-379)
----------------------------------------------------------------------------------------------------
 [P1]     知识库/文件全量读  packages/runtime/src/agent-assembly.ts (L87-88, L107-111)  read_knowledge 与 read_file 增加 startLine/endLine 切片
----------------------------------------------------------------------------------------------------
 [P1]     SHOW/DESC 报错     packages/mcp-mysql/src/index.ts (L57)                      对 SHOW/DESC 等语句跳过 SELECT * FROM (...) 包装
----------------------------------------------------------------------------------------------------
 [P2]     大查询内存溢出     packages/runtime/src/agent-assembly.ts (L143-150)          export_query 改为 Node.js Stream 流式写盘
----------------------------------------------------------------------------------------------------
 [P2]     冷启动延迟         scripts/start-web-host.mjs                                 服务启动阶段后台异步触发 resolveAgentHarness 预热
====================================================================================================
```
