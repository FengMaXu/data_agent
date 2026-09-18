# Spider2 Gold109：36 道 `not_published_no_export_call` 根因分析

运行：`spider2-gold109-deepseek-flash-001`。本报告仅分析 publicationStatus 精确等于 `not_published_no_export_call` 的 36 题。

## 结论

- 36/36 都没有调用 `export_query`，也没有执行任何 `mode=result` 查询。
- 35/36 的最后一次模型响应为 `stopReason=length`：其中 34 题单轮输出精确达到 8192 token，`local279` 在输入 315918 token 后仅输出 16 token，属于上下文窗口耗尽。
- `local259` 最后一次模型响应为 `stopReason=error`、usage 全 0，但 Runner 最终仍标记为 `completed`。
- 所有 36 题的最后响应只包含 thinking（2 题另有 text），没有 tool call，因此无法进入 result → export 交付链。
- 这 36 题不是因 `maxTurns` 停止，也没有证据表明 Result Boundary 拒绝了已提交的 result SQL；它们根本没有提交 result SQL。

## 8192 token 的来源与内容构成

`8192` 是 Data Agent 当前构造主 Agent 模型时的本地硬编码值，不是本次运行证明出的供应商模型最大值。`packages/runtime/src/agent-assembly.ts` 的 `buildModel()` 固定声明 `contextWindow: 128000` 和 `maxTokens: 8192`；Pi provider adapter 以 `model.maxTokens` 构造单轮请求，并在接近本地声明的上下文上限时向下收缩。评测配置中的 `limits.maxTurns/maxToolCalls/maxExploratoryQueries` 不控制单轮输出 token。

34 个精确命中 8192 的最终响应中：

- 输出 token 合计：278,528；其中 reasoning token 278,435，占 **99.9666%**。
- thinking 文本合计 1,110,256 字符；普通 text 仅 176 字符。
- 32 题只有 thinking block，2 题是 thinking + 极短 text；0 题含 tool call。
- 词频显示主要是反复推演而非答案内容：`Hmm` 2,887 次、`Let me` 2,062 次、`reconsider` 603 次；同时出现 `hypothesis` 742 次、`decision` 621 次、`alternative` 508 次、`SQL` 356 次、`exploration` 299 次、`result query` 155 次。

虽然 Harness 设置了 `thinkingLevel: "off"`，本次 OpenAI-compatible DeepSeek Flash 端点仍返回 `reasoning_content`，Pi 将其记录为 thinking/reasoning。`off` 在当前自定义模型描述下没有形成对供应商原生推理输出的硬关闭。系统也没有独立的 reasoning token 上限或“必须先发工具调用”的预留，因此模型可以把整轮 8192 token 都消耗在思考中。

## 伴随因素（重叠统计，不等于互斥根因）

- 34/36 题收到未决假设提醒，共 40 次。
- 共记录 313 次 `query_database` 工具调用和 50 次 `update_answer_spec` 调用，模型在探索与口径建模上消耗较大。
- 17/36 曾在首次 Spec 前查询，触发 `ANSWER_SPEC_DECLARATION_REQUIRED`。
- 4/36 出现 Spec/Decision 更新错误。
- 14/36 出现文件或知识文档路径读取错误。
- 9/36 没有任何工具错误，仍因输出长度耗尽而未交付，说明工具错误不是必要条件。
- 36/36 都没有调用 `ask_user_clarification`。

## 逐题证据

