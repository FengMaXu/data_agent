# Data Agent 工具提示目录审查与迁移记录

状态：已按 `docs/tool_prompt_catalog_development.md` 完成概念修正与实现核对。

## 1. 结论

工具的 `promptSnippet` 与 `promptGuidelines` 不是 Pi core `AgentHarnessTool` 的字段，而是 Data Agent 应用层的受信任元数据。Pi core 没有这些字段不违反 core 合同；运行时通过 `ToolPromptCatalog` 和 Models Adapter 在请求层组合目录。

工具名只有一个来源：`definition.tool.name`。提示元数据不再重复声明工具名，目录也不注册工具、不修改 Schema、不授予权限。

`promptSnippet` 只承担一行能力与使用场景摘要，不复制完整签名或 JSON 示例；精确参数继续由原生 `tools[]` 的 TypeBox Schema 提供。`promptGuidelines` 只承担本工具的时机、前置条件、输出解释、禁忌和错误处置。跨工具业务协议仍由 `.pi/SYSTEM.md` 保留。

## 2. 实现位置与职责

| 位置 | 职责 |
| --- | --- |
| `packages/runtime/src/tools/tool-definition.ts` | `DataAgentToolDefinition`、元数据校验与不可变定义构造 |
| `packages/runtime/src/agent/tool-prompt-catalog.ts` | 名称唯一性、快照、稳定排序、守则去重、请求集合校验和 Markdown 渲染 |
| `packages/runtime/src/agent/tool-prompt-models.ts` | 从同一次 Models `Context.tools` 读取实际请求工具，并逐请求追加目录 |
| `packages/runtime/src/tools/core.ts` | 主环境工具与局部元数据共置 |
| `packages/runtime/src/tools/answering.ts` | Answering 工具与局部元数据共置 |
| `packages/runtime/src/tools/subagent.ts` | 主 Agent 委派工具与局部元数据共置 |
| `packages/runtime/src/application/delegation.ts` | explorer 子工具与受限局部元数据共置 |
| `packages/runtime/src/agent/harness-factory.ts` | 主 Harness 使用自身 Catalog Adapter；Skill 切换继续由 Lane 管理 |
| `packages/runtime/src/delegation/child-harness.ts` | 子 Harness 使用解析结果自己的 Catalog Adapter；reviewer/恢复 Harness 保持空能力 |

生产 Session Runtime、子任务解析器和相关测试统一装配带元数据的 definitions；不保留 bare executable tool 工厂或可选 definitions 兜底。需要直接执行工具的低层测试从 definition 读取 `.tool`，提示元数据仍只有一份来源。

## 3. 目录与请求合同核对

- 空工具集合不追加目录；压缩、总结和无工具恢复请求不会继承主目录。
- 活动工具名称取自同一请求传给 `Models.streamSimple` 的 `Context.tools`，不是 Lane 最新状态、Session 缓存或全量注册表。
- 目录按工具名稳定排序；不改变原生 `tools[]` 顺序。
- 工具定义重复、活动名重复、活动名未知、空摘要、跨行摘要/守则均明确失败；不会静默发送残缺目录。
- 同一工具内部 trim 后完全相同的守则去重，不跨工具合并语义。
- Adapter 只复制并更新 `systemPrompt`，保留 messages、tools、Schema、model、options、abort signal 和底层流合同；其他 Models 方法保持原对象绑定并透传。
- 每个主/子 Harness 独立建立 Catalog；子 Agent 不从主目录借用元数据或能力。
- 目录渲染不执行工具、不查询数据库、不调用模型、不创建 Query Task、不改变 Answering 或发布身份。
- 加载 Skill、用户新 prompt、Session 重开、旧 generation 重试和并发 Session 均通过当前请求工具快照自然更新目录；失败加载不会改变活动工具。

## 4. 工具覆盖

第一方主工具均通过 definitions 共置摘要和显式守则：

`list_workspace`、`read_file`、`write_file`、`search_knowledge`、`read_knowledge`、`update_knowledge`、`run_python`、`ask_user_clarification`、`load_skill`、`generate_dashboard`、`show_widget`、`update_answer_spec`、`query_database`、`compare_hypotheses`、`publish_query_result`、`export_query`、`inspect_answer`、`subagent`。

explorer 的 `explore_parent_task`、授权知识 `search_knowledge` 和 `read_knowledge` 也有独立子工具定义。reviewer 与恢复 Harness 没有工具，因此没有专属目录条目。条件注册仍由既有配置决定：Python、知识库、Dashboard、Widget、Jev 和 Subagent 未注册时不会出现在原生工具集合或目录中。

## 5. SYSTEM 分层迁移

`.pi/SYSTEM.md` 保留：

