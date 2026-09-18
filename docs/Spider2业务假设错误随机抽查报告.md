# Spider2 擅自引入业务假设错误：随机抽查报告

## 1. 抽样与核验方法

从第 5 轮 55 个被标记为包含“自行引入口径”可见文本的失败题中，使用固定随机种子 `20260830` 抽取 5 题：

`local010`、`local020`、`local059`、`local228`、`local286`。

核验内容：

1. 阅读每题原始用户请求；
2. 检查每题随附的 `business.md`、`learning.md`、`query_patterns.md` 和 task-specific external knowledge；
3. 检查官方 Gold 资源；
4. 对可执行的 Gold SQL 直接在对应 SQLite 数据库上运行；
5. 对没有 Gold SQL 的题目，根据题目、DDL 和 task-specific 文档独立重算 Gold CSV。

重要事实：这 5 个随机抽样题目均没有 `evaluation_suite/gold/sql/localxxx.sql`，只有 Gold CSV。整个本地 135 题集合也只有 24 个本地 Gold SQL 文件，因此不能把“Gold SQL 是否正确”扩展到所有本地题目；多数本地题只能核验 Gold CSV。

## 2. 随机抽样结果

| 题目 | task-specific 文档 | Gold SQL | Gold CSV 独立核验 | 判断 |
|---|---|---|---|---|
| `local010` | 有，明确给出 Haversine、城市对标准化和平均距离定义 | 无 | 独立计算 7 个距离桶，计数与 Gold 完全一致 | Gold CSV 正确；模型加入了错误的“最小桶”理解/计数结果 |
| `local020` | 无 task-specific external knowledge | 无 | 不设题外门槛时，最低平均值为 AC Gilchrist，和 Gold 完全一致 | Gold CSV 正确；“至少 10 wickets”完全是模型自行添加 |
| `local059` | 无 task-specific external knowledge | 无 | 按 calendar year `date LIKE '2021%'`、各 division 总销量 Top 3 后取平均，3 个 division 均与 Gold 完全一致 | Gold CSV 正确；模型使用了错误的 fiscal-year/聚合口径 |
| `local228` | 无 task-specific external knowledge | 无 | 独立计算每季 Top 3 batsmen/bowlers，27 行 5 列值与 Gold 完全一致 | Gold 数据正确；模型把同样数据改成了 9 行宽表 |
| `local286` | 无 task-specific external knowledge | 无 | 独立重算的第一条 Gold 记录六个字段全部一致；全量结果存在少量数据条件差异，需进一步确认 | Gold 样本有强证据正确，但暂不把本次抽查升级为全量证明 |

### 2.1 local010：文档已定义核心业务，Gold CSV 可复算

题目要求：根据城市对所有航线的平均距离分桶，并找出数量最少的距离范围。

task-specific `haversine_formula.md` 明确定义了：

- Haversine 公式；
- 经纬度转弧度；
- 城市对按字典序标准化，往返视为同一对；
- 多条航线按距离平均。

独立使用 `Airlines.sqlite` 计算得到：

```text
0       92
1000    93
2000    37
3000    20
4000     6
5000     3
6000+    7
```

最小桶为 `5000`，计数为 3；Gold 输出为 `6`，这说明 Gold 的答案是“距离范围内的城市对数量最少的范围”对应的结果值，而不是模型导出的完整分布。模型错误不仅是业务假设，也包含结果目标/粒度理解错误。文档定义了距离业务，但没有替模型决定应输出完整分布还是最小数量；这一点由题目“Then how many pairs...”直接约束为一个标量。

### 2.2 local020：没有文档支持最低 wickets 阈值

题目只有：

> Which bowler has the lowest bowling average per wicket taken?

附带 external knowledge 明确写的是：

```text
No task-specific external knowledge was supplied by Spider2.
```

独立按字面计算：

```text
bowling average = runs conceded / wickets taken
wickets > 0
```

得到：

```text
AC Gilchrist | 0 runs | 1 wicket | 0.0
```

与 Gold CSV 完全一致。模型后来加入 `wickets >= 10`，得到 A Zampa，是没有题目、文档或 Gold SQL 支持的额外业务规则。这个案例可以明确判定为**擅自引入业务假设**，而不是题目或 Gold 错误。

### 2.3 local059：题目本身定义了 calendar year，Gold 与独立重算一致

题目要求：

- calendar year 2021；
- 每个 division；
- 按 total quantity sold 选 Top 3 hardware products；
- 计算这些产品的 overall average quantity sold。

没有 task-specific 文档。根据表结构独立执行：

