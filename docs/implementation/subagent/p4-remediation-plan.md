# P4：Harness-native Subagent 修复计划

> 状态：实施与确定性验证已完成；验证记录见 [`p4-validation.md`](./p4-validation.md)  
> 日期：2026-09-14  
> 范围：修复当前工作树中已经复现的产品原生 subagent 调用链、证据回传、Skill 权限、审查材料、提示词、生命周期和恢复问题。  
> 非目标：不接入完整 `pi-subagents` 插件，不增加新角色，不让 reviewer 获得发布权，不把本地测试 SQL scope 宣称为生产安全能力，不调用真实模型或业务数据库。

## 1. 基线与约束

- Data Agent 仍是唯一产品 Agent；父子执行均复用 Pi `AgentHarness`。
- Answering 继续唯一拥有 Query Task、Answer Spec、Evidence、Candidate 与 Publication Receipt。
- 子报告始终是无权威的建议；不得直接修改 Spec、生成 Result Candidate 或授权发布。
- 保持单次最多两个任务、每父 Operation 最多四个子任务、只读 explorer、无工具 reviewer、`replay: "never"`。
- 当前仓库包含大量用户未提交修改。只做目标文件中的最小编辑，不恢复、格式化或覆盖无关改动。
- 每项修复采用纵向 red → green：先把已复现问题固化为一个公共 seam 的失败测试，再做最小实现，再运行该测试和受影响测试。

## 2. 已确认的测试 seam

这些 seam 已由用户要求逐项修复的范围隐含批准，测试只通过公开接口观察行为：

1. **主调用 seam**：`DataAgentSessionHost.controller.prompt()` → 主 Harness 工具调用 → `subagent` → 子 Harness 结果。
2. **证据 seam**：resolver 暴露的 `explore_parent_task` → `Answering.revise()` → `Answering.execute(kind="result")`。
3. **Skill seam**：`createDataAgentSessionHost()` → `load_skill` → `AgentLane.getActiveTools()`。
4. **材料 seam**：`createQueryTaskDelegationResolver().resolve()` 返回给子 Harness 的授权 prompt、工具和引用集合。
5. **生命周期 seam**：`NativeDelegation.run()/close()` 对不响应或延迟完成的 resolver/executor。
6. **恢复 seam**：`HarnessChildExecutor.reconcile()` 对真实 JSONL 子 Session 中 reserved/accepted 与各种原生 Operation 终态。

## 3. 修复阶段与顺序

### P4.1 主请求消息身份

**问题：**外部 transport requestId 被当作 Pi Session entry ID，resolver 无法读取原始用户请求，两个角色均在启动前失败。

**红测：**在真实 Session Host 上用外部 requestId 发起 prompt，让 faux 主模型依次 begin、生成 Candidate、委派 reviewer；断言 reviewer 子模型实际运行并收到原始请求。

**实现方向：**在 Host 接受 prompt 后取得该 Operation 实际写入的用户消息 entry ID，以可信宿主状态提供给工具上下文；transport requestId 只用于事件关联和 Answering 幂等，不冒充 entry ID。若 Pi 不提供直接返回值，则通过 Operation/Session 的确定性关联定位本次用户 entry，并拒绝歧义。

**退出条件：**主调用 seam 红转绿；原有 Answering requestId 幂等语义不变。

### P4.2 Exploration Evidence 句柄兼容

**问题：**子工具返回 `evidence:evidence_…`，而 Answering 只接受原始 Evidence ID/sourceRef。

**红测：**执行子探索，把报告可见引用原样传给 `proposedEvidenceIds`，断言 `data_property` hypothesis 被处置且 result 不再被未决假设阻塞。

**实现方向：**对主模型公开 Answering 可直接接受的系统生成 Evidence ID；如需要展示类型，另设非消费性标签，而不要求模型剥前缀。

**退出条件：**证据 seam 红转绿；伪造和未知引用仍被子报告解析器拒绝。

### P4.3 Skill 与主流程必需工具

**问题：**Skill allowlist 替换全部 active tools，导致 `subagent`、Answering 控制工具及 `load_skill` 消失。

**红测：**分别加载现有 dashboard、analysis、demo-report，断言 Skill 专项限制仍生效，同时保留完成 Answering 协议及继续加载 Skill 所需的控制工具；未授权副作用工具仍不可见。

**实现方向：**明确两类集合：Skill 专项允许工具 + 宿主固定控制面工具。固定集合仅包含完成唯一 Answering 协议、Skill 路由和显式启用的 subagent 所需工具；不得借此恢复任意 Shell/Python/写入能力。

**退出条件：**Skill seam 红转绿，原“未知工具过滤”测试更新为新的明确契约。

### P4.4 角色材料与纯知识 explorer

**问题：**reviewer 只得到原请求和紧缩 Spec，缺少假设、选项及其证据依据；没有 SQL scope 时整个 explorer 被拒绝，即使仅需授权知识读取。

**红测：**

- reviewer prompt 包含当前 revision 的完整 hypothesis/choice、resolution 与有界授权 Evidence 摘要，但不含主对话推理或秘密；
- 没有 scoped SQL executor、但有授权知识路径时，explorer 可启动且只获得知识工具；
- 没有 SQL scope 且没有知识能力时，explorer 明确失败，不产生无工具空跑。

