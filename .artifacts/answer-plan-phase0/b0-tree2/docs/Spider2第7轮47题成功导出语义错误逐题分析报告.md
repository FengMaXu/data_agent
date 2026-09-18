# Spider2-Lite 第 7 轮：47 个成功导出但语义错误题目逐题分析

## 1. 范围与证据

- **运行**：`spider2-local-round7-failed86-001`
- **模型**：`deepseek-chat`
- **Agent commit**：`8272462bfe103ec58d671c445c4278385a97d992`
- **范围**：86 题中已经生成 CSV、但 E2E 结果错误的 47 题。
- **证据**：每题的 `result.json`、完整 `trace.json`、模型文字输出、工具调用参数、最终 CSV 与 Gold CSV。
- **边界**：本文仅用于诊断，不把 Gold SQL 或单题规则写入全局 Prompt/Skill；按要求未开展过拟合风险评估与防护。

## 2. 总体结论

1. 这 47 题的共同特征是：模型完成了检索、查询、验证和导出，但最终指标、粒度、边界或输出列仍然错误。
2. 主因分布：语义粒度/Join/递归 21 题；指标/聚合/Ranking 11 题；过滤/日期/窗口 9 题；输出契约 4 题；Schema/方言/Key 2 题。
3. 模型文字输出经常比 SQL 更“自信”：它会声称“已独立验证”“Join 无膨胀”“货币已转换”，但实际验证的只是候选 SQL 自洽，不能证明候选 SQL 符合题意。
4. 47 题共执行 103 次 `export_query`，其中 56 次先被校验拒绝：`EXPORT_SQL_NOT_VALIDATED` 27 次、`JOIN_RECONCILIATION_REQUIRED` 27 次、Shape/参数错误 2 次。保护拦截了流程错误，但没有解决语义错误。
5. 下一步重点应是前置锁定权威实体表、自然键、指标分子/分母、结果粒度、Top-N 分区、时间边界和最终投影，而不是继续叠加单题式 Prompt。

## 3. 查询流程总体统计

- 47 题中 46 题 `completed`，`local258` 虽生成了 CSV，但最终因后续知识库写入超时。
- 平均每题 14.66 turns、21.17 次工具调用、67.1 秒。
- 工具调用：`query_database` 623 次，`search_knowledge` 103 次，`read_knowledge` 94 次，`export_query` 103 次，`run_python` 7 次。
- `reconciliation` 69 次，`verification` 32 次。多数检查只验证了当前 SQL 的行数/总数或候选结果之间的一致性，没有验证题目要求的业务粒度。

## 4. 逐题分析

### local002：玩具销售对称移动平均

- **文字/契约**：模型把“daily sales”解释成每日玩具订单数，并补零形成 606 天序列；随后用 Python 做线性回归。
- **流程**：检索表结构和玩具类别 → 多次日计数查询 → Python 回归 → verification → 第一次导出因 SQL 与最近成功查询不一致被拒 → 重查后导出。
- **结果差异**：预测为 `36.8902341065`，Gold 为 `14334.62114`，均为单值。
- **根因**：把销售金额替换成订单数量，属于指标定义错误；后续回归和验证都建立在错误测量值上。
- **通用改进**：建模前先锁定“sales”的事实列和单位，禁止用 count 代替 amount。

### local003：RFM 分群平均销售

- **文字/契约**：外部 `RFM.md` 读取失败后，模型自行发明 NTILE 五分位和 RFM 映射，并把结果解释为“分组总花费 ÷ 分组订单数”。
- **流程**：RFM 文件读取 `ENOENT` → schema/数据探索 → 窗口函数别名错误 → `WITH ROLLUP` 方言错误 → 多次 reconciliation/verification → 导出校验失败 → 重查并导出。
- **结果差异**：同为 11 行，但模型 `About to Sleep=54.55、Can't Lose Them=429.32`，Gold 对应为 `57.6849、350.8868`。
- **根因**：文档缺失时自行确定分群和平均值粒度；模型计算的是 segment 总花费/总订单，而 Gold 的客户平均聚合口径不同。
- **通用改进**：关键业务定义不可得时不能把推测写成“exact mapping”；必须分别声明客户级、订单级和分群级分母。

### local010：航线城市距离分箱

- **文字/契约**：模型展示了完整七个距离区间，虽然问题最终只问最少区间中的数量。
- **流程**：机场坐标/城市解析 → 距离和分箱查询 → 导出 SQL 不一致 → 导出被 Join reconciliation 拦截 → reconciliation 先出现 `ambiguous column a`，之后重查成功。
- **结果差异**：预测导出 7×2 分箱表，并认为最少区间为 5000、数量 3；Gold 是单值 `6`。
- **根因**：把诊断分布当成最终交付；同时城市去重、平均距离和分箱规则与 Gold 口径不一致。
- **通用改进**：探索分布和最终投影分离；在导出前把“分箱 → argmin → count”压缩为题目要求的最终粒度。

