# Spider2 第 5 轮 DeepSeek 86 题：数据与形式错误逐题分析报告

## 1. 审计结论

第 5 轮 `deepseek-chat` 的 86 个失败题按“数据正确性”和“输出形式”拆分如下：

| 分类 | 数量 | 占 86 题 | 说明 |
|---|---:|---:|---|
| 数据正确、形式错误 | **8** | 9.30% | 核心答案值/实体可从提交结果恢复，但行列粒度、方向、排序或额外输出不符合 Gold 合同 |
| 数据与形式均错误 | **63** | 73.26% | 已生成 CSV，但核心数据/业务口径错误，同时最终投影、粒度、列或结果集合也不符合要求 |
| 未交付、数据不可验证 | **15** | 17.44% | timeout/max_turns/未完成导出，不能把结果判为数据正确 |
| 合计 | **86** | 100.00% | |

### 分类口径

- **数据正确**：题目要求的核心实体或数值能够从提交结果中恢复，且差异主要是额外列、额外行、长宽方向、排序或标量/明细形状。
- **形式错误**：包括结果粒度、行列数量、列方向/顺序、额外诊断列、完整排行替代单值，以及未按最终结果投影。
- 如果额外行本身包含未满足条件的实体、额外候选或错误数值，则不归入“形式错误”，而归入“数据与形式均错误”。
- 审计只使用用户问题、业务文档、最终 SQL、工具调用/返回、提交 CSV 和 Gold CSV；不输出隐藏思维链。每题完整可观察调用序列保存在 `C:/data-agent-eval/runs/spider2-local-round5-full-001/analysis/round5-case-audits/`。

## 2. 数据正确但形式错误：8 题

| 题目 | 提交形状 | Gold 形状 | 核心数据证据 | 形式问题 |
|---|---:|---:|---|---|
| `local019` | 3×3 | 1×2 | Bron Breakker、Duke Hudson 与 Gold 一致 | 重复三行并附加 duration；应为一行两列 |
| `local039` | 16×2 | 1×1 | 第一行 Sports 与 Gold 一致 | 把最高类别扩展为完整 16 类排行 |
| `local131` | 25×4 | 20×4 | Gold 的 20 个非零风格记录均可在结果中恢复 | 额外输出 5 个零记录风格 |
| `local156` | 20×5 | 20×5 | 数值集合与 Gold 一致 | 行顺序/列布局与 Gold 合同不一致 |
| `local202` | 10×8 | 1×1 | `qualifies` 列求和为 Gold 的 5 | 导出 Top-10 州诊断表而非最终计数 |
| `local228` | 9×13 | 27×5 | 每季三组球员及数值与 Gold 一致 | 将长表横向透视成每季一行宽表 |
| `local330` | 5×2 | 1×1 | 结果包含 Gold 要求的 `/detail` | 同时导出其他页面和 session count |
| `local335` | 20×2 | 5×1 | Gold 的五个 Top constructor 均出现在结果中 | 未截取 Top 5，保留完整 constructor 排名和计数 |

这 8 题说明“算对了但交付形式错”仍然是独立失败来源，尤其是标量扩展为排行、长表改宽表和诊断明细替代最终指标。

## 3. 数据与形式均错误：63 题逐题查询过程分析

下表是每题完整轨迹的可读摘要；`trace.json`、完整 SQL、每次工具返回和助手可观察文本均在对应审计文件中。