**实现方向：**增加 Answering 内部的、授权且有界的 delegation material 读取接口，避免让通用 `inspect_answer` 暴露全部证据；只传 Evidence ID/kind/authority/sourceRef/hash/有界 quote 或 preview。SQL 工具按 capability 单独注册，不再作为 explorer 角色的总开关。

**退出条件：**材料 seam 红转绿；跨 principal、路径逃逸、知识变更 stale 和 32 KiB 输入上限仍通过。

### P4.5 提示词与报告协议一致性

**问题：**提示词未说明空 findings 时必须填写 unchecked；主提示词只有调用参数，没有主动委派决策、失败/过期处理和证据回接规则。

**红测：**断言子系统提示明确结构约束；主启用提示包含“何时委派/何时不委派”、Evidence ID 使用及 failed/stale/invalid_output 处理，且继续强调无发布权。

**实现方向：**最小更新宿主追加提示和两个角色共有提示；不依赖自然语言作为权限边界。

**退出条件：**prompt 契约测试通过；结构校验规则不放宽。

### P4.6 Deadline、取消与 close 收敛

**问题：**Session/Harness 创建、accept、ledger/memo、checkTarget 等等待未全部纳入 deadline；close 可无限等待。

**红测：**对 resolver resolve、child admission/persistence、checkTarget 分别注入不响应或延迟依赖；断言 deadline/父取消/close 在有界时间内返回明确状态，迟到完成不会继续启动模型/SQL，资源最终清理。

**实现方向：**使用贯穿单次委派的取消信号和 deadline-aware await；不能仅 `Promise.race` 后遗弃仍运行的副作用。可取消依赖必须接收 signal；不可取消存储操作需在返回后检查信号、收敛资源并禁止进入下一阶段。`close()` 负责触发 admission guard 与 executor abort，再等待已知清理完成。

**退出条件：**生命周期 seam 红转绿；无悬空 timer、listener、Session 或模型调用。

### P4.7 持久化恢复窗口

**问题：**

- child 已 accept、父 ledger 仍是 reserved 时，恢复错误地声称 terminalConfirmed；
- child 已 completed/failed、父 ledger 仍是 accepted 时，只识别 aborted，误报 operation not found。

**红测：**用真实 JSONL Session 覆盖 reserved+open operation，以及 accepted+completed/failed/aborted 三种终态。

**实现方向：**reserved 时若子 Session 存在，检查其原生 lane 并中止开放 Operation；只有确认无 Operation 才标记安全中断。accepted 时识别所有原生终态；交付未完成可仍记 interrupted，但必须保留准确 `terminalConfirmed` 与可审计原因。

**退出条件：**恢复 seam 红转绿；重启不重放模型、不自动发布、不删除有关联子 Session。

### P4.8 Usage 与入口策略收尾

**问题：**缓存 tokens 未纳入输入 usage；桌面/Web 标为本地测试却默认显式开启 subagent 和伪 scoped capability。

**红测/检查：**

- 有 cacheRead/cacheWrite 的原生 usage 不被静默漏报；
- 入口启用策略和文档一致，生产启动不得把词法只读包装宣称为数据库边界能力。

**实现方向：**优先扩充 `ChildUsage` 的明确字段而不是混算；入口改为环境/配置显式 opt-in，或仅启用 reviewer 而不伪造 Explorer SQL capability。若产品选择需要用户决策，先停在这里请求确认，不替用户选择安全策略。

**退出条件：**usage 语义诚实；生产入口策略无误导。

## 4. 每阶段验证

每个阶段：

```text
npx vitest run <新增或受影响测试文件>
npm run typecheck --workspace=@data-agent/runtime
```

P4.3 涉及 Skill 时补 `skills.test.ts` / `application/host.test.ts`；P4.8 涉及宿主入口时补对应 server/electron 测试。

最终：

```text
npm run typecheck --workspace=@data-agent/runtime
npm run typecheck:negative --workspace=@data-agent/runtime
npm run test --workspace=@data-agent/runtime
node scripts/verify-backend-architecture.mjs
npm run build:runtime
```

如果改动跨 server/electron：再运行对应 workspace typecheck/test。所有测试使用 faux provider、mock executor 或参考 SQLite，不读取 `.env`，不调用真实 LLM 或业务数据库。

## 5. 停止与升级条件

遇到以下情况立即停止当前阶段并向用户报告，不静默扩大范围：

- 需要更改 ADR-0003 的发布政策或赋予 reviewer 裁决权；
- 需要加载完整主工具集给子 agent；
- 修复必须复制 Pi Operation 状态机或绕过 Answering；
- 入口安全策略需要在“默认启用功能”和“生产最小权限”之间作产品取舍；
- 发现当前用户未提交改动与目标修改冲突，无法安全保留。

## 6. 交付记录

每完成一个阶段，记录：失败测试、最小实现、通过命令、变更文件、剩余风险。最终更新 `docs/implementation/subagent/p3-validation.md` 或新增 P4 验证记录；不得把测试通过表述为业务质量或生产安全已证明。