### local015：按头盔使用分组的摩托车死亡率

- **文字/契约**：模型明确写成“摩托车死亡人数 ÷ 该组碰撞数”，得出佩戴 4.12%、未佩戴 7.45%。
- **流程**：头盔字段和值探索 → 多次分组死亡/碰撞查询 → verification 只核对死亡数 → 导出 SQL 不一致 → 重查后导出。
- **结果差异**：预测 2×4（含 fatalities、collision_count、fatality_rate）；Gold 为 1×2，值为 `16.67、0.0`。
- **根因**：把“死亡构成比例”理解成“每次碰撞的死亡率”，分母完全不同；输出粒度也随之错误。
- **通用改进**：对“rate/share of deaths/fatalities per collision”分别写出分子、分母和总体，不能只凭自然语言近似。

### local017：交通事故原因异常年份

- **文字/契约**：问题使用单数“which year”，模型却报告 2018、2020、2021 三年，并声称它们的第二大原因都发生变化。
- **流程**：原因/年份探索 → 分组排名 → 两次 `collision_date` 列错误 → 修正后直接导出 6 行结果。
- **结果差异**：预测 6×3，Gold 为单值 `2001`。
- **根因**：自行定义“与其他年份不同”的异常检测条件，并返回所有匹配年份，没有锁定题目要求的单一比较对象。
- **通用改进**：先确定比较基准和最终基数；当题目要求单值时，不能把中间排名明细直接导出。

### local025：每场比赛最高得分回合平均值

- **文字/契约**：模型主动把 ball-by-ball 中的 568 个 `match_id` 都算入，包括不在 `match` 表中的 419136。
- **流程**：回合得分/追加分探索 → 每场最高回合 → reconciliation/verification → 导出校验和 Join gate 重试 → 导出。
- **结果差异**：预测 `19.4261`，Gold `19.02098951`。
- **根因**：把事实表中存在的孤儿比赛视为权威比赛实体；“每场比赛”的实体集合应锚定 `match` 表。
- **通用改进**：对事实表孤儿键先做 reconciliation，并明确是否纳入权威实体总体。

### local029：交付订单最多的客户

- **文字/契约**：模型按 delivered 订单数排名，并把多条支付记录先合并成订单总支付，再求客户平均订单支付。
- **流程**：客户/订单/支付探索 → 客户级候选查询 → 两次 targeted reconciliation → 导出 SQL 不一致和 Join gate → 重查后导出。
- **结果差异**：预测 3×5，含客户 ID、城市、州、订单数和平均订单支付；Gold 为 3×3，平均值为 `7.07545、2.41077、22.65522`。
- **根因**：模型选择了一个看似合理但不同的客户/订单/支付聚合口径，并加入了未请求字段。
- **通用改进**：排名字段、度量字段、返回字段必须来自同一个答案契约，不能用“合理的业务解释”替换目标聚合。

### local034：各类别最常用支付方式的平均支付次数

- **文字/契约**：模型将“total number of payments”解释为 `SUM(payment_value)`，最终报告金额 `211022.38`。
- **流程**：支付/类别探索 → 类别-支付方式计数 → 金额聚合 → reconciliation → verification → 直接导出；无工具错误。
- **结果差异**：预测 `211022.3797`，Gold 为 `1035.432432`。
- **根因**：把事件次数和金额相混；模型虽然发现了 payment count，但最后选择了 monetary sum。
- **通用改进**：题目要求 count 时，preferred method 的选择和最终平均都必须沿用 count 度量，不能在最终阶段切换到金额。

### local035：按完整排序相邻城市的最大距离

- **文字/契约**：模型先按城市去重，并用每个城市的平均经纬度代表城市；还把异常坐标解释成数据异常。
- **流程**：地理数据探索 → 首行/平均坐标两套距离查询 → Python 交叉核对 → 导出校验失败 → 重查 → 8462 个相邻间隔 reconciliation → 导出。
- **结果差异**：预测一行 `santa cruz do sul`/`santa lucia do piai`/18206.3；Gold 要求 `bom sucesso de itarare` 与 `bom retiro da esperanca`，且包含两个 Gold 输出文件。
- **根因**：忽略题目给出的完整排序键和源行粒度，擅自做城市级去重/代表坐标。
- **通用改进**：题目明确给出排序字段时保留其粒度；不得把“去重城市”当成默认业务实体。

### local037：各类别最常用支付方式的支付数 Top 3

