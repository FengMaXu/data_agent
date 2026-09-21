# Data Agent 工具提示目录开发方案

状态：待实现。本文是开发规格，不代表功能已落地或验收通过。

## 1. 目标与决策

复用 Pi coding-agent 的工具自描述与按活动工具组装提示词的设计原则，在 Data Agent 应用层补齐 `promptSnippet`、`promptGuidelines` 和工具提示目录；继续使用现有 Pi core / AgentHarness，不引入完整 coding-agent，不修改 `node_modules`。

交付目标：

1. 工具执行定义、摘要和局部守则共置，新增或修改工具不再需要维护另一份全局工具名目录。
2. 每次模型请求中的工具提示目录与该请求实际携带的 `tools[]` 一致。
3. 条件注册、技能切换、新用户请求重置、Session 恢复、主/子 Agent 均遵守同一机制。
4. `.pi/SYSTEM.md` 保留跨工具业务协议，移除重复的单工具说明和无条件可选工具调用指令。
5. 不改变 Answer Spec、Ready Revision、Result Candidate、Publication Receipt、查询预算或权限语义。

本方案不声称完整 coding-agent 无法适配。选择应用层补齐，是因为当前需要的是提示元数据与组合机制，而不是更换已有 Session、工具执行及业务控制面。

## 2. 事实基线与适用范围

### 2.1 本地已核对的事实

基于本地 `@earendil-works/pi-agent-core@0.85.1` 与 `pi-ai@0.85.1`，不要求联网或克隆 Pi：

| 来源 | 当前事实 |
| --- | --- |
| `pi-agent-core/dist/types.d.ts`、`dist/harness/types.d.ts` | `AgentTool` / `AgentHarnessTool` 不包含 `promptSnippet`、`promptGuidelines` |
| `pi-agent-core/dist/harness/agent-harness.d.ts` | `systemPrompt` 支持字符串或回调；回调参数不含当前 generation 的工具集合 |
| `pi-agent-core/dist/harness/runtime/drive/generation.js` | 请求工具来自 `generationContext.configuration.activeToolNames`；提示词另行解析 |
| 同上及 `dist/harness/execution/assistant.js` | 最终向 `Models.streamSimple` 传递包含 `systemPrompt` 和 `tools` 的请求 Context |
| `packages/runtime/src/agent/harness-factory.ts` | 直接传递静态 `options.systemPrompt`；`load_skill` 包装器会修改活动工具 |
| `packages/runtime/src/facets/agent-controller.ts` | 新 `prompt` 在接纳请求前重置为基础活动工具集合 |
| `packages/runtime/src/application/session-runtime.ts` | 组合 SYSTEM、Knowledge Catalog 和可选子 Agent 固定守则 |
| `packages/runtime/src/delegation/child-harness.ts` | 子 Harness 有独立工具集合和模型请求预算 Adapter |

`docs/tool_guidelines_and_snippets_audit.md` 是问题清单，不是精确接口规格。实施时同时修正其中两点：

- `promptSnippet` 不必复制完整签名或 JSON 示例；精确参数已经通过原生工具 Schema 提供。
- Pi core 没有这些字段，不等于违反 core 合同；缺口在 Data Agent 应用层的提示词组合。

历史 `tools-catalog.ts` 主要是工具表面及 Schema 目录，并不是已经实现过的动态 Tool Prompt Catalog。不得直接恢复旧文件及其旧查询协议。

### 2.2 不在本轮范围内

- 引入 Pi coding-agent 的完整扩展、命令、终端或编码工具体系。
- 新建插件市场、动态 MCP 工具注册系统或另一套权限/能力状态机。
- 更改工具名、调用参数、结果标记、`replay`、`executionMode` 或恢复策略。
- 改造 Answering、SpecFeedback、Jev、fanout 检测及其业务裁决权。
- 将 `generate_dashboard.spec` / `show_widget.spec` 全量改为严格判别联合 Schema。这是独立的参数合同改造，应复用现有 validator 后另立规格；本轮不能把提示摘要当成弱 Schema 已修复。
- 宣称 Python 工作目录隔离等同安全沙箱。

## 3. 职责分配与不变量

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| TypeBox Schema | 精确参数、必填项、枚举及合法结构 | 重复长篇工作流 |
| `description` | Function Calling 表面的一两句功能说明和必要边界 | 承载全部政策 |
| `promptSnippet` | 一行能力与使用场景摘要 | 完整 Schema、长 JSON 示例 |
| `promptGuidelines` | 本工具的时机、前置条件、输出解释、禁忌和错误处置 | 新增业务口径或可信状态 |
| `.pi/SYSTEM.md` | 证据优先级、七槽位、定义/实现双循环、发布身份、披露 | 静态罗列所有可选工具 |
| Runtime | 授权、验证、预算、不可变身份、执行与发布 | 依赖模型自觉执行安全限制 |

