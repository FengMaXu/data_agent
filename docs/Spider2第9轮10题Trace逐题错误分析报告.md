# Spider2 第 9 轮 10 题 Trace 逐题错误分析报告

## 1. 范围与证据

- 运行：`spider2-local-round9-same10-no-limits-001`
- 模型：`deepseek-chat`
- 数据库后端：`sqlite`
- 题目数：10
- 主要证据：每题 `trace.json`、`result.json`、提交的 SQL/CSV、官方 Gold 结果，以及官方 `evaluate.py`。
- Trace 路径：
  `C:/data-agent-eval/runs/spider2-local-round9-same10-no-limits-001/cases/<instance_id>/trace.json`
- Gold 结果路径：
  `C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/`

本报告只总结工具调用、结果证据和模型可观察输出，不把模型的长篇自我解释当作正确性证明。

## 2. 官方判定结论

已使用官方评测器执行提交 SQL，并对有 CSV 的题目执行官方 `exec_result` 比较。

| 题目 | 官方 SQL 判定 | 官方 CSV/`exec_result` 判定 | 最终交付状态 | Gold 最终形状 |
|---|---:|---:|---|---|
| `local003` | 错 | 错 | 已提交 CSV，但数据错误 | 11 行 × 2 列 |
| `local010` | 错 | 未提交 | 未生成官方 CSV | 1 行 × 1 列 |
| `local025` | 错 | 未提交 | 未生成官方 CSV | 1 行 × 1 列 |
| `local029` | 错 | 未提交 | 未生成官方 CSV | 3 行 × 3 列 |
| `local032` | 错 | 错 | 已提交 CSV，但第四项错误 | 4 行 × 3 列 |
| `local034` | 错 | 未提交 | 未生成官方 CSV | 1 行 × 1 列 |
| `local035` | 错 | 错 | 已提交 CSV，但城市对错误 | 1 行 × 2 列或 2 行 × 1 列 |
| `local037` | 错 | 未提交 | 未生成官方 CSV | 3 行 × 2 列 |
| `local050` | 错 | 错 | 已提交 CSV，但标量错误 | 1 行 × 1 列 |
| `local061` | 错 | 未提交 | 最终查询为空，未生成 CSV | 12 行 × 2 列 |

汇总：

```text
官方 SQL：0/10
官方 exec_result：0/4（只有 4 题提交了 CSV）
固定 10 题分母的 End-to-End：0/10
```

需要注意：CSV 未提交的 6 题不是“CSV 数值正确”，而是在固定分母的 End-to-End 评分中按未交付处理。

## 3. 总体结论

这 10 题不是单一的导出问题。成功导出的 4 题也全部被官方判错，说明导出终止信号、`CANDIDATE_COLUMNS_MISMATCH` 和 CSV 覆盖率问题，不能解释全部 SQL 错误。

主要失效模式如下：

1. **最终粒度没有锁定**：标量被输出成分布或明细，或加入未请求列。
2. **多对多 JOIN 造成计数膨胀**：`order_items` 与 `order_payments`、`order_reviews` 直接连接后仍使用 `COUNT(*)` 或错误的去重键。
3. **模型发现了反证，却没有修改主查询**：多个 Trace 已经显示 JOIN 膨胀、孤儿键或异常值，但模型仍将原候选认定为正确。
4. **自洽验证替代了答案验证**：verification/reconciliation 主要重新计算同一 SQL，证明的是“候选 SQL 自己一致”，不是“候选 SQL 符合 Gold 口径”。
5. **无证据的语义补充**：例如把 `promo_id=999` 排除、把支付按订单汇总、把城市对按无向边去重。
6. **QA 失败后进入重复试错**：`expected []` 触发了大量列名和查询重试，但没有改变核心业务口径。

---

## 4. 逐题分析

## 4.1 `local003`：RFM 分群平均销售额

### 官方结果

Gold 文件：`gold/exec_result/local003.csv`

Gold 包含 11 个 RFM 分组，官方比较使用平均销售值列。部分 Gold 值：

```text
About to Sleep       57.68495912447257
Can't Lose Them     350.8868165989553
Champions           250.8568210435466
Hibernating         182.8458159996057
Lost                 57.39320983627944
```

提交 CSV 的对应值包括：

```text
About to Sleep       54.51
Can't Lose Them     446.63
Champions           292.70
Hibernating         136.15
Lost                 55.82
```

官方判定：SQL 错，CSV 错。

### Trace 过程

