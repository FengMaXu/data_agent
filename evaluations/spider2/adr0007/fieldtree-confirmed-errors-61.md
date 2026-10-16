# 61道评分错题：已证错误与差异提取

## 1. 范围与结论

本文件从**完整61道评分错题**中提取已证的agent错误或输出失配，合并第一次61题审查与后续35题独立重算；35题是61题的子集，不是另一批题。本次仅整理既有记录，没有查询数据库、重跑模型或修改原评分。

**共提取17题：13题存在已证业务/方法/实现局部问题（包括内部口径矛盾及文档符合性差异），另4题有已证输出/评分合同失配。** 这些标签不等于17题的全部失分都已解释，也不等于13题的Gold都已认证正确。

| 提取层级 | 数量 | 题号（均为local前缀） |
|---|---:|---|
| Gold相关内容已核验、agent业务错因可定位的核心样本 | 5 | 015、040、156、283、302 |
| 已证局部问题，但Gold/其他口径或整题失分仍有边界 | 8 | 003、050、060、064、066、277、354、358 |
| 已证输出/评分合同失配，不直接视为业务内容算错 | 4 | 059、228、311、336 |
| **agent侧已证问题或差异合计（不重复）** | **17** | **以上三组互斥** |

### 为什么不能只整理前面说的5题？

原61题报告已有11题“可证差异”：003、015、059、060、156、228、277、283、302、311、336。其中7题业务/方法/实现差异，4题输出合同差异。第一次主标Gold冲突的066同时已有agent忽略加去料的独立错误。后续35题重算又补充040、050、064、354、358五题的已证局部发现。因此是 **11＋1＋5＝17题**。

前述5题是加了“Gold相关内容已核验”条件后的更窄样本，并非全部确定性错题；其中**只有040来自35题重算**，015、156、283、302均在第一轮已定位。050仍维持整题未裁决，只提取其中间舍入的局部文档符合性问题；358只确认自身粒度矛盾。

Gold另外有32题局部问题，见第5节；与17题中的064、066、354重叠。不能因Gold有问题就免除agent的独立错误，也不能把Gold问题题数加到正确数。

## 2. 错误原因总表

