# 118 份错题卷宗：ADR-0007 三维重标

来源：`evaluations/spider2/wrong118-dossiers.jsonl`。按源文件顺序逐题列出；每条引用给出卷宗行号和 JSON pointer。

## 使用边界

- 这是离线卷宗归因，不重新执行 SQL；标准口径、Gold SQL、最终 SQL、Spec 与决定记录是各自独立的证据。
- 18 节点按“总体→度量→分组→选取→输出”选最早可证差异，不把结果行数/数值变化直接当作节点证据。
- 未声明指卷宗可见声明中没有该细项；记录缺失不能证明运行时从未声明。调用参数没有成功返回时不认定已生效。
- 五种可见性均描述错误声明；节点正确声明而 SQL 写错时，如不能适用五类，保留 null 并记 taxonomy_gap。
- 仅结果不同但标准细则不足、最终 SQL 与导出候选可能错配等，保留三项 null 并记 insufficient_evidence。它不是“树外”、不是证明 Gold 错，也不是已完成定性。
- 校验程序检查覆盖、枚举、来源 run、引用路径和逐字引文，不构成语义正确性认证。

已复核记录 **118** 条，唯一题号 **118** 个；逐字校验通过 **584** 条引文。
能够定位节点与错误层：**74** 题；证据不足待定：**44** 题；已定位但可见性定义缺口：**13** 题。

## 分类分布

### 分叉节点

| 标签 | 题数 |
|---|---:|
| population.entity | 4 |
| measure.formula | 22 |
| 证据不足待定 | 44 |
| output | 17 |
| grouping | 3 |
| population.conditions | 7 |
| population.eligibility | 3 |
| selection | 8 |
| measure.countGrain | 1 |
| population.time | 5 |
| selection.ties | 1 |
| measure.denominator | 1 |
| population.source | 2 |

### 错误层

| 标签 | 题数 |
|---|---:|
| 口径错 | 60 |
| 证据不足待定 | 44 |
| 实现错 | 8 |
| 标准答案有问题 | 6 |

### 可见性

| 标签 | 题数 |
|---|---:|
| 未声明 | 25 |
| 假定错 | 23 |
| 证据不足待定 | 44 |
| 待定后决定错 | 7 |
| 定义缺口（未强行归类） | 13 |
| 题面引用错 | 6 |

## 待补证据与定义缺口

- 证据不足：local007、local010、local018、local024、local028、local031、local034、local050、local056、local061、local067、local070、local097、local098、local099、local100、local114、local167、local169、local170、local195、local196、local209、local212、local220、local244、local259、local264、local269、local270、local272、local275、local284、local285、local286、local297、local299、local311、local331、local336、local354、local356、local358、local360。
- 可见性定义缺口：local026、local029、local063、local065、local066、local096、local131、local229、local230、local253、local277、local302、local330。

## 逐题标注

### 1. local002

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：1。
- 分叉节点：**population.entity**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：用2017-01-01至2018-08-29每日玩具销售拟合简单线性回归，预测2018-12-05至08的5日对称均值并将四个均值求和。
- SQL 实际：统计sqlite_master中名称匹配daily/sales/toy/forecast/regression的表数量，完全没有预测销售。
- 最早分叉依据：在度量前统计实体已从每日销售换成数据库表；不是回归算法或窗口细节，也不能用不可做说明给Gold判错。
- 错误层依据：用元数据可行性计数替代指定业务指标；无标准一致声明可判实现违约。
- 可见性依据：完整检查spec_info、空decisions与disclosures；没有销售总体或指标声明，审核gate不适用不是该业务节点n/a。
- 其他差异：["population.source", "measure.formula", "measure.window", "output"]

**standard 原文**（卷宗第 1 行，`/instruction`）：

```text
Can you calculate the 5-day symmetric moving average of predicted toy sales for December 5 to 8, 2018, using daily sales data from January 1, 2017, to August 29, 2018, with a simple linear regression model? Finally provide the sum of those four 5-day moving averages?
```
题面预测任务

**sql 原文**（卷宗第 1 行，`/final_sql`）：

```text
SELECT COUNT(*) AS matched_tables
FROM sqlite_master
```
实际统计的是表

**spec 原文**（卷宗第 1 行，`/our_spec_and_decisions/spec_info/answerContract`）：

```text
{}
```
空契约，结合全部Spec检索

**spec 原文**（卷宗第 1 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无声明/处置调用

**证据限制**：
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。

### 2. local003

- 运行：`unresolved-hypothesis-block-control-10-001`；卷宗行：2。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：Gold逐段：delivered订单按customer_unique_id；R为MAX购买时间，F为订单COUNT，M为商品SUM(price)，各用NTILE(5)降序。先算客户total_spent/total_orders，再在RFM_Bucket内AVG。
- SQL 实际：delivered与unique_id相同；金额用支付SUM(payment_value)，无支付补0；用CUME_DIST阈值代替NTILE；分段CASE基本对应但修正拼写；最后SUM(spend)/SUM(freq)并ROUND2。
- 最早分叉依据：实体、delivered、MAX最新购买与订单频数无已证分叉；首次金额运算price→payment是同一订单金额成分差，归formula不归source。客户均值→订单加权比率也属formula，评分桶差属grouping。
- 错误层依据：实际spec_info H2/H4已提出付款金额与段内比率，SQL贯彻另一业务读法；不是声明正确后实现偏离。缺RFM原文不证明Gold错。
- 可见性依据：完整检查4条快照假设及3个decisions：H2直接模型推断支付金额。仅有备选decisionProposals，没有后续select；不称已决定，归假定错。
- 其他差异：["grouping", "output"]

**standard 原文**（卷宗第 2 行，`/standard_semantics/gold_sql`）：

```text
SUM(price) AS total_spent
```
Gold金额来源

**standard 原文**（卷宗第 2 行，`/standard_semantics/gold_sql`）：

```text
AVG(total_spent / total_orders) AS avg_sales_per_customer
```
Gold客户比率再平均

**sql 原文**（卷宗第 2 行，`/final_sql`）：

```text
SELECT order_id, SUM(payment_value) AS pv
```
实际付款金额

**sql 原文**（卷宗第 2 行，`/final_sql`）：

```text
ROUND(SUM(spend) / SUM(freq), 2) AS avg_sales_per_order
```
实际段内加权比率

**spec 原文**（卷宗第 2 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
Total spend per order = SUM(order_payments.payment_value).
```
实际快照金额假设

**spec 原文**（卷宗第 2 行，`/our_spec_and_decisions/spec_info/hypotheses/3/statement`）：

```text
Output = one row per RFM segment, avg sales per order = SUM(spend)/SUM(orders).
```
实际快照段内比率假设

**证据限制**：
- RFM定义文档原文未收入卷宗；不能以其缺失否定Gold金额或评分规则。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 3. local007

- 运行：`spider2-gold49-deepseek-rerun-002`；卷宗行：3。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：逐球员绝对年差+绝对月差/12+绝对日差/365，每项ROUND2后平均，最后返回浮点。
- SQL 实际：按日期年月日分量直接相减取绝对值，各项ROUND2再AVG，最终额外ROUND2，并过滤非空日期。
- 最早分叉依据：可见公式与标准一致；决定参数声称全部18846球员日期非空但无原观测。最终ROUND2不能解释Gold 4.923752748与Pred 4.87全部差异，主分叉待证，仅记output风险。
- 错误层依据：缺GoldSQL及日期差算法/最终浮点精度细则，无法区分日期差实现、物理解析、数据或标准原因，不强归四层。
- 可见性依据：完整检查空spec_info与两次begin/revise：分量差/规范化差候选及选择A、日期格式/空值假设均可见，但尚不能证明是错误节点。
- 其他差异：["output"]

**standard 原文**（卷宗第 3 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["absolute year difference + absolute month difference / 12 + absolute day difference / 365", "round components to 2 decimals", "average players"]
```
标准分量及平均顺序

**sql 原文**（卷宗第 3 行，`/final_sql`）：

```text
SELECT ROUND(AVG(
         ROUND(ABS(CAST(substr(final_game,1,4) AS INTEGER) - CAST(substr(debut,1,4) AS INTEGER)), 2)
       + ROUND(ABS(CAST(substr(final_game,6,2) AS INTEGER) - CAST(substr(debut,6,2) AS INTEGER)) / 12.0, 2)
       + ROUND(ABS(CAST(substr(final_game,9,2) AS INTEGER) - CAST(substr(debut,9,2) AS INTEGER)) / 365.0, 2)
       ), 2) AS avg_single_career_span_years
FROM player
WHERE debut IS NOT NULL AND final_game IS NOT NULL;
```
实际全部运算

**spec 原文**（卷宗第 3 行，`/our_spec_and_decisions/decisions/1/args/spec/metric/value/expression`）：

```text
AVG( ROUND(ABS(year(final_game)-year(debut)),2) + ROUND(ABS(month(final_game)-month(debut))/12.0,2) + ROUND(ABS(day(final_game)-day(debut))/365.0,2) )
```
提议公式与实际一致

**spec 原文**（卷宗第 3 行，`/our_spec_and_decisions/decisions/1/args/hypotheses/0/statement`）：

```text
All 18846 players in the player table have non-NULL debut and final_game, so restricting to non-NULL dates excludes no rows and leaves the denominator at the full player population.
```
非空过滤无影响只是提议观测声明

**result 原文**（卷宗第 3 行，`/gold_results/0/csv_info/head/0/0`）：

```text
4.923752748
```
Gold标量

**result 原文**（卷宗第 3 行，`/predicted_result/csv_info/head/0/0`）：

```text
4.87
```
Pred标量

**证据限制**：
- 需GoldSQL、日期差规范化算法、实际日期格式/空值观测及最终浮点精度规则。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。
- spec_info={} 表示快照记录缺失，不证明运行时从未声明。

### 4. local008

- 运行：`adr0007-fields-dev10-deepseek-flash-20261010`；卷宗行：4。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`high`。
- 标准：按player_id累计所有batting行G/R/H/HR，再各指标选最高球员，输出类别、given name与值。
- SQL 实际：直接对batting单行G/R/H/HR取最大，不做球员累计；各指标RANK=1保留并列。
- 最早分叉依据：实体仍球员、来源仍batting+player、无条件变化证据；首分叉是遗漏球员内SUM而比较单行，不是纯计数对象错，归formula。
- 错误层依据：候选明确比较单行与生涯累计，后续value/rationale决定单行，SQL一致；不同业务读法而非实现违背正确声明。
- 可见性依据：完整检查11个decisions：起始metric.countGrain.open两候选，第8号decision明确“裁定采用按行口径”；虽挂旧countGrain字段实际是formula。参数不代表成功生效。
- 其他差异：["output"]

**standard 原文**（卷宗第 4 行，`/standard_semantics/gold_sql`）：

```text
SUM(b.g) AS games_played
```
Gold先球员SUM

**sql 原文**（卷宗第 4 行，`/final_sql`）：

```text
SELECT 'games played' AS statistic, player_id, CAST(g AS INTEGER) AS value FROM batting
```
实际单行来源

**spec 原文**（卷宗第 4 行，`/our_spec_and_decisions/decisions/0/args/fields/metric.countGrain/open`）：

```text
["按行：直接取 batting 表中 g/r/h/hr 各自的最大单行值（球员-年度-stint-球队 行）", "按球员：先对每个 player_id 求和 g/r/h/hr（生涯累计），再取各指标最大值"]
```
起始候选

**spec 原文**（卷宗第 4 行，`/our_spec_and_decisions/decisions/8/args/fields/metric.countGrain/value`）：

```text
按行：直接取 batting 表中 g/r/h/hr 各自的最大单行值（球员-年度-stint-球队 行）
```
后续所选单行

**spec 原文**（卷宗第 4 行，`/our_spec_and_decisions/decisions/8/args/fields/metric.countGrain/rationale`）：

```text
题面只有 “the highest value of games played, runs, hits, and home runs”，逐词检验：没有任何 career/total/cumulative/overall/season 字样；’the highest value of X’ 的最字面解释是该指标在数据中的最高值，即取现有记录的最值，不引入题面未声明的跨行求和。范围词为四个指标并列（每个指标各自取最高），而非『球员生涯累计』。探针结果：按行口径输出 G=165、R=192、H=262、HR=73（各指标无并列）；按球员生涯累计口径输出 G=3562、R=2295、H=4256、HR=762。两者不同，裁定采用按行口径，与顾问弱倾向（0.36 vs 0.21）一致。
```
后续决定理由

**证据限制**：
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 5. local009

- 运行：`round11-paired-040-control-002`；卷宗行：5。
- 分叉节点：**output**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：只返回阿巴坎作为起点或终点的最长路线距离，单位公里，单个标量列。
- SQL 实际：以ABA双向相连航点计算球面距离取最高，返回departure_city、destination_city和ROUND1 distance_km三列。
- 最早分叉依据：ABA双向筛选符合总体意图；不能无GoldSQL猜距离公式、坐标或球半径错。已证差异为标量距离多两列，归output。
- 错误层依据：交付采用额外路线诊断列，无标准一致Spec输出约束可判实现错。
- 可见性依据：完整检查版本1所有空约束/假设/歧义/契约、空decisions与审核disclosures，没有输出列声明。

**standard 原文**（卷宗第 5 行，`/standard_semantics/facets/output/alternatives/0`）：

```text
{"rowMode": "scalar", "rowCount": 1, "columnCount": 1, "columnNames": ["output"], "evidenceRefs": ["Q1"]}
```
标准单行单列契约

**sql 原文**（卷宗第 5 行，`/final_sql`）：

```text
SELECT aba.airport_code AS departure_city,
       c.airport_code AS destination_city,
```
实际三列投影

**spec 原文**（卷宗第 5 行，`/our_spec_and_decisions/spec_info/answerContract`）：

```text
{}
```
空契约结合完整Spec检查

**spec 原文**（卷宗第 5 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无输出声明

**证据限制**：
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。

### 6. local010

- 运行：`unresolved-hypothesis-block-control-10-001`；卷宗行：6。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：城市无序对按其间所有路线平均距离分七档，统计各档城市对数并返回最小档数量。
- SQL 实际：解析city英文名，经flights连接机场坐标；按无序城市对AVG航班距离，只统计有数据的档，取MIN数量。
- 最早分叉依据：对称化、七档及最终MIN符合题面；航班权重与独特路线权重、空档纳入、JSON/坐标解析细则缺失，不凭结果差猜上游。
- 错误层依据：不能证明某一明确SQL差异相对标准必错；缺GoldSQL及业务文档原文，四层待证。
- 可见性依据：完整检查3条快照假设及3个decisions：无序城市键、全部航班与分档可见，端点/状态/城市标签备选无select记录，不能臆称待定后决定错。

**standard 原文**（卷宗第 6 行，`/instruction`）：

```text
Distribute all the unique city pairs into the distance ranges 0, 1000, 2000, 3000, 4000, 5000, and 6000+, based on their average distance of all routes between them. Then how many pairs are there in the distance range with the fewest unique city paires?
```
分档与路线平均要求

**sql 原文**（卷宗第 6 行，`/final_sql`）：

```text
WITH ap AS (
  SELECT airport_code,
         substr(city, instr(city, '"en": "') + 7,
                instr(substr(city, instr(city, '"en": "') + 7), '"') - 1) AS city_name,
         CAST(substr(coordinates, 2, instr(coordinates, ',') - 2) AS REAL) AS lon,
         CAST(substr(coordinates, instr(coordinates, ',') + 1,
                     length(coordinates) - instr(coordinates, ',') - 1) AS REAL) AS lat
  FROM airports_data
),
flight_dist AS (
  SELECT
    CASE WHEN dep.city_name < arr.city_name THEN dep.city_name ELSE arr.city_name END AS city1,
    CASE WHEN dep.city_name < arr.city_name THEN arr.city_name ELSE dep.city_name END AS city2,
    2 * 6371 * asin(sqrt(
        power(sin(radians(arr.lat - dep.lat) / 2), 2)
      + cos(radians(dep.lat)) * cos(radians(arr.lat))
        * power(sin(radians(arr.lon - dep.lon) / 2), 2)
    )) AS distance_km
  FROM flights f
  JOIN ap dep ON dep.airport_code = f.departure_airport
  JOIN ap arr ON arr.airport_code = f.arrival_airport
),
pair_avg AS (
  SELECT city1, city2, AVG(distance_km) AS avg_distance
  FROM flight_dist
  GROUP BY city1, city2
),
bucketed AS (
  SELECT
    CASE
      WHEN avg_distance < 1000 THEN '0-1000'
      WHEN avg_distance < 2000 THEN '1000-2000'
      WHEN avg_distance < 3000 THEN '2000-3000'
      WHEN avg_distance < 4000 THEN '3000-4000'
      WHEN avg_distance < 5000 THEN '4000-5000'
      WHEN avg_distance < 6000 THEN '5000-6000'
      ELSE '6000+'
    END AS distance_range,
    COUNT(*) AS n_pairs
  FROM pair_avg
  GROUP BY distance_range
)
SELECT MIN(n_pairs) AS n_pairs
FROM bucketed
```
实际全部数据流

**spec 原文**（卷宗第 6 行，`/our_spec_and_decisions/decisions/2/args/spec/metric`）：

```text
每对城市对其间所有航班的平均距离（Haversine 大圆距离，单位 km，地球半径 6371 km）；输出为该平均距离落入各距离区间的城市对数量
```
实际提议航班平均

**spec 原文**（卷宗第 6 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
城市身份取 airports_data.city 的英文名（jsonb 中 "en" 字段）作为展示与排序用的城市名，城市对按字典序无序化（city1 < city2）。
```
快照城市身份假设

**证据限制**：
- 需GoldSQL、路线/航班权重定义、空档是否计0、city原始JSON/坐标样本及函数结果。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 7. local015

- 运行：`local015-system0904-deepseek-direct-001`；卷宗行：7。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：按佩戴/未佩戴头盔组，以摩托车死亡人数总和除以组内碰撞总数乘100，最终两个百分比列。
- SQL 实际：每case取MAX(party_number_killed)，helmet_used优先于helmet_not作互斥分类，再SUM最大值/COUNT碰撞；输出分组四列。
- 最早分叉依据：摩托车筛选与装备字段对应总体，未证更早映射错。死亡总数应累加而不是每事故party取MAX；最早formula，混合头盔事故被互斥归组另属grouping。
- 错误层依据：没有正确总死亡数声明，SQL采用MAX简化及互斥组业务读法，不能判为正确声明后的实现违约。
- 可见性依据：完整检查唯一HC“fatalities in collisions”没有MAX/SUM细节，其余Spec与decisions空；审核disclosures无公式声明，首节点未声明。
- 其他差异：["grouping", "output"]

**standard 原文**（卷宗第 7 行，`/instruction`）：

```text
dividing the total number of motorcyclist fatalities by the total number of collisions involving that group
```
题面总死亡人数

**sql 原文**（卷宗第 7 行，`/final_sql`）：

```text
MAX(party_number_killed) AS party_killed
```
实际每事故MAX

**spec 原文**（卷宗第 7 行，`/our_spec_and_decisions/spec_info/hardConstraints/0/statement`）：

```text
fatalities in collisions
```
唯一约束不定义聚合

**spec 原文**（卷宗第 7 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无公式修订

**证据限制**：
- 无party/case全集，不能量化MAX低估或混合头盔事故数；不声称数据重复。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。

### 8. local017

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：8。
- 分叉节点：**grouping**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：Gold按年份与pcf_violation_category计事故，年度份额ROUND1后top2，选组合只出现一次的年份，输出Year。
- SQL 实际：按primary_collision_factor大类分组，按原始计数top2，与出现最多的有序组合比，输出年份及两原因。
- 最早分叉依据：同collisions来源、事件日期与总体，无上游筛选差异；首分叉是原因维度从违反具体类别换成因果大类。字段是分组键而非金额或新总体来源，归grouping。
- 错误层依据：快照H1定义原因取primary_collision_factor，SQL贯彻；不是Spec正确SQL错。
- 可见性依据：完整检查H1/H2/H4与3个decisions，H1依据字段存在作模型推断，无题面原文支持具体列，归假定错，不因挂time路径误归时间。
- 其他差异：["selection", "output"]

**standard 原文**（卷宗第 8 行，`/standard_semantics/gold_sql`）：

```text
pcf_violation_category AS Category
```
Gold具体分组键

**sql 原文**（卷宗第 8 行，`/final_sql`）：

```text
primary_collision_factor AS cause
```
实际大类键

**spec 原文**（卷宗第 8 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
按 collision_date 年份分组，因果取 primary_collision_factor
```
快照映射假设

**spec 原文**（卷宗第 8 行，`/our_spec_and_decisions/spec_info/hypotheses/0/basis`）：

```text
collisions 记录含 collision_date 与 primary_collision_factor
```
只是字段存在依据

**证据限制**：
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 9. local018

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：9。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：选2021最常见pcf_violation_category，计算2011年度份额减2021年度份额，百分点。
- SQL 实际：硬编码speeding，同样2011减2021并ROUND2，Pred -0.55，Gold +0.553654。
- 最早分叉依据：减法方向与标准相同；speeding是否2021第一名无探针/GoldSQL证明。不从符号差断言方向反转或Gold错；output精度仅次级风险。
- 错误层依据：需Gold类别选择与差值规则解释符号；没有已证主分叉，不强归四层。
- 可见性依据：完整检查spec_info={}、decisions=[]、disclosures=[]；是记录缺失，不能给未知错误节点标未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 9 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
share in 2011 minus share in 2021 for the selected 2021 violation category
```
明确2011减2021

**sql 原文**（卷宗第 9 行，`/final_sql`）：

```text
SELECT ROUND(
  100.0 * SUM(CASE WHEN yr = '2011' AND pcf_violation_category = 'speeding' THEN 1 ELSE 0 END) / SUM(CASE WHEN yr = '2011' THEN 1 ELSE 0 END)
  - 100.0 * SUM(CASE WHEN yr = '2021' AND pcf_violation_category = 'speeding' THEN 1 ELSE 0 END) / SUM(CASE WHEN yr = '2021' THEN 1 ELSE 0 END),
  2) AS decrease_percentage_points
FROM (
  SELECT substr(collision_date,1,4) AS yr, pcf_violation_category
  FROM collisions
  WHERE substr(collision_date,1,4) IN ('2011','2021')
)
```
同方向并硬编码speeding

**spec 原文**（卷宗第 9 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
缺失快照

**spec 原文**（卷宗第 9 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无声明记录

**result 原文**（卷宗第 9 行，`/gold_results/0/csv_info/head/0/0`）：

```text
0.553654
```
Gold正值

**result 原文**（卷宗第 9 行，`/predicted_result/csv_info/head/0/0`）：

```text
-0.55
```
Pred负值

**证据限制**：
- 需GoldSQL、2021类别计数全集及差值符号细则；timeout状态不证明SQL方言/数据错。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- spec_info={} 表示快照记录缺失，不证明运行时从未声明。

### 10. local019

- 运行：`adr0007-fields-rowmode-dev10-deepseek-flash-20261010`；卷宗行：10。
- 分叉节点：**population.conditions**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`high`。
- 标准：Gold取Promotions.name=NXT场次，排除Belts.name含title change标题，非空duration排名后两姓名列。
- SQL 实际：按Belts名称含nxt认定NXT，并过滤Matches.title_change=0与MM:SS格式，再取最短秒数，姓名两行。
- 最早分叉依据：同比赛实体与Matches来源；最早候选条件已不同：promotion=NXT换成belt含NXT，标题文本排除换成是否易主。不是时长排名/输出的首分叉。
- 错误层依据：候选及选择明确把title change读作冠军易主标志、NXT读作belt名，SQL一致；业务读法错而非违背正确声明。
- 可见性依据：完整检查4次decisions：起始filters.open候选，最后filters.value/rationale明确选A；虽然引用题面括号支持误读，显式待定→决定按待定后决定错，生效状态未知。
- 其他差异：["selection", "output"]

**standard 原文**（卷宗第 10 行，`/standard_semantics/gold_sql`）：

```text
p.name = 'NXT'
```
Gold promotion条件

**standard 原文**（卷宗第 10 行，`/standard_semantics/gold_sql`）：

```text
WHERE name LIKE '%title change%'
```
Gold标题文字排除

**sql 原文**（卷宗第 10 行，`/final_sql`）：

```text
SELECT id FROM Belts WHERE lower(name) LIKE '%nxt%'
```
belt名称条件

**sql 原文**（卷宗第 10 行，`/final_sql`）：

```text
AND m.title_change = 0
```
实际易主过滤

**spec 原文**（卷宗第 10 行，`/our_spec_and_decisions/decisions/0/args/fields/filters/open`）：

```text
["title_id 指向 name 含 'NXT' 的 Belts 且 title_change=0 的场次", "title_id 指向 name 含 'NXT' 的 Belts 的全部场次（不排除 title_change）", "title_id 指向 name 以 'NXT' 开头的 Belts 且 title_change=0 的场次"]
```
起始候选

**spec 原文**（卷宗第 10 行，`/our_spec_and_decisions/decisions/3/args/fields/filters/value`）：

```text
title_id 指向 name 含 'NXT' 的 Belts 且 title_change=0 的场次
```
后续所选

**spec 原文**（卷宗第 10 行，`/our_spec_and_decisions/decisions/3/args/fields/filters/rationale`）：

```text
三个候选（含 'NXT' 且 title_change=0 / 含 'NXT' 全部 / 以 'NXT' 开头且 title_change=0）探针输出完全相同（同为 Bron Breakker、Duke Hudson），并列等价；选 A 是因为 'the NXT title' 按名称包含 NXT 识别，且题面括号要求排除 'title change' 即排除发生冠军易主（title_change=1）的场次。
```
选择依据

**证据限制**：
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 11. local020

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：11。
- 分叉节点：**population.eligibility**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：在有wicket且平均有效的投手中选每wicket平均失分最低者；题面未排除零失分投手。
- SQL 实际：只保留wicks>0且runs>0，再按runs/wicks升序；击球分加wides/noballs，过滤出局类型。
- 最早分叉依据：零失分且有wicket比值0是有效最低候选，额外runs>0排除零值实体，归eligibility。此前wicket/extra枚举和连接缺正式映射证据，不猜更早数据错。
- 错误层依据：没有正确资格声明，SQL添加正失分门槛，属口径扩加；不能以Gold和Pred球员不同判Gold排名错。
- 可见性依据：完整检查版本1全部空约束/假设/歧义/契约、空decisions及审核disclosures，无正失分资格声明。

**standard 原文**（卷宗第 11 行，`/instruction`）：

```text
Which bowler has the lowest bowling average per wicket taken?
```
最低平均要求无正失分门槛

**sql 原文**（卷宗第 11 行，`/final_sql`）：

```text
WHERE a.wicks>0 AND a.runs>0
```
实际排除零失分

**spec 原文**（卷宗第 11 行，`/our_spec_and_decisions/spec_info/answerContract`）：

```text
{}
```
空契约结合完整结构检查

**spec 原文**（卷宗第 11 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无资格决定

**证据限制**：
- 缺GoldSQL及板球定义；只能证明添加零失分排除，不能解释全部差异或认定枚举正确。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。

### 12. local021

- 运行：`spider2-local-round4-full-002`；卷宗行：12。
- 分叉节点：**population.conditions**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：按striker-match合计，至少一场>50取得striker资格；再合计合格striker所有比赛生涯runs，并平均striker总分。
- SQL 实际：按striker-match求SUM后WHERE total_runs>50，仅对超过50场次AVG并ROUND2，不回取其余场次。
- 最早分叉依据：striker/match键及逐球连接一致，阈值相同；最早差异是条件作用阶段：过滤场次事实而不是决定striker资格后纳入全部场次，次级为场次均值而非生涯striker均值。
- 错误层依据：SQL采用另一过滤/平均口径，无正确声明可判实现违约。
- 可见性依据：完整检查spec_info={}、decisions=[]、disclosures=[]；记录缺失，无可见资格阶段声明，未声明仅指卷宗可见性。
- 其他差异：["measure.formula", "output"]

**standard 原文**（卷宗第 12 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["sum runs per striker-match", "qualify any match > 50", "sum career striker runs", "average qualified strikers"]
```
标准资格/全生涯阶段

**sql 原文**（卷宗第 12 行，`/final_sql`）：

```text
SELECT round(AVG(total_runs), 2) AS avg_runs
FROM striker_runs
WHERE total_runs > 50;
```
实际合格场次均值

**spec 原文**（卷宗第 12 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
缺失快照

**spec 原文**（卷宗第 12 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无决定记录

**证据限制**：
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- spec_info={} 表示快照记录缺失，不证明运行时从未声明。

### 13. local023

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：13。
- 分叉节点：**selection**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：season5球员逐场总runs，再按球员SUM/参加击球的COUNT(match_id)得batting_avg，取平均最高5名并输出姓名、平均。
- SQL 实际：season5内计算runs总分、batted_matches与player_match出场数；同时返回per_batted/per_played两比值，却按runs总分DESC LIMIT12并带大量诊断列。
- 最早分叉依据：season5筛选与球员实体一致，per_batted包含Gold正确分母/公式；不能因额外per_played就断定所用指标必然错。首个确证核心违约是按总runs而非平均排名且n=12，不是连接/总体来源。
- 错误层依据：最终SQL停在诊断排名而非题面top5契约；无正确Spec排名声明可断为实现违约，按卷宗未声明的口径错。
- 可见性依据：完整检查空spec_info、decisions、disclosures，没有排序或n声明；快照缺失限制已披露。
- 其他差异：["output"]

**standard 原文**（卷宗第 13 行，`/standard_semantics/gold_sql`）：

```text
batting_avg DESC 
    LIMIT 5
```
Gold平均排名5名

**sql 原文**（卷宗第 13 行，`/final_sql`）：

```text
ORDER BY pr.runs DESC LIMIT 12
```
实际总分排名12名

**sql 原文**（卷宗第 13 行，`/final_sql`）：

```text
ROUND(1.0*pr.runs/pr.batted_matches, 3) AS per_batted
```
同时包含正确batted比值

**spec 原文**（卷宗第 13 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
缺失快照

**spec 原文**（卷宗第 13 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无决定

**证据限制**：
- spec_info={} 表示快照记录缺失，不证明运行时从未声明。

### 14. local024

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：14。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：所有赛季逐球员总runs/所有出场比赛数，然后国家内等权AVG球员平均，前5国家。
- SQL 实际：以player_match所有出场LEFT JOIN逐球员逐场runs，未击球补0，按player_id求SUM/COUNT出场；国家内AVG排序LIMIT5，ROUND4。
- 最早分叉依据：实体、全赛季、两层等权平均与题面全出场分母均相符；无GoldSQL证明Gold仅用击球场次或排除零得分球员。数值/国家顺序不同不能倒推这些上游有错。
- 错误层依据：标准与可见SQL无已证主分叉；缺Gold实现、零得分资格及分母细则，不能判Gold有问题，也不能猜数据重复。
- 可见性依据：完整检查spec_info仅deliveryRequirement与7个decisions；分母备选、后续select及理由明确支持全出场，与题面一致，未证明这个选择错。
- 其他差异：["output"]

**standard 原文**（卷宗第 14 行，`/instruction`）：

```text
for each player, calculate their average runs per match over all matches they played, then compute the average of these player averages for each country
```
全出场且两层平均

**sql 原文**（卷宗第 14 行，`/final_sql`）：

```text
SUM(COALESCE(br.runs, 0)) * 1.0 / COUNT(*) AS player_avg_runs
  FROM player_match pm
```
实际分母/零得分实现

**spec 原文**（卷宗第 14 行，`/our_spec_and_decisions/decisions/4/args/addChoices/0/alternatives/0/statement`）：

```text
Denominator = number of matches the player played (count of player_match rows for the player).
```
全出场候选

**spec 原文**（卷宗第 14 行，`/our_spec_and_decisions/decisions/6/args/dispositions/1/rationale`）：

```text
题干要求 'average runs per match over all matches they played'，核心词是 matches they played（出场的比赛），而 player_match 正是每球员每场一行 (match_id, player_id) 的出场记录表，故分母取该球员的出场场次。另一候选只统计球员作为 ball_by_ball.striker 出现的比赛，会把'进入名单但整场未击球'的比赛从分母剔除，不等于'他们打过的所有比赛'，因此排除。
```
后续全出场选择理由

**spec 原文**（卷宗第 14 行，`/our_spec_and_decisions/spec_info`）：

```text
{"deliveryRequirement": {"format": "csv", "satisfied": true}}
```
快照仅交付要求

**证据限制**：
- 需GoldSQL、球员零得分纳入/未击球场次政策、player_match唯一性实际观测与舍入细则；不把候选不同等同Gold错。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 15. local025

- 运行：`unresolved-hypothesis-hook-treatment-001`；卷宗行：15。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：将击球runs与extras按match/innings/over合计，整场各局over取最大，再每场等权AVG；标准最终单行单列平均。
- SQL 实际：同样SUM+SUM、每match MAX、每场一个over、等权AVG；但返回逐match六列明细，再UNION ALL一行Average ROUND2。
- 最早分叉依据：逐over、全局match最大及平均顺序与标准一致；无GoldSQL证明568/567、并列或多投手政策有更早错。明确首违约是最终把明细与标量拼成六列多行，归output。
- 错误层依据：decisions所提议输出就含明细与Average，SQL落实；非正确单标量声明后的SQL实现错。
- 可见性依据：完整检查6条快照假设及5个decisions，output明细/平均提议明确且facetStatus=hypothesis；只有投手/总体等备选，没有标量vs明细的后续选择，不称待定后决定；属于模型扩展输出假定。

**standard 原文**（卷宗第 15 行，`/standard_semantics/facets/output/alternatives/0`）：

```text
{"rowMode": "scalar", "rowCount": 1, "columnCount": 1, "columnNames": ["output"], "evidenceRefs": ["Q1"]}
```
单标量契约

**sql 原文**（卷宗第 15 行，`/final_sql`）：

```text
SELECT match_id, innings_no, over_id, bowler_id, bowler_name, total_runs FROM match_result UNION ALL SELECT 'Average', NULL, NULL, NULL, NULL, ROUND(AVG(total_runs),2) FROM match_result ORDER BY match_id
```
实际明细拼接平均

**spec 原文**（卷宗第 15 行，`/our_spec_and_decisions/decisions/4/args/spec/output`）：

```text
每场一行：match_id, innings_no, over_id, bowler_id, bowler_name, total_runs；最后一行以 match_id='Average' 给出所有比赛最高 over 总分的平均值
```
提议扩展输出

**spec 原文**（卷宗第 15 行，`/our_spec_and_decisions/decisions/4/args/facetStatus/output`）：

```text
hypothesis
```
输出hypothesis标记

**证据限制**：
- 题面要求retrieve bowler但标准输出仅平均；这支持明细可作中间计算，不证明Gold必须返回投手明细。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 16. local026

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：16。
- 分叉节点：**selection**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：仅候选每场最高失分over，取全局失分最多的前三投手，并给出各自该最高失分发生的match。
- SQL 实际：逐over累加runs+extras、保留每场并列最大、按bowler求MAX(over_runs)，但独立MIN(match_id)当作best_match_id，未限制到该投手最大失分那条记录；多出max_runs列。
- 最早分叉依据：每场资格、over求和、球员身份无更早已证错误，不能据20行探索断定/否定全库单投手。可证分叉为argmax与其记录关联：MAX失分和MIN任意场号不是同一被选记录，归selection。
- 错误层依据：最后decision明确output为“该失分所在match_id”且ranking取最高单over；SQL独立MIN违反此正确声明，属实现错。
- 可见性依据：完整检查3条快照假设及2个decisions，该失分对应场号声明正确；五种错误可见性不适用，visibility=null taxonomy_gap，不造未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 16 行，`/instruction`）：

```text
For each of these bowlers, provide the match in which they conceded these maximum runs.
```
题面关联到最高失分发生场次

**sql 原文**（卷宗第 16 行，`/final_sql`）：

```text
MAX(w.over_runs) AS best_over_runs, MIN(w.match_id) AS best_match_id
```
独立两个聚合

**spec 原文**（卷宗第 16 行，`/our_spec_and_decisions/decisions/1/args/spec/output`）：

```text
top3投球手 各一行：投球手名、其最高单over失分、该失分所在 match_id
```
正确关联声明

**spec 原文**（卷宗第 16 行，`/our_spec_and_decisions/decisions/1/args/spec/ranking`）：

```text
对符合条件(受各自 match 最大失分 over 约束)的每个独特投球手，取其最高单over失分，按该值降序，并列按最小 match_id 打破，取 top3
```
正确最高单over选择

**证据限制**：
- 无GoldSQL，独立MIN是结构性违约；不能量化其在最终三人的实际影响或证实其他投手归属差异。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 17. local028

- 运行：`wrong-submitted-34-20260926-deepseek-rationale-480s`；卷宗行：17。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：delivered订单按2016/2017/2018年月计数，月行年列，标准允许12×4或3×13两种形状。
- SQL 实际：order_status=delivered，按order_purchase_timestamp归月/年COUNT，补12个月零值，返回12×4透视。
- 最早分叉依据：状态、范围、月行年列契约吻合；标准没有归属时间字段，不能以结果不同认定必须用交付日期；也不能无观测认定COUNT行数重复。
- 错误层依据：缺GoldSQL与时间事件/唯一性细则，无法定位真实差异，四层待证。
- 可见性依据：完整检查deliveryRequirement快照及5个decisions：purchase/delivered两候选，只有provisionalAlternativeId及支持假设请求，无明确选取返回。没有证据说明purchase错，不标待定后决定错。

**standard 原文**（卷宗第 17 行，`/instruction`）：

```text
Could you generate a report that shows the number of delivered orders for each month in the years 2016, 2017, and 2018? Each column represents a year, and each row represents a month
```
月行年列要求

**sql 原文**（卷宗第 17 行，`/final_sql`）：

```text
SELECT CAST(strftime('%m', order_purchase_timestamp) AS INTEGER) AS month_no,
           strftime('%Y', order_purchase_timestamp) AS order_year,
```
实际下单月/年

**spec 原文**（卷宗第 17 行，`/our_spec_and_decisions/decisions/1/args/choices/0/alternatives/0/statement`）：

```text
Attribute each delivered order to the calendar month/year of order_purchase_timestamp (the month the order was placed) and count it there.
```
下单时间候选