- `toolCalls 11–15`：确认 `delivered` 状态、交付订单数量和订单商品覆盖情况。
- `toolCall 16`：建立客户级 RFM 指标。
- `toolCall 17`：得到分组统计，同时输出 `overall_aov` 和 `avg_aov_per_customer`。
- `toolCall 18`：检查无空分组。
- `toolCall 19`：带 SQL 注释的 verification 被安全规则拒绝。
- `toolCall 20`：以另一条查询验证 RFM 分数，但仍沿用相同的 `price + freight_value` 口径。
- `toolCall 21`：生成最终查询，返回 11 行。
- `toolCall 23`：成功导出 CSV。

### 首个关键错误

`toolCall 16` 的客户指标中写入：

```sql
SUM(oi.price + oi.freight_value) AS total_spend
```

而官方 Gold SQL 使用的是：

```sql
SUM(price) AS total_spent
```

也就是说，模型把运费加入了 Monetary/销售总额；官方口径只使用商品 `price`。

### 其他问题

1. RFM 分数和分组逻辑虽然大体按照 `RFM.md` 实现，但 Monetary 分数建立在错误的金额上，因此会改变分组边界和分组平均值。
2. 最终查询使用 `ROUND(AVG(...), 2)`，而 Gold 保留更高精度；主要错误仍然是加入运费，不能仅归因于舍入。
3. 模型在 `toolCall 20` 通过同一错误金额重新计算，形成了循环验证。
4. 模型输出的 `Potential Loyalists` 与 Gold 中的拼写 `Potentital Loyalists` 不一致。官方本题的 `condition_cols` 只比较数值列，因此这不是本次官方数值判错的主因，但会造成交付结果不稳定。

### 根因

**把商品销售额 `price` 错读为商品价加运费，并用该错误金额同时计算 Monetary 分数和最终平均销售额。**

---

## 4.2 `local010`：航线城市距离分箱中最少的数量

### 官方结果

Gold：

```text
output
6
```

提交 SQL 实际返回：

```text
dist_range  pair_count
0-999       92
1000-1999   93
2000-2999   37
3000-3999   20
4000-4999    6
5000-5999    3
6000+        7
```

官方判定：SQL 错，未提交 CSV。

### Trace 过程

- `toolCalls 8–11`：解析机场城市和 `(longitude, latitude)` 坐标。
- `toolCall 13`：第一次完整分布查询，得到 7 个距离区间。
- `toolCall 14`：检查若干平均距离。
- `toolCall 15`：验证无向城市对总数为 258。
- `toolCall 16`：查询最少区间，得到 `5000-5999 = 3`。
- `toolCalls 17、19、26、27、29`：多次尝试导出，均因 `CANDIDATE_COLUMNS_MISMATCH: expected []` 失败。
- `toolCall 28`：退回 `write_file` 写入分布 CSV，但这不是官方要求的 `export_query` 交付。

### 首个关键错误：城市对方向被合并

最终 SQL 使用：

```sql
CASE WHEN da.city < aa.city THEN da.city ELSE aa.city END AS city1,
CASE WHEN da.city < aa.city THEN aa.city ELSE da.city END AS city2
```

这会把 `A → B` 与 `B → A` 合并为一个无向城市对。

基于同一数据库复算：

- 使用该无向归一化：分布为 `92, 93, 37, 20, 6, 3, 7`，最小值为 `3`。
- 不做方向归一化、保留有序城市对：分布为 `184, 186, 74, 40, 12, 6, 14`，最小值为 `6`，与官方 Gold 一致。

因此，按官方 Gold 判定，本题应保留出发城市和到达城市的方向。

### 重要口径冲突

外部 `haversine_formula.md` 明确写了要把城市顺序标准化，因此模型的无向处理有文档依据；但官方 Gold 的 `6` 与有序城市对结果一致。这里存在**任务文档与官方 Gold 的冲突**。

对于评测结果，必须记录为：

```text
模型遵循了外部文档的无向城市对解释，但该解释与官方 Gold 不一致。
```

### 第二个错误：最终粒度错误

题目最后问的是：

```text
最少距离区间中有多少个城市对？
```

官方 Gold 是 1 行 1 列的标量 `6`。模型一直尝试导出 7 行分布，后来虽然生成了 `pc=3` 的标量查询，但其基础城市对口径仍然错误。

### 根因

1. **按照文档把有向航线对应的城市对合并为无向城市对，导致 3 与官方 6 不一致。**
2. **没有在第一次答案合同中锁定标量输出，先把完整分布当作最终结果。**
3. `expected []` 导出错误导致重复重试，但没有修正城市对方向口径。

---

## 4.3 `local025`：每场比赛最高得分回合的平均值

### 官方结果

Gold：

```text
output
19.02098951
```

提交 SQL 返回的是每场比赛的明细：

```text
568 行 × 4 列
match_id, over_id, bowler, total_runs
```

