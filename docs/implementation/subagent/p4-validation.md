# P4：Harness-native Subagent 修复验证记录

> 日期：2026-09-14  
> 范围：按 [`p4-remediation-plan.md`](./p4-remediation-plan.md) 修复主调用、证据回传、Skill 权限、角色材料、提示词、取消/关闭、恢复与 usage。  
> 结论边界：确定性代码与测试验证通过不等于真实模型质量、供应商取消计费或生产数据库安全已经证明。

## 1. 分阶段结果

| 阶段 | 修复结果 | 主要回归证据 |
|---|---|---|
| P4.1 请求消息身份 | Host 在 Pi 接受 Operation 后读取原生 `operationMeta.intent.promptEntryIds`，把真实用户 entry ID 放入工具上下文；transport requestId 不再冒充 Session entry ID。绑定失败时先中止已接受 Operation。 | `delegation/main-child-e2e.test.ts` 真实 Host → begin → result → reviewer 链路 |
| P4.2 Evidence 句柄 | `explore_parent_task` 返回 Answering 生成的原始 Evidence ID，不再添加模型必须猜测剥除的前缀。 | `application/delegation.test.ts` 子探索 → 原样 `proposedEvidenceIds` → hypothesis 已处置 → result Candidate |
| P4.3 Skill 工具 | Skill 专项 allowlist 与固定控制面工具求并集；不会恢复任意副作用工具。固定集合仅包含 Skill 路由、Answering 协议、澄清和显式启用的 subagent。 | `application/host.test.ts` 临时严格 Skill + dashboard/analysis/demo-report 三项现有 Skill |
| P4.4 角色材料 | reviewer 获得当前 revision 的 hypothesis、choice、resolution 和最多 32 项有界授权 Evidence，主对话推理不进入材料；Evidence ID 可作为报告引用。Explorer 的 SQL 与知识能力独立装配。 | `application/delegation.test.ts` 业务证据、私有历史标记、knowledge-only/no-capability、越权和 stale 测试 |
| P4.5 Prompt/报告 | 子提示明确 findings/unchecked 不得同时为空；主提示增加何时委派、何时不委派、Evidence ID 原样回接及失败/过期结果处理。 | `application/delegation.test.ts`、`application/session-runtime.test.ts`、`delegation/report.test.ts` |
| P4.6 deadline/close | deadline 从初始化恢复和 `run()` 入口覆盖 list/reconcile、reserve、初始 memo、resolver、target check、Session/Harness 创建、accepted/terminal 持久化；close 会中止 admission 前后执行。恢复信号继续下传到 ledger、子 Session repo 与原生 Harness。迟到的不可取消 Promise 不会再启动 child，且会被显式消费以避免未处理 rejection。 | `delegation/delegation.test.ts` stalled list/reconcile/reserve/memo/terminal/resolve/checkTarget；`child-harness.test.ts` stalled Session create、accepted persistence、模型执行 |
| P4.7 恢复 | reserved 但子 Session 已有开放 Operation 时会发现、请求中止并确认；accepted 后已 completed/failed/aborted 的 Operation 被识别为原生终态。恢复出的 operationId 会写入父 ledger。 | `recovery.integration.test.ts` 真实 JSONL 四种窗口；`ledger.test.ts` recovered operation identity |
| P4.8 usage/入口 | `inputTokens` 包含 input + cacheRead + cacheWrite，并返回 `totalTokens`；Electron/Web 移除伪造的 local-test SQL scope。 | `child-harness.test.ts` native usage；生产源码和生成 bundle 搜索无 local-test scope |

## 2. 入口策略决定

保留 Electron/Web 组合根的 `enableSubagents: true`，原因是本次目标明确要求主 Agent 可主动使用该能力；但当前默认能力只包括：

- 无工具、无发布权的 reviewer；
- 精确白名单路径上的只读知识 explorer。

生产入口不再把普通 MCP executor 包装成伪 scoped SQL capability。Delegated SQL exploration 必须以后由数据库边界实际强制只读、connection/schema/relation、timeout 和字节限制后才能注入。Runtime/library 的默认值仍为关闭，其他宿主必须显式启用。

## 3. 最终命令与结果

```text
npm run typecheck --workspace=@data-agent/runtime
npm run typecheck:negative --workspace=@data-agent/runtime
npm run test --workspace=@data-agent/runtime
node scripts/verify-backend-architecture.mjs
npm run typecheck --workspace=@data-agent/electron-host
npm run test --workspace=@data-agent/electron-host
npm run typecheck --workspace=@data-agent/server
npm run test --workspace=@data-agent/server
npm run build:distribution
node scripts/smoke-web-host.mjs
```

结果：

- Runtime typecheck：通过。
- Runtime negative typecheck：通过。
- Runtime tests：39 个文件通过；156 个测试通过，1 个既有测试跳过（157 total）。
- 后端架构静态门：通过，106 个 production files。
- Electron Host：typecheck 通过；2 个文件、10 个测试通过。
- Server：typecheck 通过；5 个文件、16 个测试通过。
- Distribution build：通过；生成 Electron bundle 已包含本轮修复。
- Web Host smoke：通过。
- `git diff --check`：无 whitespace error；仅有仓库既有 CRLF 转换警告。
- Fresh-context 独立审查先后识别出 accepted persistence 与 run 入口初始化/reserve/memo 两处生命周期缺口；两项均补测试并修复。后续有界复审进程本身超时，未把超时冒充通过结论。

所有新增链路使用 faux provider、mock executor、内存或系统临时目录中的 JSONL Session；未读取 `.env`，未调用真实 LLM 或业务数据库。

## 4. 仍未证明的事项

- 没有真实供应商 smoke；结构化 JSON 稳定性、真实 P50/P95、取消后的供应商计费均未验证。
- 没有生产数据库 scoped executor，因此 SQL explorer 在生产入口仍不可用，这是安全限制，不是静默降级。
- 没有 A/B 证据证明主动委派必然提升业务答案质量或降低总成本。
- 同进程 Session 隔离不是恶意代码安全沙箱。
- Evidence material 总体超过 32 KiB 会明确拒绝当前委派；不会静默截断整个审查目标。