**spec 原文**（卷宗第 17 行，`/our_spec_and_decisions/decisions/1/args/choices/0/alternatives/1/statement`）：

```text
Attribute each delivered order to the calendar month/year of order_delivered_customer_date (the month the order was delivered to the customer) and count it there; the 8 delivered orders with NULL delivery date have no month and would be dropped.
```
交付时间候选

**spec 原文**（卷宗第 17 行，`/our_spec_and_decisions/spec_info`）：

```text
{"deliveryRequirement": {"format": "csv", "satisfied": true}}
```
仅有交付要求快照

**证据限制**：
- 需GoldSQL、下单或交付时间字段定义、零月形状政策及order_id唯一性实际观测；列名不同不用于倒推总体错。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 18. local029

- 运行：`unresolved-hypothesis-block-control-10-001`；卷宗行：18。
- 分叉节点：**measure.countGrain**；错误层：**标准答案有问题**；可见性：**定义缺口**。
- 状态：`classified`；置信：`medium`。
- 标准：题面/标准按customer_unique_id的delivered订单数排前三客户，提供平均payment与city/state。Gold却在JOIN payments后COUNT(o.order_id)，并额外按city/state切组。
- SQL 实际：Pred先按unique_id COUNT(DISTINCT order_id)排名，再AVG支付行；city/state分别MIN；最终多出unique_id、订单数，输出5列并ROUND2。
- 最早分叉依据：同订单实体、delivered状态、支付来源满足所需平均；JOIN用于支付平均本身不构成错，不能无观测断定缺支付实体/物理重复。首个明确语义矛盾是Gold计支付连接行而非订单数，归countGrain；Gold城市切组与Pred额外输出是次级。
- 错误层依据：具体矛盾：题面最高number of delivered orders，Gold非distinct COUNT作用于已连接支付的行；这是支付行计数，不是订单实体数。Pred distinct count与题面一致。但Pred额外两列/舍入仍独立违约，本标签不宣称Pred全对。
- 可见性依据：完整检查5条快照假设及2个decisions：H4正确声明COUNT(DISTINCT order_id)，Gold此节点错而声明正确，五类错误可见性不适用，visibility=null taxonomy_gap。
- 其他差异：["grouping", "output"]

**standard 原文**（卷宗第 18 行，`/instruction`）：

```text
who have the highest number of delivered orders
```
题面指定订单计数

**standard 原文**（卷宗第 18 行，`/standard_semantics/gold_sql`）：

```text
COUNT(o.order_id) AS Total_Orders_By_Customers
```
Gold连接后非distinct计数

**standard 原文**（卷宗第 18 行，`/standard_semantics/gold_sql`）：

```text
JOIN olist_order_payments p ON o.order_id = p.order_id
```
Gold计数数据流连接支付

**sql 原文**（卷宗第 18 行，`/final_sql`）：

```text
COUNT(DISTINCT order_id) AS delivered_orders
```
Pred订单实体数

**spec 原文**（卷宗第 18 行，`/our_spec_and_decisions/spec_info/hypotheses/3/statement`）：

```text
已交付订单数 = COUNT(DISTINCT order_id)，按 customer_unique_id 汇总
```
快照明确正确计数

**standard 原文**（卷宗第 18 行，`/standard_semantics/gold_sql`）：

```text
GROUP BY c.customer_unique_id, c.customer_city, c.customer_state
```
Gold额外城市切组

**证据限制**：
- 卷宗不含连接键实测全集，不能量化Gold计支付行的放大量；结论是具体计数定义与题面冲突，不是仅因结果不同。
- Pred分别MIN(city)、MIN(state)可能合成不同记录位置；无实际多位置数据，不声称发生。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 19. local031

- 运行：`wrong-submitted-34-20260926-deepseek-rationale-480s`；卷宗行：19。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：在2016/2017/2018选delivered订单全年量最少年，再返回该年最高月订单量，单标量。
- SQL 实际：以purchase timestamp划年份、delivered状态COUNT，年ASC LIMIT1，再按同日期月COUNT取MAX；单列返回。
- 最早分叉依据：两阶段先最小年再最大月及范围、状态与形状吻合；没有标准时间字段，不能据不匹配指定交付日期，也不能无观测猜订单重复。
- 错误层依据：无已证标准/SQL主分叉，缺GoldSQL、时间映射及表键事实，四层待证。
- 可见性依据：完整检查deliveryRequirement与3个decisions：时间字段候选可见，支持/替代请求后仅provisional选择下单；没有证明所选错，更不声称正式生效。

