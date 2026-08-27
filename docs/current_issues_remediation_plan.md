# Data Agent 当前运行时问题修复实施计划

> **状态**：已确认，待实施
> **依据**：[`current_issues_and_tool_audit_summary.md`](./current_issues_and_tool_audit_summary.md)
> **范围确认**：11 项问题；本文件描述实施方案，不代表代码已经修复。

## 1. 目标与约束

### 1.1 目标

在不破坏现有工具调用、事件协议、知识库文件格式和旧会话的前提下，修复审计报告中确认的运行时、知识库、Skill、前端交互和导出问题。

本轮产出按审计结论拆分为可测试、可回滚的变更包。P0 问题全部通过自动化测试和现有功能回归后，才允许进入候选版本。

### 1.2 范围

本计划包含以下 11 项问题：

1. `tool_finished` 将真实工具参数覆盖为 `{}`；
2. `search_knowledge` 丢失检索 Chunk 正文和行号；
3. Skill 目录扫描错位、Skill 资源未装配进 `AgentHarness.resources`；
4. 多轮工具调用产生空白 Agent 气泡；
5. 会话首条消息自动命名丢失；
6. `read_knowledge` 和 `read_file` 全量读取；
7. MySQL `SHOW` / `DESCRIBE` 被预览包装破坏；
8. `export_query` 一次性将大量结果保存在内存中；
9. Web Host 缺少 Agent Harness 预热；
10. `load_skill` 未挂接 Pi 原生 Skill 调用机制；
11. `show_widget` 的 Contracts、Runtime 和 Frontend 结构化事件链未打通。

`list_workspace`、`update_knowledge`、Dashboard edit、QCC MCP、持久 Python REPL 等审查中发现但未列入本轮的事项，继续作为后续 backlog，不在本计划中扩展。

### 1.3 兼容性定义

本计划统一采用以下兼容性规则：

- 旧调用不报错；
- 旧必需字段继续存在；
- 新字段只增不删；
- 工具名称不变；
- 知识库文件格式不迁移；
- 旧会话 JSONL 可以继续读取；
- Contracts、Runtime、Frontend 对同一协议必须成组发布和回滚；
- 新 Widget 协议提供降级适配，旧客户端至少获得可读文本结果。

## 2. 已确认的实施顺序

### P0 内部顺序

1. 工具参数透传；
2. 知识库检索正文；
3. `SHOW` / `DESC` 查询兼容；
4. Skill 扫描、资源装配与 `load_skill`；
5. Widget Runtime 事件与 Contracts 协议。

### 变更包顺序

| 包 | 优先级 | 范围 | 发布条件 |
|---|---|---|---|
| P0-A | P0 | 工具参数、知识库检索/切片、`SHOW` / `DESCRIBE` | P0-A 测试与回归全部通过 |
| P0-B | P0 | Skill 根目录、原生资源装配、`load_skill` | Skill 安全和资源测试全部通过 |
| P0-C | P0 | Widget Runtime 事件与 Contracts | 协议回放和兼容测试全部通过 |
| P1-A | P1 | 空白气泡、会话自动命名 | 前端测试和既有交互回归通过 |
| P1-B | P1 | Widget 前端渲染和交互回归 | 全部 Widget 类型回归通过 |
| P2 | P2 | 流式导出、冷启动预热 | 性能、资源和启动回归通过 |

`show_widget` 是独立子项目，不与原 10 项交叉修改。其 Runtime、Contracts 接入属于 P0-C；前端完整渲染属于 P1-B。

## 3. 详细实施项

### 3.1 P0-A：参数、知识库与数据库查询

#### 3.1.1 工具参数透传

涉及方向：

- Runtime 的 `agent.tool_finished` 事件增加可选 `args` 字段；
- `mapPiEvent` 透传 Pi 工具完成事件中的原始参数；
- `chat-events.ts` 不再硬编码 `arguments: {}`；
- `ChatArea` 合并参数时把空对象视为缺失值；
- 旧事件没有 `args` 时，继续使用 `tool_started` 保存的参数。