- **文字/契约**：模型把类别翻译成英文，并把支付定义为 distinct `(order_id,payment_sequential)`，以避免订单商品 Join 膨胀。
- **流程**：类别/支付查询 → 原始 Join 膨胀核对（103886 对 117601）→ distinct payment 查询 → reconciliation → 导出。
- **结果差异**：预测英文类别 `bed_bath_table=7565` 等；Gold 使用葡萄牙语类别，数量为 `7540、6874、5904`。
- **根因**：模型同时改变了维度键表示和事实归属/去重规则；“修正 Join 膨胀”未经题目授权。
- **通用改进**：先确定 Gold 所需的自然粒度，再决定是否去重；不要将展示语言转换和事实去重混在一起。

### local040：树数量最多的三个 borough 及平均收入

- **文字/契约**：模型按 ZIP 用 `MAX` 去重收入表，保留树表重复记录，并额外返回 tree_count。
- **流程**：树/收入表计数与重复检查 → borough 聚合 → Join reconciliation → verification → 导出被 gate 拦截 → 重查后导出。
- **结果差异**：预测 3×3，Gold 3×2；平均收入预测 `94029.33/79366.74/73555.19`，Gold 为 `94026.0357/79366.2397/73552.9147`。
- **根因**：未经契约授权压缩收入 Join 侧，并改变最终列与精度；自洽的去重不等于 Gold 口径。
- **通用改进**：Join 侧去重前先确认业务唯一键；明确是返回树数量还是只返回题目要求的收入列。

### local050：法国 2021 月均预测销售额的中位数

- **文字/契约**：模型在产品×月份粒度预测，排除缺少年份的 product-month，先把月均值四舍五入再求中位数，并假设汇率为 1。
- **流程**：初次查询因 `promo_total_id` 列错误失败 → 修正投影查询 → Python 中位数检查 → reconciliation gate → 导出。
- **结果差异**：预测 `2552.69`，Gold `2604.2362912087915`。
- **根因**：投影总体、缺失期处理和中间舍入由模型自行决定；文字声称使用汇率，但最终计算链条并未证明该假设。
- **通用改进**：中间聚合保留全精度；汇率、缺失期和投影公式都必须在最终 SQL 中显式体现。

### local061：法国 2021 各月预测销售额

- **文字/契约**：模型声称完成了美元转换，并明确假设法国 2021 年每月汇率都为 1。
- **流程**：探索/Schema → projection 查询 → `s20.prod_id` reconciliation 错误 → 修正 reconciliation/verification → 两次导出 SQL 校验失败 → 最终导出。
- **结果差异**：预测 12×2，如 1 月 `4054.99`；Gold 1 月 `4120.33`，其余月份也整体不同。
- **根因**：最终 SQL 没有 `currency` Join/转换，文字承诺与 SQL 不一致；“汇率为 1”是未经可靠验证的替代假设。
- **通用改进**：单位转换必须存在于最终 SQL；不能用文字中的假设替代参考维表。

### local063：符合条件产品的销售份额变化

- **文字/契约**：模型找到了 `prod_id=15` 和变化值，但把内部 ID 与诊断指标当成最终答案，没有返回产品名。
- **流程**：美国/季度/城市资格筛选 → 产品排名和份额变化 → 产品名称查询无结果 → reconciliation → 两次导出校验/gate → 导出。
- **结果差异**：预测 `15,-8.999569...`；Gold 是产品名 `Pitching Machine and Batting Cage Combo`。
- **根因**：最终投影停在事实表键，未完成维表解析；输出了未请求的 pp_change。
- **通用改进**：内部键与用户要求的实体分离，最终投影前必须完成名称 Join 并去除诊断列。

### local064：2020 月末余额高低月份差值

- **文字/契约**：模型明确假设“平均余额 across all customers”只包括当月有交易的客户。
- **流程**：交易类型/月末余额/正余额人数查询 → verification → 标量查询 → Shape mismatch（返回了额外中间列）→ 多次 Join gate → 导出。
- **结果差异**：预测 `334.8722848`；Gold `363.742`。
- **根因**：客户总体不同；模型排除了当月无交易、余额为零的客户，导致平均值分母改变。
- **通用改进**：题目写“all customers”时先固定客户总体，再把无交易客户以零/缺失的业务规则明确纳入或排除。

### local066：已交付披萨的配料总量

- **文字/契约**：模型把 delivered 解释为 runner 表 `cancellation IS NULL`，排除了订单 6 和 9，只计算 12 个披萨。
- **流程**：披萨表与清洗订单探索 → JSON 配料展开 → 聚合 → 一次错误 reconciliation（near `.`）→ 修正 reconciliation → 导出。
- **结果差异**：预测 Bacon=12、Mushrooms=11、Chicken=9；Gold 为 Bacon=14、Mushrooms=12、Chicken=11 等。
- **根因**：把清洗后的客户订单记录和 runner 交付状态混为一谈；Gold 总体包含 14 条清洗订单记录。
- **通用改进**：只有题目明确要求时才套 delivery/cancellation 过滤，区分事实表的“订单记录”和“配送状态”。