| 题目 | 状态/形状 | 查询过程摘要 | 数据错误与形式错误诊断 | 审计文件 |
|---|---|---|---|---|
| `local002` | max_turns；预测 582x2 / Gold 1x1 | `list_workspace → search_knowledge → read_knowledge → read_file → query_database → run_python → export_query`；5 次 query_database（其中探索成功 1 次）；export_query 1 次；错误：missing_file | 目标/粒度与回归输入错误：将日销售明细作为最终结果；模型尚未完成回归预测就因 max_turns 停止。 | `analysis/round5-case-audits/local002.md` |
| `local003` | completed；预测 11x5 / Gold 11x2 | `search_knowledge → read_knowledge → query_database → export_query`；13 次 query_database（其中探索成功 1 次）；export_query 1 次 | RFM 业务口径错误：完成 RFM 分段后，把“总销售额/总订单数”当作分段结果，且导出 5 列而不是题目要求的分段平均值；最终文件与 Gold 值不符。 | `analysis/round5-case-audits/local003.md` |
| `local007` | completed；预测 1x1 / Gold 1x1 | `read_knowledge → search_knowledge → query_database → export_query`；4 次 query_database；export_query 1 次 | 日期公式错误：按年月日字段分别相减并提前四舍五入，未按题目要求处理日期差；1×1 形状但数值错误。 | `analysis/round5-case-audits/local007.md` |
| `local010` | completed；预测 7x2 / Gold 1x1 | `list_workspace → search_knowledge → read_knowledge → read_file → query_database → export_query`；14 次 query_database（其中探索成功 4 次）；export_query 1 次；错误：query_error | 距离分桶/最终目标错误：算出了完整分布并输出 7 行；没有把“最少桶的数量”锁定为最终标量，且模型选出的结果与 Gold 不符。 | `analysis/round5-case-audits/local010.md` |
| `local015` | max_turns；预测 2x4 / Gold 1x2 | `search_knowledge → read_knowledge → query_database → export_query`；31 次 query_database；export_query 1 次 | 碰撞与伤亡关联口径错误：按 case/party 连接 helmet 与 victim，得到 1/0 fatalities；分子分母事件集合未按题目目标锁定。 | `analysis/round5-case-audits/local015.md` |
| `local017` | completed；预测 6x3 / Gold 1x1 | `query_database → search_knowledge → read_knowledge → export_query`；7 次 query_database（其中探索成功 2 次）；export_query 1 次 | 年度比较逻辑错误：只输出各年 Top-2 原始分布，并据此认定不存在差异；没有构造“与其他年份不同的年份”最终结果。 | `analysis/round5-case-audits/local017.md` |
| `local020` | completed；预测 1x4 / Gold 1x1 | `read_knowledge → search_knowledge → query_database → ask_user_clarification → export_query`；7 次 query_database（其中探索成功 2 次）；export_query 1 次；错误：unknown_tool | 擅自增加业务阈值：先算出低样本投球手，再加入题目未提供的 wickets>=10；最终选择 A Zampa 而非字面结果。 | `analysis/round5-case-audits/local020.md` |
| `local024` | completed；预测 5x2 / Gold 5x2 | `search_knowledge → read_knowledge → list_workspace → query_database → export_query`；4 次 query_database；export_query 1 次 | 球员比赛分母错误：将 player_match 的参赛数与 striker 总跑分直接拼接，分母/球员集合未与实际击球记录严格对齐。 | `analysis/round5-case-audits/local024.md` |
| `local025` | completed；预测 568x5 / Gold 1x1 | `search_knowledge → read_knowledge → query_database → export_query`；14 次 query_database（其中探索成功 1 次）；export_query 2 次；错误：export_not_validated;query_error | 标量任务导出明细且聚合口径错误：先按比赛找最高 over，再导出 568 行比赛明细；没有最终计算所有最高 over 的平均值，且选 over/投手逻辑带入额外假设。 | `analysis/round5-case-audits/local025.md` |
| `local026` | completed；预测 3x6 / Gold 3x2 | `search_knowledge → query_database → read_knowledge → export_query`；17 次 query_database（其中探索成功 3 次）；export_query 1 次；错误：query_error | 结果投影与主键错误：识别出 3 名投手，但输出日期、场馆和队名而非 Gold 所需 match_id/player_name；未按最终列合同投影。 | `analysis/round5-case-audits/local026.md` |
| `local029` | completed；预测 3x5 / Gold 3x3 | `list_workspace → search_knowledge → read_knowledge → query_database → export_query`；2 次 query_database；export_query 1 次 | 支付聚合粒度错误：按客户聚合 order payment 后平均，得到的是客户订单级平均支付；Gold 需要另一种 payment/customer 口径，且输出混入客户 ID。 | `analysis/round5-case-audits/local029.md` |
| `local032` | completed；预测 4x3 / Gold 4x3 | `search_knowledge → read_knowledge → query_database → export_query`；15 次 query_database（其中探索成功 1 次）；export_query 2 次；错误：export_not_validated;query_error | 5-star JOIN/聚合错误：四项 UNION 中前三项可接近目标，但 5-star 通过订单行连接 review，未正确处理 seller-review 关系，得到错误 seller/value。 | `analysis/round5-case-audits/local032.md` |
| `local034` | completed；预测 1x1 / Gold 1x1 | `query_database → search_knowledge → read_knowledge → export_query`；15 次 query_database（其中探索成功 4 次）；export_query 2 次；错误：export_not_validated | 支付计数关联膨胀：把 payment 与 order_items 直接连接后按品类计数，导致一笔支付按商品行重复；平均值 1204.55 偏离 Gold。 | `analysis/round5-case-audits/local034.md` |
| `local035` | completed；预测 1x4 / Gold 1x2|2x1 | `query_database → search_knowledge → read_knowledge → export_query`；10 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated | 城市代表坐标与排序粒度错误：先按城市平均坐标再排序，丢失题目要求的 zip/lat/lng 排序层级；输出城市对和距离也偏离 Gold。 | `analysis/round5-case-audits/local035.md` |
| `local037` | completed；预测 3x2 / Gold 3x2 | `search_knowledge → read_knowledge → query_database → export_query`；9 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated;forbidden_sql | 类别翻译与支付聚合错误：使用英文翻译和 payment/order_items 连接计数，得到英文类别及更高计数；Gold 要求的类别/计数集合不同。 | `analysis/round5-case-audits/local037.md` |
| `local040` | completed；预测 3x3 / Gold 3x2 | `list_workspace → search_knowledge → read_knowledge → read_file → query_database → export_query`；10 次 query_database（其中探索成功 2 次）；export_query 1 次 | 收入 JOIN 权重错误：以树记录粒度直接 JOIN income 并 AVG，得到树加权的收入；Gold 的 borough/mean_income 口径不同，另带出树数量。 | `analysis/round5-case-audits/local040.md` |
| `local050` | completed；预测 1x1 / Gold 1x1 | `read_knowledge → search_knowledge → query_database → run_python → export_query`；21 次 query_database（其中探索成功 1 次）；export_query 1 次 | 投影/过滤口径错误：执行产品×月份 2019/2020 投影并取中位数，但过滤、兑换或零基数处理与 Gold 不同；标量形状正确而数值错误。 | `analysis/round5-case-audits/local050.md` |
| `local055` | completed；预测 1x1 / Gold 1x1 | `query_database → read_knowledge → export_query`；10 次 query_database（其中探索成功 1 次）；export_query 2 次；错误：export_not_validated | 空集合平均值擅自置零：确认最低艺术家没有购买客户后，把空集合平均支出设为 0；题目未授权该规则，导致 5.1333 而非 Gold。 | `analysis/round5-case-audits/local055.md` |
| `local059` | completed；预测 3x2 / Gold 3x2 | `search_knowledge → read_knowledge → query_database → export_query`；11 次 query_database（其中探索成功 2 次）；export_query 1 次 | 时间字段/聚合层级错误：题目明确 calendar year 2021，但模型使用了错误的年度/数据层级，Top-3 平均值整体偏高。 | `analysis/round5-case-audits/local059.md` |
| `local060` | timeout；预测 4x5 / Gold 4x2 | `read_knowledge → search_knowledge → list_workspace → query_database → export_query → read_file`；18 次 query_database（其中探索成功 1 次）；export_query 3 次；错误：export_not_validated | 产品范围与 Top-20% 分母错误：识别出产品维度缺失后改按 products 表子集解释，反复重写 top-20% 与 share 分母；最终明细未按 Gold 标量/列合同收敛。 | `analysis/round5-case-audits/local060.md` |
| `local061` | completed；预测 12x2 / Gold 12x2 | `search_knowledge → read_knowledge → query_database → export_query`；16 次 query_database；export_query 1 次 | 投影公式/零值处理错误：使用 NULLIF/过滤缺失基期产品并直接平均，导致 12 个月数值整体偏离；未逐字锁定 business 文档公式。 | `analysis/round5-case-audits/local061.md` |
| `local062` | completed；预测 10x4 / Gold 10x4 | `read_knowledge → search_knowledge → query_database → export_query`；12 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated | 成本 JOIN 基数错误：按销售键连接 costs 后计算客户利润和十等分区间；结果的 min/max 与 Gold 不同，说明成本记录粒度或客户利润汇总错位。 | `analysis/round5-case-audits/local062.md` |
| `local064` | completed；预测 1x7 / Gold 1x1 | `query_database → search_knowledge → read_knowledge → export_query`；9 次 query_database（其中探索成功 3 次）；export_query 1 次 | 余额定义错误且导出诊断列：算的是每月交易净额/当月平均，而 Gold 要求截至月份 1 日的累计余额；最终虽然 1 行但输出 7 列并且差值错误。 | `analysis/round5-case-audits/local064.md` |
| `local066` | completed；预测 12x2 / Gold 12x2 | `query_database → search_knowledge → read_knowledge → export_query`；11 次 query_database（其中探索成功 1 次）；export_query 2 次；错误：export_not_validated | 比萨配料业务规则错误：主动排除取消订单并计算 exclusions/extras 的净配料量，但题目/Gold 的交付与配方口径不同，12 行数值均偏离。 | `analysis/round5-case-audits/local066.md` |
| `local077` | completed；预测 12x8 / Gold 12x8 | `search_knowledge → query_database → read_knowledge → export_query`；16 次 query_database（其中探索成功 4 次）；export_query 2 次；错误：export_not_validated;query_error | 窗口基线错误：只保留报告期 2018-09 至 2019-08 后做 LAG/rolling，缺少窗口所需历史月份；首月 rolling 从 8.2636 开始而 Gold 从历史基线开始。 | `analysis/round5-case-audits/local077.md` |
| `local097` | completed；预测 1x2 / Gold 1x2 | `query_database → search_knowledge → export_query`；11 次 query_database（其中探索成功 2 次）；export_query 2 次；错误：export_not_validated | 十年窗口计数错误：按 Movie.year 分组后只连接存在年份并使用 year+9，遗漏 Gold 口径下窗口内的影片；start_year 正确但 count 错。 | `analysis/round5-case-audits/local097.md` |
| `local100` | max_turns；预测 1x1 / Gold 1x1 | `list_workspace → search_knowledge → query_database → read_file → export_query`；24 次 query_database（其中探索成功 6 次）；export_query 1 次 | Shahrukh number 图遍历错误：先取与 Shahrukh 直接合作演员，再把其所有影片中的演员整体计入，未准确排除直接邻居/按两跳去重。 | `analysis/round5-case-audits/local100.md` |
| `local114` | completed；预测 4x5 / Gold 4x5 | `query_database → search_knowledge → read_knowledge → export_query`；7 次 query_database（其中探索成功 1 次）；export_query 1 次 | 订单粒度错误：region_stats 直接 COUNT web_orders，却忽略 Gold 的订单/账户去重口径；销售额和 Top rep 能对上，订单数不对。 | `analysis/round5-case-audits/local114.md` |
| `local133` | completed；预测 20x4 / Gold 25x2 | `query_database → search_knowledge → export_query`；7 次 query_database（其中探索成功 3 次）；export_query 1 次 | 加权分数与平均值定义错误：只从 Musical_Preferences 计算分数，未按 Gold 所需的 style 集合/分母和输出列收敛；输出 20×4 而 Gold 为另一结构。 | `analysis/round5-case-audits/local133.md` |
| `local141` | completed；预测 58x5 / Gold 58x6 | `search_knowledge → read_knowledge → query_database → export_query`；12 次 query_database（其中探索成功 2 次）；export_query 1 次 | 销售年度汇总错误：把 SalesOrderHeader subtotal 与季度 quota 直接年聚合，销售数字偏离 Gold；还缺少 SalesQuotaYear 等字段。 | `analysis/round5-case-audits/local141.md` |
| `local167` | completed；预测 54x2 / Gold 1x2 | `read_knowledge → search_knowledge → query_database → export_query`；8 次 query_database；export_query 2 次；错误：export_not_validated | 任期跨 12 月 31 日条件错误：用年份差/结束日期字符串判断覆盖 Dec-31，CA 计为 42 而 Gold 为 43；同时输出全部州而非最高州。 | `analysis/round5-case-audits/local167.md` |
| `local168` | completed；预测 1x2 / Gold 1x1 | `search_knowledge → list_workspace → read_knowledge → query_database → export_query`；10 次 query_database（其中探索成功 1 次）；export_query 1 次 | Top skills 过滤错误：把 qualified postings 与 skills 直接连接后只保留 python/qlik，技能排名和去重后的薪资分母不符合 Gold。 | `analysis/round5-case-audits/local168.md` |
| `local169` | completed；预测 20x4 / Gold 20x2 | `search_knowledge → list_workspace → read_knowledge → query_database → export_query`；9 次 query_database（其中探索成功 2 次）；export_query 1 次；错误：query_error | 留任基准年/观察期错误：把 offset 0–19 的个人首年日期作为观察点并用 term_number=0，Gold 的 period 与 retention denominator 不同。 | `analysis/round5-case-audits/local169.md` |
| `local171` | completed；预测 8x2 / Gold 8x2 | `list_workspace → search_knowledge → read_knowledge → query_database → export_query`；18 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated;query_error | 首次任期与在职判断错误：按 LA 男性最早年份生成 31–49 年区间，但任期覆盖/州条件使人数整体高于 Gold。 | `analysis/round5-case-audits/local171.md` |
| `local194` | completed；预测 600x5 / Gold 3x2 | `read_knowledge → search_knowledge → query_database → export_query`；8 次 query_database（其中探索成功 2 次）；export_query 1 次 | 结果目标粒度错误：按每个 actor 取 Top-3，导出 600 行；Gold 只要求目标 Top-3 记录，模型没有按 benchmark 最终粒度收敛。 | `analysis/round5-case-audits/local194.md` |
| `local195` | completed；预测 1x3 / Gold 1x1 | `search_knowledge → read_knowledge → query_database → export_query`；4 次 query_database（其中探索成功 1 次）；export_query 1 次 | Top-5 演员/客户比例口径错误：找出 5 位演员后按 customer_id 去重计算，但演员排名或租赁关联集合与 Gold 不同，99.17 偏离 99.33；同时带出诊断列。 | `analysis/round5-case-audits/local195.md` |
| `local209` | completed；预测 1x5 / Gold 1x1 | `query_database → search_knowledge → export_query`；8 次 query_database（其中探索成功 2 次）；export_query 2 次；错误：export_not_validated | 比例分子分母/单位错误：找到正确门店和订单数，但把 0–1 比例乘 100 输出为 99.0431，且 Gold 值本身对应不同去重关联口径；输出含额外列。 | `analysis/round5-case-audits/local209.md` |
| `local212` | completed；预测 5x2 / Gold 5x1 | `search_knowledge → read_knowledge → query_database → run_python → export_query`；12 次 query_database（其中探索成功 3 次）；export_query 1 次 | 司机日均定义错误：用 delivery_id/订单日期计算平均，得到前两名后续排序与 Gold 不同，并输出未要求的日均列。 | `analysis/round5-case-audits/local212.md` |
| `local230` | completed；预测 4x2 / Gold 3x2 | `search_knowledge → query_database → read_knowledge → export_query`；9 次 query_database（其中探索成功 2 次）；export_query 1 次；错误：query_error | 导演统计范围错误：先固定 Drama/Action/Comedy，再按 director_mapping 计数；未按 Gold 的类型与电影去重范围计算，数量和 Top-4 均不同。 | `analysis/round5-case-audits/local230.md` |
| `local244` | completed；预测 3x4 / Gold 3x4 | `list_workspace → search_knowledge → read_knowledge → read_file → query_database → export_query`；3 次 query_database；export_query 1 次 | 分类边界/输出字段错误：使用 min/avg、avg/max 中点分类，但边界比较、舍入和收入汇总未与 Gold 一致；同为 3×4 仍有数值错误。 | `analysis/round5-case-audits/local244.md` |
| `local253` | completed；预测 20x4 / Gold 20x4 | `list_workspace → search_knowledge → read_knowledge → query_database → export_query`；19 次 query_database（其中探索成功 2 次）；export_query 1 次 | 薪资清洗规则擅自扩展：除去非数字字符后又自行将 /mo、/hr 年化（hr 使用 1920），改变了题目只要求清洗数值的口径，导致国家均值和 Top-5 偏离。 | `analysis/round5-case-audits/local253.md` |
| `local258` | completed；预测 329x5 / Gold 286x6 | `search_knowledge → list_workspace → read_knowledge → query_database → export_query`；10 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated | 投球统计 JOIN 与最佳表现错误：按 ball 与 wicket 汇总时重复/缺漏，strike/economy/best bowling 与 Gold 不同；输出 329 行而非 286 行且少 player_id。 | `analysis/round5-case-audits/local258.md` |
| `local263` | completed；预测 2x3 / Gold 2x3 | `search_knowledge → read_knowledge → list_workspace → query_database → export_query`；12 次 query_database（其中探索成功 4 次）；export_query 2 次；错误：export_not_validated | 统计表覆盖范围错误：直接将 stack_ok 的 status/L1_model 计数作为全部模型/步骤版本统计，得到 36/78 而 Gold 为 108/234。 | `analysis/round5-case-audits/local263.md` |
| `local264` | completed；预测 2x2 / Gold 1x2 | `search_knowledge → read_knowledge → query_database → export_query`；10 次 query_database（其中探索成功 5 次）；export_query 1 次；错误：query_error | 传统模型与 Stack 计数错误且未取最高项：分别计数后 UNION，再输出 regression/tree 两行；题目只要出现最多的一个类别及总数，且累计数算错。 | `analysis/round5-case-audits/local264.md` |
| `local269` | completed；预测 1x1 / Gold 1x1 | `query_database → search_knowledge → read_knowledge → export_query`；6 次 query_database（其中探索成功 1 次）；export_query 1 次 | 递归展开汇总错误：将所有叶节点路径数量直接 SUM，再平均四个顶层包装；没有按 Gold 的 leaf-level combination 口径计算，946 偏离 530.67。 | `analysis/round5-case-audits/local269.md` |
| `local270` | completed；预测 4x3 / Gold 3x2 | `query_database → search_knowledge → read_knowledge → export_query`；5 次 query_database（其中探索成功 1 次）；export_query 1 次 | 递归筛选条件过宽：识别出 4 个顶层容器并保留 Pallet Mix SG；Gold 只接受 3 个 container-item 对，额外记录使数据集合错误。 | `analysis/round5-case-audits/local270.md` |
| `local272` | completed；预测 5x5 / Gold 4x4 | `list_workspace → search_knowledge → read_knowledge → query_database → export_query`；14 次 query_database；export_query 1 次；错误：query_error | FIFO 累计量/订单行边界错误：按 purchase date、库存量排序分配，前四行接近 Gold，但最后一行把 12 分配成 20/6；另带 order_id 列。 | `analysis/round5-case-audits/local272.md` |
| `local273` | timeout；预测 6x2 / Gold 6x2 | `list_workspace → search_knowledge → read_knowledge → query_database → export_query`；11 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated | Pick percentage 单位错误：计算 picked/required 的 0–1 比例并直接输出，Gold 要百分数 0–100；数值整体少约 100 倍。 | `analysis/round5-case-audits/local273.md` |
| `local275` | completed；预测 10x4 / Gold 4x1 | `list_workspace → search_knowledge → read_knowledge → query_database → read_file → export_query`；13 次 query_database；export_query 3 次；错误：export_not_validated;export_validation;query_error | 筛选条件反转/未取 qualified set：计算每个产品的 min ratio 后导出 10 个诊断候选，结论却写成没有产品；Gold 要 4 个产品名，最终筛选未完成。 | `analysis/round5-case-audits/local275.md` |
| `local279` | completed；预测 2x3 / Gold 2x3 | `query_database → search_knowledge → read_knowledge → export_query`；15 次 query_database（其中探索成功 6 次）；export_query 2 次；错误：export_not_validated;forbidden_sql | 递归库存状态推进错误：以 2019-01 库存直接扣当月销售并选择首月最小差异，未正确从 2018-12 状态逐月推进和取最小差异月份。 | `analysis/round5-case-audits/local279.md` |
| `local283` | completed；预测 88x5 / Gold 8x6 | `query_database → search_knowledge → read_knowledge → export_query`；16 次 query_database（其中探索成功 4 次）；export_query 1 次 | 冠军结果粒度错误：按 league×season 输出 88 个冠军，Gold 的最终投影/条件只保留 8 个结果；未把业务分析结果收窄到 benchmark 目标。 | `analysis/round5-case-audits/local283.md` |
| `local285` | timeout；预测 24x11 / Gold 24x12 | `search_knowledge → list_workspace → query_database → read_knowledge → read_file → export_query`；12 次 query_database（其中探索成功 6 次）；export_query 2 次；错误：export_not_validated;missing_file;query_error | 品类/指标聚合错误：按 item_code 先算价格再汇总交易，销售/损失与品类代码映射不符合 Gold；输出缺少 category_code 且指标值不同。 | `analysis/round5-case-audits/local285.md` |
| `local286` | completed；预测 236x7 / Gold 237x7 | `list_workspace → read_knowledge → search_knowledge → query_database → export_query`；18 次 query_database（其中探索成功 4 次）；export_query 2 次；错误：export_not_validated | 卖家过滤与 packing/review 口径错误：使用非 cancelled/refunded 而非 Gold 的销售条件，并以 approval→carrier 计算 packing；seller 集合、字段和第一条记录均偏离。 | `analysis/round5-case-audits/local286.md` |
| `local297` | completed；预测 1x3 / Gold 1x1 | `query_database → search_knowledge → read_knowledge → export_query`；13 次 query_database（其中探索成功 3 次）；export_query 2 次；错误：export_not_validated | 最新月份增长率定义错误：按客户活跃月累计余额计算并将单月客户排除，得到 51.2%；Gold 的 latest/previous month 与分母处理不同。 | `analysis/round5-case-audits/local297.md` |
| `local298` | completed；预测 3x2 / Gold 3x2 | `search_knowledge → read_knowledge → list_workspace → query_database → export_query`；10 次 query_database（其中探索成功 1 次）；export_query 2 次；错误：export_not_validated | 累计余额日期边界错误：用 txn_date < asof 聚合，但按 customer 的负余额 floor 和 baseline 处理与 Gold 不同，三个月数值均偏离。 | `analysis/round5-case-audits/local298.md` |
| `local301` | completed；预测 3x4 / Gold 3x5 | `query_database → search_knowledge → read_knowledge → export_query`；12 次 query_database（其中探索成功 1 次）；export_query 1 次；错误：query_error | 周窗口边界错误：按 June-15 所在周号取前后 4 周，但 Gold 的 before/after 参考周、包含边界和输出指标不同。 | `analysis/round5-case-audits/local301.md` |
| `local302` | completed；预测 5x3 / Gold 1x2 | `query_database → search_knowledge → read_knowledge → run_python → export_query`；17 次 query_database（其中探索成功 2 次）；export_query 1 次 | 标量目标未收敛且百分比口径错误：算出各 attribute type 的完整表，再输出 demographic；平均值使用 per-value AVG，Gold 要单行指标结果。 | `analysis/round5-case-audits/local302.md` |
| `local311` | completed；预测 3x3 / Gold 3x3 | `search_knowledge → read_knowledge → query_database → export_query`；9 次 query_database（其中探索成功 1 次）；export_query 1 次 | 赛季末积分来源错误：用每年最大 race_id 连接 standings，并把 best driver 与 constructor points 相加；前两年数值高于 Gold。 | `analysis/round5-case-audits/local311.md` |
| `local331` | completed；预测 0x2 / Gold 3x2 | `query_database → search_knowledge → read_knowledge → run_python → list_workspace → export_query`；21 次 query_database（其中探索成功 6 次）；export_query 2 次；错误：export_not_validated | 日志数据源/事件顺序错误：把 access_log 的 stamp 当页面、session 当时间并重建序列，得到空结果；Gold 有三种 third-page 记录。 | `analysis/round5-case-audits/local331.md` |
| `local336` | completed；预测 4x2 / Gold 4x2 | `list_workspace → search_knowledge → read_file → read_knowledge → query_database → export_query`；24 次 query_database（其中探索成功 6 次）；export_query 1 次 | 范围误读为固定 race_id：将题目解释为 race_id=336，直接查该比赛前五圈并得到全 0；Gold 要汇总所有相关 overtakes。 | `analysis/round5-case-audits/local336.md` |
| `local354` | completed；预测 249x4 / Gold 3x1 | `list_workspace → read_file → search_knowledge → query_database → export_query`；13 次 query_database；export_query 1 次；错误：query_error | 车手-赛季与最终车手集合错误：按 driver×season 保留 249 条记录，未按 Gold 的最终 driver_id 集合投影为 3 个结果。 | `analysis/round5-case-audits/local354.md` |
| `local355` | completed；预测 1x2 / Gold 1x2 | `search_knowledge → list_workspace → query_database → read_knowledge → export_query`；10 次 query_database（其中探索成功 2 次）；export_query 2 次；错误：export_not_validated | 缺赛区间与换队连接错误：计算 before/after round 后得到 7.4762/8.619；临近参赛场次和少于三场条件未严格对应 Gold。 | `analysis/round5-case-audits/local355.md` |
| `local358` | completed；预测 5x2 / Gold 5x2 | `search_knowledge → query_database → ask_user_clarification → export_query`；5 次 query_database（其中探索成功 1 次）；export_query 1 次；错误：unknown_tool | 年龄基准日与去重规则错误：自行采用 2016-10-31，并按 user_id 去重；Gold 使用不同记录粒度/年龄定义，5 类人数全部偏离。 | `analysis/round5-case-audits/local358.md` |

