---
status: proposed
---

# 看板实时刷新：重新执行已发布的查询，生成新的发布记录

本 ADR 补上 ADR-0008 实施第 4 步“实时数据绑定另立 ADR”的留白，并为 Answering 公开接口新增一个操作（目前由架构检查固定为五个方法，没有 ADR 规定这一清单）。快照看板（#97）的契约、渲染器与交付资格规则不变。

## 背景

以下事实已对照 `develop`（#105 之后）的代码核实：

- **快照看板已可交付。** DashboardSpec v1 的视图通过 `DatasetRef` 读取已发布结果，HTML 嵌入规格与行数据并在页面中编译（ADR-0008 实施第 4 步首期）。`DatasetRef` 是按 `kind` 区分的联合，目前有 `publication` 与 `derived`。
- **v4 语义看板没有可复用的数据流。** `dashboard-v4.ts` 只生成桥接壳：页面发送 `dashboard.ready`、`semantic.refresh`，收到结果时只修改 `document.title`；视图的 `query` 是一段描述文字，没有执行器。`handleBridgeMessage` 除测试外没有调用方。
- **`dashboard.evaluate` 绕过查询保障。** 该协议命令用关键字黑名单过滤后直接执行调用方给出的 SQL，不经过 Answer Spec、门控与发布。前端当前不调用它。
- **发布记录可以追溯到查询。** `PublicationReceipt` 记录 `taskId`、`revisionId`、`candidateId`、`resultRef`、`contentHash`；`ArtifactDirectory.readSqlAuthorized` 可按 Receipt 取回已鉴权的 SQL 与 `queryHash`。任务发布后 `lifecycle` 为 `published`。
- **Answering 公开接口固定为五个方法。** `begin`、`revise`、`execute`、`publish`、`inspect`，`scripts/verify-backend-architecture.mjs` 逐字检查。
- **预览是沙箱 iframe。** `GlobalPreviewModal` 以 `srcDoc` 加载 HTML，`sandbox="allow-scripts allow-downloads allow-forms allow-popups"`，页面与应用之间只能 `postMessage`；预览组件可以通过 runtime 客户端发送协议命令。

## 决策

1. **实时数据仍然是已发布结果。** 刷新不是让页面执行查询，而是让 Runtime 重新执行某个已发布结果所属的同一版 Answer Spec 的同一条查询，经过与首次相同的门控，发布为一条新的 Receipt。新 Receipt 记录它刷新的是哪一条（`refreshes: <receiptId>`）。看板上显示的每一个数依然来自一条发布记录，ADR-0008 决策 4 不变。
2. **Answering 新增 `refresh`。** `refresh({ receiptId }, context)` 读取原 Receipt 的任务与版本，重新执行其结果查询，按首次发布的格式与策略生成新的候选并发布。它不修改 Answer Spec，不接受新的 SQL 或参数；原 Receipt 保持不可变。Disclosure、物理画像按新结果重新计算。架构检查的公开方法清单相应改为六个。
3. **规格只新增一种 `DatasetRef`。** `{ kind: "live", receiptId }`：首次生成看板时与 `publication` 一样读取该 Receipt 的行；页面在应用内打开时可以请求刷新。DashboardSpec v1 的其他部分不变，快照看板不受影响。首期不支持参数与筛选（与快照看板的首期范围一致）；参数化会改变 Answer Spec，需要另行决策。
4. **刷新请求只能指名视图，不能携带数据来源。** 页面发送 `{ kind: "dashboard.refresh", nonce, requestId, viewIds }`。应用侧预览校验来源窗口与 nonce 后，发送协议命令 `dashboard.refresh`，参数为看板的工作区路径与视图 id。Runtime 从工作区中的看板文件读取嵌入的规格，找出这些视图的 `live` 引用，按当前会话的业务上下文鉴权后调用 `Answering.refresh`，再用新行重新校验看板（`validateDashboard`），把新行、新 Receipt、展示提示与 `[CHECK]` 返回给页面。页面给出的任何 SQL、Receipt id 或行数据都不被采信。
5. **页面显示数据版本，失败时保留上一版。** 每个 `live` 视图显示所用 Receipt 与发布时间；刷新后展示提示、Disclosure、`[CHECK]` 全部按新结果替换，不沿用旧内容。刷新失败时视图保留上一版数据并显示错误码。看板文件本身不因刷新而改写；需要固定新版本时，由模型或用户用新 Receipt 重新生成看板。
6. **离开应用后是快照。** 独立打开的 HTML 没有宿主，不显示刷新入口，只显示嵌入的那一版数据及其 Receipt。
7. **移除旧路径。** 删除 `dashboard.evaluate` 协议命令（绕过查询保障）、`dashboard-v4.ts`、`dashboard-migration.ts`、`dashboard.migrate` 命令与 `dashboard.generate` 的 v4 分支，以及 contracts 中对应的 schema。已生成的 v4 桥接壳页面没有数据，打开时只显示标题，不做迁移。

## 考虑过的方案

- **让页面经 `dashboard.evaluate` 执行 SQL**：实现最少，但页面或模型写入的 SQL 不经过 Answer Spec、门控与发布，等于为看板保留一条绕过查询保障的入口，与 ADR-0001、ADR-0008 决策 4 冲突。
- **沿用 v4 的语义查询字符串**：视图只有一段描述文字，没有可执行的语义层；为它补执行器等于另建一套查询路径。
- **刷新时重新调用模型走完整流程**：口径可能漂移，耗时与费用高，且结果需要人工复核，不适合“刷新”。
- **刷新时直接改写看板文件**：会让同一个文件在不同时间代表不同数据，已交付的看板不再可追溯，违背 ADR-0008 决策 9。

## 后果

- 看板可以在应用内按需更新数据，且每次更新都有独立的发布记录与 Disclosure。
- Answering 的公开接口从五个方法变为六个；`refresh` 复用首次发布的门控与格式，需要为“同一版本再次执行”定义预算与幂等规则（同一 `requestId` 重复请求返回同一个新 Receipt）。
- 数据库在刷新时承担与首次查询相同的负载；首期不做定时刷新，只在用户操作时执行。
- 移除 `dashboard.evaluate` 与 v4 相关代码后，没有任何协议入口可以绕过发布执行 SQL。

## 实施与验收

1. `Answering.refresh` 与新 Receipt 的 `refreshes` 字段；架构检查更新。
   - 测试：刷新生成新 Receipt，原 Receipt 不变；刷新重新计算 Disclosure 与物理画像；跨会话或无权限的 Receipt 被拒绝；同一 `requestId` 幂等。
2. `DatasetRef` 新增 `live`；三个图表入口按 `publication` 处理它；看板页面显示数据版本。
3. 协议命令 `dashboard.refresh` 与预览桥接；页面刷新入口只在有宿主时出现。
   - 测试：伪造 nonce、来源窗口或视图 id 的请求被拒绝；页面给出的 Receipt id 与 SQL 不被采信；刷新失败时保留上一版并显示错误码。
4. 删除决策 7 所列代码与命令，更新 contracts；已生成的 v4 页面在预览中打开不报错。
5. 在运行中的应用里完成一次“生成看板 → 修改数据库 → 刷新 → 数值与 Receipt 更新”的端到端验证并截图。