必须成立的不变量：

- **请求一致性**：目录中的工具名集合等于本次原生请求工具名集合，而非全部已注册工具或 Lane 的最新工具集合。
- **无权扩张**：渲染提示词不得调用 `setActiveTools`，不得注册工具或改变 Schema。
- **单一身份**：工具名仅来自执行定义的 `tool.name`；提示元数据不再声明一份 name。
- **单一执行**：生成目录不执行工具、不查询数据库、不调用模型、不创建 Query Task。
- **业务不变**：移除局部重复文字不能削弱跨工具政策和 Runtime 约束。
- **主子隔离**：子 Agent 目录只来自子 Agent 自己获授权的定义，不从主目录按名称借用能力。
- **确定性**：相同定义和相同请求工具集合产生相同目录；没有时间戳、随机 ID 或业务数据。
- **信任分离**：只有随代码交付的受信任元数据进入系统提示词。工具返回、知识正文、SQL 结果和子 Agent 报告不是元数据来源。

本方案是提示与执行合同对齐，不产生 Evidence、Review Decision 或 Publication Authorization。遵循 ADR-0003，不借此新增语义阻断器。

## 4. 模块设计

### 4.1 Seam：执行定义到模型请求之间

新增深模块 `ToolPromptCatalog`，隐藏以下实现：元数据检查、名称索引、稳定排列、守则去重、Markdown 渲染和请求目录一致性检查。

建议文件：

```text
packages/runtime/src/tools/tool-definition.ts
packages/runtime/src/agent/tool-prompt-catalog.ts
packages/runtime/src/agent/tool-prompt-models.ts
```

工具工厂共置元数据，Catalog 不维护按工具名手写的第二份政策表。

概念 Interface（最终类型须保持 TypeBox 参数及工具结果类型推导）：

```ts
interface DataAgentToolDefinition<TContext, TParameters, TDetails> {
  readonly tool: /* 对应泛型的 AgentHarnessTool */;
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
}

interface ToolPromptCatalog {
  render(activeToolNames: readonly string[]): string;
}
```

泛型约束以本地 Pi `AgentHarnessTool` 为准。允许内部 helper 保留 contextual typing，但不得为了包装元数据而新增 `any`、大范围断言或丢失 `execute` 的参数校验。

设计选择：

- 第一方工具必须显式提供非空 `promptSnippet`；`promptGuidelines` 必须显式提供，可为空数组。简单工具不强制写无意义守则。
- 不使用 description 自动兜底，否则元数据遗漏会长期隐藏。
- 不新增 `availability`、capability 注册表：条件注册仍由现有工厂完成，活动工具仍由 Pi Lane 管理。
- 不额外持久化活动工具镜像。Catalog 是受信任定义的只读派生对象。
- 主/子相同的知识读取守则可提取为共享只读常量，但子工具的权限说明必须独立。
- 生产工具工厂统一采用新定义；迁移测试和装配调用点，不长期维护 bare tool / wrapped tool 双轨兜底。

### 4.2 校验与渲染

构建时检查：

1. 工具名唯一；非空 snippet；元数据类型有效。
2. snippet 为一行，guidelines 每项为一条完整守则。
3. 文本只引用真实存在或明确条件化的协作工具，不制造不存在的调用入口。

渲染时：

1. 使用本次请求工具名选择定义；未知名或重复名视为装配错误，不能静默忽略。
2. 按固定名称顺序输出；不改变请求原生 `tools[]` 的顺序。
3. 每个条目由渲染器自动附上工具名，避免守则失去归属。
4. 同一工具内 trim 后完全相同的守则去重；不跨工具合并语义相近的守则。
5. 空集合返回空字符串，不给无工具请求附加主工具目录。
6. 不在超出大小预算时静默截断安全守则。为默认完整目录建立字符数基线与评审预算；增长必须明确评审。

示意：

```text
## 当前可用工具
- `inspect_answer`：读取 Query Task 的当前只读投影。
- `query_database`：在已登记任务下执行有界探索或当前版本的结果查询。

## 工具使用守则
- `inspect_answer`：投影不是第二份可写状态；修改定义使用 Answering 修订流程。
- `query_database`：探索产物不能发布；结果查询必须绑定当前 Ready Revision。
```

