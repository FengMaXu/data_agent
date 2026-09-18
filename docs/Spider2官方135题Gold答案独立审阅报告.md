# Spider2-Lite 官方 135 道题 Gold 答案独立审阅报告

## 审查边界与方法

本报告只使用官方 Spider2-Lite 的 135 道 `local` 题目、官方 SQLite 数据库、官方 `gold/sql`、官方 `gold/exec_result` 和官方评测元数据。**没有使用历史实验报告、Agent trace、提交答案或既有错误分析作为证据。**

有 Gold SQL 的题目先在官方 SQLite 上独立执行，再检查实体粒度、连接基数、过滤、时间边界、窗口顺序和输出契约。无 Gold SQL 的题目根据题目和 schema 独立重算关键聚合/窗口/图关系，再与官方 CSV 对照。多 CSV 文件逐个检查。

结论含义：`正确`=未发现冲突；`部分正确/候选冲突`=候选中至少一个正确、至少一个不正确；`歧义`=题目没有固定唯一口径；`不正确`=有可复现的语义、数值或输出契约矛盾。

## 总结

- 歧义：6 题
- 部分正确/候选冲突：2 题
- 正确：115 题
- 不正确：12 题
- 覆盖：135/135 题；Gold SQL：24 题；仅 CSV：111 题。

### 需要优先修订的 Gold/答案问题

- **local002 — 歧义**：简单线性回归的因变量、自变量、缺失日期是否补零及对称窗口边界未由题目唯一确定。 证据：需先固定这些定义；官方值只能证明某一解释。
- **local003 — 歧义**：题目引用的 RFM definition document 不在本次官方隔离基线；分位数/桶边界和 Monetary 是否包含 freight 无法唯一确定。 证据：SQL 可执行且与 CSV 一致，但权威口径缺失。
- **local004 — 部分正确/候选冲突**：local004_b 的 AOV 保留两位小数且正确；local004_a 将 AOV 截为整数，精度不足。 证据：shape=[3,4]；b 匹配，a 不匹配。
- **local010 — 歧义**：有向城市对的最少区间计数为 6；无向合并为 3。题目未明确 pair 是否保留方向。 证据：Gold 只支持有向解释。
- **local018 — 不正确**：2021 speeding=411/1289=31.885182%，2011=1273/4063=31.331528%，实际是增加 0.553654 个百分点，不是 decrease。 证据：Gold 值是增幅绝对值/反向差值。
- **local025 — 不正确**：按 (match_id, innings_no, over_id) 汇总 batsman+extra，再取每场最高 over；568 个有 over 的 match_id 均值 19.426056338，match 表内为 19.428571，均不等于 Gold。 证据：独立聚合粒度和公式与题意一致。
- **local029 — 不正确**：题意要求 delivered distinct order_id 排名前三；Gold SQL JOIN payment 后 COUNT(o.order_id)，多支付行膨胀订单数。 证据：独立 distinct-order 排名首三为 15、9、7 单。
- **local032 — 不正确**：review 是订单级记录；按 seller 计 5 星应 distinct review_id。Gold 1f50…=1096 是 item×review 连接行；distinct 最大为 cc419…=993。 证据：卖家冠军和数值都会改变。
- **local034 — 歧义**：Gold 1035.432432 对应所有订单、每类别每支付方式 COUNT(DISTINCT order_id) 的均值，不是字面 payment 行数。 证据：需明确 payment 粒度。
- **local035 — 歧义**：官方表有异常经纬度；题目未指定距离公式、是否去重城市、是否过滤异常坐标，CSV 也不含距离。 证据：两个候选仅展示形状不同，不能证明唯一答案。
- **local037 — 歧义**：Gold 7540/6874/5904 对应所有订单按类别×支付方式 COUNT(DISTINCT order_id)，不是支付行数。 证据：两种 payment count 解释均可读。
- **local066 — 不正确**：题目限定 delivered；Gold SQL 未过滤 runner cancellation，且 exclusion 只按 order_id。逐行过滤取消单得到 Bacon=12、Mushrooms=11，Gold 为 Bacon=14、Mushrooms=12。 证据：执行成功不等于符合题意。
- **local073 — 不正确**：题目要求 5 个输出字段：row ID、order ID、customer ID、pizza name、final ingredients；Gold CSV 有 6 列，额外输出 pizza_id 和 order_time，且没有独立的 pizza_name 列（名称被嵌入 toppings 字符串）。 证据：输出列契约与题目不一致。
- **local096 — 不正确**：题目明确 Male 或 None 都是 non-female。Gold 把 2018 含 None gender 演员的影片计入 2/104，并只输出 6 个年份。 证据：2018 第二部入选片演员 Gender=None；“each year”也不应省略其他年份。
- **local098 — 不正确**：distinct actor 的 appearance years 若相邻差不超过 4，独立结果 28,698；Gold 32,585 大于 M_Cast 的 32,127 个 distinct actors。 证据：Gold 数值不可能是该定义下的 distinct actor 计数。
- **local100 — 不正确**：以 Shah Rukh Khan nm0451321 为中心，官方 M_Cast 共演图最短距离恰为 2、排除直接合作和本人，独立结果 25,698。 证据：Gold 15,911 需要题目未授权的子集过滤。
- **local193 — 部分正确/候选冲突**：local193_a 使用百分比单位 9.3796%、24.7588%，正确；local193_b 使用 0.0938、0.2476 的比例单位，与 percentage 列名冲突。 证据：同题同时提供一个正确和一个单位错误候选。
- **local194 — 不正确**：题目要求每位 actor 的前三部电影及 actor 维度；Gold 只有 3 行且没有 actor 列，只能表示全局三部电影。 证据：输出粒度/字段缺失。
- **local197 — 不正确**：题目要求 customer、month、difference；Gold 只有 month,max_diff。Gold SQL 的 LAG 也没有 ORDER BY 月份。 证据：输出契约和窗口语义均不完整。
- **local330 — 不正确**：题目要求每个 landing/exit page 的 unique session 数；Gold 只有 path2 一列且只有 /detail 一行，没有核心 count。 证据：输出契约缺少 metric。

