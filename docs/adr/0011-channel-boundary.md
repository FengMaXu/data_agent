---
status: proposed
---

# 渠道边界：外部平台只通过 Submission 进入、通过可交付物离开

本 ADR 为飞书、钉钉等 IM 以及定时任务、MCP Events 等外部来源定一条统一的接入边界。核心只认识三份契约（Submission、Deliverable、地址与身份），各平台是边界外可替换的适配器。Query Assurance 的交付规则（ADR-0001、ADR-0008 决策 4）不变，只是延伸到所有渠道。

## 背景

以下事实已对照 `develop`（#152 之后）的代码核实：

- **宿主是枚举出来的。** `RequestContextSchema.host` 只有 `electron | web`；Web Host（`apps/server`）与 Electron 主进程各自把登录身份翻译成 `RequestContext`，再调用 `DataAgentRuntime.dispatch`。
- **命令外层有 `requestId`，但运行时不按它去重。** `DataAgentCommandEnvelope` 带 `requestId`；`agent.prompt` 把它传给 agent，`agent.steer`、`agent.follow_up` 不传，`dispatch` 不记录已处理的 id。同一条消息重复投递会启动两次运行。
- **忙时的新提问被拒绝。** `agent.prompt` 经 Pi `AgentLane.accept` 准入；会话已有运行时 Pi 返回 `LaneBusy`，控制器抛出 `ADMISSION_REJECTED`（其他准入失败也用这个代码）；`agent.steer`、`agent.follow_up` 进入 Pi 的队列。每次运行的提问必须恰好是一条用户消息（`requestMessageId`）。
- **事件流服务于界面渲染。** `DataAgentEventSchema` 是 `agent.text_delta`、`agent.tool_*`、`widget*`、`clarification.*` 等，保存在内存的 256 条环形缓冲里，断线后由客户端从快照重新同步。事件流里没有“已发布结果”这样的业务事件，外部消费者只能从 `publish_query_result` 的 `agent.tool_finished` 结果里取 Receipt。
- **发布结果可以按 Receipt 取回。** 发布工具的 `details` 就是 `PublicationReceipt`（含 `receiptId`、`taskId`、`format`、`publicRef`、`disclosure`）；`/api/runtime/publications/:id` 按 `userId + sessionId` 鉴权后返回 CSV。发布按 `requestId` 幂等，工具声明 `replay: "safe"`。
- **澄清：等待在内存，回答已持久。** `ClarificationManager` 在内存中等待，默认 10 分钟过期，进程重启即丢；超时后工具返回 `[CLARIFICATION_UNANSWERED]`，运行继续。回答由宿主写入会话的 `data-agent.clarifications` 账本，Evidence Admission 已经能把 `clarification:<id>` 采纳为 `user_confirmation`；当前操作的用户消息也能直接作为 `user_confirmation` 的来源。
- **会话只有一个所有者。** `chat_sessions` 以 `(user_id, id)` 为主键，会话必须属于一个 `task`；`dispatch` 用 `sessionOwners` 拒绝其他用户访问（`SESSION_ACCESS_DENIED`）；Query Task 按 principal 鉴权（`assertTaskAccess`）。
- **没有按用户区分的数据权限。** 授权只针对会话、任务、Receipt 的归属；所有用户经同一套数据库连接配置查询。
- **已有一张 `session_projection_outbox`。** 它服务于会话投影，与渠道交付无关；`session.create` 写入，但除测试外没有消费者。
- **metadata 是 SQLite。** `MetadataStore` 在 worker 线程里用 better-sqlite3 持久化任务、会话、配置与登录信息。

## 决策

1. **渠道是外部平台唯一的接入点。** 一个渠道（Channel）把某个平台的入站事件翻译成 Submission，把可交付物渲染成平台消息。渠道与 Web/Electron 一样，只通过版本化协议（`dispatch` 与事件流）和运行时交互，不调用 Answering、工具或 Pi 的内部接口。核心不引用任何平台 SDK；渠道之间互不依赖。`RequestContext.host` 增加 `channel`。