Trace 中对该明细再求平均得到：

```text
19.426056338028168
```

官方判定：SQL 错，未提交 CSV。

### Trace 过程

- `toolCalls 10–17`：检查 `match`、`ball_by_ball`、`batsman_scored`、`extra_runs` 的行数和主键结构。
- `toolCall 18`：建立每个 `match_id + innings_no + over_id` 的回合总分，并按比赛排名。
- `toolCall 19–21`：手工检查首场比赛的最高回合、投手和跑分组成。
- `toolCall 22`：计算平均最高回合得分，得到 `19.4261`。
- `toolCall 23`：错误使用 `COUNT(DISTINCT match_id, innings_no, over_id)`，SQLite 报参数错误。
- `toolCalls 24–29`：多次确认 `568` 场和 `19.426056`，并发现 `match` 表只有 567 场。
- `toolCalls 32、35、38`：尝试导出标量和明细，均被 `expected []` 拒绝。
- 最终提交 SQL 仍为 568 行的每场最高回合明细，没有最终 `AVG`。

### 首个关键错误

模型在 `toolCall 18` 使用 `ball_by_ball` 作为比赛总体，得到 568 个 `match_id`。随后 Trace 明确发现：

```text
match 表：567 场
ball_by_ball：568 个 match_id
```

但模型在 `toolCall 23–29` 仍然把 568 场视为正确总体，并在文字中确认：

```text
using the 568 matches present in ball_by_ball is correct
```

这至少说明最终总体没有锚定权威的 `match` 实体表。

### 最终粒度错误

题目最终要求的是：

```text
所有比赛最高回合得分的平均值
```

Gold 是单行单列。模型的最终 SQL：

```sql
SELECT match_id, over_id, bowler, over_runs AS total_runs
FROM ranked WHERE rn=1
```

只完成了“每场最高回合”，没有完成最后的 `AVG(total_runs)`。

### 数值口径仍未闭合

即使把模型的 568 行明细再平均，也得到 `19.426056338028168`，不是 Gold 的 `19.02098951`。因此本题不只是输出粒度问题，还存在比赛总体、回合/跑分关联或 Gold 口径未对齐的问题。

可以确认的事实：

- 模型提交结果包含 568 场，而 `match` 表有 567 场。
- 模型没有验证最终候选是否应与 `match` 表做内连接。
- 仅连接 `match` 表后平均值仍不等于 Gold，所以不能把全部差异简单归因于孤儿 `match_id`。

### 根因

1. **把中间的每场最高回合明细直接作为最终结果，漏掉最终平均聚合。**
2. **发现 `ball_by_ball` 与 `match` 的实体数不一致后，仍选择 568 个事实表比赛作为总体。**
3. **回合跑分的官方口径没有被独立证伪；Trace 只验证了候选 SQL 的自洽结果。**

---

## 4.4 `local029`：交付订单最多的前三名客户

### 官方结果

Gold：

```text
Average_Payment_By_Customer,customer_city,customer_state
7.075454545454545,sao paulo,SP
2.4107692307692306,sao paulo,SP
22.65521739130435,guarulhos,SP
```

提交 SQL：

```text
customer_unique_id,avg_payment,customer_city,customer_state
8d50...8455,58.62,sao paulo,SP
3e43...fedc,130.30,praia grande,SP
1b6c...5f33,137.00,ituiutaba,MG
```

官方判定：SQL 错，未提交 CSV。

### Trace 过程

- `toolCall 7`：确认 `order_status='delivered'` 有 96478 条。
- `toolCall 8`：发现 `order_delivered_customer_date IS NOT NULL` 有 96476 条，随后选择 `order_status` 口径。
- `toolCall 9`：先按订单汇总支付金额，再按客户平均，得到 15、9、7 个订单的前三名。
- `toolCall 10`：发现第三名有 7 个订单但 8 条支付记录。
- `toolCall 11`：只验证了订单数，没有验证 Gold 使用的支付行聚合方式。
- `toolCalls 12–35`：大量尝试去掉列、改列名和重新导出，全部因 `expected []` 失败。
- `toolCall 37`：最后一条查询还存在 `o2.total_payment` 未定义错误。

### 首个关键错误：支付粒度被擅自改成订单总额

模型明确采用：

```sql
SELECT order_id, SUM(payment_value) AS order_total
FROM olist_order_payments
GROUP BY order_id
```

然后计算：

```sql
AVG(p.order_total) AS avg_payment
```

但官方 Gold SQL 使用的是直接支付行平均：

```sql
AVG(p.payment_value) AS Average_Payment_By_Customer
```

同时 Gold 的排序使用连接结果中的：

