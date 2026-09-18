# P3：AgentHarness Subagent 验证记录

> 日期：2026-09-13  
> 范围：首版 Harness 原生 explorer/reviewer 委派。Reviewer 可用；Explorer 只有配置 `SessionQueryExecutor.scopedExploration` 后才注册。Runtime/library 默认关闭；当前桌面与 `start-web-host` 为用户单独测试显式开启；无真实供应商与生产数据库验证。

## 1. 实施落点

| 阶段 | 结果 | 主要证据 |
|---|---|---|
| P0 | 完成 | `p0-compatibility.md`；未引入 AgentSession、ExtensionRunner、TUI 或 `pi-subagents` 运行依赖 |
| P1 | 完成 | `delegation/*`、`tools/subagent.ts`；真实父/子 Harness、两个并行子 Session、部分失败、截止时间覆盖解析/并发等待、报告、超时、取消、额度、报告上限测试 |
| P2 | 完成（Explorer 需显式 scoped executor） | `application/delegation.ts`；父 Query Task 授权闭包、真实 Observation Evidence、Reviewer 候选快照、跨 principal、路径逃逸、伪造引用、result 注入与版本过期测试 |
| P3 | 代码与确定性验证完成；生产启用仍阻塞 | Pi JSONL 重开、中断收敛、历史子报告、孤儿清理、`replay: never`；真实供应商/生产 DB 与质量对照尚未执行 |

## 2. 最终自动化命令

```text
npm run typecheck --workspace=@data-agent/runtime
npm run typecheck:negative --workspace=@data-agent/runtime
npm run build --workspace=@data-agent/runtime
npm run test --workspace=@data-agent/runtime
node scripts/verify-backend-architecture.mjs
```

最终结果：

- TypeScript typecheck：通过。
- Negative typecheck：通过。
- Runtime build：通过。
- Runtime tests：39 个测试文件通过；139 个测试通过，1 个既有测试跳过（总计 140）。
- Backend architecture static gate：通过，检查 106 个 production files。

其中 Subagent 关键测试：

- `delegation/main-child-e2e.test.ts`：主 Harness 调 Reviewer、主工具一次收集两个真实子 Harness、主 Harness 调 Explorer。
- `delegation/child-harness.test.ts`：原生 usage、2048 输出 token 请求上限、6 次模型请求、8 次工具调用、timeout、父 cancel、Host close。
- `application/delegation.test.ts`：受限工具集、父任务真实证据登记、候选盲审、注入文本、revision/candidate stale、跨 principal、知识路径逃逸。
- `delegation/recovery.integration.test.ts`：JSONL 重开后 reserved/accepted 保守收敛为 interrupted，settled 保留，孤儿删除，历史报告可读；另验证 accepted 原生 operationId 会 requestAbort+drive 并确认 `aborted`。
- `delegation/ledger.test.ts`：父 Operation 总派生数原子预留，并发不能越过上限；`delegation/delegation.test.ts` 另覆盖终态 ledger 写失败时保留兄弟任务并返回不确定结果。
- `delegation/report.test.ts`：未知 evidence ref、额外字段、超长输出、空覆盖拒绝。

## 3. 第 9 节验收映射