| 题号 | 直接终止原因 | 最终输入 token | 最终输出 token | Query 调用 | Spec 更新 | 未决提醒 | 伴随情况 |
|---|---|---:|---:|---:|---:|---:|---|
| local015 | 单轮输出达到 8192 token 上限 | 207 | 8192 | 7 | 1 | 1 | 无工具错误 |
| local017 | 单轮输出达到 8192 token 上限 | 3400 | 8192 | 10 | 6 | 3 | 查询早于 Spec；Spec/Decision 更新错误 |
| local020 | 单轮输出达到 8192 token 上限 | 824 | 8192 | 8 | 1 | 1 | 文档路径读取错误 |
| local040 | 单轮输出达到 8192 token 上限 | 329 | 8192 | 8 | 1 | 1 | 无工具错误 |
| local050 | 单轮输出达到 8192 token 上限 | 3328 | 8192 | 8 | 1 | 1 | 文档路径读取错误 |
| local055 | 单轮输出达到 8192 token 上限 | 226 | 8192 | 9 | 1 | 1 | 无工具错误 |
| local064 | 单轮输出达到 8192 token 上限 | 267 | 8192 | 9 | 1 | 1 | 查询早于 Spec |
| local065 | 单轮输出达到 8192 token 上限 | 401 | 8192 | 6 | 1 | 1 | 无工具错误 |
| local070 | 单轮输出达到 8192 token 上限 | 156 | 8192 | 9 | 1 | 1 | 查询早于 Spec；文档路径读取错误 |
| local097 | 单轮输出达到 8192 token 上限 | 196 | 8192 | 10 | 1 | 1 | 查询早于 Spec |
| local156 | 单轮输出达到 8192 token 上限 | 539 | 8192 | 9 | 1 | 1 | 查询早于 Spec |
| local157 | 单轮输出达到 8192 token 上限 | 463 | 8192 | 9 | 1 | 1 | 查询早于 Spec |
| local169 | 单轮输出达到 8192 token 上限 | 245 | 8192 | 9 | 1 | 1 | 查询早于 Spec；文档路径读取错误 |
| local220 | 单轮输出达到 8192 token 上限 | 361 | 8192 | 6 | 1 | 1 | 无工具错误 |
| local229 | 单轮输出达到 8192 token 上限 | 259 | 8192 | 8 | 2 | 1 | Spec/Decision 更新错误 |
| local258 | 单轮输出达到 8192 token 上限 | 143 | 8192 | 9 | 1 | 1 | 无工具错误 |
| local259 | 模型响应错误 | 0 | 0 | 12 | 1 | 1 | 查询早于 Spec |
| local263 | 单轮输出达到 8192 token 上限 | 176 | 8192 | 15 | 1 | 1 | 查询早于 Spec |
| local264 | 单轮输出达到 8192 token 上限 | 1332 | 8192 | 7 | 1 | 1 | 文档路径读取错误 |
| local269 | 单轮输出达到 8192 token 上限 | 851 | 8192 | 4 | 1 | 1 | 文档路径读取错误 |
| local275 | 单轮输出达到 8192 token 上限 | 2954 | 8192 | 7 | 1 | 1 | 无工具错误 |
| local277 | 单轮输出达到 8192 token 上限 | 196 | 8192 | 8 | 1 | 1 | 查询早于 Spec |
| local279 | 上下文窗口耗尽 | 315918 | 16 | 16 | 4 | 3 | 查询早于 Spec；文档路径读取错误 |
| local284 | 单轮输出达到 8192 token 上限 | 212 | 8192 | 6 | 3 | 2 | Spec/Decision 更新错误 |
| local285 | 单轮输出达到 8192 token 上限 | 195 | 8192 | 11 | 1 | 1 | 查询早于 Spec；文档路径读取错误 |
| local297 | 单轮输出达到 8192 token 上限 | 189 | 8192 | 9 | 1 | 1 | 查询早于 Spec |
| local298 | 单轮输出达到 8192 token 上限 | 165 | 8192 | 8 | 1 | 0 | 查询早于 Spec；文档路径读取错误 |
| local299 | 单轮输出达到 8192 token 上限 | 174 | 8192 | 7 | 1 | 1 | 无工具错误 |
| local300 | 单轮输出达到 8192 token 上限 | 259 | 8192 | 4 | 0 | 0 | 查询早于 Spec |
| local301 | 单轮输出达到 8192 token 上限 | 519 | 8192 | 7 | 1 | 1 | 文档路径读取错误 |
| local309 | 单轮输出达到 8192 token 上限 | 300 | 8192 | 8 | 5 | 2 | Spec/Decision 更新错误 |
| local311 | 单轮输出达到 8192 token 上限 | 152 | 8192 | 9 | 1 | 1 | 文档路径读取错误 |
| local336 | 单轮输出达到 8192 token 上限 | 2052 | 8192 | 11 | 1 | 1 | 查询早于 Spec；文档路径读取错误 |
| local344 | 单轮输出达到 8192 token 上限 | 230 | 8192 | 8 | 1 | 1 | 无工具错误 |
| local355 | 单轮输出达到 8192 token 上限 | 179 | 8192 | 12 | 1 | 1 | 查询早于 Spec；文档路径读取错误 |
| local356 | 单轮输出达到 8192 token 上限 | 207 | 8192 | 10 | 1 | 1 | 文档路径读取错误 |

## 边界说明

- `not_published_no_export_call` 是交付结果标签，不等同于业务 SQL 错误。
- “未决假设提醒导致未提交”不能由本次单臂运行直接证明；多数已成功发布的题目同样收到提醒。需要同配置 control/treatment A/B 才能做因果归因。
- 当前最确定的工程问题是：Runner 将 `stopReason=length/error` 且无导出的运行记为 `completed`，掩盖了生成截断。
