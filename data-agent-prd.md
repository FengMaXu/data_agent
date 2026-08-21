# 企业级数据智能体（Data Agent）PRD

## 1. 文档信息
- **产品名称**：企业级数据智能体 / Data Agent
- **文档类型**：产品需求文档（PRD）
- **文档版本**：v1.0
- **文档日期**：2026-03-18
- **依据来源**：当前仓库代码、现有 README、知识库、前后端实现、测试与配置文件
- **适用阶段**：MVP 已具备基础能力，适用于梳理当前产品、指导后续迭代与对齐研发范围

---

## 2. 产品概述

### 2.1 产品定义
企业级数据智能体是一个面向企业内部数据查询、分析与交付场景的会话式 AI 系统。用户通过自然语言提出问题，系统调用大模型、知识库、数据库工具、工作区文件工具与 Python 执行能力，完成从“理解问题”到“查询数据”再到“生成分析结果”的端到端闭环。

产品同时提供：
- **CLI 入口**：用于开发调试、本地验证和技术人员高频使用
- **Web UI 入口**：用于业务用户、分析人员、运营人员进行可视化会话与文件操作

### 2.2 一句话价值主张
让企业用户以自然语言完成安全、可控、可追溯的数据查询与分析交付，把传统 SQL + Excel + 脚本的多步流程收敛为一次会话。

### 2.3 产品定位
该产品不是通用聊天机器人，而是一个：
- 以**企业数据分析任务**为中心的 Agent
- 以**工具调用**而非纯文本回答为核心执行方式的系统
- 以**知识增强 + SQL 安全 + 文件工作区 + 代码执行**为差异化能力的企业数据助手

---

## 3. 背景与机会

### 3.1 业务背景
企业内部数据分析工作通常存在以下问题：
1. 业务人员不会写 SQL，但又高频需要数据
2. 分析师重复回答相似问题，效率低
3. 指标口径分散在文档、群聊和经验中，易出错
4. 数据查询之后仍需导出、清洗、画图、写结论，链路长
5. 直接开放数据库权限风险高，缺乏安全隔离

### 3.2 当前机会
随着 LLM 的工具调用能力成熟，可以把以下能力编排为统一体验：
- 自然语言理解
- 查询模板检索
- 业务知识检索
- 数据库元数据理解
- SQL 生成与只读执行
- CSV 中转与 Python 数据分析
- 图表与文件产出

### 3.3 产品要解决的核心问题
- 如何让非技术用户快速得到可信的数据答案
- 如何让分析流程可复用、可沉淀、可学习
- 如何保证数据库使用安全、查询行为受控
- 如何将一次“问答”升级为一次“分析交付”

---

## 4. 产品目标

### 4.1 总体目标
构建一个可在企业内部落地的数据智能体平台，使用户能够通过自然语言完成：
- 指标查询
- 趋势/对比分析
- 文件上传与结果产出
- 工作区内的脚本、图表、结果文件管理
- 配置大模型、数据库与 MCP 能力

### 4.2 业务目标
1. **提升查询效率**：缩短从提问到答案的路径
2. **降低使用门槛**：非 SQL 用户也能完成数据获取
3. **提升正确率**：通过知识库与规则约束减少口径错误
4. **提升安全性**：限制危险 SQL，确保只读访问
5. **沉淀组织经验**：将模板、规则、错题与知识积累为系统资产

### 4.3 产品成功标准（建议）
> 以下是基于产品现状给出的建议指标，代码中尚未形成完整埋点体系。

- 查询类请求一次成功率
- 用户从提问到获得可用答案的平均时间
- 模板命中率 / 知识检索命中率
- 被安全拦截的危险查询数
- 分析类任务中成功产出文件/图表的比例
- 用户负反馈转化为学习记录的比例

---

## 5. 目标用户与角色

### 5.1 主要用户角色

#### 角色 A：业务用户
- 典型人群：招商主管、招商主管理、招商主管部门负责人、业务运营
- 核心诉求：快速获得某个指标、某个排名、某月数据、某类企业名单
- 特征：不熟悉 SQL，希望结果直给、可解释、可下载

#### 角色 B：数据分析师
- 核心诉求：快速完成复杂分析、导出数据、编写中间脚本、画图
- 特征：关心口径、准确性、可复用性，愿意使用工作区文件与 Python 能力