### 3.1 过程模式归纳

逐题完整轨迹可以归纳为以下链路：

```text
读取 schema/业务文档
  → 探索样本、Distinct、Count 或候选排名
  → 形成第一个可运行 SQL
  → 因口径、粒度或“完整结果”判断继续重写
  → 导出过宽/过多/错误聚合的结果
```

其中最常见的失效点：

1. **公式或聚合在第一版 CTE 中已经错误**：日期跨度、支付/订单基数、收入/成本 JOIN、窗口边界、库存递归和积分来源。
2. **已有候选结果后没有收敛**：`local002`、`local010`、`local025`、`local064`、`local194`、`local283`、`local302` 等仍把明细、诊断或完整排名作为最终结果。
3. **领域常识覆盖题目原文**：`local020` 增加 wickets 门槛，`local055` 将空集合平均值设为 0，`local253` 自行把小时/月薪年化。
4. **时间/窗口/递归问题反复改写**：`local061`、`local077`、`local097`、`local169`、`local279`、`local301`，最终数值和形式都未稳定。
5. **复杂任务没有交付闭环**：未交付的 15 题单独统计，不把“最后口头说算对”当作已完成数据。

## 4. 未交付、数据不可验证：15 题

```text
local063  local067  local073  local096  local098
local157  local170  local220  local229  local259
local277  local299  local344  local356  local360
```

