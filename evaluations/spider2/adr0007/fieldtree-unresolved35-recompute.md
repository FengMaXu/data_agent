# 字段树测评：35道原未定位题的独立数据库重算

> 35题均已实际重算并完成逐题复盘：3题原系统局部错误，17题Gold局部冲突，15题业务解释未唯一裁决（其中12题已复现差异机制）。独立计算在先，Gold核对与原字段审查在后。

**导航**：[逐题索引](#case-index) · [结论与模式](#findings) · [逐题正文](#case-details) · [证据验收](#evidence-review)

## 范围与方法

范围为原审计中35道根因未定位题。实际数据库计算覆盖35/35题，独立答案冻结35/35题，持久化分析35/35题。

每题仅以原题、任务业务文档、正式DDL和数据库形成独立算法，保存自然语言推导、SQL、原始查询结果。独立最终结果生成并发布后不可覆盖冻结，随后读取Gold与原SQL；最后才审查原Spec。原运行、Gold和数据库均未改写。

工具适配器仅承担只读查询授权、任务记账、最终Candidate和Receipt持久化，不作为独立解题方法，不运行原评测模型，不调用其口径建议。当前仓库已删除旧begin/revise，记录采用现行set工具。未配置外部反馈/比较建议、fanout关闭；这些保障不可用，不应宣称通过机器语义认证。

本轮是有较大人工探索预算的离线独立研究，不是原模型、原预算下的重跑，也不是新旧接口A/B。Gold评分仍采用官方逐列比较；吻合不自动证明业务正确，题面约束、业务键与计算不变量另行核对。

## 汇总

| 状态 | 数量 |
|---|---:|
| 重算后仍有歧义 | 15 |
| Gold局部冲突 | 17 |
| 口径错误已定位 | 1 |
| 实现错误已定位 | 2 |

<a id="case-index"></a>
## 逐题索引

| 题目 | 独立答案官方评分 | 归因 | 相关节点（不全是原错误） | 摘要 |
|---|---:|---|---|---|
| [local002](#local002) | 0 | 重算后仍有歧义 | measure.formula（差异相关，非原错误确证） | 常规金额OLS精确复现旧值4340.10，独立件数36.890234；多种缺期/日序实测未匹配Gold14334.62114，未唯一定位 |
| [local010](#local010) | 0 | Gold局部冲突 | population.entity（差异相关，非原错误确证） | 文档要求无向城市对，独立和原SQL均得3；仅改有向城市对得Gold6，各箱全部翻倍 |
| [local037](#local037) | 0 | 重算后仍有歧义 | measure.countGrain（差异相关，非原错误确证） | 独立与原答案一致；Gold三个数完全重现为credit_card DISTINCT订单数，差25/24/19来自同方式多支付事件。未确证事件与订单哪个业务口径唯一正确。 |
| [local040](#local040) | 0 | 口径错误已定位 | population.entity | 原SQL仅去收入重复，未去树自身完整重复；只去6838个重复树行即按borough精确恢复全部Gold均值。独立冻结解也遗漏重复处置，已承认 |
| [local049](#local049) | 0 | Gold局部冲突 | population.entity（差异相关，非原错误确证） | 按公司ID每年20/15/138，总173/3=57.67；重复关联行21/18/140，总179/3=59.67精确Gold，六个ID被重复计入 |
| [local050](#local050) | 0 | 重算后仍有歧义 | population.eligibility（差异相关，非原错误确证） | 独立2552.695，原2552.70；加2021有销量资格并商品预测ROUND2后精确重现Gold2604.2362912087915。2021资格不是题面明确要求；局部原SQL月均值舍入缺失不能解释全部差值。 |
| [local056](#local056) | 0 | 重算后仍有歧义 | population.missing（差异相关，非原错误确证） | 观测月signed赢家HECTOR；日历相邻signed原赢家MICHEAL；观测月ABS复现Gold STEPHEN。两维均影响结果，题面不唯一裁决。 |
| [local061](#local061) | 0 | 重算后仍有歧义 | population.eligibility（差异相关，非原错误确证） | 独立与原12月完全一致；新增2021有实际销售商品月资格逐month键精确重现全部Gold。2021资格并非题面明确，文档只明确收集目标年销售。 |
| [local064](#local064) | 0 | 实现错误已定位 | population.missing | 原SQL遗漏全年无交易月份；Gold精确匹配扣purchase且仅观测月份的当月净额，但违背题面明示交易类型，不能把全部失分归于SQL遗漏。 |
| [local067](#local067) | 0 | 重算后仍有歧义 | grouping（差异相关，非原错误确证） | 仅利润NTILE排序ASC改DESC逐bucket键精确重现全部Gold；68名客户余数分配端改变，不是纯层号反转。同额次序影响成员但不改变MAX/MIN，非本题失分原因。题面没有排序方向规则。 |
| [local070](#local070) | 1 | 重算后仍有歧义 | selection（差异相关，非原错误确证） | 全部失分可数值定位为同日代表城规则：原SQL MIN(city_name)，独立最小city_id与Gold按日期关联全匹配。题面未指定规则，不能将原假定判为确证业务错误。 |
| [local096](#local096) | 0 | Gold局部冲突 | population.eligibility（差异相关，非原错误确证） | 按题面排除未知性别实算仅4部全女影片；Gold额外计入2009/2012无可识别演员、2018演员性别NULL的3部影片。忽略NULL反事实逐年精确重现Gold，原SQL处理NULL正确。 |
| [local098](#local098) | 0 | Gold局部冲突 | population.eligibility（差异相关，非原错误确证） | 相邻出演年差≤4确实等价最多3缺年；原28698正确实现。当前全库只有32127可识别出演者，Gold32585超过全集上界。独立初稿误计1个NULL身份，冻结保留并另发布修正28698。 |
| [local100](#local100) | 0 | Gold局部冲突 | population.eligibility（差异相关，非原错误确证） | 独立合作图集合计算25698，与原SQL实跑一致；源身份1、直接合作者2382、两步内28081，排除source/一跳得到25698。Gold15911与当前完整图不兼容，隐藏子集或历史数据原因未知。 |
| [local131](#local131) | 0 | 重算后仍有歧义 | population.eligibility（差异相关，非原错误确证） | 25 vs 20 rows entirely explained by five zero styles; all 20 keyed counts identical |
| [local167](#local167) | 0 | Gold局部冲突 | population.conditions（差异相关，非原错误确证） | CA首州女性43人中Katie Hill唯一任期2019-01-03..2019-11-03，不含任何12-31；闭/开区间均42，原与独立相同；Gold43等于未筛全部女性。 |
| [local168](#local168) | 0 | 重算后仍有歧义 | population.conditions（差异相关，非原错误确证） | Gold101300精确等于短标题类别下仅具名python/qlik两种技能均薪的等权平均；原完整标题、未知ID技能排名、岗位等权三处选择均可见，业务不能唯一裁决 |
| [local169](#local169) | 0 | 重算后仍有歧义 | population.time（差异相关，非原错误确证） | 真实重算固定cohort4033；原年历1..20、独立0..19、开端点/删失/浮点周年/年度重叠/周年快照均不能解释Gold全部20值；Gold分母可还原4033但分子仍未唯一定位。 |
| [local171](#local171) | 0 | Gold局部冲突 | population.time（差异相关，非原错误确证） | Gold全部8行等于将有效年末限定在日期维表1917..1999。原6/5/5/5/4/2/1/1，独立首次州5/4/4/4/3/1/1/1；单加观测删失可完全复现Gold4/3/3/3/2/1/1/1，但题面无该年代限制。 |
| [local196](#local196) | 0 | Gold局部冲突 | measure.countGrain（差异相关，非原错误确证） | 独立与原均按真实rental数减1；Gold五组后续租赁均值精确等于payment记录数减1，其中5条payment.rental_id为NULL。Gold把无租赁关联付款当租赁，局部计数冲突已实证。 |
| [local220](#local220) | 0 | Gold局部冲突 | population.entity（差异相关，非原错误确证） | 按独立球员身份，胜场最高Cristiano Ronaldo 199、负场最高Gorka Iraizoz Moreno 107；Gold恰对应把3个Marcelo与5个Ricardo身份合并后的姓名极值301/163。 |
| [local263](#local263) | 0 | Gold局部冲突 | measure.countGrain（差异相关，非原错误确证） | 独立模型级次数21/37与原一致；同一步状态实际步数36/78；漏step关联model产生108/234精确复现Gold。Gold次数超过所有regression模型/状态步数，存在可确证局部关联放大。 |
| [local264](#local264) | 0 | Gold局部冲突 | population.joinMultiplicity（差异相关，非原错误确证） | 独立所有可比较步骤中regression213次；原直接model计行同为213；Gold639可由漏step关联产生，426行跨步重复已实查。 |
| [local269](#local269) | 0 | 重算后仍有歧义 | population.entity（差异相关，非原错误确证） | 946 independently validated; Gold530.67 exactly reproduced by cross-root DISTINCT(leaf,quantity) then leaf mean, losing a repeated600; Gold algorithm not uniquely known |
| [local273](#local273) | 0 | 重算后仍有歧义 | population.entity（差异相关，非原错误确证） | Exact Gold vector reproduced using pick / total allocated per inventory, versus original order-line fulfillment and independent pick / original inventory; original aggregate loses location event grain |
| [local279](#local279) | 0 | 重算后仍有歧义 | measure.formula（差异相关，非原错误确证） | Independent=original; Gold differences are dates, not abs values. 168 actually computed alternative recurrence/initialization/metric scenarios cannot reproduce both Gold tuples; tie-only explanation disproved |
| [local285](#local285) | 0 | 重算后仍有歧义 | population.conditions（差异相关，非原错误确证） | 已按年分类重建Gold全部数值签名：sale-only、逐交易加权价格/损耗率均值、先四舍五入平均率再乘成本、利润扣损耗。原SQL采用净退货、报价均值、SKU率均值及利润不扣损耗；无业务定义不能把Gold偏好判为唯一语义。 |
| [local286](#local286) | 0 | Gold局部冲突 | population.eligibility（差异相关，非原错误确证） | 独立与原资格均236卖家；Gold237中额外卖家实际仅54商品、4795.91销售额，却标108件和9591.82，严格>100资格冲突。其余评分/包装时间定义差异已计算但不能唯一裁决。 |
| [local297](#local297) | 0 | Gold局部冲突 | population.conditions（差异相关，非原错误确证） | 独立与原均54.2%=271/500；Gold36.4可精确重建为purchase负额+ABS前额+首次NULL不回退。Gold数值签名违反明确deposit/withdrawal范围；不能仅以Gold评价原条件错误。 |
| [local298](#local298) | 0 | Gold局部冲突 | population.eligibility（差异相关，非原错误确证） | Gold三行精确等于完整前月总额扣掉当前月不活跃客户的正余额（23016/20906/107824），违反all users；独立与原结果一致，负截断阶段非错误源。 |
| [local299](#local299) | 0 | Gold局部冲突 | population.joinMultiplicity（差异相关，非原错误确证） | Gold三个月精确匹配客户末交易日截止+同日重复交易未去重+31行窗口第30行生效，违反daily/30 days；原30日窗口正确，独立与原差为未定义的历史终点。 |
| [local331](#local331) | 0 | Gold局部冲突 | population.entity（差异相关，非原错误确证） | Gold adds synthetic END7 with no actual page visit; COALESCE missing third event exactly reproduces all Gold top3, displacing legitimate /detail/1 |
| [local335](#local335) | 0 | 重算后仍有歧义 | population.entity（差异相关，非原错误确证） | 独立全车手赛季积分+同年实际参赛归属：Williams6/ToroRosso5/Sauber3/Minardi3/Jordan2；原同口径按姓名裁决第五为Arrows。两种不同改变均重现Gold名称集合：仅得分车队归属，或按车手×车队赛季积分比较，再按名称裁决。不能唯一定位Gold隐含口径。 |
| [local354](#local354) | 0 | Gold局部冲突 | population.eligibility | 独立实际参赛103司机、原任意results104；Gold仅3IDs。Farina642等明确满足两端同队>=2round且Gold遗漏，确证局部Gold冲突。原额外BillAston将DNS/DNQ/Withdrew当参赛构成独立确认的资格语义错误；不能解释全部失分。 |
| [local358](#local358) | 0 | 实现错误已定位 | measure.countGrain | 原Spec以user_id为用户键但COUNT(*)实际重复320行而非30用户，局部计数实体错误确证。全部原-Gold失分另由参考日差异可复现：按raw行年龄在2024-04-07..2024-10-22全匹配Gold；题面无权威参考日，不能唯一判定日期错误。 |

<a id="findings"></a>
## 重算后的结论：不能再把这35题都叫“原因不明”

35题均已实际访问数据库，保留独立题解、执行SQL、原始返回、最终Candidate/CSV/Receipt及冻结。**完成调查不等于35题都独立答对，也不等于35题都找到唯一业务定义。**

| 最终互斥分组 | 数量 | 含义 |
|---|---:|---|
| 原系统局部错误已证 | 3 | 040重复树身份/权重；064全年月份遗漏；358用户计数矛盾。是否解释全部失分逐题区分 |
| 本次Gold与明确要求或输入存在局部冲突 | 17 | 只能裁决具体冲突，不能证明原系统整题正确；354同时有原参赛资格错误 |
| 实测后业务解释仍未唯一裁决 | 15 | 其中12题已定位可复现的差异机制，3题仍未唯一恢复完整机制 |

- **12题“数值机制已找到，但不能唯一判定业务对错”**：037、050、056、061、067、070、131、168、269、273、285、335。例如067只改NTILE方向就全部恢复Gold，但题面没指定方向；070最小city_id选代表记录与Gold逐日期完全一致，但题面没规定代表规则。这不是没有分析，而是不能把标尺偏好冒充用户意图。
- **3题“实际实验后仍未完整恢复机制”**：002回归、169留存、279库存递归。已保存多个真实候选与反例，不能在没有共同解释全部值的情况下强定根因。
- **原系统可证局部问题共4题**（非互斥计数）：040、064、358，加上主要分组归Gold冲突的354。050还有中间舍入与文档的局部差异，但不足以解释主体失分，不混进整题确证计数。
- 独立初次冻结的官方分为**1/35**（070）。这是重算答案与当前Gold合同的吻合率，不是人工业务正确率，更不是字段树的新测评准确率。35题本来就是筛选的原错题。
- **独立解题自己也出错**：040冻结解未处理树/收入重复；098首稿把NULL PID合并成1个演员。两者明确披露，098保留首冻并另发布修正28698。不能因为由人工重新解题就自称权威。

### 模式一：数据身份事实要核查，声明业务键还不够

040实际690626行/683788树身份，完整重复6838行；358实际320行/30用户，生日对每用户相同。原字段已经写实体、键、计数粒度，仍存在“一行一实体”的错误前提或内部矛盾。需要键基数/完整重复检测、字段间一致性核查；不是再加一个要求填的字段就够了。040的独立解也犯同错，说明问题不是旧/新接口独有。

### 模式二：时间范围与计算支撑集合是两件事

064写全年2020不代表SQL生成12个月；只GROUP BY现有交易会丢掉8个无交易月。299需要客户日先归并再真正30个日历日，30行不能替代30天；169、279的周期/状态顺序则仍需更明确业务定义。检查点应覆盖“计算前保留哪些支撑期、补哪些缺期、在哪一步截断”，不能只看时间字段是否有值。

### 模式三：Gold可以隐藏资格、粒度或错误实现

096未知性别被计入全女；196无rental_id的5笔付款被当租赁；286只有54件的卖家被标108件并越过>100资格；331没有实际访问却多出END第三页。263/264跨step连接、299重复日与31行窗口有真实反事实重建。这些发现支持复审标准，而不是让模型学会复制放大、凭空补事件。重建只证明足以产生相同数值，**不证明Gold源码或原生成数据库版本**。

### 模式四：不少“错误”其实是已声明但未确证的解释

支付事件vs订单、十分位方向、每日代表记录、零风格资格、packing起点、百分比分母、转队积分归属，在原Spec中多数可见。业务文字没有唯一规则时，不能把Gold偏好的另一个解释统一标成“假定错”或“待定后决定错”。应记录“差异机制已定位/意图未裁决”，补业务定义，而不是为满足分类强写节点错误。

### 对字段方案的具体意义

1. **没有新增“树外”节点的确证需求。** 当前问题可以落到身份/资格/缺期、计数粒度、公式、分组、选取和输出；不能据35题证明整棵树无缺口。
2. **优先强化校验，而不是扩大字段数量**：实体键与行粒度一致性、source物理重复事实、完整日历集合、步骤/事件连接键、指定方法及内部舍入阶段。
3. **保留可见不确定性**：显式假定和未证决定不等于标准业务事实；用户不可澄清时披露，不通过试Gold数值把假定伪认证。
4. **评测先清理标尺**：17个局部Gold冲突需独立裁决，不能直接加到判对数，也不能据此断言模型17题全对。
5. **仍不能给新旧接口的因果胜负**：本轮是人工多次验证研究，不是相同模型/预算的七槽位对字段树A/B。

### 最后才做的35题字段审查

下表“相关节点”不全是确证错误节点：Gold问题标Gold相关位置，未裁决题只标候选位置；不会把它们冒充原系统最早分叉。原Spec是否声明由实际成功set返回的最终字段表核查，不从模型调用参数或思考文本推断。

| 题 | 相关节点 | 原节点状态 | 错误层/裁决 | 可见性与边界 |
|---|---|---|---|---|
| local002 | `measure.formula` | request | 未唯一裁决 | 金额/件数、缺期及回归输入定义仍未唯一确定；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local010 | `population.entity` | assumed | 标准答案与本次输入/明确要求局部冲突 | 业务文档明确无向城市对；原声明与SQL符合，Gold方向变体翻倍；不适用：未确认原Spec语义错误 |
| local037 | `measure.countGrain` | assumed | 未唯一裁决 | 支付事件与支付订单数，原明确事件口径；不能仅据Gold判错；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local040 | `population.entity` | request | 口径错（物理行等同树实体的假定） | 明确记录一行一树，但实际6838完整重复行；实体权重前提错；假定错 |
| local049 | `population.entity` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold重复公司ID的关联行，原按公司身份去重；不适用：未确认原Spec语义错误 |
| local050 | `population.eligibility` | assumed | 未唯一裁决 | 2021商品月资格没有唯一依据；月均值舍入步骤另有局部差异；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local056 | `population.missing` | assumed | 未唯一裁决 | 先发生缺月/相邻观测解释差异，随后金额差正负/绝对值；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local061 | `population.eligibility` | evidence | 未唯一裁决 | 仅历史成对商品月还是要求目标年可见，声明可见但意图未裁决；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local064 | `population.missing` | undeclared | 实现错（全年月份未落实） | 原要求各客户各月，但SQL月集合只来自现有交易，没有全年月份脊；不适用：实现层；另记population.missing未声明 |
| local067 | `grouping` | decided | 未唯一裁决 | 十分位排序方向改变余数分配与各层边界，题面未指定；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local070 | `selection` | assumed | 未唯一裁决 | 同日唯一代表城市选法，原MIN名称与独立最小ID均为额外解释；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local096 | `population.eligibility` | decided | 标准答案与本次输入/明确要求局部冲突 | Gold接受未知演员/性别NULL；原明确排除未知性别；不适用：未确认原Spec语义错误 |
| local098 | `population.eligibility` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold32585超过当前32127可识别出演者全集；原缺口规则正确；不适用：未确认原Spec语义错误 |
| local100 | `population.eligibility` | request | 标准答案与本次输入/明确要求局部冲突 | 当前完整二跳图25698；Gold隐藏子集/历史数据机制未知；不适用：未确认原Spec语义错误 |
| local131 | `population.eligibility` | request | 未唯一裁决 | 五个全零风格是否展示，原声明全集；标准SQL额外非零过滤；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local167 | `population.conditions` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold含不跨任何年末的Katie Hill；原年末资格筛选正确；不适用：未确认原Spec语义错误 |
| local168 | `population.conditions` | decided | 未唯一裁决 | 职位范围先分叉，随后具名技能/未知技能、排名并列及薪资权重；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local169 | `population.time` | decided | 未唯一裁决 | 周期起点、观察窗口和任期端点候选仍不能解释全部Gold；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local171 | `population.time` | request | 标准答案与本次输入/明确要求局部冲突 | Gold额外限制1917..1999年末观察窗，题面未要求；LA州锚另有歧义；不适用：未确认原Spec语义错误 |
| local196 | `measure.countGrain` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold把五笔无关联付款计成租赁；原公式/SQL计真实rental；不适用：未确认原Spec语义错误 |
| local220 | `population.entity` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold可由同名不同球员合并重现；原player身份计数正确；不适用：未确认原Spec语义错误 |
| local263 | `measure.countGrain` | decided | 标准答案与本次输入/明确要求局部冲突 | 模型/步骤仍有文字歧义，但Gold还跨step关联放大；非原已证错误；不适用：未确认原Spec语义错误 |
| local264 | `population.joinMultiplicity` | undeclared | 标准答案与本次输入/明确要求局部冲突 | 漏step连接639含426跨步重复；原213未出现此放大；不适用：未确认原Spec语义错误 |
| local269 | `population.entity` | assumed | 未唯一裁决 | 最终包装组合是根/路径/根叶还是跨根唯一叶数量，未定义；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local273 | `population.entity` | assumed | 未唯一裁决 | 订单行/库存/实际分配事件单位先分叉；pick百分比分母未规定；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local279 | `measure.formula` | assumed | 未唯一裁决 | 递归补货时点/初始状态候选未唯一确定，单纯并列解释已被排除；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local285 | `population.conditions` | request | 未唯一裁决 | 净退货还是sale-only先分叉，随后价格与损耗权重、利润公式；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local286 | `population.eligibility` | request | 标准答案与本次输入/明确要求局部冲突 | Gold额外卖家实际54件，违反严格>100；评分/packing定义另未裁决；不适用：未确认原Spec语义错误 |
| local297 | `population.conditions` | request | 标准答案与本次输入/明确要求局部冲突 | Gold重建纳入purchase，与明确deposits/withdrawals范围冲突；不适用：未确认原Spec语义错误 |
| local298 | `population.eligibility` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold遗漏本月不活跃用户的前月正余额，违反all users；不适用：未确认原Spec语义错误 |
| local299 | `population.joinMultiplicity` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold重建重复客户日行，随后31行窗口；原30日已正确；不适用：未确认原Spec语义错误 |
| local331 | `population.entity` | assumed | 标准答案与本次输入/明确要求局部冲突 | Gold多出无实际第三页访问的合成END事件；不适用：未确认原Spec语义错误 |
| local335 | `population.entity` | request | 未唯一裁决 | 赛季车手积分归属及转队处理至少两种机制都重现Gold，未唯一裁决；不能标成假定错/决定错：原声明可见，不等于业务错误已证 |
| local354 | `population.eligibility` | request | 口径错（参赛资格）＋标准局部冲突 | 原误把DNS/DNQ/withdrawal视为真实参赛，Gold另遗漏明确合格Farina；假定错：results记录等同实际参赛 |
| local358 | `measure.countGrain` | assumed | 字段内部口径矛盾及实现重复计数 | 已声明user_id却假定每物理行一用户；字段内部矛盾与SQL重复计数，参考日另未定；假定错：一行一用户前提；并非纯SQL漂移 |

完整原字段值及原trace精确pointer在`independent-recompute-35/field-review.json`，每条引文再次与源文件核验。局部错误层次争议（如358业务键正确但“一行一用户”假定错误）保留说明，不强叫纯SQL漂移。

### 执行与独立性限制

- 原后台部分lane因供应商usage limit停止，父Agent根据剩余盲题补做096、098、100、196、286；354由解除UTF8阻塞的原lane完成。上游工作流“complete”不等于全部case已完成，最终验收以落盘证据为准。
- 每题freeze先于其Gold reveal，最终SQL与发布CSV有真实Candidate/Receipt绑定。日志不记录所有文件读取，故不能仅凭这个时序声称严格实验盲法。061明确见过相近050的Gold重建解释，但冻结SQL没有采用2021资格；父Agent也已有历史卷宗知识。本研究是独立实现与实证复核，不是零先验受控盲评。
- 算法由人工自由题解与SQL形成，不由字段树模型重跑。当前环境的工具只作只读授权、记账和最终结果来源约束；机械登记字段不构成业务正确性的依据。外部反馈/比较建议未配置，不能声称获得机器口径背书。
- 较大探索预算、读全Schema、人工反例检验与原模型限时条件不同，不据此评价原工具效率；首次UTF8/SQL输入错误均保存为技术失败，未改数据库。
- 报告有35道完成调查的题，不再存在“没实际查数据库就结束”的题；15道意图未唯一裁决是实查后的证据边界。


<a id="case-details"></a>
## 逐题分析

<a id="local002"></a>
### local002

#### local002：实际重算后仍未唯一定位

## 原题与独立答案
原题逐字：“5-day symmetric moving average of predicted toy sales”；“daily sales data from January 1, 2017, to August 29, 2018”；“Finally provide the sum of those four 5-day moving averages?”。没有业务文档。
独立解释为玩具销售件数，按order_items行计件，purchase日期归日，完整606日日历补零、OLS真实日序、预测后±2日平均，最后求和。冻结发布结果 **36.890234106531814**，官方复现评分0；Gold **14334.62114**。销售“件数/金额”没有题面唯一裁决。发布、freeze先于reveal，见各自日志。

## 数据实验（均真实数据库、bridge）
- 606训练日，582有玩具销售日，4090件，金额479481.51。
- 件数OLS截距4.887984515090718、斜率0.006152695545127375。
- 四个中心平均9.213329483315263、9.219482178860389、9.225634874405518、9.231787569950644；均与中心预测差0，验证线性预测的对称平均恒等式。
- 改金额、不改日历：4340.100656966221（a=570.141601448448，b=0.730849627811366），精确复现原SQL4340.10。因此没有证据说原OLS、预测日期703..706或平滑实现出错。
- 缺销售日不补零：件数35.305665920162625；金额4155.685124985768。
- 销售日紧凑行序代替日历序、金额：4195.666963331135。
- 年内日号跨年重置训练：金额，真实经过日预测10938.11113385273；一致年内日号预测5757.454134327785。均不匹配Gold；跨年重置也非题面支持。
- 件数精确浮点OLS复算与原独立SQL一致，排除SQLite整数除法导致的假差异。
- 再测年内日号重置且不补零：错误地沿用经过日预测10719.167894905708，一致年内日号预测5730.193879672774；均不匹配。
- 仅已送达订单的金额日历OLS4230.602495195633；不同订单数代替item件数则3861单、预测平均总和34.65134724345582。状态筛选、单/件选择也不能解释Gold。
日志保留于executor-events.jsonl，输入和工具返回分文件保存。没有使用探针拼接交付。

## 原Spec事后审查
最后成功写入Spec把实体定义成“每日玩具销售额（日历日 × brinquedos 类目商品金额合计，一行一天）”，完整声明补零、不限订单状态、purchase日期、日序起点以及回归→预测→中心平均→总和；旧SQL与该Spec一致。早期“订单状态非取消”已被带reason的写入改成不限状态，不应拿早期Spec归因。
独立件数与原金额分叉最早在population.entity（单位口径），亦涉及measure.formula，但仅为可见未证实选择，不是已确证语义错误。原Spec把整个复杂formula标成request，引用只覆盖“5-day symmetric moving average of predicted toy sales”，不能证明金额与补零；这是证据支持范围问题，不能解释全部失分。

## 结论与限制
状态ambiguous_after_recompute。确证：旧结果可由常规金额OLS精确重现；件数/金额、缺期与日序变体均经计算仍与Gold不同。未确证：Gold怎样获得14334.62114；不能因Gold无SQL停止，但亦不能将不匹配强定为Gold错误或字段树漏槽。原题未明确销售单位、状态与无销售日口径。官方分数不是业务正确性认证。所有实验为额外离线分析，不用于接口因果收益比较。


<a id="local010"></a>
### local010

#### local010：Gold与明确对称城市对定义冲突

题目逐字：“all the unique city pairs”；“average distance of all routes between them”。业务文档haversine_formula.md逐字：“This ensures that a flight from City A to City B is treated the same as a flight from City B to City A.”；“dividing by the total number of flights between those cities”。半径原文：“approximately 6371 km”。

## 独立重算与关键证据
独立按机场坐标Haversine km，每航班一行、按字典序无向城市名归并、flight行权重平均、按0/1000/...6000+左闭右开分箱。冻结授权CSV结果 **3**，官方评分0，原结果也3，Gold为6。
33121航班/33121唯一flight_id、618有向机场路线、258无向城市对，航班总数守恒33121，无同城对。七箱计数依次 **92,93,37,20,6,3,7**，和258。机场多路线例Moscow-Ulyanovsk有4个无向机场组合、距离672.2644至742.8161，说明必须先按城市平均而非直接机场路线计数。
真实单变量实验：改成有向城市对，七箱变 **184,186,74,40,12,6,14**，最小6，恰好Gold；机场路线等权替代航班权重，七箱仍原样，不能解释本题失分。最少箱城市对及其正反向反例已分别查询保存于post-min-bin-pairs、post-directed-counterexample，原始数据见executor-events.jsonl。

## 三方结论与事后字段审查
独立SQL、原SQL都是文档明确支持的无向城市对，结果相同3。原成功Spec明确“unique unordered city pair, identified by standardized city names: lexicographically smaller city name as city1, larger as city2”，denominator为flight行数，旧SQL与之吻合。原Spec未丢对称性也未把航班数作为最终对数。
判为 **gold_conflict**：在文档对称性、6371km及常规区间定义下最少唯一城市对只有3，Gold6与之冲突。实验确定仅将方向计为独立对即精确得到6；这是一种足以解释全部标量失分的实现，但没有Gold SQL，不能断言Gold内部一定如此实现。不是原字段语义错误，错误可见性分类不适用；若强制比较与Gold等值的变体，最早分叉是population.entity的城市对对称键。

限制：英文城市名为实体键，区间解释为给定下界；Gold内部逻辑未知。官方按列评分不是关联正确性证明，但本题标量且原/独立相同。冻结早于揭示，所有SQL通过只读bridge。


<a id="local037"></a>
### local037

#### local037：实际定位为支付事件 vs 使用支付方式的订单

## 结论
独立答案与原运行按业务键完全相同，官方分均0；Gold前三类别也相同，但数值正好是按支付方式去重订单数。**已完全解释数值差异，不把Gold吻合认定为原解语义错误。** 题面没有payment业务定义，保留`ambiguous_after_recompute`；文字更支持支付事件，Gold更像支付方式使用订单数。

## 原题逐字依据
blind.json `/question`："number of payments made in each category using that payment type"；"top three product categories"。业务文档为空；DDL逐字含 "payment_sequential BIGINT"，仅支持存在支付顺序列，不单独证明一次真实付款的业务定义。

## 独立算法与返回
先DISTINCT订单-类别，再接支付表；类别内支付方式计数取众数，再在类别间取前三。冻结前检查支付表103886行且103886个(order_id,payment_sequential)键。商品112650行，但订单-类别99470行，故直接商品×支付关联会复制支付。
授权CSV：publications/publication_caf1b2d3-4cce-44c1-b09d-c51ccedbd1f1/result.csv。
- cama_mesa_banho / credit_card：7565
- beleza_saude / credit_card：6898
- esporte_lazer / credit_card：5923
直接商品关联为8959/7566/6635。独立答案已final发布并freeze后才reveal。

## Gold及反例实验
post-grain.response.json实测每类credit_card：事件/订单/多余事件分别7565/7540/25、6898/6874/24、5923/5904/19。Gold逐行7540/6874/5904：三个差值全部由同一订单同支付方式多条支付记录解释。
post-counterexamples-optimized.response.json：订单041f09bbcd85d178903f5bb71f11a02e有credit_card顺序2,1，2条支付记录，总额279.20000000000005；另4个实际订单同样有两条。这不是商品关联造成重复，支付源键本来不同。以预聚合+JOIN取反例；此前相关EXISTS版本达到SQLite120秒上限，已supervisor批准保义优化，失败日志保留。

## 事后原Spec审查
original-spec-extract.json最后成功set（原record/events.jsonl第9937行）逐字："按付款事件计数：每个 (order_id, payment_sequential) 计一次付款（探索已证实该组合在 olist_order_payments 中唯一）"。总体实体也明确相同事件键，joinMultiplicity去重商品扇出；原最终SQL正确实现Spec，与独立算法一致。相对Gold的最早分叉为population.entity（支付事件 vs 订单），度量countGrain同步可见；不是已确认实现错。原探针只覆盖商品扇出与支付事件，未实验订单粒度是可见的备选遗漏；不因此声称框架造成失分。输出额外payment_type虽Gold不含，但题面可支持且真正数值差已定位。

## 限制
Gold SQL缺失，不声称它实际使用哪条SQL；仅确证DISTINCT订单算法逐类别重现Gold。没有已审核业务证据把payments唯一映射到事件或订单。空类别排除、跨类别支付重复归属与严格字典序tie为已披露独立假定。观测不是业务定义；Ready/发布不是正确性证明。


<a id="local040"></a>
### local040

#### local040：重复树记录被当独立树，已实测重建全部Gold均值

原题逐字：“highest number of trees”；“restricted to records with median and mean income both greater than zero and a valid borough name”；“average mean income”。无业务文档。

## 冻结的独立答案与自查错误
独立先做FULL ZIP JOIN、合并ZIP、正收入与非空borough筛选，按联合记录tree_count和树行加权AVG。冻结结果：Queens 256056 /79312.57225763114；Brooklyn 184711 /73675.97696942792；Staten Island 106374 /94029.32783386917，评分0。
**独立实现也有错误**：虽然探索已经看到690626树行但仅683788个tree_id、220收入行但仅216个ZIP，仍继续以原联合行计数，未在冻结前解决身份重复。不能把这份独立答案当标准答案。

## 真实实验与Gold核对
原SQL将收入按ZIP用MAX折成一行，结果Queens252846 /79366.73841785119、Brooklyn177132 /73555.19098751213、Staten Island106374 /94029.32783386917。
收入重复ZIP仅10463、11205、11218、11370，两行全部字段相同；因此MAX在现有数据不混合不同收入。树表SELECT DISTINCT *结果恰为683788，等于唯一tree_id，证明多余6838行是完整重复记录而非有意义版本。本题实际ZIP、borough都无NULL/空；有效borough恰五个官方名字。FULL JOIN组合705203行，收入单边31行；收入单边因无borough最终排除。
真实单变量改变旧SQL，只将trees替换成SELECT DISTINCT * FROM trees，得到：
- Queens **250364 /79366.23974692848**
- Brooklyn **175358 /73552.914734429**
- Staten Island **105318 /94026.03572038967**
三项均值按borough关联全部精确匹配Gold（Gold输出只有borough与mean_income）。按tree_id折叠产生同样结果；对两表全部字段DISTINCT再FULL JOIN也同样。只改树记录去重已足以解释原SQL全部数值失分。ZIP等权或家庭数权重已实测，均显著不同，不是差异根因。Gold原内部SQL未知，不声称唯一内部实现。

## 最后才看的原Spec
成功Spec实体原文：“individual tree record (one row of the trees table, identified by tree_id/idx); borough is the grouping attribute”；countGrain理由：“one row of trees is one tree”。joinMultiplicity只决策“duplicate income zips handled so tree count is not inflated”，未识别树自身完整重复。formula明确树记录加权，旧SQL与之一致。
最早分叉population.entity：将物理行等同独立树，没有树实体键去重；随后countGrain和denominator使重复树增加权重。不是SQL漏做已声明的树去重，而是身份语义与键唯一性未求证（Spec可见但含混，实体/计数/分母有文本，缺重复树处置）。收入去重方向正确，不能因失败强说应ZIP等权。

## 结论和限制
confirmed_semantic_error（重复树行实体化）；另明确独立_solution_error已自认。按同tree_id且全部字段相同的树记录应代表同一棵树是合理身份推断，题面没有专门重复数据业务文档，不能把观测提升为已审核业务规则。局部重复事实和精确Gold重建均确证；Gold内部去重步骤不唯一。额外tree_count仅解释排名并非Gold要求的输出列；冻结答案不更改、不用探索结果重新交付。


<a id="local049"></a>
### local049

#### local049：Gold对应重复关联行计数，非独立公司数

原题逐字：“average number of new unicorn companies per year in the top industry from 2019 to 2021”。无业务文档。独立将new视为date_joined，不视为创立year_founded；top为这三年累计新增最多行业，逐公司ID计数、三年等权平均。

冻结发布：Fintech，**57.666666666666664**；原SQL取两位 **57.67**；Gold **59.67**；官方独立评分0。
真实数据库键检查：两个维度均1085行、1074唯一company_id，SELECT DISTINCT全行后均1074；每ID只有一个日期/行业，无版本或多行业差异。独立年度Fintech新增为 **20,15,138**，合173；次名Internet software & services合152。按2019..2021创立年份Fintech仅18/3=6，不能解释Gold。每年取当年top再平均为59.333333333333336，也非59.67。

## 单变量实验与反例
直接原维度JOIN、COUNT(*)，Fintech年度记录 **21,18,140**，总179/3=59.666...四舍五入 **59.67**，精确复现Gold。比公司数多6行；反例公司ID **109、162、316、318、450、983**各关联出2行，日期同一，业务上不是两家公司。所有重复全字段相同，无可见理由按两个独立公司计入。额外行仅改变计数，Fintech仍top，所以可足够解释全部标量数值失分；Gold内部SQL未见，不说唯一生成逻辑。

## 事后字段审查
原成功Spec实体键company_id，eligibility“Each unicorn company counts once”，joinMultiplicity明确“count each distinct company once per year (deduplicate) so a multi-row company does not inflate the count”，formula count_distinct再年avg，denominator3，timeField date_joined、top3年总数。旧SQL与独立算法一致，最后成功写入均覆盖这些关键语义，未发现原字段漏声明或实现不遵从Spec。原timeField决策被标verified不代表date_joined语义有业务文档支持；这里只是合理未证实映射。
结论 **gold_conflict**：在“公司”按相同company_id视为一公司这一身份解释下，Gold与公司数守恒冲突。原实现不是confirmed_semantic_error；最早Gold等值变体分叉在population.entity/joinMultiplicity的公司与关联行粒度。不能把匹配Gold的COUNT(*)提升为标准口径。

限制：date_joined是新增独角兽事件、top按新增总数、同ID为同公司均属有理由的解释而非已审核业务定义；无Gold SQL，精确重建是充分解释不是唯一解释。输出行业额外列不构成数值差异原因，官方比较忽略列名。未将揭示后探针重新交付。


<a id="local050"></a>
### local050

#### local050：Gold被2021商品月可见性+单商品预测舍入精确重现

## 结论
独立发布2552.695 USD，原2552.70，Gold2604.2362912087915。已实际计算而非停在缺Gold SQL：**限定历史配对商品月同时存在2021销售，并对每个商品月预测先ROUND(...,2)，再计算未舍入月均值的median，精确重现Gold**。主要差异来自2021可见商品月总体；题面只要求2019/2020用于预测，没有明确要求2021有实际销量。该隐含资格仍不能唯一确证。最终status为ambiguous_after_recompute，另有明确局部舍入层级差异。

## 业务原文
blind.json `/question`："monthly sales data from 2019 and 2020 (filtered by promo_total_id=1 and channel_total_id=1)"、"determining the monthly averages before finding their median"。
projection_calculation.md（blind.json `/documents/projection_calculation.md/content`）逐字：
- "Sum up the sales amounts for each product, country, month, and year."
- "Apply this percentage change to the 2020 sales to estimate 2021 sales."
- "Multiply the projected sales figures by the conversion rates to adjust to USD. If specific rates are not available, use a default rate of 1."
- "Compute the average projected sales for each month in 2021, adjusting for currency conversion. Round the results to two decimal places."
文档还写 "including sales amounts each month for the years 2019, 2020, and 2021."；它支持收集2021，但不明说要仅预测2021已销售的商品月，和题面基于历史预测之间有余留歧义。

## 独立算法及真实中间量
历史按prod_id、calendar_month_number、calendar_year SUM金额，France和两个total_id=1；配对a19>0、a20非空；预测a20²/a19，2021月汇率乘法，缺率1；各月商品均值ROUND2，12个月取中间两个。实际法国currency2019-2021共36条、每年各12月，全部to_us=1：汇率选择与缺率补1不造成这次差值。
12月配对商品数47/52/46/43/46/46/49/51/53/52/49/56；月均值4054.99/2402.89/2888.48/1474.10/2904.71/1440.35/1600.13/1392.60/2702.50/2218.77/3208.94/3062.66。排序中间是2402.89及2702.50，median2552.695。无零2019，缺2019产品月每月12-20个，缺2020每月0-5个；并非完整历史面板。
授权CSV publications/publication_ebad7921-f825-4269-bf4c-fa5f9a82ea3d/result.csv；算法/SQL/结果freeze先于reveal。

## 后验单变量实验
post-roster-variants：全历史配对、不舍入median2552.6959807204075；加2021有销量资格变2604.236129353304（解释几乎全部差值）。补缺历史零方案为1988.9777693928731或1875.6139858014071，不能重现Gold，且没有文档要求。
post-roster-monthly：2021资格后每月有效商品46/49/44/41/44/44/47/50/52/52/49/53；中间2月及9月均值2454.400658113617及2754.0716005929908。post-product-rounding只再将商品预测ROUND2：二者2454.4014285714284及2754.071153846154，中位数2604.236291208791，和Gold浮点表示一致。此实验不是重新发布答案、更不是Gold业务口径已被证实。

## 事后原Spec/SQL审查
原Spec明确 "Only product-month cells that have sales in BOTH 2019 and 2020"，与独立总体相同。原公式也是商品预测→月均值→median，SQL正确实现其主要嵌套；总体相对重现Gold的最早分叉为population.eligibility，且原字段未包含2021资格。不是AVG/median层级颠倒。
原SQL只在最终median ROUND2，没有按文档先对月均值ROUND2；这是可确证的局部实现/输出层级差异，独立结果与原结果只差0.005，不能解释整个约51.54的失分。Gold重现则舍入商品预测而非文档月均值，存在局部gold_conflict候选，但舍入造成的差仅0.000162，不可扩大成全部失分解释。

## 未证实与限制
无Gold SQL；实验只证明两个操作精确重现Gold，不断言Gold源代码如此。2021资格不唯一，缺基期产品月不投影为独立披露假定。实测所有汇率1，不是美元普遍等于法国本币的业务规则。官方分0不否定题面/文档支持的自由题解；发布Ready也不证正确性。


<a id="local056"></a>
### local056

#### local056：实际复算后口径仍未唯一确定

## 结论
独立冻结答案为 **HECTOR POINDEXTER**，官方比对0；原答案MICHEAL FORMAN，Gold为STEPHEN QUALLS。真实实验定位到两个足以改变赢家的选择：是否只允许日历相邻月份，以及有符号差还是绝对差。观测月绝对差恰好完整复现Gold，但不能据此宣称Gold口径是业务事实。

## 题意与独立推导
原题逐字："Which customer has the highest average monthly change in payment amounts? Provide the customer's full name."
无业务文档；DDL逐字片段："amount DECIMAL(5,2)"、"payment_date TIMESTAMP"。题面未规定absolute、rate或缺月策略。Gold揭示前按客户ID汇总年月付款总额、相邻有付款月有符号差、平均非首期差、取所有最大者；详见independent-plan.md及independent.sql。

## 数据与中间量
02-profile实际发现付款月份2005-05/06/07/08及2006-02；有缺月，不能混同相邻观测与相邻日历。
03-top-signed：HECTOR(487)平均32.45，两差；MICHEAL(445)平均30.44，两差。
96-three-customer-months：487的6/7/8月总额3.99/46.86/68.89；445的5/7/8月5.98/29.90/66.86；332(STEPHEN)的5/7/8月10.98/78.83/28.91。
332有符号平均(67.85-49.92)/2=8.965，绝对平均(67.85+49.92)/2=58.885。
04-alternatives在揭示前已经算出：观测月绝对差STEPHEN 58.885；变化率及月内平均金额差均为ASHLEY RICHARDSON。05-calendar-zero补全日历零月有符号差赢家CATHY SPENCER。
94-original-replay真实复跑原SQL仍为MICHEAL；其仅有7→8的日历相邻差36.96；95-abs-adjacent只改单变量为日历相邻绝对差时赢家WADE DELVALLE 55.37，非Gold。故从原SQL复现Gold需同时允许跨缺月观测并取绝对差；不是只加ABS即可。

## 三方及事后字段审查
freeze 2026-10-11T09:01:57.631Z后才reveal，随后compare_csv.py评分及原trace审查。原最终成功Spec population.missing逐字："不补零（无业务证据证明缺月代表零活动）；只在两个日历月份严格相邻（如 2005-07 与 2005-08）时计算一次月度变化；跨月缺口（2005-08 → 2006-02）不计作“月度变化”而被排除。" 原SQL用月份减1自连接实现此选择。measure.formula为signed difference而非ABS；实现与Spec基本一致。最早分叉population.missing/eligibility在前，measure.formula第二；两项在树上可见但均无题面唯一裁决。原理由中把金额difference称“绝对差值”不等于数学ABS。

## 限制
Gold SQL不存在并未阻止调查；上述原始SQL、候选、中间量均由只读桥真实执行。足以解释赢家变换的候选已定位，未足以证明唯一意图；保留ambiguous_after_recompute，不夸大成confirmed_semantic_error或gold_conflict。发布Receipt/CSV、freeze、executor-events.jsonl是独立计算链；工具Ready不作为正确性证据。首次序列化conditions空列表及selection数组被接口拒绝；修正为n/a和字符串orderBy，算法未改变，故障已上报supervisor。


<a id="local061"></a>
### local061

#### local061：2021实际销售商品月资格解释全部月差异

## 结论
独立与原运行12个月逐键结果相同，官方均0。后验仅增同产品月2021有实际销量资格，即逐month业务键精确重现全部12行Gold。不是汇率、总体同比或嵌套AVG错误；**数值分叉已完整定位，业务资格仍未唯一证实**，status=ambiguous_after_recompute。

## 原文与自己的算法
blind.json `/question`："taking each product’s monthly sales from 2019 and 2020"；"for that same product and month"；"with the 2021 exchange rates"；"finally averaging and listing them by month"。
业务文档逐字 "Sum up the sales amounts for each product, country, month, and year."、"Apply this percentage change to the 2020 sales to estimate 2021 sales."、"Compute the average projected sales for each month in 2021, adjusting for currency conversion. Round the results to two decimal places."。因此自己的算法历史SUM→同产品月配对→2020*(1+(2020-2019)/2019)→2021FX→月均值ROUND2；不擅加2021实际销售资格。缺历史及基期0排除为假定。文档 "including sales amounts each month for the years 2019, 2020, and 2021."仅说收集，是否限定预测资格仍有歧义。

## 自由题解实际验证
本题重新登记任务并执行，未拿local050 Gold反推独立答案。currency法国2021每月唯一，全部1，故汇率年/默认率不是这次差异源。有效历史配对商品数47/52/46/43/46/46/49/51/53/52/49/56。实际增长反例prod_id118一月2019=16.3，2020=1227.04，增长74.27852760736197，预测92369.76451533742；没有因异常大增长静默截尾。
授权CSV publications/publication_38a25c9b-658e-4809-871f-d12c67586fb2/result.csv：月均预测4054.99/2402.89/2888.48/1474.10/2904.71/1440.35/1600.13/1392.60/2702.50/2218.77/3208.94/3062.66。final→freeze→reveal按序保存。

## 后验实验与三方差异
post-roster-rounding.response.json：同产品月2021非空后，商品数46/49/44/41/44/44/47/50/52/52/49/53；预测月均值4120.33/2454.40/2980.58/1517.54/3025.06/1482.95/1658.60/1419.89/2754.07/2218.77/3208.94/3131.66，逐键全部等于Gold，12个delta为0（post-keyed-gold-check.json）。10、11月有效总体未改变，Gold恰也未变。
真实排除反例：prod_id47一月2019销售242.33、2020销售504.28，预测1049.3885131845007，但无2021同月销量，Gold重现算法排掉它；2019/2020资料足够按题面预测。2月排除prod44/47/129，其他月相应改变分母。商品预测先ROUND2和不ROUND2在这12个2位月均值完全相同；不能据本题判定Gold是否先舍入产品预测。

## 事后字段审查
原成功Spec原文："A product is included for a month only if it has a summed sales amount in both 2019 and 2020 (so the growth rate is computable); products lacking either year are excluded, with no zero-fill."。原SQLSUM历史、NULLIF基期0、LEFT JOIN法国2021FX、ROUND(AVG,2)，在现数据正确实现原Spec，独立逐键复算也一致。相对Gold重现方案最早分叉population.eligibility，2021可见资格在原字段未声明；measure.denominator随之变化。原字段把历史配对标evidence，不代表用户确认目标年度销售资格。没有可确证的原实现错；业务资格有文档与题面表述张力，不能硬判原语义错。

## 限制
Gold SQL缺失但不妨碍完整数值定位。2021资格为何被参考结果采用仍属未证实；数值吻合不是业务定义。文档/题面没有规定缺历史补0，独立排除规则已披露。相近题先前可见，独立计划明确未把其Gold资格作为本题题解依据。发布不是正确性认证。


<a id="local064"></a>
### local064

#### local064
## 结论
独立答案已发布并冻结：最多为1月（424人，均值557.704），最少为5—12月并列（0人，均值0）；取最早5月，均值差557.704。独立官方评分0，原评分0。原答案419.99未生成5—12月，属于实现遗漏；Gold 363.742可精确重建，但重建需要同时把purchase当支出并排除无交易月份，不能当作合格业务定义。
## 原文及独立推导
blind.json /question："For each customer and each month of 2020"；"adding all deposit amounts and subtracting all withdrawal amounts that occurred during that specific month"；"across all customers"。采用当月净额而非累计余额，deposit正、withdrawal负、purchase不计；500客户×12个月，无记录净额0；平均包含全体客户。
## 数据实验
probe-schema返回：deposit 2671条、withdrawal 1580条、purchase 1617条；日期仅2020-01到04；交易与节点各500客户且无集合遗漏。probe-months：1—4月净额总和278852、112428、106030、68855，均值为除以500；正人数424、259、248、169；5—12月全0。最终SQL与CSV见independent.sql、publications/以及independent-freeze.json。
揭示后probe-original真实复跑与原CSV一致。probe-variants真实执行8种主要组合，并比较全体/活跃/正值分母：deposit-withdrawal、仅观测月份的差419.994；累计额差-436.916（1月与3月）；加扣purchase的当月净额、仅观测月份、全500分母恰为363.74199999999996，与Gold逐值相同；加扣purchase累计口径差732.926。由此排除“Gold要求累计余额”的猜测，发现具体Gold数值指纹，但不声称无SQL的Gold一定由该算法生成。
## 最后原Spec/SQL审查
original-spec-extract.json最后成功写入字段：population.time为2020全年；grouping为"calendar month (YYYY-MM) of 2020"；eligibility包含全500并为无交易客户记零；measure.formula明确仅本月deposit-withdrawal。SQL却只GROUP BY实际交易月份，未生成无记录月份。最早分叉为population.missing（未声明全日历脊）；更准确分类为SQL未完整实现已声明全年范围，confirmed_implementation_error。visibility：需题意+SQL+实际日期范围才能证实，不是把Gold偏好套为树内语义错误。measure.formula明确排除purchase，与题面相符，不因Gold数值匹配就改称错误。失分不能全归因无记录月份：即使只看1—4月，题面算法419.994仍与Gold363.742不同，差56.252来自purchase月总额差的数值签名。
## 限制
5—12月无记录不是证明客户真实银行余额为零，仅在题目明确“that specific month”的净流量定义下为零；最低月并列政策未给出；Gold SQL不存在、其生成机制未确认。上述局部差异是可证实事实，不证明原系统接口因果效果。


<a id="local067"></a>
### local067

#### local067：分箱方向而非利润定义；非仅层号反转

## 结论
独立与原运行按层号相同，分均0。**在同一68名活跃意大利客户及同一利润公式上，将NTILE排序改为DESC，即逐bucket键精确重现Gold全部10层。** 题面没有规定分箱方向；现有业务证据不足认定ASC语义错误，status=ambiguous_after_recompute。68不是10的倍数，ASC/DESC会把8个额外名额分给不同利润端，所以差异并非纯层号重命名。

## 原题及自由题解
blind.json `/question`："Italian customers segmented into ten evenly divided tiers based on their December 2021 sales profits"；"highest and lowest profits"。documents为空。自己先累计每客户销售amount_sold−quantity_sold*unit_cost，再对客户NTILE10按利润ASC/cust_id稳定排序，每层MAX/MIN利润。客户活跃资格、实际收入利润、同额可跨箱与方向均披露为独立假定；没有借字段树或旧数值指导。

## 实际核算与反例
2021-12成本1907行且完整(prod_id,time_id,channel_id,promo_id)键1907个；意大利客户7780，当月活跃68、销售689行全部成本匹配，连接无扇出。实际收入利润总11407.10，成本unit_price代替实际收入则11423.84，销售行收入差范围−4.38至+0.39；两公式不等价。
独立NTILE ASC每层人数7/7/7/7/7/7/7/7/6/6。独立授权CSV publications/publication_570cf3c0-5648-47a3-bddc-61086f651c73/result.csv（10行）；利润最低层−27.94至−10.03，最高层698.35至785.15。先发布freeze，后看Gold。

## 后验实验
post-descending-tiers：只改ORDER BY profit DESC，仍人数7×8、6×2；Gold最高层588.36至785.15（7人），最低层−27.94至−10.03（6人）；中间全部Gold max/min逐bucket键吻合（post-keyed-gold-check的20个delta均0）。若简单把独立ASC层号1↔10，其最高层仍6人/下界698.35，不能得到Gold，余数分配必须随排序方向变化。
post-tie-placement：实际profit=−10.030000000000086有客户4875/6319/7017，ASC前两人落1层、后一人2层，DESC前两人9层、后一人10层。同额跨箱确实发生。post-tie-order-invariance改变cust_id次序，9/10层各有一个客户成员改变，但所有箱MAX/MIN不变。**tie二级排序影响客户身份，不解释当前交付的数值失分。**
post-list-profit-desc用unit_price公式，低层变−23.56、−8.45等，不吻合Gold；可排除该公式为此次失分原因。post-other-tier-alternatives真实实验：等宽分箱人数28/18/4/4/4/1/1/2/2/4，明显不是均人数，且不吻合Gold；将7780名客户无销售补0后每层778人，中间8层全0，也不吻合。没有用Gold吻合替代业务定义。

## 事后原Spec与SQL审查
原grouping明确逐字 "对意大利客户按 2021-12 利润升序用 NTILE(10) 分成 10 档，第 1 档=利润最低、第 10 档=利润最高，每档客户数尽量相等"（为字段value内原文片段）。原SQLNTILE OVER(ORDER BY profit)与之相符，利润及时间/活跃总体也正确实现Spec。相对Gold重现方案最早分叉grouping（分箱方向及余数端），不是selection，更不是output仅换层号。方向显式可见但没有唯一请求依据；无确认实现错误。原没有cust_id稳定次序属于复现风险，当前MAX/MIN经实验对同额次序不变，不可夸大为失分根因。

## 限制
Gold SQL缺失，已精确重现全部边界并穷尽主要合理利润/总体/等宽/tie备选。题面未规定方向，不能判断低→高与高→低哪种唯一正确。成本匹配唯一是本数据观测，不是全业务schema键约束；利润/活跃资格没有审核定义。官方分不保业务唯一性，发布不保正确性。


<a id="local070"></a>
### local070

#### local070 独立重算与事后审查
结论：连续日期岛无误，全部失分能定位到“同日选哪城”；但业务规则不唯一，保留 ambiguous_after_recompute。

## 题面与独立解
原文："shortest and longest streaks of consecutive date entries"；"return exactly one record per date along with the corresponding city name"。无业务文档。
去重日期→日历连续岛→最短/最长→每日期最小city_id代表城。岛长度8、2、3、13；最终15日期，07-12..13和07-19..31。完整计划、SQL、CSV与freeze已先于reveal保存。

## 实测和三方对照
独立官方分1，原分0；不仅列集合匹配，按日期键逐行相等Gold。原SQL实测重跑一致，仍为15行、完全相同日期。改变唯一变量代表城为最小city_id即全匹配。原词典序选择导致6日期不同：12、19、23、27、29、30（key-comparison.json完整列表）。反例：07-12有 Xiaoganzhan、Qingyang、Guangshui、Gaotan、Hejiaji；MIN名称=Gaotan，而最小ID=Xiaoganzhan。probe返回保存在executor-events.jsonl / representative-counterexamples.json-response.txt。观测只是解释Gold，不是业务定义。

## 原Spec事后
trace工具/toolCalls/13成功决定measure.formula："故选字典序最小 city_name 作为该日期的代表城市（可确定、可复现）。此为未证实业务假定，发布时披霞。"。此前最小ID候选两次决定失败，最后采用字典序；SQL忠实实现最后决定，不是实现漏项。最早分叉measure.formula，候选、不同输出和假定在接口均可见。不存在可证明的Gold矛盾：两种代表城都符合一日一城。不能把独立得1分推成原业务错误，也不据此评价框架因果效果。

## 未证实
最小ID是否代表插入先后未由DDL或文档定义；没有Gold SQL，但真实单变量实验已解释全部差异，不以缺SQL停止。


<a id="local096"></a>
### local096

#### local096：独立重算与事后字段审查

**结论：按题面排除未知性别实算仅4部全女影片；Gold额外计入2009/2012无可识别演员、2018演员性别NULL的3部影片。忽略NULL反事实逐年精确重现Gold，原SQL处理NULL正确。**

### 原题（逐字）

> For each year, calculate the percentage of films that had exclusively female actors (meaning no male actors and no actors with unknown/unspecified gender). Consider actors with gender marked as 'Male' or 'None' as non-female. For the results, display the year, the total number of movies in that year, and the percentage of movies with exclusively female actors. Extract the year from the Movie.year field by taking the last 4 characters and converting to a number.

## 独立解题与实算
原题明确“no actors with unknown/unspecified gender”，故每电影至少有已识别出演者，且所有演员明确Female；以全部Movie作年分母。先独立检查物理键，M_Cast.PID带外围空白，Person存在同PID重复但性别无冲突；按PID预聚合性别、TRIM身份连接，再按电影聚合，避免演员连接放大电影总数。3475电影全部有cast记录，不存在空cast选择在本数据影响结果。
真实符合者仅4部：1939 Kala Jigar，1999 Bindhaast，2000 Snegithiye，2018 Pihu。其年百分比分别50、1.5151515、1.5625、0.96153846，其余年为0。最终78行已发布并冻结，官方分0，不能因此抹掉题面要求。
## Gold差异与反证
Gold在2009计1/110、2012计1/111，2018计2/104。实查其额外候选：tt1587388和tt2355921的唯一cast PID为NULL，无法连接演员；tt8338754的演员Vaibhav Sethia的Gender为SQL NULL。它们都不能满足题面“no actors with unknown/unspecified gender”。
只将资格改为“没有已知Male/字符串None”，忽略SQL NULL与孤立身份，即得到7部资格影片，逐年全部Gold比例精确重现。此反事实充分解释当前数值，但没有Gold SQL，不能声称已经查到Gold原始代码；也不能排除标准生成数据库版本不同。
## 最后审查原字段
原measure.denominator明确“性别为 Male 或 NULL（未知/未指定）的演员视为非女性”；最终SQL CASE WHEN Gender='Female' THEN1 ELSE0 END把NULL正确判为非女。原公式另决定“无演员记录的电影算作满足”，从措辞看存在资格风险，但实际空cast为0，不能拿它解释本次失分。原按年保留全部电影和解析末4位也与独立实算一致。
本题最早可证差异在Gold的population.eligibility/conditions，而不是原Spec隐藏节点。错误层为本次输入下标准答案局部冲突；原语义错误可见性不适用。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
For each year, calculate the percentage of films that had exclusively female actors (meaning no male actors and no actors with unknown/unspecified gender). Consider actors with gender marked as 'Male' or 'None' as non-female. For the results, display the year, the total number of movies in that year, and the percentage of movies with exclusively female actors. Extract the year from the Movie.year field by taking the last 4 characters and converting to a number.
```

- `parent-cast-integrity-response.json`，JSON pointer `/details/preview/rows`：

```text
3475
```

- `parent-post-null-only-film-cast-response.json`，JSON pointer `/details/preview/rows`：

```text
Vaibhav Sethia
```

- `parent-post-ignore-null-variant-response.json`，JSON pointer `/details/preview/rows`：

```text
0.9615384615384616
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
"YEAR","TOTAL_NUM_OF_MOV","PERCENT_OF_MOV_WITH_ONLY_F"
1939,2,50.0
2018,104,1.9230769230769231
2000,64,1.5625
1999,66,1.5151515151515151
2009,110,0.9090909090909091
2012,111,0.9009009009009009

```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local096/attempts/attempt-001/trace.json`，JSON pointer `/toolCalls/26/result/details/fields/10/value`：

```text
性别为 Male 或 NULL（未知/未指定）的演员视为非女性
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local096/publications/publication_e6432aaa-bac2-4c1b-85ac-a79cb8f8c5d5/`。
- 初次冻结：`cases/local096/independent-freeze.json`。官方独立分：0。

- Gold SQL缺失；重建NULL机制不是原标准SQL源码证据。
- 空cast规则原Spec有争议，但在当前数据空cast为0，不构成本题实际失分根因。


<a id="local098"></a>
### local098

#### local098：独立重算与事后字段审查

**结论：相邻出演年差≤4确实等价最多3缺年；原28698正确实现。当前全库只有32127可识别出演者，Gold32585超过全集上界。独立初稿误计1个NULL身份，冻结保留并另发布修正28698。**

### 原题（逐字）

> From the first year each actor appeared in a film to the last, how many actors in the database never had a gap longer than three consecutive years without at least one new movie appearance, meaning there is no four-year span anywhere in their active career without at least a single film credit?

## 独立算法和一个自查修正
相邻出演年份差d，夹在两次出演之间的空年为d−1；题目禁止连续4年无片，因此d≤4，而非d≤3。每演员出演年DISTINCT后LAG，再取最大差；单年出演者无内部空窗，纳入。演员用PID，非演员姓名合并。
独立初稿得到28699并冻结；揭示后实际检查发现M_Cast有两条NULL PID记录，被GROUP BY合并成1个未知身份并误计为演员。**这是独立题解自己的实现错误，不能隐去。** 保留第一次freeze，追加非NULL/非空身份条件，重新执行最终查询并发布修正Candidate，正确结果28698，与原SQL一致。初次官方分0不变，修正也没有贴合Gold。
## Gold核对和全集上界
当前M_Cast COUNT DISTINCT PID及TRIM PID均32127；连接Movie后可识别PID全集仍32127。Gold32585比出演者全集多458，已超出任何“从首片到末片”活动职业子集的可能上界。Person有37565身份，但其中没有出演记录的人不能自行得到首/末出演年；若标准将其纳入，则需要题面没有的资格规则。
实际相邻年差=4的演员有798名；误用≤3得到27901（包含初稿NULL组），正确≤4为28699，再排除NULL为28698。这证明旧卷宗的“缺口off-by-one”不能成立。不是只因没有Gold SQL就结束，而是用全集约束实际反证。
## 最后审查原Spec/SQL
原population.conditions显式写“相邻出现年份之差不超过4”，原eligibility限至少一条出演记录，SQL还排除mc.PID IS NULL；DISTINCT PID/year及LAG实现正确。原未定位题现可判为当前输入下Gold资格/数据兼容冲突，不能归为原measure.window错。具体标准究竟加入无cast人物、使用另一数据库还是有其他计数缺陷，仍未恢复。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
From the first year each actor appeared in a film to the last, how many actors in the database never had a gap longer than three consecutive years without at least one new movie appearance, meaning there is no four-year span anywhere in their active career without at least a single film credit?
```

- `parent-post-actor-upper-bound-response.json`，JSON pointer `/details/preview/rows`：

```text
32127
```

- `parent-post-gap-boundary-response.json`，JSON pointer `/details/preview/rows`：

```text
798
```

- `parent-post-null-cast-identity-response.json`，JSON pointer `/details/preview/rows`：

```text
tt2355921
```

- `parent-post-correction-note.json`，JSON pointer `/corrected_count`：

```text
28698
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
output

32585
```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local098/attempts/attempt-001/trace.json`，JSON pointer `/toolCalls/29/result/details/fields/2/value`：

```text
相邻出现年份之差不超过 4
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local098/publications/publication_100fa935-2fa9-4d9d-b187-dde933024236/`。
- 初次冻结：`cases/local098/independent-freeze.json`。官方独立分：0。
- 已披露独立初稿多计NULL1人的更正：`parent-post-correction-note.json`及其新发布Receipt；不覆盖初次冻结。

- Gold生成机制/数据库版本未知，只确定当前出演者全集无法支持32585。
- 独立首稿多计NULL1人；初次冻结不可覆盖，修正SQL和新Receipt另行保留。


<a id="local100"></a>
### local100

#### local100：独立重算与事后字段审查

**结论：独立合作图集合计算25698，与原SQL实跑一致；源身份1、直接合作者2382、两步内28081，排除source/一跳得到25698。Gold15911与当前完整图不兼容，隐藏子集或历史数据原因未知。**

### 原题（逐字）

> Find out how many actors have a 'Shahrukh number' of 2? This means they acted in a film with someone who acted with Shahrukh Khan, but not directly with him.

## 独立解题
不构造全体演员两两平方图：查到唯一源PID nm0451321（姓名带前导空格的Shah Rukh Khan），取其90部电影的出演PID集合，得到含源本人2383个一跳可达身份；再取这些演员的3206部电影的全部出演者，集合减去一跳及源，得到25698个最短合作距离恰好2的演员。
所有M_Cast电影MID均有Movie记录；全部二跳PID均可连接Person，二跳集合与一跳交集为0。独立最终25698已发布冻结。
## 三方核对与实际交叉检查
原SQLltrim(PID)逐层DISTINCT、排除直接合作者与源，实际复跑同为25698。集合恒等式：两步以内可达28081 −直接2382 −源1 =25698。不是不同join SQL碰巧同数，而是逐层可达集合与互斥关系均检查。
Gold15911小于当前完整二跳集合。即使尝试按性别/姓名投影，Male身份15833、Female7519、未知2346；按Male Person行得到15909也不等15911，更不能因为接近就为题面添加男性过滤。题面没有性别、年代、已知演员等筛选。
所以现可判为本题明确完整图要求与当前Gold不兼容；不声称已查明Gold具体遗漏哪些身份，因为Gold只给总数、没有人物清单/SQL。可能是历史数据库版本或隐藏资格，不把它写成已证实原因。
## 原字段事后审查
原population.conditions明确“存在...中间演员...同时该演员不曾...直接出演”；entity/countGrain为PID，joinMultiplicity强调逐层DISTINCT；最终SQL实现这些要求。没有找到原字段声明或SQL最短距离实现错误；不是字段树阻止不了错误，而是当前标尺不能支持这个完整图答案。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
Find out how many actors have a 'Shahrukh number' of 2? This means they acted in a film with someone who acted with Shahrukh Khan, but not directly with him.
```

- `parent-hop-counts-response.json`，JSON pointer `/details/preview/rows`：

```text
25698
```

- `parent-post-graph-set-invariants-response.json`，JSON pointer `/details/preview/rows`：

```text
28081
```

- `parent-post-cast-film-integrity-response.json`，JSON pointer `/details/preview/rows`：

```text
3475
```

- `parent-post-gender-projection-response.json`，JSON pointer `/details/preview/rows`：

```text
15833
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
output

15911
```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local100/attempts/attempt-001/trace.json`，JSON pointer `/toolCalls/3/result/details/fields/2/value`：

```text
同时该演员不曾在任何影片中与 Shah Rukh Khan 同片出演
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local100/publications/publication_7f4ba0f1-2ded-4f82-9005-f5e7c69a00e0/`。
- 初次冻结：`cases/local100/independent-freeze.json`。官方独立分：0。

- Gold只给总数，无法给出其具体遗漏人物；机制/数据版本未唯一定位。
- 最短图算法按当前完整cast数据验证，不利用接近Gold的性别过滤来改口径。


<a id="local131"></a>
### local131

#### local131
## 结论
独立答案与原答案均25行，Gold20行；差异全部由5个零偏好风格造成。按业务键核对其余20行三项计数完全一致。判定 ambiguous_after_recompute：题面“each musical style”支持全集，但也能指偏好中出现的风格，无法把Gold采用的存在资格认作唯一业务定义。
## 原文与算法
原题逐字：“Could you list each musical style with the number of times it appears as a 1st, 2nd, or 3rd preference in a single row per style?”（blind.json#/question）。无业务文档。目录左连偏好，按StyleID分组，分别计PreferenceSeq=1/2/3。
## 数据验证与三方
probe/conservation的真实执行：25个唯一StyleID；偏好序号1/2/3有15/15/6行，计数守恒。50's Music、Rap、Elvis、Karaoke、90's Music均0/0/0。freeze后实际执行非零资格反事实（counterfactual-nonzero.json），恰好20行；与Gold按StyleName关联逐行一致。Gold SQL内连接并HAVING>0，全集资格改为存在偏好即可解释全部失分，不涉及排序（ignore_order=true）。
## 事后字段审查
original-spec-evidence.json保留trace成功调用：sequence18明确写入“every style in the Musical_Styles dictionary is a row; a style that no customer chose appears with count 0 in all three rank columns”。最终SQL确实左连并补零。最早分叉population.eligibility，字段内显式可见；没有SQL实现错误。原trace引用方法性指南不能补足业务证据。其把歧义选项直接改成request状态，不意味着业务资格已证实。
## 限制
独立正式分数0；全集/存在资格仍需业务确认。工具Ready和publication仅记账，不证明业务正确。


<a id="local167"></a>
### local167


#### local167
结论：Gold CA=43与明确年末任职条件冲突；独立和原答案均 CA=42，解释全部1人的差异。

## 原文与独立口径
"Based on the state each female legislator first represented"；"female legislators whose terms included December 31st at any point"。每人按最早任期归首州；任一任期含任一年末即可；count distinct人。不将任期行、人年或日期维表当总体。计划及发布冻结均在揭示前完成。

## 实证
数据库366女性，最早任期无跨州并列。任期1789-03-04至2025-01-03，日期维表1917..1999仅83个12-31。CA首州女性全部43人，只有 H001087 Katie Hill 无符合年末的任期：2019-01-03至2019-11-03，唯一1条。其余42符合。独立COUNT输出42；原SQL重跑42。递归枚举1789..2025每个12-31的第二种算法验证42，排除终点改为不含仍42；日期维表限定版本仅25人，实测见dimension-limited-years日志（不作为业务定义）。去掉年末筛选恰为43，是Gold数字的局部可复现解释，不能认定其真实SQL如此实现。
因此任何符合题意的distinct女性人数上限为42；Gold43不能靠闭/开端点、首次州排序或重复去重解释为正确值。没有Gold SQL仍足以凭完整43人清单与唯一反例定位人口条件冲突。

## 事后原Spec
成功字段 population.conditions 写："该议员的任期中至少有一条覆盖某年 12 月 31 日（作用于议员层 HAVING/EXISTS）"；SQL `lt.term_end >= date(lt.term_start, 'start of year', '+1 year', '-1 day')` 正确实现。原时间字段n/a虽缺乏显式端点记录，SQL含端点，与独立一致，女性端点例子只有MI/NM，不能影响CA。最早分叉若以Gold未筛解释为population.conditions；它不是原语义错误或原实现错，不硬套树可见性。

## 限制
Gold SQL未提供，不能确认其生成机制；可以确证的是CA43违反必须曾覆盖12-31的资格条件。数据库无任期终点业务定义，闭/开两法已证明不影响本答案。


<a id="local168"></a>
### local168

#### local168：已精确重建Gold，但多层业务解释仍不唯一

原题逐字：“job postings that specifically have the Data Analyst”；“non-null annual average salary, and are remote”；“overall average salary when considering only the top three most frequently demanded skills”。无业务文档。

## 独立算法与冻结答案
按job_title_short='Data Analyst'、remote=1、年薪非NULL，按不同job_id计需求，前三skill_id需求降序/ID升序，最后至少要求一个选中技能的独立岗位等权平均。46个合格岗位/46唯一ID；选skill IDs0、1、5（各需求3），9个岗位，总薪资834203，均值 **92689.22222222222**。冻结后才揭Gold **101300**，原 **104040.60**，官方评分0。前述题面可读为岗位平均，也可读为技能均薪再平均；选择前者是假定，不是业务事实。

## 实验矩阵与精确反例
skills_dim只有26行/26唯一ID；合格技能关联22行/22唯一(job,skill)，但有大量skill_id没有维度名字，频率最高IDs0、1、5、181、182均3，只有1在维度（python）；还有187=qlik需求1。不能说维度缺失就不是技能，也不能称成功凑足三种具名技能。

| 标题总体 | 技能身份 | 岗位OR等权 | 岗位-技能行等权 | 技能均薪等权 |
|---|---|---:|---:|---:|
| 短标题类别46岗位 | 原关联ID前三0/1/5 | 92689.222222 | 92689.222222 | 未用于Gold重建 |
| 完整标题精确17岗位 | 原关联ID前三182/0/1 | 104040.6 | 104080.571429 | 未用于Gold重建 |
| 短标题类别 | 仅skills_dim可识别的1/187（只有2种） | 106900 | 104100 | **101300** |
| 完整标题精确 | 仅skills_dim可识别的1/187（只有2种） | 92850 | 93800 | 94275 |

Gold精确数值重建：python3岗位均薪106900，qlik1岗位均薪95700，再(106900+95700)/2=**101300**。反例岗位1791218薪资95700同时要求python与qlik；其余python岗位419649薪90000、777802薪135000。去重岗位平均=(90000+135000+95700)/3=106900；关联行平均另多计95700得到104100；技能等权平均101300。三个公式不同，Gold不是简单关联行多权，而是两层技能等权。这足以构造全部标量失分，不证明Gold内部唯一算法。

## 最后看的原Spec/SQL
成功原Spec选择job_title='Data Analyst'，曾探索短标题但之后改变选择；这是population.conditions最早与独立解及Gold等值变体分叉。selection最终明确“技能身份=skills_job_dim.skill_id（不要求该skill_id在skills_dim中有名称行）”，joinMultiplicity明确去重job_id后平均、formula/countGrain/denominator均为岗位等权。旧SQL准确实现其选择，没有证据说SQL无意遗漏一个已声明的JOIN或AVG层。原Spec误称“skills_job_dim 与 skills_dim 均为 job_id×skill_id 粒度”，skills_dim实际无job_id；属局部物理粒度描述错误，但不能解释全部失分。

## 归因与限制
**ambiguous_after_recompute**。已定位可重复的数值差异：标题总体、技能维度资格、最终平均权重三项共同改变可精确获得Gold。最早分叉conditions，随后selection和formula/denominator；都在原Spec可见，非字段遗漏。题面没有明确完整/短标题、未知技能有效性及技能等权分母，不能仅凭数值贴标准标签或认定原解释必错。Gold等值算法实为2技能，不满足字面“三种”完整性；数据限制确证，Gold是否在完整数据上另有含义未证。独立结果含无维度名称ID且有5种频率并列、严格取3任意ID，发布时已记录假定，但需要对业务用户披露选择敏感性。揭示后全部结果为探索，不改冻结交付。


<a id="local169"></a>
### local169


#### local169
结论：完成真实20期留存重算，不能诚实将Gold差异唯一归因为起始期错位；当前 ambiguous_after_recompute。

## 题面与独立算法
原文："proportion of this cohort still in office on December 31st for each of the first 20 years following their initial term start"；"all 20 periods in sequence regardless of whether any legislators were retained"。
独立先求全表首次任职，再含端点1917..1999选4033人；固定4033分母。生成0..19观测，起始年12-31为0，逐人EXISTS任期闭区间。回任亦算当期在任。0..19的编号及起始年的第一快照是披露假定，不是题面明定；题目也可读次年开始、1..20。独立已发布20行并freeze，不在核对后修改答案。

## 数据和中间量
起始日1917-04-02..1999-11-06；任期1789..2025，维表只到1999。期0 retained4021，期1=3956，期2=3113，期19=844。独立率分别4021/4033=.9970245475、3956/4033=.980907513、3113/4033=.7718819737。原输出1..20从.9809开始，期20=707/4033=.1753037441（四位小数）。Gold1=3911/4033=.9697495661，2=3172/4033=.7865112819，20=633/4033=.1569551203。离散Gold分子已另存gold-implied-counts.json。

## 真实反事实而非仅猜卷宗
每条SQL均通过bridge，保存probe输入、响应和executor原始日志：
- 次年起始20期：等于原数值（除编号和四位舍入），仍不等Gold，不能只用错位解释全部失分。
- 任期结束不含：期0=4013、1=3953、2=3111；局部改变8/3/2人，不能解释Gold1/2。
- 仅日期维表1917..1999删失：年历期1=3909、2=3062、20=514；虽然期1接近3911，后续大幅不同，因此不可把贴近当确证。
- 完整年历/elapsed floor365.25/round365.25/round365 × 保留未来或删失1999，共8变体均无任何一期（1..20）精确匹配Gold。详情elapsed-and-censor-variants日志。
- 周年日而非年末：期1=3967、2=2923；按年度区间有任何服务：期1=4013、2=3956；两者都不吻合Gold。故简单日期粒度换算不足。
- 首次到末次任期桥接离任空隙：期1=3963、2=3242；12-01代12-31：期1=3954、2=2844；term_number首次选择与全表最早日期完全一致（4033人、0个起点变化）。日志gap-bridge-and-december-date和first-term-number-check保存实测，均不能吻合Gold。
- 额外验证日期维表连接后COUNT(*)与COUNT DISTINCT：期1两者3909、期2两者3062；0..20仅期11多一条重叠任期（1472行、1471人），不可能解释Gold期1=3911、2=3172。date-dimension-row-vs-entity日志排除物理任期重复解释。不能悄悄用这些近似代替指定指标。
这些实验排除常见单因素解释；没有Gold SQL，仍不能知道Gold分子生成过程，也不能保证穷尽所有组合。Gold与原列独立评分均0不能区分语义和实现。

## 原Spec事后审查
population.eligibility 正确规定固定全队列分母；measure.denominator明确4033人口而不是每期可观测人数。population.time曾列同年与次年两个候选，成功选择："Period k (k=1..20) 参考日 = (首次任期开始年份 + k) 年的 12 月 31 日"，并声明未证实。SQL完整实现此决定，原没有隐式删失；输出全20期。可见分叉population.time，但它只能解释独立与原错位，不能解释Gold全部失分。不要硬认“field error已确证”。

## 未证实
following的周期锚点、任期端点、断任后回任能否算still没有业务文档。独立采用0-based展示是与Gold1..20的输出差异，不证明其观测算法错。缺Gold生成SQL且合理实验未一致，保留未决，不停留于缺SQL本身。


<a id="local171"></a>
### local171


#### local171
结论：全部原-Gold数字差异可由未明示的1917..1999观察窗复现；至少期31的Gold4低于5名无歧义男性LA在任者，属于局部gold_conflict。另有“来自LA”的首次州/任一州未决，不能以Gold定它。

## 独立题解与题面
原文："For male legislators from Louisiana"；"actively serving on December 31 of each year from more than 30 years since their first term up to less than 50 years"。按全任期最早开始确定first_start、首州LA与男性，生成全部年份年末，在任闭区间，完整年数31..49按人去重。数据库198首州LA男性，均没有后来跨州；年末维表只1917..1999，而任期1789..2025。无业务文档。

## 三方及单变量实验
独立8行31..38计数=5,4,4,4,3,1,1,1；原=6,5,5,5,4,2,1,1；Gold=4,3,3,3,2,1,1,1。独立与原均0分。
原的任一LA资格多计 Edward Livingston L000366：第一任期1795-12-07在NY，LA在任观察1826..1831（period31..36），解释原比独立前6期各+1。当前在LA限定同样为原计数，证明他观察时服务LA；题面from并未说首州，不能确证原错误。
对独立或原任一州两种算法分别仅增加snapshot BETWEEN 1917-01-01 AND 1999-12-31，均按period精确得到全部Gold数值。窗外移除：Livingston（原有，1826..1831）、Louis St. Martin（独立/原均有，1885..1886，period34..35）、John B. Breaux（独立/原均有，2002..2004，period31..33）。因为Livingston也被窗外移除，Gold无法区分首次州/任一LA。
期31实际5名首州和当前州均LA男性：Ransdell(1930)、Ellender(1968)、Hébert(1972)、Long(1979)、Breaux(2002)；period31-counterexample-members日志给出性别、日期、精确任期端点。Gold4遗漏合法者；任何常见fromLA读法都包含这5名，故下界5矛盾可确证，不需Gold SQL。

## 其他验证
开term_end不改变8行；取消男性条件同样不改变这8行，不能说性别限制导致失分。连续时长(天数/365.25)>30会额外出现period30共7人，原本完成年数31..49为独立解释，端点粒度并非明示。但Gold也无period30，不能靠此解释它的低计数。

## 原Spec事后
population.eligibility 成功写："纳入 legislators.gender='M' 且该 id_bioguide 在 legislators_terms 中存在至少一条 state='LA' 任期记录的议员"。SQL用任一LA，首任时间仍正确全表min；在任不误计重复。time明确31..49，不含1917..1999总窗。SQL忠实于Spec，没有发现字段记录外漏掉过滤的实现错误。最早数值分叉若从Gold观察窗解释是population.time；不是已证原语义错误。维表覆盖范围只是观测，不是业务定义，更不能擅自视为题面总窗。

## 限制
Gold SQL缺失，真实生成是否使用日期维表不能确认；可以确认窗口变体按period全部匹配及合法在任下界违反。来自LA归属、完整年数/连续时长仍未完全指定。独立第一次州假定与原任一州不可裁定。


<a id="local196"></a>
### local196

#### local196：独立重算与事后字段审查

**结论：独立与原均按真实rental数减1；Gold五组后续租赁均值精确等于payment记录数减1，其中5条payment.rental_id为NULL。Gold把无租赁关联付款当租赁，局部计数冲突已实证。**

### 原题（逐字）

> For each rating category of the first movie rented by customers—where the first movie is identified based on the earliest payment date per customer—please provide the average total amount spent per customer and the average number of subsequent rentals (calculated as the total number of rentals minus one) for customers whose first rented movie falls into that rating category.

## 独立题解及结果
先按客户独立SUM付款总额，再COUNT DISTINCT rental_id−1，首片取最早payment_date对应影片rating，最后每客户等权平均。真实599客户的首付款全部无并列，故payment_id次序不影响答案。payment16049记录，rental16044事件，有5个客户payment数比租赁数多1；付款所覆盖的非空rental身份与真实rental数一致。
独立5组均值与原SQL重算相同，仅原SQL最后舍入。真实后续租赁均值G25.2980769231、NC-17 25.3589743590、PG26.2641509434、PG-13 26.3809523810、R25.48，花费均值也全部一致。
## Gold失分的实际机制
Gold的后续次数为G25.32、NC-17 25.37、PG26.27、PG-13 26.38、R25.49。只把真实rental数改成payment行数，再减1，就分别得到25.3173076923、25.3675213675、26.2735849057、26.3809523810、25.488，舍入后五组全部精确重现Gold。
实查多出的不是同一租赁多付款，而是payment_id424/7011/10840/14675/15458的rental_id为NULL，客户16/259/401/546/577。它们是付款事件，不是题面“total number of rentals”。支付总额仍应包括它们，不应为了租赁数去删消费总额。当前Gold局部混淆事件实体；未知它原始SQL是否真的COUNT(payment)，重建只是充分的数值机制。
## 最后审查原Spec
原custom公式明确Metric2是“total number of rentals ... −1”，countGrain为客户等权；原SQLCOUNT(*) FROM rental，实际rental_id唯一16044，所以实现正确。原joinMultiplicity甚至记录5条payment NULL rental_id，证明差异信息当时可见；但没有因此误把它们当租赁。本题不存在原字段未声明的错误；Gold计数单位与题面冲突。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
For each rating category of the first movie rented by customers—where the first movie is identified based on the earliest payment date per customer—please provide the average total amount spent per customer and the average number of subsequent rentals (calculated as the total number of rentals minus one) for customers whose first rented movie falls into that rating category.
```

- `parent-sakila-keys-response.json`，JSON pointer `/details/preview/rows`：

```text
16049
```

- `parent-post-count-payment-variant-response.json`，JSON pointer `/details/preview/rows`：

```text
25.317307692307693
```

- `parent-post-nonrental-payments-response.json`，JSON pointer `/details/preview/rows`：

```text
424
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
"rating","avg_spend","avg_subsequent_rentals_number"

PG-13,115.24,26.38

PG,112.67,26.27

NC-17,111.94,25.37

R,111.42,25.49

G,110.66,25.32


```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local196/attempts/attempt-20261010-154318Z/trace.json`，JSON pointer `/toolCalls/12/result/details/fields/8/value`：

```text
total number of rentals of c - 1
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local196/publications/publication_67e7bc2a-42d0-4c3d-acc7-1d76df9b40ad/`。
- 初次冻结：`cases/local196/independent-freeze.json`。官方独立分：0。

- Gold SQL缺失；只确认本次结果等价于错误付款事件计数，不断言其隐藏代码。
- 此类付款存在不一定是数据缺陷，可是真实无关联收费；不能擅自删除总花费。


<a id="local220"></a>
### local220

#### local220：Gold身份合并冲突
## 结论
独立发布：Cristiano Ronaldo胜199场；Gorka Iraizoz Moreno负107场。原SQL按player_api_id也得此答案；两者官方评分均0。Gold给Marcelo、Ricardo。真实反例：3个不同Marcelo身份胜场165+103+33=301；5个Ricardo身份负场55+41+38+15+14=163。单变量将身份分组改为姓名合并，极值恰成为Gold姓名。
## 原题依据
“Which player has participated in the highest number of winning matches and which player has participated in the highest number of losing matches”；“considering only matches where they actually played (excluding null entries) and where their team won or lost (excluding draws)”。没有业务文档，DDL提供player_api_id与姓名。题面问球员不是同名球员集合。
## 自由算法与验证
见independent-plan.md、final.json及授权publications目录。展开22个身份槽、排平局、按球员×比赛去重。全部非空身份均匹配Player。胜阵容203082槽与203081身份比赛只差1重复；负201618槽无重复。冠军主场116+客场83=199；负场冠军主39+客68=107。Gold各身份实测见query-gold-identities.json及executor-events.jsonl；改为姓名合并见query-name-merging.json。不是凭倍率推测。
## 三方比较与事后字段审查
freeze完成后才reveal；Gold对照后读取原trace成功写入Spec（original-spec-review.json）。原entity明示player_api_id稳定键、player_name仅展示；度量与SQL均独立身份去重。不存在可确证的原总体/度量字段分叉。Gold重建候选最早分叉为实体身份合并；归为局部gold_conflict，而不是原框架可见性错误。原输出多了类型与计数，独立也有这两列，因此不能保证修正Gold姓名后就获得评分。
## 未证实
Gold SQL缺失，实验说明姓名合并足以重现Gold，不证明它真实执行过该SQL。真实上场分钟缺失，以阵容记录代理。观测身份计数不是业务定义。评分列独立比较也非语义认证。


<a id="local263"></a>
### local263

#### local263：计数范围与Gold关联放大
## 结论
独立与原结果均regression：soft21、strong37，官方分0。Gold108/234不是同一步或模型级次数。实测只按name/version关联model（漏step）产生soft108、strong234，精确复现Gold。
## 原文依据与算法
“each model (specified by name and version)”；“A model has a 'strong' status if, for any of its steps”；“Count how many times each L1_model is associated with a 'strong' or 'soft' status across all models”。无业务文档。模型身份(name,version)；逐step传统最大分与Stack分比较，然后同模型×L1×状态去重。不是按字段树解题，见揭示前plan与freeze。
## 实验与边界
model303行/303步/101模型，model_score2872行，无同键分数重复。同一步关联累计regression soft36步/21模型、strong78步/37模型；tree11步/5模型、14步/6模型。Delaney solubility v1同一regression连续3个strong步，说明计步与计模型实质不同。改为跨所有步的传统最大分比较，regression soft34步/17模型、strong62步/32模型；不会得到Gold。漏step join使每个合格状态步配该模型3个model行：36×3=108、78×3=234；实际执行证明，不只倍率推断。sqlite_master显示stack_ok虽漏step关联但GROUP BY name/version/step恢复每步一行，读取其实际计数也为36/78，不是108/234。
## Gold与原Spec事后审查
冻结发布后才读Gold；上述实验后读原Spec和SQL。原COUNT(DISTINCT name||version)按模型；原Spec明确“one count per model (name, version) holding that status”，与独立推导一致。同一步范围也一致。局部Gold join multiplicity候选充分解释全部数字差异，但无Gold SQL不能声称真实代码已定位。原没有确证的语义错误；模型级/步级题面仍可歧义，较宽解释也只36/78，均不能解释108/234。
## 限制
Gold SQL缺失；反事实join不是Gold原SQL证明；官方列匹配非业务认证。全局基准范围与计数粒度已用真实数据库候选检验。


<a id="local264"></a>
### local264

#### local264：L1步骤计数与跨步骤连接
## 结论
独立regression213，原213，Gold639，官方均0。真实单变量漏step关联重现639：213正确步骤配426跨步组合。Gold局部统计单位超出了步骤×版本的L1出现，不能据评分认定原语义错误。
## 原文与算法
“Which model category (L1_model) appears the most frequently across all steps and versions when comparing traditional models to the Stack model, and what is the total count of its occurrences?”。无业务文档。对同name/version/step有传统和Stack分数的比较记一次L1，所有步骤计数，不擅自添加Stack胜出条件。原题未给strong/soft定义。
## 揭示前验证
regression71版本×3步=213，tree30×3=90；303步全部有可比分数。反事实Stack>=传统最大时regression114（strong78+soft36）、tree25；仅计版本71/30。Critical Heat Flux v1step1传统0.8836410197441006、Stack0.8767667331999809，为可比较但Stack落败反例；这些步不应无依据排除。
## Gold后实验
query-underkeyed-join实际同name/version但不约束step：regression639（其中426跨步）、tree270（180跨步）；成功子集342/75，也非Gold。Critical Heat Flux v1实查3×3九行，正确同一步只有三行。完整原始SQL/返回在executor-events.jsonl。不是仅乘3拟合。
## 最后原Spec/SQL审查
原Spec按model行（name+version+step），count(*)；原SQL同此，结果恰213。原conditions n/a没有声明比较分数存在，独立更严格，但全303可比故该局部遗漏目前无数值影响。原严格取1与独立保留并列也无现有影响。最早Gold重建分叉joinMultiplicity；没有确证原字段导致失分。Gold SQL不存在，只证反事实足以解释639，不证真实实现。
## 限制
when comparing是否隐含成功比较不能由文档确定，但所有合理候选213/114/71均不是639；倍率本身不作证明。


<a id="local269"></a>
### local269

#### local269
## 结论
独立与原答案946，Gold530.67。经真实实验定位：若跨根去重相同(leaf_id, expanded_qty)，再对叶路径数量平均，可精确复现530.67（3184/6），但这不是“每组合总量的平均”。判定ambiguous_after_recompute：可确证Gold数量不等于任一守恒的根组合均值；缺Gold SQL，无法唯一确认它是否有另一个“final combinations”定义，不能称原答案确定错。
## 原文与独立推导
“What is the average total quantity across all final packaging combinations, considering only the leaf-level items within each combination after fully expanding any nested packaging relationships?”（blind.json#/question）。无业务文档。父->子qty乘积，每根完整展开后所有叶路径累加；根531/532/533/534总量864/720/960/1240，(3784/4)=946。
## 实验与反例
graph.json、leaf-expansion.json、totals.json均实际只读执行。图11节点、12条关系，无可见环；两叶501/502。root-paths.json列7条根到叶路径：864,720,360,600,384,600,256，和3784。534->523->502的600与534->524->511->502的256应相加为856；不能任选一条。all-combination-leaves.json显示所有9个非叶起点总和3967，均值440.7778；14叶路径均值283.3571；根叶对6组均值630.6667；根叶路径7组均值540.5714。distinct-leaf-quantity.json实际跨根去重(leaf,qty)得6项、3184、530.67，丢掉533和534之间一个600。该实验提供精确数值解释而不是Gold业务定义；跨根去重与“within each combination”冲突。
## 事后审查
original-spec-evidence.json成功Spec明确以“final packaging combination, i.e. a packaging item that is not a component (contains_id) of any other packaging”为实体，并要求路径相乘、不去重。SQL符合这一决定，和独立结果一致。最早潜在分叉population.entity（final组合域），Gold潜在还混淆measure平均粒度；数值机制在树外可能是实现去重失误。不能由相同标量反推唯一Gold SQL。
## 限制
独立分数0；不停止于无Gold SQL，已经验证主要替代总体/分母和精确复现机制。Gold“组合”粒度尚无文档证实。


<a id="local273"></a>
### local273

#### local273
## 结论
已真实定位原答案用订单行满足率，独立答案用库存位置耗用率；Gold精确等于“分配量/该库存行实际总分配量”的事件均值。六产品均复现Gold，不因Gold SQL缺失停止。但题面未给pick percentage分母，保留ambiguous_after_recompute；原答案确实未计算位置级重叠百分比，这是可确证局部粒度差异，不足证明Gold分母为唯一业务规则。
## 原文与推导
题面逐字：“using a first-in-first-out approach that selects from inventory locations based on the earliest purchase date and smallest available quantity”；“only the overlapping range between each order’s required quantity and the inventory’s available quantity”（blind.json#/question）。无业务文档。库存按(purchased,qty,id)累计，需求按(ordered,order_id,line_id)累计，半开区间交集min(ends)-max(starts)，正交集才分配。独立分母采用inventory原qty，未由业务文档证实；freeze已披露。
## 中间量/守恒
113库存行、18订单行；正重叠34行。产品4280/5310/5430/6520/6600/7950分配200/40/100/300/56/150，恰好min(库存,需求)；库存200/500/500/400/100/536，需求480/40/100/300/56/150。per-stock-conservation实际验证每库存累计不超qty；allocation-details保留逐次分配。
## 三方核对与反事实
按名称排序的独立库存率：Der70.8333、Hazy73.5294、Hercule56.25、Hoppy85.7143、Monks97.5610、Pale71.3636；原订单满足率100/100/100/36.1111/100/100；Gold76.9231/75/75/85.7143/100/80。
gold-exact-normalization实际SQL按inventory_id先sum(picked)，再avg(100*picked/sum_picked)，六项全部精确匹配Gold。Gold还等于100×被触及库存行数/正重叠分配事件数：10/13、3/4、3/4、6/7、1/1、4/5。该结果只统计分割程度，不受最后未用库存余量影响。例如Monks库存41，订单40，独立97.561%，Gold100%；这是分母/总体差异的具体反例。不能把数值匹配冒充Gold算法或业务定义。
existing-picking真实查询检查历史picking_line，不把观测提升为业务规则。original-recomputed真实复跑原SQL仍得到原结果；它只取每产品总库存，得到每订单可满足量，数学上可以符合总量守恒但消除了所有位置级事件。
## 事后字段
original-spec-evidence.json记录成功Spec：实体“order line (an order × product demand row)”；分母“required quantity of the demand row (orderlines.qty); rows with qty <= 0 excluded”。原SQL符合它，未发生Spec->SQL错误。最早潜在分叉population.entity（订单行vs订单-库存交集事件），其后measure.denominator。局部字段显式可见，不能归因于字段遗漏。
## 限制
独立分数0；Gold SQL不可见，pick percentage分母及平均事件资格仍缺业务依据。无论真实结果或Ready，都不证明Gold为唯一口径。


<a id="local279"></a>
### local279

#### local279
## 结论
独立及原答案：(6520,2019-06-01,0)、(6600,2019-03-01,10)；Gold：(6520,2019-12-01,0)、(6600,2019-06-01,10)。绝对差值列一致，但Gold日期不是独立/原模型最小月份。经过真实递归实验仍ambiguous_after_recompute；不能把日期差异简单归为并列政策，也不能因缺Gold SQL就停。
## 原文与模型
题面逐字：“starting from December 2018 inventory levels”；“where we restock a product if its ending inventory drops below the minimum required level”；“the month in 2019 where the absolute difference between its ending inventory and the minimum required level is the smallest”（blind.json#/question）。无业务文档。初始inventory总量400/100，min100/30，purchase400/100；每月从上月最终结存扣2019预算，当月低于min严格触发一次补货；比较补货后月末库存差。仅两个产品有minimum和budget，所有12月份都有预算。
## 实验、状态与守恒
inputs/time-ranges实际查询：monthly_sales仅2016-2018，budget含2018和2019，purchase最多2018-12-29。2019预算总需求6520=600、6600=240。26条含种子状态留在monthly-states.json；年末库存200/60，初始-需求+补货为400-600+400=200、100-240+200=60。6520最低差唯一六月0，十二月库存200所以差100，不是Gold0。6600三月/八月月末40并列差10；六月月末80差50，不是Gold10。ties.json证明仅改最早/最晚并列不能复现Gold日期。
## 穷尽合理替代而非任意数值拟合
opening-alternatives实际量：全部采购-全部销量170/76，2018采购-销量43/2，December入库位置余量86/14；这些是观测候选，不是12月底余额定义。
recurrence-alternatives.json实际执行4种初始化×6种补货规则（当月加批次、下月加批次、当月重置批量、下月重置、补足最低、含等号触发）×2018/2019预算，分别比较补货前/后最小值，输出168个有效组合。没有任何一组能给6600六月最小差10；6520十二月0仅“补足最低”可成立但同规则6600差0又冲突。因此初始化、补货时点、补货量、阈值等号和并列已真实排查；Gold差值本身可一致，但Gold日期无法用这些合理候选联合解释。
## 事后字段审查
original-spec-evidence.json成功Spec明确inventory snapshot为初始，月末先扣预算再加qty_purchase，selection按abs_diff ascending, month ascending。原SQL逐条符合；original-recomputed实际复跑与独立答案一致。没有已确证实现错。潜在分叉measure.formula（递归状态/初始量解释）；亦可能Gold输出日期与差值错关联的树外实现问题，但无唯一证据，不强行归因。
## 限制
独立正式分数0。库存表没有snapshot_date，题面未明确预算来源、补货时点和补货批次；替代实验不构成业务定义。尚需Gold实现或业务状态规则才能确认全失分根因。


<a id="local285"></a>
### local285

#### local285
## 结论
独立24行分类年估计报表已授权发布、冻结，独立与原评分均0。真实实验已重建Gold所有24个键的全部指标签名，并非因为缺Gold SQL就未定位。业务定义仍未决：题目没有规定退货、平均权重、损耗分母及利润扣损耗方式，不将数值匹配升级为业务规则。status=ambiguous_after_recompute。
## 原文依据与独立答案
blind.json /question："financial performance over the years 2020 to 2023"；"total wholesale price, total selling price, average loss rate, total loss, and profit for each category within each year"；"Round all calculated values to two decimal places."。documents为空。DDL仅有单位价格、销量、SKU损耗率，没有采购量/库存或已审核财务定义。
独立先按报价记录计算价格统计，净退货数量×同日同SKU报价估计已售成本，净成交收入；SKU报价年损耗率均值；假定r为采购损耗比例，以额外损失q*w*r/(1-r)估计损耗，利润=收入-已售成本-额外损耗。冻结前已披露这是估计模型而非会计事实。CSV见publications/，独立推导见independent-plan.md。
## 实际数据库验证
55982条报价、878503条成交；SKU报价日键无重复，同日成交匹配缺失0；251个目录/损耗SKU，246个成交SKU。sale 878042条正量、return 461条负量；discount全部1，实际含义仍无定义。数据仅2020-07至2023-06。
2020 Aquatic类别独立成本37403.40533、收入52632.1053、估计损失3152.63714898，手工恒等式52632.1053-37403.40533-3152.63714898=12076.06282002（最终12076.06）。原损失2771.64使用q*w*r，原利润15228.70=收入-成本且未扣该损失。
## Gold重建和反例
probe-gold-hypotheses对sale-only与signed-net各24组真实执行。sale-only报价×数量成本24/24吻合Gold；净退货成本0/24吻合。Gold均值不是独立/原的每日SKU报价均值，而是按成交行重复报价后AVG，24/24吻合；Gold平均损耗率亦成交行均值，sale-only 24/24吻合。原按全目录SKU均值产生同分类跨年不变损耗率，Gold逐年变化。
Gold loss不是SUM(q*w*r)，也不是未舍入AVG(r)乘总成本。probe-gold-rounded证实先把AVG(r)及成本保留两位，再相乘、舍入损失，24/24吻合。例2020 Capsicum：82190.88*7.99/100=6567.051312→6567.05，利润125582.87-82190.88-6567.05=36824.94。未舍入均值乘成本为6566.68，差0.37；逐行损失也不同。
初次sale-only收入21/24严格吻合，另3组差0.01。probe-rounding验证数量至0.001kg、售价至0.01元且无精度违规，改用整数累计及半上舍入真实查询：2021 Cabbage整数收入11221418500/100000=112214.185→112214.19；2020 Solanum34606.365→34606.37；2023 Cabbage57231.395→57231.40。最终所有24键收入、损失和利润全部吻合，见gold-signature-keyed.json；不是用官方独立列评分替代关联核对。
## 最后原Spec/SQL审查
original-spec-extract.json最后成功Spec明写净退货全纳入；mean按报价记录和单品率；total_loss=SUM(qty*whsle*rate/100)；profit=收入-成本。SQL实际实现这些选择，非简单SQL漏项。最早分叉population.eligibility（net returns vs Gold sale-only），其次measure.countGrain/denominator及measure.formula。原三候选已有扣/不扣损耗利润选择，但未包含Gold的“舍入后的成交行平均率×总成本”。原joinMultiplicity警告“fan-out”不等于能禁止成交行均价；权重的业务含义需另外定义。
## 限制
上述差异已精确定位，仍不能证实Gold是唯一正确的财务定义；Gold SQL未知。独立补货损耗分母1-r也是假定，不能以模型直觉认定原q*w*r错误。final输入曾误带仅探索允许的limit，按接口删除后成功；已反馈supervisor，未改适配器/SQL/数据库。


<a id="local286"></a>
### local286

#### local286：独立重算与事后字段审查

**结论：独立与原资格均236卖家；Gold237中额外卖家实际仅54商品、4795.91销售额，却标108件和9591.82，严格>100资格冲突。其余评分/包装时间定义差异已计算但不能唯一裁决。**

### 原题（逐字）

> Prepare a comprehensive performance report on our sellers, focusing on total sales, average item price, average review scores, and packing times. Ensure that the report includes only those sellers who have sold a quantity of more than 100 products and highlight the product category names in English with the highest sales volume.

## 独立算法与冻结答案
主事实order_items，商品键(order_id,order_item_id)112650条全唯一；每卖家实际售出件数COUNT明细，严格>100得到236卖家。商品销售额与均价单独聚合，不被评论连接复制。评分从distinct seller/order对应评论记录平均；packing采用审批到交承运商的有效非负天数，按订单等权；各卖家最高销量类别按件数，不按收入，英文翻译缺失保留原类别。
这些评分权重、packing起点/负值处理、订单状态都在看Gold前写为假定。冻结236行报告已发布，官方分0。技术适配器起初误拒带limit的final及SQL字面量分号；父只删除非法final参数，并用CHAR(59)保留同一分号分隔值，没有修改独立算法。
## 可确证的Gold资格冲突
Gold237行唯一额外卖家2a7dc43cecabf23403078e2188437d1d，标product_cnt108、total_sales9591.82、avg_price88.813148...。实际查order_items仅54件、SUM(price)4795.91、AVG(price)88.813148...；连order_reviews仍54行，不是本次评论扇出造成倍数。
Gold的108=2×54、9591.82=2×4795.91不能自行证明其隐藏SQL怎样复制，但这个卖家实际54件明确不满足题面“sold a quantity of more than 100 products”。所有其他实体/评论/翻译连接不能授权凭空变出额外54售出件。当前Gold资格与数据局部冲突已经足够，不再停在“237vs236原因未知”。
## 其他差异不能强判
Gold的packing头部可由purchase到carrier均值重现，而独立和原用approved到carrier，题面只说packing times，起点未规定；review均值还受一订单多review与商品权重影响。真实检验了547多review订单、负packing1398 seller-order事件，以及销量/销售额最高类别分叉，仍没有任务业务文档裁决唯一权重和时间区间。这些不全归为Gold错或原SQL错。
原输出6列缺Gold product_cnt第7列是比较合同另一项失败，但用户未明确要求展示该计数，不能只据Gold要求硬判业务信息遗漏。
## 最后审查原字段
原eligibility和conditions均写订单商品行数量>100，SQL按真实商品聚合且严格>100，实现与独立236一致。joinMultiplicity显式规避评论复制商品数量，不存在“为了通过执行静默换计数实体”。公式明确packing approved起点、订单评分均值、类别销量，都是声明了的解释而非遗漏；原timeField的purchase文本与公式还应独立一致性审查，但不足以解释资格冲突。标准资格问题的visibility不适用。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
Prepare a comprehensive performance report on our sellers, focusing on total sales, average item price, average review scores, and packing times. Ensure that the report includes only those sellers who have sold a quantity of more than 100 products and highlight the product category names in English with the highest sales volume.
```

- `probe-keys.response.json`，JSON pointer `/details/preview/rows`：

```text
112650
```

- `parent-report-count-response.json`，JSON pointer `/details/preview/rows`：

```text
236
```

- `parent-post-gold-extra-seller-response.json`，JSON pointer `/details/preview/rows`：

```text
4795.91
```

- `parent-post-gold-head-reconstruction-response.json`，JSON pointer `/details/preview/rows`：

```text
4.134065715052809
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
"2a7dc43cecabf23403078e2188437d1d",108,88.81314814814814,9591.82,4.134065715052809,4.092592592592593,furniture_decor

```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local286/attempts/attempt-20261010-154318Z/trace.json`，JSON pointer `/toolCalls/10/result/details/fields/1/value`：

```text
订单商品行数）超过 100 件
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local286/publications/publication_76b4c4b8-ec4d-4738-b8c9-a5063f1b5553/`。
- 初次冻结：`cases/local286/independent-freeze.json`。官方独立分：0。

- 54→108仅重现倍率，未确认Gold内部复制步骤或历史数据库版本。
- 评分权重、packing起点/负值政策仍未由业务证据唯一裁决。
- Gold要求额外数量输出列与用户展示要求不完全相同，独立分0不证明算法全错。


<a id="local297"></a>
### local297

#### local297
## 结论
独立答案54.2%=271/500，与原CSV及真实复跑一致；Gold36.4%=182/500。已找到精确Gold数值签名：把purchase也当负额、增长用绝对前月余额作分母、首次NULL前月不视作零。该组合与明确“all deposits and withdrawals”的交易范围不符。分类gold_conflict（局部数值与题意冲突）；不把原54.2直接标成已确证语义错误，亦不声称已知Gold生成SQL。
## 原文与独立方法
blind.json /question："For each customer, group all deposits and withdrawals by the first day of each month to obtain a monthly net amount"；"closing balance by cumulatively summing these monthly nets"；"if the previous month’s balance is zero, the growth rate should be the current month’s balance multiplied by 100"。
deposit-withdrawal月净额→客户累计closing（初值0）→每客户最新指定交易月相邻日历前月比较，有符号分母，零分母题面回退。中间缺月补0，首次前余额0，严格>5；所有500客户作百分比分母。每客户最新月是披露假定，非从Gold反推。
## 实际数据库与手工复核
最新指定交易月分布1月17、2月26、3月194、4月263，达标人数15、19、103、134，合计271；有91个中间缺月，全部客户均有指定交易。客户3：1月净144、2月0、3月-401、4月493，累计144、144、-257、236，4月增长493/-257*100=-191.82879377%；客户10：1—4月净-410、494、-282、-513，累计-410、84、-198、-711，末增长-513/-198*100=259.09090909%，演示负分母会将更负余额判作正增长；这不是观测证明业务定义，只是有符号公式的效果。客户4仅1月848，题面零前额回退84800%。
## 揭示后真实反事实实验
probe-variants包含3种交易方式×个人最新/全库4月×累计/月净额，并检查绝对分母与整数除法。个人最新：dw累计54.2%，dw月净32%；purchase负额累计47%，绝对分母36.8%；purchase不计金额但保留月份45%。全库4月、所有500分母：dw累计26.8%，purchase负累计29%。这些不是Gold36.4%。probe-date-pairs另检查所有Jan–Apr有序月份对（两种交易范围），排除凭卷宗猜日期。
probe-null-abs精确定位：purchase负额、客户末观测月、ABS(前额)、首次NULL不做回退，182/500=36.4；只将首次NULL改0，184/500=36.8（3个首次NULL客户中2个正额）；改回dw_only、NULL不回退、ABS为291/500=58.2。支持Gold指纹需要多个改变，不能把17.8百分点差全部归于“末月”选择。
## 最后原Spec/SQL审查
original-spec-extract最后成功Spec明确population.conditions仅deposit/withdrawal、population.time每客户自身最近月；population.missing单月客户视前额0并纳入；measure.formula有符号前额增长及全客户分母。最终SQL实际体现这些选择。原先缺月不补、独立补零，两者末月结果完全一致：累计余额跨空月守恒，所以缺月不是此失分原因。原population.missing最后改写仅说明单月客户，未重申跨缺月策略，这种覆盖不完整是记录问题，但没有造成当前数值差。
若把重建Gold作为比较算法，最早分叉population.conditions（purchase负），其次measure.denominator（ABS）和population.missing（NULL）。这些节点只是比较算法差异，不是合格业务证据确证的原错误。原条件与题面吻合，不应为迎合Gold标错。
## 限制
Gold SQL缺失，精确重建不能证明唯一生成机制；初始余额0、个人最新指定交易月和负分母解释未有业务文档确认。真实查询日志、发布/冻结与原Spec成功写入证据均在case目录；未做框架因果评价。


<a id="local298"></a>
### local298

#### local298
## 结论
独立发布、冻结为2/3/4月：235595、261508、260971；与原真实SQL复跑数值逐月一致。Gold212579、240602、153147可完整精确重建为“只含当前月活跃客户的前额”，漏39、26、94个仍有正余额但当前月无交易的用户。题面明确"from all users"，因此为局部gold_conflict，不是原负余额截断阶段错误。
## 原文与独立方法
blind.json /question："the total balance from all users for the previous month (measured as of the 1st of each month), replacing any negative balances with zero"；"data from the first month is used only as a baseline"；"exclude it from the final output"。
按deposit正、withdrawal/purchase负（业务假定），每客户累计至前月末，在客户余额层截负为0，再总和；缺月净额0余额延续；首月1月基线不输出，后续数据月按月升序。初始余额0、末月边界均已冻结披露。
## 真实验证：截断层
probe-stage列出1—4月：每客户累计后截零总和235595/261508/260971/264857；先全客户汇总再截零126091/0/0/0；先截每月净额再累计235595/368987/500959/583634。故这些阶段不等价，而独立与原实现同为客户累计余额层。
客户3净额144/-965/-401/493，累计144/-821/-1222/-729；负累计余额不因为4月正净493而改为493。客户1在2月无交易，1月余额312仍在2月末保留312，而不是零。原SQL按txn_date<month||'-01'与独立前月累计严格等价，不含当月1日交易。
## Gold定位与守恒反例
probe-gold-coverage对真实无日历脊月净累计后LAG，得到所有交易类型的当前活跃客户455/456/309，前观测累计余额截0总和212579/240602/153147，三行完全吻合Gold；仅deposit/withdrawal得到273471/406133/311636，不吻合。只取上一个日历月且不补脊的值212579/220350/144958也不吻合，说明Gold指纹为缺月余额延续而当前不活跃者被排除。
probe-missing-users在完整脊上只改当前活跃资格，严格恒等式：235595-23016=212579；261508-20906=240602；260971-107824=153147。丢失正余额客户39/26/94。probe-counterexamples：4月无交易客户2前余额610、4前余额655、6前余额340、13前余额1405等；这些应属“all users”，无当月交易不改变截至月初余额。可确证Gold数值所缺的贡献及守恒冲突，非靠无Gold SQL推测。
## 最后原Spec与SQL
最后成功原Spec：eligibility全体交易客户；time累计严格早于各月1日；measure.formula先截每客户余额再求和。SQL确实按全部历史交易计算，不要求当前月活跃。原population.missing="n/a (no missing calendar months to fill)"忽略客户层缺月，但实际历史快照SQL正确延续，因此这里只是文字覆盖不足，不能归为导致失分的实现错误。
比较Gold签名最早分叉population.eligibility（当前月活跃资格），但不是题面支持的原语义错误；负截断measure.formula与Gold签名在相同用户上等价，不要误定位于度量。原月份字符串YYYY-MM与GoldYYYY-MM-DD差异被condition_cols=[1]排除，不是评分0原因。
## 限制
Gold生成SQL仍未知，但三月完整键值与遗漏贡献精确重建，all-users冲突可局部证实。交易类别及初始余额无业务定义，独立和原均有同样披露假定。没有据此宣称框架收益。


<a id="local299"></a>
### local299

#### local299
## 结论
独立30日历日、共同观察截止4月28日结果为2月290091.1666666667、3月337746.3666666666、4月316177.5666666667，已发布冻结。原286194.37/314140.93/170303.97来自客户各自末交易日停止，30日窗口本身正确。Gold284935.4537634408/312844.3225806452/170334.0已三月精确重建：客户各自末日截止，未预聚合同日多交易而产生重复日行，用31行窗口并从第30行开始有效。Gold具有可证实的“31行非30日历日”冲突，status=gold_conflict；历史终点仍存在业务歧义。
## 原题与独立方法
blind.json /question："For each customer and each day"；"30-day rolling average balance (only after having 30 days of data, and treating negative averages as zero)"；"first month of each customer's transaction history as the baseline period and exclude it from the final results"。
每日净交易合并→客户首交易日至全库末日连续日历→累计日末余额→当日+前29日余额均值（满30日）→均值截0→客户月最大→去客户首月→月总和。不先截单日余额，不提前删首月。共同末日及初始0为冻结前披露假定，不由Gold推导。
## 真实数据库与手算
500客户首交易都在1月（1日到30日），客户末日从1月5日至4月28日；396个客户日有多笔交易，需要聚合成一个日余额。
客户1到1月31日刚满30个日历日，30日余额SUM=9360，均值312；1月30日仅29天不可使用。客户3在2月25日有效30日SUM=460，均值15.3333333333；次日SUM=-505、均值-16.8333333333→0。独立相关日期范围SUM与窗口SUM严格一致（probe-handcheck）。若先截每日余额，客户3同一30日均值124.8，明显不是15.3333；客户10同一窗口平均为负→0，但先截每日余额得到37.0667。
## 揭示后的实际定位
probe-original复跑原结果完全一致。probe-endpoint-window-qualified实验四种终点×三个窗口方案：客户末日+真正30日均值即286194.36666666664/314140.93333333335/170303.96666666667（原）；客户末日+31行窗口、第30行开始有效，仅283796.7075268817/312134.51612903224/169610.06451612903，尚不能解释Gold全部差；共同末日或补月底也不吻合。probe-inclusive-end进一步尝试起点/终点±1日及月初起点，排除简单边界误差单因素解释。
probe-duplicate-days按连续日历LEFT JOIN原始交易，同日累计用RANGE得到正确日末余额但留下重复日行；31行滚动平均、rn>=30得到284935.45376344083/312844.32258064515/170334，三个月逐键精确吻合Gold。只改30行而保留重复日为287377.2/314884.8333333333/171066.63333333333，证明不能把Gold差归为单一31日差。31行去重→重复的额外影响分别1138.7462365591/709.8064516129/723.9354838710；30→31去重差分别-2397.6591397849/-2006.4172043011/-693.9021505376。
真实反例probe-day-counterexample：客户6在2020-02-08已经第30行，但日历跨度仅2020-01-11至02-08共29天，错误地得到有效均值823.9；客户11第30行仅28日，第31行仅29日。故“有30行”不等于“30 days of data”。窗口含当前行的30 PRECEDING实际最多31行。
## 最后原Spec/SQL审查
原成功Spec明确按客户首至客户自己的末交易日；population.missing日历缺日延续；joinMultiplicity预聚合客户日；measure.window当前日+前29日、均值后截0。原SQL正确体现这些决定，不存在Gold的重复日和31行问题。原/独立最早差异population.time（历史终点），文字支持两种解释，独立共同截止不是经过业务文档确证的唯一正确答案。原Spec保留了这两个候选并显式决定，故可见；不能将“原未匹配Gold”误判成隐藏时间口径错。比较Gold签名的后续差异是population.joinMultiplicity和measure.window；这属于Gold的物理/实现冲突，不硬套为原树内语义失误。
## 限制
Gold SQL未知，数值完整重建不是唯一生成程序证明。客户停止交易不等于销户，但题面transaction history也未明确延伸终点，保留此业务歧义。独立计算结果并未因Gold改写。一次探索SQL未限定customer_id导致SQLite歧义列错误，改限定别名后真实查询成功；未改适配器。


<a id="local331"></a>
### local331

#### local331
## 结论
局部gold_conflict且足以解释全部失分：独立和原答案均为/detail33、/2、/detail/1；Gold为/detail33、END7、/2。END没有页面访问事件，是会话结束合成类别。把不存在的第三事件COALESCE为END即可真实复现完整Gold前三名，故不归咎于原字段/SQL实现。
## 原文与事件算法
题面逐字：“Which three distinct third-page visits are most frequently observed immediately after two consecutive visits to the '/detail' page, and how many times does each third-page visit occur?”（blind.json#/question）。自然语义要求第三个实际页面访问；尾部仅两个/detail不是第三页访问。按session隔离，stamp,rowid升序滑动三事件；前二path严格/detail，第三事件存在则计1；按第三path累计选严格3名，次数并列字典序。
## 实际验证与守恒
actions/events/timestamp-ties查询：244记录均view，244非NULLpath，11不同原始路径；36组session-stamp并列，日志多次重复。triplet-counts实际返回四个类别33/2/1/1合计37；qualifying-windows含37实际第三访问窗口+7会话终止对=44，terminal-pairs保留7个末尾二detail实例。end-is-not-observed数据库查询path=END行数0。
synthetic-end-counterfactual实际执行与Gold按第三类别和次数逐行完全一致：/detail33、END7、/2。唯一改动是把不存在的第三事件合成END并参与排名，差异解释包括第三名被挤出。这不是Gold SQL的唯一证明，却是局部非访问事件资格的直接反例。
## 额外数据反例
严格原始路径去重(session,stamp,path)后的真实访问/detail->/detail窗口没有第三页结果；规范尾斜杠并去重则/input1。这说明日志重复和路径规范化会大改结果，但题面/文档未授权去重。独立保留这些记录并披露rowid同秒顺序假定；Gold/detail33和原始保留结果一致，故这些歧义并非本题全部失分机制。
## 事后字段审查
original-spec-evidence.json成功Spec：实体为“页面访问（visit）= activity_log 的一行（全表 action='view'）”，资格仅真正事件成为第三访问，度量按事件行计数；SQL LAG前二path，和独立LEAD写法逐项相同。最早Gold分叉population.eligibility（合成会话结束也纳入第三事件），原字段明确可见，并非隐藏实现。就字面page visits而言Gold加入不存在的END违背题意；没有业务文档把END定义为页面。
## 限制
独立正式分数0。Gold SQL缺失；精确COALESCE反事实、真实零END、7末尾对已足够确证局部冲突并解释整个评分。重复是否真实访问与同秒排序仍需业务确认，与该局部冲突分别披露。


<a id="local335"></a>
### local335

#### local335：积分单位与赛季constructor归属未唯一识别
## 结论
独立冻结Williams6、Toro Rosso5、Sauber3、Minardi3、Jordan2（第五按id）；原同分数但姓名排序第五Arrows2。Gold名称Williams/Jordan/Toro Rosso/Arrows/Minardi。真实实验找到两种互不相同、都足以重现Gold集合的口径，不能唯一说原漏了哪个条件。
## 原题与独立算法
“In Formula 1 seasons since 2001, considering only drivers who scored points in a season”；“their drivers scored the fewest total points among all point-scoring drivers in that season”。无业务文档。主解释总积分为driver-season全年累计，正积分车手取最低全部并列；其同年实际参赛constructor算该季，constructor-year去重。2001包含；2024只至round12，计划race24未全部有结果。前三项验证见plan、授权SQL/CSV/freeze。
## 真实数据库验证
各年最后积分榜与results+sprint积分逐车手完全相符；SUM累计积分榜是错误替代：Williams8、Toro Rosso2、Sauber2、Minardi2等，不解释Gold。只race积分仍主结果；生涯constructor归属错误候选Williams9/Renault6等；末队归属Williams6/ToroRosso5/Sauber3/Jordan2/Minardi2；按司机计季使Williams7，因2022Latifi与de Vries同2分，但constructor仅一季。上述SQL与返回全部保存。
关键转队反例：2002 Frentzen全年2分，Arrows2/Sauber0；2003 Wilson全年1分，Jaguar1/Minardi0。按全部同年参赛归属会计Sauber2002与Minardi2003。
## Gold重建的非唯一性
候选A保留全年司机积分，但constructor必须该司机当季在其队获得>0分：Williams6/Toro Rosso5，Arrows、Jordan、Minardi、Sauber各2，按姓名截5得到Gold名称，Sauber被排除。
候选B先按year+driver+constructor求正积分，再按每年该粒度取最小：Williams6/Toro Rosso5/Jordan3/Arrows2/Minardi2/Sauber2；同样按姓名截5得到Gold。其新增Jordan2001来自Alesi在Jordan1分，全年积分并非1；该SQL实查细节见query-team-min-details。A与B不同，Gold只有姓名不能区分。因此不是仅倍率或卷宗猜测。
## 最后原Spec/SQL审查
读Gold并完成实验后读原trace成功字段。原明确driver-season积分最低全并列，COUNT DISTINCT season；SQL最后driver积分榜、同年results连接与独立核心一致。原selection strict+姓名升序与独立id不同只是边界展示；该差异不能解释Gold排Sauber3却纳Jordan2。原条件隐含“总积分”的中间聚合粒度和constructor归属阶段，可能分叉在population.conditions（少积分资格）、中间度量或关联，不足唯一确认语义错误。不是原SQL实现错。
## 残余风险
Gold SQL缺失；两个解释都重现名称且各需未明确业务假定；Gold只一列而原两列也可能贡献评分0。不把局部重建冒充全部失分的唯一原因，状态ambiguous_after_recompute。


<a id="local354"></a>
### local354

#### local354：Gold遗漏与原参赛资格误计须分开
## 结论
独立发布103名司机，原104名，Gold只有501 Harry Schell、554 Jean Behra、579 Juan Fangio。可确证Gold局部遗漏：642 Nino Farina1950实际参赛6round，首round1与末round7均Alfa Romeo，两端Finished70/80laps，显然满足题面且Gold不含642。真实反例足以确认局部gold_conflict，不需要臆造Gold SQL。
另可确证原局部资格错误：Bill Aston1952只有round6 Oil pressure、2laps为实际参赛；round5 Withdrew0laps和round8 Did not qualify0laps不是参赛，原却计3round纳入。因此104->103能定位，但绝不能说它解释Gold只3人的全部失分。
## 原文逐字依据与自由算法
“Among Formula 1 drivers who raced during the 1950s”；“the same constructor in both the first and the last race they participated in”；“while also taking part in at least two distinct race rounds during that season”。无业务文档。1950-1959，按driver/year统计实际round>=2；司机自己首末round两端constructor集合有交集即可，不要求全年只一个constructor，亦非赛历全年端点。最终司机去重。status明确DNQ排除；Withdrew0lap排除、正lap保留；机械事故0lap不推断未起跑。
## 揭示前实际验证
50个Did not qualify全0lap，Withdrew26个含2个正lap。历史结果同司机同round可多车、甚至多constructor，24个driver-season多行但只有1round（包括1951Fagioli2条同一round，1954Linden3条同一round）说明COUNT(*)>=2错误。每季合格司机数27/22/29/28/27/22/25/19/24/20，跨季去重103。11个首末同队但中间换队的合格driver-season，例如1956SchellVanwall→Maserati→Vanwall，证明不能把端点相等误成全年同队。授权CSV/SQL与freeze见publications及independent-freeze.json。
## Gold后真实候选实验
不筛status104；自己参赛定义103；改日历首末43；端点正lap99；全年只有一个constructor仍103（另一季满足使司机集合相同）；日历首末且都Finished6（642/786/579/578/356/479，仍不是Gold3）；参加所有赛历round零人（印第安纳round存在）；drives首末flags+不同端点104；强加首末不同drive segments11（返回同隊）而非Gold3。Gold3在主口径各有多个合格季，但“最多合格季”排名也含Trintignant9、Collins7等，不能解释它。实际SQL均在executor-events.jsonl，未仅凭卷宗或数字推测。
## 最后原Spec/SQL审查
上述实验后读原trace成功Spec。原正确声明within-season首末与distinctround>=2，SQL实现COUNT(DISTINCT round)无此计数错误；但source注释“results JOIN races ON race_id yields one row per driver-race participation”既忽略共享车多行，也把未参赛结果行当参赛。最早可确认局部分叉population.eligibility；资格声明有语义但缺实际参赛状态判别。ROW_NUMBER两端同round多constructor任取存在实现风险，当前独立集合交集与原集合差异仅BillAston，未发现另一个现有司机输出影响。
## 编码故障与限制
姓名SQL遇Python GBK无法编码É立即反馈父；父修CLI UTF8后原SQL不变重跑，成功发布freeze再reveal。原始故障日志保留；此前GBK字符替换显示不作姓名证据。Gold仅ID而原分forename/surname、独立fullname，也存在输出形状差异；把ID翻为真实名字仍有Farina等确定遗漏。Gold SQL缺失，经候选实验后仍不能唯一说明Gold3来源；主status为局部gold_conflict，原BillAston语义错误独立列出而不冒充全部原因。


<a id="local358"></a>
### local358


#### local358
结论：确证原用户计数重复；但它不解释原-Gold全部失分（Gold也总数320）。真实日期反事实可完整复现评分差异，仍没有权威证据把任何历史日认定为用户要求。

## 题面、独立与原始观测
原文："How many users are there in each age category (20s, 30s, 40s, 50s, and others)?"。无业务文档，DDL有user_id、birth_date、register_date、withdraw_date，没有年龄参考日或PK约束。
独立按distinct user_id、完整周年年龄20..29等分箱，所有主表用户含注销，固定SQLite实际date('now')=2026-10-11。发布5行：20s3、30s9、40s2、50s3、others13，总30。题面未指定参考日，当前日为披露假定。
实际320行仅30不同user_id、生日全部有效且每user_id单一生日；U001..U010每人16行，U011..U030每人8行。一些注册日期多版本，但生日不变。注册时间2016-10-01..2016-11-28，购买日志到2017-03-02，不能因此宣称快照参考日确定；access_log甚至出现'/detail'文本混入stamp，不能用最大文本时间替代业务依据。

## 三方差异与真实验证
原CSV32,88,24,24,152，总320，SQL重跑当前2026-10-11完全一致。Gold16,88,32,32,152，总320。独立及原官方分均0。
1. 计数实体：保持参考日2026-10-11，仅去重user_id，得到独立3,9,2,3,13。这是Spec承诺的用户实体被SQL重复计数的可确证局部错误。它不解释Gold失分，因为Gold保留相同物理重复。
2. 时间：保持原COUNT(*)，真实扫描2010..2040中每个用户20/30/40/50/60岁生日转折的所有常值区间；唯一完全匹配Gold向量的区间为2024-04-07..2024-10-22。非唯一单日，不知道Gold真实参考日，不能把匹配日当业务事实。
3. 日期边界反例：U009出生2004-10-23、16重复行；在匹配区间19岁others，当前21岁20s；U028出生1976-05-26、8行，48岁40s→50岁50s；U003出生1965-01-06、16行，59岁50s→61岁others。三人转移合计完全解释原与Gold：20s+16，40s-8，50s-8，others净0，30s不变。boundary-person-counterexamples日志实际验证。
4. 注册最后日2016-11-28和购买最后日2017-03-02的独立去重计数都是9,2,3,6,10，raw为88,24,24,56,128，均不等Gold。活跃资格取消2位注销者只减others，亦非Gold差异来源。
所以不能只说“年龄需要参考日”或只说“没有Gold SQL”；已经真实定位全部raw评分差异到日期可复现假设，同时区分独立用户计数的另一个局部错误。

## 原Spec最后审查
population.entity 明确"用户（mst_users 的一名已注册用户，业务键 user_id）"，keyColumns=[user_id]。measure.countGrain则写"按用户实体计数：mst_users 每行代表一名用户，每个用户计 1"。实际每用户8/16行，后半句未经验证。SQL FROM mst_users COUNT(*)不去重，违背已声明实体身份：最早实现分叉measure.countGrain（实体定义正确、grain假定错），不是join fanout问题。
population.time明确"年龄参考日 = 查询执行日（当前日期 date('now')）"；SQL忠实实现该未证实假定。工具rationale中出现2025历史参考文案也非权威规定；题面仅分箱，未决定参考日。Gold的2024匹配区间只是一种数值解释，不确证原now业务错误。没有读旧口径标签，不据此做接口因果结论。

## 限制
未由正式PK约束确认user_id唯一身份，但原Spec自己指定该键，SQL实现不一致足以确证局部问题。Gold SQL未提供；历史日期区间匹配不能确认真实生成方式。参考日及包含注销仍为假定；独立最终CSV未按Gold改写。


<a id="evidence-review"></a>
## 最终证据与完整性复核（父Agent）

### 最终验收范围与结果

父Agent在35题全部落盘后重新验收，不声称这是第二轮独立审阅者对35题的盲审。

| 检查 | 实际结果 |
|---|---:|
| 有真实数据库执行记录 | 35/35题，378次成功原始返回（含探索、反事实和最终查询；失败另存工具日志） |
| 初次独立冻结早于本题Gold揭示 | 35/35 |
| 自然语言题解、最终SQL、授权CSV、冻结、三方核对、MD/JSON分析 | 35/35 |
| 逐题分析原文引文核验 | 135条 |
| 最后成功Spec字段的补充原文引文核验 | 33条；另2个相关节点当时未声明，按实际字段表缺席核对 |
| 原节点声明及状态检查 | 35/35 |
| 原提交CSV评分重新复现 | 35/35，与记录的0分一致 |
| 首次独立CSV重新评分 | 1通过、34不通过；不是业务正确率 |
| 授权私有结果对象与CSV字节/Receipt hash验证 | 36份发布全部一致（35首冻＋098更正） |
| 当前证据/绑定检查错误 | 0 |

证据文件：`progress-validation.json`、`publication-integrity-validation.json`、`original-spec-source-audit.json`、`final-validation.json`。校验脚本只读现有文件，不再访问数据库或执行SQL。

### 早期独立审阅的问题如何处置

历史审阅保存在`workflow-result.evidence-review.md`，当时只完成25题，曾报告BLOCK：10题未完成、进度文件过期/相对路径解析错误、部分原Spec引文无pointer。它是当时的快照，不可当作最终35题完成声明。

- F1：已补齐全部35题，逐题以执行/发布/冻结/核对/分析文件验收，不依赖lane结束消息。部分lane因供应商usage limit停止，父Agent接手剩余工作；没有宣称所有lane顺利完成。
- F2：修正`utf8-sig`编码名及case-relative路径解析，增加JSONL行号+pointer处理，再生成最新进度。
- F3：重新读取原运行最后成功set返回，全部原字段引用都能定位到实际值/rationale；将分析JSON中的投影引用替换成原trace精确pointer。所有JSON引文已有pointer。
- 提升：逐个`FileResultStore.openAuthorized`验证真实结果对象及授权CSV字节，不仅比较文件中的自报hash；重新跑35份官方CSV比较函数，记录缺陷和算法语义的独立边界。

### 仍保留的限制

1. 只能核验freeze→reveal顺序，日志不记录全部文件访问；不宣称严格零先验盲实验。061看过相近050的Gold解释，父Agent之前读过历史卷宗。
2. Gold数值的完整反事实重现不证明其源码或生成环境。17个局部冲突不等于原系统17题全对，不加到原正确率分子。
3. 15题业务意图未唯一裁决，其中12题已经重建差异机制，3题仍没有共同解释全部Gold的机制；这不是遗漏调查。
4. 040和098独立初稿自身存在错误，已披露；098的初次freeze保留，更正通过新Candidate发布，不伪称最初独立解已正确。
5. 358同时有字段内部“一行一用户”前提错误和SQL与业务键不一致，不能把它仅称SQL漂移。所有局部错误都单独标明能否解释全部失分。
6. 本轮是较大人工探索预算的离线研究，不是原模型/原预算的A/B，不据1/35或Gold冲突数推断字段树优劣。


## 复现材料

- 各题原始数据库执行日志：`independent-recompute-35/cases/<id>/executor-events.jsonl`。
- 各题任务、观测证据和发布日志：`tool-events.jsonl`、`answering-state.json`。
- 独立冻结答案：`independent-freeze.json`以及其Receipt对应的`publications/`。
- Gold揭示与三方比较：`comparison-input.json`、`csv-comparison.json`。
- 引文、时间顺序和Candidate绑定校验：`progress-validation.json`。
- 范围、隔离和执行说明：`PROTOCOL.md`、`lane-board.json`。
