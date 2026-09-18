# Subagent 接入方案：以 AgentHarness 承接委派执行

> 状态：首版代码与确定性自动化验证已完成；生产启用仍受 scoped executor、真实供应商/数据库 smoke test 与质量收益证据约束。  
> 目标：主 Agent 负责流程编排和主实现；探索、审查在独立上下文执行，仅向主 Agent 返回有界、可追溯的结论。  
> 技术选择：保留 Pi AgentHarness；以原生 Harness 委派 Module 复用 `pi-subagents` 的协议语义，不迁回 AgentSession，不实现完整 ExtensionAPI，也不标称原版插件兼容。  
> 首版范围：一次委派调用、最多两个并行子任务、独立 Session、只读能力、同步收集结果、取消与中断可解释。  
> 实施证据：[P0 兼容边界](implementation/subagent/p0-compatibility.md)、[P3 验证记录](implementation/subagent/p3-validation.md)。

## 1. 阅读入口与事实基线

本文件可以独立交给实施者，不要求阅读此前聊天。相关文档：

- [后端目标架构与重构计划](backend_architecture_decoupling_analysis_and_plan.md)：总体方向；其开头“当前依赖 0.83.0”已落后于本次检查到的代码，不作为本方案版本依据。
- [领域术语](../CONTEXT.md)：Query Task、Answer Spec、Observation Evidence、Review Outcome、Publication Receipt。
- [ADR-0003](adr/0003-detect-inform-never-block.md)：审查默认不拥有发布权，观察不等于裁决。
- [ADR-0001](adr/0001-query-assurance-responsibility-separation.md)、[ADR-0002](adr/0002-bounded-deterministic-query-gates.md)：职责分离与覆盖范围；冲突部分依 ADR-0003 的后续决策处理。

本次已阅读的代码事实：

| 位置 | 事实及接入意义 |
|---|---|
| `packages/runtime/package.json` | Pi core/ai/chord/telemetry 为 `0.85.1`，没有 coding-agent 依赖 |
| `packages/runtime/src/agent/harness-factory.ts` | 直接调用 `AgentHarness.create`；同时装配主会话的业务投影，不适合整个递归复用于子 Agent |
| `packages/runtime/src/application/session-runtime.ts` | 组装 Answering、工具、资源及主 Session Host，是委派能力的组合入口 |
| `packages/runtime/src/tools/answering.ts` | 通用 `query_database` 同时支持 exploration/result；不能原样授予子 Agent |
| `packages/runtime/src/answering/service.ts` | exploration 已注册任务级观测证据；应复用该入口，不绕开 Answering 直接查询后伪造证据 |
| `packages/runtime/src/session-store.ts` | 已封装 Pi Session 存储；`applicationMetadata` 存在内存映射，不能用它单独承载重启后的父子关联 |

插件基线是本机安装的 `pi-subagents@0.56.0`，不代表产品已安装它。其源码中：

- `index.ts` 接收 coding-agent `ExtensionAPI`。
- `src/extension/index.ts` 注册工具、事件、渲染器，并访问 SessionManager。
- `src/shared/fork-context.ts` 依赖 coding-agent SessionManager。
- `src/runs/foreground/execution.ts` 启动外部执行进程。
- `src/api/delegation.ts` 导出了结构化委派请求、结果和事件名，**不是可独立运行的子任务执行器**。

因此，当前不能声称“安装即可兼容”，也不能假定只替换一个函数就能完成移植。实施第一步须给出真实的可复用清单。

## 2. 目标架构与不做事项

```text
Data Agent 产品
└─ 主 Session / AgentHarness
   ├─ 现有业务工具：口径提案、查询、发布、文件实现等
   └─ subagent 工具：仅提交任务和有限上下文
      └─ Delegation Module（一个内部模块）
         ├─ 校验、额度预留、父子关联、结果收集
         ├─ explorer → 独立 Session + AgentHarness + 受限探索工具
         └─ reviewer → 独立 Session + AgentHarness + 只读材料
```

职责不重叠：