Schema 继续通过 `tools[]` 传递。复杂示例保留在已加载的业务指南、Skill 或必要的 Answering 全局协议中，不要求所有工具在每轮重复示例。

## 5. 请求级同步方案

### 5.1 为什么不直接读取 Lane 最新活动集合

以下实现不能单凭代码形态证明一致性：

```ts
systemPrompt: async (_, context) =>
  compose(base, catalog.render(await lane.getActiveTools(context)))
```

本地 Pi 将请求工具绑定到 generation configuration，回调却读取 Lane 当前状态。新请求重置、恢复或并发配置变化可能使两者不属于同一快照。`transform_context` 事件同样没有工具集合；`before_payload` 又是 Provider 专属数据形状。

因此，本轮不以“用了动态回调”作为验收标准，不解析各 Provider 的 payload，也不读取 Pi 私有 Lane 字段。

### 5.2 选定方案：在 Pi AI 请求 Context 上组合

在 Data Agent 应用层提供一个窄 `Models` Adapter，包装交给当前 Harness 的 `Models.streamSimple`：

```text
AgentHarness
  → 原生 generation 工具快照 / system prompt / context hooks
  → ToolPrompt Models Adapter
      从 Context.tools 取实际工具名
      由当前 Harness 的 Catalog 渲染
      以新的 Context 合并 systemPrompt
  → 原 Models.streamSimple
  → Provider
```

选择依据：本地生产主/子 Harness 的生成路径使用此方法；参数已经包含同一请求的 `systemPrompt` 和 `tools`。仓库现有 `boundedModels` 也使用 Models Adapter，但不意味着可省略新的兼容性测试。

Adapter 要求：

- 只复制 Context 并追加一个受控目录块；不改 messages、tools、Schema、model、options、signal、认证、重试、stream 或用量。
- 保持 `streamSimple` 的同步返回流合同，不改为返回 Promise。
- 其他 Models 方法正确绑定原对象并透传，不修改共享 Models 实例。
- 每个 Harness 只安装一次自己的 Adapter。主/子包装器不得互相嵌套导致主目录流入子请求。
- 使用原始 base system prompt 逐请求组合；不能把已渲染结果写回 base 或 Session。
- 无工具的压缩、分支总结或 reviewer 请求不附加工具目录；不得影响 deferred handle 的获取/取消。
- 子 Harness 与 `boundedModels` 组合时保证每次请求仅计费/计数一次，目录渲染不触发额外模型调用。
- 未知工具名以明确配置错误结束该请求，不发送“有工具但无对应目录”的残缺请求；遵循原有失败/流错误传播合同，不伪装成业务失败。

生命周期：

| 场景 | 预期 |
| --- | --- |
| 首次请求 | 对齐本次已获授权的原生工具集合 |
| `load_skill` 成功 | 保持当前选择逻辑；下一次模型请求根据其 tools 自动更新 |
| 加载失败 | 不修改活动工具，目录不凭失败输入变化 |
| 没有 allowlist 的技能 | 保持现有行为，不擅自扩展/收缩 |
| 技能请求未授权工具 | 仍使用现有授权交集，目录不扩权 |
| 新用户 prompt | 保持 controller 基础集合重置，随后目录随请求恢复 |
| 旧 generation 重试、恢复 | 以该 generation 实际工具集合为准，不读取最新 Lane 覆盖它 |
| Session 重开 | 从当前受信任定义重建 Catalog，不恢复旧目录字符串 |
| 主/子并行 | 各自的 Catalog 与 request Context，不共享可变 active names |

### 5.3 已知边界

- 动态追加发生在 Models Adapter，Pi 较早阶段的纯 systemPrompt 投影可能不含追加部分。验收必须捕获真正送达底层 Models 的请求；不能用读取 `.pi/SYSTEM.md` 或 Harness 配置替代。
- 默认只记录目录版本、工具名集合与文本长度等非敏感诊断，不另建持久化 prompt 状态，不修改 Candidate/Receipt。
- 模型得到更长提示词，需记录请求大小变化。不要声称目录缩短必然提升准确率。
- Pi 升级若改用其他生成入口，请求一致性合同测试必须失败并提示适配；禁止静默漏注入。
- 将来若 Pi 的公开 prompt seam 提供同一请求工具快照，可替换此 Adapter，保留 Catalog 和工具定义，不叠加第二套组装。

## 6. 工具覆盖与守则迁移