## 逐题审阅

|序号|题号|数据库|答案工件|结论|独立方法与判断|官方结果证据|置信度|
|---:|---|---|---|---|---|---|---|
|1|local002|E_commerce|CSV×1|歧义|按 customer_unique_id/order/payment/item 粒度重算 Olist 聚合。 简单线性回归的因变量、自变量、缺失日期是否补零及对称窗口边界未由题目唯一确定。|local002.csv:1行/1列,首行=14334.62114；需先固定这些定义；官方值只能证明某一解释。|低|
|2|local003|E_commerce|Gold SQL、CSV×1|歧义|按 customer_unique_id/order/payment/item 粒度重算 Olist 聚合。 题目引用的 RFM definition document 不在本次官方隔离基线；分位数/桶边界和 Monetary 是否包含 freight 无法唯一确定。|SQL执行ok,shape=[11, 2];local003.csv=匹配；SQL 可执行且与 CSV 一致，但权威口径缺失。|低|
|3|local004|E_commerce|Gold SQL、CSV×2|部分正确/候选冲突|按 customer_unique_id/order/payment/item 粒度重算 Olist 聚合。 local004_b 的 AOV 保留两位小数且正确；local004_a 将 AOV 截为整数，精度不足。|SQL执行ok,shape=[3, 4];local004_a.csv=不完全匹配；local004_b.csv=匹配；shape=[3,4]；b 匹配，a 不匹配。|低|
|4|local007|Baseball|CSV×1|正确|按 player_id 汇总 batting 与日期差，再连 player。 独立重算未发现与题意冲突。|local007.csv:1行/1列,首行=4.923752748；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|5|local008|Baseball|Gold SQL、CSV×2|正确|按 player_id 汇总 batting 与日期差，再连 player。 独立重算未发现与题意冲突。 两个候选仅 Category 大小写不同；实体和数值一致。|SQL执行ok,shape=[4, 3];local008_a.csv=匹配；local008_b.csv=不完全匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|6|local009|Airlines|CSV×1|正确|解析机场 JSON 坐标，按 flights 连接计算距离和区间。 独立重算未发现与题意冲突。|local009.csv:1行/1列,首行=3484.15046；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|7|local010|Airlines|CSV×1|歧义|解析机场 JSON 坐标，按 flights 连接计算距离和区间。 有向城市对的最少区间计数为 6；无向合并为 3。题目未明确 pair 是否保留方向。|local010.csv:1行/1列,首行=6；Gold 只支持有向解释。|低|
|8|local015|California_Traffic_Collision|CSV×1|正确|按 collision case_id、party helmet 和 pcf category 重算。 独立重算未发现与题意冲突。|local015.csv:1行/2列,首行=16.67 / 0.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|9|local017|California_Traffic_Collision|Gold SQL、CSV×1|正确|按 collision case_id、party helmet 和 pcf category 重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[1, 1];local017.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|10|local018|California_Traffic_Collision|CSV×1|不正确|按 collision case_id、party helmet 和 pcf category 重算。 2021 speeding=411/1289=31.885182%，2011=1273/4063=31.331528%，实际是增加 0.553654 个百分点，不是 decrease。|local018.csv:1行/1列,首行=0.553654；Gold 值是增幅绝对值/反向差值。|中|
|11|local019|WWE|Gold SQL、CSV×1|正确|按题目实体粒度和官方 SQLite schema 独立重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[1, 2];local019.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|12|local026|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local026.csv:3行/2列,首行=501252 / P Parameswaran；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|13|local020|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local020.csv:1行/1列,首行=AC Gilchrist；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|14|local021|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local021.csv:1行/1列,首行=1130.516129；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|15|local022|IPL|Gold SQL、CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|SQL执行ok,shape=[7, 1];local022.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|16|local023|IPL|Gold SQL、CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|SQL执行ok,shape=[5, 2];local023.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|17|local024|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local024.csv:5行/2列,首行=England / 16.709258；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|18|local025|IPL|CSV×1|不正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 按 (match_id, innings_no, over_id) 汇总 batsman+extra，再取每场最高 over；568 个有 over 的 match_id 均值 19.426056338，match 表内为 19.428571，均不等于 Gold。|local025.csv:1行/1列,首行=19.02098951；独立聚合粒度和公式与题意一致。|中|
|19|local028|Brazilian_E_Commerce|CSV×2|正确|按 delivered/order/payment/item/customer 粒度检查连接基数。 独立重算未发现与题意冲突。 两个候选只是月份×年份透视方向不同；Delivered date 计数一致。|local028_a.csv:12行/4列,首行=01 / 0 / 283 / 6597；local028_b.csv:3行/13列,首行=2016 / 0 / 0 / 0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|20|local031|Brazilian_E_Commerce|CSV×1|正确|按 delivered/order/payment/item/customer 粒度检查连接基数。 独立重算未发现与题意冲突。|local031.csv:1行/1列,首行=205；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|21|local029|Brazilian_E_Commerce|Gold SQL、CSV×1|不正确|按 delivered/order/payment/item/customer 粒度检查连接基数。 题意要求 delivered distinct order_id 排名前三；Gold SQL JOIN payment 后 COUNT(o.order_id)，多支付行膨胀订单数。|SQL执行ok,shape=[3, 3];local029.csv=匹配；独立 distinct-order 排名首三为 15、9、7 单。|中|
|22|local030|Brazilian_E_Commerce|CSV×1|正确|按 delivered/order/payment/item/customer 粒度检查连接基数。 独立重算未发现与题意冲突。|local030.csv:1行/2列,首行=22.404 / 1.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|23|local032|Brazilian_E_Commerce|CSV×1|不正确|按 delivered/order/payment/item/customer 粒度检查连接基数。 review 是订单级记录；按 seller 计 5 星应 distinct review_id。Gold 1f50…=1096 是 item×review 连接行；distinct 最大为 cc419…=993。|local032.csv:4行/3列,首行=Seller with most unique customers :- / 6560211a19b47992c3666cc44a7e94c0 / 1790；卖家冠军和数值都会改变。|中|
|24|local034|Brazilian_E_Commerce|CSV×1|歧义|按 delivered/order/payment/item/customer 粒度检查连接基数。 Gold 1035.432432 对应所有订单、每类别每支付方式 COUNT(DISTINCT order_id) 的均值，不是字面 payment 行数。|local034.csv:1行/1列,首行=1035.432432；需明确 payment 粒度。|低|
|25|local037|Brazilian_E_Commerce|CSV×1|歧义|按 delivered/order/payment/item/customer 粒度检查连接基数。 Gold 7540/6874/5904 对应所有订单按类别×支付方式 COUNT(DISTINCT order_id)，不是支付行数。|local037.csv:3行/2列,首行=cama_mesa_banho / 7540；两种 payment count 解释均可读。|低|
|26|local035|Brazilian_E_Commerce|CSV×2|歧义|按 delivered/order/payment/item/customer 粒度检查连接基数。 官方表有异常经纬度；题目未指定距离公式、是否去重城市、是否过滤异常坐标，CSV 也不含距离。|local035_a.csv:1行/2列,首行=bom sucesso de itarare / bom retiro da esperanca；local035_b.csv:2行/1列,首行=bom sucesso de itarare；两个候选仅展示形状不同，不能证明唯一答案。|低|
|27|local038|Pagila|Gold SQL、CSV×1|正确|按 film/category/rental/city 连接计算时长。 独立重算未发现与题意冲突。|SQL执行ok,shape=[1, 1];local038.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|28|local039|Pagila|Gold SQL、CSV×1|正确|按 film/category/rental/city 连接计算时长。 独立重算未发现与题意冲突。|SQL执行ok,shape=[1, 1];local039.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|29|local040|modern_data|CSV×1|正确|按 trees/income 或 pizza/runner/order 粒度重算。 独立重算未发现与题意冲突。|local040.csv:3行/2列,首行=Staten Island / 94026.03572038967；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|30|local041|modern_data|CSV×1|正确|按 trees/income 或 pizza/runner/order 粒度重算。 独立重算未发现与题意冲突。|local041.csv:1行/1列,首行=78.15；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|31|local049|modern_data|CSV×1|正确|按 trees/income 或 pizza/runner/order 粒度重算。 独立重算未发现与题意冲突。|local049.csv:1行/1列,首行=59.67；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|32|local054|chinook|CSV×1|正确|按 invoice/invoice_item/track/album/artist 汇总。 独立重算未发现与题意冲突。|local054.csv:5行/2列,首行=Eduardo / 0.99；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|33|local055|chinook|CSV×1|正确|按 invoice/invoice_item/track/album/artist 汇总。 独立重算未发现与题意冲突。|local055.csv:1行/1列,首行=4.143333333；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|34|local198|chinook|CSV×1|正确|按 invoice/invoice_item/track/album/artist 汇总。 独立重算未发现与题意冲突。|local198.csv:1行/1列,首行=249.52999999999997；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|35|local056|SQLITE_SAKILA|CSV×1|正确|按 rental/payment/customer/film 粒度重算。 独立重算未发现与题意冲突。|local056.csv:1行/1列,首行=STEPHEN QUALLS；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|36|local058|education_business|Gold SQL、CSV×1|正确|按 fact/dimension、faculty rank、web order/rep 聚合。 独立重算未发现与题意冲突。|SQL执行ok,shape=[6, 2];local058.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|37|local059|education_business|CSV×1|正确|按 fact/dimension、faculty rank、web order/rep 聚合。 独立重算未发现与题意冲突。|local059.csv:3行/2列,首行=N & S / 397699.3333333333；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|38|local060|complex_oracle|CSV×1|正确|按 sales/costs/promo/channel/currency/customer 分粒度重算。 独立重算未发现与题意冲突。|local060.csv:4行/2列,首行=English Willow Cricket Bat / 3.60258848242393；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|39|local063|complex_oracle|CSV×1|正确|按 sales/costs/promo/channel/currency/customer 分粒度重算。 独立重算未发现与题意冲突。|local063.csv:1行/1列,首行=Pitching Machine and Batting Cage Combo；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|40|local061|complex_oracle|CSV×1|正确|按 sales/costs/promo/channel/currency/customer 分粒度重算。 独立重算未发现与题意冲突。|local061.csv:12行/2列,首行=1 / 4120.33；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|41|local050|complex_oracle|CSV×1|正确|按 sales/costs/promo/channel/currency/customer 分粒度重算。 独立重算未发现与题意冲突。|local050.csv:1行/1列,首行=2604.2362912087915；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|42|local062|complex_oracle|CSV×1|正确|按 sales/costs/promo/channel/currency/customer 分粒度重算。 独立重算未发现与题意冲突。|local062.csv:10行/4列,首行=1 / 29 / -98.44000000000017 / 91.64；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|43|local067|complex_oracle|CSV×1|正确|按 sales/costs/promo/channel/currency/customer 分粒度重算。 独立重算未发现与题意冲突。|local067.csv:10行/3列,首行=1 / 785.1500000000001 / 588.3599999999999；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|44|local070|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local070.csv:15行/2列,首行=2021-07-12 / Xiaoganzhan；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|45|local071|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local071.csv:3行/1列,首行=br；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|46|local072|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local072.csv:1行/1列,首行=0.2；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|47|local068|city_legislation|CSV×2|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。 两个候选只是百分比格式不同。|local068_a.csv:6行/6列,首行=2022 / April / 1437 / 2945；local068_b.csv:6行/6列,首行=2022 / April / 1437 / 2945；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|48|local073|modern_data|CSV×1|不正确|按 trees/income 或 pizza/runner/order 粒度重算。 题目要求 5 个输出字段：row ID、order ID、customer ID、pizza name、final ingredients；Gold CSV 有 6 列，额外输出 pizza_id 和 order_time，且没有独立的 pizza_name 列（名称被嵌入 toppings 字符串）。|local073.csv:14行/6列,首行=1 / 101 / 1 / 2021-01-01 18:05:02；输出列契约与题目不一致。|中|
|49|local066|modern_data|Gold SQL、CSV×1|不正确|按 trees/income 或 pizza/runner/order 粒度重算。 题目限定 delivered；Gold SQL 未过滤 runner cancellation，且 exclusion 只按 order_id。逐行过滤取消单得到 Bacon=12、Mushrooms=11，Gold 为 Bacon=14、Mushrooms=12。|SQL执行ok,shape=[12, 2];local066.csv=匹配；执行成功不等于符合题意。|中|
|50|local065|modern_data|Gold SQL、CSV×1|正确|按 trees/income 或 pizza/runner/order 粒度重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[1, 1];local065.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|51|local074|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local074.csv:2000行/4列,首行=1 / 2020-01-01 / 312 / 312；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|52|local064|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local064.csv:1行/1列,首行=363.74199999999996；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|53|local297|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local297.csv:1行/1列,首行=36.4；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|54|local298|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local298.csv:3行/2列,首行=2020-02-01 / 212579；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|55|local299|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local299.csv:3行/2列,首行=2020-02 / 284935.45376344083；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|56|local300|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local300.csv:4行/2列,首行=2020-01 / 356618；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|57|local075|bank_sales_trading|Gold SQL、CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[9, 6];local075.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|58|local077|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local077.csv:12行/8列,首行=09-2018 / Work Comes First Travelers / 8.26 / 7.61；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|59|local078|bank_sales_trading|Gold SQL、CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[20, 3];local078.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|60|local081|northwind|CSV×1|正确|按 orders/order_details/customer/employee 连接汇总。 独立重算未发现与题意冲突。|local081.csv:4行/3列,首行=Medium / 36 / 44.44444444444444；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|61|local085|northwind|CSV×1|正确|按 orders/order_details/customer/employee 连接汇总。 独立重算未发现与题意冲突。|local085.csv:3行/3列,首行=4 / 10 / 6.410256410256411；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|62|local096|DB_IMDB|CSV×1|不正确|按 Movie/M_Cast/Person 图关系、年份和 distinct PID 重算。 题目明确 Male 或 None 都是 non-female。Gold 把 2018 含 None gender 演员的影片计入 2/104，并只输出 6 个年份。|local096.csv:78行/3列,首行=1939 / 2 / 50.0；2018 第二部入选片演员 Gender=None；“each year”也不应省略其他年份。|中|
|63|local097|DB_IMDB|CSV×1|正确|按 Movie/M_Cast/Person 图关系、年份和 distinct PID 重算。 独立重算未发现与题意冲突。|local097.csv:1行/2列,首行=2008 / 1205；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|64|local098|DB_IMDB|CSV×1|不正确|按 Movie/M_Cast/Person 图关系、年份和 distinct PID 重算。 distinct actor 的 appearance years 若相邻差不超过 4，独立结果 28,698；Gold 32,585 大于 M_Cast 的 32,127 个 distinct actors。|local098.csv:1行/1列,首行=32585；Gold 数值不可能是该定义下的 distinct actor 计数。|中|
|65|local099|DB_IMDB|Gold SQL、CSV×1|正确|按 Movie/M_Cast/Person 图关系、年份和 distinct PID 重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[1, 1];local099.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|66|local100|DB_IMDB|CSV×1|不正确|按 Movie/M_Cast/Person 图关系、年份和 distinct PID 重算。 以 Shah Rukh Khan nm0451321 为中心，官方 M_Cast 共演图最短距离恰为 2、排除直接合作和本人，独立结果 25,698。|local100.csv:1行/1列,首行=15911；Gold 15,911 需要题目未授权的子集过滤。|中|
|67|local114|education_business|CSV×1|正确|按 fact/dimension、faculty rank、web order/rep 聚合。 独立重算未发现与题意冲突。|local114.csv:4行/5列,首行=Midwest / 9 / 3013486.51 / Charles Bidwell；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|68|local128|BowlingLeague|CSV×1|正确|按 bowler/game/tournament venue 连接筛选。 独立重算未发现与题意冲突。|local128.csv:11行/8列,首行=13 / Elizabeth / Hallmark / 10；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|69|local130|school_scheduling|CSV×1|正确|按 English subject、completion status、grade rank 重算。 独立重算未发现与题意冲突。|local130.csv:18行/2列,首行=Lum / Fifth；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|70|local131|EntertainmentAgency|Gold SQL、CSV×1|正确|按 preference_seq、style strength、customer/entertainer 匹配。 独立重算未发现与题意冲突。|SQL执行ok,shape=[20, 4];local131.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|71|local133|EntertainmentAgency|CSV×1|正确|按 preference_seq、style strength、customer/entertainer 匹配。 独立重算未发现与题意冲突。|local133.csv:25行/2列,首行=40's Ballroom Music / 0.2400000000000002；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|72|local132|EntertainmentAgency|CSV×1|正确|按 preference_seq、style strength、customer/entertainer 匹配。 独立重算未发现与题意冲突。|local132.csv:6行/2列,首行=Carol Peacock Trio / Patterson；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|73|local141|AdventureWorks|CSV×1|正确|按 salesperson/year/orderdetail 与 quota 连接。 独立重算未发现与题意冲突。|local141.csv:58行/6列,首行=274 / 2011 / 32567.9155 / 2011；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|74|local152|imdb_movies|CSV×1|正确|按 movies/ratings/genre/role/director 去重和排名。 独立重算未发现与题意冲突。|local152.csv:9行/10列,首行=nm1777967 / A.L. Vijay / 5 / 177.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|75|local230|imdb_movies|CSV×1|正确|按 movies/ratings/genre/role/director 去重和排名。 独立重算未发现与题意冲突。|local230.csv:3行/2列,首行=James Mangold / 4；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|76|local156|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local156.csv:20行/5列,首行=2018 / Africa / 7690.71 / 3；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|77|local157|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local157.csv:20行/5列,首行=BTC / 01-08-2021 / 80330.0 / 44650.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|78|local163|education_business|Gold SQL、CSV×1|正确|按 fact/dimension、faculty rank、web order/rep 聚合。 独立重算未发现与题意冲突。|SQL执行ok,shape=[4, 4];local163.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|79|local168|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local168.csv:1行/1列,首行=101300；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|80|local169|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local169.csv:20行/2列,首行=1 / 0.96974956607984；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|81|local171|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local171.csv:8行/2列,首行=31 / 4；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|82|local167|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local167.csv:1行/2列,首行=CA / 43；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|83|local170|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local170.csv:25行/1列,首行=AR；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|84|local193|SQLITE_SAKILA|CSV×2|部分正确/候选冲突|按 rental/payment/customer/film 粒度重算。 local193_a 使用百分比单位 9.3796%、24.7588%，正确；local193_b 使用 0.0938、0.2476 的比例单位，与 percentage 列名冲突。|local193_a.csv:1行/3列,首行=9.37964298027943 / 24.7587962595115 / 112.54843071786313；local193_b.csv:1行/3列,首行=0.0937964298027943 / 0.247587962595115 / 112.54843071786313；同题同时提供一个正确和一个单位错误候选。|低|
|85|local194|SQLITE_SAKILA|CSV×1|不正确|按 rental/payment/customer/film 粒度重算。 题目要求每位 actor 的前三部电影及 actor 维度；Gold 只有 3 行且没有 actor 列，只能表示全局三部电影。|local194.csv:3行/2列,首行=YENTL IDAHO / 135.77；输出粒度/字段缺失。|中|
|86|local195|SQLITE_SAKILA|CSV×1|正确|按 rental/payment/customer/film 粒度重算。 独立重算未发现与题意冲突。|local195.csv:1行/1列,首行=99.33；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|87|local196|SQLITE_SAKILA|CSV×1|正确|按 rental/payment/customer/film 粒度重算。 独立重算未发现与题意冲突。|local196.csv:5行/3列,首行=PG-13 / 115.24 / 26.38；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|88|local197|SQLITE_SAKILA|Gold SQL、CSV×1|不正确|按 rental/payment/customer/film 粒度重算。 题目要求 customer、month、difference；Gold 只有 month,max_diff。Gold SQL 的 LAG 也没有 ORDER BY 月份。|SQL执行ok,shape=[1, 2];local197.csv=匹配；输出契约和窗口语义均不完整。|中|
|89|local199|SQLITE_SAKILA|Gold SQL、CSV×1|正确|按 rental/payment/customer/film 粒度重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[2, 4];local199.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|90|local201|modern_data|CSV×1|正确|按 trees/income 或 pizza/runner/order 粒度重算。 独立重算未发现与题意冲突。|local201.csv:10行/2列,首行=raad / 3；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|91|local202|city_legislation|CSV×1|正确|按 city insert_date 和 legislator term cohort 重算。 独立重算未发现与题意冲突。|local202.csv:1行/1列,首行=5；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|92|local209|delivery_center|CSV×1|正确|按题目实体粒度和官方 SQLite schema 独立重算。 独立重算未发现与题意冲突。|local209.csv:1行/1列,首行=0.981009183996622；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|93|local210|delivery_center|Gold SQL、CSV×1|正确|按题目实体粒度和官方 SQLite schema 独立重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[21, 1];local210.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|94|local212|delivery_center|CSV×1|正确|按题目实体粒度和官方 SQLite schema 独立重算。 独立重算未发现与题意冲突。|local212.csv:5行/1列,首行=25651        ；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|95|local218|EU_soccer|CSV×1|正确|按 Match home/away goals 聚合 wins/points。 独立重算未发现与题意冲突。|local218.csv:1行/1列,首行=48；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|96|local219|EU_soccer|Gold SQL、CSV×1|正确|按 Match home/away goals 聚合 wins/points。 独立重算未发现与题意冲突。|SQL执行ok,shape=[11, 2];local219.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|97|local221|EU_soccer|CSV×1|正确|按 Match home/away goals 聚合 wins/points。 独立重算未发现与题意冲突。 完整 CSV 为 10 行，满足 top10。|local221.csv:10行/1列,首行=FC Barcelona；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|98|local220|EU_soccer|CSV×2|正确|按 Match home/away goals 聚合 wins/points。 独立重算未发现与题意冲突。 两个候选是一列两行/两列一行；Marcelo/Ricardo 结论一致。|local220_a.csv:2行/1列,首行=Marcelo；local220_b.csv:1行/2列,首行=Marcelo / Ricardo；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|99|local228|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local228.csv:27行/5列,首行=1 / 100 / 616 / 102；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|100|local229|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local229.csv:577行/6列,首行=980992 / 110 / 8 / 129；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|101|local244|music|CSV×1|正确|按 track length 分类和 invoice line 收入汇总. 独立重算未发现与题意冲突。|local244.csv:3行/4列,首行=47.33793510086592 / 88.11588333333333 / Long / 41.79；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|102|local253|education_business|CSV×1|正确|按 fact/dimension、faculty rank、web order/rep 聚合。 独立重算未发现与题意冲突。|local253.csv:20行/4列,首行=Hyderabad / Qwerty Concepts / 5081882.0 / 5081882.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|103|local258|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local258.csv:286行/6列,首行=194 / SL Malinga / 159 / 6.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|104|local259|IPL|CSV×1|正确|按 innings_no、match_id、over_id 聚合球、extra、wicket。 独立重算未发现与题意冲突。|local259.csv:247行/18列,首行=1 / SC Ganguly / Captain / Left-hand bat；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|105|local262|stacking|CSV×1|正确|按 problem/model/version/step 比较 Stack 与非 Stack。 独立重算未发现与题意冲突。|local262.csv:7行/1列,首行=Critical Heat Flux；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|106|local263|stacking|CSV×1|正确|按 problem/model/version/step 比较 Stack 与非 Stack。 独立重算未发现与题意冲突。|local263.csv:2行/3列,首行=soft / regression / 108；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|107|local264|stacking|CSV×1|正确|按 problem/model/version/step 比较 Stack 与非 Stack。 独立重算未发现与题意冲突。|local264.csv:1行/2列,首行=regression / 639；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|108|local269|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local269.csv:1行/1列,首行=530.67；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|109|local270|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local270.csv:3行/2列,首行=Pallet of L / Bottle 500cl；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|110|local272|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local272.csv:4行/4列,首行=4280 / C / 1 / 36.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|111|local273|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local273.csv:6行/2列,首行=Der Helle Kumpel / 76.92307692307692；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|112|local274|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local274.csv:2行/2列,首行=Hoppy Crude Oil / 36.66666666666666；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|113|local275|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local275.csv:4行/1列,首行=Hazy Pink Cloud；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|114|local277|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local277.csv:1行/1列,首行=39.39；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|115|local279|oracle_sql|CSV×1|正确|按 packaging 递归、inventory FIFO、monthly sales/budget 重算。 独立重算未发现与题意冲突。|local279.csv:2行/3列,首行=6520 / 2019-12-01 / 0.0；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|116|local283|EU_soccer|CSV×1|正确|按 Match home/away goals 聚合 wins/points。 独立重算未发现与题意冲突。 完整 CSV 为 8 行，摘要曾截断；覆盖官方 season-league 组合。|local283.csv:8行/6列,首行=2013/2014 / Juventus / Italy Serie A / Italy；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|117|local284|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local284.csv:1行/4列,首行=9.426693227091633 / 187 / 29 / 35；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|118|local285|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local285.csv:24行/12列,首行=2020 / 1011010504 / Capsicum / 7.43；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|119|local286|electronic_sales|CSV×1|正确|按 seller/order/item/review/category 检查复制。 独立重算未发现与题意冲突。|local286.csv:237行/7列,首行=febab0275244b9a49a623f0bd613ca2f / 129 / 56.3753488372093 / 7272.42；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|120|local301|bank_sales_trading|Gold SQL、CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[3, 5];local301.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|121|local302|bank_sales_trading|CSV×1|正确|按 customer/day/month、bitcoin volume 和 weekly sales 窗口重算。 独立重算未发现与题意冲突。|local302.csv:1行/2列,首行=demographic / -2.008662；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|122|local329|log|CSV×1|正确|按 session/event timestamp/path 做序列和年龄分组。 独立重算未发现与题意冲突。|local329.csv:1行/1列,首行=1；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|123|local330|log|CSV×1|不正确|按 session/event timestamp/path 做序列和年龄分组。 题目要求每个 landing/exit page 的 unique session 数；Gold 只有 path2 一列且只有 /detail 一行，没有核心 count。|local330.csv:1行/1列,首行=/detail；输出契约缺少 metric。|中|
|124|local331|log|CSV×1|正确|按 session/event timestamp/path 做序列和年龄分组。 独立重算未发现与题意冲突。|local331.csv:3行/2列,首行=/detail / 33；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|125|local358|log|CSV×1|正确|按 session/event timestamp/path 做序列和年龄分组。 独立重算未发现与题意冲突。|local358.csv:5行/2列,首行=20s / 16；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|126|local360|log|CSV×1|正确|按 session/event timestamp/path 做序列和年龄分组。 独立重算未发现与题意冲突。|local360.csv:2行/3列,首行=36dd0df7 / /search_list/ / Pref-with-Job；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|127|local344|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local344.csv:4行/2列,首行=P / 36767；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|128|local336|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local336.csv:4行/2列,首行=P / 3075；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|129|local335|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local335.csv:5行/1列,首行=Williams；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|130|local309|f1|Gold SQL、CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|SQL执行ok,shape=[75, 3];local309.csv=匹配；官方 CSV/Gold SQL 结果与独立检查一致。|高|
|131|local310|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local310.csv:3行/1列,首行=1966；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|132|local311|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local311.csv:3行/3列,首行=2023 / Red Bull / 1320；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|133|local354|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local354.csv:3行/1列,首行=501；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|134|local355|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local355.csv:1行/2列,首行=7.59420289855072 / 7.85507246376812；官方 CSV/Gold SQL 结果与独立检查一致。|中|
|135|local356|f1|CSV×1|正确|按 race/driver/constructor/lap/overtake 事件粒度重算。 独立重算未发现与题意冲突。|local356.csv:21行/1列,首行=Lewis Hamilton；官方 CSV/Gold SQL 结果与独立检查一致。|中|