1. 使用 `hardware_fact_sales_monthly.date` 的 calendar year `2021`；
2. 按 division/product 汇总 `sold_quantity`；
3. 每个 division 取销量最高的 3 个 product；
4. 对三者的销量取平均。

得到：

```text
N & S | 397699.3333333333
P & A | 244691
PC    | 10045.6666666667
```

与 Gold CSV 完全一致。模型输出的：

```text
P & A | 1428869.67
N & S | 877371
PC    | 78354
```

来自不同时间字段/聚合层级的错误，不是 Gold 定义不清造成的。

### 2.4 local228：业务定义正确，输出布局存在隐含 benchmark 约定

题目明确规定：

- 每个 IPL season；
- Top 3 batsmen，按 runs；
- Top 3 bowlers，按 wickets；
- 排除 `run out`、`hit wicket`、`retired hurt`；
- ties 使用更小 player ID；
- batsman 1 配 bowler 1，依此类推。

没有 task-specific 文档。独立计算得到 9 个 season × 3 个位置 = 27 行，且数值与 Gold CSV 全部一致。

Gold 使用长表：

```text
season id,batsman,runs,bowler,wickets
```

模型输出的是 9 行宽表：

```text
season_id,batsman1,b1_runs,bowler1,w1_wkts,...,batsman3,b3_runs,bowler3,w3_wkts
```

这里 Gold 的数值和业务选择是正确的，但题目没有完全明确“长表还是宽表”。因此该题更准确的结论是：

- 不是模型引入了错误业务定义；
- 模型选择了一个自然但不符合 benchmark Gold 的输出布局；
- 这是输出合同/形状错误，不能简单归类为业务口径错误。

### 2.5 local286：Gold 首条记录可独立复算

题目要求卖家绩效报告，包含：

- total sales；
- average item price；
- average review scores；
- packing times；
- 只保留销售数量超过 100 的卖家；
- 使用英文产品类别并标出最高销售量类别。

没有 task-specific 文档。对 Gold 第一条卖家独立计算：

```text
seller_id:          febab0275244b9a49a623f0bd613ca2f
product_cnt:        129
avg_price:          56.3753488372093
total_sales:        7272.42
avg_packing_time:   1.8885301823272955
avg_review_score:   4.263565891472868
highlight_product:  housewares
```

六个字段与 Gold 第一条记录完全一致。全量重算时存在少量 seller 集合/边界差异，说明还需要确认 Gold 对“sold quantity”“packing time”和无效订单的精确实现；但这不足以支持“Gold 错误”的结论。模型第 5 轮失败的主要可见问题仍是输出列命名和最终结果合同偏离。

## 3. Gold SQL 的补充核验

由于随机抽到的 5 个题目均没有 Gold SQL，补充选择有 Gold SQL 的两个相关失败/回归题：`local019` 和 `local039`。

### local019

Gold SQL 在 `WWE.sqlite` 上直接执行成功，结果为：

```text
Bron Breakker | Duke Hudson
```

与 Gold CSV 一致，也符合题目“最短 NXT 比赛、排除 title change、输出两名选手”的要求。模型输出了额外的 duration 列和重复行，属于输出形状/去重错误。

### local039

Gold SQL 在 `Pagila.sqlite` 上直接执行成功，结果为：

```text
Sports
```

与 Gold CSV 一致，也符合题目按城市过滤、按类别累计租赁小时数并取最高类别的要求。模型导出了 16 行完整类别排行，而题目只要求最高类别，属于标量结果扩展错误。

## 4. 抽查结论

本次抽查的证据支持以下判断：

1. **多数“擅自引入业务假设”的错误不是 Gold 错误。** `local020` 是最明确的例子：没有 task-specific 文档，题目也没有最低 wickets 阈值，Gold 直接采用字面口径。
2. **有文档时，文档通常定义的是计算方法，不一定定义最终输出形状。** `local010` 的文档明确 Haversine 和平均距离，但最终只输出最小桶数量仍由题目 wording 决定。
3. **没有 task-specific 文档时，题目原文仍可能已经足够明确。** `local059` 的 calendar year、Top 3 和 division 口径可由题目直接确定，独立重算与 Gold 完全一致。
4. **Gold CSV 与 Gold SQL 不能混为一谈。** 本地 135 题只有 24 个 Gold SQL；其余题目主要通过 Gold CSV 进行执行结果评估。
5. **部分失败不是业务定义错误，而是输出形状错误。** `local228` 的模型数据值与 Gold 相同，但宽表布局不符合 Gold 长表。
6. **当前最需要抑制的是模型的“合理化改写”：** 当题目已经给出直接计算目标时，模型不应因为领域惯例、样本量担忧或“更有意义”而加入题目没有要求的阈值、过滤条件、额外列或结果展开。