### local073：披萨订单最终配料字符串

- **文字/契约**：模型生成每订单内的 `ROW_NUMBER()` 作为 row_id，并只导出 row_id、order_id、customer_id、pizza_name、ingredients。
- **流程**：订单/配料/排除/额外配料探索 → JSON 展开 → final query → 导出 SQL 校验失败 → 重查 → reconciliation → 导出。
- **结果差异**：预测 14×5；Gold 14×6，要求 `order_id, customer_id, pizza_id, order_time, original_row_number, toppings`。
- **根因**：合成的 rn 每个订单重置，不能代替源表 `original_row_number`；列和字符串格式也被模型自行改写。
- **通用改进**：保留源身份列和用户指定列；只有契约明确要求时才合成 ID。

### local096：每年纯女性演员电影比例

- **文字/契约**：性别判定和 0–100 百分比定义基本正确，但模型擅自四舍五入到 2 位并使用本地列别名。
- **流程**：Schema/Key 探索 → `TRIM(M_Cast.PID)` Join → 年度聚合 → `NOT EXISTS` reconciliation → 直接导出，无工具错误。
- **结果差异**：行数都为 78，1939 等整数结果一致，但 Gold 保留全精度，例如 2018 为 `1.923076923...`；预测为两位小数。
- **根因**：输出契约错误，而不是主要业务逻辑错误。
- **通用改进**：未要求 rounding 或改名时，保留源精度和评测可见列名。

### local100：Shahrukh number=2 的演员数

- **文字/契约**：模型选定 `nm0451321` 为 Shah Rukh Khan，并因其“没有电影记录”得出 0。
- **流程**：人名和 Cast 查询 → 图关系自连接返回 0 → reconciliation 确认 anchor cast=0 → 导出校验/gate 重试 → 导出。
- **结果差异**：预测 0；Gold `15911`。
- **根因**：`M_Cast.PID` 有前导空格，模型用未清理的 `M_Cast.PID = Person.PID`，导致 anchor 和全部图边消失。
- **通用改进**：关键键 Join 前统一 `TRIM`/规范化，并验证 anchor 的连接数是否合理。

### local114：各区域 Web 销售报告

- **文字/契约**：模型把 `COUNT(o.id)` 作为订单数，且导出 rep_names、top_rep_sales 等五列。
- **流程**：区域/订单/代表查询 → 区域和代表聚合 → reconciliation/verification → 导出 SQL 校验失败和 Join gate → 重查后导出。
- **结果差异**：区域、销售额和最高代表匹配，但预测订单数为 `897、2357、2024、1634`，Gold 的 `total_orders` 为 `9、21、10、10`；列也不同。
- **根因**：订单度量的自然粒度与 Gold 不一致，并把合理的明细字段加入最终投影。
- **通用改进**：每个指标先定义自然键与计数口径，再决定是否需要 distinct；最终只保留契约列。

### local131：音乐风格一至三偏好次数

- **文字/契约**：模型把一至三偏好合并为一个 `TimesAppeared`，并把 25 个风格（含 5 个零出现风格）全部导出。
- **流程**：风格/偏好查询 → 合并计数 → reconciliation 确认 36 条偏好和 25 个风格 → 左连接查询 → 导出重试。
- **结果差异**：预测 25×2；Gold 20×4，分别返回 First/Second/ThirdPreference。
- **根因**：把题目枚举的三个位置折叠成一个指标，并错误选择了观察总体。
- **通用改进**：题目列出多个类别/位置时保留独立度量；明确是否包含零出现维度成员。

### local133：音乐风格加权分数与平均差

- **文字/契约**：模型只对出现过的 20 个风格计算，平均分为 4.05，并导出 WeightedScore 和 ScoreDifference。
- **流程**：偏好查询 → 加权计分 → verification 确认 20 个风格、总分 81、平均 4.05 → reconciliation gate → 导出。
- **结果差异**：预测 20×4；Gold 25×2，未出现风格也在总体中，平均基准为 `81/25=3.24`。
- **根因**：平均值总体错误；Gold 的 `score` 是所有 25 个风格相对 3.24 的绝对差，而不是模型导出的加权分数本身。
- **通用改进**：计算基准平均值前先锁定总体是“所有维度成员”还是“有事实记录成员”。

### local141：销售员年度销售与配额差额

- **文字/契约**：模型把年度销售定义为 `salesorderheader.subtotal`，配额按年度求和，计算 sales−quota。
- **流程**：AdventureWorks Schema/年份/聚合 → sales 与 quota 查询 → reconciliation/verification → final requery → 导出；无工具错误。
- **结果差异**：预测第一行销售 `28926.25`、差额 `-97073.75`；Gold 为销售 `32567.9155`、差额 `-93432.0845`。
- **根因**：配额匹配，但销售事实度量选错；`subtotal` 不是 Gold 年度销售口径。
- **通用改进**：不要因为列名“像销售额”就直接使用；从业务定义确认事实度量和明细粒度。