#### 角色 C：产品/运营管理者
- 核心诉求：通过对话快速得到趋势判断、行业对比、经营结论、汇报素材
- 特征：更看重结论表达与图表交付

#### 角色 D：系统管理员/实施人员
- 核心诉求：配置 LLM、数据库连接、MCP Server、Skill 体系
- 特征：负责接入、治理、安全、可用性

#### 角色 E：开发者
- 核心诉求：通过 CLI 或 Web 快速验证 Agent 行为、调试工具链路
- 特征：需要透明的工具调用过程、日志、可重入的会话状态

---

## 6. 使用场景

### 6.1 高频查询场景
- “帮我查 2025 年 12 月批发业累计销售额是多少？”
- “零售业同比增速多少？”
- “哪些企业排名前 10？”
- “某企业从 2 月到 12 月累计销售额趋势如何？”

### 6.2 分析场景
- “分析 2025 年批发业各月趋势，并生成图表”
- “对比多个行业大类的正增长企业数量及增量”
- “分析新纳统企业对行业增长的贡献”

### 6.3 协同工作场景
- 上传附件到工作区后，请 Agent 结合文件与数据库一起分析
- 在执行过程中追加说明，纠偏 Agent 当前方向
- 将查询结果保存为 CSV，并进一步用 Python 做清洗、可视化

### 6.4 配置与治理场景
- 在 Web 端切换模型提供商和模型
- 配置数据库连接参数并测试连接
- 配置/测试 MCP Server，查看已安装的工具
- 浏览与编辑知识库内容

---

## 7. 产品范围

### 7.1 当前已覆盖范围（基于代码现状）
1. CLI 会话式交互
2. Web UI 会话式交互
3. SSE 流式输出
4. Agent 工具调用与结果展示
5. MCP 工具桥接
6. 数据库只读查询与 SQL 安全检查
7. 知识库文件搜索、读取、编辑、保存
8. 工作区文件浏览、上传、下载、删除
9. Python 沙盒执行与图表输出
10. Session 级工作区隔离
11. Skill 发现与激活
12. Learning/Feedback 机制基础能力
13. LLM / DB / MCP 配置管理

### 7.2 当前不在成熟范围或未完成范围
1. MCP HTTP / SSE Transport 尚未实现
2. `/agent/stop` 仅为占位接口，未真正停止正在运行的 Agent
3. 前端 `frontend/README.md` 仍为 Vite 模板文档，未体现产品信息
4. 指标体系、权限体系、埋点体系尚未产品化
5. 多用户/组织级权限隔离尚未看到明确实现
6. 会话持久化仍以进程内内存为主，不适合生产级长期状态保存

---

## 8. 核心产品原则

### 8.1 准确性优先于炫技
优先给出可信结果，而不是泛泛而谈。系统提示词中明确要求模板优先、知识优先、避免无关扩展分析。

### 8.2 工具驱动优先于纯聊天
产品核心不是“回答得像人”，而是“能真正执行任务链路”。

### 8.3 安全优先
数据库访问默认只读，并对注入、多语句、危险关键字进行拦截。

### 8.4 过程可见
Web 前端会展示工具调用数、工具结果、Skill 激活状态，使用户知道 Agent 在做什么。

### 8.5 可沉淀、可学习
知识库、模板、学习记录不是一次性结果，而是组织资产。

---

## 9. 功能架构

### 9.1 总体能力层次
结合代码结构，产品可分为六层：
1. **交互层**：CLI / Web UI
2. **Agent 编排层**：Agent Loop、事件流、工具装配
3. **模型网关层**：OpenAI / Anthropic / OpenAI-compatible Provider 路由
4. **知识与上下文层**：业务知识、Schema、Query Patterns、Rules、Learnings、Skills
5. **工具执行层**：MCP、数据库工具、工作区文件、Python 执行、澄清、反馈
6. **治理与配置层**：ConfigManager、MCP 配置、LLM 设置、DB 设置、会话与工作区管理