| 主体 | 拥有 | 不拥有 |
|---|---|---|
| 主 Agent | 拆分任务、主实现、整合证据、提出 Spec 修订、调用最终业务工具 | 自报证据可信或绕过发布校验 |
| 子 Agent | 在分配范围内探索、指出分歧和未检查项 | 修改主 Spec、选择最终口径、发布结果、再派生子 Agent |
| Delegation Module | 委派关联、权限收窄、资源上限、收集与取消 | 模型循环、Pi Operation 状态机、业务正确性裁决 |
| Pi | 每个 Session 的执行、工具调用、Operation 与原生持久化 | 自动维护跨 Session 的父子业务关联 |
| Answering | Query Task、证据登记、版本、候选与交付完整性 | 子 Agent 调度 |

首版明确不做：完整插件发现/热重载、ExtensionRunner 仿真、AgentSession 方法兼容、TUI、工作流脚本 DSL、后台任务唤醒、定时调度、递归派生、自动审查修复循环、完整主会话 fork、写文件子 Agent。

这里是多个执行实例、一个 Data Agent 产品，不是另建一套业务 Agent 系统。独立 Session 隔离对话，**同进程运行不是安全沙箱**。

## 3. 插件复用与 Harness 映射

### 3.1 复用策略

优先顺序：独立公开入口 → 经依赖检查可提取的小段实现 → 仅借鉴协议和设计。

| 插件能力 | 本方案处理 |
|---|---|
| 角色、任务、fresh context、有界结果 | 保留设计；首版仅 explorer/reviewer 两个受信角色 |
| delegation 请求/响应 | 复用可适用的关联、状态、usage 语义；列明支持子集，不声称完全兼容 |
| 独立配置解析、结果校验代码 | P0 检查传递依赖和测试后决定复用 |
| coding-agent 进程启动、SessionManager 操作 | 由 Harness 原生执行路径替换，不做同名方法仿真 |
| 扩展事件总线、后台通知、TUI | 首版不搬；工具 Promise 返回就是父任务的交接点 |

若需要复制或维护上游源码，固定版本、保留 MIT 声明和来源，记录改动范围；不修改开发者全局安装目录，不在产品中 deep-import 插件私有路径。

**P0 决策门：**若上游没有可用的执行替换接缝，提交“有限 fork”与“原生 Harness 委派模块、仅复用协议”的具体差异，确认后再继续。不得把后者宣传为已接入原版插件，也不得为兼容顺手重建整个宿主。

### 3.2 执行映射

| 必要宿主能力 | Harness 实现方向 |
|---|---|
| 创建子执行 | 新建独立 Session，`AgentHarness.create`，取得子 Session 的 `main` lane |
| 提交并执行 | `lane.accept` 后 `lane.drive`；保存接受的 operationId |
| 工具注册 | 创建时传入受限 `AgentHarnessTool[]`，不加载完整主工具集 |
| 状态与结果 | `inspectExecution` / `getResult`；需要进度时用原生 lane watch |
| 中止 | 对精确子 operationId 调用 `requestAbort`，再观察原生终态 |
| 运行内额度检查 | 使用原生 Hook/工具执行入口，在外部调用前检查，不复制模型循环 |
| 持久关联 | 主工具 invocation memo 记录子 Session/Operation 身份；子会话使用原生存储 |
| 交接 | 主工具返回经校验的结果；不同时再用 followUp 注入同一份消息 |

Hook 的触发次数、取消传播和恢复行为必须针对固定版本做测试，不能按 AgentSession 事件名机械映射。

## 4. 最小接口、上下文与结果协议

### 4.1 模型只看到一个工具

```ts
// 目标形状，不是已实现的运行接口。
type SubagentInput = {
  tasks: Array<{
    key: string;                         // 本次调用内唯一，最多 2 项
    role: "explorer" | "reviewer";
    task: string;
    taskId: string;                      // 仅是定位符，不是授权能力
    revisionId: string;                  // 解析时必须仍是当前版本
  }>;
};
```

模型不能设置 principalId、父子 Session ID、凭证、任意工具名、文件根目录、模型提供方或执行命令。模型提交的 taskId/revisionId 只是定位符；宿主从受信 principal/session 重新检查任务访问、当前 revision 和候选身份，定位符本身不授予权限。缺少合法任务时不能执行数据库探索。

内部仅暴露 `run(input, trustedContext, signal)` 和 `close()`。首版无需对外发布 start/status/result/cancel 四套接口：`run` 等待这一批结束，signal 及 Host close 触发取消。父模型调用期间可以暂停，批内子任务仍可并行。

### 4.2 上下文由宿主组装，不能只靠主 Agent 摘要