```sql
COUNT(o.order_id) AS Total_Orders_By_Customers
```

模型则使用：

```sql
COUNT(DISTINCT o.order_id)
```

因此模型同时改变了：

1. 平均支付的分子/分母粒度；
2. 顶三排名的计数粒度；
3. 最终列集合。

### 输出列错误

用户要求的 Gold 结果是 3 列：平均支付值、城市、州。模型额外导出：

```text
customer_unique_id
```

本题官方 SQL 比较使用完整结果，列/值均未匹配。

### Trace 中的自我确认问题

模型在 `toolCall 10–11` 发现某客户存在 7 个订单和 8 条支付记录，随后把这一事实当作“必须按订单汇总”的证明；但这只能证明两种粒度不同，不能证明订单总额平均就是题目或 Gold 的口径。

### 根因

1. **把“平均支付值”自行解释为“先求订单支付总额，再求订单平均”，与 Gold 的支付行平均不同。**
2. **把排名依据从 Gold 的连接行计数改成 `COUNT(DISTINCT order_id)`。**
3. **将客户唯一标识作为最终输出列加入，未遵循最终列白名单。**
4. `expected []` 造成了大量列名重试，掩盖了真正的支付聚合错误。

---

## 4.5 `local032`：四类最佳卖家

### 官方结果

Gold：

```text
Description, Seller_ID, Value
Seller with most unique customers :-, 6560211a19b47992c3666cc44a7e94c0, 1790
Seller with highest Profit :-, 4869f7a5dfa277a7dca6462dcf3b52b2, 206968.8
Seller with most unique orders :-, 6560211a19b47992c3666cc44a7e94c0, 1819
Seller with most 5 star ratings :-, 1f50f920176fa81dab994f9023523100, 1096
```

提交结果的数值为：

```text
1790
206968.8
1819
993
```

官方判定：SQL 错，CSV 错。

### Trace 过程

- `toolCalls 7–10`：分别查询四项指标。
- `toolCalls 11–14`：建立四条只取第一名的查询。
- `toolCall 15`：合并为 4 行结果。
- `toolCall 16`：检查 5 星评价连接后的 `COUNT(DISTINCT review_id)=993`。
- `toolCall 17`：使用不经过 `order_items` 的子查询再次得到 993。
- `toolCall 21`：成功导出 4 行 CSV。

### 前三项

前三项与官方 Gold 的数值一致：

- 最大去重客户数：1790；
- 最大利润：206968.8；
- 最大去重订单数：1819。

### 第四项的关键错误

模型使用：

```sql
COUNT(DISTINCT r.review_id) AS value
```

并通过：

```sql
olist_order_items oi
JOIN olist_order_reviews r ON oi.order_id = r.order_id
```

关联卖家与评价。

官方 Gold 的第四项结果是卖家 `1f50...3100`、数值 `1096`。在当前数据库上，使用相同 JOIN 但计算连接行数：

```sql
COUNT(*)
```

得到官方值 `1096`，而 `COUNT(DISTINCT review_id)` 得到模型的 `993`。

原因是一个订单可能有多个商品行；同一个评价连接到该订单的多个卖家商品行。官方 Gold 将这些连接行计入“5 星 ratings”，模型擅自将评价去重，改变了官方计数口径。

### Trace 中的循环验证

`toolCall 16` 发现 `993`，`toolCall 17` 又通过另一条查询确认 `993`，模型因此认定没有行膨胀；但这里恰恰把“评价去重”当成了正确规则。验证没有比较官方要求的连接行计数，也没有验证卖家与订单商品的业务粒度。

### 交付问题

- CSV 成功生成，但中文描述在 Trace 和提交 CSV 中出现乱码，例如 `���ȥ�ؿͻ���`。
- 本题官方 `condition_cols=[2]`，所以数值列中的第四个错误是官方判错的决定性因素；乱码仍是独立的交付质量问题。

### 根因

**模型把官方要求的 5 星评价连接行计数改成了去重评价数，导致第四个卖家和值错误；随后用同一错误口径重复验证。**

---

## 4.6 `local034`：各类别最常用支付方式的平均支付次数

### 官方结果

Gold：

```text
Average_Most_Used_Payment_Count
1035.432432
```

提交 SQL 结果：

```text
average_total_payments
1172.554054
```

官方判定：SQL 错，未提交 CSV。

### Trace 过程