### 9.2 关键模块映射
- **入口**：`main.py`、`server.py`
- **Agent 主循环**：`src/agent/agent_loop.py`
- **工具装配**：`src/agent/tool_assembly.py`
- **本地工具装配**：`src/agent/tool_providers/local_provider.py`
- **MCP 工具装配**：`src/agent/tool_providers/mcp_provider.py`
- **工作区工具装配**：`src/agent/tool_providers/workspace_provider.py`
- **配置管理**：`src/config_manager.py`
- **模型路由**：`src/ai/gateway.py`
- **知识工具**：`src/context/knowledge_tools.py`
- **数据库元数据**：`src/context/metadata_store.py`
- **SQL 安全拦截**：`src/mcp/sql_guard.py`
- **工作区隔离**：`src/workspace/workspace_manager.py`
- **Python 沙盒执行**：`src/workspace/code_executor.py`
- **Web Agent API**：`src/api/agent.py`
- **Workspace API**：`src/api/workspace_api.py`
- **Knowledge API**：`src/api/knowledge_api.py`
- **MCP API**：`src/api/mcp.py`
- **设置 API**：`src/api/settings.py`
- **前端主入口**：`frontend/src/App.tsx`
- **聊天区**：`frontend/src/components/ChatArea.tsx`
- **侧边栏**：`frontend/src/components/Sidebar.tsx`
- **设置中心**：`frontend/src/components/SettingsModal.tsx`

---

## 10. 核心用户流程

### 10.1 查询类任务流程
1. 用户输入自然语言问题
2. Agent 加载系统提示词与技能目录
3. 根据提示词优先搜索 `query_patterns.md`
4. 若模板不足，再使用 `db_schema.md` / `business.md` / 元数据工具补充理解
5. 生成 SQL
6. 经过 SQL Guard 校验
7. 调用数据库工具执行只读查询
8. 返回结果并用中文组织答案
9. 如有错误，可记录反馈并沉淀 learning

### 10.2 分析类任务流程
1. 用户提出趋势/对比/图表请求
2. Agent 识别为分析任务
3. 通过元数据、知识搜索确认表与口径
4. 执行 SQL 获取原始数据
5. 将结果写入工作区 CSV
6. 调用 Python 沙盒分析脚本
7. 生成图表/结果文件到 `output/`
8. Web 端监听工作区变化并刷新文件列表
9. 用户预览、下载结果文件

### 10.3 Web 会话与 Steering 流程
1. 用户发起 `/agent/chat`
2. 后端创建或复用 session 上下文与 workspace
3. SSE 持续返回 `text_delta`、`tool_call`、`tool_result` 等事件
4. 若用户在执行中再次发送消息，前端调用 `/agent/steer`
5. 后端将消息注入 SteeringQueue，Agent 在合适时机读取并调整方向

### 10.4 知识库编辑流程
1. 用户在 Sidebar 打开 Knowledge
2. 加载 `knowledge/` 下文件树
3. 用户打开 `.md` 文件预览内容
4. 如需修改，可在前端编辑并保存
5. 后端写回知识库文本文件

### 10.5 工作区文件协同流程
1. 用户上传文件到当前 session 对应 workspace/data
2. 前端消息流中触发 `workspace_updated`
3. Sidebar 刷新当前会话的工作区文件列表
4. 用户可预览文本或图片、下载文件、删除文件

---

## 11. 功能需求详述

## 11.1 会话交互
### 功能描述
支持用户通过 CLI 或 Web UI 进行多轮对话，Agent 在会话中保持上下文，并能流式输出结果。

### 用户价值
- 自然语言交互门槛低
- 结果实时可见
- 多轮澄清与上下文保留提升体验

### 需求点
1. 支持多轮会话上下文
2. 支持流式文本输出
3. 支持工具调用过程展示
4. 支持用户在处理中追加消息（Steering）
5. 支持清空当前会话

### 当前实现状态
- 已实现基础能力
- Web 端支持工具调用可视化
- 真正“停止运行中任务”未完成，仅支持 steering 而非 hard stop

---

## 11.2 查询任务智能路由
### 功能描述
系统应优先复用查询模板与业务知识，而非每次从零探索数据库。

### 需求点
1. 模板优先匹配
2. 无模板时再查 schema 和 business knowledge
3. 避免不必要的扩展分析
4. 输出简洁、聚焦用户问题

### 当前实现依据
- `knowledge/agent.md` 中已固化明确规则
- `knowledge/doc/query_patterns.md` 提供多类 SQL 模板

### 产品意义
这决定了 Data Agent 与普通“LLM + 数据库”的差异：强调业务正确性和执行路径最短化。

---

## 11.3 数据库安全访问
### 功能描述
所有 SQL 执行都必须经过安全检查，只允许只读类查询进入数据库。