这些题的完整查询过程也已生成审计文件，但由于没有最终有效 CSV，不能严谨地归为“数据正确但形式错误”或“数据与形式均错误”。

## 5. 审计限制与边界案例

### 5.1 为什么不是把所有形状错误都算作“数据正确、形式错误”

“输出中出现了一个 Gold 值”不等于数据正确。例如：

- `local010` 虽然完整分布中出现了某些正确计数，但模型最终选择的最少区间/目标结果与 Gold 不一致；
- `local270` 包含 Gold 的三个容器-物品对，但额外包含不应出现的容器，属于数据集合错误；
- `local275` 包含部分 Gold 产品名，但同时把不满足条件的产品作为候选导出，属于筛选数据错误；
- `local354` 包含 Gold 的部分 driver ID，但输出了大量不应交付的 driver-season 记录；
- `local194` 的“每个 actor Top-3”与 Gold 的最终三行目标存在结果粒度冲突，不能仅凭出现 Gold 影片名判定数据完整正确。

因此本报告采用保守标准：只有核心结果可完整恢复、且多余内容属于输出合同问题时，才归入 8 题的形式-only 类别。

### 5.2 官方评分与本次分类的关系

Spider2 官方 `exec_result` 比较主要按数据值进行比较，对列名的约束并不等同于产品级 schema 校验；本报告的“形式”是更严格的业务交付合同概念。因此，分类用于工程诊断，不改变官方第 5 轮 `49/135` 的分数。