**standard 原文**（卷宗第 19 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["annual delivered orders", "select minimum year", "monthly maximum"]
```
标准年→月阶段

**sql 原文**（卷宗第 19 行，`/final_sql`）：

```text
WITH y AS (
  SELECT strftime('%Y', order_purchase_timestamp) AS yr, COUNT(*) AS annual_delivered
  FROM olist_orders
  WHERE order_status = 'delivered'
    AND strftime('%Y', order_purchase_timestamp) IN ('2016','2017','2018')
  GROUP BY yr
), low AS (
  SELECT yr FROM y ORDER BY annual_delivered ASC LIMIT 1
), m AS (
  SELECT strftime('%m', order_purchase_timestamp) AS mo, COUNT(*) AS monthly_delivered
  FROM olist_orders
  WHERE order_status = 'delivered'
    AND strftime('%Y', order_purchase_timestamp) = (SELECT yr FROM low)
  GROUP BY mo
)
SELECT MAX(monthly_delivered) AS highest_monthly_delivered_orders_volume
FROM m;
```
实际全部阶段

**spec 原文**（卷宗第 19 行，`/our_spec_and_decisions/decisions/2/args/spec/time/value/expression`）：

```text
strftime('%Y', order_purchase_timestamp) and strftime('%m', order_purchase_timestamp)
```
拟用下单日期

**spec 原文**（卷宗第 19 行，`/our_spec_and_decisions/decisions/0/args/choices/0/alternatives/1/statement`）：

```text
按 order_delivered_customer_date 的年/月归属（交付事件时间）
```
交付日期备选

**spec 原文**（卷宗第 19 行，`/our_spec_and_decisions/spec_info`）：

```text
{"deliveryRequirement": {"format": "csv", "satisfied": true}}
```
仅交付要求快照

**证据限制**：
- 需GoldSQL、订单归属时间事件定义、order_id唯一性观测与年度并列规则。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 20. local032

- 运行：`unresolved-hypothesis-hook-treatment-003`；卷宗行：20。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：delivered卖家四个类别赢家，依列角色顺序Description、Seller_ID、Value；客户/订单distinct，利润SUM(price-freight)，5星评分COUNT。
- SQL 实际：同delivered四赢家，客户与订单distinct、利润SUM、5星COUNT(DISTINCT review_id)，最后列序seller_id、value、description。
- 最早分叉依据：上游delivered、卖家粒度与前三公式一致；无GoldSQL规定5星是评分行还是关联明细计数，不猜其为错。可确定差异是角色列序从描述/卖家/值变成卖家/值/描述，归output。
- 错误层依据：提议output本身声明seller_id/value/description，SQL一致，业务交付契约错，不是SQL违背正确声明。
- 可见性依据：完整检查4条快照假设及唯一decision；output直接给值且explicit但没有题面证据支持该列序，视模型直接值假定错；不是引用原文核实过的顺序。

**standard 原文**（卷宗第 20 行，`/standard_semantics/facets/output/alternatives/0/columnRoles`）：

```text
[{"role": "achievement_description", "position": 1}, {"role": "seller_id", "position": 2}, {"role": "metric_value", "position": 3}]
```
标准明确位置角色

**sql 原文**（卷宗第 20 行，`/final_sql`）：

```text
SELECT seller_id, value, description FROM (
```
实际位置角色

**spec 原文**（卷宗第 20 行，`/our_spec_and_decisions/decisions/0/args/spec/output`）：

```text
4 行，列为 seller_id、value、description（achievement 说明）
```
提议错误列序

**spec 原文**（卷宗第 20 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
5-star ratings 通过 olist_order_reviews.review_score = 5 计数，经 order_id 关联到该卖家的订单明细行
```
评分假设未给distinct与否

**证据限制**：
- 缺GoldSQL及5星评分粒度细则；输出列序是可证分叉，不据隐藏评分数猜更早节点。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 21. local034

- 运行：`unresolved-hypothesis-block-control-10-001`；卷宗行：21。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：按类别/支付方式统计distinct支付事件(order_id/payment_sequential)，类别内取最高事件数，然后等权AVG各类别最高数。
- SQL 实际：先DISTINCT order_id/category消除同类商品行膨胀，再连接payments COUNT行，类别MAX，最后AVG，含NULL类别。
- 最早分叉依据：商品连接重复已通过distinct映射消除，MAX→AVG顺序正确；payments行是否与唯一事件一一对应无实测。不能凭COUNT(*)断言支付表有重复或Gold排除了NULL。
- 错误层依据：缺GoldSQL、支付键唯一性与NULL类别政策，标准与SQL可能等价，无法定位错层。
- 可见性依据：完整检查3条快照假设及2个decisions：H1支付记录行、H2连接膨胀、H3含NULL可见，第二次metric提出事件去重；备选无select记录，不臆称已决定或成功生效。

**standard 原文**（卷宗第 21 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["count distinct payment events by category and payment method using order_id/payment_sequential", "select maximum payment method per category", "average selected counts"]
```
标准独特事件计数及顺序

**sql 原文**（卷宗第 21 行，`/final_sql`）：

```text
WITH order_categories AS (
  SELECT DISTINCT oi.order_id AS order_id, pr.product_category_name AS category
  FROM olist_order_items oi
  JOIN olist_products pr ON pr.product_id = oi.product_id
),
category_method_counts AS (
  SELECT oc.category AS category, pay.payment_type AS payment_type, COUNT(*) AS payment_count
  FROM olist_order_payments pay
  JOIN order_categories oc ON oc.order_id = pay.order_id
  GROUP BY oc.category, pay.payment_type
),
category_top AS (
  SELECT category, MAX(payment_count) AS top_payment_count
  FROM category_method_counts
  GROUP BY category
)
SELECT AVG(top_payment_count) AS avg_total_payments
FROM category_top
```
实际去重类别映射及计数

**spec 原文**（卷宗第 21 行，`/our_spec_and_decisions/decisions/1/args/spec/metric`）：

```text
对每个产品类别，先确定其“最偏好支付方式”（该类别内支付笔数最多的 payment_type），再取该方式的支付笔数（=该类别内最大支付笔数）作为该类别总量；最终指标 = 所有产品类别该总量的算术平均（每类等权）。支付笔数按支付记录去重，以消除 payments⋈items 连接造成的行膨胀
```
正确去重提议

**spec 原文**（卷宗第 21 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
“支付笔数”按 olist_order_payments 的行（支付记录）计，而非订单数或 payment_value 求和
```
支付行作为事件的快照假设

**spec 原文**（卷宗第 21 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
产品类别使用 olist_products.product_category_name 原始值（葡语），不做英文映射；GROUP BY 时含 NULL 组
```
NULL类别政策可见

**证据限制**：
- 需GoldSQL、payment事件键实际唯一性、NULL类别纳入政策、支付类别归属细则及结果全集；不把未证表重复当事实。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 22. local035

- 运行：`adr0007-fields-rowmode-dev10-deepseek-flash-20261010`；卷宗行：22。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：在olist_geolocation全部记录按state/city/zip/lat/lng排序，相邻记录距离最高的一对城市；标准仅一行两城市列或两行单城市列。
- SQL 实际：同五键LAG相邻记录，用haversine大圆距离最高LIMIT1；输出两州、两城市及ROUND3距离共5列。
- 最早分叉依据：顺序与相邻记录对象吻合，球面余弦与haversine为同一大圆距离，无GoldSQL/精度证据不判formula；无并列观测不把LIMIT1当首错。首确定差异为附加州/距离列，归output。
- 错误层依据：output.shape及最终output声明都扩成5列，SQL一致，错在交付契约假定。
- 可见性依据：完整检查delivery快照与5个decisions：第1号output.shape明确basis=assumed，以识别/核验为由附州和距离；最后指标候选选择属于别节点，不移作输出待定后决定错。

**standard 原文**（卷宗第 22 行，`/standard_semantics/facets/output/alternatives/0`）：

```text
{"rowMode": "detail", "rowCount": 1, "columnCount": 2, "columnNames": ["city_one", "city_two"], "binding": "hard", "evidenceRefs": ["Q1", "G1"]}
```
一行两列标准

**standard 原文**（卷宗第 22 行，`/standard_semantics/facets/output/alternatives/1`）：

```text
{"rowMode": "unknown", "rowCount": 2, "columnCount": 1, "columnNames": ["city"], "binding": "structural", "evidenceRefs": ["Q1", "G2"]}
```
另一两行单列标准

**sql 原文**（卷宗第 22 行，`/final_sql`）：

```text
p_st  AS state_1,
  p_city AS city_1,
  st    AS state_2,
  city  AS city_2,
  ROUND(dist_km, 3) AS distance_km
```
实际附加州与距离

**spec 原文**（卷宗第 22 行，`/our_spec_and_decisions/decisions/1/args/fields/output.shape/value`）：

```text
一行结果，列出排序后相邻的两个城市（含所属州）及两点间的距离
```
提议扩列

**spec 原文**（卷宗第 22 行，`/our_spec_and_decisions/decisions/1/args/fields/output.shape/rationale`）：

```text
题面问“哪两个相邻城市”，答案即这对城市；附上州与距离用于唯一识别与核验
```
附加列理由

**证据限制**：
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 23. local037

- 运行：`unresolved-hypothesis-block-control-10-001`；卷宗行：23。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：各产品类别先求其组内最常用payment type笔数，再跨类别按最高笔数选3，输出类别名称与payment_count两列。
- SQL 实际：按category/type对支付事件order_id+sequential去重COUNT，类别内ROW_NUMBER取最高，再跨类别LIMIT3；返回category、payment_type、count三列。
- 最早分叉依据：支付事件去重、类别内众数、跨类别top3均与标准文字吻合；无证据要求英文类别或不同支付粒度，不猜更早总体/计数问题。首可证差异为增加payment_type一列，归output。
- 错误层依据：后续decision输出明确扩三列，SQL一致，并非正确两列声明后的实现违约；Gold无SQL，不认定其隐藏计数有问题。
- 可见性依据：完整检查4条快照假设及2个decisions：初次output两项，第二次output三项且facetStatus=hypothesis；备选仅众数/粒度/语言/状态，无二列vs三列选择，故直接输出扩展假定错。

**standard 原文**（卷宗第 23 行，`/standard_semantics/facets/output/alternatives/0`）：

```text
{"rowMode": "top_n", "rowCount": 3, "columnCount": 2, "columnNames": ["Category_name", "payment_count"], "evidenceRefs": ["Q1"]}
```
标准类别+count两列

**sql 原文**（卷宗第 23 行，`/final_sql`）：

```text
SELECT product_category_name,
       payment_type,
       payment_count
```
实际三列

**spec 原文**（卷宗第 23 行，`/our_spec_and_decisions/decisions/0/args/spec/output`）：

```text
产品类别名称 + 该类别使用其最常用支付类型的支付笔数，共 3 行
```
早期两项提议

**spec 原文**（卷宗第 23 行，`/our_spec_and_decisions/decisions/1/args/spec/output`）：

```text
product_category_name + payment_type + payment_count，共 3 行，按 payment_count 降序
```
后续三项提议

**spec 原文**（卷宗第 23 行，`/our_spec_and_decisions/decisions/1/args/facetStatus/output`）：

```text
hypothesis
```
输出标为hypothesis

**证据限制**：
- 无GoldSQL不能确定数值差别来源；这里只归类可证实输出列契约偏差。
- Gold SQL 为 null；仅有结果头部，不臆造标准隐藏处理。
- 工具参数仅表示声明/处置意图；卷宗不含对应返回，不能宣称成功生效。

### 24. local038

- 运行：`spider2-local-baseline-full-002`；卷宗行：24。
- 分叉节点：**selection**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：筛选合格影片，取出演次数最多的单个演员，仅给全名。
- SQL 实际：过滤均对齐，按演员计数排序后保留所有演员，另给ID和计数。
- 最早分叉依据：语言、分类、评级、年份、时长对齐；无可证上游差异，最早是未执行top1。
- 错误层依据：SQL采用不同交付读法；没有正确Spec被SQL违背的证据，不归实现错。
- 可见性依据：完整检查spec_info、decisions、disclosures，均无口径记录。未声明仅指卷宗缺失，不证明运行时从未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 24 行，`/standard_semantics/gold_sql`）：

```text
COUNT(film.film_id) DESC
LIMIT 1;
```
标准只取一名

**sql 原文**（卷宗第 24 行，`/final_sql`）：

```text
ORDER BY qualifying_film_count DESC, a.actor_id
```
仅排序无截取

**spec 原文**（卷宗第 24 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
记录缺失

**证据限制**：
- Spec缺失，错误层不能区分遗失声明后的实施失误。

### 25. local039

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：25。
- 分叉节点：**selection**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：满足城市条件后取累计租借小时最多的一个分类。
- SQL 实际：累计分类小时，LIMIT5且附小时列；未逐次截整数小时。
- 最早分叉依据：城市条件/租借链对齐，return_date NULL不贡献SUM，不据此判总体错；最早top5而非top1。
- 错误层依据：SQL采用不同交付读法；没有正确Spec被SQL违背的证据，不归实现错。
- 可见性依据：完整检查spec_info、decisions、disclosures，均无口径记录。未声明仅指卷宗缺失，不证明运行时从未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 25 行，`/standard_semantics/gold_sql`）：

```text
LIMIT
    1;
```
标准top1

**sql 原文**（卷宗第 25 行，`/final_sql`）：

```text
ORDER BY total_rental_hours DESC, cat.name ASC
LIMIT 5
```
实际top5

**spec 原文**（卷宗第 25 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
记录缺失

**standard 原文**（卷宗第 25 行，`/standard_semantics/gold_sql`）：

```text
SUM(CAST((julianday(rental.return_date) - julianday(rental.rental_date)) * 24 AS INTEGER)) DESC
```
逐次整数小时

**证据限制**：
- 中间截整数小时实质影响运算；依协议精度归output，不猜上游。
- predicted_result为timeout且1行，与final_sql LIMIT5不一致；不宣称CSV来自此SQL成功执行。
- Spec缺失限制错误层归因。

### 26. local040

- 运行：`wrong-submitted-34-20260926-deepseek-rationale-480s`；卷宗行：26。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：树数top3 borough交付borough及平均mean income两列。
- SQL 实际：按borough COUNT和AVG、top3，交付tree_count在内三列。
- 最早分叉依据：无Gold SQL，ZIP填补、收入去重/加权不能凭差值断言错；确定差异是额外计数输出。
- 错误层依据：begin提议本身采用三列输出，SQL照此交付，非已知正确Spec被违背。
- 可见性依据：完整检查spec_info及4个decisions；两次begin提议三列，未见题面要求交付树数的引文；无证据支持细项归假定错。

**standard 原文**（卷宗第 26 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["boroname", "mean_income"]
```
标准两列

**sql 原文**（卷宗第 26 行，`/final_sql`）：

```text
COUNT(*) AS tree_count
```
额外输出树数

**spec 原文**（卷宗第 26 行，`/our_spec_and_decisions/decisions/1/args/spec/output/value/columns`）：

```text
["boroname", "tree_count", "avg_mean_income"]
```
提议三列

**证据限制**：
- gold_sql=null；Gold仅结果head，不能判断ZIP/去重/权重与数值差异关系。
- spec_info仅deliveryRequirement；工具参数无返回，provisional服务端ID无映射，不宣称成功采纳。

### 27. local041

- 运行：`round11-paired-040-control`；卷宗行：27。
- 分叉节点：**output**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：Bronx Good树占全部Bronx树百分比，单列；Gold显示78.15。
- SQL 实际：比例正确，交付总树数、Good树数、舍入1位百分比三列。
- 最早分叉依据：总体与分子/分母对齐；最早可证差异为输出列与精度。
- 错误层依据：SQL采用不同交付读法；没有正确Spec被SQL违背的证据，不归实现错。
- 可见性依据：已完整检查spec_info：唯一约束trees in the，不涉及输出；hypotheses/ambiguities/answerContract为空，decisions为空，未见输出声明。

**standard 原文**（卷宗第 27 行，`/standard_semantics/facets/output/alternatives/0/columnCount`）：

```text
1
```
单列要求

**sql 原文**（卷宗第 27 行，`/final_sql`）：

```text
COUNT(*) AS total_bronx_trees,
  SUM(CASE WHEN health = 'Good' THEN 1 ELSE 0 END) AS good_trees,
  ROUND(100.0 * SUM(CASE WHEN health = 'Good' THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_good
```
三列及1位精度

**spec 原文**（卷宗第 27 行，`/our_spec_and_decisions/spec_info/hardConstraints/0/statement`）：

```text
trees in the
```
唯一约束不是输出声明

**证据限制**：
- gold_sql=null；结果只含head。
- 标准denominator串题为total product sales in each quarter，与题面/measure矛盾，不据此判实际分母错。

### 28. local049

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：28。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：2019–2021最高新增行业的年均新增数，一个标量。
- SQL 实际：MIN日期/行业并distinct公司计数除3，交付行业名与均数两列。
- 最早分叉依据：时间、三年分母、行业排序可见对齐；MIN取单行业/去重无法无Gold验证。确定差异是附行业列。
- 错误层依据：初始scalar average在第二轮扩展为附行业的读法，SQL照此输出。
- 可见性依据：完整spec_info及2轮decisions，最后output附industry，无题面逐字依据；facetStatus explicit不是证据，归假定错。

**standard 原文**（卷宗第 28 行，`/standard_semantics/facets/output/alternatives/0/columnCount`）：

```text
1
```
逐字比较依据

**sql 原文**（卷宗第 28 行，`/final_sql`）：

```text
(SELECT industry FROM top_ind) AS top_industry,
```
逐字比较依据

**spec 原文**（卷宗第 28 行，`/our_spec_and_decisions/decisions/0/args/spec/output`）：

```text
scalar average
```
逐字比较依据

**spec 原文**（卷宗第 28 行，`/our_spec_and_decisions/decisions/1/args/spec/output`）：

```text
单值：top industry 的多年平均新增数（含行业名）
```
逐字比较依据

**证据限制**：
- gold_sql=null；Spec有编码损坏，保留原文。
- 57.67与59.67不能反推MIN/COUNT/连接错。
- 工具参数无返回，不能声称修订成功。

### 29. local050

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：29。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：逐产品月投影→USD→月均→中位数。
- SQL 实际：逐产品月SUM、增长外推、2021汇率、月均后中位数ROUND2；6次begin保持该序，末次select理由指向a-prod。
- 最早分叉依据：核心运算与可见标准未能证实分叉。别名非独立业务错误，数值/姓名不同不能确定最早节点；不标树外。
- 错误层依据：证据不足，不能诚实归四层，也不因为Gold SQL缺失判Gold错。
- 可见性依据：完整检查spec_info/全部decisions/disclosures；有明确备选与选择意图，但未证所选读法错误，不强套五类。

**standard 原文**（卷宗第 29 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
median of monthly average projected 2021 sales in USD
```
逐字比较依据

**sql 原文**（卷宗第 29 行，`/final_sql`）：

```text
WITH hist AS (
  SELECT s.prod_id AS prod_id, CAST(strftime('%Y', s.time_id) AS INTEGER) AS yr,
         CAST(strftime('%m', s.time_id) AS INTEGER) AS mo, SUM(s.amount_sold) AS sales
  FROM sales s
  JOIN customers cu ON s.cust_id = cu.cust_id
  JOIN countries co ON cu.country_id = co.country_id
  JOIN promotions pr ON s.promo_id = pr.promo_id
  JOIN channels ch ON s.channel_id = ch.channel_id
  WHERE co.country_name = 'France' AND pr.promo_total_id = 1 AND ch.channel_total_id = 1
    AND strftime('%Y', s.time_id) IN ('2019','2020')
  GROUP BY s.prod_id, yr, mo
),
pivot AS (
  SELECT prod_id, mo, MAX(CASE WHEN yr=2019 THEN sales END) AS s2019,
         MAX(CASE WHEN yr=2020 THEN sales END) AS s2020
  FROM hist GROUP BY prod_id, mo
),
proj AS (
  SELECT prod_id, mo, (((s2020 - s2019) / s2019) * s2020) + s2020 AS proj_local
  FROM pivot WHERE s2019 IS NOT NULL AND s2020 IS NOT NULL AND s2019 <> 0
),
proj_usd AS (
  SELECT p.prod_id, p.mo,
         p.proj_local * COALESCE((SELECT cur.to_us FROM currency cur WHERE cur.country='France' AND cur.year=2021 AND cur.month=p.mo),1) AS v
  FROM proj p
),
monthly AS (SELECT mo, AVG(v) AS avg_v FROM proj_usd GROUP BY mo),
ranked AS (SELECT avg_v, ROW_NUMBER() OVER (ORDER BY avg_v) AS rn, COUNT(*) OVER () AS n FROM monthly)
SELECT ROUND(AVG(avg_v),2) AS median_avg_monthly_projected_sales_usd
FROM ranked WHERE rn IN ((n+1)/2,(n+2)/2)
```
逐字比较依据

**spec 原文**（卷宗第 29 行，`/our_spec_and_decisions/decisions/6/args/dispositions/0/rationale`）：

```text
业务文档《Projection Calculation Method》第 3 步逐字写 'Determine how sales changed from 2019 to 2020 for each product and month.'，投影以 (产品, 月) 为单位；第 5 步再写 'Compute the average projected sales for each month in 2021'，即在产品之上按月份求平均。因此只有 a-prod 同时实现『产品级投影』与『月度平均』两步。a-total 先把产品维度合并为月度总额，既违背文档明确的产品级投影，又使题面所说的 monthly averages 失去对象。
```
逐字比较依据

**证据限制**：
- gold_sql=null，Gold仅结果head，无SQL/结果全集。
- 补Gold SQL及完整缺失年份/零基期、产品月总体、汇率连接、中位数细则。
- spec_info仅deliveryRequirement，工具参数无返回，不宣称选择/支持成功。

### 30. local055

- 运行：`spider2-local-round5-full-001`；卷宗行：30。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：最高及最低售卖艺术家各自购买者平均花费的绝对差。
- SQL 实际：只求最高艺术家顾客均值，最低均值硬编码0.0后相减。
- 最早分叉依据：最高艺术家业务链/客户聚合未见可证上游差异；最早是第二个嵌套AVG被常量替换，非仅分母/计数对象。
- 错误层依据：缺整个最低艺术家平均计算，采用不同度量；无正确Spec可证明实现违背。
- 可见性依据：完整检查spec_info {}、decisions []、disclosures []。未声明仅指卷宗记录缺失，不证明运行时从未声明。

**standard 原文**（卷宗第 30 行，`/instruction`）：

```text
the average spending for the customers who purchased from the lowest-selling artist
```
逐字比较依据

**sql 原文**（卷宗第 30 行，`/final_sql`）：

```text
SELECT 0.0 AS avg_bottom
```
逐字比较依据

**spec 原文**（卷宗第 30 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
逐字比较依据

**证据限制**：
- gold_sql=null，不臆造Gold是否纳入零售卖艺术家。
- Spec缺失限制错误层判定。

### 31. local056

- 运行：`spec-names-10-20260927-deepseek-r1`；卷宗行：31。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：最大客户平均月环比支付变化，给客户全名。
- SQL 实际：客户月SUM，实际观测月份LAG有符号差，AVG降序取1；修订明确SUM/signed/nofill。
- 最早分叉依据：核心运算与可见标准未能证实分叉。别名非独立业务错误，数值/姓名不同不能确定最早节点；不标树外。
- 错误层依据：证据不足，不能诚实归四层，也不因为Gold SQL缺失判Gold错。
- 可见性依据：完整检查spec_info/全部decisions/disclosures；有明确备选与选择意图，但未证所选读法错误，不强套五类。

**standard 原文**（卷宗第 31 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
customer with maximum average month-over-month payment change
```
逐字比较依据

**sql 原文**（卷宗第 31 行，`/final_sql`）：

```text
WITH monthly AS (
  SELECT customer_id, strftime('%Y-%m', payment_date) AS ym, SUM(amount) AS total_amount
  FROM payment
  GROUP BY customer_id, ym
),
changes AS (
  SELECT customer_id, ym,
         total_amount - LAG(total_amount) OVER (PARTITION BY customer_id ORDER BY ym) AS chg
  FROM monthly
),
agg AS (
  SELECT customer_id, AVG(chg) AS avg_monthly_change
  FROM changes
  WHERE chg IS NOT NULL
  GROUP BY customer_id
)
SELECT c.first_name || ' ' || c.last_name AS full_name
FROM agg a
JOIN customer c ON c.customer_id = a.customer_id
ORDER BY a.avg_monthly_change DESC
LIMIT 1
```
逐字比较依据

**spec 原文**（卷宗第 31 行，`/our_spec_and_decisions/decisions/1/args/spec/metric/value/expression`）：

```text
每个客户按 strftime('%Y-%m', payment_date) 分组得到月度支付总额 total = SUM(amount)；chg = 本月 total - 该客户上一有记录月份的 total；指标 = AVG(chg)，即该客户全部相邻月份记录的差值的算术平均
```
逐字比较依据

**证据限制**：
- gold_sql=null，Gold仅结果head，无SQL/结果全集。
- 补Gold SQL或审定signed/ABS、月SUM/单笔AVG、日历缺月政策，不用Gold姓名倒推隐藏处理。
- spec_info仅deliveryRequirement，工具参数无返回，不宣称选择/支持成功。

### 32. local059

- 运行：`length-truncated-20-20260926-deepseek-32k-continue-r2`；卷宗行：32。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`high`。
- 标准：每division取年销量top3，在division内平均3个产品总销量并逐division交付。
- SQL 实际：各division取3后合并全部入选产品作单个AVG(q)。
- 最早分叉依据：产品年SUM、日历2021、division分区top3对齐；最早分叉是最终均值per从division变overall，不是总体/计数对象/单位。
- 错误层依据：c-avg列分division与全局平均且暂采scalar，SQL依不同读法执行。
- 可见性依据：完整spec_info及3轮decisions；c-avg列3备选并有provisionalAlternativeId=alt-scalar。后两轮仅改ties，不把ties处置当成c-avg成功返回。
- 其他差异：["grouping", "output"]

**standard 原文**（卷宗第 32 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
average quantity across the three best-selling hardware products within each division
```
逐字比较依据

**sql 原文**（卷宗第 32 行，`/final_sql`）：

```text
SELECT ROUND(AVG(q), 2) AS overall_avg_qty
```
逐字比较依据

**spec 原文**（卷宗第 32 行，`/our_spec_and_decisions/decisions/0/args/choices/0/provisionalAlternativeId`）：

```text
alt-scalar
```
逐字比较依据

**spec 原文**（卷宗第 32 行，`/our_spec_and_decisions/decisions/0/args/choices/0/alternatives/0/statement`）：

```text
先在每个事业部分别取销量前 3 的产品，再把全部入选产品的年销量合并求算术平均，得到单一 overall 平均值（1 行）
```
逐字比较依据

**spec 原文**（卷宗第 32 行，`/our_spec_and_decisions/decisions/0/args/spec/groupBy/0`）：

```text
division（仅作为排名的分区；最终输出不再分组）
```
逐字比较依据

**证据限制**：
- gold_sql=null；provisionalAlternativeId为明确暂采意图，无工具返回不宣称已生效。

### 33. local060

- 运行：`spider2-gold109-deepseek-flash-001`；卷宗行：33。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：产品季度份额2020减2019变化以百分点计算。
- SQL 实际：两个销售比值直接相减未乘100，输出原比例变化；另附季度份额。
- 最早分叉依据：国家/季度/促销、城市增长未见可证上游分叉；top20/分母细则无Gold不猜错。确定缺percentage-point的100因子，ADR区分ratio与percentage的运算，归formula。
- 错误层依据：Spec metric写季度额/总额之差，无100；SQL照比例读法，非已知正确百分点公式被实施违背。
- 可见性依据：完整spec_info及4轮decisions；metric标hypothesis，最终比例差声明无合格引文。决策备选只涉及分母/截位而非比例因子，不判待定后决定错。
- 其他差异：["output"]

**standard 原文**（卷宗第 33 行，`/standard_semantics/facets/measure/alternatives/0/kind`）：

```text
percentage_point_difference
```
逐字比较依据

**sql 原文**（卷宗第 33 行，`/final_sql`）：

```text
1.0 * tp.p20 / (SELECT tot FROM totals WHERE q = '2020-04')
             - 1.0 * tp.p19 / (SELECT tot FROM totals WHERE q = '2019-04') AS chg
```
逐字比较依据

**spec 原文**（卷宗第 33 行，`/our_spec_and_decisions/decisions/3/args/spec/metric`）：

```text
份额变化 = 产品 Q4 2020 份额 − 产品 Q4 2019 份额；份额 = 产品该季度销售额 / 入选城市该季度销售总额（均排除促销）
```
逐字比较依据

**证据限制**：
- gold_sql=null；*100只解释尺度，不解释Gold方向/排序差异，分母/城市/产品总体仍需补证。
- decisionProposals只有备选无采纳返回，不声称D1/D2已决定。

### 34. local061

- 运行：`wrong-submitted-34-20260926-deepseek-rationale-480s`；卷宗行：34。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：逐产品月增长投影→2021USD→按月平均列出。
- SQL 实际：SQL产品月SUM→增长外推乘2021汇率(缺省1)，排除无双年/零基期，再月AVG、ROUND2；6轮参数延续字面过滤与等权选择。
- 最早分叉依据：核心顺序/输出形状与标准可见要求对齐，不能证实上游分叉；别名非独立业务错误，各月差值不证明过滤或formula错。
- 错误层依据：证据不足，不能诚实归四层；不因Gold SQL缺失判Gold错。
- 可见性依据：完整spec_info、6轮全部decisions与disclosures；缺失/过滤/权重均有最终选择意图，但无证据证明其读法错误，不能强套五类。

**standard 原文**（卷宗第 34 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
average projected 2021 monthly sales in USD by month
```
逐字比较依据

**sql 原文**（卷宗第 34 行，`/final_sql`）：

```text
WITH fr_product_month AS (
  -- Grain: one row per (prod_id, calendar month) for France sales with promo_total_id=1 and channel_total_id=1
  SELECT s.prod_id AS prod_id,
         CAST(strftime('%m', s.time_id) AS INTEGER) AS mth,
         SUM(CASE WHEN strftime('%Y', s.time_id) = '2019' THEN s.amount_sold ELSE 0 END) AS s2019,
         SUM(CASE WHEN strftime('%Y', s.time_id) = '2020' THEN s.amount_sold ELSE 0 END) AS s2020,
         SUM(CASE WHEN strftime('%Y', s.time_id) = '2019' THEN 1 ELSE 0 END) AS has2019,
         SUM(CASE WHEN strftime('%Y', s.time_id) = '2020' THEN 1 ELSE 0 END) AS has2020
  FROM sales s
  JOIN customers c  ON c.cust_id = s.cust_id
  JOIN countries co ON co.country_id = c.country_id
  JOIN promotions p ON p.promo_id = s.promo_id AND p.promo_total_id = 1
  JOIN channels ch  ON ch.channel_id = s.channel_id AND ch.channel_total_id = 1
  WHERE co.country_name = 'France'
    AND strftime('%Y', s.time_id) IN ('2019','2020')
  GROUP BY s.prod_id, mth
),
projected AS (
  -- Projected 2021 monthly sales per product, converted to USD (France 2021 monthly rate)
  SELECT fp.prod_id,
         fp.mth,
         (((fp.s2020 - fp.s2019) / CAST(fp.s2019 AS REAL)) * fp.s2020 + fp.s2020)
           * COALESCE(cur.to_us, 1) AS proj_usd
  FROM fr_product_month fp
  LEFT JOIN currency cur
    ON cur.country = 'France' AND cur.year = 2021 AND cur.month = fp.mth
  WHERE fp.has2019 > 0 AND fp.has2020 > 0 AND fp.s2019 <> 0
)
SELECT mth AS month,
       ROUND(AVG(proj_usd), 2) AS avg_projected_sales_usd
FROM projected
GROUP BY mth
ORDER BY mth;
```
逐字比较依据

**spec 原文**（卷宗第 34 行，`/our_spec_and_decisions/decisions/5/args/dispositions/4/rationale`）：

```text
The definition says to 'Compute the average projected sales for each month', i.e. an average of the per-product projected values; no volume/weight is specified, so a volume-weighted average would introduce an unsupported weight.
```
逐字比较依据

**spec 原文**（卷宗第 34 行，`/our_spec_and_decisions/decisions/1/args/spec/metric/value/expression`）：

```text
AVG_over_products( (((s2020 - s2019) / s2019) * s2020) + s2020 ) * to_us(France,2021,month), rounded to 2 dp
```
逐字比较依据

**证据限制**：
- gold_sql=null，仅结果head非全集。
- 需补Gold SQL与完整产品月纳入、缺年、零基期、汇率连接基数规则；不凭数值差猜测。
- spec_info仅deliveryRequirement；工具参数无返回，不宣称修订或选择成功。

### 35. local062

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：35。
- 分叉节点：**population.eligibility**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：题面all Italian customers，按顾客合计December利润再等宽分桶。
- SQL 实际：cp从sales inner join开始，仅含12月有销售且匹配costs的意大利顾客，无购买顾客未纳入。
- 最早分叉依据：最早逻辑差异是资格将all customers缩为购买者；不是看到JOIN就判来源错。成本匹配影响/重复未知，不能造joinMultiplicity错误。客户总利润extrema与Gold摘录不同，不恢复隐藏行级处理。
- 错误层依据：最终实际spec_info H3明确窄化到有12月购买记录顾客，SQL相符，非实施违背。
- 可见性依据：完整检查spec_info及3轮decisions；H1全体意大利与H3仅购买者并存，最后H3明确保留，basis无逐字题面引用，SQL落窄总体，归假定错；无真正Choice采纳链。

**standard 原文**（卷宗第 35 行，`/instruction`）：

```text
Please group all Italian customers into ten buckets
```
逐字比较依据

**sql 原文**（卷宗第 35 行，`/final_sql`）：

```text
FROM sales s
  JOIN customers cu ON cu.cust_id = s.cust_id AND cu.country_id = 52770
```
逐字比较依据

**spec 原文**（卷宗第 35 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
总月利润之范围仅覆盖 12 月有购买记录的意大利客户
```
逐字比较依据

**证据限制**：
- gold_sql=null；不能证明实际存在无购买意大利顾客，资格分叉是否造成此次失分未知。
- 标准ambiguity列顾客总利润/底层profit-row两种extrema；Gold head不能恢复隐藏SQL，不据此判Gold错。

### 36. local063

- 运行：`spider2-gold109-deepseek-flash-001`；卷宗行：36。
- 分叉节点：**measure.formula**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`medium`。
- 标准：合格top20%产品中按share change ASC取百分点变化最小的单个产品名称；不是绝对变化幅度最小。
- SQL 实际：SQL把sh20-sh19包成ABS后计算pp_change并按ABS升序，且只筛top20%而未LIMIT1，附带份额/差值列。
- 最早分叉依据：最早可证差异是signed share change被ABS改变：这是度量表达式运算差异，先于遗漏argmin选取及输出扩列。标准排序字段明确share change ASC；不用缺失Gold SQL猜测其他总体问题。
- 错误层依据：按最后可见Spec metric“百分点变化”及output“最小”与标准signed排序比较，SQL额外ABS并漏最终选一，属于实现偏差；工具参数是否成功生效仍无法证明。
- 可见性依据：完整Spec与8轮decisions中早期曾有绝对差假设/备选，但无选取返回；最后metric“百分点变化”未声明ABS。按最后可见正确字面定义与SQL比较，不能把旧备选当已决定，也不能把此节点说成未声明；五种错误声明类别不能准确表达“声明正确而实现偏差”，保留taxonomy_gap。
- 其他差异：["selection", "output"]

**standard 原文**（卷宗第 36 行，`/standard_semantics/facets/ranking/alternatives/1/selection`）：

```text
smallest share change
```
逐字比较依据

**sql 原文**（卷宗第 36 行，`/final_sql`）：

```text
WHERE r.rn * 5 <= r.n
ORDER BY ABS(r.sh20 - r.sh19) ASC, pr.prod_name ASC;
```
逐字比较依据

**spec 原文**（卷宗第 36 行，`/our_spec_and_decisions/decisions/7/args/spec/output`）：

```text
占比百分点变化最小的产品名称
```
逐字比较依据

**spec 原文**（卷宗第 36 行，`/our_spec_and_decisions/decisions/6/args/decisionProposals/9/alternatives/0/statement`）：

```text
输出单个产品
```
逐字比较依据

**spec 原文**（卷宗第 36 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "3", "hardConstraints": [], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
实际快照空约束/空合同，不能声称前轮待定已成功采纳

**standard 原文**（卷宗第 36 行，`/standard_semantics/facets/ranking/alternatives/1/orderBy`）：

```text
share change ASC
```
标准以share change本身升序，而不是ABS变化量升序

**sql 原文**（卷宗第 36 行，`/final_sql`）：

```text
ROUND(ABS(r.sh20 - r.sh19) * 100, 4) AS pp_change
```
实际度量列把有符号变化改成绝对变化幅度

**spec 原文**（卷宗第 36 行，`/our_spec_and_decisions/decisions/7/args/spec/metric`）：

```text
产品销售额占比的百分点变化
```
最后可见参数定义百分点变化，没有绝对值运算

**证据限制**：
- gold_sql=null；实际数据是否所有候选变化同号未知，不量化ABS改变排名的影响。
- 早期绝对差假设被末次空hypotheses替代的意图可见，但无返回/选取证据；不能证明成功生效。
- 实际spec_info为空业务合同，实施错判断是相对最后可见参数与标准的对比，不是已采纳Spec的运行时认证。

### 37. local064

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：37。
- 分叉节点：**population.time**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：2020每个客户、每个月计算净存取款，按正余额人数选极值月，均值覆盖全部客户。
- SQL 实际：months只取mb出现月份，修订为observed months Jan-Apr；五列保留两位。
- 最早分叉依据：时间域仅观测月而非全部12月，先于均值与选取；存取款定义和全客户网格本身正确。
- 错误层依据：修订主动把时间域缩为观测月份，SQL跟随。
- 可见性依据：完整检查spec_info和2次decisions；time直接值没有证据支持缩为四月，假定错。
- 其他差异：["output"]

**standard 原文**（卷宗第 37 行，`/instruction`）：

```text
For each customer and each month of 2020
```
完整年度

**sql 原文**（卷宗第 37 行，`/final_sql`）：

```text
months AS (SELECT DISTINCT mth FROM mb)
```
仅观测月份

**spec 原文**（卷宗第 37 行，`/our_spec_and_decisions/decisions/1/args/spec/time/value/expression`）：

```text
strftime('%Y', txn_date) = '2020'; observed months 2020-01 .. 2020-04
```
收窄月份范围

**spec 原文**（卷宗第 37 行，`/our_spec_and_decisions/decisions/1/args/spec/groupBy/0/expression`）：

```text
customer_id x calendar month of 2020 (full grid over all customers; a customer with no transaction in a month has balance 0)
```
全客户补零声明

**证据限制**：
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 38. local065

- 运行：`answer-plan-phase6-new-on-r1`；卷宗行：38。
- 分叉节点：**measure.formula**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：非取消披萨收入为12/10美元基础价加每份1美元加料费之和。
- SQL 实际：导出订单行和extra_count，没有金额与总收入SUM。
- 最早分叉依据：有效订单关联不是已证上游错；先缺收入公式，再导致输出明细。
- 错误层依据：Spec明确total income=sum of pizza prices+extras fees，SQL只有计数明细，违背正确声明。
- 可见性依据：完整检查spec_info和2次decisions；指标声明正确，五种错误可见性不适用，taxonomy_gap。
- 其他差异：["output"]

**standard 原文**（卷宗第 38 行，`/instruction`）：

```text
Calculate the total income from Meat Lovers pizzas priced at $12 and Vegetarian pizzas at $10. Include any extra toppings charged at $1 each.
```
收入公式

**sql 原文**（卷宗第 38 行，`/final_sql`）：

```text
WITH active_orders AS (
  SELECT order_id FROM pizza_clean_runner_orders
  WHERE cancellation IS NULL OR cancellation = ''
)
SELECT
  c.order_id,
  c.pizza_id,
  n.pizza_name,
  c.extras,
  (CASE WHEN c.extras IS NULL OR c.extras = '' THEN 0
        ELSE LENGTH(c.extras) - LENGTH(REPLACE(c.extras, ',', '')) + 1 END) AS extra_count
FROM pizza_clean_customer_orders c
JOIN active_orders a ON c.order_id = a.order_id
JOIN pizza_names n ON n.pizza_id = c.pizza_id
ORDER BY c.order_id, c.rowid
```
仅明细，无总收入

**spec 原文**（卷宗第 38 行，`/our_spec_and_decisions/decisions/0/args/spec/metric`）：

```text
total income (sum of pizza prices + extras fees)
```
正确总收入声明

**证据限制**：
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 39. local066

- 运行：`answer-plan-phase6-new-on-r1`；卷宗行：39。
- 分叉节点：**population.conditions**；错误层：**标准答案有问题**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：只统计已送达披萨，配料为基础减排除项加额外项。
- SQL 实际：Pred筛送达；Gold从全体clean_customer_orders扩配料，没有runner关联或取消过滤。
- 最早分叉依据：Gold在配料运算前漏送达资格条件；不能把Pred排取消反归为错。
- 错误层依据：题面/标准明确delivered，Gold全文没有送达条件，直接矛盾。
- 可见性依据：完整检查spec_info和3次decisions；delivered正确声明，Gold错不属于五种错误声明，taxonomy_gap。

**standard 原文**（卷宗第 39 行，`/instruction`）：

```text
the pizzas we delivered
```
送达条件

**standard 原文**（卷宗第 39 行，`/standard_semantics/facets/filters/required/0/semanticPredicate`）：

```text
pizza delivery status = delivered
```
标准送达谓词

**standard 原文**（卷宗第 39 行，`/standard_semantics/gold_sql`）：

```text
WITH cte_cleaned_customer_orders AS (
    SELECT
        *,
        ROW_NUMBER() OVER () AS original_row_number
    FROM 
        pizza_clean_customer_orders
),
split_regular_toppings AS (
    SELECT
        pizza_id,
        TRIM(SUBSTR(toppings, 1, INSTR(toppings || ',', ',') - 1)) AS topping_id,
        SUBSTR(toppings || ',', INSTR(toppings || ',', ',') + 1) AS remaining_toppings
    FROM 
        pizza_recipes
    UNION ALL
    SELECT
        pizza_id,
        TRIM(SUBSTR(remaining_toppings, 1, INSTR(remaining_toppings, ',') - 1)) AS topping_id,
        SUBSTR(remaining_toppings, INSTR(remaining_toppings, ',') + 1) AS remaining_toppings
    FROM 
        split_regular_toppings
    WHERE
        remaining_toppings <> ''
),
cte_base_toppings AS (
    SELECT
        t1.order_id,
        t1.customer_id,
        t1.pizza_id,
        t1.order_time,
        t1.original_row_number,
        t2.topping_id
    FROM 
        cte_cleaned_customer_orders AS t1
    LEFT JOIN 
        split_regular_toppings AS t2
    ON 
        t1.pizza_id = t2.pizza_id
),
split_exclusions AS (
    SELECT
        order_id,
        customer_id,
        pizza_id,
        order_time,
        original_row_number,
        TRIM(SUBSTR(exclusions, 1, INSTR(exclusions || ',', ',') - 1)) AS topping_id,
        SUBSTR(exclusions || ',', INSTR(exclusions || ',', ',') + 1) AS remaining_exclusions
    FROM 
        cte_cleaned_customer_orders
    WHERE 
        exclusions IS NOT NULL
    UNION ALL
    SELECT
        order_id,
        customer_id,
        pizza_id,
        order_time,
        original_row_number,
        TRIM(SUBSTR(remaining_exclusions, 1, INSTR(remaining_exclusions, ',') - 1)) AS topping_id,
        SUBSTR(remaining_exclusions, INSTR(remaining_exclusions, ',') + 1) AS remaining_exclusions
    FROM 
        split_exclusions
    WHERE
        remaining_exclusions <> ''
),
split_extras AS (
    SELECT
        order_id,
        customer_id,
        pizza_id,
        order_time,
        original_row_number,
        TRIM(SUBSTR(extras, 1, INSTR(extras || ',', ',') - 1)) AS topping_id,
        SUBSTR(extras || ',', INSTR(extras || ',', ',') + 1) AS remaining_extras
    FROM 
        cte_cleaned_customer_orders
    WHERE 
        extras IS NOT NULL
    UNION ALL
    SELECT
        order_id,
        customer_id,
        pizza_id,
        order_time,
        original_row_number,
        TRIM(SUBSTR(remaining_extras, 1, INSTR(remaining_extras, ',') - 1)) AS topping_id,
        SUBSTR(remaining_extras, INSTR(remaining_extras, ',') + 1) AS remaining_extras
    FROM 
        split_extras
    WHERE
        remaining_extras <> ''
),
cte_combined_orders AS (
    SELECT 
        order_id,
        customer_id,
        pizza_id,
        order_time,
        original_row_number,
        topping_id
    FROM 
        cte_base_toppings
    WHERE topping_id NOT IN (SELECT topping_id FROM split_exclusions WHERE split_exclusions.order_id = cte_base_toppings.order_id)
    UNION ALL
    SELECT 
        order_id,
        customer_id,
        pizza_id,
        order_time,
        original_row_number,
        topping_id
    FROM 
        split_extras
)
SELECT
    t2.topping_name,
    COUNT(*) AS topping_count
FROM 
    cte_combined_orders AS t1
JOIN 
    pizza_toppings AS t2
ON 
    t1.topping_id = t2.topping_id
GROUP BY 
    t2.topping_name
ORDER BY 
    topping_count DESC;
```
Gold无送达过滤

**sql 原文**（卷宗第 39 行，`/final_sql`）：

```text
WHERE c.order_id IN (SELECT order_id FROM delivered)
```
Pred送达过滤

**spec 原文**（卷宗第 39 行，`/our_spec_and_decisions/decisions/2/args/spec/filters/0`）：

```text
delivered orders only: exclude cancelled (cancellation not null)
```
正确送达声明

**证据限制**：
- Gold排除项按order_id关联、Pred成员标记不计重复extra次数均有疑点，但缺相关全集，不替代最早送达分叉。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 40. local067

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：40。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：意大利客户2021-12利润十等分，每层最高/最低。
- SQL 实际：按客户sum(amount_sold-quantity*unit_cost)，NTILE按利润升序，每层MAX/MIN。
- 最早分叉依据：标准未给利润物理列或分层方向；不同利润/层号不足证明来源、资格、公式或连接错。
- 错误层依据：不从不同值倒推Gold用了收入或其它成本列，四层暂不定。
- 可见性依据：完整检查spec_info与10次decisions；减成本Choice有select意图、ASC明确，但没有证据证明声明错。

**standard 原文**（卷宗第 40 行，`/instruction`）：

```text
Can you provide the highest and lowest profits for Italian customers segmented into ten evenly divided tiers based on their December 2021 sales profits?
```
完整题面

**sql 原文**（卷宗第 40 行，`/final_sql`）：

```text
WITH cust_profit AS (
  SELECT s.cust_id,
         SUM(s.amount_sold) - SUM(s.quantity_sold * c.unit_cost) AS profit
  FROM sales s
  JOIN customers cu ON s.cust_id = cu.cust_id
  JOIN countries co ON cu.country_id = co.country_id
  JOIN costs c ON c.prod_id = s.prod_id
              AND c.time_id = s.time_id
              AND c.channel_id = s.channel_id
              AND c.promo_id = s.promo_id
  WHERE co.country_name = 'Italy'
    AND s.time_id >= '2021-12-01'
    AND s.time_id <= '2021-12-31'
  GROUP BY s.cust_id
),
tiered AS (
  SELECT cust_id,
         profit,
         NTILE(10) OVER (ORDER BY profit ASC, cust_id ASC) AS tier
  FROM cust_profit
)
SELECT tier,
       ROUND(MAX(profit), 2) AS highest_profit,
       ROUND(MIN(profit), 2) AS lowest_profit
FROM tiered
GROUP BY tier
ORDER BY tier
```
公式分层

**spec 原文**（卷宗第 40 行，`/our_spec_and_decisions/decisions/8/args/dispositions/6/rationale`）：

```text
题面 'segmented into ten evenly divided tiers' 要求输出十个分层，'the highest and lowest profits' 指每层内的最高与最低利润。候选 a-overall 只给全体最高/最低两个值，丢弃十层分层信息，与 'ten evenly divided tiers' 不符。
```
选择减成本意图

**spec 原文**（卷宗第 40 行，`/our_spec_and_decisions/decisions/3/args/spec/groupBy/0/value`）：

```text
2021-12 客户利润十等分分层 NTILE(10) ORDER BY profit ASC
```
ASC分层声明

**result 原文**（卷宗第 40 行，`/gold_results/0/csv_info/head/0/1`）：

```text
785.1500000000001
```
Gold层1值

**证据限制**：
- 需补Gold利润表达式、连接键、资格客户集、NTILE方向及完整结果；不能当字段树缺口。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 41. local068

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：41。
- 分叉节点：**output**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：输出2022/2023年、月名、计数、跨年累计及同比百分数。
- SQL 实际：运算/基线正确，输出数字月和一位小数同比。
- 最早分叉依据：无可证总体/计数/窗口错；分叉在标准月名输出与精度，不因排序不同猜公式错。
- 错误层依据：没有正确月名/精度声明可证明实现违背，归输出读法。
- 可见性依据：完整检查spec_info={}和decisions=[]，仅卷宗节点未声明；这是记录缺失，不断言运行时漏声明。

**standard 原文**（卷宗第 41 行，`/standard_semantics/facets/output/alternatives/0/columnNames/1`）：

```text
month_name
```
月名标准

**result 原文**（卷宗第 41 行，`/gold_results/1/csv_info/head/0/4`）：

```text
-4.708222811671088
```
标准精度

**sql 原文**（卷宗第 41 行，`/final_sql`）：

```text
mo AS month
```
数字月输出

**sql 原文**（卷宗第 41 行，`/final_sql`）：

```text
ROUND(100.0 * (cities_added - prev_added) / prev_added, 1)
```
一位精度

**spec 原文**（卷宗第 41 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
空记录

**spec 原文**（卷宗第 41 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
无决定

**证据限制**：
- 题面未明确小数位；已证月名形状分叉，精度差仅以标准结果佐证。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec={}且decisions=[]是记录缺失，不证明运行时从未声明。

### 42. local070

- 运行：`decide-10-20260926-deepseek-r1`；卷宗行：42。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：中国城市2021-07最长/最短自然日连续段，每日期仅一城市记录且规范大小写。
- SQL 实际：去重日期构造段，选最长/最短，同日期取MIN(city_name)。
- 最早分叉依据：Gold城市名不同但标准未指定多城市择一规则；不能倒推MAX/rowid或证明连续段/实体错。
- 错误层依据：缺代表行标准约束，无法判口径错还是Gold规则不同。
- 可见性依据：完整检查spec_info及3次decisions，有两候选与MIN选择意图，但不能证明决定错误。

**standard 原文**（卷宗第 42 行，`/instruction`）：

```text
return exactly one record per date along with the corresponding city name
```
未指定择一规则

**sql 原文**（卷宗第 42 行，`/final_sql`）：

```text
SELECT insert_date, MIN(city_name) AS city_name
```
择一实际

**spec 原文**（卷宗第 42 行，`/our_spec_and_decisions/decisions/2/args/dispositions/2/rationale`）：

```text
题面只要求“exactly one record per date”，未规定同一日期多条记录时取哪一条；两种探针输出（最小/最大 city_name）均满足题面，无法由题面排出其一。选择取 city_name 字典序最小的记录：它是稳定、可复现且不依赖物理存储顺序的确定规则，与“ordered by date”的输出要求兼容。该决定未获用户确认，属未证实假设，将在交付时披露。
```
承认题面未规定并选MIN

**result 原文**（卷宗第 42 行，`/gold_results/0/csv_info/head/0/1`）：

```text
Xiaoganzhan
```
Gold城市

**result 原文**（卷宗第 42 行，`/predicted_result/csv_info/head/0/1`）：

```text
Gaotan
```
Pred城市

**证据限制**：
- 需补同日期代表城市规则与GoldSQL；不同名不证明Gold错。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 43. local073

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：43。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：标准六列含pizza_id、order_time及配料字符串。
- SQL 实际：SQL五列row_id/order_id/customer_id/pizza_name/toppings，逗号不带空格。
- 最早分叉依据：不能证明raw/clean是不同总体；已知分叉在六列vs五列及字符串格式，不自动判source。
- 错误层依据：Spec一直声明五列，SQL跟随，非正确六列被违背。
- 可见性依据：完整检查spec_info和4次decisions；output直接值/模型H6，没有引文支持丢pizza_id/order_time，假定错。

**standard 原文**（卷宗第 43 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["order_id", "customer_id", "pizza_id", "order_time", "original_row_number", "toppings"]
```
标准六列

**sql 原文**（卷宗第 43 行，`/final_sql`）：

```text
SELECT q.row_id, q.order_id, q.customer_id, q.pizza_name,
```
五列前四列

**sql 原文**（卷宗第 43 行，`/final_sql`）：

```text
SELECT group_concat(tok, ',')
```
无空格分隔

**spec 原文**（卷宗第 43 行，`/our_spec_and_decisions/decisions/3/args/spec/output`）：

```text
列: row_id, order_id, customer_id, pizza_name, toppings(格式='pizza_name: 配料(倍数带2x前置,倍数在前字母升序)')
```
五列声明

**spec 原文**（卷宗第 43 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
toppings 列表单元格头部列名；倍数配料以'2x '前缀置前，字母升序；最终以排序后的 group_concat 逗号连接成单一文本
```
字符串假设

**证据限制**：
- 不臆断raw来源错误；重复extras成员算法可能丢次数，但无相关全集。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 44. local077

- 运行：`semantic-spec-30-20260925-deepseek-required-subagent-v2`；卷宗行：44。
- 分叉节点：**population.time**；错误层：**口径错**；可见性：**题面引用错**。
- 状态：`classified`；置信：`high`。
- 标准：计算2018-07至2019-08，显示2018-09至2019-08，保留前两月滚动/lag上下文。
- SQL 实际：窗口计算前就WHERE从2018-09起，9月rolling自身且lag空。
- 最早分叉依据：计算总体时间先截断，非ROWS窗口语法/分母错误。
- 错误层依据：声明把展示期当计算时间端点，SQL跟随另一读法。
- 可见性依据：完整检查spec_info及4次decisions；time引用rw-window只支持分析期，不支持排历史。Choice仅provisional无明确select，不称最终选定。
- 其他差异：["output"]

**standard 原文**（卷宗第 44 行，`/standard_semantics/facets/time/alternatives/0/calculationWindow`）：

```text
2018-07 through 2019-08
```
计算历史

**standard 原文**（卷宗第 44 行，`/standard_semantics/facets/time/alternatives/0/displayWindow`）：

```text
2018-09 through 2019-08
```
展示期

**sql 原文**（卷宗第 44 行，`/final_sql`）：

```text
AND ((im._year = 2018 AND im._month BETWEEN 9 AND 12)
      OR (im._year = 2019 AND im._month BETWEEN 1 AND 8))
```
计算前过滤

**spec 原文**（卷宗第 44 行，`/our_spec_and_decisions/decisions/1/args/spec/time/value/expression`）：

```text
month_year (MM-YYYY), chronological order by _year,_month; inclusive endpoints 09-2018 and 08-2019
```
时间端点声明

**spec 原文**（卷宗第 44 行，`/our_spec_and_decisions/decisions/1/args/evidence/0/quote`）：

```text
analyze our interest data from September 2018 to August 2019
```
引用分析期

**证据限制**：
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 45. local078

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：45。
- 分叉节点：**selection**；错误层：**口径错**；可见性：**题面引用错**。
- 状态：`classified`；置信：`high`。
- 标准：每类跨月最高composition选top10与bottom10两组。
- SQL 实际：max_rows后只rdesc<=10，没有bottom10。
- 最早分叉依据：最高值计算基本正确；分叉在选取仅top10，不是总体或并列。
- 错误层依据：实际spec_info硬契约top_n/10仅支持一组，SQL跟随。
- 可见性依据：完整检查spec_info和空decisions；契约以整题request_wording绑定10，却忽略bottom10。虽挂output，内容是取对象数，题面引用错。
- 其他差异：["output"]

**standard 原文**（卷宗第 45 行，`/instruction`）：

```text
Identify the top 10 and bottom 10 interest categories
```
两组选择

**sql 原文**（卷宗第 45 行，`/final_sql`）：

```text
WHERE rdesc <= 10
```
只选十个

**spec 原文**（卷宗第 45 行，`/our_spec_and_decisions/spec_info/answerContract/output/value`）：

```text
{"columns": [], "rowMode": "top_n", "rowCount": 10}
```
十个对象契约

**spec 原文**（卷宗第 45 行，`/our_spec_and_decisions/spec_info/answerContract/output/quote`）：

```text
Identify the top 10 and bottom 10 interest categories
```
错误引用支持十行

### 46. local081

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：46。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：1998客户分档人数，以及每档人数/1998全体客户人数的百分数。
- SQL 实际：正确spend及四档人数，无百分数表达式。
- 最早分叉依据：档计数与Gold一致；不归总体/阈值，先缺百分数度量，再宽表输出。
- 错误层依据：没有正确百分数声明可供证明实现违背，SQL采用只有人数的简化读法。
- 可见性依据：完整检查spec_info两hardConstraints、空假设/歧义、scalar输出契约及空decisions；百分数公式未声明，scalar契约不等于公式声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 46 行，`/standard_semantics/facets/measure/alternatives/2/expression`）：

```text
group customer count divided by all customers who ordered in 1998
```
百分数要求

**sql 原文**（卷宗第 46 行，`/final_sql`）：

```text
WITH customer_spend AS (
  SELECT o.customerid, SUM(od.unitprice * od.quantity) AS spend
  FROM orders o
  JOIN order_details od ON o.orderid = od.orderid
  WHERE strftime('%Y', o.orderdate) = '1998'
  GROUP BY o.customerid
)
SELECT COUNT(*) AS total_customers,
       SUM(CASE WHEN spend >= 10000 THEN 1 ELSE 0 END) AS veryhigh,
       SUM(CASE WHEN spend >= 5000 AND spend < 10000 THEN 1 ELSE 0 END) AS high,
       SUM(CASE WHEN spend >= 1000 AND spend < 5000 THEN 1 ELSE 0 END) AS medium,
       SUM(CASE WHEN spend < 1000 THEN 1 ELSE 0 END) AS low
FROM customer_spend;
```
完整SQL无百分数

**spec 原文**（卷宗第 46 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [{"id": "HC-1", "statement": "orders in 1998", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}, {"id": "HC-2", "statement": "products in their", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}], "hypotheses": [], "ambiguities": [], "answerContract": {"output": {"value": {"columns": [], "rowMode": "scalar", "rowCount": 1}, "binding": "hard", "provenance": {"authority": "request_wording", "source": "legacy-answer-shape"}, "quote": "Considering only the customers who placed orders in 1998, calculate the total amount each customer spent by summing the unit price multiplied by the quantity of all products in their orders, excluding any discounts. Assign each customer to a spending group based on the customer group thresholds, and determine how many customers are in each spending group and what percentage of the total number of customers who placed orders in 1998 each group represents.\n\n请完成原始题目，并将最终成果导出为 CSV。只导出回答题目所需的最终结果，不要导出中间结果、候选数据或诊断字段；本次评测需要使用 export_query 生成 CSV，不要用 publish_query_result 代替。"}}}
```
完整Spec覆盖，不借空数组泛化

**证据限制**：
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。

### 47. local085

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：47。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：每员工迟发占全部订单百分数100*a/b，订单>50取前三。
- SQL 实际：条件/计数/分母正确，但仅1.0*a/b为ratio。
- 最早分叉依据：无总体、条件、计数对象或分母错；op由percentage变ratio，ADR量纲运算归formula而非output。
- 错误层依据：无正确percentage公式声明，不能证明是实现违背。
- 可见性依据：完整检查spec_info全部版本/约束/假设/歧义/契约与decisions=[]，公式未声明，不借无关n/a。

**standard 原文**（卷宗第 47 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
late-order count divided by total orders per employee
```
百分数语义

**standard 原文**（卷宗第 47 行，`/standard_semantics/facets/unit/alternatives/0/units/1`）：

```text
percent
```
percent单位

**sql 原文**（卷宗第 47 行，`/final_sql`）：

```text
1.0 * SUM(CASE WHEN o.shippeddate IS NOT NULL AND o.shippeddate >= o.requireddate THEN 1 ELSE 0 END) / COUNT(*) AS late_order_percentage
```
ratio而非percentage

**spec 原文**（卷宗第 47 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
完整Spec无公式

**证据限制**：
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。

### 48. local096

- 运行：`answer-plan-phase6-new-on-r1`；卷宗行：48。
- 分叉节点：**grouping**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：Movie.year尾四位转数字按年汇总，分母每年全影片。
- SQL 实际：SELECT投影规范年，但GROUP BY year与输入film_class.year同名，实际按原始文本分组。
- 最早分叉依据：无证据证明全影片分母或unknown排除错；SQLite输入列优先同名投影别名，原始编码多组，最早可证grouping。
- 错误层依据：Spec反复声明last4 cast年分组，SQL却引用raw year，正确声明实现违背。
- 可见性依据：完整检查spec_info及3次decisions，年规范化正确声明，没有五类错误可见性，taxonomy_gap。
- 其他差异：["output"]

**standard 原文**（卷宗第 48 行，`/instruction`）：

```text
Extract the year from the Movie.year field by taking the last 4 characters and converting to a number.
```
年规范化

**sql 原文**（卷宗第 48 行，`/final_sql`）：

```text
SELECT CAST(substr(year, LENGTH(year) - 3) AS INTEGER) AS year,
```
数字年投影

**sql 原文**（卷宗第 48 行，`/final_sql`）：

```text
FROM film_class
GROUP BY year
```
同名原始列分组

**spec 原文**（卷宗第 48 行，`/our_spec_and_decisions/decisions/2/args/spec/time`）：

```text
year (last 4 chars of Movie.year cast to integer)
```
数字年声明

**spec 原文**（卷宗第 48 行，`/our_spec_and_decisions/decisions/2/args/spec/groupBy/0`）：

```text
year
```
按年分组声明

**证据限制**：
- 列解析解释基于SQLite规则，未查数据库；Gold只有head，不能保证该分叉解释所有全女性比例差。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 49. local097

- 运行：`spider2-29-gpt-6-luna-20260923-001`；卷宗行：49。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：每个出现的release year作候选起年，含首年连续十年，取计数最大。
- SQL 实际：候选要求纯四位year并直接CAST，start..start+9；2008计数1128，Gold1205。
- 最早分叉依据：十年窗口/计数符合题面；无本题year编码/GoldSQL，不能证明格式过滤丢哪类影片或猜隐藏清洗。
- 错误层依据：仅计数不匹配不足判conditions/timeField/countGrain或数据错。
- 可见性依据：完整检查spec_info和2次decisions，year-format假设可见但未证错，三项留空。

**standard 原文**（卷宗第 49 行，`/instruction`）：

```text
Could you analyze our data and identify which ten-year period starting from any movie release year present in the data had the largest number of films, considering consecutive ten-year periods beginning at each unique year? Only output the start year and the total count for that specific period.
```
十年期定义

**sql 原文**（卷宗第 49 行，`/final_sql`）：

```text
WITH years AS (SELECT DISTINCT CAST(year AS INTEGER) AS y FROM Movie WHERE year GLOB '[0-9][0-9][0-9][0-9]'), counts AS (SELECT s.y AS start_year, COUNT(m.MID) AS total_count FROM years s JOIN Movie m ON CAST(m.year AS INTEGER) BETWEEN s.y AND s.y + 9 GROUP BY s.y) SELECT start_year, total_count FROM counts ORDER BY total_count DESC, start_year ASC LIMIT 1
```
纯数字过滤及CAST

**spec 原文**（卷宗第 49 行，`/our_spec_and_decisions/decisions/0/args/hypotheses/0/statement`）：

```text
Movie.year contains values interpretable as integer release years
```
整数年份假设

**result 原文**（卷宗第 49 行，`/gold_results/0/csv_info/head/0/1`）：

```text
1205
```
Gold计数

**result 原文**（卷宗第 49 行，`/predicted_result/csv_info/head/0/1`）：

```text
1128
```
Pred计数

**证据限制**：
- 需补本题release year实际编码、GoldSQL及清洗规则；不跨卷宗借别题格式观测。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 50. local098

- 运行：`answer-plan-phase6-new-on-r1`；卷宗行：50。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：演员首末影片之间不存在连续四年空白；相邻出演年差<=4等价。
- SQL 实际：PID去重年、LAG年差、MAX(COALESCE(gap,0))<=4，计数28699对Gold32585。
- 最早分叉依据：gap<=4符合题面且纳入单年演员；无GoldSQL/异常年全集，不猜错在阈值、资格或过滤。
- 错误层依据：SQL符合核心规则，只有总数不同，四层暂空。
- 可见性依据：完整检查spec_info及2次decisions；gap正确，尾四位过滤提议明确，但没有证据证明它错。

**standard 原文**（卷宗第 50 行，`/instruction`）：

```text
meaning there is no four-year span anywhere in their active career without at least a single film credit
```
空档定义

**sql 原文**（卷宗第 50 行，`/final_sql`）：

```text
HAVING MAX(COALESCE(gap,0)) <= 4
```
正确等价阈值

**sql 原文**（卷宗第 50 行，`/final_sql`）：

```text
WITH cast_year AS (
    SELECT DISTINCT mc.PID,
           CAST(substr(mv.year, -4) AS INTEGER) AS yr
    FROM M_Cast mc
    JOIN Movie mv ON mv.MID = mc.MID
    WHERE mv.year IS NOT NULL
      AND length(mv.year) >= 4
      AND substr(mv.year, -4) GLOB '[0-9][0-9][0-9][0-9]'
),
yr_gap AS (
    SELECT PID,
           yr - LAG(yr) OVER (PARTITION BY PID ORDER BY yr) AS gap
    FROM cast_year
),
qual AS (
    SELECT PID
    FROM yr_gap
    GROUP BY PID
    HAVING MAX(COALESCE(gap,0)) <= 4
)
SELECT (SELECT COUNT(*) FROM qual) AS qualifying_actor_count;
```
完整流程

**spec 原文**（卷宗第 50 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
判定口径：将某演员各异出演年份排序，若任意相邻出演年份差>4年，则中间存在≥4个连续无出演年份，即违反“无超3年空档”；所有相邻年份差≤4则符合资格
```
正确gap定义

**result 原文**（卷宗第 50 行，`/gold_results/0/csv_info/head/0/0`）：

```text
32585
```
Gold数

**result 原文**（卷宗第 50 行，`/predicted_result/csv_info/head/0/0`）：

```text
28699
```
Pred数

**证据限制**：
- 需补Gold演员资格、异常/缺失年处理和影片演员键规范化；过滤存在不等于过滤错。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 51. local099

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：51。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：计数与Yash合作数严格超过任意其他导演的演员；Gold计数107。
- SQL 实际：final_sql为前5演员的姓名、yc/other数与YES/NO诊断；predicted_result却单列actor_count=107。
- 最早分叉依据：SQL与CSV形状不对应，不能把诊断当当前CSV最终候选并定错因。
- 错误层依据：记录错配/候选绑定不明，四层不能裁定，不因timeout自动归方言数据。
- 可见性依据：完整检查spec_info={}及decisions=[]，无法恢复真正候选声明，三项留空。

**standard 原文**（卷宗第 51 行，`/instruction`）：

```text
tell me how many actors have made more films with Yash Chopra than with any other director
```
标量计数

**standard 原文**（卷宗第 51 行，`/standard_semantics/gold_sql`）：

```text
COUNT(DISTINCT TRIM(P.PID))
```
Gold演员计数

**sql 原文**（卷宗第 51 行，`/final_sql`）：

```text
SELECT p.Name, a.yc_films, a.max_other_films,
```
多列诊断

**sql 原文**（卷宗第 51 行，`/final_sql`）：

```text
SELECT a2.actor_pid FROM per_actor a2 ORDER BY a2.yc_films DESC LIMIT 5
```
前五诊断

**spec 原文**（卷宗第 51 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
缺失Spec

**result 原文**（卷宗第 51 行，`/predicted_result/csv_info`）：

```text
{"exists": true, "rows": 1, "cols": 1, "header": ["actor_count"], "head": [["107"]]}
```
CSV标量107与SQL不相符

**证据限制**：
- 需补真正导出CSV的SQL、候选ID与时间绑定；CSV值与Gold相同，列名不同不证明业务错。
- Spec={}且decisions=[]是记录缺失，不证明运行时从未声明。

### 52. local100

- 运行：`answer-plan-phase6-new-on-r1`；卷宗行：52。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：共演图相对Shahrukh最短距离恰2，排直接共演者及本人。
- SQL 实际：根Shah Rukh Khan，递归两层后MIN(d)=2计数，25698对Gold15911。
- 最早分叉依据：最短距离算法符合题面；无GoldSQL不能猜额外资格、TRIM(MID)或不同根。
- 错误层依据：无证据证明语义/实现/方言缺陷，四层不定。
- 可见性依据：完整检查spec_info及4次decisions，根/PID trim/最短距离可见但不能证明错。

**standard 原文**（卷宗第 52 行，`/instruction`）：

```text
Find out how many actors have a 'Shahrukh number' of 2? This means they acted in a film with someone who acted with Shahrukh Khan, but not directly with him.
```
距离定义

**sql 原文**（卷宗第 52 行，`/final_sql`）：

```text
WITH RECURSIVE
srk AS (
  SELECT TRIM(mc.PID) AS pid
  FROM M_Cast mc
  JOIN Person p ON TRIM(p.PID) = TRIM(mc.PID)
  WHERE TRIM(p.Name) = 'Shah Rukh Khan' AND p.Gender = 'Male'
),
bfs(pid, d) AS (
  SELECT pid, 0 AS d FROM srk
  UNION
  SELECT DISTINCT TRIM(mc2.PID) AS pid, r.d + 1 AS d
  FROM bfs r
  JOIN M_Cast mc1 ON TRIM(mc1.PID) = r.pid
  JOIN M_Cast mc2 ON mc2.MID = mc1.MID AND TRIM(mc2.PID) <> r.pid
  WHERE r.d < 2
),
mindist AS (
  SELECT pid, MIN(d) AS dist
  FROM bfs
  GROUP BY pid
)
SELECT COUNT(*) AS actors_with_shahrukh_number_2
FROM mindist
WHERE dist = 2;
```
递归最短距离

**spec 原文**（卷宗第 52 行，`/our_spec_and_decisions/decisions/3/args/spec/metric`）：

```text
count of distinct actors (trimmed PID) whose shortest Shahrukh number distance = 2
```
最短距离声明

**spec 原文**（卷宗第 52 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
根节点选取：以规范名 'Shah Rukh Khan'（著名宝莱坞演员，Male）的 Person 匹配 M_Cast 共算边；因为 M_Cast.PID 含头尾空格，所有 PID 比较需先 TRIM。演员以共享同一 MID 定义'共演'边。
```
根共演定义

**result 原文**（卷宗第 52 行，`/gold_results/0/csv_info/head/0/0`）：

```text
15911
```
Gold数

**result 原文**（卷宗第 52 行，`/predicted_result/csv_info/head/0/0`）：

```text
25698
```
Pred数

**证据限制**：
- 需补Gold根ID、图边、演员资格、键清洗与真实候选绑定；timeout不解释数量差。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 53. local114

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：53。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：按region报告订单数、销售额与最高销售额代表，并列全保留。
- SQL 实际：关联web_orders求COUNT(*)与SUM，代表sum后MAX；金额/代表同Gold但订单数不同。
- 最早分叉依据：无GoldSQL不能由9/21/10/10推断Gold数代表/账户；SQL数订单符合题面，COUNT(*)与Spec distinct差只有证实重复键/放大才可定错，卷宗无此证据。
- 错误层依据：没有证实源替换、连接放大或计数对象错，层不定。
- 可见性依据：完整检查spec_info和1次decision，distinct订单明确；不把未证count*差当实现错或假定错。

**standard 原文**（卷宗第 53 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
web order count per region
```
标准订单计数

**sql 原文**（卷宗第 53 行，`/final_sql`）：

```text
COUNT(*) AS order_count
```
数订单关联行

**spec 原文**（卷宗第 53 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
区域销售总额 = 该区域内所有账户全部订单 total_amt_usd 之和；区域订单数 = 这些订单的 distinct 订单数。
```
distinct订单数声明

**result 原文**（卷宗第 53 行，`/gold_results/0/csv_info/head/0/1`）：

```text
9
```
Gold Midwest9

**result 原文**（卷宗第 53 行，`/predicted_result/csv_info/head/1/1`）：

```text
897
```
Pred Midwest897

**证据限制**：
- 需补Gold计数对象/SQL、web_orders主键和连接基数；不假称数据库重复，不把计数差自动归总体资格。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 54. local130

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：54。
- 分叉节点：**population.entity**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：标准student-course粒度，每English完成课程个人成绩，>=人数/总人数划20%区间。
- SQL 实际：按StudentID取MAX成绩，一学生一行，再NTILE(5)硬分五组。
- 最早分叉依据：先合并student-course为student实体，之后才MAX和NTILE；ENG/ClassStatus=2无可证错，不因null filter存在强判资格错。
- 错误层依据：H5明确单学生一行，SQL跟随，与标准粒度不同。
- 可见性依据：完整检查spec_info及3次decisions，H5 expected模型假定粒度，无合格题面依据，假定错。
- 其他差异：["measure.formula"]

**standard 原文**（卷宗第 54 行，`/standard_semantics/facets/grain/alternatives/0/entity`）：

```text
student-course
```
student-course标准

**standard 原文**（卷宗第 54 行，`/instruction`）：

```text
The quintile should be determined by calculating how many students have grades greater than or equal to each student's grade, then dividing this ranking by the total number of students who completed English courses.
```
明确排名公式

**sql 原文**（卷宗第 54 行，`/final_sql`）：

```text
MAX(sch.Grade) AS eng_grade
```
跨课程取最高

**sql 原文**（卷宗第 54 行，`/final_sql`）：

```text
GROUP BY st.StudentID, st.StudLastName
```
合并实体

**sql 原文**（卷宗第 54 行，`/final_sql`）：

```text
NTILE(5) OVER (ORDER BY eng_grade DESC, StudentID)
```
硬分组

**spec 原文**（卷宗第 54 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
Only one row per student for their completed English course grade
```
学生一行假设

**证据限制**：
- Gold head从Fifth起与题面First至Fifth不一致，但无GoldSQL，不凭head排序判标准答案错。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 55. local131

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：55。
- 分叉节点：**population.eligibility**；错误层：**标准答案有问题**；可见性：**定义缺口**。
- 状态：`classified`；置信：`medium`。
- 标准：题面list each musical style，每风格一行三档次数，未限定已有偏好。
- SQL 实际：Pred LEFT JOIN保留零偏好；Gold匹配偏好且HAVING三档至少一档>0，删零实体。
- 最早分叉依据：是否纳入零实体属eligibility非countGrain/source；先Gold资格排零，之后计数基本一致。
- 错误层依据：按each musical style字面，Gold额外限定有偏好风格，与全风格范围矛盾。
- 可见性依据：完整检查spec_info和5次decisions，all-styles选择意图符合字面，Gold问题不是五种错误可见性，taxonomy_gap。

**standard 原文**（卷宗第 55 行，`/instruction`）：

```text
list each musical style
```
全风格题面

**standard 原文**（卷宗第 55 行，`/standard_semantics/gold_sql`）：

```text
HAVING COUNT(FirstStyle) > 0
     OR     COUNT(SecondStyle) > 0
     OR     COUNT(ThirdStyle) > 0
```
Gold排零

**sql 原文**（卷宗第 55 行，`/final_sql`）：

```text
LEFT JOIN Musical_Preferences p ON p.StyleID = s.StyleID
```
纳入无偏好

**spec 原文**（卷宗第 55 行，`/our_spec_and_decisions/decisions/4/args/dispositions/0/rationale`）：

```text
题面限定对象是风格维表全体（list each musical style）。探针显示 Musical_Styles 共 25 个风格，其中 5 个（50's Music、Rap、Elvis、Karaoke、90's Music）从未出现在偏好表中；referenced-only（INNER JOIN）会整行删除这 5 个风格，与 each musical style 不符；all-styles（LEFT JOIN）保留全部 25 个风格并将未被选者计 0，符合字面要求，也与 compare_hypotheses 的明显倾向一致。
```
选择全风格正确字面意图

**证据限制**：
- each可能被标准解释为出现过的风格；标Gold问题依据无显式限制的字面范围，建议父协调者复核，不单凭行数判。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 56. local133

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：56。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：标准风格名称StyleName与加权分对平均分绝对差；题面限定至少一人排名风格。
- SQL 实际：只从Musical_Preferences汇总已排名StyleID，输出ID而非名称。
- 最早分叉依据：名称vsID是输出标识不同，不改变风格业务键，不归entity/source；Gold25行与题面已排名范围张力但无SQL，不定更早总体/分母。
- 错误层依据：H3明确不需要StyleName，SQL跟随，与标准名称列不同。
- 可见性依据：完整检查spec_info和2次decisions，H3以未请求名称作模型假定，无合格依据支持换标准名称为ID。

**standard 原文**（卷宗第 56 行，`/standard_semantics/facets/output/alternatives/0/columnNames/0`）：

```text
StyleName
```
标准名称

**standard 原文**（卷宗第 56 行，`/instruction`）：

```text
each musical style that has been ranked by at least one user
```
已排名范围

**sql 原文**（卷宗第 56 行，`/final_sql`）：

```text
SELECT StyleID,
       ABS(total_score - (SELECT AVG(total_score) FROM weighted)) AS AbsDifferenceFromAverage
```
输出ID

**spec 原文**（卷宗第 56 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
结果按 StyleID 标识风格，不要求连接 Musical_Styles 输出 StyleName 列。
```
不输出名称声明

**证据限制**：
- 25vs20及平均值差不能证明应加入未排名零分风格或换分母，不猜隐藏修复。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 57. local141

- 运行：`spec-names-10-20260927-deepseek-r1`；卷宗行：57。
- 分叉节点：**output**；错误层：**口径错**；可见性：**题面引用错**。
- 状态：`classified`；置信：`medium`。
- 标准：标准六列，SalesYear与SalesQuotaYear分别显示，并含金额/差值。
- SQL 实际：五列只显示Year，缺QuotaYear；sales采用subtotal。
- 最早分叉依据：可证输出缺列；无GoldSQL不能定totaldue/subtotal业务哪种正确，不自动判source或从金额不同猜更早formula。
- 错误层依据：Spec五列与SQL一致，标准六列与之不一致。
- 可见性依据：完整检查spec_info及2次decisions，五列引用q-org/q-diff；organized by salesperson and year不足支持删标准QuotaYear，题面引用错。

**standard 原文**（卷宗第 57 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["SalesPersonID", "SalesYear", "TotalSales", "SalesQuotaYear", "SalesQuota", "Amt_Above_or_Below_Quota"]
```
标准六列

**sql 原文**（卷宗第 57 行，`/final_sql`）：

```text
SELECT s.sp AS SalesPersonID,
       CAST(s.yr AS INTEGER) AS Year,
       ROUND(s.total, 2) AS TotalSales,
       ROUND(q.quota, 2) AS SalesQuota,
       ROUND(s.total - q.quota, 2) AS Difference
```
五列输出

**spec 原文**（卷宗第 57 行，`/our_spec_and_decisions/decisions/0/args/spec/output/value/columns`）：

```text
["SalesPersonID", "Year", "TotalSales", "SalesQuota", "Difference"]
```
五列声明

**spec 原文**（卷宗第 57 行，`/our_spec_and_decisions/decisions/0/args/evidence/3/quote`）：

```text
organized by salesperson and year
```
引用组织方式

**spec 原文**（卷宗第 57 行，`/our_spec_and_decisions/decisions/1/args/dispositions/0/rationale`）：

```text
题面只说 'total sales'/'annual total sales'，未指名金额列。选 salesorderheader.subtotal：它等于订单明细行 orderqty*unitprice*(1-unitpricediscount) 之和（观测：subtotal 合计 109,846,381.40 = 明细净额合计 109,846,381.40），是销售员产生的商品销售额；totaldue 为 subtotal+税+运费（合计 123,216,786.12），是客户应付总额，含非销售员销售额的税与运费，故不采用。
```
金额选择可见但缺Gold定义

**证据限制**：
- 需补Gold销售额表达式；subtotal/totaldue若确有错应归measure.formula金额成分，非population.source。当前只确定输出分叉。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 58. local152

- 运行：`semantic-spec-30-20260925-deepseek-required-subagent-v2`；卷宗行：58。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：average inter-movie duration为相邻电影时间间隔，标准单位days；另报片长总和。
- SQL 实际：AVG(movies.duration)求分钟片长均值，没有上映时间间隔。
- 最早分叉依据：director实体、电影计数/排名没有可证上游错；换间隔为片长是formula非source。
- 错误层依据：metric直接声明AVG(duration)，临时runtime候选与SQL一致，声明本身换了指标。
- 可见性依据：完整检查spec_info及3次decisions；duration仅provisionalAlternativeId，后续只改ranking，没有select/decide，假定错而非臆称待定已决定。
- 其他差异：["output"]

**standard 原文**（卷宗第 58 行，`/instruction`）：

```text
average inter-movie duration (rounded to the nearest integer)
```
电影间隔

**standard 原文**（卷宗第 58 行，`/standard_semantics/facets/unit/alternatives/0/units/0`）：

```text
days
```
days单位

**sql 原文**（卷宗第 58 行，`/final_sql`）：

```text
CAST(ROUND(AVG(dm.duration)) AS INTEGER) AS avg_duration
```
平均片长

**spec 原文**（卷宗第 58 行，`/our_spec_and_decisions/decisions/0/args/spec/metric/value/expression`）：

```text
COUNT(DISTINCT movie_id); AVG(movies.duration); AVG(ratings.avg_rating); SUM(ratings.total_votes); MIN(ratings.avg_rating); MAX(ratings.avg_rating); SUM(movies.duration)
```
片长公式声明

**spec 原文**（卷宗第 58 行，`/our_spec_and_decisions/decisions/0/args/choices/0/alternatives/0/statement`）：

```text
average inter-movie duration = 该导演全部电影的平均片长，即 AVG(movies.duration)（分钟），四舍五入到整数
```
runtime候选

**spec 原文**（卷宗第 58 行，`/our_spec_and_decisions/decisions/0/args/choices/0/provisionalAlternativeId`）：

```text
a-avg-runtime
```
仅临时不等于采纳

**证据限制**：
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 59. local156

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：59。
- 分叉节点：**population.conditions**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`high`。
- 标准：首年从变动输出排除，但次年同比须保留首年作前一年基线。
- SQL 实际：kept先WHERE yr>fy，chg再LAG，导致展示首年2018同比空。
- 最早分叉依据：最早是排首年条件作用阶段，计算总体先丢基线；price金额/BUY/BTC无已证上游错，不因列来自prices判source。
- 错误层依据：Choice明确keep/drop baseline，select理由选drop，把展示排除读成计算排除，SQL跟随。
- 可见性依据：完整检查spec_info及8次decisions，有两个候选与反复select意图，理由明确drop-base，待定后决定错；无返回不称已生效。
- 其他差异：["output"]

**standard 原文**（卷宗第 59 行，`/instruction`）：

```text
calculate the annual percentage change in cost for each region compared to the previous year
```
前一年基线

**standard 原文**（卷宗第 59 行，`/standard_semantics/facets/time/alternatives/0/window`）：

```text
all years except each region first year for change output
```
首年从change output排除

**sql 原文**（卷宗第 59 行，`/final_sql`）：

```text
WHERE p.yr > f.fy
```
先排首年

**sql 原文**（卷宗第 59 行，`/final_sql`）：

```text
FROM kept
```
LAG计算已丢基线

**spec 原文**（卷宗第 59 行，`/our_spec_and_decisions/decisions/1/args/choices/4/alternatives/1/statement`）：

```text
被排除的首年不参与，展示集首个年份的同比为空
```
drop备选

**spec 原文**（卷宗第 59 行，`/our_spec_and_decisions/decisions/7/args/dispositions/7/rationale`）：

```text
题面说 excluding the first year data for each region，即各区域首年数据被排除出分析集合；另一候选仍用被排除的首年数据计算次年同比，与 excluding 冲突，故排除。与比较建议的明显倾向一致。
```
drop选择理由

**证据限制**：
- Gold head排名与标准DESC有张力，无GoldSQL/全年结果，不擅自把标准改ASC。
- Gold SQL缺失；只有结果head，不猜隐藏过滤、金额列或修复。
- Spec调用仅有参数无工具返回：证明声明/处置意图，不宣称全部成功生效。

### 60. local157

- 运行：`round11-full-c3-001`；卷宗行：60。
- 分叉节点：**population.time**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：2021年8月1至10每日百分变化，前量用前一非零量。
- SQL 实际：vol只筛年份2021及首两位08，无1至10日上界；LAG含零量，删零前量；变化比未乘100。
- 最早分叉依据：日期总体缺日界最早分叉；MM-DD假设与Gold显示DD-MM不同，但不需此推断即可证窗口错。
- 错误层依据：采用另一时间范围，无正确Spec可判违约。
- 可见性依据：完整spec_info仅change in trading/ending in K碎片，空假设、歧义、answerContract及decisions无日期范围。
- 其他差异：["population.conditions", "measure.denominator", "measure.formula", "output"]

**standard 原文**（卷宗第 60 行，`/instruction`）：

```text
Using the "bitcoin_prices" table, please calculate the daily percentage change in trading volume for each ticker from August 1 to August 10, 2021, ensuring that any volume ending in "K" or "M" is accurately converted to thousands or millions, any "-" volume is treated as zero, only non-zero volumes are used to determine the previous day's volume, and the results are ordered by ticker and date.
```
完整题面

**standard 原文**（卷宗第 60 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "percentage_change", "expression": "daily trading-volume percentage change per ticker after K/M and dash normalization", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 60 行，`/final_sql`）：

```text
WITH vol AS (
  SELECT
    ticker,
    market_date,
    CASE
      WHEN volume = '-' THEN 0.0
      WHEN substr(volume, -1) = 'K' THEN CAST(replace(substr(volume, 1, length(volume)-1), ',', '') AS REAL) * 1000.0
      WHEN substr(volume, -1) = 'M' THEN CAST(replace(substr(volume, 1, length(volume)-1), ',', '') AS REAL) * 1000000.0
      ELSE CAST(replace(volume, ',', '') AS REAL)
    END AS volume_num
  FROM bitcoin_prices
  WHERE substr(market_date, 7) = '2021' AND substr(market_date, 1, 2) = '08'
),
ranked AS (
  SELECT
    ticker,
    market_date,
    volume_num,
    LAG(volume_num) OVER (
      PARTITION BY ticker
      ORDER BY substr(market_date, 7) || substr(market_date, 1, 2) || substr(market_date, 4, 2)
    ) AS prev_volume
  FROM vol
)
SELECT
  ticker,
  market_date,
  (volume_num - prev_volume) / prev_volume AS daily_volume_pct_change
FROM ranked
WHERE prev_volume IS NOT NULL AND prev_volume <> 0
ORDER BY ticker, substr(market_date, 7) || substr(market_date, 1, 2) || substr(market_date, 4, 2)
```
最终SQL完整数据流

**spec 原文**（卷宗第 60 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [{"id": "HC-1", "statement": "change in trading", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}, {"id": "HC-2", "statement": "ending in \"K\"", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
相关声明/记录缺失

**standard 原文**（卷宗第 60 行，`/standard_semantics/facets/time/alternatives/0/window`）：

```text
August 1 through August 10 2021 inclusive
```
明确时间界

**spec 原文**（卷宗第 60 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
全部决定为空

**证据限制**：
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部0条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 61. local167

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：61。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：按首次代表州统计任意任期含12月31的女议员，选最多州及人数。
- SQL 实际：女性f；fs最早任期州；qual结束>=开始年12/31去重人，再按州count。
- 最早分叉依据：正常ISO日期下覆盖12/31与首次州均对应标准；42vs43不能定位。别名不同不能解释人数。
- 错误层依据：缺Gold与差异议员记录，四层待补。
- 可见性依据：4条decisions明确含两端及首次州，未证错误；不能用spec_info仅deliveryRequirement推未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 61 行，`/instruction`）：

```text
Based on the state each female legislator first represented, which state has the highest number of female legislators whose terms included December 31st at any point, and what is that count? Please provide the state's abbreviation.
```
完整题面

**standard 原文**（卷宗第 61 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "argmax", "expression": "state with maximum count of female legislators by first represented state", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 61 行，`/final_sql`）：

```text
WITH f AS (
  SELECT t.id_bioguide AS bid, t.state AS st, t.term_start AS ts, t.term_end AS te, t.term_number AS tn
  FROM legislators_terms t
  JOIN legislators l ON l.id_bioguide = t.id_bioguide
  WHERE l.gender = 'F'
),
fs AS (
  SELECT bid, st
  FROM (SELECT bid, st, ROW_NUMBER() OVER (PARTITION BY bid ORDER BY ts ASC, tn ASC) AS rn FROM f)
  WHERE rn = 1
),
qual AS (
  SELECT DISTINCT bid FROM f WHERE date(te) >= substr(ts,1,4) || '-12-31'
)
SELECT fs.st AS state, COUNT(*) AS "count"
FROM fs
JOIN qual ON qual.bid = fs.bid
GROUP BY fs.st
ORDER BY "count" DESC, fs.st ASC
LIMIT 1;
```
最终SQL完整数据流

**spec 原文**（卷宗第 61 行，`/our_spec_and_decisions/decisions/3/args/spec/filters/1/value`）：

```text
the legislator has at least one term whose [term_start, term_end] interval contains December 31 of some year
```
相关声明/记录缺失

**spec 原文**（卷宗第 61 行，`/our_spec_and_decisions/decisions/3/args/spec/groupBy/0/value`）：

```text
the state recorded on the legislator's earliest term (min term_start)
```
首次州声明

**result 原文**（卷宗第 61 行，`/gold_results/0/csv_info/head/0`）：

```text
["CA", "43"]
```
Gold唯一行

**result 原文**（卷宗第 61 行，`/predicted_result/csv_info/head/0`）：

```text
["CA", "42"]
```
Pred唯一行

**证据限制**：
- 需Gold端点、空/异常日期及具体差异议员。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部4条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 62. local168

- 运行：`spec-names-10-20260927-deepseek-r1`；卷宗行：62。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`medium`。
- 标准：中间posting-skill粒度，top3技能相关薪资均值保留匹配权重。
- SQL 实际：正确筛岗位、取技能top3；IN半连接对每job仅一次AVG。
- 最早分叉依据：上游资格/技能频次阶段无证错；posting-skill权重变去重job均值归formula，不只分母。
- 错误层依据：Spec选去重岗位均值，SQL一致，是另一业务算法。
- 可见性依据：c-joinmult有去重/匹配行备选，后decide明确去重并排除多技能权重，仅认意图。

**standard 原文**（卷宗第 62 行，`/instruction`）：

```text
Among job postings that specifically have the Data Analyst, require a non-null annual average salary, and are remote, what is the overall average salary when considering only the top three most frequently demanded skills for these positions?
```
完整题面

**standard 原文**（卷宗第 62 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "avg", "expression": "overall average annual salary among postings associated with the top three demanded skills", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 62 行，`/final_sql`）：

```text
WITH pop AS (
  SELECT job_id, salary_year_avg
  FROM job_postings_fact
  WHERE job_title_short = 'Data Analyst'
    AND salary_year_avg IS NOT NULL
    AND job_work_from_home = 1
),
sk AS (
  SELECT pop.job_id, sd.skills
  FROM pop
  JOIN skills_job_dim sj ON pop.job_id = sj.job_id
  JOIN skills_dim sd ON sd.skill_id = sj.skill_id
),
top3 AS (
  SELECT skills FROM sk GROUP BY skills ORDER BY COUNT(DISTINCT job_id) DESC LIMIT 3
)
SELECT ROUND(AVG(salary_year_avg), 2) AS avg_salary_year_avg
FROM pop
WHERE job_id IN (SELECT job_id FROM sk WHERE skills IN (SELECT skills FROM top3))
```
最终SQL完整数据流

**spec 原文**（卷宗第 62 行，`/our_spec_and_decisions/decisions/1/args/dispositions/1/rationale`）：

```text
统计实体是 job posting（题面：job postings ... average salary ... for these positions）。一个职位同时命中多个 top-3 技能时仍然是同一个职位，只能计入一次；按匹配行计会让多技能职位在平均值中被重复加权，改变的正是平均薪资的分母。故对去重后的 job_id 求平均。
```
相关声明/记录缺失

**standard 原文**（卷宗第 62 行，`/standard_semantics/facets/grain/alternatives/0/intermediateGrain`）：

```text
posting-skill
```
标准粒度

**spec 原文**（卷宗第 62 行，`/our_spec_and_decisions/decisions/0/args/choices/1`）：

```text
{"localId": "C-joinmult", "affects": ["metric"], "alternatives": [{"localId": "A-dedupe", "statement": "每个职位只计一次：对满足 top-3 技能（任一）的去重 job_id 求平均薪资"}, {"localId": "B-rows", "statement": "按技能匹配行计：职位因命中多个 top-3 技能被重复计入平均"}]}
```
两种权重备选

**证据限制**：
- 标准denominator称postings而grain明确posting-skill，表述不完全一致，需GoldSQL确认权重。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部2条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 63. local169

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：63。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：1917至1999首次任期cohort，20期12/31留任/初始人数并补全期。
- SQL 实际：MIN全任期筛cohort，k1..20检查开始年+k的12/31含端点，去重人数/cohort并ROUND4。
- 最早分叉依据：分母计人补20期正确；标准未区分锚点端点，.969749566与.9809不是ROUND4能解释。
- 错误层依据：缺Gold细则不能定位四层。
- 可见性依据：12条decisions含anchor/boundary多次选择，+k及inclusive未证错误，不能标未声明或错误决定。
- 其他差异：["output"]

**standard 原文**（卷宗第 63 行，`/instruction`）：

```text
What is the annual retention rate of legislators who began their first term between January 1, 1917 and December 31, 1999, measured as the proportion of this cohort still in office on December 31st for each of the first 20 years following their initial term start? The results should show all 20 periods in sequence regardless of whether any legislators were retained in a particular year.
```
完整题面

**standard 原文**（卷宗第 63 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "percentage", "expression": "retained cohort count divided by initial cohort count for each elapsed period 1 through 20", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 63 行，`/final_sql`）：

```text
WITH firsts AS (
  SELECT id_bioguide, MIN(term_start) AS fs
  FROM legislators_terms
  GROUP BY id_bioguide
),
cohort AS (
  SELECT id_bioguide, CAST(substr(fs,1,4) AS INTEGER) AS yr
  FROM firsts
  WHERE fs >= '1917-01-01' AND fs <= '1999-12-31'
),
periods(k) AS (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20))
SELECT p.k AS period,
       ROUND(1.0 * COUNT(DISTINCT CASE WHEN t.term_id IS NOT NULL THEN c.id_bioguide END)
             / (SELECT COUNT(*) FROM cohort), 4) AS retention_rate
FROM cohort c
CROSS JOIN periods p
LEFT JOIN legislators_terms t
       ON t.id_bioguide = c.id_bioguide
      AND t.term_start <= printf('%04d-12-31', c.yr + p.k)
      AND t.term_end   >= printf('%04d-12-31', c.yr + p.k)
GROUP BY p.k
ORDER BY p.k
```
最终SQL完整数据流

**spec 原文**（卷宗第 63 行，`/our_spec_and_decisions/decisions/11/args/dispositions/1/rationale`）：

```text
题面要求 'for each of the first 20 years following their initial term start'（引文）：第 k 期是起始年份之后的第 k 个年度，故第 k 期的观察时点取 起始年份 + k 的 12 月 31 日；这与常规 cohort 留存口径一致（起始年作为基准年，此后按 k=1..20 逐年观察）。排除 an-start：该候选把首个观察时点放在起始当年 12 月 31 日，即把起始年份本身当成 'following' 的第一个年度，与题面 'following their initial term start' 的措辞不符（普查也指出该候选概率更低：0.15 vs 0.36）。
```
相关声明/记录缺失

**spec 原文**（卷宗第 63 行，`/our_spec_and_decisions/decisions/0/args/choices/3`）：

```text
{"localId": "C-anchor", "affects": ["time"], "alternatives": [{"localId": "an-start", "statement": "第 k 期（k=1..20）= 首次任期起始年份 + (k-1) 的 12 月 31 日，即首个观察时点落在起始当年"}, {"localId": "an-next", "statement": "第 k 期（k=1..20）= 首次任期起始年份 + k 的 12 月 31 日，即首个观察时点落在起始次年的 12 月 31 日"}]}
```
锚点备选

**spec 原文**（卷宗第 63 行，`/our_spec_and_decisions/decisions/11/args/dispositions/0/rationale`）：

```text
题面只问在 12 月 31 日是否 'still in office'（引文），没有把任期结束日排除在在任之外；已登记的探索观测 evidence_2d37be35/evidence_3d75b4e7 显示，以 '-12-31' 结尾的 term_end 是任期记录内的最后服务日（既有完整参议员任期 B000132 1941-01-03~1943-12-31，也有 appointment 部分任期 P000159 1941-08-05~1941-12-31；B000536 在 1957-01-15~1957-12-31 结束后下一条任期直到 1961-01-03 才开始，说明 term_end 不是 '离任后第一天'）。因此任期应读作闭区间 [term_start, term_end]，D=term_end 时仍在任（term_end >= D），排除 bd-excl：bd-excl 会把记录明确标为其任期最后一天的议员在该日判为离任，既与观测到的 term_end 语义相反，也没有任何题面或业务定义依据。
```
端点选择意图

**result 原文**（卷宗第 63 行，`/gold_results/0/csv_info/head/0`）：

```text
["1", "0.96974956607984"]
```
Gold第一期

**result 原文**（卷宗第 63 行，`/predicted_result/csv_info/head/0`）：

```text
["1", "0.9809"]
```
Pred第一期

**证据限制**：
- 需Gold周期编号、首观察日、端点。列名/ROUND4仅次级偏差。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部12条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 64. local170

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：64。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：州男女cohort于0/2/4/6/8/10年12/31全有非零留任。
- SQL 实际：首次州、开始年+t、EXISTS任期含Dec31，州性别t留任；HAVING两性且MIN>0，排非50州。
- 最早分叉依据：非零率转非零人数等价，六期crossjoin后分组资格正确；32vs25不能定位。
- 错误层依据：需补标准才能判四层。
- 可见性依据：完整decisions有all-codes/fifty-states反复处置，末次50州与SQL一致，无证该选择错。

**standard 原文**（卷宗第 64 行，`/instruction`）：

```text
Identify the state abbreviations where, for both male and female legislators, the retention rate remains greater than zero at specific intervals of 0, 2, 4, 6, 8, and 10 years after their first term start date. A legislator is considered retained if they are serving on December 31 of the respective year. Only include states where both gender cohorts maintain non-zero retention rates at all six of these time points during the first decade of service.
```
完整题面

**standard 原文**（卷宗第 64 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "qualifying_state", "expression": "states with nonzero male and female retention at all six requested intervals", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 64 行，`/final_sql`）：

```text
WITH ft AS (
  SELECT id_bioguide, MIN(term_start) AS first_start FROM legislators_terms GROUP BY id_bioguide
),
p AS (
  SELECT ft.id_bioguide, l.gender, CAST(strftime('%Y', ft.first_start) AS INTEGER) AS y0,
         (SELECT t.state FROM legislators_terms t WHERE t.id_bioguide = ft.id_bioguide AND t.term_start = ft.first_start LIMIT 1) AS state
  FROM ft JOIN legislators l ON l.id_bioguide = ft.id_bioguide
),
pv AS (
  SELECT p.id_bioguide, p.gender, p.state, v.t, printf('%04d-12-31', p.y0 + v.t) AS check_date
  FROM p CROSS JOIN (SELECT 0 AS t UNION ALL SELECT 2 UNION ALL SELECT 4 UNION ALL SELECT 6 UNION ALL SELECT 8 UNION ALL SELECT 10) v
),
flags AS (
  SELECT pv.state, pv.gender, pv.t,
         EXISTS(SELECT 1 FROM legislators_terms lt
                WHERE lt.id_bioguide = pv.id_bioguide
                  AND lt.term_start <= pv.check_date
                  AND lt.term_end   >= pv.check_date) AS retained
  FROM pv
),
agg AS (
  SELECT state, gender, t, SUM(retained) AS n_retained
  FROM flags
  WHERE state NOT IN ('DC','PR','GU','VI','AS','MP','PI','DK','OL')
  GROUP BY state, gender, t
)
SELECT state
FROM agg
GROUP BY state
HAVING COUNT(DISTINCT gender) = 2 AND MIN(n_retained) > 0
ORDER BY state
```
最终SQL完整数据流

**spec 原文**（卷宗第 64 行，`/our_spec_and_decisions/decisions/5/args/dispositions/3/rationale`）：

```text
选择 fifty-states（仅美国 50 州），排除 all-codes。题面 'Identify the state abbreviations' 与 'Only include states where both gender cohorts...' 的比较对象是 'states'（美国各州），这是该列筛选的语义基准；而 state 列本身混入了 PI（Pacific Islands）、DK（Dakota Territory）、OL（Orleans Territory）等明显历史/非州代码（见探索观测），说明列取值不等于『州』，不能把 DC（联邦特区）与 GU/PR/VI/AS/MP（属地）等非州代码计入答案。all-codes 会额外纳入 DC 与 GU 两个非州代码，与『states』不符；fifty-states 输出的 32 个州与题面语义一致，故排除 all-codes。
```
相关声明/记录缺失

**spec 原文**（卷宗第 64 行，`/our_spec_and_decisions/decisions/0/args/spec/metric/value/expression`）：

```text
retention_rate(state,gender,t) = 该(州,性别)队列在检查日仍在任的议员人数 / 该队列议员人数；t∈{0,2,4,6,8,10}；要求两个性别队列在所有 t 上均 >0
```
非零率等价人数声明

**证据限制**：
- 需Gold州集合、首次州、elapsed-year及端点细则。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部6条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 65. local171

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：65。
- 分叉节点：**population.conditions**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`medium`。
- 标准：LA男性议员按首次任期起算31至49年Dec31去重留任。
- SQL 实际：先state=LA再MIN年份，起点首次LA任期；EXISTS任意州任期。
- 最早分叉依据：LA资格提前至首次任期聚合输入，把全生涯first term替换LA first term，先于elapsed分组分叉。
- 错误层依据：Spec选另一first term读法，SQL落实。
- 可见性依据：c-firstterm有global/LA备选，后select把LA总体限制延伸为first term范围。
- 其他差异：["population.time", "output"]

**standard 原文**（卷宗第 65 行，`/instruction`）：

```text
For male legislators from Louisiana, how many distinct legislators were actively serving on December 31 of each year from more than 30 years since their first term up to less than 50 years, grouping the results by the exact number of years elapsed since their first term?
```
完整题面

**standard 原文**（卷宗第 65 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "count_distinct", "expression": "distinct active male Louisiana legislators by elapsed years since first term", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 65 行，`/final_sql`）：

```text
WITH la_first AS (
  SELECT id_bioguide,
         MIN(CAST(strftime('%Y', term_start) AS INTEGER)) AS fy
  FROM legislators_terms
  WHERE state = 'LA'
  GROUP BY id_bioguide
),
male_la AS (
  SELECT f.id_bioguide, f.fy
  FROM la_first f
  JOIN legislators l ON l.id_bioguide = f.id_bioguide
  WHERE l.gender = 'M'
),
ks(k) AS (
  SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34 UNION ALL SELECT 35
  UNION ALL SELECT 36 UNION ALL SELECT 37 UNION ALL SELECT 38 UNION ALL SELECT 39 UNION ALL SELECT 40
  UNION ALL SELECT 41 UNION ALL SELECT 42 UNION ALL SELECT 43 UNION ALL SELECT 44 UNION ALL SELECT 45
  UNION ALL SELECT 46 UNION ALL SELECT 47 UNION ALL SELECT 48 UNION ALL SELECT 49
),
cand AS (
  SELECT m.id_bioguide, m.fy + k.k AS y, k.k AS years_elapsed
  FROM male_la m CROSS JOIN ks k
)
SELECT c.years_elapsed AS years_elapsed,
       COUNT(DISTINCT c.id_bioguide) AS legislator_count
FROM cand c
WHERE EXISTS (
  SELECT 1 FROM legislators_terms t
  WHERE t.id_bioguide = c.id_bioguide
    AND t.term_start <= (CAST(c.y AS TEXT) || '-12-31')
    AND t.term_end >= (CAST(c.y AS TEXT) || '-12-31')
)
GROUP BY c.years_elapsed
ORDER BY c.years_elapsed
```
最终SQL完整数据流

**spec 原文**（卷宗第 65 行，`/our_spec_and_decisions/decisions/8/args/dispositions/6/rationale`）：

```text
The request states the population as 'For male legislators from Louisiana' (e-pop), so the Louisiana scope governs the whole sentence; 'from more than 30 years since their first term up to less than 50 years' (e-range) therefore counts from the first term of that Louisiana service. The competing global-earliest-term candidate is excluded because the question contains no reference to service in any other state, so nothing in the request authorizes counting tenure that occurred outside Louisiana.
```
相关声明/记录缺失

**spec 原文**（卷宗第 65 行，`/our_spec_and_decisions/decisions/0/args/choices/0`）：

```text
{"localId": "c-firstterm", "affects": ["time"], "alternatives": [{"localId": "a-global", "statement": "first term = the term with the earliest term_start among all of the legislator's terms (global first term)"}, {"localId": "a-la", "statement": "first term = the term with the earliest term_start among the legislator's Louisiana (state='LA') terms"}]}
```
首次范围备选

**证据限制**：
- 题面first term自然指全生涯，但Gold规则待补；不从差1猜人物。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部10条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 66. local194

- 运行：`answer-plan-phase6-new-on-r1`；卷宗行：66。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：标准measure要求每actor top3集合内分摊收入平均，先每片收入/片演员数。
- SQL 实际：film_rev聚合payment，除演员数逐actor-film输出，缺top3集合外层AVG；top3按gross排序。
- 最早分叉依据：支付聚合、演员分母无确定上游错；缺外层AVG最早分叉，gross排名另列selection。
- 错误层依据：Spec只单层分摊，SQL相同，不是违反正确两层声明。
- 可见性依据：metric标hypothesis，值仅sum片收入/演员数无outer AVG，是假定法，time/filter n/a无关。
- 其他差异：["selection", "output"]

**standard 原文**（卷宗第 66 行，`/instruction`）：

```text
Please provide a list of the top three revenue-generating films for each actor, along with the average revenue per actor in those films, calculated by dividing the total film revenue equally among the actors for each film.
```
完整题面

**standard 原文**（卷宗第 66 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "avg", "expression": "average allocated film revenue per actor within each actor top-three film set", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 66 行，`/final_sql`）：

```text
WITH film_rev AS (
  SELECT f.film_id, COALESCE(SUM(p.amount),0) AS revenue
  FROM film f
  LEFT JOIN inventory i ON f.film_id = i.film_id
  LEFT JOIN rental r ON i.inventory_id = r.inventory_id
  LEFT JOIN payment p ON r.rental_id = p.rental_id
  GROUP BY f.film_id
),
ac AS (
  SELECT film_id, COUNT(*) AS n_actors FROM film_actor GROUP BY film_id
)
SELECT
  a.first_name || ' ' || a.last_name AS actor,
  f.title AS film,
  ROUND(CAST(fr.revenue AS REAL) / ac.n_actors, 2) AS avg_revenue_per_actor
FROM film_actor mfa
JOIN actor a ON a.actor_id = mfa.actor_id
JOIN film f ON f.film_id = mfa.film_id
JOIN film_rev fr ON fr.film_id = mfa.film_id
JOIN ac ON ac.film_id = mfa.film_id
WHERE (
  SELECT COUNT(*)
  FROM film_actor fa2
  JOIN film_rev fr2 ON fr2.film_id = fa2.film_id
  WHERE fa2.actor_id = mfa.actor_id
    AND (fr2.revenue > fr.revenue
         OR (fr2.revenue = fr.revenue AND fa2.film_id < mfa.film_id))
) + 1 <= 3
ORDER BY actor, fr.revenue DESC, f.film_id;
```
最终SQL完整数据流

**spec 原文**（卷宗第 66 行，`/our_spec_and_decisions/decisions/0/args/spec/metric`）：

```text
avg_revenue_per_actor = sum(电影营收)/参演演员数
```
相关声明/记录缺失

**spec 原文**（卷宗第 66 行，`/our_spec_and_decisions/decisions/0/args/facetStatus/metric`）：

```text
hypothesis
```
明确hypothesis状态

**standard 原文**（卷宗第 66 行，`/standard_semantics/facets/ranking/alternatives/0/orderBy`）：

```text
allocated revenue DESC
```
标准allocated排序

**证据限制**：
- 标准outer AVG、题面每片分摊与Gold仅3行无actor形状内在不一致；只对可见标准公式比较，不宣称Gold整体正确。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部1条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 67. local195

- 运行：`semantic-spec-30-20260925-deepseek-required-subagent-v2`；卷宗行：67。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：top5演员相关电影至少租一次的客户并集/全部客户百分数；演员按popularity。
- SQL 实际：按出演distinct电影最多5演员，相关rental去重customer/全部customer行数，乘100 ROUND2。
- 最早分叉依据：分子并集和全部客户分母正确；popularity未正式定义，不能拿电影数vs租赁数候选当已定标准；数值差不证明其错。
- 错误层依据：需Gold top演员定义/IDs/tie政策方可定位四层。
- 可见性依据：完整decisions有filmography/rental候选和provisional/select参数，未收录返回及候选服务ID映射；不能把SQL filmography直接认错误决定。

**standard 原文**（卷宗第 67 行，`/instruction`）：

```text
Please find out how widespread the appeal of our top five actors is. What percentage of our customers have rented films featuring these actors?
```
完整题面

**standard 原文**（卷宗第 67 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "percentage", "expression": "customers renting at least one film featuring any selected top-five actor divided by all customers", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 67 行，`/final_sql`）：

```text
SELECT ROUND(100.0 * (SELECT COUNT(DISTINCT r.customer_id) FROM rental r JOIN inventory i ON i.inventory_id = r.inventory_id JOIN film_actor fa ON fa.film_id = i.film_id WHERE fa.actor_id IN (SELECT actor_id FROM film_actor GROUP BY actor_id ORDER BY COUNT(DISTINCT film_id) DESC, actor_id ASC LIMIT 5)) / (SELECT COUNT(*) FROM customer), 2) AS percentage;
```
最终SQL完整数据流

**spec 原文**（卷宗第 67 行，`/our_spec_and_decisions/decisions/2/args/choices/0`）：

```text
{"affects": ["ranking"], "alternatives": [{"localId": "a-films", "statement": "Top 5 actors = the 5 actors appearing in the most distinct films (filmography size)."}, {"localId": "a-rentals", "statement": "Top 5 actors = the 5 actors whose films have the most rentals overall (rental popularity)."}], "localId": "c-rank"}
```
相关声明/记录缺失

**standard 原文**（卷宗第 67 行，`/standard_semantics/facets/ranking/alternatives/0/orderBy`）：

```text
actor popularity DESC
```
标准仅抽象popularity

**spec 原文**（卷宗第 67 行，`/our_spec_and_decisions/decisions/6/args/dispositions/3`）：

```text
{"action": "provisional", "alternativeId": "alternative_04e7abe9-f187-4dc3-9d54-28e60931c08e", "choiceId": "choice_da98e417-272b-4983-b441-fbe44ab15776"}
```
provisional意图

**证据限制**：
- 需top5 popularity正式公式及临界并列；列名差异不足解释数值。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部7条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 68. local196

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：68。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：先客户最早payment首片rating，分别客户total payment与rental count-1，再按rating AVG。
- SQL 实际：first_film取最早payment；cust独立SUM payment与COUNT rental，再按rating AVG且减一。
- 最早分叉依据：已有正确两层和独立客户流，不是压平AVG/分母错误；Gold花费相同、后续租赁均值略异，不能反推应数payment。
- 错误层依据：缺Gold及数据，Spec声称5个NULL rental_id payment非观测原件，不能认Gold错。
- 可见性依据：3条decisions明确COUNT rental-1及独立SUM payment，首片tie无碰撞仅参数声称，主错误未定。
- 其他差异：["output"]

**standard 原文**（卷宗第 68 行，`/instruction`）：

```text
For each rating category of the first movie rented by customers—where the first movie is identified based on the earliest payment date per customer—please provide the average total amount spent per customer and the average number of subsequent rentals (calculated as the total number of rentals minus one) for customers whose first rented movie falls into that rating category.
```
完整题面

**standard 原文**（卷宗第 68 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "avg", "entity": "rating category", "sourceGrain": "customer", "aggregationOrder": ["find earliest payment per customer", "attach first-film rating", "aggregate total payment and rental count per customer", "subsequent rentals = total rentals - 1", "average by rating"]}]
```
标准度量

**sql 原文**（卷宗第 68 行，`/final_sql`）：

```text
WITH first_film AS (
  -- one row per customer: film of the rental linked to the customer's earliest payment
  SELECT p.customer_id, i.film_id
  FROM payment p
  JOIN rental r ON r.rental_id = p.rental_id
  JOIN inventory i ON i.inventory_id = r.inventory_id
  WHERE p.payment_date = (SELECT MIN(p2.payment_date) FROM payment p2 WHERE p2.customer_id = p.customer_id)
),
cust AS (
  -- per-customer totals: all payments spent, and rental count
  SELECT c.customer_id,
         (SELECT SUM(amount) FROM payment WHERE customer_id = c.customer_id) AS total_spent,
         (SELECT COUNT(*) FROM rental WHERE customer_id = c.customer_id) AS num_rentals
  FROM customer c
)
SELECT fm.rating AS rating,
       ROUND(AVG(c.total_spent), 2) AS avg_total_amount_spent,
       ROUND(AVG(c.num_rentals - 1.0), 2) AS avg_subsequent_rentals
FROM first_film f
JOIN film fm ON fm.film_id = f.film_id
JOIN cust c ON c.customer_id = f.customer_id
GROUP BY fm.rating
ORDER BY fm.rating;
```
最终SQL完整数据流

**spec 原文**（卷宗第 68 行，`/our_spec_and_decisions/decisions/2/args/spec/metric/value/expression`）：

```text
avg_total_amount_spent = AVG over customers of (SUM of all payment.amount rows for that customer, including 5 non-rental NULL-rental_id payments per literal 'total amount spent'); avg_subsequent_rentals = AVG over customers of (COUNT of rental rows for that customer - 1)
```
相关声明/记录缺失

**standard 原文**（卷宗第 68 行，`/standard_semantics/facets/joins/alternatives/0/cardinality`）：

```text
aggregate each customer stream before joining first-film rating
```
独立客户流先聚合

**spec 原文**（卷宗第 68 行，`/our_spec_and_decisions/decisions/1/args/hypotheses/2/statement`）：

```text
5 of 16049 payment rows have NULL rental_id (non-rental payments owned by 5 customers); the other 16044 payments map 1:1 to the 16044 rentals. Literal reading: total amount spent = SUM of all payment.amount for the customer (including the NULL-rental payments), while total number of rentals is counted from the rental table.
```
区别payment与rental的声明

**证据限制**：
- 需Gold租赁计数对象、非租赁支付处理、首片tie政策及完整结果。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部3条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 69. local197

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：69。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`low`。
- 标准：top10付费客户，客户月额前后月绝对差，再最大且ROUND2。
- SQL 实际：final_sql只monthly总额，输出5行offset40，未算差分/全局最大。
- 最早分叉依据：top10及月总额无确定错；缺差运算早于取最大及输出，不以Gold缺customer遮盖。
- 错误层依据：无正确Spec可判违约；按所给SQL直接遗漏指标归口径错。
- 可见性依据：spec_info={}、decisions=[]，卷宗缺月差公式记录，不证明运行时没声明。
- 其他差异：["selection", "output"]

**standard 原文**（卷宗第 69 行，`/instruction`）：

```text
Among our top 10 paying customers, can you identify the largest change in payment amounts from one month to the immediately following month? Specifically, please determine for which customer and during which month this maximum month-over-month difference occurred, and provide the difference rounded to two decimal places.
```
完整题面

**standard 原文**（卷宗第 69 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "max", "expression": "maximum absolute month-over-month payment difference among top-paying customers", "evidenceRefs": ["Q1"], "aggregationOrder": ["top ten customers by payment", "customer-month changes", "maximum difference"]}]
```
标准度量

**sql 原文**（卷宗第 69 行，`/final_sql`）：

```text
WITH top10 AS (
    SELECT customer_id
    FROM payment
    GROUP BY customer_id
    ORDER BY SUM(amount) DESC, customer_id
    LIMIT 10
),
monthly AS (
    SELECT p.customer_id,
           strftime('%Y-%m', p.payment_date) AS ym,
           SUM(p.amount) AS month_total
    FROM payment p
    JOIN top10 t ON t.customer_id = p.customer_id
    GROUP BY p.customer_id, ym
)
SELECT customer_id, ym, ROUND(month_total, 2) AS month_total
FROM monthly
ORDER BY customer_id, ym
LIMIT 5 OFFSET 40
```
最终SQL完整数据流

**spec 原文**（卷宗第 69 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
相关声明/记录缺失

**standard 原文**（卷宗第 69 行，`/standard_semantics/gold_sql`）：

```text
WITH result_table AS (
  SELECT 
    strftime('%m', pm.payment_date) AS pay_mon, 
    customer_id,
    COUNT(pm.amount) AS pay_countpermon, 
    SUM(pm.amount) AS pay_amount 
  FROM 
    payment AS pm 
  GROUP BY 
    pay_mon, 
    customer_id
), 
top10_customer AS (
  SELECT 
    customer_id,
    SUM(tb.pay_amount) AS total_payments 
  FROM 
    result_table AS tb 
  GROUP BY 
    customer_id
  ORDER BY 
    SUM(tb.pay_amount) DESC 
  LIMIT 
    10
), 
difference_per_mon AS (
  SELECT 
    pay_mon AS month_number, 
    pay_mon AS month, 
    tb.pay_countpermon, 
    tb.pay_amount, 
    ABS(tb.pay_amount - LAG(tb.pay_amount) OVER (PARTITION BY tb.customer_id)) AS diff 
  FROM 
    result_table tb 
    JOIN top10_customer top ON top.customer_id = tb.customer_id
) 
SELECT 
  month, 
  ROUND(max_diff, 2) AS max_diff 
FROM (
  SELECT 
    month, 
    diff, 
    month_number, 
    MAX(diff) OVER (PARTITION BY month) AS max_diff 
  FROM 
    difference_per_mon
) AS max_per_mon 
WHERE 
  diff = max_diff 
ORDER BY 
  max_diff DESC 
LIMIT 
  1;
```
Gold实际差分及缺customer输出

**证据限制**：
- timeout；Pred head含mo_diff而final_sql月额抽样，不一致，final_sql可能最后探针，此标签仅绑定给定SQL。
- Gold LAG缺ORDER BY且输出无customer是独立标准问题，不取代SQL缺月差。
- 已逐项阅读spec_info、全部0条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。
- 空Spec是记录缺失，不证明运行时从未声明。

### 70. local198

- 运行：`round11-full-c3-001`；卷宗行：70。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：先国家总sales，客户>4国家总额的中位数。
- SQL 实际：国家客户>4资格正确，sales逐invoice Total无国家SUM，再排序取一中间invoice。
- 最早分叉依据：>4为国家分组后资格且位置正确；缺国家SUM使median(sum)变invoice median，归formula。
- 错误层依据：采用发票额中位数，无正确嵌套Spec可判违约。
- 可见性依据：完整spec_info只made in countries片段、全部decisions空，无SUM/median嵌套声明。

**standard 原文**（卷宗第 70 行，`/instruction`）：

```text
Using the sales data, what is the median value of total sales made in countries where the number of customers is greater than 4?
```
完整题面

**standard 原文**（卷宗第 70 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "median", "expression": "median country total sales among countries with more than four customers", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 70 行，`/final_sql`）：

```text
WITH country_cust AS (
  SELECT Country FROM customers GROUP BY Country HAVING COUNT(*) > 4
),
sales AS (
  SELECT i.Total
  FROM invoices i
  JOIN customers cu ON cu.CustomerId = i.CustomerId
  WHERE cu.Country IN (SELECT Country FROM country_cust)
),
ordered AS (
  SELECT Total, ROW_NUMBER() OVER (ORDER BY Total) AS rn, COUNT(*) OVER () AS cnt
  FROM sales
)
SELECT Total AS median_total_sales
FROM ordered
WHERE rn = (cnt + 1) / 2;
```
最终SQL完整数据流

**spec 原文**（卷宗第 70 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [{"id": "HC-1", "statement": "made in countries", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
相关声明/记录缺失

**spec 原文**（卷宗第 70 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
全部决定空

**证据限制**：
- 偶数样本也只取下中位行，未平均两中位，另一个formula偏差。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部0条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 71. local201

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：71。
- 分叉节点：**population.conditions**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：4/5字符、r起头、有同长区分大小写的其它anagram，字母序前10及anagram数。
- SQL 实际：相同words GROUP BY且HAVING count>1，判重复词而非异序词，未LIMIT10。
- 最早分叉依据：长度及首字母正确；重复原词资格替代anagram存在资格，先于count及selection。
- 错误层依据：SQL另一资格测试，无正确Spec供判实现违约。
- 可见性依据：完整{}、[]无anagram或资格声明，仅指可见记录缺失。
- 其他差异：["measure.countGrain", "selection", "output"]

**standard 原文**（卷宗第 71 行，`/instruction`）：

```text
Identify the first 10 words, sorted alphabetically, that are 4 to 5 characters long, start with 'r', and have at least one anagram of the same length, considering case-sensitive letters. Provide the count of such anagrams for each word.
```
完整题面

**standard 原文**（卷宗第 71 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "count", "expression": "same-length anagram count per qualifying word", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 71 行，`/final_sql`）：

```text
SELECT words, COUNT(*) AS cnt FROM word_list WHERE length(words) BETWEEN 4 AND 5 AND substr(words,1,1) = 'r' GROUP BY words HAVING cnt > 1 ORDER BY words
```
最终SQL完整数据流

**spec 原文**（卷宗第 71 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
相关声明/记录缺失

**证据限制**：
- timeout且CSV缺失，只比较final_sql，不宣称已生成最终结果。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部0条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。
- 空Spec是记录缺失，不证明运行时从未声明。

### 72. local202

- 运行：`spider2-local-round5-full-001`；卷宗行：72。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：top10人口州中友好比例>敌对且平均年龄>200的州数，scalar。
- SQL 实际：先全州group指标再取人口top10，计算每州qualifies标志，未SUM/COUNT合格州，输出10行明细。
- 最早分叉依据：排名前未提前友好/age过滤，资格是州均值；缺州标志外层计数，不误判上游资格。
- 错误层依据：SQL没有指定number of states指标，是另一明细法。
- 可见性依据：{}与全部[]缺州数外层聚合声明，记录缺失有限定。
- 其他差异：["output"]

**standard 原文**（卷宗第 72 行，`/instruction`）：

```text
For alien data, how many of the top 10 states by alien population have a higher percentage of friendly aliens than hostile aliens, with an average alien age exceeding 200?
```
完整题面

**standard 原文**（卷宗第 72 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "count", "expression": "number of top-ten alien-population states meeting friendly/hostile and age criteria", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 72 行，`/final_sql`）：

```text
WITH state_stats AS (
  SELECT state,
    COUNT(*) as total,
    COUNT(CASE WHEN aggressive=0 THEN 1 END) AS friendly_cnt,
    COUNT(CASE WHEN aggressive=1 THEN 1 END) AS hostile_cnt,
    AVG(age) as avg_age
  FROM alien_data
  GROUP BY state
),
top10 AS (
  SELECT state, total, friendly_cnt, hostile_cnt, avg_age
  FROM state_stats
  ORDER BY total DESC
  LIMIT 10
)
SELECT state, total, friendly_cnt, hostile_cnt,
  ROUND(1.0*friendly_cnt/total, 4) as friendly_pct,
  ROUND(1.0*hostile_cnt/total, 4) as hostile_pct,
  ROUND(avg_age, 2) as avg_age,
  CASE WHEN (1.0*friendly_cnt/total > 1.0*hostile_cnt/total) AND avg_age > 200 THEN 1 ELSE 0 END as qualifies
FROM top10
ORDER BY total DESC
```
最终SQL完整数据流

**spec 原文**（卷宗第 72 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
相关声明/记录缺失

**证据限制**：
- 未证明aggressive映射错；不因存在表或WHERE就判source/conditions。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部0条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。
- 空Spec是记录缺失，不证明运行时从未声明。

### 73. local209

- 运行：`answer-plan-phase6-new-off-r1`；卷宗行：73。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：orders JOIN stores按订单数取最大store，再DELIVERED订单/全部订单。
- SQL 实际：额外LEFT JOIN deliveries后COUNT order_id总量、COUNT DISTINCT DELIVERED order_id分子，按total取store。
- 最早分叉依据：连接后分母行数与分子去重有结构风险，但无delivery_order_id基数或差异订单，不宣称真实fanout；比率差也不证明它。
- 错误层依据：需基数后才能判joinMultiplicity/denominator/计数对象层。
- 可见性依据：实际H1及1条decision仅关联和DELIVERED假设，未有基数声明；主错未知。
- 其他差异：["output"]

**standard 原文**（卷宗第 73 行，`/instruction`）：

```text
In the dataset of orders joined with store information, which store has the highest total number of orders, and among that store’s orders, what is the ratio of orders that appear in the deliveries table with a 'DELIVERED' status to the total orders for that store?
```
完整题面

**standard 原文**（卷宗第 73 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "ratio", "expression": "DELIVERED orders / total orders for the selected highest-order store", "aggregationOrder": ["count orders by store", "select store with maximum order count", "count delivered orders and divide"]}]
```
标准度量

**sql 原文**（卷宗第 73 行，`/final_sql`）：

```text
WITH store_counts AS (
  SELECT o.store_id,
         COUNT(o.order_id) AS total_orders,
         COUNT(DISTINCT CASE WHEN d.delivery_status = 'DELIVERED' THEN o.order_id END) AS delivered_orders
  FROM orders o
  JOIN stores s ON s.store_id = o.store_id
  LEFT JOIN deliveries d ON d.delivery_order_id = o.delivery_order_id
  GROUP BY o.store_id
)
SELECT sc.store_id, st.store_name AS top_store_name, sc.total_orders,
       1.0 * sc.delivered_orders / sc.total_orders AS delivered_ratio
FROM store_counts sc
JOIN stores st ON st.store_id = sc.store_id
ORDER BY sc.total_orders DESC, sc.store_id ASC
LIMIT 1
```
最终SQL完整数据流

**spec 原文**（卷宗第 73 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "2", "hardConstraints": [], "hypotheses": [{"id": "H1", "statement": "订单与deliveries表通过 order_id / delivery_order_id 关联；订单在deliveries表中DELIVERED状态出现即代表其已投递订单记录，用于分子计数。", "basis": "deliveries表含delivery_order_id与delivery_status字段，orders表含delivery_order_id字段；尚无业务定义确认关联键。", "impact": "决定分子计数方式与JOIN键选择，直接影响比例", "scope": "filters", "confidence": 0.5, "status": "candidate", "provenance": {"authority": "model_inference", "source": "task-evidence"}}], "ambiguities": [], "answerContract": {}}
```
相关声明/记录缺失

**spec 原文**（卷宗第 73 行，`/our_spec_and_decisions/decisions/0/args/spec/metric`）：

```text
总订单数(order count)与已投递(DELIVERED)订单占总订单的比例
```
订单数与DELIVERED比例声明

**证据限制**：
- 需GoldSQL、orders/deliveries关联键唯一性、选中store、真实分子分母。
- 额外输出列是已知shape偏差，但标准含store与仅ratio两种形状，不能替代主数值原因。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部1条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 74. local212

- 运行：`spec-names-10-20260927-deepseek-r1`；卷宗行：74。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：日均配送最高5司机；标准未定日期事件、配送去重与活跃/全部天分母。
- SQL 实际：DELIVERED、finished非空、driver非空；finished日按distinct delivery_order_id计，再driver AVG活跃日，top5。
- 最早分叉依据：daily count再driver avg两层正确；标准不定finished/created、distinctorder/row与天分母，不能由3人不同断定哪项错。
- 错误层依据：未有可证标准计算差异，四层待定。
- 可见性依据：完整4条decisions包含time/pop/grain/denom备选和decide，不是spec_info少信息即未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 74 行，`/instruction`）：

```text
Can you find 5 delivery drivers with the highest average number of daily deliveries?
```
完整题面

**standard 原文**（卷宗第 74 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "avg", "expression": "average daily deliveries per driver", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 74 行，`/final_sql`）：

```text
WITH base AS (
  SELECT d.driver_id AS driver_id,
         d.delivery_order_id AS doid,
         o.order_moment_finished AS s
  FROM deliveries d
  JOIN orders o ON o.delivery_order_id = d.delivery_order_id
  WHERE d.driver_id IS NOT NULL
    AND d.delivery_status = 'DELIVERED'
    AND o.order_moment_finished IS NOT NULL
), daily AS (
  SELECT driver_id,
         printf('%04d-%02d-%02d',
           CAST(substr(substr(s, instr(s,'/')+1), instr(substr(s, instr(s,'/')+1),'/')+1, 4) AS INTEGER),
           CAST(substr(substr(s, instr(s,'/')+1), 1, instr(substr(s, instr(s,'/')+1),'/')-1) AS INTEGER),
           CAST(substr(s, 1, instr(s,'/')-1) AS INTEGER)) AS day,
         COUNT(DISTINCT doid) AS deliveries
  FROM base
  GROUP BY driver_id, day
), avgd AS (
  SELECT driver_id, AVG(deliveries * 1.0) AS a
  FROM daily
  GROUP BY driver_id
)
SELECT driver_id, ROUND(a, 2) AS average_daily_deliveries
FROM avgd
ORDER BY a DESC, driver_id ASC
LIMIT 5
```
最终SQL完整数据流

**spec 原文**（卷宗第 74 行，`/our_spec_and_decisions/decisions/3/args/dispositions/4/rationale`）：

```text
“average number of daily deliveries” 问的是司机在出勤日中的日均配送量，分母应为该司机当日有配送的活跃日（数据覆盖 120 个日期，但各司机出勤日差异很大）。用全局日历天数作分母等于把未出勤日当零活动计入，且对所有人使用同一常数，等价于按总配送量排名，与“平均”语义不符；Jev 比较倾向活跃日候选。
```
相关声明/记录缺失

**spec 原文**（卷宗第 74 行，`/our_spec_and_decisions/decisions/1/args/addChoices`）：

```text
[{"localId": "c-time", "affects": ["time"], "alternatives": [{"localId": "alt-created", "statement": "以订单创建日（orders.order_created_year/month/day）作为配送发生的日期"}, {"localId": "alt-finished", "statement": "以订单完成时刻 orders.order_moment_finished 的日期作为配送发生的日期"}]}, {"localId": "c-denom", "affects": ["metric"], "alternatives": [{"localId": "alt-active-days", "statement": "分母为该司机有配送的天数（活跃日）：总配送数 / 该司机出现配送的天数"}, {"localId": "alt-global-days", "statement": "分母为全局观察期日历天数（当天有任意配送的日期去重数，对所有司机相同）：总配送数 / 全局天数"}]}, {"localId": "c-pop", "affects": ["filters", "metric"], "alternatives": [{"localId": "alt-all-status", "statement": "计入所有 delivery_status（DELIVERED/CANCELLED/DELIVERING）的配送行"}, {"localId": "alt-delivered-only", "statement": "仅计入 delivery_status = 'DELIVERED' 的配送行"}]}, {"localId": "c-grain", "affects": ["metric"], "alternatives": [{"localId": "alt-row", "statement": "按 deliveries 行计数（每行算一次配送）"}, {"localId": "alt-distinct-order", "statement": "同一 driver_id + 日期下按不同 delivery_order_id 去重计数"}]}, {"localId": "c-ties", "affects": ["ranking", "output"], "alternatives": [{"localId": "alt-strict", "statement": "严格输出 5 行；边界并列时按 driver_id 升序取前 5"}, {"localId": "alt-include-ties", "statement": "第 5 名存在并列时输出全部并列司机（行数可大于 5）"}]}]
```
全部相关备选

**spec 原文**（卷宗第 74 行，`/our_spec_and_decisions/decisions/3/args/dispositions/2/rationale`）：

```text
题面问的是司机每日完成的配送单量。观测显示 18,724 个 delivery_order_id 在 deliveries 中出现多行，其中 8,807 个限于同一司机、8,716 个跨司机，且绝大多数重复行的 delivery_status 相同（17,232 个订单为 2 行且均为 DELIVERED），属同一订单的重复配送记录。按行计数会重复计入同一单配送（探针：司机 25651 由 92.47 降为 51.67），故按不同 delivery_order_id 计数；Jev 比较亦倾向此候选。
```
distinct订单选择

**spec 原文**（卷宗第 74 行，`/our_spec_and_decisions/decisions/3/args/dispositions/3/rationale`）：

```text
deliveries 表自身无时间列，日期必须经 delivery_order_id 关联 orders 取得。order_moment_created 是下单时刻而非配送发生时刻；order_moment_finished 表示订单/配送完成，最贴近“某天完成了多少单配送”。探针显示仅 8,076/378,843 行因缺完成时间被排除（基本为取消/在途单），不改变前两名；Jev 比较倾向此候选。
```
finished日期选择

**证据限制**：
- 需Gold日期字段/解析、配送身份去重、缺天补零、状态范围、司机ID规范。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部4条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 75. local218

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：75。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：每team-season完整赛季总goal，再每team最大赛季，然后median。
- SQL 实际：UNION ALL主场SUM和客场SUM，不合并同team-season就MAX；末尾COUNT/MIN/MAX非median。
- 最早分叉依据：资格无证错；先缺主客赛季合计再MAX改变嵌套运算，早于median与输出。
- 错误层依据：缺总季进球层且未算median；无正确Spec可判实现违约。
- 可见性依据：{}及全[]缺嵌套公式，仅指记录缺失。
- 其他差异：["output"]

**standard 原文**（卷宗第 75 行，`/instruction`）：

```text
Can you calculate the median from the highest season goals of each team?
```
完整题面

**standard 原文**（卷宗第 75 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "median", "expression": "median of each team season maximum goals", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 75 行，`/final_sql`）：

```text
WITH team_season AS (
    SELECT home_team_api_id AS team_api_id, season, SUM(home_team_goal) AS season_goals
    FROM Match
    GROUP BY home_team_api_id, season
    UNION ALL
    SELECT away_team_api_id AS team_api_id, season, SUM(away_team_goal) AS season_goals
    FROM Match
    GROUP BY away_team_api_id, season
),
team_max AS (
    SELECT team_api_id, MAX(season_goals) AS max_season_goals
    FROM team_season
    GROUP BY team_api_id
)
SELECT COUNT(*) AS n_teams,
       MIN(max_season_goals) AS min_val,
       MAX(max_season_goals) AS max_val
FROM team_max
```
最终SQL完整数据流

**spec 原文**（卷宗第 75 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
相关声明/记录缺失

**证据限制**：
- timeout；Pred median29与final_sql摘要不一致，SQL可能最后探针，标签仅绑定给定SQL。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部0条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。
- 空Spec是记录缺失，不证明运行时从未声明。

### 76. local219

- 运行：`spider2-gold-correct-103-20260925-deepseek-subagent-v2-r2`；卷宗行：76。
- 分叉节点：**output**；错误层：**口径错**；可见性：**题面引用错**。
- 状态：`classified`；置信：`medium`。
- 标准：每league一队，标准仅league/team两列。
- SQL 实际：返回league/team/wins三列；按wins最少、apiid破tie。
- 最早分叉依据：零胜保留、跨季胜场无可证上游错；只确证额外wins输出。name/id不同未证明业务身份不等价。
- 错误层依据：Spec输出本身三列，SQL忠实，是声明偏差而非违反声明。
- 可见性依据：output引用r-each支持三列含wins，而题面哪队与标准两列未要求wins列。

**standard 原文**（卷宗第 76 行，`/instruction`）：

```text
In each league, considering all seasons, which single team has the fewest total match wins based on comparing home and away goals, including teams with zero wins, ensuring that if multiple teams tie for the fewest wins, only one team is returned for each league?
```
完整题面

**standard 原文**（卷宗第 76 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "argmin", "expression": "one fewest-win team per league across all seasons", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 76 行，`/final_sql`）：

```text
WITH tr AS (
  SELECT league_id, home_team_api_id AS team, home_team_goal AS gf, away_team_goal AS ga FROM "Match"
  UNION ALL
  SELECT league_id, away_team_api_id AS team, away_team_goal AS gf, home_team_goal AS ga FROM "Match"
),
w AS (
  SELECT league_id, team,
         SUM(CASE WHEN gf > ga THEN 1 ELSE 0 END) AS wins
  FROM tr
  GROUP BY league_id, team
),
ranked AS (
  SELECT league_id, team, wins,
         ROW_NUMBER() OVER (PARTITION BY league_id ORDER BY wins ASC, team ASC) AS rn
  FROM w
)
SELECT l.name AS league, t.team_long_name AS team, r.wins AS wins
FROM ranked r
JOIN League l ON l.id = r.league_id
JOIN Team t ON t.team_api_id = r.team
WHERE r.rn = 1
ORDER BY l.name;
```
最终SQL完整数据流

**spec 原文**（卷宗第 76 行，`/our_spec_and_decisions/decisions/0/args/spec/output`）：

```text
{"value": {"rowMode": "grouped", "rowCount": 11, "columns": ["league", "team", "wins"]}, "evidenceIds": ["r-each"]}
```
相关声明/记录缺失

**standard 原文**（卷宗第 76 行，`/standard_semantics/facets/output/alternatives/0`）：

```text
{"rowMode": "grouped", "rowCount": 11, "columnCount": 2, "columnNames": ["league", "team"], "evidenceRefs": ["Q1"]}
```
明确两列形状

**standard 原文**（卷宗第 76 行，`/standard_semantics/gold_sql`）：

```text
WITH match_view AS(
SELECT
    M.id,
    L.name AS league,
    M.season,
    M.match_api_id,
    T.team_long_name AS home_team,
    TM.team_long_name AS away_team,
    M.home_team_goal,
    M.away_team_goal,
    P1.player_name AS home_gk,
    P2.player_name AS home_center_back_1,
    P3.player_name AS home_center_back_2,
    P4.player_name AS home_right_back,
    P5.player_name AS home_left_back,
    P6.player_name AS home_midfield_1,
    P7.player_name AS home_midfield_2,
    P8.player_name AS home_midfield_3,
    P9.player_name AS home_midfield_4,
    P10.player_name AS home_second_forward,
    P11.player_name AS home_center_forward,
    P12.player_name AS away_gk,
    P13.player_name AS away_center_back_1,
    P14.player_name AS away_center_back_2,
    P15.player_name AS away_right_back,
    P16.player_name AS away_left_back,
    P17.player_name AS away_midfield_1,
    P18.player_name AS away_midfield_2,
    P19.player_name AS away_midfield_3,
    P20.player_name AS away_midfield_4,
    P21.player_name AS away_second_forward,
    P22.player_name AS away_center_forward,
    M.goal,
    M.card
FROM
    match M
LEFT JOIN
    league L ON M.league_id = L.id
LEFT JOIN
    team T ON M.home_team_api_id = T.team_api_id
LEFT JOIN
    team TM ON M.away_team_api_id = TM.team_api_id
LEFT JOIN
    player P1 ON M.home_player_1 = P1.player_api_id
LEFT JOIN
    player P2 ON M.home_player_2 = P2.player_api_id
LEFT JOIN
    player P3 ON M.home_player_3 = P3.player_api_id
LEFT JOIN
    player P4 ON M.home_player_4 = P4.player_api_id
LEFT JOIN
    player P5 ON M.home_player_5 = P5.player_api_id
LEFT JOIN
    player P6 ON M.home_player_6 = P6.player_api_id
LEFT JOIN
    player P7 ON M.home_player_7 = P7.player_api_id
LEFT JOIN
    player P8 ON M.home_player_8 = P8.player_api_id
LEFT JOIN
    player P9 ON M.home_player_9 = P9.player_api_id
LEFT JOIN
    player P10 ON M.home_player_10 = P10.player_api_id
LEFT JOIN
    player P11 ON M.home_player_11 = P11.player_api_id
LEFT JOIN
    player P12 ON M.away_player_1 = P12.player_api_id
LEFT JOIN
    player P13 ON M.away_player_2 = P13.player_api_id
LEFT JOIN
    player P14 ON M.away_player_3 = P14.player_api_id
LEFT JOIN
    player P15 ON M.away_player_4 = P15.player_api_id
LEFT JOIN
    player P16 ON M.away_player_5 = P16.player_api_id
LEFT JOIN
    player P17 ON M.away_player_6 = P17.player_api_id
LEFT JOIN
    player P18 ON M.away_player_7 = P18.player_api_id
LEFT JOIN
    player P19 ON M.away_player_8 = P19.player_api_id
LEFT JOIN
    player P20 ON M.away_player_9 = P20.player_api_id
LEFT JOIN
    player P21 ON M.away_player_10 = P21.player_api_id
LEFT JOIN
    player P22 ON M.away_player_11 = P22.player_api_id
),
match_score AS
(
    SELECT  -- Displaying teams and their goals as home_team
        id,
        home_team AS team,
        CASE
            WHEN home_team_goal > away_team_goal THEN 1 ELSE 0 END AS Winning_match
    FROM
        match_view

    UNION ALL

    SELECT  -- Displaying teams and their goals as away_team
        id,
        away_team AS team,
        CASE
            WHEN away_team_goal > home_team_goal THEN 1 ELSE 0 END AS Winning_match
    FROM
        match_view
),
winning_matches AS
(
    SELECT  -- Displaying total match wins for each team
        MV.league,
        M.team,
        COUNT(CASE WHEN M.Winning_match = 1 THEN 1 END) AS wins,
        ROW_NUMBER() OVER(PARTITION BY MV.league ORDER BY COUNT(CASE WHEN M.Winning_match = 1 THEN 1 END) ASC) AS rn
    FROM
        match_score M
    JOIN
        match_view MV
    ON
        M.id = MV.id
    GROUP BY
        MV.league,
        team
    ORDER BY
        league,
        wins ASC
)
SELECT
    league,
    team
FROM
    winning_matches
WHERE
    rn = 1  -- Getting the team with the least number of wins in each league
ORDER BY
    league;
```
Gold名称分组与未明确tiekey

**spec 原文**（卷宗第 76 行，`/our_spec_and_decisions/decisions/2/args/spec/ranking/value/orderBy`）：

```text
total wins ascending (fewest first); deterministic stable tie-break by team_api_id ascending
```
末次apiid破tie声明

**证据限制**：
- 德国队名差异未解释；Gold按team_long_name组、SQL按apiid组，等价性未知，不声称合并实体错误。
- Gold ROW_NUMBER仅wins排序、SQL apiid破tie；题面选一但未定tiekey，不能因此断言谁错。
- 已逐项阅读spec_info、全部3条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 77. local220

- 运行：`spider2-29-gpt-6-luna-20260923-002`；卷宗行：77。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：胜/负分别选实际参赛、非null且非draw球员次数最多者。
- SQL 实际：展开主客双方各11槽，分别按球队胜负判断，排null，player_id/outcome count，RANK选最多。
- 最早分叉依据：完整双方展开与null/draw正确；Ronaldo/Iraizoz vs Marcelo/Ricardo不能证明ID/名称合并错。
- 错误层依据：需Gold及身份细则定位四层。
- 可见性依据：1条decision正确声明appearances win/loss及过滤，SQL对应；不能因为spec_info仅deliveryRequirement说未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 77 行，`/instruction`）：

```text
Which player has participated in the highest number of winning matches and which player has participated in the highest number of losing matches, considering only matches where they actually played (excluding null entries) and where their team won or lost (excluding draws)?
```
完整题面

**standard 原文**（卷宗第 77 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "argmax", "expression": "player with most winning matches and player with most losing matches", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 77 行，`/final_sql`）：

```text
WITH appearances AS (SELECT home_player_1 AS player_id, 'win' AS outcome FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_2,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_3,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_4,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_5,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_6,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_7,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_8,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_9,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_10,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT home_player_11,'win' FROM Match WHERE home_team_goal > away_team_goal UNION ALL SELECT away_player_1,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_2,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_3,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_4,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_5,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_6,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_7,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_8,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_9,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_10,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT away_player_11,'win' FROM Match WHERE away_team_goal > home_team_goal UNION ALL SELECT home_player_1,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_2,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_3,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_4,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_5,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_6,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_7,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_8,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_9,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_10,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT home_player_11,'loss' FROM Match WHERE home_team_goal < away_team_goal UNION ALL SELECT away_player_1,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_2,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_3,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_4,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_5,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_6,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_7,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_8,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_9,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_10,'loss' FROM Match WHERE away_team_goal < home_team_goal UNION ALL SELECT away_player_11,'loss' FROM Match WHERE away_team_goal < home_team_goal), counts AS (SELECT player_id,outcome,COUNT(*) AS match_count FROM appearances WHERE player_id IS NOT NULL GROUP BY player_id,outcome), ranked AS (SELECT *, RANK() OVER (PARTITION BY outcome ORDER BY match_count DESC) AS rnk FROM counts) SELECT r.outcome,p.player_name,r.match_count FROM ranked r JOIN Player p ON p.player_api_id=r.player_id WHERE r.rnk=1 ORDER BY r.outcome,p.player_name
```
最终SQL完整数据流

**spec 原文**（卷宗第 77 行，`/our_spec_and_decisions/decisions/0/args/spec/metric/value/expression`）：

```text
appearances in winning matches and losing matches separately
```
相关声明/记录缺失

**spec 原文**（卷宗第 77 行，`/our_spec_and_decisions/decisions/0/args/spec/filters`）：

```text
[{"value": "player slot is not NULL"}, {"value": "home_team_goal != away_team_goal; classify team outcome as win or loss"}]
```
null/draw资格声明

**证据限制**：
- 需GoldSQL、同名跨ID是否合并、完整身份映射；无数据证同球员同场重复槽。
- 3列输出不同Gold允许1/2列形状是已知次级偏差，不能解释球员差异。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部1条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 78. local228

- 运行：`spec-names-10-20260927-deepseek-r1`；卷宗行：78。
- 分叉节点：**output**；错误层：**口径错**；可见性：**待定后决定错**。
- 状态：`classified`；置信：`high`。
- 标准：每season-position一对batsman/bowler，27行5列，season升序。
- SQL 实际：分季sum/count、ROW_NUMBER按小playerid破tie，正确配1/1、2/2、3/3，横向拼成每季一行13列。
- 最早分叉依据：排dismissal、计分/球员数及分季排名无确定上游错；row grain从season-position改season-wide是output，非grouping聚合错。
- 错误层依据：Spec选wide，SQL落实。
- 可见性依据：c-shape有wide/long候选，后decide以matched positions排除long而选wide，候选选择意图明确。

**standard 原文**（卷宗第 78 行，`/instruction`）：

```text
For each IPL season, identify the top three batsmen with the highest total runs scored and the top three bowlers with the most wickets taken, excluding ‘run out’, ‘hit wicket’, and ‘retired hurt’ dismissals. In the event of ties in runs or wickets, break the tie using the smaller player ID. Then output these six players in matched positions—batsman 1 with bowler 1, batsman 2 with bowler 2, and batsman 3 with bowler 3—in ascending order of the season ID, along with each player’s total runs or wickets.
```
完整题面

**standard 原文**（卷宗第 78 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "ranked_detail", "expression": "top three batsmen by runs and top three bowlers by wickets per season", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 78 行，`/final_sql`）：

```text
WITH bat AS (
  SELECT m.season_id AS season_id, bb.striker AS player_id, SUM(bs.runs_scored) AS runs
  FROM ball_by_ball bb
  JOIN batsman_scored bs ON bs.match_id=bb.match_id AND bs.over_id=bb.over_id AND bs.ball_id=bb.ball_id AND bs.innings_no=bb.innings_no
  JOIN match m ON m.match_id=bb.match_id
  GROUP BY m.season_id, bb.striker
), batr AS (
  SELECT season_id, player_id, runs,
         ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY runs DESC, player_id ASC) AS rn
  FROM bat
), bowl AS (
  SELECT m.season_id AS season_id, bb.bowler AS player_id, COUNT(*) AS wickets
  FROM wicket_taken w
  JOIN ball_by_ball bb ON bb.match_id=w.match_id AND bb.over_id=w.over_id AND bb.ball_id=w.ball_id AND bb.innings_no=w.innings_no
  JOIN match m ON m.match_id=w.match_id
  WHERE w.kind_out NOT IN ('run out','hit wicket','retired hurt')
  GROUP BY m.season_id, bb.bowler
), bowlr AS (
  SELECT season_id, player_id, wickets,
         ROW_NUMBER() OVER (PARTITION BY season_id ORDER BY wickets DESC, player_id ASC) AS rn
  FROM bowl
)
SELECT b1.season_id AS season_id,
       b1.player_id AS batsman1_player_id, b1.runs AS batsman1_runs,
       w1.player_id AS bowler1_player_id, w1.wickets AS bowler1_wickets,
       b2.player_id AS batsman2_player_id, b2.runs AS batsman2_runs,
       w2.player_id AS bowler2_player_id, w2.wickets AS bowler2_wickets,
       b3.player_id AS batsman3_player_id, b3.runs AS batsman3_runs,
       w3.player_id AS bowler3_player_id, w3.wickets AS bowler3_wickets
FROM batr b1
JOIN bowlr w1 ON w1.season_id=b1.season_id AND w1.rn=1
JOIN batr b2 ON b2.season_id=b1.season_id AND b2.rn=2
JOIN bowlr w2 ON w2.season_id=b1.season_id AND w2.rn=2
JOIN batr b3 ON b3.season_id=b1.season_id AND b3.rn=3
JOIN bowlr w3 ON w3.season_id=b1.season_id AND w3.rn=3
WHERE b1.rn=1
ORDER BY b1.season_id;
```
最终SQL完整数据流

**spec 原文**（卷宗第 78 行，`/our_spec_and_decisions/decisions/2/args/dispositions/0/rationale`）：

```text
The wording 'output these six players in matched positions - batsman 1 with bowler 1, batsman 2 with bowler 2, and batsman 3 with bowler 3' makes each batsman and his rank-matched bowler one matched unit; the only reading that literally realizes the pairing in a single record is one row per season holding the three matched pairs. The alternative (one row per season and rank, 3 rows per season) splits a season over three rows and repeats season_id, so the matched-pair phrase excludes it. 'in ascending order of the season ID' then orders the 9 season rows. Jev's lean (0.83) agrees.
```
相关声明/记录缺失

**standard 原文**（卷宗第 78 行，`/standard_semantics/facets/output/alternatives/0`）：

```text
{"rowMode": "grouped", "rowCount": 27, "columnCount": 5, "columnNames": ["season id", "batsman", "runs", "bowler", "wickets"], "evidenceRefs": ["Q1"]}
```
27行5列标准

**spec 原文**（卷宗第 78 行，`/our_spec_and_decisions/decisions/0/args/choices/0`）：

```text
{"localId": "c-shape", "affects": ["output"], "alternatives": [{"localId": "shape-wide", "statement": "One row per season: season_id plus, for ranks 1-3, the batsman id, his runs, the matched bowler id and his wickets (9 rows, 13 columns)."}, {"localId": "shape-long", "statement": "One row per season and rank: season_id, rank 1-3, batsman id, batsman runs, matched bowler id, bowler wickets (27 rows, 6 columns)."}]}
```
wide/long候选

**证据限制**：
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部3条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 79. local229

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：79。
- 分叉节点：**selection.ties**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：每match最高partnership保留多个并列pair；高个人分/同分高ID为player1。
- SQL 实际：连续pair段求双方分；RANK ORDER BY partnership_runs DESC,innings_no,gid后rk1仅留第一段；pair内部排序正确。
- 最早分叉依据：无标准细则证连续段/extra上游错，不由行数猜；可证附加innings/gid破最高分同分，selection.ties分叉。
- 错误层依据：Spec末次ranking明确全部并列，SQL用段唯一键使同分不同rank，违反正确声明意图。
- 可见性依据：正确保留并列声明不属五种错误可见性，故taxonomy_gap，不造未声明/假定错。
- 其他差异：["output"]

**standard 原文**（卷宗第 79 行，`/instruction`）：

```text
Find the IDs of players who scored the highest number of partnership runs for each match. The output should include the IDs of two players, each with their individual scores and the total partnership score. For each pair, the player with the higher individual score should be listed as player 1, and the player with the lower score as player 2. In cases where both players have the same score, the player with the higher ID should be player 1, and the player with the lower ID should be player 2. There can be multiple rows for a single match.
```
完整题面

**standard 原文**（卷宗第 79 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "max", "expression": "highest partnership run total per match, retaining multiple pairs", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 79 行，`/final_sql`）：

```text
WITH
deli AS (
  SELECT b.match_id, b.innings_no, b.over_id, b.ball_id, b.striker, b.non_striker,
         MIN(b.striker,b.non_striker) AS p1,
         MAX(b.striker,b.non_striker) AS p2,
         COALESCE(bs.runs_scored,0) AS runs
  FROM ball_by_ball b
  LEFT JOIN batsman_scored bs
    ON bs.match_id=b.match_id AND bs.innings_no=b.innings_no
   AND bs.over_id=b.over_id AND bs.ball_id=b.ball_id
),
flagged AS (
  SELECT d.*,
         CASE WHEN p1 = LAG(p1) OVER (PARTITION BY match_id,innings_no ORDER BY over_id,ball_id)
              AND   p2 = LAG(p2) OVER (PARTITION BY match_id,innings_no ORDER BY over_id,ball_id)
              THEN 0 ELSE 1 END AS is_newseg
  FROM deli d
),
seg AS (
  SELECT match_id, innings_no, over_id, ball_id, striker, non_striker, p1, p2, runs,
         SUM(is_newseg) OVER (PARTITION BY match_id,innings_no ORDER BY over_id,ball_id) AS gid
  FROM flagged
),
part AS (
  SELECT match_id, innings_no, gid, p1, p2,
         SUM(CASE WHEN striker=p1 THEN runs ELSE 0 END) AS run1,
         SUM(CASE WHEN striker=p2 THEN runs ELSE 0 END) AS run2,
         SUM(runs) AS partnership_runs
  FROM seg
  GROUP BY match_id, innings_no, gid, p1, p2
),
top AS (
  SELECT match_id, innings_no, gid, p1, run1, p2, run2, partnership_runs,
         RANK() OVER (PARTITION BY match_id ORDER BY partnership_runs DESC, innings_no, gid) AS rk
  FROM part
)
SELECT match_id,
       CASE WHEN run1>run2 THEN p1 WHEN run2>run1 THEN p2 ELSE p2 END AS player1,
       CASE WHEN run1>run2 THEN run1 WHEN run2>run1 THEN run2 ELSE run1 END AS player1_runs,
       CASE WHEN run1>run2 THEN p2 WHEN run2>run1 THEN p1 ELSE p1 END AS player2,
       CASE WHEN run1>run2 THEN run2 WHEN run2>run1 THEN run1 ELSE run2 END AS player2_runs,
       partnership_runs
FROM top
WHERE rk=1
ORDER BY match_id, innings_no, gid
```
最终SQL完整数据流

**spec 原文**（卷宗第 79 行，`/our_spec_and_decisions/decisions/1/args/spec/ranking`）：

```text
per-match 按 partnership_runs 取最高（保留并列全部行）
```
相关声明/记录缺失

**standard 原文**（卷宗第 79 行，`/standard_semantics/facets/ranking/alternatives/0/tiePolicy`）：

```text
multiple rows allowed
```
明确多行并列

**证据限制**：
- 连续段定义及是否含extras缺Gold细则；声明无返回，只按可见声明意图比较。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部2条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 80. local230

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：80。
- 分叉节点：**selection**；错误层：**标准答案有问题**；可见性：**定义缺口**。
- 状态：`classified`；置信：`medium`。
- 标准：题面及标准明确top4 directors；实际Pred确有4位。
- SQL 实际：SQL qualifying above8影片先选top3 genres，再distinct电影数排序LIMIT4；Gold仅3行。
- 最早分叉依据：可证Gold人数与top4明确要求矛盾；不由4/3/3vs2/2/2猜genre行加权或总体错。
- 错误层依据：标准结果选取数量违背top4，数值计数差异仍待补，并非Gold全部问题已解决。
- 可见性依据：全部3条decisions末次ranking正确top4且SQL一致，无五种错误声明，taxonomy_gap。

**standard 原文**（卷宗第 80 行，`/instruction`）：

```text
Determine the top three genres with the most movies rated above 8, and then identify the top four directors who have directed the most films rated above 8 within those genres. List these directors and their respective movie counts.
```
完整题面

**standard 原文**（卷宗第 80 行，`/standard_semantics/facets/measure/alternatives`）：

```text
[{"kind": "count", "expression": "qualifying above-8 film count per selected director", "evidenceRefs": ["Q1"]}]
```
标准度量

**sql 原文**（卷宗第 80 行，`/final_sql`）：

```text
WITH high_movies AS (
   SELECT DISTINCT movie_id FROM ratings WHERE avg_rating > 8
),
top_genres AS (
   SELECT g.genre
   FROM genre g JOIN high_movies hm ON hm.movie_id = g.movie_id
   GROUP BY g.genre
   ORDER BY COUNT(DISTINCT g.movie_id) DESC, g.genre ASC
   LIMIT 3
),
top3_films AS (
   SELECT DISTINCT g.movie_id
   FROM genre g
   JOIN top_genres tg ON tg.genre = g.genre
   JOIN high_movies hm ON hm.movie_id = g.movie_id
),
dir_films AS (
   SELECT dm.name_id, COUNT(DISTINCT dm.movie_id) AS num_films
   FROM director_mapping dm
   JOIN top3_films tf ON tf.movie_id = dm.movie_id
   GROUP BY dm.name_id
)
SELECT n.name AS director, df.num_films AS movie_count
FROM dir_films df JOIN names n ON n.id = df.name_id
ORDER BY df.num_films DESC, n.name ASC
LIMIT 4
```
最终SQL完整数据流

**spec 原文**（卷宗第 80 行，`/our_spec_and_decisions/decisions/2/args/spec/ranking`）：

```text
top 4 directors by distinct film count
```
相关声明/记录缺失

**standard 原文**（卷宗第 80 行，`/standard_semantics/facets/ranking/alternatives/1/selection`）：

```text
top 4 directors
```
明确top4

**result 原文**（卷宗第 80 行，`/gold_results/0/csv_info`）：

```text
{"exists": true, "rows": 3, "cols": 2, "header": ["director_name", "movie_count"], "head": [["James Mangold", "4"], ["Anthony Russo", "3"], ["Joe Russo", "3"]]}
```
完整三行Gold

**result 原文**（卷宗第 80 行，`/predicted_result/csv_info`）：

```text
{"exists": true, "rows": 4, "cols": 2, "header": ["director", "movie_count"], "head": [["Anthony Russo", "2"], ["James Mangold", "2"], ["Joe Russo", "2"], ["Marianne Elliott", "2"]]}
```
完整四行Pred

**证据限制**：
- Gold计数差异未解释，不认定应按genre匹配行计数。
- Pred确有第4位count2导演，证明有第四位可输出；Gold3行不是上游总体错的证据。
- Gold SQL缺失，只有结果head而非全集；不推定隐藏处理。
- 已逐项阅读spec_info、全部3条decisions及disclosures。工具参数仅证明意图，无返回不能称已生效。

### 81. local244

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：81。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：按时长类别给最短/最长分钟数及收入；标准无完整分类边界定义。
- SQL 实际：全目录min/avg/max中点分类，返回类别实际MIN/MAX，InvoiceLine收入SUM，两位舍入。
- 最早分叉依据：收入可见值相同；Gold相邻类别端点相同，SQL返回类别实际极值。缺Gold SQL及边界业务定义，不能认定Gold是在输出隐藏分类阈值，更不能由结果猜总体错。输出列顺序和精度差异不能解释主要时长差异。
- 错误层依据：无证据确定主要时长差异属于哪一层。
- 可见性依据：完整检查spec_info、五次decisions及disclosures；目录与收入假设已明示，未知Gold端点不能归错误可见性。
- 其他差异：["output"]

**standard 原文**（卷宗第 81 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
minimum duration per track-length category
```
要求类别最短时长

**standard 原文**（卷宗第 81 行，`/instruction`）：

```text
Calculate the duration of each track, classify them as short, medium, or long, output the minimum and maximum time for each kind (in minutes) and the total revenue for each category, group by the category.
```
题面整体要求

**sql 原文**（卷宗第 81 行，`/final_sql`）：

```text
WITH stats AS (SELECT MIN(Milliseconds) AS mn, MAX(Milliseconds) AS mx, AVG(Milliseconds) AS av FROM Track),
cls AS (SELECT t.TrackId, t.Milliseconds,
  CASE WHEN t.Milliseconds <= (s.mn + s.av)/2.0 THEN 'short'
       WHEN t.Milliseconds <= (s.av + s.mx)/2.0 THEN 'medium'
       ELSE 'long' END AS length_type
  FROM Track t CROSS JOIN stats s),
rev AS (SELECT c.length_type, SUM(il.UnitPrice * il.Quantity) AS revenue
  FROM cls c JOIN InvoiceLine il ON c.TrackId = il.TrackId GROUP BY c.length_type)
SELECT c.length_type,
  ROUND(MIN(c.Milliseconds)/60000.0, 2) AS min_duration_minutes,
  ROUND(MAX(c.Milliseconds)/60000.0, 2) AS max_duration_minutes,
  ROUND(COALESCE(r.revenue, 0), 2) AS total_revenue
FROM cls c LEFT JOIN rev r ON c.length_type = r.length_type
GROUP BY c.length_type
```
分类、实际极值与收入计算

**spec 原文**（卷宗第 81 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
short/medium/long 分类对象为全部 track(Milliseconds 分布)，min/max 时长同样基于该全集
```
目录总体假设

**spec 原文**（卷宗第 81 行，`/our_spec_and_decisions/decisions/4/args/spec/metric`）：

```text
milliseconds->minutes 的 min/max；售出收入 SUM(il.UnitPrice*il.Quantity)
```
最后MIN/MAX和收入提议

**result 原文**（卷宗第 81 行，`/gold_results/0/csv_info/head/1/1`）：

```text
3.2889184341992577
```
短类上端点

**result 原文**（卷宗第 81 行，`/gold_results/0/csv_info/head/2/0`）：

```text
3.2889184341992577
```
中类下端点相同

**result 原文**（卷宗第 81 行，`/predicted_result/csv_info/head/0/1`）：

```text
47.73
```
实际长类最短时长

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 需分类业务文档、Gold端点计算规则和允许精度。

### 82. local253

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：82。
- 分叉节点：**measure.denominator**；错误层：**标准答案有问题**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：整体全国平均工资是全部工资记录上的单一均值，不是同公司全国均值。
- SQL 实际：清洗Salary后按城市公司平均取前五；全国AVG(cl)后CROSS JOIN共享同一常数。
- 最早分叉依据：公司/地点实体、城市条件与清洗无已证实更早错误。Gold全国列在同一城市随公司变化，与题面overall national average单一分母总体具体矛盾，最早落denominator。
- 错误层依据：Gold展示的多种全国值违背题面整体全国均值；不臆称Gold具体用了哪种公司分母。
- 可见性依据：Spec明确列出全国范围备选，后续参数选nat-all-rows，方向符合题面；错误在Gold，五种错误可见性无诚实适用项。

**standard 原文**（卷宗第 82 行，`/instruction`）：

```text
Using a Salary Dataset where the salary values need to be cleaned by removing non-numeric characters and converting them to a numeric type, write a detailed SQL query that identifies the top 5 companies by average salary in each of Mumbai, Pune, New Delhi, and Hyderabad, then compares each company’s average salary in those cities to the overall national average salary. The final result should display four columns: Location, Company Name, Average Salary in State, and Average Salary in Country, listing only the top 5 companies in each of the specified locations.
```
明确overall national average salary

**standard 原文**（卷宗第 82 行，`/standard_semantics/facets/denominator/alternatives/0/expression`）：

```text
salary rows in company-location and national populations
```
全国记录总体

**sql 原文**（卷宗第 82 行，`/final_sql`）：

```text
WITH base AS (
  SELECT Location, CompanyName, Salary
  FROM SalaryDataset
  WHERE Salary IS NOT NULL
),
n1 AS (
  SELECT Location, CompanyName,
         CASE WHEN instr(Salary, ',') > 0
              THEN substr(Salary, 1, instr(Salary, ',') - 1) || substr(Salary, instr(Salary, ',') + 1)
              ELSE Salary END AS s1
  FROM base
),
n2 AS (
  SELECT Location, CompanyName,
         CASE WHEN instr(s1, ',') > 0
              THEN substr(s1, 1, instr(s1, ',') - 1) || substr(s1, instr(s1, ',') + 1)
              ELSE s1 END AS s2
  FROM n1
),
n3 AS (
  SELECT Location, CompanyName,
         CASE WHEN instr(s2, ',') > 0
              THEN substr(s2, 1, instr(s2, ',') - 1) || substr(s2, instr(s2, ',') + 1)
              ELSE s2 END AS s3
  FROM n2
),
pos AS (
  SELECT Location, CompanyName, s3,
         min(CASE WHEN instr(s3,'0') > 0 THEN instr(s3,'0') ELSE 999 END,
             CASE WHEN instr(s3,'1') > 0 THEN instr(s3,'1') ELSE 999 END,
             CASE WHEN instr(s3,'2') > 0 THEN instr(s3,'2') ELSE 999 END,
             CASE WHEN instr(s3,'3') > 0 THEN instr(s3,'3') ELSE 999 END,
             CASE WHEN instr(s3,'4') > 0 THEN instr(s3,'4') ELSE 999 END,
             CASE WHEN instr(s3,'5') > 0 THEN instr(s3,'5') ELSE 999 END,
             CASE WHEN instr(s3,'6') > 0 THEN instr(s3,'6') ELSE 999 END,
             CASE WHEN instr(s3,'7') > 0 THEN instr(s3,'7') ELSE 999 END,
             CASE WHEN instr(s3,'8') > 0 THEN instr(s3,'8') ELSE 999 END,
             CASE WHEN instr(s3,'9') > 0 THEN instr(s3,'9') ELSE 999 END) AS dp
  FROM n3
),
cl AS (
  SELECT Location, CompanyName,
         CASE WHEN dp >= 999 THEN NULL ELSE CAST(substr(s3, dp) AS REAL) END AS salary_num
  FROM pos
),
city_avg AS (
  SELECT Location, CompanyName, AVG(salary_num) AS avg_city
  FROM cl
  WHERE Location IN ('Mumbai','Pune','New Delhi','Hyderabad')
    AND salary_num IS NOT NULL
  GROUP BY Location, CompanyName
),
ranked AS (
  SELECT Location, CompanyName, avg_city,
         ROW_NUMBER() OVER (PARTITION BY Location ORDER BY avg_city DESC, CompanyName ASC) AS rn
  FROM city_avg
),
nat AS (
  SELECT AVG(salary_num) AS avg_country
  FROM cl
  WHERE salary_num IS NOT NULL
)
SELECT r.Location AS "Location",
       r.CompanyName AS "Company Name",
       ROUND(r.avg_city, 2) AS "Average Salary in State",
       ROUND(n.avg_country, 2) AS "Average Salary in Country"
FROM ranked r
CROSS JOIN nat n
WHERE r.rn <= 5
ORDER BY r.Location ASC, r.avg_city DESC, r.CompanyName ASC
```
全国AVG和共享常数

**spec 原文**（卷宗第 82 行，`/our_spec_and_decisions/decisions/3/args/choices/0/selectedAlternativeId`）：

```text
nat-all-rows
```
提议选择全体全国

**spec 原文**（卷宗第 82 行，`/our_spec_and_decisions/decisions/3/args/choices/0/alternatives/0/statement`）：

```text
Average Salary in Country = 全表所有记录（4344 行、5 个城市）清洗后薪资的总平均，四列中为同一常量
```
全国常数候选

**result 原文**（卷宗第 82 行，`/gold_results/0/csv_info/head/0/3`）：

```text
5081882.0
```
第一公司全国值

**result 原文**（卷宗第 82 行，`/gold_results/0/csv_info/head/1/3`）：

```text
4949704.0
```
第二公司全国值不同

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 清洗SQL最多去三处逗号再首数字CAST；没有原工资全集，不能证明存在其他字符造成更早错误。

### 83. local258

- 运行：`wrong-submitted-34-20260926-deepseek-rationale-480s`；卷宗行：83。
- 分叉节点：**output**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：标准输出包括数字bowler ID和独立player_name，再给四项统计。
- SQL 实际：五列输出，将姓名作为bowler，未返回独立数字业务ID；计数用六种投手归属dismissal和合法球。
- 最早分叉依据：无Gold SQL，不由wickets及rate差异猜kind_out映射、总体或join倍数。已知业务ID缺失是output内容差异而非纯别名差异；未知上游另错不作定论。
- 错误层依据：输出提议本身五列，SQL兑现它；不是违背正确六列Spec。
- 可见性依据：完整检查spec_info和四次decisions；output直接值五列，无合格题面证据支持丢弃ID，归假定错。

**standard 原文**（卷宗第 83 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["bowler", "player_name", "wickets", "economy_rate", "bowler_strike_rate", "Best_Bowling_figure"]
```
标准独立ID和姓名

**sql 原文**（卷宗第 83 行，`/final_sql`）：

```text
WITH deliv AS (
  SELECT b.match_id AS match_id, b.bowler AS bowler,
         COALESCE(s.runs_scored,0) AS bat_runs,
         CASE WHEN e.extra_type IN ('wides','noballs') THEN 1 ELSE 0 END AS is_extra
  FROM ball_by_ball b
  LEFT JOIN batsman_scored s
    ON b.match_id=s.match_id AND b.innings_no=s.innings_no AND b.over_id=s.over_id AND b.ball_id=s.ball_id
  LEFT JOIN extra_runs e
    ON b.match_id=e.match_id AND b.innings_no=e.innings_no AND b.over_id=e.over_id AND b.ball_id=e.ball_id
),
bowl AS (
  SELECT bowler, SUM(CASE WHEN is_extra=0 THEN 1 ELSE 0 END) AS balls, SUM(bat_runs) AS runs
  FROM deliv GROUP BY bowler
),
wk AS (
  SELECT b.bowler AS bowler, COUNT(*) AS wickets
  FROM wicket_taken w
  JOIN ball_by_ball b
    ON w.match_id=b.match_id AND w.innings_no=b.innings_no AND w.over_id=b.over_id AND w.ball_id=b.ball_id
  WHERE w.kind_out IN ('caught','bowled','lbw','caught and bowled','stumped','hit wicket')
  GROUP BY b.bowler
),
wkm AS (
  SELECT b.bowler AS bowler, b.match_id AS match_id, COUNT(*) AS wkts
  FROM wicket_taken w
  JOIN ball_by_ball b
    ON w.match_id=b.match_id AND w.innings_no=b.innings_no AND w.over_id=b.over_id AND w.ball_id=b.ball_id
  WHERE w.kind_out IN ('caught','bowled','lbw','caught and bowled','stumped','hit wicket')
  GROUP BY b.bowler, b.match_id
),
mr AS (
  SELECT bowler, match_id, SUM(bat_runs) AS runs
  FROM deliv GROUP BY bowler, match_id
),
perf AS (
  SELECT mr.bowler AS bowler, mr.runs AS runs, COALESCE(wkm.wkts,0) AS wkts
  FROM mr LEFT JOIN wkm ON wkm.bowler=mr.bowler AND wkm.match_id=mr.match_id
),
best AS (
  SELECT bowler, wkts, runs FROM (
    SELECT bowler, wkts, runs,
           ROW_NUMBER() OVER (PARTITION BY bowler ORDER BY wkts DESC, runs ASC) AS rn
    FROM perf
  ) WHERE rn=1
)
SELECT COALESCE(p.player_name, 'Player ' || bowl.bowler) AS bowler,
       COALESCE(wk.wickets,0) AS wickets,
       ROUND(bowl.runs*6.0/NULLIF(bowl.balls,0), 2) AS economy_rate,
       CASE WHEN COALESCE(wk.wickets,0)=0 THEN NULL ELSE ROUND(bowl.balls*1.0/wk.wickets, 2) END AS strike_rate,
       best.wkts || '-' || best.runs AS best_bowling
FROM bowl
LEFT JOIN wk ON wk.bowler=bowl.bowler
LEFT JOIN best ON best.bowler=bowl.bowler
LEFT JOIN player p ON p.player_id=bowl.bowler
ORDER BY wickets DESC, economy_rate ASC, bowler ASC
```
姓名占bowler，ID未输出

**spec 原文**（卷宗第 83 行，`/our_spec_and_decisions/decisions/0/args/spec/output/value/columns`）：

```text
["bowler", "wickets", "economy_rate", "strike_rate", "best_bowling"]
```
五列输出提议

**spec 原文**（卷宗第 83 行，`/our_spec_and_decisions/decisions/1/args/spec/metric/value/expression`）：

```text
wickets = COUNT of wicket_taken rows credited to the bowler (kind_out in ('caught','bowled','lbw','caught and bowled','stumped','hit wicket')); balls_bowled = count of legal deliveries (deliveries whose extra_type is NOT 'wides'/'noballs'); economy_rate = SUM(runs scored off the bat against the bowler)*6 / balls_bowled; strike_rate = balls_bowled / wickets; best_bowling = per (bowler,match) credited wickets with that match's off-bat runs, chosen by max wickets then min runs, formatted 'wickets-runs'
```
球数等计算已声明

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 已知输出遗漏不能解释所有数值差异；需Gold wicket归属、零wicket资格、球数及Best_Bowling_figure细则以排查更早分叉。

### 84. local259

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：84。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：每球员生涯资料，忽略extras；最佳比赛先wickets最大再runs最小。
- SQL 实际：player全体LEFT JOIN统计；balls为batsman_scored连接粒度，matches来自player_match，wickets排除非投手归属。
- 最早分叉依据：标准grain说player且键striker，却无明确资格交集。Gold省略某些球员且matches/balls不同，不能由行数或数值推断Gold隐藏总体、连接或计数来源。
- 错误层依据：Gold缺失不证明Gold错，全员LEFT JOIN也不能无细则断言错误。
- 可见性依据：完整检查spec_info、两次decisions及disclosures；计数粒度及多个provisional备选已明示，不知道Gold细则，无法给错误可见性。

**standard 原文**（卷宗第 84 行，`/instruction`）：

```text
For each player, list their ID, name, their most frequent role across all matches, batting hand, bowling skill, total runs scored, total matches played, total times they were dismissed, batting average (total runs divided by total dismissals), highest score in a single match, the number of matches in which they scored at least 30 runs, at least 50 runs, and at least 100 runs, total balls faced in their career, strike rate (total runs divided by total balls faced, multiplied by 100), total wickets taken, economy rate (average runs conceded per over), and their best bowling performance in a single match (most wickets taken in a match, formatted as "wickets taken-runs given", where the best performance is the one with the most wickets, and if tied, the fewest runs conceded). Ignore the extra runs data.
```
全部资料要求

**standard 原文**（卷宗第 84 行，`/standard_semantics/facets/grain/alternatives/0/finalGrain`）：

```text
one row per player
```
每球员一行，无资格交集说明

**sql 原文**（卷宗第 84 行，`/final_sql`）：

```text
WITH
bat_match AS (
    -- one row per (striker, match): runs off the bat and balls faced at the scoring grain
    SELECT b.striker AS player_id,
           b.match_id,
           SUM(s.runs_scored)   AS runs,
           COUNT(s.runs_scored) AS balls
    FROM ball_by_ball b
    JOIN batsman_scored s
      ON b.match_id = s.match_id AND b.innings_no = s.innings_no
     AND b.over_id  = s.over_id  AND b.ball_id    = s.ball_id
    GROUP BY b.striker, b.match_id
),
bat_total AS (
    SELECT player_id, SUM(runs) AS total_runs, SUM(balls) AS total_balls
    FROM bat_match GROUP BY player_id
),
bat_agg AS (
    SELECT player_id,
           SUM(CASE WHEN runs >= 30  THEN 1 ELSE 0 END) AS m30,
           SUM(CASE WHEN runs >= 50  THEN 1 ELSE 0 END) AS m50,
           SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS m100,
           MAX(runs) AS highest_score
    FROM bat_match GROUP BY player_id
),
dismissals AS (
    SELECT player_out AS player_id, COUNT(*) AS n
    FROM wicket_taken GROUP BY player_out
),
mp AS (
    SELECT player_id, COUNT(DISTINCT match_id) AS total_matches
    FROM player_match GROUP BY player_id
),
role_counts AS (
    SELECT player_id, role, COUNT(*) AS c
    FROM player_match GROUP BY player_id, role
),
role_ranked AS (
    SELECT player_id, role,
           ROW_NUMBER() OVER (
               PARTITION BY player_id
               ORDER BY c DESC,
                        CASE role WHEN 'CaptainKeeper' THEN 4 WHEN 'Captain' THEN 3
                                  WHEN 'Keeper' THEN 2 WHEN 'Player' THEN 1 ELSE 0 END DESC,
                        role ASC
           ) AS rn
    FROM role_counts
),
role_mode AS (
    SELECT player_id, role FROM role_ranked WHERE rn = 1
),
bowl_keys AS (
    SELECT DISTINCT bowler AS player_id, match_id FROM ball_by_ball
),
bowl_balls AS (
    SELECT b.bowler AS player_id, b.match_id,
           COUNT(s.runs_scored) AS balls,
           SUM(s.runs_scored)   AS runs
    FROM ball_by_ball b
    JOIN batsman_scored s
      ON b.match_id = s.match_id AND b.innings_no = s.innings_no
     AND b.over_id  = s.over_id  AND b.ball_id    = s.ball_id
    GROUP BY b.bowler, b.match_id
),
bowl_wkts AS (
    SELECT b.bowler AS player_id, b.match_id, COUNT(*) AS wkts
    FROM ball_by_ball b
    JOIN wicket_taken w
      ON b.match_id = w.match_id AND b.innings_no = w.innings_no
     AND b.over_id  = w.over_id  AND b.ball_id    = w.ball_id
    WHERE w.kind_out NOT IN ('run out','retired hurt','obstructing the field')
    GROUP BY b.bowler, b.match_id
),
bowl_match AS (
    SELECT k.player_id, k.match_id,
           COALESCE(bb.balls, 0) AS balls,
           COALESCE(bb.runs, 0)  AS runs,
           COALESCE(ww.wkts, 0)  AS wkts
    FROM bowl_keys k
    LEFT JOIN bowl_balls bb ON bb.player_id = k.player_id AND bb.match_id = k.match_id
    LEFT JOIN bowl_wkts  ww ON ww.player_id = k.player_id AND ww.match_id = k.match_id
),
bowl_total AS (
    SELECT player_id,
           SUM(balls) AS total_balls_bowled,
           SUM(runs)  AS total_runs_conceded,
           SUM(wkts)  AS total_wickets
    FROM bowl_match GROUP BY player_id
),
bowl_best AS (
    SELECT player_id, wkts, runs,
           ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY wkts DESC, runs ASC) AS rn
    FROM bowl_match
)
SELECT
    p.player_id,
    p.player_name,
    rm.role AS most_frequent_role,
    p.batting_hand,
    p.bowling_skill,
    COALESCE(bt.total_runs, 0)                                          AS total_runs,
    COALESCE(mp.total_matches, 0)                                       AS total_matches,
    COALESCE(d.n, 0)                                                    AS total_dismissals,
    ROUND(1.0 * COALESCE(bt.total_runs, 0) / NULLIF(d.n, 0), 2)         AS batting_average,
    COALESCE(ba.highest_score, 0)                                       AS highest_score,
    COALESCE(ba.m30, 0)                                                 AS matches_30plus,
    COALESCE(ba.m50, 0)                                                 AS matches_50plus,
    COALESCE(ba.m100, 0)                                                AS matches_100plus,
    COALESCE(bt.total_balls, 0)                                         AS total_balls_faced,
    ROUND(100.0 * COALESCE(bt.total_runs, 0) / NULLIF(bt.total_balls, 0), 2) AS strike_rate,
    COALESCE(btt.total_wickets, 0)                                      AS total_wickets,
    ROUND(6.0 * COALESCE(btt.total_runs_conceded, 0) / NULLIF(btt.total_balls_bowled, 0), 2) AS economy_rate,
    CASE WHEN bb2.player_id IS NULL THEN NULL ELSE bb2.wkts || '-' || bb2.runs END AS best_bowling