### 需求点
1. 拦截 DROP / DELETE / UPDATE / INSERT / CREATE 等危险语句
2. 拦截注入模式、多语句、注释注入、UNION SELECT 等
3. 白名单放行 SELECT / SHOW / DESCRIBE / EXPLAIN / USE
4. 发生拦截时明确返回原因

### 当前实现依据
- `src/mcp/sql_guard.py`

### 用户价值
保障生产数据库安全，降低误操作与恶意输入带来的风险。

---

## 11.4 元数据与知识增强
### 功能描述
通过知识文件与数据库元数据工具，为 Agent 提供业务口径、表结构、模板与历史经验。

### 需求点
1. 支持搜索知识库
2. 支持读取完整知识文件
3. 支持编辑/保存知识文件
4. 支持数据库全局概览与单表细节查询
5. 支持历史学习记录检索

### 当前知识资产
- `knowledge/agent.md`：Agent 人设与工作方法
- `knowledge/doc/business.md`：业务指标、口径、图表风格
- `knowledge/doc/db_schema.md`：业务数据库结构
- `knowledge/doc/query_patterns.md`：SQL 模板
- `knowledge/doc/rules.md`：规则与安全约束
- `knowledge/doc/learning.md`：学习与经验

### 风险提示
- `rules.md` 中存在与当前业务场景不完全一致的通用内容，如用户状态/订单状态定义，需后续清理
- `context/doc/learning.md` 与 `knowledge/doc/learning.md` 并存，语义上可能重复

---

## 11.5 工作区管理
### 功能描述
每个会话拥有独立工作区，用于保存输入文件、SQL 结果、脚本和输出图表。

### 需求点
1. 自动创建 session 级目录
2. 提供 data / scripts / output 子目录
3. 防止目录逃逸
4. 支持列出、读取、写入工作区文件
5. 支持 Web 上传、下载、删除文件
6. 支持监听工作区变化刷新前端

### 当前实现依据
- `src/workspace/workspace_manager.py`
- `src/workspace/file_tools.py`
- `src/api/workspace_api.py`
- `frontend/src/components/Sidebar.tsx`

### 用户价值
让 Agent 不只输出文本，而能真正产出文件资产。

---

## 11.6 Python 分析与图表输出
### 功能描述
在隔离工作区内执行 Python 代码，对数据做清洗、统计与图表生成。

### 需求点
1. 将代码保存到工作区脚本目录
2. 以子进程执行，带超时限制
3. 自动注入数据/输出目录环境变量
4. 自动收集生成的新文件
5. 适配中文字体，提升中文图表可用性
6. 返回 stdout / stderr / 产出文件清单

### 当前实现亮点
- 已为 Matplotlib 注入中文字体与 `savefig` 重定向逻辑
- 支持 Windows UTF-8 输出兼容
- 明确要求使用 CSV 中转、不要 `plt.show()`

### 用户价值
支撑更完整的数据分析闭环，而不只是简单 SQL 回答。

---

## 11.7 技能（Skills）系统
### 功能描述
支持项目级或全局 Skill 发现、目录展示、激活与上下文注入。

### 需求点
1. 列出当前可用 Skills
2. 支持 slash command 形式激活
3. 激活后将 skill 的 UI 消息和模型注入上下文
4. 前端展示已激活 Skill 元信息

### 当前实现依据
- `src/prompts.py`
- `src/api/agent.py`
- `src/skills/*`
- 前端 `ChatArea.tsx`、`SettingsModal.tsx`

### 用户价值
使产品可扩展，不同业务或流程可以通过 Skill 封装为更专门的能力。

---

## 11.8 配置中心
### 功能描述
系统应允许用户在前端管理模型、数据库连接、MCP Server 与 Skills 视图。

### 模块划分
1. **模型设置**：配置 API Key / Base URL / Model
2. **数据库设置**：配置 host / port / user / password / database，并测试连接
3. **MCP 设置**：查看、编辑、测试 Server 配置，查看工具
4. **Skills 查看**：查看已安装 Skills

### 当前实现依据
- `src/api/settings.py`
- `src/api/mcp.py`
- `frontend/src/components/SettingsModal.tsx`

### 现状说明
- 已支持多家 provider 的前端选择器
- OpenAI-compatible 模型适配是当前主要路径
- MCP HTTP/SSE transport 前端可配置，但后端尚未完整实现

---

## 11.9 学习与反馈闭环
### 功能描述
当查询错误或用户指出结果有问题时，系统应能够记录失败案例、修正方式，并用于后续检索复用。