下面是需要覆盖的第一方工具，不代表所有 Session 同时注册全部工具。最终清单由实际工厂输出及测试确认。

| 工具 | 摘要方向 | 局部守则重点 |
| --- | --- | --- |
| `list_workspace` | 列出当前工作区文件 | 只说明当前工作区，不暗示全系统浏览 |
| `read_file` | 读取工作区文件及可选行区间 | 一基包含边界；披露截断，按现有实现继续读取 |
| `write_file` | 写入工作区文件 | 明确覆盖语义、路径范围；不声称自动发布 |
| `search_knowledge` | 检索相关知识章节及正文 | 先搜索、按需选择；结果已足够则不重复读 |
| `read_knowledge` | 读取短文档或命名章节 | 500 行边界、sectionId/continuationToken、不自行算行号 |
| `update_knowledge` | 追加学习或写入受限知识内容 | 不把草稿/学习记录变成已审核业务定义 |
| `run_python` | 在配置的 Python 环境执行分析 | 统计与绘图条件分开；工作区、实际超时与失败语义，不承诺安全沙箱 |
| `ask_user_clarification` | 请求并等待结构化用户澄清 | 未决口径不能由工具建议替代用户确认 |
| `load_skill` | 加载已发现技能 | 仅加载现存技能；allowlist 不授予新能力 |
| `generate_dashboard` | 验证或生成看板 | 先加载 dashboard Skill；仅支持现有 mode/version 组合；validator 为准 |
| `show_widget` | 输出结构化展示部件 | 明确可视化授权条件与现有 kind；不绕过发布授权 |
| `update_answer_spec` | 开始/修订七槽位规格 | 完整 Proposal、当前 baseRevisionId、系统 ID；SpecFeedback 仅告知 |
| `query_database` | 有界探索或结果查询 | 两种产物身份、Ready Revision、障碍分类、未知结果不得盲重跑 |
| `compare_hypotheses` | 比较互斥假说并给建议 | 提交所有竞争假说；建议非 Evidence/Resolution，不解除总体未决 |
| `publish_query_result` | 发布小结果 | 当前 Candidate、≤10 行、inline、不重跑 SQL |
| `export_query` | 发布完整 CSV | 当前 Candidate、>10 行、csv、不从 Preview 拼导出 |
| `inspect_answer` | 读取 Query Task 投影 | 只读，不创建第二份可写状态 |
| `subagent` | 有界委派探索或审阅 | 当前 IDs、最多两项、角色能力、失败覆盖、报告不可信 |
| `explore_parent_task`（子） | 在父任务授权范围内探索 | 只读、有界、父预算、没有 result/发布权 |
| `search_knowledge` / `read_knowledge`（子） | 授权知识子集的检索/读取 | 除通用读取守则外，保留 child 路径及证据范围 |

写入元数据前检查真实实现，尤其是写文件、Python、dashboard 和 widget。审查文档中的描述不能替代运行时代码证据。

### 6.1 SYSTEM 保留内容

- 七槽位定义、Evidence Authority、未知与不适用的区别。
- 唯一 Answering 生命周期：先定义、再探索/结果、再发布。
- Hypothesis/Choice/Resolution 的权限和总体选择约束。
- 外层定义循环、内层实现循环、预算共享、未知执行结果处置。
- Candidate 不等于发布授权；Publication Receipt 才授权读取与下载。
- 发布成功后停止，用户另有分析/绘图/看板请求除外。
- 业务假设和数据限制披露，不以简单指标代替无法完成的指定指标。
- 子 Agent 报告无裁决权的全局原则。

七槽位及当前 Answering JSON 示例不是简单的工具广告，不为追求短提示词强行删除。

### 6.2 SYSTEM 移出或重写内容

- 单工具签名列表、局部参数用法 → Schema、对应 snippet/guidelines。
- knowledge 具体读取方式 → 知识工具守则；按需加载的全局原则保留。
- Jev 调用细节 → `compare_hypotheses`；全局保留未决不能猜测解决的政策。
- 无条件 `run_python` / `show_widget` / `generate_dashboard` 指令 → 各自守则；全局只要求授权与披露。
- `composeSubagentSystemPrompt` 中委派参数及失败状态用法 → `subagent` 元数据；角色报告合同留在子 prompt。

跨工具依赖处理：