### local156：各地区年度 Bitcoin 平均购买价

- **文字/契约**：模型用 `quantity × price` 作为花费，排除各地区首年，并按上一年平均价计算涨幅。
- **流程**：Bitcoin Schema/日期/价格探索 → 年度 Join/排名 → `first_year` 列错误 → 修正 → reconciliation/verification → 导出。
- **结果差异**：预测 2018 India 排名 1、8099.14、涨幅 115.28；Gold 2018 Africa 排名 3、7690.71、涨幅 92.86。
- **根因**：年度花费漏掉交易 `percentage_fee`，从而改变所有平均价、排名和同比值。
- **通用改进**：金额度量必须包含业务定义中的费用/调整项，并用独立表达式核对金额。

### local157：Bitcoin 每日成交量变化

- **文字/契约**：模型以窗口内第一天为起点，认为 8 月 1 日没有“区间内前一天”，因此排除 8 月 1。
- **流程**：日期格式探索（先查 ISO 无结果）→ 发现 DD-MM-YYYY → `LAG` 计算 → Python/SQL verification → 导出 SQL 校验重试。
- **结果差异**：预测 18×3，从 BTC 8 月 2 日开始；Gold 20×5，包含 8 月 1 日及 volume、previous_volume、daily_change。
- **根因**：计算窗口缺少展示区间前的历史基线，并且最终投影删掉了用户要求的中间列。
- **通用改进**：计算窗口与展示窗口分离；先读入足够的 lookback，再在最后过滤显示日期。

### local167：首任代表州的女性议员数量

- **文字/契约**：模型认定 CA 为最高州，但输出 42 人。
- **流程**：女性议员/任期查询 → 最早州与 12 月 31 日资格查询 → reconciliation → 一次歧义 verification 失败，之后得到 CA=43 → 导出校验/gate 重试 → 仍导出 42。
- **结果差异**：预测 `CA,42`；Gold `CA,43`。
- **根因**：12 月 31 日任期包含条件或 first-state 资格集合少排了 1 人；模型验证了候选聚合，却没有对最终 qualifying entity set 做逐人核对。
- **通用改进**：对点时状态问题保存实体级资格集合，分别检查“首任州”和“任期跨越日期”，不能只比总数。

### local168：Data Analyst 远程岗位平均薪资

- **文字/契约**：模型先筛 Data Analyst、远程、非空年薪，再在这个子集内找到了 Python/Qlik 两个技能并平均 3 个岗位，结果 106900。
- **流程**：岗位总体和技能频数查询 → 原始技能行 → 薪资聚合 → 导出校验/gate → reconciliation（3 个岗位、总额 320700）→ 导出。
- **结果差异**：预测 `106900`；Gold `101300`。
- **根因**：下游薪资筛选改变了 top-3 skill 的总体；模型将“技能排名总体”和“薪资计算总体”错误地合并。
- **通用改进**：分阶段操作分别声明总体，先锁定 top skills，再将其应用于薪资总体。

### local171：路易斯安那男性议员长期留任

- **文字/契约**：模型把 first term 限定为最早 Louisiana 任期，并逐年独立计数在任议员。
- **流程**：Schema/样本 → `ambiguous id_bioguide` → 候选年份查询 → 两次 reconciliation 别名错误 → verification 列错误 → 另一种 reconciliation 成功 → 导出。
- **结果差异**：预测 31 年为 5、32 年为 4、33 年为 4；Gold 为 4、3、3。
- **根因**：把“每年在任快照”当成独立计数，未按 retained cohort 口径处理；first-term 的州范围也可能被错误限制为 LA。
- **通用改进**：区分 snapshot count 与 cohort retention，先确定 first term 的全局/州范围，再生成 elapsed period。

### local194：每位演员的前三部高收入电影

- **文字/契约**：模型把“for each actor”作为核心粒度，声明每位演员 3 部电影，共 600 行，并计算 actor share/actor average。
- **流程**：Schema 读取路径错误 → 收入/演员数查询 → preview/verification → 导出 SQL 校验失败 → Join gate → reconciliation → 导出。
- **结果差异**：预测 600×6；Gold 是 3×2，仅包含 `YENTL IDAHO、MALTESE HOPE、GIANT TROOPERS`。
- **根因**：Top-3 分区错误：模型做成每演员 Top-3，Gold 是全局 Top-3 电影；同时导出了多余列。
- **通用改进**：写窗口函数前先明确 Top-N 的 partition；最终粒度必须回到题目要求，而非中间最丰富的分析粒度。

### local212：平均每日配送数最高的司机