### 需求点
1. 记录最近一次执行的 SQL 与结果摘要
2. 支持用户上报正负反馈
3. 负反馈可转化为 learning entry
4. 后续生成 SQL 前可搜索相关历史教训
5. 同时保留机器可检索存储与 Markdown 经验文档

### 当前实现依据
- `src/learning/feedback.py`
- `src/learning/learning_store.py`

### 风险说明
- 当前 learning 的质量依赖 Agent 是否主动保存，尚未形成严格自动化闭环
- `context/doc/learning.md` 中存在示例/测试性质内容，可能污染真实知识质量

---

## 12. 前端体验需求

### 12.1 总体界面
Web UI 采用三块式思路：
- 左侧：Sidebar（会话、Knowledge、Workspace、设置入口）
- 中间：ChatArea（聊天与流式结果）
- 右侧：ToolPanel（工具调用与结果）

### 12.2 关键体验要求
1. 输入消息后快速开始流式渲染
2. 工具调用过程可见且不过度打断阅读
3. 当前 session 清晰可辨
4. 工作区文件变化自动刷新
5. 知识文件支持预览与编辑
6. 配置修改后有明确反馈

### 12.3 当前前端风险点
1. `frontend/README.md` 未产品化
2. Session 主要在前端内存管理，缺少持久化
3. `default_session` 的逻辑与 `useSession` 中实际 session id 生成方式并不完全一致，需要后续梳理
4. `onOpenWorkspace` 在 `App.tsx` 中传入空函数，说明架构上可能仍有遗留设计未闭合

---

## 13. 非功能需求

### 13.1 安全性
1. 数据库必须只读
2. 路径访问必须防止目录逃逸
3. 知识库与工作区文件访问必须限制在根目录内
4. API Key 与密码不应在前端明文回显
5. MCP 配置中的敏感字段应脱敏展示

### 13.2 性能
1. 聊天结果支持流式返回
2. 工作区文件刷新应避免高频抖动
3. 知识搜索结果应限制数量与上下文长度
4. 大文件只提供预览片段，避免上下文爆炸

### 13.3 可扩展性
1. 工具通过 Provider 装配，易于扩展
2. 支持多 Provider 模型路由
3. 支持 Skill 体系扩展
4. 支持 MCP Server 接入新工具源

### 13.4 可维护性
1. 代码按模块分层明显
2. 前后端 API 分工清晰
3. 知识库文档与系统提示词分离
4. 需要进一步清理遗留文档、样例内容与未完成接口

### 13.5 可观测性
1. 后端日志输出到 `data_agent.log`
2. 工具调用过程可在前端展示
3. 当前尚缺少正式埋点、统计报表与告警机制

---

## 14. 数据与知识资产要求

### 14.1 结构化资产
- 数据库表结构与字段注释
- MCP Server 注册信息
- Session / Workspace 文件元数据
- Learning JSON 存储

### 14.2 非结构化资产
- 业务知识文档
- 查询模板文档
- Agent Profile
- 图表风格说明

### 14.3 资产治理建议
1. 将真实知识与测试样例分离
2. 给知识文档增加版本与更新时间
3. 对 Query Patterns 进行分类与标签化
4. 建立 Learning 审核机制，避免错误经验持续污染

---

## 15. 边界与约束

### 15.1 产品边界
- 本产品主要服务于企业内部数据分析，不面向公开互联网问答
- 当前重点是结构化数据库查询与简单分析，不是通用 BI 平台替代品
- 当前更偏向单用户/单机/开发环境部署形态，生产级多租户能力仍需增强

### 15.2 技术约束
- Python 3.13+
- Node.js 18+
- 前端使用 React + Vite
- 后端使用 FastAPI + SSE
- MCP HTTP/SSE transport 尚未实现完成
- 当前会话状态以内存保存为主

---

## 16. 风险与问题清单

### 16.1 产品风险
1. **知识污染风险**：`rules.md`、`context/doc/learning.md` 中混入与当前业务不一致或示例性质内容
2. **文档不一致风险**：README 已产品化，但前端 README 仍是脚手架模板
3. **会话持久化不足**：后端 session 存储以内存为主，服务重启会丢失
4. **停止能力未闭合**：`/agent/stop` 只是占位
5. **MCP Transport 功能不完整**：配置项支持 HTTP/SSE，但 Registry 尚未实现
6. **前端状态管理简单**：session 完全在前端内存中，未持久化到 localStorage 或后端
7. **生产治理不足**：暂无权限、审计、配额、埋点等企业级治理能力