- 七槽位、Evidence Authority、未知与不适用；
- Answering begin/revise、探索/结果/发布生命周期；
- Hypothesis/Choice/Resolution 与总体选择约束；
- 外层定义循环、内层实现循环、共享预算和实现障碍处置；
- Candidate、Publication Receipt、子 Agent 无裁决权和业务假设披露。

已移出或改写：

- 单工具签名和局部参数守则不再作为可选工具的静态广告；
- Python、Widget、Dashboard 等能力只在当前请求目录可见且获得授权时使用；
- 知识读取保留按需加载原则，但具体调用入口和局部读取规则归知识工具守则；
- Jev、委派和展示能力的局部细节归各自工具元数据；跨工具的未决、披露和权限原则继续保留。

## 6. 旧规则到新归属迁移表

| 旧规则/内容 | 新归属 | 核对结果 |
| --- | --- | --- |
| 七槽位、Evidence Authority、Hypothesis/Choice、总体选择 | `.pi/SYSTEM.md` | 保留为跨工具业务协议 |
| `update_answer_spec` 的 begin/revise、ID 和未决阻断 | `update_answer_spec` 的 guidelines + `.pi/SYSTEM.md` | 工具局部守则与全局生命周期均保留 |
| 探索与结果查询的产物身份、Ready Revision、障碍分类 | `query_database` 的 guidelines + `.pi/SYSTEM.md` | 未改变 Answering 语义 |
| Candidate、Receipt、inline/CSV 行数政策 | 两个发布工具的 guidelines + `.pi/SYSTEM.md` | 不重跑 SQL、不从 Preview 导出 |
| Jev 的竞争假说输入与 advisory 边界 | `compare_hypotheses` 的 guidelines；全局仅保留未决原则 | 未把建议升级为 Evidence/Resolution |
| 子任务参数、最多两项、失败覆盖和报告边界 | `subagent` 的 guidelines；子角色报告合同留在子 prompt | 未授予子 Agent 裁决或发布权 |
| 知识搜索、500 行章节读取、Python、Dashboard、Widget 和文件边界 | 各自 definitions 的 guidelines | 随当前原生工具集合可见性变化 |
| 工具参数、枚举和弱 Schema | 原生 TypeBox `parameters` | 没有用摘要冒充 Schema 修复 |

逐条核对确认：没有把工具元数据当作授权，没有删除业务协议，没有恢复旧 `tools-catalog.ts` 查询协议，也没有改变 `replay`、`executionMode` 或工具返回结构。

## 7. 提示词大小基线

使用当前源码 definitions 生成全量主工具目录（包含知识、Python、澄清、Jev、Dashboard 和 Widget 条件能力）得到以下字符数基线：

| 项目 | 字符数 |
| --- | ---: |
| `.pi/SYSTEM.md` 基础提示 | 4,654 |
| 全量 18 个主工具目录 | 2,093 |
| 基础提示 + 目录分隔符 + 目录 | 6,749 |

目录没有截断预算；一旦超过评审基线应通过测试/审查显式处理，不会静默删除安全守则。条件能力未注册时目录按实际集合缩短；子 Agent 使用自己的工具子集和独立目录。

## 8. 验收证据

新增 `packages/runtime/src/agent/tool-prompt-catalog.test.ts`，覆盖：

- 空集合、子集、输入顺序变化后的稳定渲染和局部守则去重；
- 非法元数据、重复定义、未知活动名、重复活动名和 definitions 快照隔离；
- Adapter 下游实际 `Context.tools` 与目录集合一致；
- 基础 Context 不被修改，messages/tools/options 原样保留，其他 Models 方法保持绑定；
- 真实主/子 `AgentHarness` 请求经过 Adapter 后只呈现自己的活动工具目录，无工具 reviewer 不附加目录。

已执行并通过：

```text
npm run build
npm run typecheck
npm run typecheck:negative --workspace=@data-agent/runtime
npm test
npm run test:eval:spider2
npm run verify:architecture
npm run build:distribution
node scripts/smoke-web-host.mjs
```

既有 Answering、Session、Skill、delegation 和 child Harness 测试继续使用同一执行定义；与本功能无关的本地内置 Skill 路径配置问题不作为本轮功能证据或修复范围。

## 9. 明确未改变的内容

本轮未引入完整 coding-agent、未修改 `node_modules`，未新增能力/权限状态机、持久化目录镜像或第二套工具名目录；未改变 Answer Spec、Ready Revision、Result Candidate、Publication Receipt、查询预算、SpecFeedback、fanout、replay、executionMode、恢复策略和子 Agent 权限语义。`generate_dashboard.spec` 与 `show_widget.spec` 的弱 Schema 仍是后续独立合同改造，不以提示摘要宣称已修复。