验收：

- 工具详情面板能显示真实 SQL、文件路径、Skill 名称和 Widget 参数；
- 旧版事件回放不报错；
- `{}` 不会覆盖已有真实参数；
- 事件中有参数和无参数两种情况均有测试。

#### 3.1.2 `search_knowledge` 返回 Chunk 内容

`search_knowledge` 保留旧路径和分数信息，同时返回：

```text
path
score
title
startLine
endLine
snippet
```

面向模型的 `content` 使用可读文本，面向程序和测试的结构化字段放入 `details`。检索结果必须保留 Chunk 的正文片段，不再只返回文件名。

验收：

- 命中结果一次包含正文、标题和行号；
- 无匹配时仍返回稳定的无结果文本；
- 结果文本和 `details` 字段均有测试；
- 单次文本返回遵守固定 50 KiB 上限。

#### 3.1.3 文件和知识库切片

为 `read_file` 和 `read_knowledge` 增加可选参数：

```text
startLine?: number
endLine?: number
```

语义：

- 行号从 1 开始；
- `startLine`、`endLine` 均为闭区间；
- 缺省起点表示文件首行；
- 缺省终点表示文件末行；
- 小于 1、非整数、`startLine > endLine` 直接报错；
- 服务端固定 `maxBytes = 50 KiB`；
- `maxBytes` 不作为可由模型取消的参数；
- 超出限制时通过继续切片读取，不放宽上限。

需要同步更新工具 Schema、工具描述、实现和测试。不得改变旧的只传 `path` 调用语义。

#### 3.1.4 MySQL `SHOW` / `DESCRIBE`

查询预览层应识别 `SHOW`、`DESCRIBE` / `DESC` 等自省语句，避免将它们错误包装为：

```sql
SELECT * FROM (<query>) __preview LIMIT ...
```

普通只读 `SELECT` 继续使用现有预览限制和只读校验。

验收至少包括：

- `SHOW TABLES`；
- `DESCRIBE <table>`；
- `DESC <table>`；
- 普通 `SELECT`；
- 禁止写入语句仍被拒绝。

### 3.2 P0-B：原生 Pi Skill 体系

#### 3.2.1 资源装配原则

Skill 不能被实现为简单读取正文并返回给模型的临时工具。当前 Pi 原生底层已经提供 Skill 和 Harness Resource 能力，本次只修复接线：

1. 修正目录扫描；
2. 将扫描结果转换为 Pi 原生 Skill 资源；
3. 创建 `AgentHarness` 时传入 `resources.skills`；
4. 通过 `setResources()` 支持刷新；
5. 在 `buildAgentTools` 中挂接原生 Skill 能力；
6. 保持当前 Skill 的显式调用和工具权限语义。

#### 3.2.2 根目录

- 开发环境：项目根目录 `.agents/skills`；
- 打包环境：随应用分发的 `.agents/skills`；
- 不递归扫描不受控的用户目录；
- 不允许同名 Skill 通过隐式优先级覆盖。

#### 3.2.3 刷新和异常

- Runtime 启动时扫描一次，保证首轮对话可用；
- `skills.list` 请求时重新扫描，并通过 `setResources()` 刷新；
- 单个 Skill 缺少 frontmatter、读取失败或包含未知工具时，跳过或标记诊断，不阻断 Agent；
- 诊断必须可观测并纳入测试；
- 不执行 Skill 中的代码或命令；
- 仅加载受信任 Skill 文件内容和 Pi 原生资源元数据。

#### 3.2.4 `allowedTools`

保留现有工具权限意图：

- 声明了 `allowedTools` 的 Skill 才限制当前有效工具集；
- 未声明 `allowedTools` 的 Skill 不改变全局工具集；
- 旧工具名称映射和未知工具诊断继续生效；
- `skills.list` 返回实际的允许工具字段，不读取错误的旧属性名。