2. **入站只有一种形状：Submission。**

   ```ts
   type Submission = {
     requestId: string;            // 渠道给出的事件 id，按 (channel, requestId) 去重
     address: ConversationAddress; // 平台上的对话位置，由决策 4 解析为会话
     actor: ChannelActor;          // 渠道验证过的发送者，由决策 4 解析为 userId
     body:
       | { kind: "input"; text: string; whenBusy: "steer" | "follow_up" }
       | { kind: "answer"; clarificationId: string; text: string };
   };
   ```

   - 去重记录在 metadata 中持久化，先记录再派发。重复的 `requestId` 被丢弃，不再派发。
   - 记录之后、派发之前进程崩溃，这条输入不自动重放（agent 运行不是幂等的）；重启后对这类记录给用户发一条 Notice，请其重发。平台在确认收到之前的重投由平台负责。
   - `input` 先作为 `agent.prompt` 派发；会话正在运行时 Pi 以 `LaneBusy` 拒绝新的运行，再按 `whenBusy` 派发为 `agent.steer` 或 `agent.follow_up`。不新增查询会话忙闲的协议命令。
   - `answer` 在澄清仍在等待时作为 `clarification.answer` 派发；等待已经结束（过期、取消或重启）时按 `input` 的规则派发，原文成为一次用户输入。作为新运行的提问时，它是该运行的用户消息，可作为 `user_confirmation` 证据；排队的 follow-up 能否作为证据未核实，由实施第 1 步的测试确定。等待方式以后改变（例如提问后结束本轮），渠道不受影响。
   - 新的 `body` 种类需要修订本 ADR。定时刷新（`refresh`）会改变 ADR-0010“首期不做定时刷新”的决定，届时一并修订。

3. **出站分为两类。**

   | 类别 | 内容 | 语义 |
   |---|---|---|
   | 进度（Progress） | 现有事件流 | 可丢失、只保留最新状态；渠道断线后从当前状态重画，不补发。渠道自行节流 |
   | 可交付物（Deliverable） | Question（`clarification.request`）、Publication（新增 `publication.delivered`）、Dashboard（新增 `dashboard.delivered`）、Notice | 持久化：先写入渠道交付发件箱，再投递；以幂等键（Publication 用 `receiptId`，Question 用 `clarificationId`）至少送达一次，平台侧再去重 |

   - `publication.delivered { receiptId, taskId, format, publicRef, disclosure?, inlineContent? }` 由会话的 Presentation 投影在发布工具成功结束时发出，Web 与 Electron 也能收到。渠道需要完整结果时，通过 `DeliveryContent.readPublication()` 由核心以提问人身份读取 CSV；发件箱只记录会话，不存数据行。渠道不依赖工具结果的文本。
   - `dashboard.delivered { path, contentHash, receiptIds }` 在 `generate_dashboard` 创建或编辑看板后发出，以内容哈希为幂等键，同一版只送一次，编辑后的新版另送。看板上的数都来自 Receipt（ADR-0008 决策 4），所以按决策 5 与 Publication 同样放行。渠道通过 `DeliveryContent` 读取页面（只限会话所有者 `dashboards/` 下的文件）；宿主能渲染时还可取得 PNG 截图，IM 端以图片展示，页面作为文件附上。工作区相对链接在 IM 中无法打开，渠道把它们改写为纯文本。
   - 发件箱是新的表（`channel_delivery_outbox`），不复用 `session_projection_outbox`。
   - 运行时发出事件与渠道写入发件箱之间存在进程崩溃窗口（事件流在内存中）。首期接受这个窗口：Receipt 本身已持久，重新提问会得到同一个结果；需要时再按绑定会话的 Query Task 对账补发。

4. **地址与身份。**
   - `ConversationAddress { channel, tenant, chatId, threadId?, audience: "direct" | "group" }`。
   - `(channel, tenant, externalUserId)` 绑定到一个 `userId`。首期由渠道首次见到该发送者时自动开户，与 Web 账号的关联以后再做。
   - **会话仍然只有一个所有者。** 一个会话对应 `(address, userId)`：群聊里每个发言人在同一个话题中各有自己的会话，Query Task 的归属与鉴权不变。会话归属于每个地址自动建立的一个 `task`。
   - 身份只来自渠道验证过的入站事件，不能从消息内容或模型输出中得到。