每个子 Session 都从 fresh context 开始：

- 原始用户请求的相关内容，从受信消息引用读取。
- 分配任务、允许检查的范围、受信角色提示词。
- 需要时读取指定 Query Task 的 Spec 快照及 revisionId。
- 探索所需的文档/Schema 引用；审查所需的候选 SQL、证据和结果形状。
- 对代码/文档审查，绑定具体文件内容快照；对查询审查，绑定候选与 Spec 版本。

不复制主对话历史、主 Agent 的思考、自我验证声明、完整 SQL 数据或凭证。审查材料从授权快照组装，不能把主 Agent 的说服性总结当成原始证据。数据库内容和文档正文均作为待分析材料，不作为系统指令。

### 4.3 交接结果

宿主生成可信关联和执行状态；模型仅提供报告内容：

```ts
type ChildOutcome = {
  key: string;
  runId: string;                         // 宿主生成
  targetRef: string;                     // 绑定任务/版本/候选或材料快照
  status: "completed" | "failed" | "cancelled" | "interrupted"
        | "timed_out" | "budget_exhausted" | "invalid_output" | "abort_unconfirmed";
  report?: {
    summary: string;
    findings: Array<{
      statement: string;
      evidenceRefs: string[];
    }>;
    unchecked: string[];
    questions: string[];
  };
  reportRef?: string;                    // 私有、鉴权读取；不是发布链接
  usage: { inputTokens: number | null; outputTokens: number | null; cost: number | null };
};
```

- `completed` 仅说明执行完成且输出结构合格，不代表审查 Approved 或语义正确。
- 所有引用由宿主校验存在性、访问权限和来源；模型不能生成可信证据身份。
- 空 findings 必须同时说明检查范围；失败、未检查不得显示成“审查通过”。
- 主上下文只收到有界 report 与引用；完整工具轨迹留在子 Session。工具 `details` 也不得暗中塞回整份轨迹。
- 若提供完整报告读取，必须按单次读取和累计读取设限，不能通过连续读取恢复整段子对话。
- Spec/候选/文件快照变化后，旧报告保留可读但标记目标过期；不得作为新目标已审查的依据。

## 5. 权限与探索证据：必须解决的业务接缝

### 5.1 角色权限

| 能力 | explorer | reviewer |
|---|---|---|
| 读取授权材料、知识和 Schema | 允许，按引用/范围限制 | 允许，按审查快照限制 |
| 执行 SQL | 只允许受限 exploration | 首版不允许；需要新观测时返回请求 |
| 修改 Spec、假设处置、执行 result SQL | 禁止 | 禁止 |
| 内联发布、CSV 导出、看板、知识写入、文件写入 | 禁止 | 禁止 |
| Shell/Python/任意网络/凭证读取/派生子 Agent | 禁止 | 禁止 |
| 向用户直接提问 | 禁止；经报告交给主 Agent | 同左 |

不要把 `createCoreAgentTools()` 全集交给子 Agent 后仅隐藏名称。仅装配允许的实现；首版不提供 `load_skill`，避免动态恢复权限。

### 5.2 不把子 Session 冒充父 Session

当前 Answering 按 principal + session 校验任务访问，而证据应登记在父 Query Task。解决方式是在 **application 组合层创建一个任务绑定的探索闭包**：

1. 主工具入口校验当前 principal 对父 Query Task、数据连接和材料的权限。
2. 闭包固定 ownerSessionId、taskId、允许的探索类型、额度和有效期；子模型只能提交 SQL/受限 limit。
3. 闭包再次检查有效期、任务访问与取消状态，强制调用已有 `Answering.execute({ kind: "exploration", taskId, ... })`。
4. 用子 Session ID 与原生 invocationId 的组合形成宿主侧唯一调用身份，避免 Session 内唯一 ID 在父任务中冲突；使用子调用 memo，不复用父工具 memo 作为每条 SQL 的身份。
5. 审计记录同时关联 owner Session、child Session、原生子 Operation/Invocation；执行器明确是受委派的宿主调用，而不是让子 Agent 自填主身份。
6. 返回 Answering 登记的真实观测句柄；主 Agent 在后续提案中引用它，Runtime 决定它支持什么。

这不要求 Answering 新增子 Agent 调度方法，也不允许子 Agent 直接取得完整 Answering 对象。闭包必须只暴露探索操作。