- `toolCall 6`：直接将 `order_items`、`products`、`orders`、`order_payments` 连接后按类别和支付方式 `COUNT(*)`。
- `toolCall 7`：取每类最大支付计数并求平均，得到 `1172.554054`。
- `toolCalls 8–9`：明确发现连接后有 117601 行，而支付表只有 103886 行。
- `toolCall 10`：对 `cama_mesa_banho + credit_card` 的连接行数进行验证，得到 8959。
- `toolCalls 13–40`：反复调整别名、查询形状和导出列，均因 `expected []` 失败。
- 最终提交 SQL 仍使用 `COUNT(*)`。

### 首个关键错误：多对多计数膨胀

模型主查询：

```sql
FROM olist_order_items oi
JOIN olist_products p ON oi.product_id = p.product_id
JOIN olist_orders o ON oi.order_id = o.order_id
JOIN olist_order_payments op ON o.order_id = op.order_id
GROUP BY p.product_category_name, op.payment_type
```

然后使用：

```sql
COUNT(*) AS cnt
```

同一个订单中的每条支付记录会与该订单的多条商品行组合，因此统计的是：

```text
商品行 × 支付行
```

而不是官方 Gold 使用的订单级计数。

当前数据库复算：

```text
COUNT(*)                       平均值 = 1172.554054
COUNT(DISTINCT op.order_id)    平均值 = 1035.432432
```

后者与 Gold 完全一致。

### Trace 中已经出现了反证

`toolCall 8` 和 `toolCall 9` 已经给出：

```text
JOIN 后：117601
支付表：103886
```

模型在文字中承认存在多对多膨胀，但随后仍然认为直接 JOIN 是“自然解释”，并继续使用 `COUNT(*)`。这是本轮最典型的“已发现反证但不回滚主假设”。

### 根因

1. **未处理 `order_items` 与 `order_payments` 的多对多关系，使用 `COUNT(*)` 导致计数膨胀。**
2. **将支付记录数理解为商品-支付连接行数。**
3. **在已发现 117601/103886 不守恒后，仍保留原 SQL。**
4. `expected []` 触发了 12 次导出重试，但没有改变度量口径。

---

## 4.7 `local035`：排序后相邻地理记录的最大距离城市对

### 官方结果

Gold 有两个可接受结果：

```text
local035_a.csv
city_one,city_two
bom sucesso de itarare,bom retiro da esperanca
```

或：

```text
local035_b.csv
city
bom sucesso de itarare
bom retiro da esperanca
```

提交结果：

```text
curr_state,curr_city,prev_state,prev_city,distance_km
RS,santa lucia do piai,RS,santa cruz do sul,18208.185
```

官方判定：SQL 错，CSV 错。

### Trace 过程

- `toolCall 3`：统计 1000163 条地理记录、8463 个城市。
- `toolCall 4`：确认排序字段。
- `toolCall 5`：对完整原始记录使用 `LAG`，得到 `santa cruz do sul → santa lucia do piai` 的 18208.185 km。
- `toolCall 6`：发现纬度范围最高 45.0659、经度最高 121.105，已经出现明显异常坐标。
- `toolCalls 7–9`：专门检查异常城市和异常坐标。
- `toolCalls 10、14`：使用 Python 重算 Haversine，确认 18208.185。
- `toolCall 15`：重新查询相同结果。
- `toolCall 16`：成功导出 1 行、5 列 CSV。

### 首个关键错误：把异常值确认成答案

模型在 Trace 中已经确认：

```text
santa lucia do piai 的坐标为 (14.585, 121.105)
```

并判断该点是明显异常数据。但它随后把异常点纳入最大距离计算，并把“异常点仍在表中”当成必须使用该点的理由。

最终 SQL 对完整原始记录直接执行：

```sql
LAG(geolocation_state) OVER (
  ORDER BY geolocation_state,
           geolocation_city,
           geolocation_zip_code_prefix,
           geolocation_lat,
           geolocation_lng
)
```

这实际上是“逐条 geolocation 记录相邻”，而不是稳定的城市级结果；同时直接把异常坐标代入距离计算。

### 与 Gold 的差异

官方 Gold 要求城市对：

```text
bom sucesso de itarare
bom retiro da esperanca
```

模型交付的是：

```text
santa cruz do sul
santa lucia do piai
```

并额外输出州和距离列。即使接受模型的逐行解释，最终结果也与官方 Gold 不同。

### 输出形状错误

Gold 是 1×2 或 2×1，只返回两个城市；模型输出 1×5，包含：

```text
curr_state, curr_city, prev_state, prev_city, distance_km
```

这些都是题目没有要求的诊断字段。

### 根因

1. **确认异常坐标后仍把异常坐标作为业务答案，而没有按官方城市口径处理。**
2. **将完整原始行的 `LAG` 结果直接当作城市对结果，未完成城市级粒度收敛。**
3. **最终输出包含状态和距离等未请求列。**
4. Python 只是复算了同一算法，不能证明算法符合官方 Gold。