验收：

- `.agents/skills` 中的现有 Skill 能被发现；
- Harness 的 `resources.skills` 包含正确的名称、描述、路径和正文；
- 新增或修改 Skill 后调用 `skills.list` 能刷新；
- 损坏 Skill 不阻断其他 Skill 和 Agent 启动；
- 路径穿越、错误根目录和未知工具均有测试。

### 3.3 P0-C：Widget Runtime 和 Contracts

#### 3.3.1 原生 Runtime 接入

不采用只返回 `[widget:...]` 文本的过渡方案。`defineTool` 需要正确透传原生工具执行上下文，包括：

- `toolCallId`；
- `AbortSignal`；
- `onUpdate`；
- 工具执行上下文。

`show_widget` 一次性提交和增量更新均通过原生 Runtime 事件链处理。

#### 3.3.2 事件协议

复用前端已有协议并补齐 Contracts Schema：

- `widget`；
- `widget_patch`；
- `widget_done`；
- `widget_remove`；
- `widget_error`。

协议升级需提供旧客户端兼容适配：新客户端渲染结构化 Widget，旧客户端至少获得可读文本。

#### 3.3.3 Widget 生命周期

固定事件顺序：

```text
tool_started
→ widget / widget_patch
→ widget_done
→ tool_finished
```

规则：

- `widget_id` 由 Runtime 生成，默认使用 `widget-${toolCallId}`；
- 同一次 `show_widget` 调用只产生一个 Widget；
- Widget 校验或协议错误时发送 `widget_error`，随后发送 `tool_finished(isError=true)`，不发送 `widget_done`；
- 工具失败仍发送 `tool_finished`，确保 ToolPanel 能结束加载状态；
- 同一次工具调用的 Widget 事件都必须带有可关联的 `tool_call_id` 和 `message_id`。

#### 3.3.4 Widget 校验

`kind` 继续限制为现有类型：

```text
kpi | chart | table | steps
```

`spec` 做最小结构校验：

- 必须是对象；
- 对应 `kind` 的核心数据字段类型正确；
- 允许额外字段透传；
- 非法结构产生结构化 Widget 错误，不让非法数据直接导致前端异常。

### 3.4 P1-A：前端消息和会话体验

#### 3.4.1 空白 Agent 气泡

只有消息同时没有以下内容时才删除：

- 文本；
- 思考内容；
- 工具调用；
- Widget；
- 错误；
- 重试信息。

过滤逻辑应在消息缓冲合并和终态刷新时保持一致，并增加纯工具调用、多轮工具调用、中断和错误场景测试。

#### 3.4.2 会话自动命名

只对真正的首条用户消息执行自动命名：

- 不额外调用模型；
- 直接截取并清洗用户原文；
- 最大 30 个汉字或等价 Unicode 字符；
- 按 grapheme cluster 截取，避免破坏组合 Emoji；
- 去除换行、Markdown 标记和控制字符；
- 调用现有 `session.rename` 命令；
- 重命名失败只记录错误，不影响回答。

### 3.5 P1-B：Widget 前端回归

在既有 `WidgetRenderer` 和 ChatArea Widget 状态管理基础上完成事件回放测试，覆盖：

- KPI；
- Chart；
- Table；
- Steps；
- patch 合并；
- ready 状态；
- remove；
- error；
- 旧客户端降级文本；
- Widget 与 ToolPanel 的关联展示。

### 3.6 P2：导出和冷启动

#### 3.6.1 流式导出

`export_query` 改为：

1. 创建临时 CSV；
2. 分批读取结果并流式写入；
3. 成功后原子重命名为目标文件；
4. 失败或取消时删除临时文件；
5. 成功完成后发送 Artifact 事件。

不得保留完整 CSV 字符串或完整 100,000 行结果的额外内存副本。

#### 3.6.2 Agent Harness 预热

Web Host 启动阶段后台异步触发 Harness 初始化：