- **文字/契约**：模型用已交付配送总数 ÷ 司机实际有配送的 distinct days，返回司机和平均值。
- **流程**：配送/订单 Schema → delivered 状态与工作日查询 → final ranking → reconciliation → 导出 SQL 校验/gate → 重查后导出。
- **结果差异**：预测 ID 为 `25651、26223、49258、357、41596`；Gold ID 为 `25651、26223、17457、11063、7615`，且 Gold 只要 driver_id。
- **根因**：平均每日的分母和排名总体与 Gold 不同，并添加了未请求的平均值列。
- **通用改进**：明确分母是实际工作日、全报告日还是其他自然日；Top-N 前先验证排名总体。

### local230：高分电影类型中的导演 Top 4

- **文字/契约**：模型先找 Drama/Action/Comedy，再按导演统计 distinct movie，返回四名导演且都为 2 部。
- **流程**：类型排名 → 导演聚合 → tie 分布/Join 检查 → reconciliation → 导出重试。
- **结果差异**：预测四名、各 2 部；Gold 三名，James Mangold=4、Anthony Russo=3、Joe Russo=3。
- **根因**：电影-类型关系的计数粒度、Top-N 边界和 distinct 处理不一致；模型通过去重压平了应保留的关系。
- **通用改进**：先定义“电影数”是 distinct film 还是 film-genre 关系，再统一 tie/Top-N 规则。

### local253：指定城市公司薪资与全国薪资对比

- **文字/契约**：模型清洗薪资字符串后，计算每城市公司平均薪资，并用一个总体全国平均 `767988.77` 作为每行常数。
- **流程**：DDL/薪资格式探索 → 一次 malformed query → 清洗与城市聚合 → 全国 verification → Pune reconciliation → 导出。
- **结果差异**：两边都是 20×4，但模型全国列每行都是 `767988.77`；Gold 是公司级全国平均，例如 Qwerty 为 `5081882`、XYZ 为 `1510743.5`。
- **根因**：把 company-country comparison 误读为全体记录的一个标量，比较指标粒度不匹配。
- **通用改进**：每一个输出指标都要与输出主体同粒度；“overall”不能自动等于全表单一常数。

### local258：IPL 投球手统计

- **文字/契约**：模型声称统计所有投手、排除非投手出局、只计击球得分，并导出 329 名投手的 5 个字段。
- **流程**：投手/出局类型/额外分探索 → reconciliation 总数 → Malinga verification → final query → 导出校验/gate → 导出后继续写知识时 timeout。
- **结果差异**：预测 329×5，Malinga 143 wickets、strike rate 16.83；Gold 286×6，Malinga 159 wickets、strike rate 15.1383。
- **根因**：出局类型过滤和投手总体与 Gold 不同；`match_perf` 只在出局球上累加跑分，造成 `5-0` 等错误最佳表现；还缺少 player_name 等列。
- **通用改进**：统一定义 credited dismissal、合法球、runs conceded，并在总计和单场最佳表现中复用同一基础集合。

### local263：Stack 模型 strong/soft 的 L1_model 众数

- **文字/契约**：模型直接把 `stack_ok` 的 status/L1_model 行当作一次关联，得到 regression soft=36、strong=78。
- **流程**：Schema/状态/分数抽查 → 分组计数 → 导出校验失败 → Top-1 查询 → 导出。
- **结果差异**：预测 `36、78`；Gold 为 `108、234`。
- **根因**：采用了 derived status 表当前行粒度，没有展开题目要求的 model/name/version/step 关联总体，导致重复次数少算。
- **通用改进**：计数前先声明 canonical occurrence grain；不能默认派生表每行就是一次业务 occurrence。

### local264：跨传统模型与 Stack 的 L1_model 总次数

- **文字/契约**：模型把 `model` 与 `stack_ok` 直接 `UNION ALL`，得到 regression=327。
- **流程**：反复 Schema/workspace 探索 → Python/文件检查 → 两张表分开计数 → UNION → 导出校验重试 → 导出。
- **结果差异**：预测 `327`；Gold `639`。
- **根因**：把相关的源表与派生资格表当成两个可直接相加的总体，既没有定义关系，也没有处理应有倍数。
- **通用改进**：相关表不可无条件 UNION；先选择一个权威发生粒度，明确是否需要展开关联。

### local269：递归包装组合的平均叶节点数量

- **文字/契约**：模型把未被其他包装包含的 531–534 作为 final roots，递归乘数量，四个组合平均为 946。
- **流程**：包装关系查询 → recursive expansion → root/leaf verification → 导出被 reconciliation gate 拦截 → 手工核对四个 root → 导出。
- **结果差异**：预测 `946`；Gold `530.67`。
- **根因**：final combination/root 集合或叶节点聚合层级与 Gold 不同；模型只证明了自己的四个 root 解释。
- **通用改进**：递归前锁定 final/root/leaf 的权威定义，并分别验证 root 数、路径数、叶节点总量和平均分母。