5. **交付按受众放行。** 系统没有按用户区分的数据权限，所以首期规则是：`direct` 地址直接交付；`group` 地址只在该群被配置为允许群内交付时，才把 Publication 发到群里，否则私聊发给提问人，并在群里留一条 Notice。**运行进度同样按这条规则投递**：进度文本就是模型的回答正文，会引用结果数字。Question 与 Notice 不含结果数据，发到原地址。以后引入数据权限时，只需要在这一处检查受众。

6. **模型不能直接发消息。** 不提供“发送消息”之类的模型工具；离开系统的只有可交付物，接收方只由 Submission 的地址决定。架构检查固定：工具与 Answering 不得导入渠道模块，渠道只能导入 contracts 与协议宿主接口。

7. **渠道契约。** 渠道向核心声明能力，核心按能力选择渲染方式，渠道在能力不足时降级（不能编辑消息时只发最终结果，不能放按钮时让用户回复选项序号）。

   ```ts
   interface Channel {
     readonly id: string;
     readonly capabilities: { editableMessages: boolean; actions: boolean; files: boolean };
     start(sink: (submission: Submission) => Promise<void>): Promise<void>;
     deliver(target: DeliveryTarget, message: Deliverable, idempotencyKey: string, content?: DeliveryContent): Promise<void>;
     progress?(target: DeliveryTarget, view: ProgressView): Promise<void>;
     stop(): Promise<void>;
   }
   ```

## 考虑过的方案

- **为每个平台写一个网关，直接调用运行时内部接口**：最快接通第一个平台，但每个平台都要重新处理身份、去重、交付与澄清，Query Assurance 的交付规则要在每个网关里各写一遍。
- **自研飞书的 MCP Events Server，运行时作为 Events 客户端**：Events 扩展仍是草案，当前 SDK（1.29.0）不支持；规范把“收到事件后如何反应”留给应用，路由、身份、交付这些事一样要做。它适合作为本边界外的一个渠道，而不是边界本身。
- **迁移到 pi-durable**：它的 `submit`/`requestId`/`whenBusy` 与持久化任务正是本 ADR 借用的语义，但它是实验包且依赖 `pi-ai` 1.x，迁移等于替换会话与 harness。本 ADR 的契约与它对齐，以后迁移只换实现。
- **群聊共用一个会话**：保留了群上下文，但要改变会话与 Query Task 的单一所有者模型，影响鉴权的所有路径。

## 后果

- 新增一个平台只需要写一个渠道；定时任务、MCP Events 的收与发都是渠道。
- Web 与 Electron 也会收到 `publication.delivered`，以后可以按需迁移到同一边界，本 ADR 不要求。
- metadata 新增三张表：入站去重、地址与身份绑定、渠道交付发件箱。
- 群聊里每个人的追问只延续自己的上下文；需要共享上下文时另行决策。
- 首期交付有一个已知的崩溃窗口（决策 3），入站在接受后最多处理一次（决策 2）。

## 实施与验收

1. **核心契约**：contracts 中的 Submission、ConversationAddress、Deliverable 与 `publication.delivered`；`RequestContext.host` 增加 `channel`；metadata 的三张表；`ChannelHub` 负责去重、绑定、派发、发件箱投递与受众放行；架构检查。
   - 测试（用内存渠道，不依赖任何平台）：重复 `requestId` 只派发一次；同一地址的两个发言人得到两个会话；Publication 以 `receiptId` 为键投递一次，投递失败后重试；未放行的群只收到 Notice、提问人私聊收到结果；澄清在等待中与等待结束后两种回答路径；模型工具集中没有发消息的工具。
2. **飞书渠道**：长连接入站、卡片渲染与按钮回调；在运行中的应用里完成一次“提问 → 进度卡片 → 交付结果”的端到端验证并截图。
3. **澄清不再在内存中等待**：先用测试证明 Query Task 能跨运行延续，再改为提问后结束本轮；渠道契约不变。
