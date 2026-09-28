# P0：AgentHarness Subagent 兼容边界验证

> 日期：2026-09-12  
> 结论：选择 Harness 原生委派 Module；不加载 AgentSession、ExtensionRunner 或 TUI，不声称兼容完整 `pi-subagents` 插件。

## 固定基线

- Data Agent：`@earendil-works/pi-agent-core@0.85.1`。
- 参考插件：本机 npm `pi-subagents@0.56.0`。
- Pi 源码参考：`71dca871bc80b6bc97be37f0ca3189399d651fff`。
- 插件许可证：MIT；本实现没有复制插件源文件。
- npm tarball：`https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.56.0.tgz`。
- npm integrity：`sha512-XBmKqvrj4mCVQ6/uXiPqCmzHxGfBB+jjwmfNR3El+IfhnaJwZ+W6evXYRI3lQEXe6Nf56xfzUXQExIzE8cT5BQ==`。

## 依赖检查

| 插件入口 | 直接依赖 | 处理 |
|---|---|---|
| `index.ts` / `src/extension/index.ts` | coding-agent ExtensionAPI、事件、SessionManager、渲染器 | 不复用；不实现 ExtensionAPI |
| `src/runs/foreground/execution.ts` | 子进程与 coding-agent 启动参数 | 由独立 Pi Session + AgentHarness accept/drive 替换 |
| `src/shared/fork-context.ts` | coding-agent SessionManager | 首版仅 fresh context，不移植 |
| `src/api/delegation.ts` | 结构化请求、状态、usage 协议 | 只参考身份和终态语义；产品使用更窄的 Data Agent 类型 |
| 角色/结果交接设计 | explorer/reviewer、独立上下文、有界结果 | 保留设计原则，使用 Data Agent 固定角色提示词 |

`pi-subagents/delegation` 只导出事件协议与 DTO，不是可脱离 ExtensionAPI 调用的执行器。因此没有可替换一个 executor 就原封不动运行的公开接缝。选择“仅复用协议语义、用 Harness 实现执行”比维护有限上游 fork 更小。

## 已验证的最小链路

实现代码：

- `packages/runtime/src/delegation/child-harness.ts`
- `packages/runtime/src/delegation/delegation.ts`
- `packages/runtime/src/application/delegation.ts`
- `packages/runtime/src/tools/subagent.ts`

检查命令包括：

```text
node -e "const p=require('C:/Users/Negan/.pi/agent/npm/node_modules/pi-subagents/package.json'); console.log(p.version,p.license,p.repository)"
npm view pi-subagents@0.56.0 dist.integrity dist.tarball
rg -n "ExtensionAPI|registerTool|SessionManager|spawn|pi-tui" C:/Users/Negan/.pi/agent/npm/node_modules/pi-subagents
```

Registry 返回的完整 integrity 为：

```text
sha512-XBmKqvrj4mCVQ6/uXiPqCmzHxGfBB+jjwmfNR3El+IfhnaJwZ+W6evXYRI3lQEXe6Nf56xfzUXQExIzE8cT5BQ==
```

自动化验证已覆盖：



1. 独立 Session + AgentHarness 可运行并返回最终模型文本与原生 usage。
2. 每个子任务保存精确 operationId，超时通过 `requestAbort` 收敛到已确认终态。
3. 父 signal 在子 admission 前取消时不产生模型调用。
4. 最多两个任务并行；每个父 Operation 总派生数最多四个并持久预留。
5. 子报告严格校验、限制 8 KiB，并拒绝未知 evidence reference。
6. Explorer 只有任务绑定的 exploration 工具；Reviewer 零工具。应用只有在注入 `SessionQueryExecutor.scopedExploration`（含 opaque scopeId/connectionId 且由外部执行器真正执行只读/范围策略）时才暴露 Explorer SQL；普通 MCP executor 不会误获该能力。
7. 父子关联写入父 Pi Session；重建时未完成任务标记 interrupted；私有子 Session root 可清理无关联孤儿。

## 明确不支持

- 直接安装并运行原版 `pi-subagents` 包。
- coding-agent 扩展发现、热重载、命令、渲染器、TUI、工作流 DSL。
- fork 主会话全部历史、递归 Subagent、后台定时和自动恢复 drive。
- OS 级安全沙箱及任意第三方插件兼容。

产品表述必须是“AgentHarness 原生 Subagent 委派能力”，不能表述为“完整兼容 pi-subagents 插件”。

## 验证命令

```text
npm run typecheck --workspace=@data-agent/runtime
npm run typecheck:negative --workspace=@data-agent/runtime
npm run test --workspace=@data-agent/runtime
node scripts/verify-backend-architecture.mjs
```

本文件不固定最终测试计数，避免后续新增测试令记录失真；权威最终一次运行结果见 `p3-validation.md`。

## 未验证限制

- 未使用真实供应商执行 Subagent；无法证明供应商在中止后立即停止计费。
- 数据库连接本身是否使用只读账号及 statement timeout 由具体 QueryExecutor 决定；应用层只读 SQL 检查不是沙箱。
- 尚未测量真实任务质量、主上下文 token 降幅和 P95 延迟，因此功能保持显式 opt-in。