### local270：包装容器中累计数量超过 500 的物品

- **文字/契约**：模型返回四个容器-物品对，并附带 `total_qty`，包括 Pallet Mix SG/Bottle 500cl=856。
- **流程**：包装 Schema/关系查询 → recursive path → top-level/leaf reconciliation → 导出成功。
- **结果差异**：预测 4×3；Gold 3×2，只包含前三个配对。
- **根因**：递归路径/顶层容器总体和 Gold 不同，且把数量诊断字段加入最终投影；reconciliation 只检查了节点集合。
- **通用改进**：递归后按题目定义核对 qualifying pair 集合，最终投影只保留容器名和物品名。

### local272：订单 423 的仓库拣货分配

- **文字/契约**：模型先按产品汇总订单需求 4280=60、6520=40，再按 FEFO 分配；验证只确认产品总量。
- **流程**：订单/库存/购买日期探索 → 仓库 1 库存 → 初次 allocation 空结果 → 正数拣货查询 → verification → 导出被 reconciliation gate 拦截 → 库存可用量 reconciliation → 导出。
- **结果差异**：预测 5 行，6520 分配为 A16=6、A29=14、C13=20；Gold 4 行，6520 为 A29=14、C13=12。
- **根因**：产品级 `SUM(qty)` 抹掉了 order-line 顺序和累计需求；总量正确不代表每条订单线的序列分配正确。
- **通用改进**：保留 order line 序号，逐线计算累计需求，并按每条线检查 picked total 与剩余库存。

### local275：2017 年季节调整销售比持续大于 2 的产品

- **文字/契约**：模型采用两窗口 CMA，并计算每个产品 2017 年最小 ratio，得到“没有产品满足”，随后导出 10 行诊断表。
- **流程**：业务文档/月份范围 → CMA 与 ratio 查询 → verification 得到 0 → 空结果导出因 `expected_row_count=0` 被拒 → 最小 ratio 查询 → reconciliation → 导出诊断结果。
- **结果差异**：预测 10×3，Gold 4×1：Hazy Pink Cloud、Hoppy Crude Oil、Reindeer Fuel、Summer in India。
- **根因**：CMA/ratio 的计算或 qualifying predicate 与 Gold 不同，且把诊断指标替换成了最终合格产品列表。
- **通用改进**：先验证公式、窗口边界和“每月都满足”的布尔条件，再把符合条件的名称投影出来。

### local283：每赛季冠军球队

- **文字/契约**：模型解释为每个 `(league, season)` 一个冠军，解决积分相同的情况后输出 88 行。
- **流程**：联赛/国家/球队查询 → 积分和 goal-difference tie-break → 联赛级 reconciliation/verification → Join gate → 导出。
- **结果差异**：预测 88×5；Gold 8×6，按每个 season 的全局冠军返回，并包含 `season_rank`。
- **根因**：Ranking partition 错误：按联赛-赛季排名，而题目/Gold 的最终粒度是赛季；还漏掉了 season_rank。
- **通用改进**：看到“across all countries and leagues”时先锁定最终 partition 和预期行数，再写窗口排名。

### local297：最近月份余额增长超过 5% 的客户比例

- **文字/契约**：模型排除 purchase，把全体客户的最近月份统一定为 2020-04，并用 April 对 March 计算增长率，得到 26.8%。
- **流程**：交易类型/日期探索 → 月度净额与累计余额 → Python verification 读库失败 → reconciliation → 另一种 SQL verification 仍得到 26.8 → 导出 SQL 校验重试 → 导出。
- **结果差异**：预测 `26.8`；Gold `36.4`。
- **根因**：全局最近月、每客户最近月、交易类型范围和零基准处理没有被独立确认。
- **通用改进**：明确“most recent”是全局还是每实体；把 previous balance=0、purchase 是否纳入等边界写成显式测试。

### local299：客户 30 日滚动平均余额月度汇总

- **文字/契约**：模型选择每个客户首末交易日期之间的 calendar-day 序列，用 30 行窗口，并全局排除 2020-01。
- **流程**：交易/日期/窗口探索 → 一次 aggregate/GROUP BY 错误 → baseline 检查 → final preview → customer 429 Python 核对 → 导出。
- **结果差异**：预测 2020-02/03/04 为 `286194.37、314140.93、170303.97`；Gold 为 `284935.45、312844.32、170334`。
- **根因**：30 calendar days 与 30 observations、每客户 baseline 与全局 baseline、边界余额处理存在差异；单客户核对不足以证明全体边界一致。
- **通用改进**：在窗口题中同时声明观察窗口、自然日窗口和 baseline 粒度，并抽查首尾边界客户。

### local301：6 月 15 日前后四周销售变化