“只读探索”允许登记审计和观测，不允许修改业务口径。已有 SQL 只读检查不能替代数据库侧最小权限；连接须限制写入、危险函数和文件/网络副作用，并设置数据库执行超时。实现以 `SessionQueryExecutor.scopedExploration` 作为显式能力标记：它必须携带宿主签发的 `scopeId/connectionId`，并在数据库边界执行连接、schema/relation、只读和字节上限策略；普通 executor 未提供该能力时，Explorer SQL 工具不注册。无法满足时，不开放子 Agent SQL 能力。

## 6. 生命周期、持久化与额度

### 6.1 正常路径

```text
主 Agent 调用 subagent
→ 校验目标/材料/角色，原子预留本批额度
→ 主 invocation memo 写入已分配子 Session 身份
→ 创建子 Session，记录关联，accept 子 Operation
→ memo 写入子 operationId 后 drive
→ 子任务使用受限工具，轨迹留在各自 Session
→ 解析并校验报告、引用和目标版本
→ 主工具一次返回各子任务结果
→ 主 Agent 决定后续实现/澄清/查询，原有交付规则照常执行
```

独立任务失败不取消成功的兄弟任务；返回每项结果，不伪造一个整批成功。不得自动无界重试；格式错误首版返回 invalid_output，不另起修复 Agent。

### 6.2 取消与中断

- 父 Operation 中止、超时或 Host close：停止新子任务，并对已接受的子 Operation 请求显式中止。
- 不能用 Promise.race 超时后丢下后台执行；停止发起新模型/SQL 调用，并等待可确认的终态或记录取消未完成。
- 客户端断开是否取消沿用产品既有 Session 策略，不能把 SSE 断连自动解释成用户取消。
- 主 lane 正等待工具，子任务不得向主 lane 发起一个需要主 lane 空闲才能完成的反向调用，避免死锁。

### 6.3 首版不承诺跨进程自动续跑

- `subagent` 首版使用 `replay: "never"`。Pi 恢复主 Operation 时，不因工具重放自动再启动一批子任务。
- 主 invocation memo 只存父子关联、接受身份和结果引用，不镜像 Pi 的完整运行状态。
- 子 Session 存原生执行记录和结构化报告；不依赖应用层内存 metadata 恢复关联。
- 启动时读取关联：已完成结果保持可追溯；未完成子任务不自动 drive，收敛为中断/请求中止。默认需要主 Agent 明确发起新委派。
- 对“已创建 Session 但 memo 尚未写完”等窗口，通过预先分配的 Session ID 与父关联识别孤儿，完成清理；孤儿不应出现在普通用户会话列表。
- 父工具已结算的结果不二次注入。结算前崩溃的任务按中断处理，不能承诺结果恰好交付一次。
- 若以后要求自动恢复，在单独阶段实现跨 Session 协调及崩溃测试；不能直接把 replay 改成 safe。

### 6.4 首版建议默认值（待 P0 压测后冻结）

| 限制 | 初始值 |
|---|---|
| 单次批量 / 每个父 Operation 同时运行子数 | 最多 2 / 最多 2 |
| 每个父 Operation 总派生数 | 4；重试也计入 |
| 每个子任务工具调用数 / 模型请求尝试数 | 8 / 6；重试请求计入 |
| 单子任务时限 | 120 秒 |
| 单子任务输入材料 / 返回主上下文 | 32 KiB / 8 KiB，按 UTF-8 序列化计数 |
| 每次模型最大输出 | 2048 tokens；不支持该限制的提供方不得假装已生效 |
| SQL 预览 | 最多 50 行，并加序列化字节上限及独立查询超时 |

宿主在启动前原子预留，不能等子任务结束才累计。父 Operation 的派生计数保存在原生 Session 可持久数据中；Pi 的模型 usage 不自动等于业务委派额度。

服务端还须配置全局模型/数据库并发上限，拒绝或有界等待，不能只有每会话上限。真实 usage 取自原生记录；主子分别记录、展示时聚合一次，缺少价格映射时 cost 为未知而不是 0。上述上限不等于硬金额预算，取消也不能保证供应商立即停止计费。截止时间覆盖解析、并发等待、Session/Harness 创建、accept、drive 和工具执行；外部查询必须接收同一取消信号与剩余 deadline。

## 7. 文件落点与改动约束