FROM player p
LEFT JOIN mp           ON mp.player_id = p.player_id
LEFT JOIN bat_total bt ON bt.player_id = p.player_id
LEFT JOIN bat_agg ba   ON ba.player_id = p.player_id
LEFT JOIN dismissals d ON d.player_id  = p.player_id
LEFT JOIN role_mode rm ON rm.player_id = p.player_id
LEFT JOIN bowl_total btt ON btt.player_id = p.player_id
LEFT JOIN bowl_best bb2  ON bb2.player_id = p.player_id AND bb2.rn = 1
ORDER BY p.player_id
```
实际总体和统计来源

**spec 原文**（卷宗第 84 行，`/our_spec_and_decisions/decisions/1/args/spec/metric/value/expression`）：

```text
runs=SUM(batsman_scored.runs_scored) attributed via ball_by_ball.striker on (match_id,innings_no,over_id,ball_id); total_matches=COUNT(DISTINCT player_match.match_id); dismissals=COUNT(wicket_taken rows with player_out=player); batting_average=runs/dismissals; highest_score=MAX(runs per match); matches_30plus/50plus/100plus=COUNT(matches with per-match runs>=30/50/100); balls_faced=COUNT(scoring-grain deliveries where striker=player); strike_rate=runs/balls_faced*100; wickets=COUNT(deliveries bowled by player that produced a wicket_taken row, excluding kind_out in ('run out','retired hurt','obstructing the field')); runs_conceded=SUM(runs_scored off player's deliveries); balls_bowled=COUNT(scoring-grain deliveries where bowler=player); economy_rate=runs_conceded/balls_bowled*6; best_bowling=per-match (wickets,runs_conceded) maximising wickets then minimising runs, formatted '<wickets>-<runs>'
```
详细计算声明

**spec 原文**（卷宗第 84 行，`/our_spec_and_decisions/decisions/1/args/choices/0/alternatives/0/statement`）：

```text
Balls faced/bowled = count of deliveries present at the ball_by_ball JOIN batsman_scored grain (the scoring records); the 3444 wide deliveries that have no batsman_scored row are excluded.
```
scoring粒度候选

**result 原文**（卷宗第 84 行，`/gold_results/0/csv_info/head/0/6`）：

```text
55
```
同球员Gold比赛数

**result 原文**（卷宗第 84 行，`/predicted_result/csv_info/head/0/6`）：

```text
57
```
同球员SQL比赛数

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 需Gold资格、matches/balls计数及最佳比赛runs细则；provisional参数不等于成功采纳。

### 85. local262

- 运行：`spider2-gold109-deepseek-flash-001`；卷宗行：85。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**题面引用错**。
- 状态：`classified`；置信：`medium`。
- 标准：标准measure.expression明确solution发生次数超过qualifying model发生次数。
- SQL 实际：筛step1/2/3中Stack超过非Stack最大分数的组，计组内全部model_score行，最终要求model次数大于solution次数。
- 最早分叉依据：两侧次数比较方向反过来，落formula。题面any存在歧义，不先把全体非Stack MAX判错；也不从结果行数猜总体错。
- 错误层依据：Spec参数自身采用qualifying model次数>solution次数，SQL兑现不同读法，非违背正确声明。
- 可见性依据：完整检查spec_info、八次decisions及disclosures；早期H4以题面exceed片段声称支持model次数>solution次数，后续H5与output继续采用该方向。按行/按组提议不包含方向备选，也无采纳返回，不能归待定后决定错。此标签按提供标准expression对比，不宣称英文措辞必定反向。

**standard 原文**（卷宗第 85 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
problem solution-table occurrence count exceeding qualifying model occurrence count
```
标准比较方向

**standard 原文**（卷宗第 85 行，`/instruction`）：

```text
Which problems exceed the total number of times they appear in the solution table when counting all occurrences, across steps 1, 2, and 3, where any non-"Stack" model's maximum test score is lower than the "Stack" model's test score for the same step and version?
```
题面exceed歧义

**sql 原文**（卷宗第 85 行，`/final_sql`）：

```text
WITH qual_groups AS (
    SELECT ms.name AS name, ms.version AS version, ms.step AS step
    FROM model_score ms
    JOIN (
        SELECT name, version, step, MAX(test_score) AS mx_nonstack
        FROM model_score
        WHERE model <> 'Stack'
        GROUP BY name, version, step
    ) nm
      ON nm.name = ms.name
     AND nm.version = ms.version
     AND nm.step = ms.step
    WHERE ms.model = 'Stack'
      AND ms.step IN (1, 2, 3)
      AND ms.test_score > nm.mx_nonstack
    GROUP BY ms.name, ms.version, ms.step
),
problem_ms_count AS (
    SELECT ms.name AS name, COUNT(*) AS ms_occurrences
    FROM model_score ms
    JOIN qual_groups q
      ON q.name = ms.name
     AND q.version = ms.version
     AND q.step = ms.step
    GROUP BY ms.name
),
problem_sol_count AS (
    SELECT name, COUNT(*) AS sol_occurrences
    FROM solution
    GROUP BY name
)
SELECT s.name AS name
FROM problem_sol_count s
LEFT JOIN problem_ms_count m ON m.name = s.name
WHERE COALESCE(m.ms_occurrences, 0) > s.sol_occurrences
ORDER BY s.name
```
反方向比较

**spec 原文**（卷宗第 85 行，`/our_spec_and_decisions/decisions/6/args/hypotheses/0/statement`）：

```text
exceed 指满足条件的 model_score 出现次数大于该问题在 solution 表的总行数；出现次数按行计。
```
方向假设

**spec 原文**（卷宗第 85 行，`/our_spec_and_decisions/decisions/7/args/spec/metric`）：

```text
满足条件的 model_score 出现次数 COUNT(*) 与该问题在 solution 表出现次数 COUNT(*) 的比较
```
最后比较提议

**spec 原文**（卷宗第 85 行，`/our_spec_and_decisions/decisions/0/args/hypotheses/3/basis`）：

```text
题面“exceed the total number of times they appear in the solution table”，为最字面理解。
```
以题面exceed片段为比较方向依据

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 标准expression与英文exceed措辞可有方向冲突；按提供标准表达式判定，需Gold SQL确认方向。

### 86. local263

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：86。
- 分叉节点：**population.conditions**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：每step比较后OR跨steps得到model状态，将状态传播给该model所有关联L1记录，再计数。
- SQL 实际：直接按stack_ok的step状态分status/L1数去重name/version，未得到model级状态并传播至其他step的L1记录。
- 最早分叉依据：step状态先限制可关联L1总体，资格阶段早于下游COUNT DISTINCT。不是任意换来源或分组键错；计数差异不能遮盖跨step传播缺失。
- 错误层依据：h-view把step视图当完整状态来源，声明缺跨step传播；改数model不能补回遗漏记录，属于不同资格口径。
- 可见性依据：完整检查spec_info、六次decisions；h-view是假设，count_grain后续选择不处理状态传播，本节点是假定错而非下游待定后决定错。
- 其他差异：["measure.countGrain"]

**standard 原文**（卷宗第 86 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder/1`）：

```text
OR across steps per model
```
跨step OR

**standard 原文**（卷宗第 86 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder/2`）：

```text
propagate model status to all associated L1_model records
```
传播全部关联L1

**sql 原文**（卷宗第 86 行，`/final_sql`）：

```text
WITH c AS (
  SELECT L1_model, status, COUNT(DISTINCT name || '|' || version) AS cnt
  FROM stack_ok
  GROUP BY L1_model, status
)
SELECT c.status AS status, c.L1_model AS L1_model, c.cnt AS "count"
FROM c
JOIN (SELECT status, MAX(cnt) AS mx FROM c GROUP BY status) m
  ON c.status = m.status AND c.cnt = m.mx
ORDER BY c.status
```
仅统计已有step状态行

**spec 原文**（卷宗第 86 行，`/our_spec_and_decisions/decisions/1/args/hypotheses/0/statement`）：

```text
数据库视图 stack_ok 按 (name, version, step) 输出每个模型的每一步：非 Stack 模型最大 test_score 小于 Stack 的 test_score 记为 'strong'，等于记为 'soft'；这是题面状态定义的物理来源。
```
step视图假设

**spec 原文**（卷宗第 86 行，`/our_spec_and_decisions/decisions/5/args/spec/metric/value/expression`）：

```text
COUNT(DISTINCT name || '|' || version)
```
后续去重model

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 视图引文残缺，不假称完整schema验证；spec_info仅deliveryRequirement，详细声明为参数意图。

### 87. local264

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：87。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：传统模型与Stack比较时，跨steps/versions取L1最多及次数。
- SQL 实际：直接COUNT model表按L1排序取首，无Stack比较关联。
- 最早分叉依据：比较上下文被省略，但标准无比较准入条件、配对及次数粒度。639对213不能证明必须三倍展开、换视图或join放大。
- 错误层依据：缺比较语义，不能直接确定source/joinMultiplicity/countGrain错误。
- 可见性依据：完整检查spec_info及四次decisions；entity=model且population/count_grain引用题面，未给比较映射；未知Gold细则阻止分类。

**standard 原文**（卷宗第 87 行，`/instruction`）：

```text
Which model category (L1_model) appears the most frequently across all steps and versions when comparing traditional models to the Stack model, and what is the total count of its occurrences?
```
比较上下文

**standard 原文**（卷宗第 87 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
occurrence count of L1_model across steps and versions
```
抽象次数定义

**sql 原文**（卷宗第 87 行，`/final_sql`）：

```text
SELECT L1_model, COUNT(*) AS "count" FROM model GROUP BY L1_model ORDER BY COUNT(*) DESC, L1_model ASC LIMIT 1
```
直接model计数

**spec 原文**（卷宗第 87 行，`/our_spec_and_decisions/decisions/0/args/spec/entity/value/name`）：

```text
model
```
实体来源

**spec 原文**（卷宗第 87 行，`/our_spec_and_decisions/decisions/1/args/decisionPoints/0/quote`）：

```text
across all steps and versions
```
全steps/versions引用

**result 原文**（卷宗第 87 行，`/gold_results/0/csv_info/head/0/1`）：

```text
639
```
Gold计数

**result 原文**（卷宗第 87 行，`/predicted_result/csv_info/head/0/1`）：

```text
213
```
SQL计数

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 需Gold SQL或比较关系和occurrence定义；三倍观测不是业务证据。

### 88. local269

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：88。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：递归展开，top-level最终组合按叶级SUM，再平均组合总量。
- SQL 实际：路径qty乘积，UNION ALL保留路径，剔非叶子按root SUM，只平均不被其他包装包含的root。
- 最早分叉依据：top-level及SUM后AVG符合标准；530.67对946不足证明根范围、叶子去重或递归公式错误。列别名差异不能解释数量差异。
- 错误层依据：无可证最早差异，也无具体Gold运算与文字矛盾足以判Gold错。
- 可见性依据：完整检查spec_info、六次decisions；top-level和路径累积已有备选与后续选择意图，符合标准，未知Gold规则不是未声明证明。
- 其他差异：["output"]

**standard 原文**（卷宗第 88 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["expand nested packaging paths", "sum leaf quantity per final combination", "average combination totals"]
```
聚合顺序

**standard 原文**（卷宗第 88 行，`/standard_semantics/facets/denominator/alternatives/0/expression`）：

```text
one denominator unit per final top-level combination after recursive leaf expansion
```
top-level分母

**sql 原文**（卷宗第 88 行，`/final_sql`）：

```text
WITH RECURSIVE exp(root, node, qty) AS (
  SELECT packaging_id, contains_id, CAST(qty AS REAL) FROM packaging_relations
  UNION ALL
  SELECT e.root, r.contains_id, e.qty * r.qty FROM exp e JOIN packaging_relations r ON r.packaging_id = e.node
),
leaves AS (
  SELECT exp.root, exp.qty
  FROM exp
  WHERE NOT EXISTS (SELECT 1 FROM packaging_relations r WHERE r.packaging_id = exp.node)
),
per_combo AS (
  SELECT root, SUM(qty) AS total_qty
  FROM leaves
  GROUP BY root
)
SELECT AVG(total_qty) AS average_total_quantity
FROM per_combo
WHERE root NOT IN (SELECT contains_id FROM packaging_relations);
```
递归叶汇总及平均

**spec 原文**（卷宗第 88 行，`/our_spec_and_decisions/decisions/5/args/spec/metric/value/expression`）：

```text
AVG(每个组合完全展开后的叶级数量总和)；每个组合的叶级数量总和 = 对展开得到的全部叶级出现，按其 root→leaf 路径逐层 qty 相乘后的数量求和（同一叶节点的多次出现各自累加）
```
路径叶累积声明

**spec 原文**（卷宗第 88 行，`/our_spec_and_decisions/decisions/5/args/dispositions/4/rationale`）：

```text
题面以 final packaging combinations 限定统计对象，final 修饰 combination，排除本身仍被其他包装包含的中间组合（511 Gift Carton、521 Box Large、522 Box Medium、523 Box Small、524 Gift Box）；题面同时说 after fully expanding any nested packaging relationships，说明这些中间层是要被展开掉的嵌套层级，不是参与平均的组合。故只保留 id 从不作为 contains_id 出现的顶层组合（探针确认 531、532、533、534 四个托盘），分母 4；alternative_2b06bb21 把嵌套中间层也当组合（分母 9，440.78），与 final 与 nested 两处措辞冲突。两候选探针输出不同（946 vs 440.78），非等价，采纳方向与 compare_hypotheses 的明显倾向一致。
```
top-level选择理由

**result 原文**（卷宗第 88 行，`/gold_results/0/csv_info/head/0/0`）：

```text
530.67
```
Gold数值

**result 原文**（卷宗第 88 行，`/predicted_result/csv_info/head/0/0`）：

```text
946
```
SQL数值

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 需完整递归业务定义、Gold SQL及组合全集；不由530.67倒推根数或改分母。

### 89. local270

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：89。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：top-level容器中跨嵌套层累计item quantity>500，输出容器及item名。
- SQL 实际：路径qty相乘后按root/node累积全部路径，叶子总量>500且root不被其他包装包含。
- 最早分叉依据：SQL累计跨层级符合标准；Gold少Pallet Mix SG/Bottle 500cl不能证明采用单路径、其他阈值或总体。不能凭三行对四行归因。
- 错误层依据：只有对象差异，无Gold数量路径细则，不能确定错误层。
- 可见性依据：完整检查spec_info及三次decisions；路径SUM、top-level及叶定义已明示，不能称未声明，更不能无Gold细则就说是假定错。
- 其他差异：["output"]

**standard 原文**（卷宗第 89 行，`/instruction`）：

```text
Which top-level packaging containers, meaning those not contained within any other packaging, have any item for which the total quantity accumulated across all nested levels in the hierarchy exceeds 500, and what are the names of both these containers and the corresponding items?
```
全层累计要求

**standard 原文**（卷宗第 89 行，`/standard_semantics/facets/filters/required/1/semanticPredicate`）：

```text
accumulated nested item quantity > 500
```
累计量阈值

**sql 原文**（卷宗第 89 行，`/final_sql`）：

```text
WITH RECURSIVE expanded(root_id, node_id, quantity) AS (
  SELECT packaging_id, contains_id, CAST(qty AS REAL)
  FROM packaging_relations
  UNION ALL
  SELECT e.root_id, r.contains_id, e.quantity * r.qty
  FROM expanded e
  JOIN packaging_relations r ON r.packaging_id = e.node_id
),
item_totals AS (
  SELECT e.root_id, e.node_id, SUM(e.quantity) AS total_quantity
  FROM expanded e
  WHERE NOT EXISTS (SELECT 1 FROM packaging_relations r WHERE r.packaging_id = e.node_id)
  GROUP BY e.root_id, e.node_id
)
SELECT pc.name AS container_name, pi.name AS item_name
FROM item_totals t
JOIN packaging pc ON pc.id = t.root_id
JOIN packaging pi ON pi.id = t.node_id
WHERE NOT EXISTS (SELECT 1 FROM packaging_relations r2 WHERE r2.contains_id = t.root_id)
  AND t.total_quantity > 500
ORDER BY pc.id, pi.id
```
实际路径累积和阈值

**spec 原文**（卷宗第 89 行，`/our_spec_and_decisions/decisions/2/args/spec/metric/value/expression`）：

```text
for each (top-level container, item) pair: SUM over all root-to-leaf paths of the product of packaging_relations.qty
```
每对容器item路径乘积SUM

**spec 原文**（卷宗第 89 行，`/our_spec_and_decisions/decisions/2/args/hypotheses/1/statement`）：

```text
“item” 指层级末端的被包含对象（叶节点），即 Bottle 330cl / Bottle 500cl
```
叶级item假设

**result 原文**（卷宗第 89 行，`/gold_results/0/csv_info/head`）：

```text
[["Pallet of L", "Bottle 500cl"], ["Pallet of M", "Bottle 330cl"], ["Pallet Mix MS", "Bottle 500cl"]]
```
Gold可见对象

**result 原文**（卷宗第 89 行，`/predicted_result/csv_info/head/3`）：

```text
["Pallet Mix SG", "Bottle 500cl"]
```
SQL额外对象

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 需Gold SQL与完整item累计定义；别名差异不解释额外对象。

### 90. local272

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：90。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：订单423仓库1，按购买日及少量优先，分别尊重多订单行的先后与累计需求。
- SQL 实际：先按product SUM全部orderline.qty成单一need，然后按FIFO库存累计一次分配，订单行身份和先后边界已消失。
- 最早分叉依据：SQL先汇总产品需求而不保留订单行；这是可见写法差异，但最终按库位累计的FIFO分配在可加、同序条件下可能与逐订单行区间分配等价。缺少Gold SQL和完整批次/库位记录，不能证明其为最早语义分叉；同库位未再SUM也需要多批次事实才能确认影响。
- 错误层依据：能证明逐订单行计算步骤被产品总量替代，但不能证明最终要求的库位分配不同；无法诚实确定四类错误层。
- 可见性依据：完整7轮参数同时声明orderlines.id实体及product_total_need分配公式。题面q-cum仅支持累计总量，但在公式可能等价时不能认定“题面引用错”；缺成功返回且缺Gold细则，三项待定。

**standard 原文**（卷宗第 90 行，`/instruction`）：

```text
For order 423, identify the product IDs, aisles, and positions from which to pick the exact quantities needed for each order line, ensuring that the total picked quantity for each product matches the cumulative quantities ordered without exceeding the available inventory in warehouse 1. Calculate the quantities to be picked from each location by prioritizing inventory with earlier purchased dates and smaller quantities, and ensure that picking respects the sequence and cumulative quantities of the order lines for products with multiple entries.
```
逐订单行顺序与累计要求

**sql 原文**（卷宗第 90 行，`/final_sql`）：

```text
WITH demand AS (
  SELECT product_id, SUM(qty) AS need
  FROM orderlines WHERE order_id = 423 GROUP BY product_id
),
batches AS (
  SELECT i.id AS inv_id, i.product_id, i.qty, l.aisle, l.position,
         COALESCE(p.purchased,'9999-99-99') AS purchased
  FROM inventory i
  JOIN locations l ON l.id = i.location_id
  LEFT JOIN purchases p ON p.id = i.purchase_id
  WHERE l.warehouse = 1 AND i.product_id IN (SELECT product_id FROM demand)
),
seq AS (
  SELECT b.*,
    SUM(b.qty) OVER (PARTITION BY b.product_id ORDER BY b.purchased ASC, b.qty ASC, b.inv_id ASC
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
  FROM batches b
),
alloc AS (
  SELECT s.product_id, s.aisle, s.position, s.purchased,
    MIN(s.qty, MAX(0.0, d.need - (s.cum - s.qty))) AS pick_qty
  FROM seq s JOIN demand d ON d.product_id = s.product_id
)
SELECT product_id, aisle, position, pick_qty AS quantity
FROM alloc
WHERE pick_qty > 0
ORDER BY product_id, purchased, position;
```
产品总需求一次分配且无订单行

**spec 原文**（卷宗第 90 行，`/our_spec_and_decisions/decisions/3/args/spec/metric/value/expression`）：

```text
per warehouse-1 inventory batch: MIN(batch.qty, MAX(0, product_total_need - prior_consumed)), summed per (product, aisle, position)
```
采用product_total_need的提议

**spec 原文**（卷宗第 90 行，`/our_spec_and_decisions/decisions/3/args/spec/metric/evidenceIds`）：

```text
["q-cum"]
```
formula引用q-cum

**spec 原文**（卷宗第 90 行，`/our_spec_and_decisions/decisions/3/args/evidence/3/quote`）：

```text
the total picked quantity for each product matches the cumulative quantities ordered
```
仅总量累计片段

**spec 原文**（卷宗第 90 行，`/our_spec_and_decisions/decisions/3/args/spec/groupBy/0/value`）：

```text
product_id, aisle, position
```
还声明location汇总

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 逐行后按location汇总在特定数据可等于产品总量分配；本标签指出显式计算阶段缺失，不把全部CSV数量差异归于它。缺订单/库存全集，不能认定actual超库存或Gold需求正确。
- 需Gold逐行累计边界、最终库位汇总粒度、同库位多批次事实及完整结果，核验汇总优化是否语义等价。

### 91. local273

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：91。
- 分叉节点：**population.source**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：用库存购买日和qty构成FIFO序列，取订单与库存累计区间重叠的picked数量，按产品平均percentage。
- SQL 实际：用已落地picking_line实拣SUM而非inventory区间重算；无购买日、FIFO序列，直接除原orderlines.qty并AVG比例。
- 最早分叉依据：题面指定库存分配记录，SQL替为实拣事件集，source早于比率公式、订单粒度及百分倍率；不是仅金额列或日期字段替换。
- 错误层依据：spec_info H2直接将FIFO当上下文，用实际拣货为来源；SQL符合另一业务读法，口径错。
- 可见性依据：H2为model_inference候选confidence0.5，以fill-rate理解替来源，无题面证据支持删除FIFO区间过程。完整检查spec_info、两次decisions和disclosures。
- 其他差异：["measure.formula", "measure.denominator"]

**standard 原文**（卷宗第 91 行，`/instruction`）：

```text
Calculate the average pick percentage for each product name, using a first-in-first-out approach that selects from inventory locations based on the earliest purchase date and smallest available quantity, ensuring that the picked quantity reflects only the overlapping range between each order’s required quantity and the inventory’s available quantity, and then grouping and ordering the results by product name?
```
FIFO库存区间重叠要求

**standard 原文**（卷宗第 91 行，`/standard_semantics/facets/denominator/alternatives/0/expression`）：

```text
required quantity per order-product
```
order-product分母

**sql 原文**（卷宗第 91 行，`/final_sql`）：

```text
WITH picked AS (
  SELECT order_id, product_id, SUM(qty) AS got
  FROM picking_line
  GROUP BY order_id, product_id
),
fill AS (
  SELECT r.order_id, r.product_id,
         1.0 * COALESCE(p.got,0) / r.qty AS fill
  FROM orderlines r
  LEFT JOIN picked p ON p.order_id=r.order_id AND p.product_id=r.product_id
)
SELECT pr.name AS product_name,
       ROUND(AVG(f.fill), 4) AS avg_pick_percentage
FROM fill f
JOIN products pr ON pr.id = f.product_id
GROUP BY pr.name
ORDER BY pr.name;
```
实际拣货源且原比例未百分化

**spec 原文**（卷宗第 91 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
pick percentage per order-product = sum(picking_line.qty for that order,product) / orderlines.qty; average over order-product cases grouped by product
```
实拣来源假设

**spec 原文**（卷宗第 91 行，`/our_spec_and_decisions/spec_info/hypotheses/1/basis`）：

```text
Fill rate interpretation requiring picking_line as actual picked and orderlines.qty as required; FIFO is the context explaining location selection
```
FIFO降为上下文的依据

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 没有证据说明实拣记录生成规则，不能说它恰好等于题面FIFO分配。

### 92. local274

- 运行：`round11-full-c3-001`；卷宗行：92。
- 分叉节点：**output**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：标准用product_name输出订单421产品平均picked units。
- SQL 实际：实拣关联库存，先按purchase批次SUM，再AVG批次量；仅给数字product_id，不给产品名称。
- 最早分叉依据：已证实名称被ID替代，是内容差异非别名。上游FIFO平均分母和join基数标准未详述，不能由70对23.33倒推上游错误。
- 错误层依据：没有正确名称Spec被SQL违背的证据；交付采用不同识别内容，保守归输出口径错。
- 可见性依据：完整检查spec_info（版本、空constraints/hypotheses/ambiguities/contract）、空decisions及disclosures；卷宗未记录名称输出声明，不等于证明运行时从未声明。

**standard 原文**（卷宗第 92 行，`/standard_semantics/facets/output/alternatives/0/columnNames/0`）：

```text
product_name
```
要求名称内容

**sql 原文**（卷宗第 92 行，`/final_sql`）：

```text
WITH order_batches AS (
  SELECT l.product_id,
         inv.purchase_id,
         SUM(l.qty) AS batch_qty
  FROM picking_line l
  JOIN inventory inv ON inv.location_id = l.location_id AND inv.product_id = l.product_id
  WHERE l.order_id = 421
  GROUP BY l.product_id, inv.purchase_id
)
SELECT product_id,
       ROUND(CAST(AVG(batch_qty) AS REAL), 2) AS avg_units_per_fifo_batch
FROM order_batches
GROUP BY product_id
ORDER BY product_id
```
仅数字ID没有名称

**spec 原文**（卷宗第 92 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
全部可见Spec无业务声明

**spec 原文**（卷宗第 92 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
decisions为空

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- Spec记录缺失，只判卷宗内未声明；名称遗漏不解释均值差异，需平均粒度、Gold SQL和连接唯一性证据。

### 93. local275

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：93。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：2016-01起月销量，以centered moving average为基准，取2017每月ratio>2的产品。
- SQL 实际：两条重叠12月ROWS窗均值平均得到CMA，2017按产品MIN(qty/CMA)>2，输出ID和名称。
- 最早分叉依据：CMA方向与ratio定义符合卷宗业务引文，未证实时间字段、实际缺期或窗口长度错误。未验12非空月是潜在风险，不等于实际缺期。Gold四产品而SQL空集不能单独定位错误；多ID仅次要输出差异。
- 错误层依据：缺Gold完整seasonality ratio定义和计算SQL，不能确认错误层，也不因无Gold SQL就判Gold错。
- 可见性依据：完整检查spec_info及两次decisions；ALL12、两窗、零销量纳入均有声明，choice有equivalent意图，不臆称选错窗口。
- 其他差异：["output"]

**standard 原文**（卷宗第 93 行，`/instruction`）：

```text
Based on monthly sales data starting in January 2016 and using a centered moving average to adjust for seasonality, which products had a seasonality-adjusted sales ratio that stayed consistently above 2 for every month in the year 2017?
```
时间及每月条件

**standard 原文**（卷宗第 93 行，`/standard_semantics/facets/denominator/alternatives/0/expression`）：

```text
centered moving-average sales
```
CMA分母

**sql 原文**（卷宗第 93 行，`/final_sql`）：

```text
WITH cma AS (
  -- per product-month centered moving average: average of the two 12-month windows [t-5..t+6] and [t-6..t+5]
  SELECT product_id, mth, qty,
         (AVG(qty) OVER (PARTITION BY product_id ORDER BY mth ROWS BETWEEN 5 PRECEDING AND 6 FOLLOWING)
        + AVG(qty) OVER (PARTITION BY product_id ORDER BY mth ROWS BETWEEN 6 PRECEDING AND 5 FOLLOWING)) / 2.0 AS cma_value
  FROM monthly_sales
),
ratio_2017 AS (
  -- sales-to-CMA ratio for every month of calendar year 2017
  SELECT product_id, 1.0 * qty / cma_value AS ratio
  FROM cma
  WHERE mth BETWEEN '2017-01-01' AND '2017-12-01'
)
SELECT p.id AS product_id, p.name AS name
FROM ratio_2017 r
JOIN products p ON p.id = r.product_id
GROUP BY p.id, p.name
HAVING MIN(r.ratio) > 2
ORDER BY p.id
```
两重叠窗ratio及MIN

**spec 原文**（卷宗第 93 行，`/our_spec_and_decisions/decisions/0/args/evidence/4/quote`）：

```text
The ratio is computed by dividing the actual sales amount for a month by its corresponding CMA value.
```
业务ratio定义

**spec 原文**（卷宗第 93 行，`/our_spec_and_decisions/decisions/0/args/evidence/5/quote`）：

```text
It averages sales from the months before and after a given month, specifically using two overlapping windows (5 months before and 6 months after, and vice versa).
```
业务两重叠窗

**spec 原文**（卷宗第 93 行，`/our_spec_and_decisions/decisions/0/args/spec/filters/0/value`）：

```text
for each product, ratio > 2 for ALL 12 months of 2017
```
ALL12要求已声明

**spec 原文**（卷宗第 93 行，`/our_spec_and_decisions/decisions/0/args/hypotheses/2/statement`）：

```text
(product_id, mth) is unique in monthly_sales (one row per product per month) and products.id is unique, so the join monthly_sales->products is 1:1
```
宣称36完整月，无观测返回

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 需Gold SQL、完整季节模型及月观测全集；不把ROWS潜在缺期当实际错。

### 94. local277

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：94。
- 分叉节点：**population.time**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：2016-01起36个月，steps7..30季节调整与加权回归估2018年度销量，最后两产品平均。
- SQL 实际：只WHERE保留2018实际qty并分product SUM；无36月训练、季节调整、回归及两产品平均。
- 最早分叉依据：产品过滤正确，未见更早实体来源错误；先在输入时间总体被2018截断分叉，其后实际SUM替预测及未平均不能遮盖它。不是滚动窗长度或precision。
- 错误层依据：Spec明确36-month window starting2016-01和回归，SQL却只取2018，归实现违背已声明时间总体。
- 可见性依据：本节点正确声明而SQL错，五类错误可见性无诚实适用项；不能借别处Hypothesis不确定说本时间节点未声明。
- 其他差异：["measure.formula", "grouping", "output"]

**standard 原文**（卷宗第 94 行，`/instruction`）：

```text
What is the average forecasted annual sales for products 4160 and 7790 during 2018, using monthly sales data starting from January 2016 for the first 36 months, applying seasonality adjustments from time steps 7 through 30, and employing a weighted regression method to estimate sales?
```
36月训练和预测要求

**sql 原文**（卷宗第 94 行，`/final_sql`）：

```text
SELECT product_id, SUM(qty) AS forecast_2018 FROM monthly_sales WHERE product_id IN (4160,7790) AND substr(mth,1,4)='2018' GROUP BY product_id
```
只取2018实际SUM

**spec 原文**（卷宗第 94 行，`/our_spec_and_decisions/decisions/1/args/spec/filters/1`）：

```text
36-month window starting 2016-01
```
正确36月声明

**spec 原文**（卷宗第 94 行，`/our_spec_and_decisions/decisions/1/args/spec/filters/2`）：

```text
seasonality adjustment applied over time steps 7..30
```
steps7..30调整

**spec 原文**（卷宗第 94 行，`/our_spec_and_decisions/decisions/1/args/spec/filters/3`）：

```text
weighted regression estimate
```
明确回归估计

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- spec_info仅候选H1，无最终字段快照；正确36月来自最后工具参数，不宣称生效。回归细节不足也不能SUM实销量替代预测。

### 95. local279

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：95。
- 分叉节点：**measure.formula**；错误层：**实现错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：2018-12库存种子，逐月递推2019扣需求与低于minimum补货，再取ending与minimum绝对差最小月。
- SQL 实际：sim.opening已对应s.mo，递归连r.mo=s.mo+1却用r下一月demand扣s.opening生成下一月opening；monthly再扣一次该月demand。
- 最早分叉依据：inventory能否代表2018-12快照、minimums资格无细则，不能先判source/time错。可证明最早是递推状态：下一月opening应从上一月ending/补货继承，SQL提前扣下一月需求且当月终值再扣；属formula内时间索引和运算顺序，不是总体端点或rolling窗。
- 错误层依据：SQL的opening状态递推扣下一月需求、monthly又扣同月需求，是可定位的状态索引/重复扣减实现错误；不代表卷宗证明solver先前已理解正确。
- 可见性依据：完整检查spec_info、空decisions及disclosures；唯一HC是month in2019，没有opening/ending转移公式，不能把年度HC当递推已声明。

**standard 原文**（卷宗第 95 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["seed December 2018 inventory", "recursively apply restock when ending inventory < minimum", "calculate monthly ending-minus-minimum absolute difference", "select minimum month per product"]
```
种子递推差值选取顺序

**sql 原文**（卷宗第 95 行，`/final_sql`）：

```text
WITH req AS (
  SELECT mb.product_id AS pid,
         CAST(strftime('%m', mb.mth) AS INTEGER) AS mo,
         mb.qty AS demand,
         pm.qty_minimum AS mn,
         pm.qty_purchase AS rep
  FROM monthly_budget mb
  JOIN product_minimums pm ON pm.product_id = mb.product_id
  WHERE mb.mth BETWEEN '2019-01-01' AND '2019-12-31'
),
base AS (
  SELECT product_id AS pid, SUM(qty) AS start FROM inventory
  WHERE product_id IN (SELECT product_id FROM product_minimums) GROUP BY product_id
),
sim(pid, mo, opening) AS (
  SELECT r.pid, r.mo, b.start
  FROM base b JOIN req r ON r.pid = b.pid WHERE r.mo = 1
  UNION ALL
  SELECT r.pid, r.mo,
    CASE WHEN s.opening - r.demand < r.mn THEN s.opening - r.demand + r.rep
         ELSE s.opening - r.demand END
  FROM sim s JOIN req r ON r.pid = s.pid AND r.mo = s.mo + 1
),
monthly AS (
  SELECT r.pid, r.mo, s.opening - r.demand AS ending, r.mn
  FROM req r JOIN sim s ON s.pid = r.pid AND s.mo = r.mo
),
ranked AS (
  SELECT pid, mo, ABS(ending - mn) AS ad,
         ROW_NUMBER() OVER (PARTITION BY pid ORDER BY ABS(ending - mn), mo) AS rn
  FROM monthly
)
SELECT pid AS product_id, mo AS month, ad AS abs_diff FROM ranked WHERE rn = 1 ORDER BY pid
```
递归下一月需求提前消耗及monthly再次扣需求

**spec 原文**（卷宗第 95 行，`/our_spec_and_decisions/spec_info/hardConstraints/0/statement`）：

```text
month in 2019
```
唯一HC只说2019月份

**spec 原文**（卷宗第 95 行，`/our_spec_and_decisions/spec_info/hypotheses`）：

```text
[]
```
无递推假设记录

**spec 原文**（卷宗第 95 行，`/our_spec_and_decisions/decisions`）：

```text
[]
```
全部decisions为空

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 卷宗内未声明不证明运行时从未声明；result_status=timeout，CSV可能不是成功当前候选，标签仅依据final_sql结构。
- Spec并未声明递推公式，无法直接证明作者理解正确；实现错为对SQL自身opening/ending结构的判断，若需严格以正确Spec为前提仍需补对应声明。

### 96. local283

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：96。
- 分叉节点：**selection**；错误层：**口径错**；可见性：**题面引用错**。
- 状态：`classified`；置信：`high`。
- 标准：跨所有国家联赛每season取最高points冠军；中间season-league-team积分，最终排名partition只有season。
- SQL 实际：胜3平1积分正确，ROW_NUMBER却按league_id/season取首，变成每联赛每季冠军；之后去掉season。
- 最早分叉依据：Match总体与积分无证实更早错误，中间聚合符合标准。最早是最终selection候选域加入league_id，非度量或中间grouping错误；并列及省列是下游。
- 错误层依据：Spec将standings partition设league/season，SQL符合另一业务读法，主错为selection口径。
- 可见性依据：声明以q-champ题面支持league-season，但其跨all countries/leagues不支持分联赛冠军。c-ties/c-cols确有select意图，却无全局与league-season候选，不能归本节点待定后决定错。完整检查spec_info及十五次decisions。
- 其他差异：["selection.ties", "output"]

**standard 原文**（卷宗第 96 行，`/standard_semantics/facets/ranking/alternatives/0/partitionBy`）：

```text
["season"]
```
最终只season排名

**standard 原文**（卷宗第 96 行，`/standard_semantics/facets/grain/alternatives/0/intermediateGrain`）：

```text
season-league-team
```
中间积分粒度一致

**sql 原文**（卷宗第 96 行，`/final_sql`）：

```text
WITH res AS (
  SELECT league_id, season, home_team_api_id AS tid, home_team_goal AS gf, away_team_goal AS ga,
         CASE WHEN home_team_goal > away_team_goal THEN 3 WHEN home_team_goal = away_team_goal THEN 1 ELSE 0 END AS pts
  FROM Match
  UNION ALL
  SELECT league_id, season, away_team_api_id, away_team_goal, home_team_goal,
         CASE WHEN away_team_goal > home_team_goal THEN 3 WHEN home_team_goal = away_team_goal THEN 1 ELSE 0 END
  FROM Match
), st AS (
  SELECT league_id, season, tid, SUM(pts) AS pts, SUM(gf) - SUM(ga) AS gd FROM res GROUP BY league_id, season, tid
), j AS (
  SELECT st.league_id, st.season, st.tid, st.pts, st.gd, t.team_long_name AS team_name, l.name AS league, c.name AS country
  FROM st
  JOIN Team t ON t.team_api_id = st.tid
  JOIN League l ON l.id = st.league_id
  JOIN Country c ON c.id = l.country_id
), rk AS (
  SELECT j.*, ROW_NUMBER() OVER (PARTITION BY league_id, season ORDER BY pts DESC, gd DESC, team_name ASC) AS rn FROM j
)
SELECT team_name, league, country, pts AS points
FROM rk
WHERE rn = 1
ORDER BY season, league
```
最终partition加league

**spec 原文**（卷宗第 96 行，`/our_spec_and_decisions/decisions/0/args/spec/groupBy/0/value`）：

```text
league, season -> standings partition; the ranked entity inside a partition is the team
```
league-season standings partition声明

**spec 原文**（卷宗第 96 行，`/our_spec_and_decisions/decisions/0/args/evidence/0/quote`）：

```text
determine the champion team for each season across all countries and leagues
```
题面跨全国家联赛

**spec 原文**（卷宗第 96 行，`/our_spec_and_decisions/decisions/3/args/dispositions/0/rationale`）：

```text
Original wording uses the singular ('determine the champion team for each season', 'the champion's team name'), so one champion per league-season is the better fit; the knowledge base contains no business definition of 'champion' or of a point-tie rule, and the Jev advisor abstained (insufficient evidence), so no evidence can decide it. The 'strict' candidate keeps exactly one row per league-season (88 rows, matching the request's shape), while the 'include_ties' candidate would emit two rows for the two league-seasons whose top teams are level on points (England 2011/2012: Manchester City and Manchester United, 89 points; Belgium 2008/2009: RSC Anderlecht and Standard de Liege, 77 points), which contradicts the singular 'the champion'. The tie-break order (goal difference, then team name) is an invented but standard football rule and is disclosed; it is only needed for those two league-seasons.
```
下游tie选择仍坚持per-league

**证据限制**：
- gold_sql=null；仅有CSV head及元信息，不能逆推隐藏Gold计算。
- decisions仅工具参数，无返回；不宣称提议或处置已成功生效。
- 并列政策未规定，不单独断言goal difference规则必错；season遗漏有标准契约差异但不是最早节点。

### 97. local284

- 运行：`spider2-local-round6-glm53-full-001`；卷宗行：97。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：以蔬菜商品损耗数据统计平均损耗率及一倍标准差内外商品数量。
- SQL 实际：最后SQL仅计算sqrt(4)和pow(2,3)，未读取商品数据。
- 最早分叉依据：给定final_sql是sqrt/pow常量探测，与predicted_result五列损耗摘要不可能属于同一结果形状。可见探测没有业务数据，但不能把它当作已交付CSV的最终SQL来定位业务失败；需先恢复查询与结果绑定。
- 错误层依据：SQL/CSV绑定不足，无法区分业务错误、导出流程错误或卷宗抽取问题；不强称方言或数据错。
- 可见性依据：spec_info与decisions为空是记录缺失。真正导出候选尚未恢复，不能对未知业务分叉节点强贴未声明。

**standard 原文**（卷宗第 97 行，`/instruction`）：

```text
For veg whsle data, can you generate a summary of our items' loss rates? Include the average loss rate, and also break down the count of items that are below, above, and within one standard deviation from this average.
```
业务数据及指标

**sql 原文**（卷宗第 97 行，`/final_sql`）：

```text
SELECT sqrt(4.0) AS sqrt_ok, pow(2.0, 3.0) AS pow_ok
```
常量计算不读取商品

**spec 原文**（卷宗第 97 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
卷宗Spec缺失

**result 原文**（卷宗第 97 行，`/predicted_result/csv_info/header`）：

```text
["avg_loss_rate_pct", "std_dev_pct", "below_1sd_count", "within_1sd_count", "above_1sd_count"]
```
CSV为五列损耗统计，与final_sql两列常量探测不对应

**证据限制**：
- predicted_result损耗CSV列与final_sql常量列不一致；最后SQL可能是探测，不能证明产生交付文件。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- 需实际导出CSV对应SQL与候选时间/ID绑定；纯别名差不能解释两列常量与五列损耗的差异。

### 98. local285

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：98。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：2020–2023年按年类别输出九项价格/损耗/利润指标，两位小数，标准含类别代码。
- SQL 实际：商品日连接交易、批发价与损耗，反推购入量作成本、加权损耗率，再按类别名称年汇总；缺类别代码。
- 最早分叉依据：缺category_code可证；Gold缺公式与总体细则，不能把内连接、退货符号或加权推断为最早错误。
- 错误层依据：无法确定指标数值差的口径/实现层。
- 可见性依据：完整检查spec_info空壳、空decisions及发布disclosures；无公式声明不等于已找到公式错。
- 其他差异：["output"]

**standard 原文**（卷宗第 98 行，`/instruction`）：

```text
For veg whsle data, can you analyze our financial performance over the years 2020 to 2023? I need insights into the average wholesale price, maximum wholesale price, minimum wholesale price, wholesale price difference, total wholesale price, total selling price, average loss rate, total loss, and profit for each category within each year. Round all calculated values to two decimal places.
```
年份、指标、精度

**standard 原文**（卷宗第 98 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["YR", "category_code", "category_name", "AVG_WHOLE_SALE", "MAX_WHOLE_SALE", "MIN_WHOLE_SALE", "WHOLE_SALE_DIFF", "WHOLE_SALE_PRICE", "SELLING_PRICE", "AVG_LOSS_RATE_PCT", "TOTAL_LOSS", "PROFIT"]
```
标准含类别代码

**sql 原文**（卷宗第 98 行，`/final_sql`）：

```text
CASE WHEN netkg>0 THEN netkg/(1.0-lr/100.0) ELSE 0 END AS purchased
```
反推成本

**sql 原文**（卷宗第 98 行，`/final_sql`）：

```text
SELECT category,
       yr AS year,
```
输出缺代码

**spec 原文**（卷宗第 98 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
完整业务Spec空壳

**证据限制**：
- 需Gold商品日总体、价格总额/均值、损耗及利润定义；SQL未限制年份，但不能断言有超窗数据。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。

### 99. local286

- 运行：`spider2-gold-correct-103-20260925-deepseek-subagent-v2-r2`；卷宗行：99。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：卖家销售额、均价、评论及打包时间；数量>100；最高销量英文类别；标准含product_cnt。
- SQL 实际：商品行数过滤；评论先订单均值再卖家均值，打包按去重卖家订单；六列缺数量且数值舍入两位。
- 最早分叉依据：可证实缺product_cnt；缺Gold均值权重/事件边界，不能由输出不足猜上游。
- 错误层依据：主要均值与资格错因无可核实规则。
- 可见性依据：完整检查仅delivery的spec_info及全部两次decisions；六列有提议，评论粒度有备选但无成功采纳记录。
- 其他差异：["output"]

**standard 原文**（卷宗第 99 行，`/instruction`）：

```text
Prepare a comprehensive performance report on our sellers, focusing on total sales, average item price, average review scores, and packing times. Ensure that the report includes only those sellers who have sold a quantity of more than 100 products and highlight the product category names in English with the highest sales volume.
```
卖家报告

**standard 原文**（卷宗第 99 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["seller_id", "product_cnt", "avg_price", "total_sales", "avg_packing_time", "avg_review_score", "highlight_product"]
```
标准七列

**sql 原文**（卷宗第 99 行，`/final_sql`）：

```text
AVG(order_avg) AS avg_review_score
```
订单均值算法

**sql 原文**（卷宗第 99 行，`/final_sql`）：

```text
SELECT si.seller_id, ROUND(si.total_sales,2) AS total_sales, ROUND(si.avg_item_price,2) AS average_item_price
```
最终六列开头

**spec 原文**（卷宗第 99 行，`/our_spec_and_decisions/decisions/1/args/spec/output/value/columns`）：

```text
["seller_id", "total_sales", "average_item_price", "average_review_score", "average_packing_time_days", "top_category_english"]
```
提议六列

**证据限制**：
- 需Gold评论/打包权重、打包起止事件和精度、最高类别并列规则；provisionalAlternativeId非成功采纳返回。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 100. local297

- 运行：`spider2-29-refactor-deepseek-001`；卷宗行：100。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：客户月存取净额累计月末余额，最新与前月比较，前月0则当前余额×100，增长>5%客户比例。
- SQL 实际：仅存取，客户自己的最新观测月和LAG累计余额比较；无前月NULL且客户仍在分母。
- 最早分叉依据：已知符号/累计/零分母规则吻合；不能由51.2与36.4猜需加入purchase、补月或改全局最新月。
- 错误层依据：缺Gold单月/缺月规则，主要数值错误层不明。
- 可见性依据：完整检查spec_info及三次decisions；存取范围、各自最新月、无前月不入分子有明确提议，无已证实标准矛盾。
- 其他差异：["output"]

**standard 原文**（卷宗第 100 行，`/instruction`）：

```text
For each customer, group all deposits and withdrawals by the first day of each month to obtain a monthly net amount, then calculate each month’s closing balance by cumulatively summing these monthly nets. Next, determine the most recent month’s growth rate by comparing its closing balance to the prior month’s balance, treating deposits as positive and withdrawals as negative, and if the previous month’s balance is zero, the growth rate should be the current month’s balance multiplied by 100. Finally, compute the percentage of customers whose most recent month shows a growth rate of more than 5%.
```
增长及特殊规则

**sql 原文**（卷宗第 100 行，`/final_sql`）：

```text
WHEN prior_balance = 0 THEN closing_balance * 100.0
              ELSE (closing_balance - prior_balance) * 100.0 / prior_balance END AS growth_rate
```
公式特殊分支

**spec 原文**（卷宗第 100 行，`/our_spec_and_decisions/decisions/2/args/hypotheses/2/statement`）：

```text
The percentage denominator is all customers appearing in customer_transactions; customers with fewer than two months have no prior balance (undefined growth) and are not counted in the numerator.
```
单月客户处理声明

**result 原文**（卷宗第 100 行，`/gold_results/0/csv_info/head/0/0`）：

```text
36.4
```
结果差异不是上游依据

**证据限制**：
- 需Gold缺月补齐、单月起始余额及比较月份定义；output/percentage_of_customers列名是次级shape偏差。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 101. local298

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：101。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：标准顺序：客户月余额→取前月→负总额归零→排除首月。
- SQL 实际：逐客户累计到月1日前，先把各负客户余额归零，再SUM所有客户。
- 最早分叉依据：MAX(SUM余额,0)与SUM(MAX客户余额,0)顺序不同；无证据判交易来源/连接错误，最早是公式。
- 错误层依据：采用不同截零聚合顺序，实际Spec没有正确公式声明。
- 可见性依据：完整检查spec_info唯一约束results in ascending、空decisions及disclosures，无截零阶段声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 101 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["customer-month balances as of first day", "select previous month via lag", "replace negative total with zero", "exclude first baseline month"]
```
标准negative total阶段

**sql 原文**（卷宗第 101 行，`/final_sql`）：

```text
SUM(CASE WHEN bal < 0 THEN 0 ELSE bal END) AS total_balance
```
先客户截零再合计

**spec 原文**（卷宗第 101 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [{"id": "HC-1", "statement": "results in ascending", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
完整声明仅排序

**证据限制**：
- 题面negative balances可有客户层读法，本标依据标准明确negative total；未核实Gold隐藏SQL。
- 月份硬编码及格式差异可见，不凭此断言额外年份遗漏。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。

### 102. local299

- 运行：`spec-names-10-20260927-deepseek-r1`；卷宗行：102。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：每客户首末交易日逐日余额，满30日后滚动平均负值归0，客户月MAX再月SUM，排除首月。
- SQL 实际：补齐首末之间日历，累计符号净额，29前行至当前30日均值，客户月MAX后SUM并ROUND两位。
- 最早分叉依据：时间、补日、窗口和嵌套公式与标准吻合；不能由数值差猜31天/全局截止日/另一次截零。
- 错误层依据：缺GoldSQL不能定位主要数值错误。
- 可见性依据：已逐条检查spec_info及三次decisions；日历候选和decide意图存在，但无已证实标准错误分叉。
- 其他差异：["output"]

**standard 原文**（卷宗第 102 行，`/standard_semantics/facets/time/alternatives/0/calculationWindow`）：

```text
each customer from first to last transaction date
```
各自首末日

**standard 原文**（卷宗第 102 行，`/standard_semantics/facets/measure/alternatives/0/aggregationOrder`）：

```text
["daily balances within each customer history", "30-day rolling average after 30 observations", "maximum per customer-month", "sum customer maxima by month"]
```
运算顺序

**sql 原文**（卷宗第 102 行，`/final_sql`）：

```text
AVG(balance) OVER (PARTITION BY customer_id ORDER BY d ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS avg30
```
30日平均

**sql 原文**（卷宗第 102 行，`/final_sql`）：

```text
ROUND(SUM(mx),2) AS total_max_30d_avg_balance
```
舍入别名

**spec 原文**（卷宗第 102 行，`/our_spec_and_decisions/decisions/1/args/spec/output/value/columns`）：

```text
["month", "total_max_30d_avg_balance"]
```
输出提议

**spec 原文**（卷宗第 102 行，`/our_spec_and_decisions/decisions/2/args/dispositions/2/action`）：

```text
decide
```
decide意图

**证据限制**：
- 需Gold日余额构造及窗口精确边界；别名和两位舍入不能解释未舍入数值差。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 103. local300

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：103。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：累计日余额后负余额显示为0，再按客户月MAX和跨客户SUM。
- SQL 实际：下一日MAX(0,截零后上日余额+净额)，抹掉历史负债并继续累计。
- 最早分叉依据：日期和缺日carry符合题面；分叉是截零结果反馈下一日状态，不是完成累计后显示截零。
- 错误层依据：Spec主动声明max(0,prev_bal+net)，SQL实现该不同公式。
- 可见性依据：实际spec_info HY-3为model_inference，全部三个decisions重复递归截零，没有合格证据支持抹掉负债。
- 其他差异：["output"]

**standard 原文**（卷宗第 103 行，`/instruction`）：

```text
For each customer, calculate their daily balances for every day between their earliest and latest transaction dates, including days without transactions by carrying forward the previous day's balance. Treat any negative daily balances as zero. Then, for each month, determine the highest daily balance each customer had during that month. Finally, for each month, sum these maximum daily balances across all customers to obtain a monthly total.
```
日余额后负值处理

**sql 原文**（卷宗第 103 行，`/final_sql`）：

```text
MAX(0, r.bal + COALESCE(n.net,0))
```
截零反馈递归

**spec 原文**（卷宗第 103 行，`/our_spec_and_decisions/decisions/2/args/spec/metric`）：

```text
sum over customers of max over that month's daily balances (daily bal = max(0, prev_bal + net)); net = +amount for deposit, -amount for purchase/withdrawal
```
错误递推声明

**spec 原文**（卷宗第 103 行，`/our_spec_and_decisions/spec_info/hypotheses/2/basis`）：

```text
No authoritative evidence was supplied for this inferred facet
```
无权威依据

**证据限制**：
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 104. local301

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：104。
- 分叉节点：**population.time**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`high`。
- 标准：Gold按距离6月15日的ROUND周偏移+1，before=-3..0，after=1..4。
- SQL 实际：取不晚于6月15的最近周为锚，锚周两侧各四行，锚周两边均排除。
- 最早分叉依据：周销售来源和SUM相同；上游差异是进入两期的周，不先猜公式/缺周。
- 错误层依据：模型时间假设采用错误锚周规则，非SQL违背正确声明。
- 可见性依据：spec_info H2为model_inference，完整两次decisions同样提议锚周排除，无合格题面依据。
- 其他差异：["output"]

**standard 原文**（卷宗第 104 行，`/standard_semantics/gold_sql`）：

```text
SUM(CASE WHEN delta_weeks BETWEEN 1 AND 4 THEN sales END) AS after_effect,
        SUM(CASE WHEN delta_weeks BETWEEN -3 AND 0 THEN sales END) AS before_effect
```
Gold划窗

**sql 原文**（卷宗第 104 行，`/final_sql`）：

```text
CASE WHEN a.rn BETWEEN p.anchor_rn-4 AND p.anchor_rn-1 THEN 'pre'
                WHEN a.rn BETWEEN p.anchor_rn+1 AND p.anchor_rn+4 THEN 'post'
```
排除锚周

**spec 原文**（卷宗第 104 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
因数据每周仅以单独一周的周一日期标识，且 6月15日不固定为周日制边界，处理上以每年“含6月15日的那一周”为中点（即该年最接近且不晚于6/15的周起点星期），pre 取中点前4个数据周、post 取中点后4个数据周
```
时间假设

**证据限制**：
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 105. local302

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：105。
- 分叉节点：**selection**；错误层：**实现错**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：各属性值变化求属性类型均值，只返回负影响最大的类型及均值。
- SQL 实际：计算五种均值并排序，不LIMIT/取MIN，返回全部类型。
- 最早分叉依据：窗口、逐值后均值符合粗标准；可证实只排序未选最负对象，先于输出shape。
- 错误层依据：两次begin声明ranking.n=1正确，SQL没落实；output.rowCount=5另有自身冲突。
- 可见性依据：selection已正确声明n=1，五类错误可见性不能诚实适用，不制造未声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 105 行，`/instruction`）：

```text
Analyze the average percentage change in sales between the 12 weeks before and after June 15, 2020, for each attribute type: region, platform, age band, demographic, and customer type. For each attribute type, calculate the average percentage change in sales across all its attribute values. Identify the attribute type with the highest negative impact on sales and provide its average percentage change in sales.
```
只取最大负影响类型

**sql 原文**（卷宗第 105 行，`/final_sql`）：

```text
FROM pct GROUP BY attribute_type ORDER BY avg_pct_change ASC;
```
排序未选择

**spec 原文**（卷宗第 105 行，`/our_spec_and_decisions/decisions/1/args/spec/ranking/value`）：

```text
{"n": 1, "orderBy": "avg_pct_change ascending (most negative first)", "tiePolicy": "include_ties"}
```
正确n=1

**spec 原文**（卷宗第 105 行，`/our_spec_and_decisions/decisions/1/args/spec/output/value`）：

```text
{"columns": ["attribute_type", "avg_pct_change"], "rowCount": 5, "rowMode": "grouped"}
```
5行冲突声明

**证据限制**：
- 实际spec_info只有交付格式；ranking是参数声明意图，不能宣称已成功采纳。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 106. local309

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：106。
- 分叉节点：**population.source**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：Gold读取results逐场积分按年SUM，分别选最高分车手及构造商。
- SQL 实际：读取最后一轮driver_standings/constructor_standings，内连接配对年份。
- 最早分叉依据：替换事实数据集：逐场成绩vs官方累计standings，不是同一事实换金额列；来源先于求分/并列。
- 错误层依据：无业务声明时采用另一积分来源，而非有正确Spec被SQL违反。
- 可见性依据：完整spec_info空壳、空decisions及disclosures未定义积分来源。
- 其他差异：["measure.formula", "selection.ties"]

**standard 原文**（卷宗第 106 行，`/standard_semantics/gold_sql`）：

```text
sum(results.points) as points
    from results
```
Gold来源

**sql 原文**（卷宗第 106 行，`/final_sql`）：

```text
FROM driver_standings ds
```
车手standings来源

**sql 原文**（卷宗第 106 行，`/final_sql`）：

```text
FROM constructor_standings cs
```
车队standings来源

**spec 原文**（卷宗第 106 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
完整业务声明空壳

**证据限制**：
- Gold constructor IS NOT NULL连接未显式限定union构造商分支，可能混入车手分支；不声称该风险已造成错误。

### 107. local311

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：107。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：构造商年最佳车手积分加团队积分，全局前三；year、constructor、combined_points。
- SQL 实际：末轮standings团队分加当年效力过队的车手最高全年分，取前三；constructor先于year。
- 最早分叉依据：缺Gold积分来源/最佳车手归属细则，不能由1320vs1435反推用比赛分或队内分；列序为次级。
- 错误层依据：主要积分差异无可核实规则。
- 可见性依据：完整检查spec_info及九次decisions，有来源备选和多次select PS1意图，不证明选择错误或成功生效。
- 其他差异：["output"]

**standard 原文**（卷宗第 107 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
combined points from best driver and team per constructor-year
```
组合积分要求

**sql 原文**（卷宗第 107 行，`/final_sql`）：

```text
MAX(d.driver_points) AS best_driver_points
```
最佳全年分

**sql 原文**（卷宗第 107 行，`/final_sql`）：

```text
cs.team_points + b.best_driver_points AS combined_points
```
组合公式

**spec 原文**（卷宗第 107 行，`/our_spec_and_decisions/decisions/8/args/dispositions/2/rationale`）：

```text
题面说的是车手与车队的“points”（逐字：“combined points from their best driver and team”，evidence_bc71d117），在锦标赛语境下即赛季总积分。PS1 取 driver_standings/constructor_standings 赛季末积分，正是官方赛季总分（constructor_standings 最大值 860 对应 Red Bull 2023 官方总分）；PS2 用逐场 results/constructor_results 累加，会遗漏 results 未包含的冲刺赛积分，且不适用于历史赛季的最佳 N 站等计分规则（数据检查显示 81 个车手赛季的逐场累加值不等于 driver_standings 赛季末积分），无法复现官方积分口径。因此排除 PS2，采用 PS1。
```
最后来源选择意图

**spec 原文**（卷宗第 107 行，`/our_spec_and_decisions/decisions/2/args/spec/output/value/columns`）：

```text
["constructor", "year", "combined_points"]
```
列序声明

**证据限制**：
- 需Gold车手分定义（全年/效力队所得）、团队积分来源与最佳车手身份覆盖规则。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 108. local329

- 运行：`spider2-local-improved-full-003`；卷宗行：108。
- 分叉节点：**population.entity**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`medium`。
- 标准：统计访问input后再访问confirm的不同会话数。
- SQL 实际：最后SQL只返回action_log_with_noise的不同url前20个，不使用session。
- 最早分叉依据：实体从会话换成URL，先于访问顺序、计数及shape；序列可入已有节点。
- 错误层依据：页面值探测没有题目会话总体，无正确Spec支持认定实现违约。
- 可见性依据：完整spec_info、decisions、disclosures全空，卷宗缺实体声明，不等于运行时未声明。
- 其他差异：["population.conditions", "measure.countGrain", "output"]

**standard 原文**（卷宗第 108 行，`/instruction`）：

```text
How many unique sessions visited the /regist/input page and then the /regist/confirm page, in that order?
```
不同会话及顺序

**sql 原文**（卷宗第 108 行，`/final_sql`）：

```text
SELECT DISTINCT url FROM action_log_with_noise LIMIT 20
```
URL替代会话

**spec 原文**（卷宗第 108 行，`/our_spec_and_decisions/spec_info`）：

```text
{}
```
记录缺失

**证据限制**：
- 无predicted CSV且状态max_turns；final_sql可能为最后探索，非成功交付业务查询。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。

### 109. local330

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：109。
- 分叉节点：**output**；错误层：**标准答案有问题**；可见性：**定义缺口**。
- 状态：`classified`；置信：`high`。
- 标准：题面要求每网页的唯一会话数量，landing/exit同页同会话只计一次；Gold只有path2一列/detail一行。
- SQL 实际：按timestamp首末页UNION去重，按页COUNT DISTINCT session，输出页面及数量。
- 最早分叉依据：Gold完整1×1结果缺题面明确数量，矛盾在output；不臆造GoldSQL，也不由行数差猜上游。
- 错误层依据：Gold唯一列路径既没会话数量又非每页计数，与compute the total number直接冲突。
- 可见性依据：实际Spec只有片段filter，无输出声明；Gold自身错不适用五类模型错误可见性，不能贴未声明。

**standard 原文**（卷宗第 109 行，`/instruction`）：

```text
Using the activity log table, compute the total number of unique user sessions where each web page appears as either a landing page (the first page visited in a session based on timestamp) or an exit page (the last page visited in a session based on timestamp), or both. Count each session only once per page even if the page serves as both landing and exit for that session. 
```
每网页唯一会话数量

**standard 原文**（卷宗第 109 行，`/standard_semantics/facets/measure/alternatives/0/expression`）：

```text
unique sessions per landing or exit page, counted once per page
```
标准业务计数

**result 原文**（卷宗第 109 行，`/gold_results/0/csv_info`）：

```text
{"exists": true, "rows": 1, "cols": 1, "header": ["path2"], "head": [["/detail"]]}
```
Gold完整单行单列

**sql 原文**（卷宗第 109 行，`/final_sql`）：

```text
SELECT page, COUNT(DISTINCT session) AS session_cnt
```
每页数量

**spec 原文**（卷宗第 109 行，`/our_spec_and_decisions/spec_info`）：

```text
{"specVersion": "1", "hardConstraints": [{"id": "HC-1", "statement": "visited in a", "scope": "filter", "provenance": {"authority": "request_wording", "source": "request-question"}}], "hypotheses": [], "ambiguities": [], "answerContract": {}}
```
完整Spec片段约束

**证据限制**：
- 未证明SQL路径归一化或timestamp同值政策符合隐藏规则；Gold错误只限缺数量，不代表SQL全部正确。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。

### 110. local331

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：110。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：连续两次/detail后紧接第三页频次前三；Gold含END。
- SQL 实际：会话内timestamp顺序LAG两页，筛非空第三页COUNT并LIMIT3。
- 最早分叉依据：计数与连续顺序符合已知要求；END存储值还是合成终止值未定义，不据结果臆造补终止。
- 错误层依据：无GoldSQL/终止规则无法判定主错因。
- 可见性依据：完整spec_info及两次decisions明确会话连续顺序及精确/detail推断，没有终止标识来源声明。
- 其他差异：["output"]

**standard 原文**（卷宗第 110 行，`/instruction`）：

```text
Which three distinct third-page visits are most frequently observed immediately after two consecutive visits to the '/detail' page, and how many times does each third-page visit occur?
```
相邻三页

**sql 原文**（卷宗第 110 行，`/final_sql`）：

```text
WHERE third_page IS NOT NULL AND third_page <> ''
  AND prev1 = '/detail'
  AND prev2 = '/detail'
```
序列筛选

**spec 原文**（卷宗第 110 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
'连续两次访问 /detail 后紧接的第三页'按 逐一会话(session) 内按时间排序后的相邻浏览顺序判定
```
会话内顺序

**result 原文**（卷宗第 110 行，`/gold_results/0/csv_info/head/1`）：

```text
["END", "7"]
```
Gold END类别

**证据限制**：
- 需Gold END定义、会话末尾是否合成事件、无第三访问是否记END；不把结果值当处理规则。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 111. local335

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：111。
- 分叉节点：**measure.formula**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：2001起，仅纳入积分>0车手，逐季识别最低分车手并统计对应构造商赛季数。
- SQL 实际：先正分车手，再按构造商SUM这些车手在队所得分，比较各队总分MIN，非车手比较。
- 最早分叉依据：年份/积分>0过滤正确；分叉在最少分作用于车手还是车队的嵌套次序，先于Top5。
- 错误层依据：Spec H1/H3主动队级总分MIN，SQL落实不同读法。
- 可见性依据：实际spec_info为model_inference/candidate，全部两次decisions同样推断提升比较到构造商层，无合格题面证据。
- 其他差异：["output"]

**standard 原文**（卷宗第 111 行，`/instruction`）：

```text
In Formula 1 seasons since 2001, considering only drivers who scored points in a season, which five constructors have had the most seasons where their drivers scored the fewest total points among all point-scoring drivers in that season?
```
比较集合point-scoring drivers

**sql 原文**（卷宗第 111 行，`/final_sql`）：

```text
SELECT yr, MIN(total_pts) AS mn
  FROM ctor_yr
```
队汇总后的MIN

**spec 原文**（卷宗第 111 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
'得分最少总积分'车队=某赛季中，仅统计积分>0的得分车手，按车队归属汇总该车队得分车的赛季总积分，总积分最少的所有车队（含并列）记为'最少积分车队'。
```
错误队级解释

**证据限制**：
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 112. local336

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：112。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：前五圈R/P/S/T分类计数，分类码和数量两列。
- SQL 实际：读取已分类overtakes行COUNT(*)，另输出英文category标签，共三列。
- 最早分叉依据：多category列可证；COUNT行vs事件去重标准未给，P数差18不是必须去重的业务依据。
- 错误层依据：无法确定主要数值错因是计数对象还是数据规则，输出差异不足定上游。
- 可见性依据：完整spec_info及十次decisions：行/事件候选与select/provisional多次存在，但不证明相对Gold该选择错误。
- 其他差异：["output"]

**standard 原文**（卷宗第 112 行，`/standard_semantics/facets/output/alternatives/0/columnNames`）：

```text
["overtake_type", "overtake_count"]
```
标准两列

**standard 原文**（卷宗第 112 行，`/instruction`）：

```text
In the first five laps of the race, how many overtakes occurred in each category—retirements, pit stops, start-related overtakes, and standard on-track passes?
```
圈与类别

**sql 原文**（卷宗第 112 行，`/final_sql`）：

```text
END AS category,
       COUNT(*) AS overtake_count
```
行计数和额外标签

**spec 原文**（卷宗第 112 行，`/our_spec_and_decisions/decisions/9/args/dispositions/2/rationale`）：

```text
题面问 how many overtakes occurred in each category，而业务定义把超车明确分成 R/P/S/T 四类且由 overtakes 表的 overtake_type 逐条标注，因此把每条已分类的记录各计一次（COUNT(*)）是直接实现。另一候选要求同一事件同时被标为 P 与 T 时只保留一个；业务定义只说 T 是在‘以上都不适用’时的兜底类，并没有给出同一事件出现两个并存标签时如何取舍的规则，也没有说应去除其中一条，所以去重需要引入文档未授权的裁决规则，会额外丢掉圈 1-5 内已标注的 18 条 P 与 32 条 T 记录，故不采纳。
```
最后行计数选择意图

**spec 原文**（卷宗第 112 行，`/our_spec_and_decisions/decisions/9/args/spec/output/value/columns`）：

```text
["overtake_type", "category", "overtake_count"]
```
三列声明

**证据限制**：
- 需Gold行/业务事件键及P/T多标签归属规则；Spec中的重复观测陈述非已核实事实。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 113. local344

- 运行：`round11-full-confirm-fewshot-001`；卷宗行：113。
- 分叉节点：**grouping**；错误层：**口径错**；可见性：**未声明**。
- 状态：`classified`；置信：`high`。
- 标准：pit数据可用比赛的超车按类型分别计数。
- SQL 实际：pit可用过滤后直接COUNT所有超车，无类型字段或GROUP BY。
- 最早分叉依据：overtakes来源和pit资格条件无证据证明错；漏类型维度先于标量shape。
- 错误层依据：实际answerContract硬绑定scalar1与按类型要求相反，非SQL背离正确分组声明。
- 可见性依据：完整spec_info仅片段filter及scalar契约，空decisions；未声明grouping，输出quote非正确分组定义。
- 其他差异：["output"]

**standard 原文**（卷宗第 113 行，`/instruction`）：

```text
Considering all races where pit stop data is available, and focusing on instances when a driver was not behind another car on the previous lap but is behind on the current lap (accounting for retirements, pit-stop entries, pit-stop exits, and race starts), how many times has each type of overtake occurred in Formula 1?
```
each type

**standard 原文**（卷宗第 113 行，`/standard_semantics/facets/grain/alternatives/0/entity`）：

```text
overtake category
```
类型分组

**sql 原文**（卷宗第 113 行，`/final_sql`）：

```text
SELECT COUNT(*) AS overtake_count
FROM overtakes o
JOIN races_ext r ON o.race_id = r.race_id
WHERE r.is_pit_data_available = 1
```
无GROUP BY总体计数

**spec 原文**（卷宗第 113 行，`/our_spec_and_decisions/spec_info/answerContract/output`）：

```text
{"value": {"columns": [], "rowMode": "scalar", "rowCount": 1}, "binding": "hard", "provenance": {"authority": "request_wording", "source": "legacy-answer-shape"}, "quote": "Considering all races where pit stop data is available, and focusing on instances when a driver was not behind another car on the previous lap but is behind on the current lap (accounting for retirements, pit-stop entries, pit-stop exits, and race starts), how many times has each type of overtake occurred in Formula 1?\n\n请完成原始题目，并将最终成果导出为 CSV。只导出回答题目所需的最终结果，不要导出中间结果、候选数据或诊断字段；本次评测需要使用 export_query 生成 CSV，不要用 publish_query_result 代替。"}
```
标量契约且无分组声明

**证据限制**：
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。

### 114. local354

- 运行：`wrong-submitted-34-20260926-deepseek-probes-r1`；卷宗行：114。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：1950s每赛季首末参赛构造商同一且至少两轮，输出车手；Gold列driver_id。
- SQL 实际：results按车手年min/max轮次，MIN构造商值比较，输出去重全名。
- 最早分叉依据：已知轮次条件相合；Gold资格来源/边界规则未知，不由104vs3猜过滤DNQ或使用drives。
- 错误层依据：主要资格错因不明；姓名而非ID为次级output差异。
- 可见性依据：完整delivery实际spec_info及七次decisions：results/drives备选和select/supersede意图可见，未证明Gold来源。
- 其他差异：["output"]

**standard 原文**（卷宗第 114 行，`/standard_semantics/facets/filters/required/2/semanticPredicate`）：

```text
same constructor in first and last race
```
首末同队

**sql 原文**（卷宗第 114 行，`/final_sql`）：

```text
WHERE b.n_rounds >= 2
  AND fc.c_first = lc.c_last
```
资格

**sql 原文**（卷宗第 114 行，`/final_sql`）：

```text
SELECT DISTINCT dp.forename || ' ' || dp.surname AS driver_name
```
姓名替代ID

**spec 原文**（卷宗第 114 行，`/our_spec_and_decisions/decisions/0/args/hypotheses/0/statement`）：

```text
“首场/末场”按 championship round 先后（min/max round）确定；“同一 constructor”指这两场的 results.constructor_id 相等
```
轮次映射

**spec 原文**（卷宗第 114 行，`/our_spec_and_decisions/decisions/3/args/dispositions/0/rationale`）：

```text
证据 7899bc00 显示：对 driver 541 / 1958，drives 表没有 is_final_drive_of_season=1 的行（只有 first 与一条 constructor_id=-1 的占位行，覆盖 round 3–10），而 results 明确有 round 11 且 constructor_id=66 的真实参赛记录——即 drives 相对于 results 不完整且含占位行，无法可靠回答“首次/末次参赛场次”。候选 evidence_4606ab17（drives 口径）多出 113 而非 104 名车手，多出的车手（如 bettenhausen、bob_scott、darter、daywalt、fonder）正是仅由 drives 占位/不完整记录产生的差异。因此选 results⋈races：它是逐场参赛事实记录，races 提供 year/round，能直接表达“首次/末次参赛轮次”与“至少两个不同 round”。
```
来源选择意图

**证据限制**：
- 需Gold资格来源、实际参赛/登记/DNQ定义、边界多constructor规则；不以行数定位source。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 115. local355

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：115。
- 分叉节点：**population.entity**；错误层：**口径错**；可见性：**假定错**。
- 状态：`classified`；置信：`medium`。
- 标准：每车手一个年份缺席的第一轮及最后一轮，少于三场且其前后换队，跨年总体均值。
- SQL 实际：每车手年枚举连续缺席gap；年总缺席<3后各段单独比较前后constructor，每段等权AVG。
- 最早分叉依据：年内first/last整体单元被拆成可多次贡献的gap，先于均值；不因LEAD复杂归树外。
- 错误层依据：Spec主动把year内first/last解释为每gap边界，不是SQL背离声明。
- 可见性依据：实际spec_info H2/H4为model_inference，完整两次decisions明确each qualifying gap，无合格依据支持以段代车手年。
- 其他差异：["population.conditions", "measure.formula"]

**standard 原文**（卷宗第 115 行，`/instruction`）：

```text
Calculate the overall average first round and average last round of races missed by Formula 1 drivers across all years. Include only drivers who missed fewer than three races in a given year and who switched teams between their appearances immediately before and after their hiatus (i.e., the constructor ID for the race right before their first missed race must be different from the constructor ID for the race right after their last missed race in that year). Do not group results by year; return just the overall averages across the entire dataset.
```
车手年first/last

**sql 原文**（卷宗第 115 行，`/final_sql`）：

```text
SELECT g.*
  FROM gaps g
```
每段资格行

**sql 原文**（卷宗第 115 行，`/final_sql`）：

```text
SELECT AVG(q.round_before + 1) AS avg_first_round,
       AVG(q.round_after - 1) AS avg_last_round
```
各段平均

**spec 原文**（卷宗第 115 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
Each qualifying driver-year contributes each contiguous within-year gap whose size (rounds skipped) is part of a driver-year total < 3, provided the constructor switches across that gap.
```
各段贡献

**spec 原文**（卷宗第 115 行，`/our_spec_and_decisions/spec_info/hypotheses/2/statement`）：

```text
first_round is the round number of the earliest skipped race in the gap (round_before + 1); last_round is the last skipped round (round_after - 1); both are averaged equally over qualifying gaps.
```
gap等权

**证据限制**：
- 标准grain写team，与题面/标量均值不一致；依据明确车手年措辞，不以粗字段断言GoldSQL错误。
- 未核实数据是否存在同年多个gap；可见算法口径不同，不宣称具体受影响车手。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 116. local356

- 运行：`spider2-gold-correct-103-20260925-deepseek-subagent-v2-r2`；卷宗行：116。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：仅on-track且排除pit/退赛/首圈，被超车次数>超车次数的车手全名。
- SQL 实际：T且lap>1，汇总received/made，再选received>made输出full_name。
- 最早分叉依据：粗标准、SQL和Spec的类别/圈/角色比较吻合；21vs45行不能证明别的来源、事件重建或去重。
- 错误层依据：不能定位口径/实现/数据层；不把缺Gold当标准错。
- 可见性依据：完整spec_info及五次decisions明确T、lap>1、角色及输出，无可证实错误声明。

**standard 原文**（卷宗第 116 行，`/instruction`）：

```text
Provide the full names of drivers who have been overtaken on track more times than they have overtaken others on track during race laps, excluding position changes due to pit stops (both at pit entry and exit), retirements, or position changes that occurred during the first lap of a race (considered as start movements).
```
要求及排除

**sql 原文**（卷宗第 116 行，`/final_sql`）：

```text
FROM overtakes WHERE overtake_type = 'T' AND lap > 1
```
类型圈过滤

**sql 原文**（卷宗第 116 行，`/final_sql`）：

```text
WHERE a.received > a.made
```
角色比较

**spec 原文**（卷宗第 116 行，`/our_spec_and_decisions/decisions/0/args/spec/metric/value/expression`）：

```text
count(on-track overtakes received during race laps) > count(on-track overtakes made during race laps)
```
正确角色声明

**spec 原文**（卷宗第 116 行，`/our_spec_and_decisions/decisions/3/args/spec/filters/1/value`）：

```text
lap > 1 (exclude first-lap / start movements)
```
排除首圈声明

**证据限制**：
- 需Gold事件生成、类别冲突/多标签排除、数据源及计数粒度；当前摘要不足定位。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 117. local358

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：117。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：每年龄类别人数，数据集定义参考日；计源行/去重用户明确列为歧义。
- SQL 实际：user_id先GROUP BY，再以2016-11-28日差/365.25取整年龄后计数。
- 最早分叉依据：Gold人数不同不证明必须数行；标准没给参考日值，不能断言2016-11-28错误。
- 错误层依据：缺Gold粒度、日期及周岁算法，主要错误层待证据。
- 可见性依据：完整spec_info及两次decisions，H1去重/H2推断日期明确；decisionProposals仅候选没有采纳记录。
- 其他差异：["output"]

**standard 原文**（卷宗第 117 行，`/standard_semantics/facets/ambiguity/alternatives/0/question`）：

```text
user count may mean source rows or distinct user_id; age requires an as-of date
```
计数日期歧义

**standard 原文**（卷宗第 117 行，`/standard_semantics/facets/time/alternatives/0/window`）：

```text
age categories at the dataset-defined user age reference date
```
参考日未给值

**sql 原文**（卷宗第 117 行，`/final_sql`）：

```text
SELECT CAST((julianday('2016-11-28') - julianday(birth_date)) / 365.25 AS INT) AS age
  FROM mst_users
  GROUP BY user_id
```
参考日去重

**spec 原文**（卷宗第 117 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
每个用户 = 一个 DISTINCT user_id，统计用户数需去重
```
去重声明

**spec 原文**（卷宗第 117 行，`/our_spec_and_decisions/spec_info/hypotheses/1/statement`）：

```text
年龄 = 2016-11-28 与 birth_date 之差折算的整年数
```
推断日期

**证据限制**：
- 需明确参考日、行/用户键口径、重复用户birth_date冲突规则和周岁算法；category/age_category别名仅次级。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

### 118. local360

- 运行：`answer-plan-new-on-deepseek-official-gold116-r1`；卷宗行：118。
- 分叉节点：**待定（证据不足）**；错误层：**待定（证据不足）**；可见性：**待定（证据不足）**。
- 状态：`insufficient_evidence`；置信：`low`。
- 标准：会话内first detail/complete之前非空search事件数，选全局最小并保留并列；输出关联路径和search_type。
- SQL 实际：用rowid<MIN终止rowid而非stamp定义first/before，仅从已有合格事件GROUP BY会话计数后取全局最小。
- 最早分叉依据：可见存储序与时间序实现差异，但卷宗没给rowid/stamp顺序事实；零次和无终止会话资格、输出关联行也无标准细则，不能据缺一会话直接定最早因。
- 错误层依据：第二次声明提议stamp，但实际spec_info无具体排序，第三次提议清空metric/filter；缺返回无法确定正确声明实际采纳，不能强定实现错。
- 可见性依据：完整spec_info及三次decisions已检查，提议先chrono再清空，不能将未落实提议当成功Spec或宣称visibility taxonomy_gap。
- 其他差异：["measure.formula", "population.eligibility"]

**standard 原文**（卷宗第 118 行，`/instruction`）：

```text
For each user session in the activity log table, identify the number of events that occurred before the first '/detail' click or '/complete' conversion, counting only events that have a non-empty search type. Find the sessions with the minimum count of such pre-click/pre-conversion events. If multiple sessions share this minimum count, include all of them in the results. Return each qualifying session along with the corresponding path and search type.
```
first/before及并列

**sql 原文**（卷宗第 118 行，`/final_sql`）：

```text
AND al.rowid < (
      SELECT MIN(d.rowid) FROM activity_log d
```
rowid作终止顺序

**spec 原文**（卷宗第 118 行，`/our_spec_and_decisions/decisions/1/args/spec/filters/1`）：

```text
rows ordered by stamp within session; qualifying boundary row: path matching '/detail'/'/detail/'...
```
stamp排序提议

**spec 原文**（卷宗第 118 行，`/our_spec_and_decisions/spec_info/hypotheses/0/statement`）：

```text
The decisive '/detail' click or '/complete' conversion is a row whose path is a '/detail' variant (e.g. /detail or /detail/) or equals '/complete'; count events strictly before that row that have non-empty search_type.
```
实际Spec路径边界声明

**spec 原文**（卷宗第 118 行，`/our_spec_and_decisions/decisions/2/args/spec`）：

```text
{"entity": "session (activity_log.session)", "groupBy": [], "time": null, "ranking": null, "output": null, "filters": [], "metric": null}
```
最后清空参数

**证据限制**：
- 需Gold事件排序键/同时间裁决、零次及无终止会话资格、对应path/search_type选取规则。
- measure.formula是事件顺序可落节点，population.eligibility是零次会话疑点；secondary为已见待核差异，不是已确定错误。
- Gold SQL=null；只含结果摘要，不臆造隐藏处理。
- decisions仅工具参数，无返回；声明/处置意图不等于成功生效。