---

## 4.8 `local037`：各类别最常用支付类型的 Top 3

### 官方结果

Gold：

```text
Category_name,payment_count
cama_mesa_banho,7540
beleza_saude,6874
esporte_lazer,5904
```

提交 SQL 结果：

```text
product_category_name,payment_type,number_of_payments
cama_mesa_banho,credit_card,8959
beleza_saude,credit_card,7566
esporte_lazer,credit_card,6635
```

官方判定：SQL 错，未提交 CSV。

### Trace 过程

- `toolCalls 7–10`：检查支付和产品表数量。
- `toolCalls 11–13`：用直接 JOIN 统计类别-支付类型计数。
- `toolCall 14`：发现三类商品的连接行数为 30740，而不同订单数为 25946。
- `toolCall 16`：尝试按 `order_id + payment_sequential` 去重，得到另一组数值。
- `toolCall 17`：读取类别英文翻译表。
- `toolCalls 18–19`：继续使用直接 JOIN 的 `COUNT(*)`。
- `toolCalls 20、23、30、33、36、43–45`：多次导出均因 `expected []` 失败。
- 最终提交 SQL仍是直接 JOIN 后的 `COUNT(*)`。

### 首个关键错误：支付计数被商品行放大

最终 SQL：

```sql
COUNT(*) AS number_of_payments
```

连接路径为：

```text
order_payments → order_items → products
```

一个订单有多个商品时，一笔支付会被重复计数。官方 Gold 数值与以下订单级计数一致：

```text
cama_mesa_banho = 7540
beleza_saude    = 6874
esporte_lazer   = 5904
```

模型结果：

```text
8959, 7566, 6635
```

正是多商品订单连接后的膨胀结果。

### Trace 已发现反证但没有采用

`toolCall 14` 已显示：

```text
item_rows = 30740
orders     = 25946
payment_orders = 25946
```

这已经证明 `COUNT(*)` 不是订单级支付计数。模型还在 `toolCall 16` 计算了去重候选，但最后以“Top 3 排名顺序没有变化”为理由继续使用膨胀后的值。

排名顺序稳定不能证明计数值正确；官方比较同时比较计数值。

### 输出列错误

Gold 只有：

```text
Category_name,payment_count
```

模型多输出了：

```text
payment_type
```

模型还尝试将类别翻译为英文，但最终提交使用了原始葡萄牙语类别。翻译不是本次最终 SQL 数值失败的主因；多余列和计数膨胀才是主要问题。

### 根因

1. **把商品行与支付行的连接行数当成支付次数。**
2. **发现膨胀后，只验证排名顺序，不验证最终数值。**
3. **最终导出包含题目没有要求的 `payment_type` 列。**
4. `expected []` 引发了大量列名和翻译重试，没有修复 JOIN 粒度。

---

## 4.9 `local050`：法国 2021 月均预测销售额的中位数

### 官方结果

Gold：

```text
output
2604.2362912087915
```

提交 CSV：

```text
median_avg_monthly_projected_sales_usd
2552.7
```

官方判定：SQL 错，CSV 错。

### Trace 过程

- `toolCalls 10–18`：检查促销、渠道、法国客户和汇率。
- `toolCall 18`：确认法国 2021 汇率均为 1。
- `toolCalls 19–28`：检查法国销售、促销 ID、渠道和年份。
- `toolCall 29`：按 `prod_id + month + year` 汇总销售额。
- `toolCall 30`：检查不同年份的产品月份数量。
- `toolCalls 31–32`：确认 2019/2020 的产品月交集数量，后续得到每月两年都有数据的产品数。
- `toolCalls 38–39`：计算 12 个月的产品级预测月均值：

```text
1 4054.99
2 2402.89
3 2888.48
4 1474.10
5 2904.71
6 1440.35
7 1600.13
8 1392.60
9 2702.50
10 2218.77
11 3208.94
12 3062.66
```

- `toolCall 41`：发现 2019/2020 产品集合并不完全相同。
- `toolCalls 42–59`：多次用相同的产品-月份两年交集方法重新计算，始终得到 `2552.695` 左右。
- `toolCall 44`：Python 只对这 12 个已经产生的月均值求中位数。
- `toolCalls 48–60`：反复修改别名、舍入和列名，但数值计算链条没有改变。
- `toolCall 65`：最终成功导出 `2552.7`。

### 已确认的差异

当前最终 SQL 的计算链条是：

```text
按 product_id + month + year 汇总
→ 只保留同一 product-month 在 2019、2020 都有记录的交集
→ 按产品计算投影
→ 按月份求平均
→ 对 12 个月月均值取中位数
```