- 不能为“所有工具名都不出现在 SYSTEM”而删掉 Answering 协议。全局引用与“当前可调用工具广告”是两回事。
- 可选工具不活跃时，不应留下要求立即调用它的专属守则。
- 协作工具存在时写清调用顺序；不存在或不活跃时说明能力限制，不用不存在工具补救。
- `generate_dashboard` 依赖的 Skill 是否存在，按当前资源实际检查；不得让目录暗示一定可加载。
- 自定义 `options.systemPrompt` 保持作为调用方可信基础提示词，不自动重写任意文字；动态目录仍追加。调用方若写死不可用工具，记录为其 prompt 兼容性限制，不用正则静默删改。

迁移需逐条建立旧规则 → 新归属的核对表。关键安全语句允许有意重复，不能为了去重失去语义。

## 7. 装配修改清单

| 文件/区域 | 计划改动 |
| --- | --- |
| `tools/tool-definition.ts`（新增） | 元数据类型及保持类型推导的最小 helper |
| `agent/tool-prompt-catalog.ts`（新增） | 只读索引、校验、纯渲染 |
| `agent/tool-prompt-models.ts`（新增） | 请求 Context Adapter，无业务状态 |
| `tools/core.ts`、`tools/answering.ts`、`tools/subagent.ts` | 工厂返回新定义；就地填写摘要与守则 |
| `application/session-runtime.ts` | 聚合定义；保留基础 prompt 与 Knowledge Catalog；移除重复委派提示组装 |
| `agent/harness-factory.ts` | 从定义取得原生 tools；保留 load_skill 包装；安装主请求 Adapter |
| `application/delegation.ts` | 子工具定义共置；保留子角色、安全和证据报告合同 |
| `delegation/index.ts`、`delegation/delegation.ts`、`delegation/child-harness.ts` | 传播子定义并在真实执行 Harness 接入；空工具恢复 Harness 保持无能力 |
| `.pi/SYSTEM.md` | 按规则归属迁移，不改业务协议 |
| `protocol.ts` 及现有测试工厂调用点 | 如受类型变动影响则同步；不为了测试暴露无关实现 |
| `docs/tool_guidelines_and_snippets_audit.md` | 修正分层与 snippet 定义；链接本方案，明确审查是历史基线 |

Electron、Web、Spider2 应继续共用 Session Runtime。先检查其自定义 prompt 和绕过 Harness 的路径，仅在实际需要时修改，不为目录功能复制各 Host 的逻辑。

## 8. 测试与验收

### 8.1 Catalog 单元测试

- 空集合、单工具、全部工具、子集、输入顺序改变。
- 缺失 snippet、重复定义、未知活动名、重复活动名明确失败。
- 相同输入字节级稳定；条目只出现一次；守则归属明确。
- 外部修改传入数组不能改变已经建立的 Catalog。
- 主/子同名工具使用各自元数据；禁用工具无专属条目。

### 8.2 请求合同测试（必须，不能只测 render）

使用本地 faux/记录型 Models，不依赖真实 API：

1. 捕获 Adapter 下游 `streamSimple` 的实际 Context，断言目录工具名恰好等于 `context.tools` 名称。
2. 修改 Lane 最新工具集合但保留旧 generation 请求：仍按传入 Context 渲染。
3. 两个 Session/子 Harness 并发，活动集合不同；无串用。
4. 相同基础 Context 多次请求/重试，目录不累积，不修改原 Context。
5. messages、tools、Schema、options、abort signal 原样传递；原流错误/取消仍可观察。
6. 不改模型请求次数、token cap、子预算计数；其它 Models 方法正常绑定和透传。
7. 无工具请求、压缩/总结、恢复专用 Harness 不出现主目录；deferred 接口保持原样。
8. Pi 真实 Harness 经过 Adapter 再到记录型 Models，证明不是仅测试手工直调包装器。

### 8.3 Session / Skill / 子 Agent 集成测试

- dashboard/widget 禁用、Python 未配置、知识缺失、advisor 未配置、subagent 禁用分别验证原生工具和目录同时缺席。
- 有 provider 函数但执行时 Python 不可用：保持现有执行错误，不把注册存在当作运行成功保证。
- `load_skill` 前后两次模型请求的目录随实际 allowlist 切换。
- 加载失败、无 allowlist、未知授权名、控制面保留规则不回归。
- 下一次用户 prompt 恢复基础集合；旧 generation/retry 不错误恢复全量集合。
- Session 重开、open operation 恢复不会从进程本地目录缓存恢复错误权限。
- explorer 只有授权工具；reviewer 无工具；恢复路径不新增执行入口。

### 8.4 政策迁移回归