建议只新增一个 Delegation Module，不建立插件平台包：

```text
packages/runtime/src/
  delegation/
    index.ts                    # run/close 与输入输出类型
    delegation.ts               # 校验、受限批量、关联、收集、取消
    child-harness.ts            # 创建/关闭子 Harness，原生执行映射
    report.ts                   # 输出校验、引用与长度限制
    *.test.ts
  tools/subagent.ts             # 单一模型工具，原生 invocation memo 桥接
  application/delegation.ts     # 任务绑定探索闭包、材料/角色装配
```

具体既有文件的改动：

| 文件 | 必要变更 | 禁止顺带做 |
|---|---|---|
| `application/session-runtime.ts` | 可配置启用委派，组装并注入工具及关闭回调 | 再创建第二套 Answering |
| `agent/harness-factory.ts` | 如有真实共用，提取模型配置/最小 Harness 创建代码；关联子任务关闭 | 将整个主 Host 递归用作子 Host，携带发布工具和所有 Facet |
| `session-store.ts` / Application Host | 提供私有子 Session 创建/定位，使用原生持久关联，过滤用户会话列表 | 再造 JSONL 运行日志库 |
| `tools/answering.ts` | 优先不改模型接口；必要的公共实现仅提取内部 helper | 为子 Agent 放宽父任务授权 |
| `agent/harness-factory.ts` / QueryExecutor | 传递 signal、deadline、preview bytes；无 `scopedExploration` 时不开放 Explorer | 把词法只读检查冒充数据库安全边界 |
| `scripts/verify-backend-architecture.mjs` | 检查依赖方向与禁用宿主导入 | 把静态检查说成语义正确性证明 |

Answering 不依赖 delegation；delegation 不依赖完整应用 Host。依赖通过组合入口注入。首版不新增 Chord Service、HTTP 子任务 API 或前端子任务管理中心；可选进度仅使用现有通道的有界摘要，不能混入子模型原文。

## 8. 执行计划与阶段退出条件

### P0：固定兼容边界，验证最小执行

- 固定 Pi 0.85.1、插件 0.56.0；在隔离目录检查插件公开入口及传递依赖，不修改产品依赖。
- 逐项列出插件调用：复用/替换/首版不支持，特别检查 delegation 导出是否只是协议。
- 用受控模型运行“主工具 → 两个独立子 Harness → 结果收集”，验证取消、memo、replay never、Hook 触发与 Session 重开。
- 产出 `docs/implementation/subagent/p0-compatibility.md`：实际命令、依赖清单、可复用文件、许可证、未通过点及最终适配选择。
- **退出条件：**无 AgentSession/ExtensionRunner/TUI 执行依赖；不能通过时停止并提交具体取舍，不先搭兼容框架。

### P1：最小委派模块，不接真实数据库

- 实现工具、fresh Session、角色固定、输入/输出校验、批量与额度、关闭清理。
- 用假工具测试成功、部分失败、超时、取消、恶意引用和超长报告。
- **退出条件：**主子对话独立、主上下文只有报告、额度不可被并发绕过，关闭后无新增调用。

### P2：接入受限探索与盲审材料

- application 层创建父 Query Task 绑定的 exploration 闭包，复用现有证据登记路径。
- reviewer 从授权快照组装材料，不读主对话；限制文件读取与数据范围。
- 验证旧版本报告、跨租户引用、伪造证据和 result 参数注入均不能越权。
- **退出条件：**真实探索观测可被主 Agent 引用，子 Agent 无法修改 Spec/发布，审查失败与未知均可见。

### P3：持久化中断路径与小流量启用

- 使用实际 Pi Session 存储完成崩溃窗口测试；先不实现自动续跑。
- Runtime/library 默认关闭；当前桌面与 `start-web-host` 为用户单独测试显式开启，生产部署仍应以宿主配置按会话收窄启用。关闭后不接受新委派，已有子任务收敛，历史报告仍可读。
- 运行固定小样本，对照无委派模式的质量、主上下文体积、总 tokens、延迟和失败率。
- **退出条件：**第 9 节的确定性自动化检查全部通过；真实供应商/生产数据库 smoke 和质量对照未完成前，保持功能关闭或仅在明确安全能力下小流量启用，不默认开启每题审查。