该链条得到：

```text
2552.6959807204075
```

官方 Gold 为：

```text
2604.2362912087915
```

因此 SQL 结果本身已错误，不能归因于导出。

### Trace 暴露的语义缺口

模型在 `toolCall 27` 将以下内容直接写成答案合同：

```text
每个产品和月份，分别使用 2019、2020 的销售额；只使用两年都有记录的 product-month。
```

但随后 `toolCall 30–32` 已经发现不同月份的产品数量不同，`toolCall 41` 也发现 2019/2020 的产品集合不完全一致。模型没有继续证明：

1. Gold 的总体是否是同一 `product-month` 交集；
2. 缺少年份的产品月份应如何处理；
3. 月均值应按产品等权平均，还是按销售事实加权；
4. 中位数应基于未舍入月均值还是中间已舍入值。

模型只是用相同 SQL、不同别名和不同舍入方式重复验证，最终仍声明 `2552.7` 正确。

### 关于舍入

Trace 中模型花费多轮讨论 `2552.69`、`2552.70` 和 `2552.695`。这些舍入差异最多影响小数点后两位，不可能解释 `2552.7` 与 `2604.2362912087915` 的整体差距。

### 根因

**模型未经证实地把“同一产品同一月份两年都有记录”的交集作为总体，并据此计算月均值和中位数；官方 Gold 使用了不同的总体/聚合链条。**

本题 Trace 没有产生足够证据唯一确定 Gold 的隐藏差异，因此不能把问题武断归因于汇率或舍入；可以确定的是，产品月份总体或聚合顺序错误，且模型未完成对该假设的证伪。

---

## 4.10 `local061`：法国 2021 各月平均预测销售额

### 官方结果

Gold：

```text
month,avg_monthly_projected_sales_in_usd
1,4120.33
2,2454.4
3,2980.58
4,1517.54
5,3025.06
6,1482.95
7,1658.6
8,1419.89
9,2754.07
10,2218.77
11,3208.94
12,3131.66
```

提交最终 SQL 返回 0 行、2 列：

```text
month,projected_monthly_sales
```

没有官方 CSV。

官方判定：SQL 错，未提交 CSV。

### Trace 过程

- `toolCalls 8–17`：确认法国 `country_id=52779`、渠道、促销和汇率。
- `toolCall 22`：查询法国客户在 2019/2020 的促销 ID，发现 `promo_id=999` 大量出现。
- `toolCall 24`：确认 `promo_total_id=1` 的过滤结果仍有 15943 条销售记录。
- `toolCalls 27–30`：确认法国、年份和月份数据存在。
- `toolCalls 31–35`：生成正常的产品-月份投影，得到与 `local050` 类似的非空月度结果。
- `toolCalls 36、41、44、47、49、53、58、61、63、66、68、75、77`：多次尝试不同列名和输出形状，均因 `CANDIDATE_COLUMNS_MISMATCH: expected []` 失败。
- `toolCall 69`：新增无证据条件：

```sql
AND p.promo_id<>999
```

- `toolCall 70`：该条件下只剩 2019 少量数据。
- `toolCall 71`：检查两年配对时没有结果。
- `toolCall 74`：最终查询为空。
- `toolCalls 75、77`：继续尝试导出空结果，最终仍失败。

### 首个关键错误：擅自排除 `promo_id=999`

模型查询到：

```text
promo_id=999
promo_name=NO PROMOTION #
promo_total_id=1
```

题目要求的是：

```text
promo_total_id = 1
```

而 `promo_id=999` 在数据库中确实满足 `promo_total_id=1`。模型随后根据自然语言“with promotions”自行补充：

```sql
p.promo_id<>999
```

这不是题目给出的过滤条件，也与已经查到的维度事实冲突。

### 结果如何被该条件清空

在不排除 999 时，Trace 已得到法国 2019/2020 的非空产品-月份数据，并能产生月度预测；加入 `p.promo_id<>999` 后：

- 2019 只保留极少量数据；
- 2020 没有可与 2019 同产品同月份配对的记录；
- 最终 `JOIN` 后为空；
- 模型把空结果错误解释为“正确答案为空”。

### Trace 中的错误确认

模型把 `expected []` 解读成“官方期望空结果”，并在文字中声称：

```text
under the correct interpretation ... no France product had promotional sales in both 2019 and 2020
```

但 `expected []` 是候选输出列合同未建立的工具错误，不是数据库结果证据，更不是 Gold 为空的证据。

### 根因