- **文字/契约**：模型选取严格早于/晚于 June 15 的四个周一，并只导出每年百分比。
- **流程**：周数据/日期探索 → `period` 列错误 → 窗口聚合 → reconciliation → verification 返回 NULL → Join reconciliation → 导出。
- **结果差异**：预测 2018=.19、2019=.10、2020=-.47；Gold 2020=-1.15，并且要求 before/after/change/percent/year 五列。
- **根因**：2020 的 after-window 成员与 Gold 不同，且删除了窗口总额和变化量等要求字段。
- **通用改进**：每个年份列出实际纳入的四周日期，再计算 before/after；不要只输出最后一个比率。

### local330：页面作为 landing/exit 的唯一 session 数

- **文字/契约**：模型把所有原始 `path` 都作为独立页面，包括 `/detail/`、`/detail`、空路径和零计数页面。
- **流程**：日志行数/Session/Path 探索 → first/last 相关子查询 → all-path left join → landing/exit reconciliation → self-join verification → 导出 11 行。
- **结果差异**：预测 11×2；Gold 为单值 `/detail`。
- **根因**：没有做业务页面 canonicalization，且将诊断性的全页面分布当成最终结果。
- **通用改进**：先定义页面规范化规则，再确定是否输出所有页面或特定 argmax 结果。

### local336：前五圈各类超车次数

- **文字/契约**：模型把“the race”解释为全数据集所有比赛，并统计 `lap BETWEEN 1 AND 5`，还把 R/P/S/T 翻译成文字。
- **流程**：超车类型/圈数探索 → 1–5 圈聚合 → 总数 verification=11128 → 导出 SQL 校验重试 → 导出。
- **结果差异**：预测 P=3093、R=1609、S=2452、T=3974；Gold P=3075，其余相同，且 Gold 使用原始代码。
- **根因**：P 类的圈边界/事件去重与 Gold 不同，输出还擅自改写了类别值。
- **通用改进**：对 inclusive/exclusive lap boundary 检查边界行；未要求翻译时保留源类别编码。

### local354：1950 年代首尾构造相同的 F1 车手

- **文字/契约**：模型把“任意一个符合条件的赛季”折叠为每位车手一行，返回 104 个姓名。
- **流程**：F1 results/races/constructors 探索 → 车手-赛季候选 → drives/results reconciliation → 多次全量查询 → Join reconciliation → 导出。
- **结果差异**：预测 104×1 `driver_name`；Gold 3×1 `driver_id`：501、554、579。
- **根因**：赛季级资格条件被错误地扩展为十年级车手集合；同时用姓名替换了稳定 ID，且未充分处理多构造商记录。
- **通用改进**：保持 `(driver, season)` 粒度直到最终筛选，再按题目要求投影稳定标识。

### local358：用户年龄段分布

- **文字/契约**：模型自行选择 `2016-11-30` 为年龄基准日，然后分成 20s/30s/40s/50s/others。
- **流程**：用户生日/注册/操作日期探索 → 多次讨论参考日期 → 年龄分组 → 单用户 verification → 导出。
- **结果差异**：预测 20s=88、30s=24、40s=24、50s=56、others=128；Gold 为 16、88、32、32、152。
- **根因**：题目未给 as-of date，模型用数据上下文自行发明日期；年龄分桶对基准日高度敏感。
- **通用改进**：缺少基准日时不能默默选择一个日期；必须寻找业务定义的日期或明确无法消除的歧义。

## 5. 按优先级的改进建议

### P0：修复评分证据链

- 修复 Spider2 evaluator 读取 UTF-8 SQL 时的 GBK 解码失败；本轮 SQL EX 字段不可作为有效模型成绩。
- 对每题生成结构化差异：问题、答案契约、最终 SQL、最终输出、Gold 行列和值差异。

### P1：将语义约束变成前置断言

- **实体**：权威表、自然键、Join 后粒度。
- **指标**：分子、分母、去重键、金额/次数、总体范围。
- **Top-N**：全局还是分区、ties、排序键。
- **时间**：计算 lookback、展示窗口、首月/基准月和边界日期。
- **递归**：root、leaf、路径倍乘、聚合层级。
- **投影**：列名、列数、行数、是否允许诊断字段。

### P1：提高验证的有效性并控制开销

- 相同 SQL hash 不重复做 reconciliation/verification。
- 将“Join 行数检查”升级为自然键唯一性、目标分母和边界值检查。
- 主查询与 verification 不一致时，强制重新审查指标和粒度，不能只选择一个结果继续导出。

### P2：下一轮验证

- 先修复 evaluator，再对相同 86 题集重跑 score，不修改 Gold、不引入单题规则。
- 单独跟踪 21 个语义粒度类、11 个指标聚合类和 9 个时间窗口类，观察哪一类真正改善。