- 预热失败不阻止 Web Host 启动；
- 首个请求等待正在进行的初始化，而不是重复创建；
- 初始化失败后保留可重试路径；
- 增加启动时序和失败恢复测试。

## 4. 测试和发布门禁

### 4.1 必跑命令

```bash
npm test
npm run typecheck
npm run lint --workspace=frontend
```

根目录 `npm test` 会先执行完整构建，工作区测试不能只运行局部测试后宣称通过。

### 4.2 必须覆盖的测试面

#### Runtime / Contracts

- 工具参数透传；
- 空对象不覆盖旧参数；
- Event Schema 接受新增可选字段；
- Widget 生命周期和错误分支；
- Skill 资源装配和刷新；
- Skill 诊断；
- 旧事件兼容。

#### 知识库 / 文件系统

- 正常切片；
- 1-based 闭区间；
- 缺省边界；
- 非法行号；
- 路径穿越；
- 50 KiB 截断；
- 超长单行。

#### 数据库

- `SHOW TABLES`；
- `DESCRIBE`；
- `DESC`；
- 普通 `SELECT`；
- 只读保护；
- MySQL 集成回归。

#### Frontend

- 工具详情参数；
- 空白气泡过滤；
- 首条消息命名；
- Widget 事件回放；
- Widget 渲染和错误态；
- 旧事件和降级文本。

#### 资源与性能

- 100,000 行导出；
- 导出失败清理临时文件；
- 不保留完整 CSV 内存副本；
- Harness 预热成功、失败和并发首请求。

### 4.3 发布规则

- P0 不允许带已知回归发布；
- P0-A、P0-B、P0-C 可分别验证，但各自的 Contracts、Runtime、Frontend 变更必须成组发布；
- P1/P2 可拆分为独立变更；
- 测试暂时失败时，不得以“已知问题”跳过 P0 门禁；
- 任意变更包失败时按协议组回滚，而不是只回滚其中一个层。

## 5. 回滚策略

### Runtime / Contracts / Frontend

同一协议版本的变更必须绑定回滚。禁止只回滚 Runtime 或只回滚 Frontend，造成事件协议不匹配。

### 文件导出

临时文件失败时删除；目标文件只有在完整成功后才替换，避免产生不可用的半成品。

### Skill 资源

Skill 扫描异常时降级为跳过异常 Skill，保留其他资源；如资源刷新整体失败，继续使用最近一次成功资源快照，不影响核心 Agent 启动。

### Harness 预热

预热失败时回退到首请求初始化；不得因预热任务失败导致服务不可用。

## 6. 风险与后续 backlog

### 已知实施风险

1. Pi 原生 Skill Resource 的装配点必须与当前 `AgentHarness` 版本 API 对齐；
2. Widget 原生 `onUpdate` 事件与现有 Runtime 事件映射需要保持严格顺序；
3. 协议降级不能吞掉 Widget 的错误状态；
4. MySQL 不同版本对自省语句和预览包装的行为可能不同；
5. 组合字符截取需要在 Node 和浏览器环境保持一致；
6. 大文件和大导出测试需要避免测试本身造成 CI 内存压力。

### 不在本轮范围

- `list_workspace` 的目录树、体积和修改时间增强；
- `update_knowledge` 的模式合并；
- Dashboard edit 的增量编辑；
- QCC MCP 挂载；
- `run_python` 持久 REPL；
- 其他未列入 11 项范围的工具重构。

## 7. 实施完成定义

本计划只有在以下条件全部满足时才视为完成：

1. 所有 P0 变更通过自动化测试；
2. `npm test`、`npm run typecheck` 和前端 lint 通过；
3. 数据库、Skill、Widget 和导出集成回归通过；
4. 旧调用、旧会话和旧事件回放不产生已知回归；
5. P0 变更包均具备明确的回滚路径；
6. 审计报告中的 11 项问题均能对应到实施任务、测试证据和发布状态。
