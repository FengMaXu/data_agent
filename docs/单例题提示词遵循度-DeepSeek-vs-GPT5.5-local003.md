# 单例题提示词遵循度：DeepSeek vs GPT-5.5（主 Agent Spec 写入修复后）

## 测试设置

- 题目：Spider2 `local003`（RFM 分群与各群平均订单销售额）
- 测试入口：仓库正式 `evaluations/spider2/run.mjs`
- DeepSeek Run：`C:/data-agent-eval/runs/prompt-adherence-v3-deepseek-local003`
- GPT-5.5 Run：`C:/data-agent-eval/runs/prompt-adherence-v3-gpt55-local003`
- 两组使用相同题目、System Prompt、数据库、Assurance/Hook 配置；仅模型 Profile 不同。

> 单例结果只用于验证流程和发现提示词遵循问题，不能代表总体准确率。

## 修复验证结论

修复前，两个模型只能读取由正则生成的错误 Spec v1，Trace 中没有主 Agent 提交 Spec 的行为。

修复后，两个模型均通过模型可见的 `update_answer_spec` 提交了完整七槽位 Spec，并在结果 SQL 前再次更新版本：

- DeepSeek：Spec v1（空白 bootstrap）→ v2（题面初稿）→ v3（探索后修订）→ result 绑定 v3；
- GPT-5.5：Spec v1（空白 bootstrap）→ v2（题面初稿）→ v3（证据后修订）→ result 绑定 v3。

结果 SQL 均显式引用了当前候选假设：DeepSeek `H1–H4`；GPT-5.5 `H1`。这证明主 Agent 的 Spec/假设生成、版本化和 result 绑定链路已经实际运行，不再依赖独立 Answer Spec Planner。

## 主 Agent 生成的 Spec 质量

### DeepSeek 最终 v3

- `entity`：`customer_unique_id` 客户；
- `metric`：每 RFM 段总销售额 / 总订单数；
- `filters`：`order_status = 'delivered'`；
- `groupBy`：RFM 段；
- `time`：以 delivered 数据最大购买时间为 Recency 参考；
- `ranking`：不适用；
- `output`：每段一行并导出 CSV；
- 4 个假设均含完整字段与 JSON Pointer 绑定。

### GPT-5.5 最终 v3

- `entity`：`customer_unique_id` 与 RFM 段；
- `metric`：`SUM(total_spend) / SUM(total_orders)`；
- `filters`：delivered，且关键标识/时间/金额非空；
- `groupBy`：RFM segment；
- `time`：基于每位客户最新购买时间的五分位 Recency；
- `ranking`：按平均销售额降序；
- `output`：分群、客户数、订单数、销售额、平均订单销售额及与总体差值；
- 1 个候选假设被显式绑定并由 result 引用。

与修复前的 `metric=count` 空壳相比，两者均已正确捕获题面的核心业务指标、过滤、分组、时间和输出要求。

## 提示词遵循对比

| 检查项 | DeepSeek | GPT-5.5 |
|---|---|---|
| 主 Agent 显式提交 Spec | 通过，2 次 | 通过，2 次 |
| 首次查询前提交 Spec | 最初尝试查询被 Runtime 拒绝，随后提交 | 通过，第一项工具调用即提交 |
| 探索后更新 Spec | 通过，v2→v3 | 通过，v2→v3 |
| result 绑定最新 Spec | 通过，v3 | 通过，v3 |
| result 显式 hypothesisRefs | 通过，H1–H4 | 通过，H1 |
| 成功的 exploration 不绑定 Spec | 通过 | 没有成功探索 |
| exploration 完全省略 hypothesisRefs | 通过 | 失败：仍传空数组，5 次被 Runtime 拒绝 |
| 精确 result Artifact + Receipt | 通过 | 通过 |
| 官方 SQL / 结果评分 | 0 / 0 | 0 / 0 |

## 剩余问题

1. GPT-5.5 仍把 `hypothesisRefs: []` 放入 exploration 调用；Runtime 已按协议拒绝，因此没有污染 Artifact，但模型遵循度仍差。
2. DeepSeek 探索次数过多，且最初两次在提交 Spec 前尝试查询。
3. 两者官方评分仍为 0，说明“流程已按设计运行”不等于业务 SQL 已正确；下一步应单独分析本题 Gold 输出与当前 SQL 的语义差异。
4. 评测附加中文提示在 Trace 中存在乱码，影响中文过程输出和部分假设文本的可读性，应作为独立编码问题修复。

## D1/D2 修复补记

后续根因分析确认，DeepSeek 历史结果在 `orders → order_items` 后执行 `COUNT(o.order_id)`，把 96,478 个 delivered 订单扩大为 110,197 个明细行。旧 D1 因 CTE 被 Probe 跳过、最外层 Digest 无 JOIN 而未登记。

现已增加 CTE 查询块级 counted-key 探针：保留 JOIN/过滤，比较 `COUNT(key)` 与 `COUNT(DISTINCT key)`，并先验证 key 在源关系本身唯一。用本报告 DeepSeek 历史错误 SQL 对真实 SQLite replay，已同时登记 `join_fanout` 与 `count_distinct_divergence`；已使用 `COUNT(DISTINCT)` 或源键本身非唯一的邻近样本不会登记。