## 6. 后续改进建议

1. 在首次 `query_database` 前锁定最终行粒度、列白名单、行数/排序和单位；锁定后禁止因“更完整”自行扩展。
2. 对每个最终字段建立“题目原文 → SQL 表达式 → Gold 对照”的逐字段检查，重点覆盖日期差、窗口基线、分子分母、JOIN 基数和空集。
3. 将“最终结果已验证”和“最终 CSV 已交付”分成两个状态；无 CSV 不能报告任务完成。
4. 对 scalar、Top-N、grouped、long/wide 增加运行时 shape/schema 校验，特别是 `local019`、`local202`、`local228`。
5. 对 63 个数据+形式错误题优先处理：先修语义/聚合，再修最终投影；只改提示词不能替代业务口径验证。

## 7. 证据目录

- 运行目录：`C:/data-agent-eval/runs/spider2-local-round5-full-001/`
- 官方评分：`C:/data-agent-eval/runs/spider2-local-round5-full-001/official_score/summary.json`
- 失败题结构化摘要：`C:/data-agent-eval/runs/spider2-local-round5-full-001/analysis/failed-cases.csv`
- 分类结果：`C:/data-agent-eval/runs/spider2-local-round5-full-001/analysis/round5-data-form-classification.csv`
- 逐题完整审计：`C:/data-agent-eval/runs/spider2-local-round5-full-001/analysis/round5-case-audits/`