- 逐条核对规则迁移，覆盖七槽位、证据、假设、双循环、查询障碍、SpecFeedback、发布和子权限。
- 检查动态目录未附带未激活可选工具的专属指令。不要用禁止 SYSTEM 出现一切非活动工具名的宽泛正则。
- 工具名、parameters、replay、executionMode、返回结构迁移前后一致；如发现必须修改，单独列出，不混入元数据改造。
- 既有 Answering、fanout、SpecFeedback、publication、delegation 测试继续通过。
- 记录基础 prompt / 目录字符数变化；不将单次模型表现当成准确率提升证据。

建议验证命令：

```bash
npm run verify:architecture
npm run typecheck
npm run typecheck:negative --workspace=@data-agent/runtime
npm test
npm run test:eval:spider2
git diff --check
```

仅当分发资源或 Host 装配受影响，再执行对应 distribution build、Web/Electron smoke。无需为元数据单测访问生产数据库或真实 Jev。

## 9. 实施阶段

### P0：冻结基线

- 检查工作树，保留已存在的 SpecFeedback、fanout 等未提交改动。
- 用本地依赖核对请求 seam，建立真实 Harness 请求捕获测试。
- 盘点生产工具工厂、子工具、SYSTEM 和自定义 prompt；输出规则迁移表。

完成条件：本地证明 request Context 可取得同次请求的工具集合；不以最新 Lane 状态替代。

### P1：建立模块

- 实现定义类型、Catalog 和 Models Adapter。
- 完成渲染与请求合同测试，禁止联网 fallback 和重复请求。

完成条件：确定性渲染、原生工具一致性、无副作用及流合同通过。

### P2：迁移主工具及 Session

- 所有第一方主工具共置元数据。
- Session/Harness 接入，覆盖条件注册、Skill 切换、新请求重置和恢复。
- 类型迁移完成后删除临时桥接，不同时保留两套目录来源。

### P3：迁移子工具及政策

- explorer 工具与子 Harness 接入；reviewer 和恢复 Harness 保持空能力。
- 迁移 SYSTEM / 委派提示局部规则，核对每条旧规则归属。
- 同步审查报告中的概念修正。

### P4：集成验收

- 执行测试矩阵和仓库验证命令。
- 提交工具覆盖表、政策迁移表、提示词大小对比、残留限制。
- 所有必须验收项完成后才标记完成；Schema 弱类型问题明确作为后续项，不报已修复。

## 10. 风险与回退

| 风险 | 控制措施 |
| --- | --- |
| 双份工具目录重新产生 | 元数据共置；禁止按名称维护独立提示表 |
| 动态回调与 generation 不一致 | 使用本次 Models Context.tools；合同测试覆盖旧 generation |
| 提示迁移丢失业务约束 | 逐条迁移表；业务不变量与既有测试共同验收 |
| 主目录泄漏到子 Agent | 每 Harness 独立 Catalog，从未包装的 Models 分别构建 |
| 工具元数据冒充授权 | Runtime 不变；目录仅描述实际请求工具 |
| 简化 Schema 假装修复 | 保留 validator，弱 Schema 明确列为未解决 |
| Pi 升级或新模型入口绕开 Adapter | 版本升级运行真实 Harness 合同测试，显式更新适配 |
| 观测提示词与实际请求不同 | 在 Adapter 下游验证；披露早期 prompt 投影边界 |
| 提示体积上升 | 一行摘要、紧凑守则、确定性输出及长度基线 |

回退按完整变更集执行：目录机制与 SYSTEM 迁移必须一起回退，不能只关闭注入而留下已删除的业务守则。不新增业务 feature flag，不迁移 Answering 存储或历史 Receipt；恢复原装配和提示词不应重跑任何查询。

## 11. Definition of Done

- [ ] 所有实际注册的第一方主/子工具都有共置 snippet；guidelines 显式声明。
- [ ] 本次请求目录名集合与原生 `tools[]` 一致，覆盖切换、恢复、重试和并发。
- [ ] 没有新增能力状态机、权限来源、持久化目录镜像或第二套工具名目录。
- [ ] SYSTEM 保留完整跨工具业务协议，可选工具专属守则随请求可见性变化。
- [ ] 查询、发布、预算、SpecFeedback、fanout、子 Agent 权限均未改变。
- [ ] 主/子模型流、取消、恢复和预算合同无回归。
- [ ] 审查报告完成概念修正；测试、规则迁移与大小对比证据齐备。
- [ ] 未引入完整 coding-agent，未改动本地依赖，未覆盖先前未提交工作。