| 题号 | 问题层级 | 最早可定位位置 | 已证原因 | 仍需保留的边界 |
|---|---|---|---|---|
| [local003](#local003) | 局部问题 | measure.formula | 把“先算每客户比率、再在客户段内平均”改为段内SUM金额/SUM订单数。前者客户等权，后者按订单数加权，不是等价公式。 | 修正嵌套聚合；不能宣称仅此即可恢复全部Gold。 |
| [local015](#local015) | 业务错误（核心） | population.conditions / measure.denominator | 用头盔标记替代摩托车事故资格，遗漏motorcycle_collision条件，扩大了分母。 | 先限定摩托车事故，再按头盔分组计率。长/宽布局仍是独立评分合同问题；两表交集覆盖限制需要披露。 |
| [local040](#local040) | 业务错误（核心） | population.entity / measure.countGrain | 把树表的每个物理记录当独立树；处理了收入侧ZIP重复，却没有处理树侧完整重复，造成重复实体加权。 | 先确定树身份及重复政策，再形成唯一树集合；不能用AVG(DISTINCT income)替代实体去重。同ID完整重复是同树仍属身份推断，缺已审核版本政策；独立重算首稿也犯了此错。 |
| [local050](#local050) | 局部问题 | measure.formula（局部中间舍入步骤） | 任务文档要求月均值先ROUND2，原公式没有表达该中间量化步骤，SQL只舍入最终median；最终精度不能代替中间舍入顺序。 | 补文档要求的中间步骤；不得据此把2021实际有销售资格认作已证正确。整题继续保留未裁决。 |
| [local059](#local059) | 输出/评分合同 | output（评分布局） | 输出单一整体均值，Gold要求三事业部的三行；向量长度不兼容是已证评分失配。 | 只确认布局不兼容；产品名称与编码粒度及Gold数值来源未定，改成三行不保证正确。 |
| [local060](#local060) | 局部问题 | measure.formula / output | Spec声明pp_difference，SQL却输出未乘100的fraction差；output的fraction声明与公式自身也矛盾。 | 统一百分点量纲并实现；其余分母、城市筛选及Gold数字仍需核验。 |
| [local064](#local064) | 局部问题 | population.missing / 全年月份实现 | 题目要求2020各客户各月，SQL只从实际交易取月份，遗漏5—12月，没有落实全年月份集合。 | 补全年月份；Gold也错，不能把接近363.742作为修复目标。5—12月无交易数据、最低月并列需披露；并列不改变本题零均值差。 |
| [local066](#local066) | 局部问题 | 配料公式 / 加去料实现 | 原SQL只展开标准配方，忽略每份订单的exclusions与extras，未计算实际送达披萨的最终配料用量。 | 按逐份披萨身份应用排除、追加及重复数量，再限定送达；保留Gold自身送达资格冲突。 |
| [local156](#local156) | 业务错误（核心） | population.conditions的作用阶段 / measure.formula依赖 | 将“排除首年”解释成同比前的总体过滤；yearly→filt删除2017→LAG，破坏2018所需基线。 | 先计算LAG及同比，再排除首年展示。行序与排名方向另有未唯一规定的合同问题，不把它们混作确定业务错因。 |
| [local228](#local228) | 输出/评分合同 | output（长表/宽表） | 每赛季三对球员横铺一行，而Gold每个排名配对一行，评分向量长度不同。 | 这是纯表示/评分合同失配，不计为业务错误。题面没有唯一规定长/宽布局。 |
| [local277](#local277) | 局部问题 | measure.formula（指定算法） | 题面要求weighted regression，最终公式及SQL却采用无显式权重的OLS。移动平均的平滑权重不是回归权重。 | 明确权重和回归对象；不能以方便实现的OLS替代，也不能声称改成任意WLS即可恢复Gold。 |
| [local283](#local283) | 业务错误（核心） | grouping / 排名域 | 将跨所有国家联赛每season选冠军，改为在season-country-league内分别选冠军，扩大最终对象集合。 | 区分球队积分累计粒度与冠军比较域，按season比较。题面存在联赛冠军背景读法，此处沿用既有审核的跨联赛season口径；Gold额外rank列不属于同一业务错因。 |
| [local302](#local302) | 业务错误（核心） | selection / output | 题目最终要最负的属性类型，Spec却将selection标为n/a并声明输出五行，用排序替代最终argmin选取。 | 计算五类后选取最负者，另行声明并列政策；不要把已有平均公式或unknown纳入自动判作本次错因。 |
| [local311](#local311) | 输出/评分合同 | output（缺评分列） | 交付只含车队与年份，缺少Gold评分检查的combined_points数值向量。 | 已证的是评分合同失配；不能认证Gold积分正确，也不能声称补列就修好整题。 |
| [local336](#local336) | 输出/评分合同 | output（类别值表示） | 把R/P/S/T代码改成描述字符串，评分按值比较，不能匹配Gold代码。这不是列名差异。 | 规范表示只能消除代码差异；Pit18件残差未定位，不能宣称全部原因已找到。 |
| [local354](#local354) | 局部问题 | population.eligibility | 把results记录存在视为实际参赛，将Bill Aston的非实际参赛记录算入资格，构成一名司机的误纳。 | 按具体记录核对参赛资格，不能泛化为所有Withdrew都排除；有正圈数退出等边界。只确认Bill Aston局部差异，不声称已唯一恢复所有历史参赛语义。 |
| [local358](#local358) | 局部问题 | population.entity / measure.countGrain内部一致性 | Spec指定user_id为用户键，却又假定每物理行一用户；实际COUNT(*)对320行计数，键只有30个。 | 先解决实体/重复与参考日；缺正式身份定义和PK，不据原Spec反向证明Gold用户定义错。只标内部粒度矛盾。 |

## 3. 逐题原因与证据

以下原题与成功Spec/SQL片段引用自已有卷宗。观察、反事实重现和业务规则分开陈述；“未核验全部Gold”不影响记录已经证实的局部问题。

<a id="local003"></a>
### local003 — 按RFM段平均客户客单价

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`confirmed`；原attempt：`attempt-001`。
- **Gold状态**：`not_certified`。

**原始题目**

> According to the RFM definition document, calculate the average sales per order for each customer within distinct RFM segments, considering only 'delivered' orders. Use the customer unique identifier. Clearly define how to calculate Recency based on the latest purchase timestamp and specify the criteria for classifying RFM segments. The average sales should be computed as the total spend divided by the total number of orders. Please analyze and report the differences in average sales across the RFM segments

**错误原因**：把“先算每客户比率、再在客户段内平均”改为段内SUM金额/SUM订单数。前者客户等权，后者按订单数加权，不是等价公式。

**实际影响与核验**：两边均11行，多个段数值不符；已证聚合拓扑差异，但金额组成与段成员也有未定差异。

**Spec与假设处理中的位置**：两套公式候选只争payment与price+freight，共同预设段级SUM/SUM；正确的客户比率→段AVG不在候选里。

**修复方向及不能越过的结论边界**：修正嵌套聚合；不能宣称仅此即可恢复全部Gold。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local003)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local003/attempts/attempt-001/trace.json` · pointer=`/toolCalls/18/result/details/fields/9`

```text
{"path": "measure.denominator", "status": "assumed", "value": "Total number of delivered orders belonging to the customers of the segment; zero denominator yields NULL.", "rationale": "Request: 'total spend divided by the total number of orders'."}
```

<a id="local015"></a>
### local015 — 摩托车碰撞按头盔组死亡率

- **本文件分类**：核心业务错误：Gold相关内容已核验。
- **原61题主标签**：`confirmed`；原attempt：`attempt-001`。
- **Gold状态**：`verified_relevant_content`。

**原始题目**

> Please calculate the fatality rate for motorcycle collisions, separated by helmet usage. Specifically, calculate two percentages: 1) the percentage of motorcyclist fatalities in collisions where parties (drivers or passengers) were wearing helmets, and 2) the percentage of motorcyclist fatalities in collisions where parties were not wearing helmets. For each group, compute this by dividing the total number of motorcyclist fatalities by the total number of collisions involving that group. Use the parties table to determine helmet usage (from party_safety_equipment fields).

**错误原因**：用头盔标记替代摩托车事故资格，遗漏motorcycle_collision条件，扩大了分母。

**实际影响与核验**：佩戴组23事故/3死亡，实际摩托车组18/3；原13.0435%，限定资格后16.6667%，与Gold16.67%一致。未佩戴5/0应为1/0，均为0%。

**Spec与假设处理中的位置**：成功Spec只有头盔条件，分母明确包含全组可关联事故；没有针对摩托车资格的open候选。SQL实现了不完整Spec。

**修复方向及不能越过的结论边界**：先限定摩托车事故，再按头盔分组计率。长/宽布局仍是独立评分合同问题；两表交集覆盖限制需要披露。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local015)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local015/attempts/attempt-001/trace.json` · pointer=`/toolCalls/22/result/details/fields/2`

```text
{"path": "population.conditions", "status": "assumed", "value": ["组A(helmet used)：碰撞中至少有一方 party 的 party_safety_equipment_1 或 party_safety_equipment_2 取值为 'driver, motorcycle helmet used' 或 'passenger, motorcycle helmet used'", "组B(helmet not used)：碰撞中至少有一方 party 的 party_safety_equipment_1 或 party_safety_equipment_2 取值为 'driver, motorcycle helmet not used' 或 'passenger, motorcycle helmet not used'", "条件作用于碰撞级资格总体（HAVING/EXISTS），不在聚合后过滤"], "rationale": "题面括号注明 drivers or passengers，与设备列中 'driver/passenger, motorcycle helmet used/not used' 四个观测取值一一对应；条件在碰撞级判定，避免 party 级多行影响碰撞计数。"}
```

<a id="local040"></a>
### local040 — 树木收入合并数据Top3区均收入

- **本文件分类**：核心业务错误：Gold相关内容已核验。
- **原61题主标签**：`unresolved`；原attempt：`attempt-001`。
- **后续35题主标签**：`confirmed_semantic_error`。本节只使用其中已证局部发现，不把主标签机械等同整题正确/错误。
- **Gold状态**：`verified_relevant_content`。

**原始题目**

> In the combined dataset that unifies the trees data with the income data by ZIP code, filling missing ZIP values where necessary, which three boroughs, restricted to records with median and mean income both greater than zero and a valid borough name, contain the highest number of trees, and what is the average mean income for each of these three boroughs?

**错误原因**：把树表的每个物理记录当独立树；处理了收入侧ZIP重复，却没有处理树侧完整重复，造成重复实体加权。

**实际影响与核验**：690626行、683788个tree_id，6838条完整重复；实际去重复树实验逐borough重现Gold三个均值。原值偏差约0.499、2.276、3.292，均超过0.01。

**Spec与假设处理中的位置**：已有“树加权还是ZIP等权”和“收入ZIP是否去重”的竞争；共同盲点是树表本身是否一行一树。entity的一行一树写成request，题面不能证明物理唯一性。

**修复方向及不能越过的结论边界**：先确定树身份及重复政策，再形成唯一树集合；不能用AVG(DISTINCT income)替代实体去重。同ID完整重复是同树仍属身份推断，缺已审核版本政策；独立重算首稿也犯了此错。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local040)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[35题独立重算的本题分析](independent-recompute-35/cases/local040/analysis.md)。

[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local040/attempts/attempt-001/trace.json` · pointer=`/toolCalls/33/result/details/fields/0`

```text
{"path": "population.entity", "status": "request", "value": {"name": "individual tree record (one row of the trees table, identified by tree_id/idx); borough is the grouping attribute"}, "evidenceIds": ["evidence_bc723103-31d9-4108-b86c-9bb223938c02"]}
```

<a id="local050"></a>
### local050 — 法国月均预测销售额的中位数

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`unresolved`；原attempt：`attempt-001`。
- **后续35题主标签**：`ambiguous_after_recompute`。本节只使用其中已证局部发现，不把主标签机械等同整题正确/错误。
- **Gold状态**：`not_certified`。

**原始题目**

> What is the median of the average monthly projected sales in USD for France in 2021, calculated by using the monthly sales data from 2019 and 2020 (filtered by promo_total_id=1 and channel_total_id=1), applying the growth rate from 2019 to 2020 to project 2021, converting to USD based on the currency table, and then determining the monthly averages before finding their median?

**错误原因**：任务文档要求月均值先ROUND2，原公式没有表达该中间量化步骤，SQL只舍入最终median；最终精度不能代替中间舍入顺序。

**实际影响与核验**：局部差约0.005，不解释原结果与Gold主体约51.54的差距，不认定它是导致0分的充分原因。

**Spec与假设处理中的位置**：竞争过月/商品的聚合顺序，但公式未表达月均值中间ROUND2；2021商品月资格仍无唯一依据。

**修复方向及不能越过的结论边界**：补文档要求的中间步骤；不得据此把2021实际有销售资格认作已证正确。整题继续保留未裁决。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local050)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[35题独立重算的本题分析](independent-recompute-35/cases/local050/analysis.md)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local050/attempts/attempt-001/trace.json` · pointer=`/toolCalls/16/result/details/fields/13`

```text
{"path": "output", "status": "assumed", "value": {"rowMode": "scalar", "columns": ["median_avg_monthly_projected_sales_usd"], "units": {"median_avg_monthly_projected_sales_usd": "USD"}, "decimals": {"median_avg_monthly_projected_sales_usd": 2}}, "rationale": "The question asks for one median value in USD."}
```

任务文档依据：

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local050/blind.json` · pointer=`/documents/projection_calculation.md/content`

```text
Compute the average projected sales for each month in 2021, adjusting for currency conversion. Round the results to two decimal places.
```

<a id="local059"></a>
### local059 — 各事业部前三硬件产品的整体均值

- **本文件分类**：已证评分合同失配：不等于业务内容错误。
- **原61题主标签**：`confirmed`；原attempt：`attempt-001`。
- **Gold状态**：`not_certified`。

**原始题目**

> For the calendar year 2021, what is the overall average quantity sold of the top three best-selling hardware products (by total quantity sold) in each division?

**错误原因**：输出单一整体均值，Gold要求三事业部的三行；向量长度不兼容是已证评分失配。

**实际影响与核验**：原1行794864.89；Gold3行，分别对应N & S、P & A、PC。

**Spec与假设处理中的位置**：Spec选择标量输出。题面overall average与in each division的范围存在歧义，不能反向将Gold布局认证成唯一业务要求。

**修复方向及不能越过的结论边界**：只确认布局不兼容；产品名称与编码粒度及Gold数值来源未定，改成三行不保证正确。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local059)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local059/attempts/attempt-001/trace.json` · pointer=`/toolCalls/23/result/details/fields/1`

```text
{"path": "population.eligibility", "status": "assumed", "value": "Only products that have at least one sales row in calendar year 2021 are eligible (a product with no 2021 sales cannot be a best-seller by quantity); no zero-fill.", "rationale": "The question ranks best-selling products, which requires observed 2021 sales."}
```

<a id="local060"></a>
### local060 — 合格城市季度产品份额变化

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`confirmed`；原attempt：`attempt-001`。
- **Gold状态**：`not_certified`。

**原始题目**

> In the United States, for Q4 2019 and Q4 2020, first select only those cities where total sales (with no promotions) rose by at least 20% from Q4 2019 to Q4 2020. Among these cities, rank products by their overall sales (still excluding promotions) in those quarters and take the top 20%. Then compute each top product’s share of total sales in Q4 2019 and Q4 2020 and calculate the difference in share from Q4 2019 to Q4 2020, returning the results in descending order of that share change.

**错误原因**：Spec声明pp_difference，SQL却输出未乘100的fraction差；output的fraction声明与公式自身也矛盾。

**实际影响与核验**：四产品名相同，但原0.025503等比例值与Gold百分点不符；乘100仍不能恢复所有数值甚至符号。

**Spec与假设处理中的位置**：成功公式与输出单位内部冲突；分母虽经过候选比较，也没有消除单位矛盾。

**修复方向及不能越过的结论边界**：统一百分点量纲并实现；其余分母、城市筛选及Gold数字仍需核验。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local060)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local060/attempts/attempt-001/trace.json` · pointer=`/toolCalls/4/result/details/outcomes`

```text
[{"path": "population.entity", "status": "applied"}, {"path": "population.eligibility", "status": "applied"}, {"path": "population.conditions", "status": "applied"}, {"path": "population.source", "status": "applied"}, {"path": "population.time", "status": "applied"}, {"path": "population.timeField", "status": "applied"}, {"path": "population.missing", "status": "applied"}, {"path": "population.joinMultiplicity", "status": "applied"}, {"path": "measure.formula", "status": "rejected", "code": "INVALID_REQUEST", "message": "measure.formula has 5 layers; give every layer \"per\" (the grain it is computed on), e.g. avg per country of avg per player of sum per match"}, {"path": "measure.countGrain", "status": "applied"}, {"path": "measure.denominator", "status": "applied"}, {"path": "grouping", "status": "rejected", "code": "EVIDENCE_REJECTED", "message": "request_wording quote was not found verbatim in the original request: \"each top product's share of total sales in Q4 2019 and Q4 2020\""}, {"path": "selection", "status": "rejected", "code": "INVALID_REQUEST", "message": "selection value must be {n, orderBy}"}, {"path": "selection.ties", "status": "applied"}, {"path": "output", "status": "applied"}]
```

<a id="local064"></a>
### local064 — 2020正月末余额人数极值月份均值差

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`unresolved`；原attempt：`attempt-001`。
- **后续35题主标签**：`confirmed_implementation_error`。本节只使用其中已证局部发现，不把主标签机械等同整题正确/错误。
- **Gold状态**：`confirmed_local_conflict`。

**原始题目**

> For each customer and each month of 2020, first calculate the month-end balance by adding all deposit amounts and subtracting all withdrawal amounts that occurred during that specific month. Then determine which month in 2020 has the highest count of customers with a positive month-end balance and which month has the lowest count. For each of these two months, compute the average month-end balance across all customers and provide the difference between these two averages

**错误原因**：题目要求2020各客户各月，SQL只从实际交易取月份，遗漏5—12月，没有落实全年月份集合。

**实际影响与核验**：原最高/最低月取1月和4月，差419.99；按全年且deposit−withdrawal、全500人，最低月均值0，确定差557.704。Gold363.742另有已证冲突。

**Spec与假设处理中的位置**：原Spec声明全年，但population.missing未声明；这是缺期处理没有落到计算实现，不是已竞争并决定排除无交易月。

**修复方向及不能越过的结论边界**：补全年月份；Gold也错，不能把接近363.742作为修复目标。5—12月无交易数据、最低月并列需披露；并列不改变本题零均值差。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local064)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[35题独立重算的本题分析](independent-recompute-35/cases/local064/analysis.md)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local064/attempts/attempt-001/trace.json` · pointer=`/toolCalls/4/result/details/outcomes`

```text
[{"path": "population.entity", "status": "applied"}, {"path": "population.eligibility", "status": "applied"}, {"path": "population.conditions", "status": "applied"}, {"path": "population.source", "status": "applied"}, {"path": "population.time", "status": "applied"}, {"path": "population.timeField", "status": "applied"}, {"path": "measure.formula", "status": "applied"}, {"path": "measure.countGrain", "status": "applied"}, {"path": "measure.denominator", "status": "applied"}, {"path": "grouping", "status": "applied"}, {"path": "selection", "status": "applied"}, {"path": "selection.ties", "status": "applied"}, {"path": "output", "status": "applied"}]
```

<a id="local066"></a>
### local066 — 已送达披萨配料总用量

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`gold_conflict`；原attempt：`attempt-001`。
- **Gold状态**：`confirmed_local_conflict`。

**原始题目**

> Based on our customer pizza order information, summarize the total quantity of each ingredient used in the pizzas we delivered. Output the name and quantity for each ingredient.

**错误原因**：原SQL只展开标准配方，忽略每份订单的exclusions与extras，未计算实际送达披萨的最终配料用量。

**实际影响与核验**：例如原Bacon9；调整加去料的已存探针Bacon12，Gold14。不能用Gold数值指导修复，因为Gold还纳入取消订单。

**Spec与假设处理中的位置**：原主标签为Gold冲突，但已证agent独立忽略加/去料；主标签不能掩盖同题第二种错误。

**修复方向及不能越过的结论边界**：按逐份披萨身份应用排除、追加及重复数量，再限定送达；保留Gold自身送达资格冲突。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local066)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local066/attempts/attempt-001/trace.json` · pointer=`/toolCalls/3/result/details/outcomes`

```text
[{"path": "population.entity", "status": "applied"}, {"path": "population.eligibility", "status": "applied"}, {"path": "population.conditions", "status": "applied"}, {"path": "population.source", "status": "applied"}, {"path": "population.time", "status": "applied"}, {"path": "population.timeField", "status": "applied"}, {"path": "population.missing", "status": "applied"}, {"path": "population.joinMultiplicity", "status": "applied"}, {"path": "measure.formula", "status": "applied"}, {"path": "measure.countGrain", "status": "applied"}, {"path": "grouping", "status": "applied"}, {"path": "selection", "status": "applied"}, {"path": "output", "status": "applied"}]
```

<a id="local156"></a>
### local156 — 地区比特币年度均价与同比

- **本文件分类**：核心业务错误：Gold相关内容已核验。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`verified_relevant_content`。

**原始题目**

> Analyze the annual average purchase price per Bitcoin by region, computed as the total dollar amount spent divided by the total quantity purchased each year, excluding the first year's data for each region. Then, for each year, rank the regions based on these average purchase prices, and calculate the annual percentage change in cost for each region compared to the previous year.

**错误原因**：将“排除首年”解释成同比前的总体过滤；yearly→filt删除2017→LAG，破坏2018所需基线。

**实际影响与核验**：20行结果中5个2018同比为NULL；保留25个实际region-year价格能核验Gold20项均价/同比，例如Africa2018为92.86%。

**Spec与假设处理中的位置**：初始引用排除首年原文，却未声明过滤阶段；最终条件为assumed。已有BTC/ETH范围竞争，两候选均排除首年，未竞争过滤阶段。公式仅年度均价，缺完整同比依赖。

**修复方向及不能越过的结论边界**：先计算LAG及同比，再排除首年展示。行序与排名方向另有未唯一规定的合同问题，不把它们混作确定业务错因。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local156)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local156/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/20/result/details/fields/2`

```text
{"path": "population.conditions", "status": "assumed", "value": ["txn_type='BUY' AND ticker='BTC'（仅比特币资产）；剔除各地区首年（year > 2017）"], "rationale": "题面称 'per Bitcoin'（每枚比特币的买入均价），而数据中 ticker 含 BTC 与 ETH（ETH 为以太坊，非比特币）。观测显示仅取 ticker='BTC' 时各地区各年均价（2017≈$3800–4000、2018≈$7600–8000、2019≈$7300–7700、2020≈$10300–11400、2021≈$44000–45000）与真实比特币年度均价高度吻合；若混入 ETH，均价被稀释至 $2000–33500，不再是比特币价格。故限定 ticker='BTC'，并剔除各地区首年（year > 2017）。"}
```

<a id="local228"></a>
### local228 — IPL前三击球投球按排名配对

- **本文件分类**：已证评分合同失配：不等于业务内容错误。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`verified_relevant_content`。

**原始题目**

> For each IPL season, identify the top three batsmen with the highest total runs scored and the top three bowlers with the most wickets taken, excluding ‘run out’, ‘hit wicket’, and ‘retired hurt’ dismissals. In the event of ties in runs or wickets, break the tie using the smaller player ID. Then output these six players in matched positions—batsman 1 with bowler 1, batsman 2 with bowler 2, and batsman 3 with bowler 3—in ascending order of the season ID, along with each player’s total runs or wickets.

**错误原因**：每赛季三对球员横铺一行，而Gold每个排名配对一行，评分向量长度不同。

**实际影响与核验**：预测9行，Gold27行；原授权CSV离线展开后27条ID、runs、wickets及行关联完全一致。

**Spec与假设处理中的位置**：输出粒度声明为每season一行；不是业务指标或排名算错。

**修复方向及不能越过的结论边界**：这是纯表示/评分合同失配，不计为业务错误。题面没有唯一规定长/宽布局。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local228)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local228/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/4/result/details/fields/1`

```text
{"path": "population.eligibility", "status": "assumed", "value": "Per season, batsman candidates = players with at least one row in batsman_scored as the striker that season; bowler candidates = players with at least one delivery bowled (ball_by_ball.bowler) that season. Zero-run / zero-wicket players never enter the top 3.", "rationale": "题面只要求每赛季得分/夺三柱门最高的三名球员，未规定最低出场门槛；按‘有记录即参与排名’处理，对前3名无影响。"}
```

<a id="local277"></a>
### local277 — 两产品2018季调加权回归年销量均值

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`not_certified`。

**原始题目**

> What is the average forecasted annual sales for products 4160 and 7790 during 2018, using monthly sales data starting from January 2016 for the first 36 months, applying seasonality adjustments from time steps 7 through 30, and employing a weighted regression method to estimate sales?

**错误原因**：题面要求weighted regression，最终公式及SQL却采用无显式权重的OLS。移动平均的平滑权重不是回归权重。

**实际影响与核验**：原460.51，Gold39.39；方法替代已证，但权重、回归对象及Gold完整计算没有核验。

**Spec与假设处理中的位置**：公式显式假定ordinary least-squares，未以合格依据解决weighted要求。

**修复方向及不能越过的结论边界**：明确权重和回归对象；不能以方便实现的OLS替代，也不能声称改成任意WLS即可恢复Gold。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local277)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local277/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/26/result/details/fields/7`

```text
{"path": "measure.formula", "status": "assumed", "value": {"op": "custom", "description": "Classical multiplicative (ratio-to-moving-average) decomposition forecast, per product then averaged. (1) CMA_t = average of the two overlapping 12-month windows t-6..t+5 and t-5..t+6 (2x12 centered moving average), evaluated on time steps t=7..30; (2) ratio_t = qty_t / CMA_t for t=7..30; (3) seasonal index S_m = mean of ratio_t for calendar month m (m=1..12), using only t=7..30; (4) trend line fitted by ordinary least-squares regression of CMA_t on t over t=7..30: CMA = a + b*t; (5) monthly 2018 forecast = (a + b*t) * S_m for t=25..36; (6) product 2018 annual forecast = sum of its 12 monthly forecasts; (7) answer = mean of the two products' annual forecasts."}}
```

<a id="local283"></a>
### local283 — 跨国家联赛每赛季最高积分球队

- **本文件分类**：核心业务错误：Gold相关内容已核验。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`verified_relevant_content`。

**原始题目**

> Analyze the soccer match dataset to determine the champion team for each season across all countries and leagues, awarding 3 points for every win, 1 point for every tie, and 0 points for every loss. For each season, return the champion’s team name, the league, the country, and the total points accumulated.

**错误原因**：将跨所有国家联赛每season选冠军，改为在season-country-league内分别选冠军，扩大最终对象集合。

**实际影响与核验**：预测90行联赛冠军；从现有联赛冠军按season取全局最大，8个冠军身份和积分匹配Gold。

**Spec与假设处理中的位置**：grouping明确假定season、country、league。竞争的是strict88行/include_ties90行，两者都在错误排名域，无法得到8季答案。

**修复方向及不能越过的结论边界**：区分球队积分累计粒度与冠军比较域，按season比较。题面存在联赛冠军背景读法，此处沿用既有审核的跨联赛season口径；Gold额外rank列不属于同一业务错因。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local283)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local283/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/17/result/details/fields/8`

```text
{"path": "grouping", "status": "assumed", "value": ["season", "country", "league"]}
```

<a id="local302"></a>
### local302 — 销售冲击最负的属性类型

- **本文件分类**：核心业务错误：Gold相关内容已核验。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`verified_relevant_content`。

**原始题目**

> Analyze the average percentage change in sales between the 12 weeks before and after June 15, 2020, for each attribute type: region, platform, age band, demographic, and customer type. For each attribute type, calculate the average percentage change in sales across all its attribute values. Identify the attribute type with the highest negative impact on sales and provide its average percentage change in sales.

**错误原因**：题目最终要最负的属性类型，Spec却将selection标为n/a并声明输出五行，用排序替代最终argmin选取。

**实际影响与核验**：预测5行首行demographic,-2.01；Gold1行demographic,-2.008662，数值差0.001338在0.01容差内，未选取导致对象集合不符。

**Spec与假设处理中的位置**：实际竞争过unknown资格，但最终selection=n/a与output5行没有修改；SQL忠实执行错误的交付集合。

**修复方向及不能越过的结论边界**：计算五类后选取最负者，另行声明并列政策；不要把已有平均公式或unknown纳入自动判作本次错因。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local302)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[Gold相关内容按键核对记录](consolidated-review/gold-content-checks.json)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local302/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/17/result/details/fields/11`

```text
{"path": "selection", "status": "not_applicable"}
```

<a id="local311"></a>
### local311 — 车队与最佳车手合并积分历史前三

- **本文件分类**：已证评分合同失配：不等于业务内容错误。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`not_certified`。

**原始题目**

> Which constructors had the top 3 combined points from their best driver and team, and in which years did they achieve them?

**错误原因**：交付只含车队与年份，缺少Gold评分检查的combined_points数值向量。

**实际影响与核验**：三组身份和年份一致，但Gold检查1320/1157/1152；原同口径探索1435/1213/1152，补列仍有数值残差。

**Spec与假设处理中的位置**：题面只问哪些车队和哪些年份，不能说缺积分列必然违反明确题意。

**修复方向及不能越过的结论边界**：已证的是评分合同失配；不能认证Gold积分正确，也不能声称补列就修好整题。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local311)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local311/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/35/result/details/fields/1`

```text
{"path": "population.eligibility", "status": "assumed", "value": "Include every constructor-season present in the data; zero-point constructor-seasons are kept in the population but cannot rank in the top 3"}
```

<a id="local336"></a>
### local336 — 前五圈四类超车次数

- **本文件分类**：已证评分合同失配：不等于业务内容错误。
- **原61题主标签**：`confirmed`；原attempt：`attempt-20261010-154318Z`。
- **Gold状态**：`not_certified`。

**原始题目**

> In the first five laps of the race, how many overtakes occurred in each category—retirements, pit stops, start-related overtakes, and standard on-track passes?

**错误原因**：把R/P/S/T代码改成描述字符串，评分按值比较，不能匹配Gold代码。这不是列名差异。

**实际影响与核验**：R/S/T计数对应1609/2452/3974相同；Pit原3093对Gold3075，还差18。

**Spec与假设处理中的位置**：已证类别值表示失配，不等于业务类别划分错误。

**修复方向及不能越过的结论边界**：规范表示只能消除代码差异；Pit18件残差未定位，不能宣称全部原因已找到。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local336)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local336/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/5/result/details/fields/1`

```text
{"path": "population.eligibility", "status": "assumed", "value": "Every overtake event row with a lap in 1..5 is counted; no zero/null entities added or dropped.", "rationale": "Overtakes are events; there is no zero-activity or empty-entity notion. Rows with lap > 5 are excluded by the condition."}
```

<a id="local354"></a>
### local354 — 1950年代赛季首末参赛车队相同的车手

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`unresolved`；原attempt：`attempt-20261010-154318Z`。
- **后续35题主标签**：`gold_conflict`。本节只使用其中已证局部发现，不把主标签机械等同整题正确/错误。
- **Gold状态**：`confirmed_local_conflict`。

**原始题目**

> Among Formula 1 drivers who raced during the 1950s, which drivers completed a season in that decade with the same constructor in both the first and the last race they participated in, while also taking part in at least two distinct race rounds during that season?

**错误原因**：把results记录存在视为实际参赛，将Bill Aston的非实际参赛记录算入资格，构成一名司机的误纳。

**实际影响与核验**：原104司机，按已调查参赛口径103；Gold仅3人并漏明确合格Farina，另有独立Gold冲突。

**Spec与假设处理中的位置**：Spec声明participation，但将物理results记录等同参赛，未区分DNS/DNQ等非参赛情形。

**修复方向及不能越过的结论边界**：按具体记录核对参赛资格，不能泛化为所有Withdrew都排除；有正圈数退出等边界。只确认Bill Aston局部差异，不声称已唯一恢复所有历史参赛语义。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local354)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[35题独立重算的本题分析](independent-recompute-35/cases/local354/analysis.md)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local354/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/27/result/details/fields/1`

```text
{"path": "population.eligibility", "status": "request", "value": "drivers with at least one race participation in seasons 1950-1959", "evidenceIds": ["evidence_e9872852-b748-47ac-bc91-d62a1e9cc6c0"]}
```

<a id="local358"></a>
### local358 — 用户年龄段人数

- **本文件分类**：已证局部问题：不认证整题Gold。
- **原61题主标签**：`unresolved`；原attempt：`attempt-20261010-154318Z`。
- **后续35题主标签**：`confirmed_implementation_error`。本节只使用其中已证局部发现，不把主标签机械等同整题正确/错误。
- **Gold状态**：`suspected_requires_identity_definition`。

**原始题目**

> How many users are there in each age category (20s, 30s, 40s, 50s, and others)?

**错误原因**：Spec指定user_id为用户键，却又假定每物理行一用户；实际COUNT(*)对320行计数，键只有30个。

**实际影响与核验**：已证自身实体与计数实现不一致；Gold也按320物理行。年龄参考日差异另可重现评分差异，但题面没有唯一参考日。

**Spec与假设处理中的位置**：一行一用户为显式假定，与业务键承诺冲突；不是仅SQL漂移，也不是用户身份获得正式业务认证。

**修复方向及不能越过的结论边界**：先解决实体/重复与参考日；缺正式身份定义和PK，不据原Spec反向证明Gold用户定义错。只标内部粒度矛盾。

**依据与追溯**

[原61题卷宗](fieldtree-wrong118-20261010-analysis.md#local358)；[两轮合并标记与原文证据](consolidated-review/case-markers.jsonl)。

[35题独立重算的本题分析](independent-recompute-35/cases/local358/analysis.md)。

已保存的字段或SQL原文（完整引文定位见下）：

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local358/attempts/attempt-20261010-154318Z/trace.json` · pointer=`/toolCalls/6/result/details/fields/8/value`

```text
按用户实体计数：mst_users 每行代表一名用户，每个用户计 1
```

## 4. 可以从这些题确定的错误模式

1. **字段齐全但要求未覆盖**：015遗漏总体资格，302遗漏最终选取；输出列或字段存在不等于完成题意。
2. **错误计算结构被写进Spec**：003改变聚合层次/权重，156改变过滤阶段，283改变排名范围；不能全部归咎SQL生成。
3. **竞争候选共享盲点**：003的候选都用段SUM/SUM；040调查收入连接与加权却漏树重复；156争币种不争阶段；283争并列不争排名范围。已比较候选不等于覆盖了正确解释。
4. **物理记录误当业务实体/事件**：040树重复、354参赛资格、358一行一用户。需要核对业务身份与实际数据形态，不能仅靠题面给物理唯一性背书。
5. **指定方法、量纲或中间步骤没有兑现**：277把加权回归换成OLS；060百分点与比例矛盾；050遗漏中间舍入。050的局部差异不足以解释主要失分。
6. **完整时间集合未实现**：064只取有交易月，遗漏全年无交易月。
7. **表示合同与业务正确性混淆**：059、228、311、336须单列。228业务内容完整吻合；其他三题仍有数值/定义残差，不能说改布局就全对。

这只是所列题的机制归纳，不是全评测分布或字段树优劣的因果结论。不从模型行为记录推断其不可见的心理原因；Ready、published、字段request/evidence状态也不构成语义正确性保证。

## 5. Gold自身已证局部问题（另列，不当成agent正确）

32题：原主标签14题＋35重算17题＋本次合并补标064。下表复用既有裁决，不重新认证Gold生成SQL或原生成环境。它们与上文agent侧问题可同时成立。

| 题号 | 与本文件agent问题重叠 | Gold局部问题 |
|---|---|---|
| local010 | 否，未据此认定agent正确 | 任务文档要求无向城市对，实际最少箱3对；Gold6是有向两倍。 |
| local049 | 否，未据此认定agent正确 | 同公司ID被关联行重复计数：公司173/3=57.67，重复行179/3=59.67(Gold)。 |
| local064 | 是，双方均有问题 | 全年每月仅deposit−withdrawal且全500客户：唯一均值差557.704，Gold363.742不符；agent也遗漏无交易月份。 |
| local066 | 是，双方均有问题 | Gold包含已取消未送达订单，违反pizzas we delivered；agent还独立忽略加/去料。 |
| local073 | 否，未据此认定agent正确 | 订单10第一披萨无定制，Gold却输出第二披萨的加/去料结果，逐行身份冲突。 |
| local096 | 否，未据此认定agent正确 | Gold把未知演员/性别NULL影片算全女，违反no unknown/unspecified gender。 |
| local098 | 否，未据此认定agent正确 | Gold32585超过当前32127可识别出演者全集；原正确缺口计数28698。 |
| local100 | 否，未据此认定agent正确 | 当前完整合作图二跳且非直接合作者25698，Gold15911与明确完整图要求不兼容。 |
| local114 | 否，未据此认定agent正确 | 明确订单数应为897/2357/2024/1634，Gold9/21/10/10等于代表人数，其他列一致。 |
| local133 | 否，未据此认定agent正确 | 明确至少被排名一次，Gold仍含5个零偏好风格；差值与扩大到25风格平均相容。 |
| local167 | 否，未据此认定agent正确 | Gold含Katie Hill的CA43，但她任期不含任何12-31；有效CA42。 |
| local170 | 否，未据此认定agent正确 | Gold含PI，但当前PI全任期女性0，不可能男女各六期都非零。 |
| local171 | 否，未据此认定agent正确 | Gold可由未要求的1917..1999观察窗重现；合法31年末5人而Gold4，存在遗漏。 |
| local194 | 否，未据此认定agent正确 | 要求每演员Top3，Gold只给3电影；200演员不能被三片最多45人覆盖。 |
| local196 | 否，未据此认定agent正确 | Gold五组后续次数可由付款行数−1重现，而真实租赁数不符；存在5笔rental_id NULL付款。 |
| local220 | 否，未据此认定agent正确 | Gold姓名可由同名合并重现：3个Marcelo胜301、5个Ricardo负163；独立球员赢家不同。 |
| local230 | 否，未据此认定agent正确 | 要求Top4导演，实际有四名各2片；Gold仅3人且电影计数等价类型连接行。 |
| local253 | 否，未据此认定agent正确 | 同一个overall national平均被Gold变为随公司变化的20个值。 |
| local258 | 否，未据此认定agent正确 | 要求each bowler，Gold漏实际投球但零wicket者；其余球数/失分并未全面核验。 |
| local259 | 否，未据此认定agent正确 | 要求each player，Gold漏实际参赛/击球的McCullum/Ponting/Dravid，非未出场歧义。 |
| local263 | 否，未据此认定agent正确 | Gold108/234超过合法模型/状态步骤计数；漏step反事实可重现三倍值，但不证明Gold源码。 |
| local264 | 否，未据此认定agent正确 | 合法同一步regression出现213；漏step反事实增加426跨步重复并重现Gold639。 |
| local270 | 否，未据此认定agent正确 | 根Pallet Mix SG内Bottle500cl两路径600+256=856>500，却被Gold漏掉。 |
| local272 | 否，未据此认定agent正确 | 产品6520需求40；Gold只拣14+12=26，违反需求守恒。 |
| local275 | 否，未据此认定agent正确 | 要求2017每月ratio>2，Gold包含实际零月产品，无法满足forall条件。 |
| local286 | 否，未据此认定agent正确 | Gold额外卖家仅54件/4795.91，却标108件/9591.82并越过>100资格。 |
| local297 | 否，未据此认定agent正确 | 题面仅deposit/withdrawal，Gold36.4数值机制加入purchase等；明确算法结果54.2。 |
| local298 | 否，未据此认定agent正确 | 要求all users的前月正余额总额与Gold不符；排除本月不活跃者的反事实逐月重现Gold。 |
| local299 | 否，未据此认定agent正确 | 同日重复行＋31行窗口反事实精确重现Gold；其第30行仅28/29日，与明确30日要求冲突。 |
| local330 | 否，未据此认定agent正确 | 要求每页唯一会话数，Gold仅/detail一个路径且没有任何计数。 |
| local331 | 否，未据此认定agent正确 | Gold第三页面含END7，但实际没有END页面访问；合成终止不是第三次访问。 |
| local354 | 是，双方均有问题 | Gold仅3司机，漏明确合格Farina；agent另把Bill Aston非参赛记录当两round资格。 |

完整依据见[Gold问题与agent模式合并报告](fieldtree-gold-markers-and-agent-patterns.md#gold-list)。

## 6. 未纳入确定性原因清单的其余15题

local002、local037、local056、local061、local067、local070、local131、local168、local169、local195、local269、local273、local279、local285、local335。

这些题保留原有歧义、候选或未定位结论。已经重现某个数值机制，不足以证明该业务解释正确；不为凑齐61题而指定唯一错因。

### 61题覆盖核对

- agent侧已证局部问题/输出差异：17题。
- Gold已证局部问题：32题，其中064、066、354与上组重叠3题。
- 两组之外仍未裁决：15题。
- **17＋32−3＋15＝61**。

其中“5核心＋8局部＋4输出”的分类为本文件提取视角，不覆盖历史报告主标签。原61报告中的11题“可证差异”全部被保留，没有因为Gold整题未核验而丢弃003、060、277等局部错误。

## 7. 来源与交付边界

- [首次61题报告](fieldtree-wrong118-20261010-analysis.md)及[逐题JSONL](fieldtree-20261010-audit/case-analyses.jsonl)。
- [35题独立重算报告](fieldtree-unresolved35-recompute.md)及各题真实执行、冻结、发布与事后审查记录。
- [两轮合并报告](fieldtree-gold-markers-and-agent-patterns.md)、[61题标记](consolidated-review/case-markers.jsonl)、[Gold内容核对](consolidated-review/gold-content-checks.json)。

本文件只摘录既有证据与诊断结果；不发布新的数据库结果，不改官方Gold、原提交或原分数。040保留实体/重复政策推断限制，283沿用既有跨联赛season审核口径；050、358只记录明确的局部符合性/内部一致性问题，不冒充整题业务已裁决。