不把本功能绑定到全部后端重构完成。只要求现有 Harness、Answering 及 Session 接缝稳定；不更换运行宿主、不扩大 QA 改造范围。

## 9. 验收条件与验证命令

实施必须增加以下自动化测试，不能只做成功路径演示：

1. **执行内核唯一：**主子均使用 AgentHarness；没有 new AgentSession、ExtensionRunner 或自建模型循环。
2. **上下文隔离：**主历史含测试标记，子模型输入不得出现；子工具产生大段测试输出，主模型输入不得出现原文，仅出现有界报告。
3. **真实授权：**跨 principal/session/task、越界文件、伪造引用均拒绝；skill 和注入文本不能恢复工具权限。
4. **证据一致：**探索观测登记在授权父任务，记录可追溯到子调用；不能用模型自报字符串代替证据。
5. **审查不夺权：**报告不能直接更新 Hypothesis Handling Status、生成候选或 Publication Receipt；unavailable/unchecked 不显示为 Approved。
6. **版本约束：**审查期间修订 Spec/候选或文件，旧报告被标记过期，不误用于新目标。
7. **取消与额度：**达到额度不再发起外部调用；取消触及子 Operation；父取消、关闭、超时后不存在失控的继续调度。
8. **中断恢复：**在分配 Session、accept、drive、报告保存、父工具结算之间逐点中断；重启不重复派生、不自动发布，孤儿可识别和清理。
9. **开销可见：**真实统计主子 usage，不重复计费汇总；不知道成本时显式未知。
10. **兼容性诚实：**文档列出实际复用的插件实现和不支持项；若仅复用协议，产品不标称原版插件即装即用。

验证命令（最终结果见 P3 验证记录）：

```bash
npm run typecheck --workspace=@data-agent/runtime
npm run typecheck:negative --workspace=@data-agent/runtime
npm run test --workspace=@data-agent/runtime
node scripts/verify-backend-architecture.mjs
```

另外执行带真实存储的中断集成测试和选定提供方的 smoke test，记录固定模型、配置、输入与输出。结构合格、测试通过均不等于业务语义已证明正确。

样本评估必须报告：主模型输入 tokens、主子总 tokens、任务成功率、P50/P95 延迟、拒绝越权次数、未完成及取消任务数。上下文隔离按上面的确定性标记测试验收；真实任务的质量/成本改善作为启用决策证据，不预先承诺百分比收益。

## 10. 收益、代价与止损线

- **预期收益：**探索噪声不进入主历史；审查更少受主 Agent 自证影响；保留 Harness 的统一执行模型。
- **明确代价：**新增多个模型调用、子 Session 生命周期及必要关联；摘要可能丢失细节；相同模型仍可能犯相关错误。
- **兼容性代价：**选择有限移植就必须维护所选子集，不会自动继承插件所有升级。优先推动上游提供真正可替换的执行接缝。
- **隔离局限：**独立上下文不防进程漏洞或恶意扩展；首版只运行受信代码，不承诺强安全沙箱。
- **止损线：**若实现开始要求复制 AgentSession、维护第二套 Operation 状态机、绕过 Answering 或加载完整 coding-agent 才能跑通，暂停并重新比较方案。

本方案不改变 ADR-0003 的交付政策，也不把该 ADR 中的解释枚举职责自动替换成 reviewer。未来若要改变语义裁决或强制审查政策，必须另行更新 ADR，不能借 subagent 接入隐式完成。

## 11. 上游参考

Pi 固定源码版本：`71dca871bc80b6bc97be37f0ca3189399d651fff`。

- [AgentHarness / AgentLane 接口](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/agent-harness.ts#L518-L622)
- [Harness Hook 接口](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/agent-harness.ts#L430-L500)
- [工具调用身份、memo 与执行上下文](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/src/harness/types.ts#L83-L127)
- [Harness 执行与恢复语义](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/docs/harness.md)
- [coding-agent ExtensionAPI](https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/extensions/types.ts#L1252-L1503)
- [pi-subagents 上游仓库](https://github.com/nicobailon/pi-subagents)：本方案检查的是本机安装的 npm `0.56.0`，不是该仓库 main 的兼容承诺。P0 须保存安装包完整性与对应源码信息。

**最终原则：只增加受控委派这一项能力；复用 Pi 的执行与持久化原语，保留业务权威唯一，不为一个子 Agent 功能再造一个插件平台。**