1. **在题目只要求 `promo_total_id=1` 的情况下，擅自排除 `promo_id=999`。**
2. **把 `CANDIDATE_COLUMNS_MISMATCH: expected []` 误读为 Gold 空结果。**
3. **将查询变为空后，把空结果当作语义确认，而没有回到此前已得到的非空证据。**
4. 导致最终 SQL 为 0 行，和官方 12 个月结果完全不符。

---

## 5. 验证行为专项分析

### 5.1 有效验证没有被使用

本轮至少有以下明确反证：

| 题目 | Trace 中的反证 | 模型后续行为 |
|---|---|---|
| `local025` | `match=567`，`ball_by_ball match_id=568` | 仍把 568 作为总体 |
| `local034` | JOIN 后 117601，支付表 103886 | 仍使用 `COUNT(*)` |
| `local037` | 商品行 30740，订单数 25946 | 只确认排名稳定，保留膨胀计数 |
| `local035` | 发现明显异常坐标 | 仍把异常坐标作为答案 |
| `local061` | `promo_id=999` 明确属于 `promo_total_id=1` | 仍自行排除 999 |
| `local050` | 两年产品集合和每月产品数量不同 | 未证实总体交集假设 |

### 5.2 循环验证

多个题目的 verification 仅重新运行同一候选逻辑：

- `local003`：错误金额同时用于主查询和 verification；
- `local032`：`993` 通过 `COUNT(DISTINCT review_id)` 被重复确认；
- `local034`：对膨胀后的 `8959` 做局部确认；
- `local037`：只确认 Top 3 顺序不变；
- `local050`：不同别名、相同产品月份交集 SQL 重复执行；
- `local061`：最终空查询被当成语义证据。

应将“重新运行同一候选”与“独立验证关键假设”严格区分。

### 5.3 `expected []` 的影响

`CANDIDATE_COLUMNS_MISMATCH: expected []` 在本轮造成了：

- `local010`：29 次工具调用，最后仍没有官方 CSV；
- `local025`：43 次工具调用，最终停在明细 SQL；
- `local029`：38 次工具调用，重复改列名但没有修复支付粒度；
- `local034`：41 次工具调用，重复导出同一错误标量；
- `local037`：47 次工具调用，反复改原始/英文类别和列名；
- `local061`：77 次工具调用，最后将空结果误判为正确。

它是交付和收敛问题，但不是这些题 SQL 语义错误的唯一根因。

---

## 6. 修正优先级

### 一级：先修 SQL 语义

1. `local003`：Monetary 使用 `SUM(price)`，不要加入 `freight_value`。
2. `local010`：按官方 Gold 保留有序城市对，并最终只取最小区间的数量；同时记录文档与 Gold 的冲突。
3. `local025`：最终必须对每场最高回合再求平均，并重新核定比赛实体总体和回合计数口径。
4. `local029`：按 Gold 的支付行平均和排序计数实现，不要擅自订单级汇总。
5. `local032`：5 星指标按官方要求使用连接行计数，不能改成去重评价数。
6. `local034`：用订单级计数，不能直接对商品-支付多对多连接 `COUNT(*)`。
7. `local035`：重新锁定 Gold 的城市级/排序粒度和异常坐标处理；不要把异常点自证为答案。
8. `local037`：修复订单-商品-支付计数粒度，并只保留 Gold 需要的两列。
9. `local050`：重新确认产品月份总体、缺失月份处理、月均和中位数的聚合顺序。
10. `local061`：删除题目未提供的 `p.promo_id<>999`，不能把 `expected []` 当成空 Gold。

### 二级：修复答案合同和交付

1. 首次查询前锁定标量、Top-N、分组汇总或明细粒度。
2. 对最终列做白名单检查，禁止将诊断列加入 CSV。
3. 把 `taskComplete` 与官方正确性分开；任务完成只表示交付动作完成，不表示 SQL 正确。
4. 修复成功导出后的 Agent Core 终止信号，减少已经错误或正确完成后的无效重试。
5. 修复 `expected []` 的候选列合同来源，但不能用该修复替代 SQL 语义验证。
6. 评测 Trace 中应记录“第一个被反证的假设”，而不是只记录最后一次查询。

## 7. 最终结论

最新 10 题官方结果为：

```text
SQL 正确：0/10
CSV End-to-End 正确：0/10（固定分母）
```

最重要的工程结论是：

```text
本轮不是“导出成功后没有及时终止”单一问题。
即使忽略 CSV 交付，10 道题的最终 SQL 仍全部被官方判错。
```

成功导出的 `local003`、`local032`、`local035`、`local050` 也都包含实质性数据或实体错误；未导出的 6 题则同时存在最终粒度、候选列合同或过度重试问题。后续应先修复题目级的分子/分母、JOIN 基数、实体总体和最终聚合，再处理 Agent 终止与 CSV 交付收敛。