1. 主子执行均为 AgentHarness；静态门禁止 Runtime 生产代码出现独立 `AgentSession`/`ExtensionRunner`。
2. 确定性标记证明父历史不进入子上下文；子工具 4 KiB 原始标记不回流父上下文，只回有界报告。
3. principal/session/task 由 Host 固定并由 Answering 重验；Reviewer 无工具；Explorer 无发布、文件写入、Shell、Python、Skill 或再委派工具。未配置数据库边界能力时 Explorer SQL 工具不注册，而不是降级到普通 executor。
4. 探索调用通过 `Answering.execute(kind="exploration")` 在父 Query Task 登记真实 Evidence，sourceRef 绑定 child Session 与原生 invocationId。
5. Reviewer 输出只进入 `ChildOutcome.report`；测试后 Candidate 未改变、无 Publication、Task 仍为 open。
6. settle 前复查 revision 与 Candidate 的 ID/hash；变化返回 `targetState="stale"` 和原因。
7. 批量 2、同一父 Operation 同时运行 2、父 Operation 总数 4、全进程子模型并发 4、子探索并发 4；子任务 120 秒（含解析、排队、创建、accept、drive）、模型请求 6、工具调用 8、输出请求 2048 tokens。取消和关闭触及精确 child operationId；外部查询接收 signal/deadline。
8. `replay: "never"`；重开不自动 drive 续跑，reserved/accepted 关联会先尝试对精确原生 operationId requestAbort+drive 确认终态，再写 interrupted 或 abort_unconfirmed；私有根的无关联 Session 被清理。确定性测试覆盖 open accepted operation；所有 crash 点注入仍未完全覆盖。
9. 每个 Outcome 返回原生 input/output usage；当前模型价目没有可信映射，因此 cost 明确为 `null`，未伪造为 0。
10. P0 文档明确仅复用协议语义，不标称原版插件即插即用。

## 4. 小样本结果与启用结论

使用 faux provider 的 3 个确定性父子链路全部成功。以 nearest-rank 计算，本次耗时为 4.59、13.54、38.31 ms，P50=13.54 ms，P95=38.31 ms。数据由 `vitest --reporter=json` 的 assertion duration 生成；它只衡量本地状态机与测试模型，不代表网络模型延迟。

| 评估项 | 本次结果 |
|---|---|
| 主模型输入 tokens | 未形成真实任务对照；不以 faux 估算代替 |
| 主子总 tokens | 每个 ChildOutcome 已可观测；未形成真实任务汇总样本 |
| 任务成功率 | 确定性父子链路 3/3；不外推为业务成功率 |
| 本地 P50/P95 | 13.54 / 38.31 ms（faux only） |
| 越权拒绝 | 自动化覆盖跨 principal、路径逃逸、result 注入、未知 Evidence Ref，均拒绝；不是生产攻击率 |
| 未完成/取消 | timeout、父 cancel、Host close 各 1 条确定性路径通过；无生产发生率 |

尚无真实任务质量或成本收益证据，因此：

- Runtime/library 的 `enableSubagents` 默认仍为 false；当前桌面入口与 `scripts/start-web-host.mjs` 为单独测试显式设为 `true`。
- 生产部署仍可用 boolean 或按 Session 的 Host policy 收窄启用范围。
- 不默认对每个查询执行 Reviewer，也不把 Reviewer 设为发布门。

## 5. 未验证与残余风险

- **真实供应商 smoke 未运行：**测试环境未使用产品凭证；尚未验证供应商取消后计费停止、结构化输出稳定性和 P95 延迟。
- **生产数据库 smoke 未运行：**普通 MCP executor 本身不提供 `scopedExploration`；当前桌面/Web 只为用户单独测试显式包了一层 local-test capability，不能当作生产安全边界。MCP 客户端与参考服务已传递 signal/deadline/maxBytes，MySQL/SQLite preview 做流式/迭代限幅；这仍不等于生产安全证明。正式启用前，数据库账号只读、statement timeout、危险函数/文件/网络副作用、schema/relation 范围和服务端字节上限仍必须由具体 scoped executor/连接配置保证；应用层词法检查不是安全边界。
- **业务质量未证明：**未取得带/不带委派的真实问题集成功率、主输入 tokens、主子总 tokens 和答案质量对照；上线前必须补测。
- **同进程不是安全沙箱：**隔离的是 Session/context 与工具能力，不防受信进程代码漏洞。
- **取消计费边界：**已确认 Pi 终态不等于供应商一定即时停止计费；cost 无价格映射时保持未知。
- **动态关闭：**Session Host 创建时冻结是否启用；改变 policy 后需重建该 Host。Host close 会中止已接受子 Operation，并拒绝后续委派。

由于上述限制，当前结论是“首版能力已接通且自动化约束通过”，不是“生产收益已验证”。