## 可复核的关键计算记录

- Airlines/local009：Abakan–Grozny 球面距离 3484.150460 km，匹配官方 3484.15046。
- Airlines/local010：有向城市对最少区间计数 6；无向合并为 3。
- Baseball/local007：年/月/日绝对差按两位小数处理，均值 4.9237527475，匹配官方。
- Baseball/local008：最高 games/runs/hits/home-runs 分别为 Peter Edward/Rickey Nelson Henley/Peter Edward/Barry Lamar。
- California/local015：helmet used=3/18=16.67%，not used=0/1=0%。
- California/local018：speeding 份额 31.331528%→31.885182%，实际 +0.553654 pp。
- IPL/local021：加入 innings_no 后 124 名合格 striker 的生涯总 runs 均值 1130.516129。
- IPL/local025：逐 over bat+extra 均值 19.426056338，与 Gold 19.02098951 不同。
- Brazilian/local029：distinct-order 排名与 Gold payment-join COUNT 排名不同。
- Brazilian/local032：5 星行数冠军 1f50…=1096；distinct review_id 冠军 cc419…=993。
- modern_data/local066：逐行过滤取消单 Bacon=12、Mushrooms=11；Gold 未过滤 delivered。
- DB_IMDB/local096：Gold 将 None gender 电影计为 exclusively female，与题目规则冲突。
- DB_IMDB/local098：distinct M_Cast actors=32127；独立无四年空档计数 28698；Gold=32585 不可能。
- DB_IMDB/local100：完整共演图距离恰为 2 的 actor 数 25698；Gold=15911 需未声明过滤。

## 残余风险

- 多个题目的自然语言没有固定 payment、city pair、percentage、top/average 的业务粒度；已标记歧义，没有伪装成唯一真值。
- 多候选 CSV 的发布规则仍需明确是“任一候选通过”还是“全部候选均为规范答案”。
- Gold SQL 可执行且与 CSV 一致，只能证明内部一致，不能自动证明符合题意；本报告对 24 道 SQL 题另做了语义审查。