### 16.2 技术风险
1. `frontend/node_modules` 已在仓库中存在，说明仓库卫生有待治理
2. 仓库中有 `README_debug.txt`、`fix_readme.ps1`、`write_readme.py` 等临时/调试文件
3. `demo.mp4`、日志文件、CSV 样本体积较大，仓库管理成本上升

---

## 17. 版本规划建议

### V1（当前能力梳理版）
目标：完成基础数据问答闭环
- CLI / Web 双入口
- 数据库只读查询
- 知识库搜索
- 工作区文件管理
- Python 分析与图表输出
- 基础 Skills / MCP / 配置中心

### V1.1（建议近期迭代）
1. 完成 `/agent/stop` 真正中断能力
2. 清理知识库中的非业务样例内容
3. 补充前端产品化 README 与部署说明
4. 增加 session 持久化
5. 增加更清晰的错误提示与空态提示

### V1.2（建议中期迭代）
1. 支持 MCP HTTP/SSE transport
2. 增加会话历史持久化与检索
3. 增加用户级/角色级权限
4. 增加操作审计与指标埋点
5. 增加模板命中率、执行成功率、文件产出成功率统计

### V2（建议长期方向）
1. 多租户与组织级治理
2. 企业报表模板化输出
3. 更完整的工作流编排能力
4. 更完善的协作、分享、审批与发布机制
5. BI 组件化看板与结果沉淀中心

---

## 18. 验收标准（按模块）

### 18.1 查询能力验收
- 用户输入自然语言后，系统能正确调用知识/数据库工具
- 危险 SQL 会被拦截
- 返回结果聚焦问题本身，不无故扩展分析

### 18.2 分析能力验收
- 能将 SQL 结果保存为工作区文件
- 能调用 Python 成功生成图表或分析结果
- 输出文件在工作区中可见、可下载

### 18.3 Web 体验验收
- 聊天响应为流式
- 工具调用与结果可视化
- 工作区文件列表可刷新、可预览、可下载、可删除
- 知识库文件可读取与编辑

### 18.4 配置能力验收
- 模型配置可保存
- 数据库连接可测试与更新
- MCP Server 配置可保存与测试
- Skills 列表可获取

### 18.5 安全验收
- 仅允许只读 SQL
- 路径访问不能逃逸工作区或知识库根目录
- 配置中的敏感信息不直接泄露

---

## 19. 对研发的实现建议

### 19.1 优先修复项
1. 实现真正的 stop 能力
2. 清理知识库与 learning 中的示例污染
3. 统一 README、前端 README 与产品描述
4. 给 session 增加持久化策略
5. 为前端 session 与后端 workspace/session 建立更稳定映射

### 19.2 优先增强项
1. 加强错误提示与失败恢复策略
2. 提供结果来源说明（模板/知识/工具）
3. 增加导出标准报告能力
4. 增加使用数据埋点

---

## 20. 附录：关键文件清单

### 一级优先阅读
- `README.md`
- `main.py`
- `server.py`
- `src/agent/agent_loop.py`
- `src/agent/tool_assembly.py`
- `src/config_manager.py`
- `knowledge/agent.md`

### 二级优先阅读
- `src/agent/tool_providers/local_provider.py`
- `src/agent/tool_providers/mcp_provider.py`
- `src/agent/tool_providers/workspace_provider.py`
- `src/mcp/sql_guard.py`
- `src/context/knowledge_tools.py`
- `src/context/metadata_store.py`
- `src/workspace/workspace_manager.py`
- `src/workspace/code_executor.py`

### Web 与产品体验相关
- `src/api/agent.py`
- `src/api/workspace_api.py`
- `src/api/knowledge_api.py`
- `src/api/settings.py`
- `src/api/mcp.py`
- `frontend/src/App.tsx`
- `frontend/src/components/ChatArea.tsx`
- `frontend/src/components/Sidebar.tsx`
- `frontend/src/components/SettingsModal.tsx`
- `frontend/src/api/client.ts`

### 知识资产相关
- `knowledge/doc/business.md`
- `knowledge/doc/db_schema.md`
- `knowledge/doc/query_patterns.md`
- `knowledge/doc/rules.md`
- `knowledge/doc/learning.md`
- `context/doc/learning.md`
