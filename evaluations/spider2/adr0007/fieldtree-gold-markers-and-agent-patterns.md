# 61道错题合并审查：Gold问题标记与data_agent错误模式

**结论：61个独立题目中，标记32题Gold局部问题；严格筛出的Gold相关内容可核验评分错题为6题，其中5题是data_agent业务错误，1题仅为输出合同失配。** 其余不能因“未发现Gold错误”就认证Gold正确。

35题是原61题的子集，本报告不是96题统计。原始Gold、评分、SQL、两份历史报告保持不变，本次新增审查标记，不重跑数据库或模型。

**交付文件**：
- [61题标记CSV](consolidated-review/case-markers.csv)：可按`gold_problem_confirmed=True`过滤；适合Excel逐题复核。
- [完整标记与原文证据JSONL](consolidated-review/case-markers.jsonl)。
- [32题Gold问题IDs](consolidated-review/confirmed-gold-problems-ids.txt)。
- [5题确定业务错误IDs](consolidated-review/gold-verified-business-errors-ids.txt)。
- [6题Gold内容可核验的评分错题IDs](consolidated-review/gold-verified-agent-failures-ids.txt)，包括仅布局失败的local228。

**导航**：[Gold问题清单](#gold-list) · [模式识别](#patterns) · [全部61题标记](#all-cases) · [原文依据](#evidence)

## 1. 合并口径与标记标准

| 互斥分类 | 题数 | 如何使用 |
|---|---:|---|
| Gold已证局部冲突 | 32 | 不作无噪声的agent错题样本；也不直接判agent正确 |
| Gold相关内容已核验、agent评分失败 | 6 | 5题业务错误用于确定性模式；1题布局单列 |
| agent局部错误已证、Gold整题未核验 | 3 | 补充机制案例，不混入Gold正确样本 |
| Gold待确认、agent局部矛盾已证 | 1 | local358：待补用户身份定义 |
| 业务未裁决或其他评分合同问题 | 19 | 不强判Gold正确，不纳入确定错误频率 |
| **合计** | **61** | 35题独立重算只更新原61题内的结论 |

“Gold有问题”始终指**本题面、本次实际数据库输入下可证的局部冲突**。没有Gold SQL或原数据库版本时，不据数值重建声称找到了Gold真实代码。它也不意味着整题所有Gold值都错。

“Gold内容已核验”是按题意和实际数据检查相关身份、值、计算规则及可用表示，不代表题面只有这一种显示顺序或布局。local228业务内容与agent完全相同，只是评分所需表示不同。

### 31变32的原因

上一轮61题主标签有14题Gold冲突；35题重算新增17题，两组无重叠，已有主标签并集31题。本次不只按主标签机械合并：**local064此前主标agent实现错误，但同题Gold也与确定题意结果冲突，应追加Gold问题标记**。

题目定义每客户每月2020的余额为当月deposit−withdrawal，并跨所有客户平均。实际500客户、12个月中，1月正余额424人且均值557.704；5—12月全部当月净额0，最低月并列无论取谁均值都0，所以差值唯一557.704。Gold363.742不符。它可被“纳入purchase且仅观测月份”重现，但**判Gold冲突靠题意下确定结果，而不是靠这个反事实数值吻合**。

local358暂不加到32：Gold和agent都把320物理行当用户，实际仅30 user_id。但未有正式业务定义/PK确证user_id对应唯一人身份；原Spec自己指定这个键，只够证明自身“一行一用户”前提矛盾。Gold用户计数标待确认；历史参考日仍不确定，不能据此认证其正确。

<a id="gold-list"></a>
## 2. 已标记的32题Gold局部问题

表中“混合”表示Gold有问题的同时，agent也有可独立确认的错误。不是自动免除agent责任。

| 题 | 来源 | 标记 | 已确认的具体问题 |
|---|---|---|---|
| [local010](#e-local010) | 35题实际重算 | **Gold局部问题** | 任务文档要求无向城市对，实际最少箱3对；Gold6是有向两倍。 |
| [local049](#e-local049) | 35题实际重算 | **Gold局部问题** | 同公司ID被关联行重复计数：公司173/3=57.67，重复行179/3=59.67(Gold)。 |
| [local064](#e-local064) | 本次补标（此前为次要结论） | **Gold问题＋agent错误** | 全年每月仅deposit−withdrawal且全500客户：唯一均值差557.704，Gold363.742不符；agent也遗漏无交易月份。 |
| [local066](#e-local066) | 61题原审查 | **Gold问题＋agent错误** | Gold包含已取消未送达订单，违反pizzas we delivered；agent还独立忽略加/去料。 |
| [local073](#e-local073) | 61题原审查 | **Gold局部问题** | 订单10第一披萨无定制，Gold却输出第二披萨的加/去料结果，逐行身份冲突。 |
| [local096](#e-local096) | 35题实际重算 | **Gold局部问题** | Gold把未知演员/性别NULL影片算全女，违反no unknown/unspecified gender。 |
| [local098](#e-local098) | 35题实际重算 | **Gold局部问题** | Gold32585超过当前32127可识别出演者全集；原正确缺口计数28698。 |
| [local100](#e-local100) | 35题实际重算 | **Gold局部问题** | 当前完整合作图二跳且非直接合作者25698，Gold15911与明确完整图要求不兼容。 |
| [local114](#e-local114) | 61题原审查 | **Gold局部问题** | 明确订单数应为897/2357/2024/1634，Gold9/21/10/10等于代表人数，其他列一致。 |
| [local133](#e-local133) | 61题原审查 | **Gold局部问题** | 明确至少被排名一次，Gold仍含5个零偏好风格；差值与扩大到25风格平均相容。 |
| [local167](#e-local167) | 35题实际重算 | **Gold局部问题** | Gold含Katie Hill的CA43，但她任期不含任何12-31；有效CA42。 |
| [local170](#e-local170) | 61题原审查 | **Gold局部问题** | Gold含PI，但当前PI全任期女性0，不可能男女各六期都非零。 |
| [local171](#e-local171) | 35题实际重算 | **Gold局部问题** | Gold可由未要求的1917..1999观察窗重现；合法31年末5人而Gold4，存在遗漏。 |
| [local194](#e-local194) | 61题原审查 | **Gold局部问题** | 要求每演员Top3，Gold只给3电影；200演员不能被三片最多45人覆盖。 |
| [local196](#e-local196) | 35题实际重算 | **Gold局部问题** | Gold五组后续次数可由付款行数−1重现，而真实租赁数不符；存在5笔rental_id NULL付款。 |
| [local220](#e-local220) | 35题实际重算 | **Gold局部问题** | Gold姓名可由同名合并重现：3个Marcelo胜301、5个Ricardo负163；独立球员赢家不同。 |
| [local230](#e-local230) | 61题原审查 | **Gold局部问题** | 要求Top4导演，实际有四名各2片；Gold仅3人且电影计数等价类型连接行。 |
| [local253](#e-local253) | 61题原审查 | **Gold局部问题** | 同一个overall national平均被Gold变为随公司变化的20个值。 |
| [local258](#e-local258) | 61题原审查 | **Gold局部问题** | 要求each bowler，Gold漏实际投球但零wicket者；其余球数/失分并未全面核验。 |
| [local259](#e-local259) | 61题原审查 | **Gold局部问题** | 要求each player，Gold漏实际参赛/击球的McCullum/Ponting/Dravid，非未出场歧义。 |
| [local263](#e-local263) | 35题实际重算 | **Gold局部问题** | Gold108/234超过合法模型/状态步骤计数；漏step反事实可重现三倍值，但不证明Gold源码。 |
| [local264](#e-local264) | 35题实际重算 | **Gold局部问题** | 合法同一步regression出现213；漏step反事实增加426跨步重复并重现Gold639。 |
| [local270](#e-local270) | 61题原审查 | **Gold局部问题** | 根Pallet Mix SG内Bottle500cl两路径600+256=856>500，却被Gold漏掉。 |
| [local272](#e-local272) | 61题原审查 | **Gold局部问题** | 产品6520需求40；Gold只拣14+12=26，违反需求守恒。 |
| [local275](#e-local275) | 61题原审查 | **Gold局部问题** | 要求2017每月ratio>2，Gold包含实际零月产品，无法满足forall条件。 |
| [local286](#e-local286) | 35题实际重算 | **Gold局部问题** | Gold额外卖家仅54件/4795.91，却标108件/9591.82并越过>100资格。 |
| [local297](#e-local297) | 35题实际重算 | **Gold局部问题** | 题面仅deposit/withdrawal，Gold36.4数值机制加入purchase等；明确算法结果54.2。 |
| [local298](#e-local298) | 35题实际重算 | **Gold局部问题** | 要求all users的前月正余额总额与Gold不符；排除本月不活跃者的反事实逐月重现Gold。 |
| [local299](#e-local299) | 35题实际重算 | **Gold局部问题** | 同日重复行＋31行窗口反事实精确重现Gold；其第30行仅28/29日，与明确30日要求冲突。 |
| [local330](#e-local330) | 61题原审查 | **Gold局部问题** | 要求每页唯一会话数，Gold仅/detail一个路径且没有任何计数。 |
| [local331](#e-local331) | 35题实际重算 | **Gold局部问题** | Gold第三页面含END7，但实际没有END页面访问；合成终止不是第三次访问。 |
| [local354](#e-local354) | 35题实际重算 | **Gold问题＋agent错误** | Gold仅3司机，漏明确合格Farina；agent另把Bill Aston非参赛记录当两round资格。 |

### 必须保留的混合错误

- **local064**：Gold不是题意结果；agent自身也遗漏5—12月，不能把原419.99判正确。
- **local066**：Gold没有限定已送达；agent自身忽略披萨加料/去料，不能只改送达条件就宣称已正确。
- **local354**：Gold漏明确合格司机；agent另把未资格/退出记录当真实参赛，误纳Bill Aston，104→103只是局部修复。

32题不加入原40题正确分子，也不据`40+32`计算修正准确率。其余29题同样不自动成为Gold正确题：还必须补核验。

<a id="patterns"></a>
## 3. Gold相关内容已核验的核心样本

这些检查重新针对现有真实返回/授权CSV做了按业务键核对，不只重放官方按列比较。检查脚本和结果：[gold-content-checks.json](consolidated-review/gold-content-checks.json)、`check_gold_core.py`。诊断展开/选取不是新交付结果，未用探索或拼接数据替换原发布CSV。

| 题 | Gold为什么可用 | agent明确偏离 | 最早节点 | 层/可见性 |
|---|---|---|---|---|
| local015 | Gold两百分比按实际motorcycle分组3/18和0/1核验；长/宽输出另有合同失配。 | 遗漏motorcycle_collision资格，头盔标记不能代替事故总体条件。 | `population.conditions` | 口径错；假定错 |
| local040 | 实际去重复树实验逐borough重现全部Gold均值；同ID完整重复代表同树是身份推断，保留政策限制。 | 6838完整重复树行被当独立树，AVG被重复实体重新加权。 | `population.entity` | 身份/物理前提错被写入口径；假定错 |
| local156 | 保留25个年度原始价格可核验Gold20个均价/同比与升序排名；输出顺序/排名方向不是题面唯一约定。 | 首年应作为LAG计算基线、仅输出时排除，agent先删再LAG。 | `population.conditions` | 口径错；题面引用错 |
| local228 | 离线展开原授权CSV后27条行关联完全等于Gold；业务数据并没有算错。 | 正确27对球员被横铺9行；Gold采用27行长表。 | `output` | 评分输出合同失配，非业务内容错误；— |
| local283 | 从所有联赛冠军取赛季全局最大，8个身份/积分全等Gold；额外rank1列是有效但未明示输出合同。 | 错误在season-country-league内选冠军，题意跨所有国家联赛每season选1。 | `grouping` | 口径错；假定错 |
| local302 | 现有授权全表最小值demographic,-2.01与Gold-2.008662在容差内；只应返回1类型。 | 题面要最负属性类型，却selection=n/a，交付五类排序而非argmin。 | `selection` | 口径错；误标不适用 |

### 模式A：限定条件和最终对象范围没有被完整兑现——3题

**local015、local283、local302。** 共性不是没有算数，而是回答集合偏离题意。

- 015只实现头盔条件，遗漏“motorcycle collisions”；佩戴组23个碰撞中只有18个摩托车碰撞，分母扩大，3/23→3/18。
- 283实现每联赛冠军，却不是“每season、across all countries and leagues”的全局冠军，90行→8行。讨论并列strict/include_ties只在错误排名域内调整，不能修范围。
- 302计算五类并排序已经正确，第一行就是Gold的demographic；但“最负的一类”最终选取被标n/a，5行→1行。

**字段问题**：条件、分组/排名域、最终selection都有声明或n/a，却没有逐句核验任务要求是否真正进入计算图。应核验“谁进入集合、在哪个域比较、最后返回哪些对象”，不是只检查字段齐全。

**最小回归检查**：头盔标记存在但motorcycle=0的事件必须排除；两个联赛分别100/70积分只返回全局100；两属性−2/−1只返回−2，排序全表不算完成argmin。

### 模式B：输出过滤提前破坏计算基线——1题

**local156。** 将“排除首年输出”当作LAG之前的总体过滤，2017被删除，2018同比全部NULL。实际25个region-year价格保留2017时，Gold20个均价/同比可核验；其升序排名也是这些价格的有效排名。原排名方向与显示顺序另属未唯一规定的约定，不混进这个业务错误。

**字段问题**：`population.conditions`缺少正确作用阶段；公式只登记均价ratio，没有完整同比依赖。SQL忠实执行了错误的阶段安排，不是修语法能解决。

**最小回归检查**：2017价100、2018价200，最终只显示2018，但同比必须100%，不能为NULL。先算LAG，再过滤显示年。

### 模式C：物理行被当实体，重复权重污染指标——1题

**local040。** 源树表690626行但683788个tree_id，6838行是完整重复。原只去重收入ZIP，树重复继续给均值加权；只去树完整重复即可逐borough复现全部Gold均值。独立人工首稿也犯此错，不能将其包装成模型/接口独有缺陷。

**字段问题**：实体和countGrain虽然已声明，但“一行一树”的物理前提未核查。原entity状态甚至是request，题面“树数量”并不能证明数据库行唯一。重复源行事实应由Schema/Profile检查，而不是靠题面引文给物理假定背书。相同tree_id/idx且整行相同代表同树是这里采用的身份判断，仍保留业务版本政策未审核的限制。

**最小回归检查**：同一树ID/全部字段重复两次不应多算一树；两树收入10/30，正确等树平均20，重复第一树不应变成16.67。

### 模式D：内容正确，但交付表示没有评分合同——1题，单列

**local228。** 原9行横表展开成season-position长表后，27条球员ID、runs、wickets及行关联全部等于Gold；比分、并列和配对不是错因。

这是**输出表示/评测合同失配，不是业务内容错误**。题面没有唯一规定横铺或长表，不能据Gold长表偏好反向宣称横表语义错误。若评测需要固定结构，必须提前给出合法的输出合同；不能要求模型运行时偷看Gold。

### 核心共同点

5题确定业务错误的相关节点**都可见**：015条件假定、040实体声明、156过滤声明、283分组假定、302selection不适用。SQL大多兑现了已写下的错误/不完整解释。因此本小样本优先提示的是**Spec内容及计算拓扑检查不足**，不是“再加节点”或“只优化SQL生成”。样本仅5题，不能把3/5当全评测错误分布，更不能据此比较新旧接口因果优劣。

## 4. 有价值但不得混入“Gold正确”样本的局部错误

| 题 | 已确定的agent局部问题 | 为什么不认证Gold整题正确 |
|---|---|---|
| local003 | 客户比率再段AVG被换成段SUM/SUM；候选均共享错误外层 | 金额组成price/payment/运费及段成员仍有未核验差异 |
| local060 | 声明pp_difference却输出fraction差，且字段内部单位矛盾 | 乘100仍不能解释其余符号/数值，Gold分母/城市口径未恢复 |
| local277 | 明确weighted regression被ordinary least-squares假定替换 | 具体回归对象/权重与Gold39.39未核验，不能称改WLS就完整恢复 |
| local358 | 自己声明user_id，却假定每物理行一用户并COUNT(*) | 用户身份业务定义与Gold参考日未确认，Gold320行也可疑 |
| local050 | 文档月均值ROUND2未在median前表达/实现 | 2021可见资格尚未裁决，局部舍入不能解释主体约51.54差值 |

这些局部案例提示：
- **嵌套聚合粒度**需逐层记录。两客户100/1与100/10，先客户平均为55，而段SUM/SUM约18.18；两个探针都遗漏正确外层时，比较不能救回答案。
- **量纲与字段内部一致性**需检查。份额10%→12%是2个百分点，不是0.02或20%；但本题其他数值仍需补证。
- **指定方法不能被方便方法替代**。CMA平滑权重不等于回归权重；未明确权重时应补证/披露，不能把OLS默认为已经完成加权回归。
- **中间舍入也是计算步骤**，不能只在最终output写decimals就以为内部量化顺序已完整表达。

混合错误064/066/354也可用于独立的局部回归测试，但不计入本报告“Gold正确→agent错误”的核心统计。

## 5. 仍未裁决的19题

这19题为：**002、037、050、056、059、061、067、070、131、168、169、195、269、273、279、285、311、335、336**。

- 037、050、061、067、070、131、168、269、273、285、335的差异机制已真实重建或拆解，但定义/资格/方向/分母等尚未唯一裁决。
- 056的缺月与signed/absolute解释均影响答案；195的租赁次数排名吻合Gold不等于“top actor”定义已确证。
- 059、311、336有评分/表示差异，仍有总体、数值或Pit18件残差；不能像228一样确认全部业务内容吻合。
- 002、169、279经过多个真实候选仍未恢复共同解释全部Gold的机制。

不能把它们统一当“Gold正确而agent错”，也不因未认证就统一标Gold错误。358是另列的1题Gold待确认，不在这19题中。

## 6. 下一步优先级

1. **先处理评测噪声**：将32个Gold局部问题放入复核队列；1个待确认单列。保留官方原分，不静默改Gold或把它们加成正确。
2. **补语义→计算图核验**：集合条件、排名域、最终对象、LAG/窗口支撑期及过滤阶段。五个核心业务案例各给最小反例。
3. **补物理事实与字段一致性核验**：业务键/重复行、方法权重、单位及中间舍入。声明request/assumed、Ready或已发布都不是业务正确性认证。
4. **明确输出合同**：业务内容与CSV布局分开验收。对228这类无唯一布局要求的任务，修评测契约，不把内容正确模型训练成口径错误。
5. **扩大干净样本后再做A/B**：目前只确认5个业务错误和1个合同失败，不据这些选择后的题推断字段树整体提升/劣化。

<a id="all-cases"></a>
## 7. 全部61题合并标记

| 题 | 标记 | 原61主标签 | 35重算主标签 | 核心模式样本 |
|---|---|---|---|---|
| local002 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local003 | [AGENT局部错误已证][GOLD整题未核验] | confirmed | — | 否 |
| local010 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local015 | [GOLD相关内容已核验][AGENT业务错误] | confirmed | — | 业务错误 |
| local037 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local040 | [GOLD相关内容已核验][AGENT业务错误] | unresolved | confirmed_semantic_error | 业务错误 |
| local049 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local050 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local056 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local059 | [GOLD未认证][不纳入确定业务错误模式] | confirmed | — | 否 |
| local060 | [AGENT局部错误已证][GOLD整题未核验] | confirmed | — | 否 |
| local061 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local064 | [GOLD有局部问题][AGENT也有局部错误] | unresolved | confirmed_implementation_error | 否 |
| local066 | [GOLD有局部问题][AGENT也有局部错误] | gold_conflict | — | 否 |
| local067 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local070 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local073 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local096 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local098 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local100 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local114 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local131 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local133 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local156 | [GOLD相关内容已核验][AGENT业务错误] | confirmed | — | 业务错误 |
| local167 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local168 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local169 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local170 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local171 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local194 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local195 | [GOLD未认证][不纳入确定业务错误模式] | probable | — | 否 |
| local196 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local220 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local228 | [GOLD相关内容已核验][AGENT输出合同失败] | confirmed | — | 仅表示合同 |
| local230 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local253 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local258 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local259 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local263 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local264 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local269 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local270 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local272 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local273 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local275 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local277 | [AGENT局部错误已证][GOLD整题未核验] | confirmed | — | 否 |
| local279 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local283 | [GOLD相关内容已核验][AGENT业务错误] | confirmed | — | 业务错误 |
| local285 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local286 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local297 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local298 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local299 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local302 | [GOLD相关内容已核验][AGENT业务错误] | confirmed | — | 业务错误 |
| local311 | [GOLD未认证][不纳入确定业务错误模式] | confirmed | — | 否 |
| local330 | [GOLD有局部问题] | gold_conflict | — | 否 |
| local331 | [GOLD有局部问题] | unresolved | gold_conflict | 否 |
| local335 | [GOLD未认证][不纳入确定业务错误模式] | unresolved | ambiguous_after_recompute | 否 |
| local336 | [GOLD未认证][不纳入确定业务错误模式] | confirmed | — | 否 |
| local354 | [GOLD有局部问题][AGENT也有局部错误] | unresolved | gold_conflict | 否 |
| local358 | [GOLD待确认][AGENT粒度矛盾已证] | unresolved | confirmed_implementation_error | 否 |

<a id="evidence"></a>
## 8. 原文依据索引

以下展示相关原文片段，完整引文与源pointer在`case-markers.jsonl`。片段不是完整Gold集合，缺席/全集约束仍需按链接的完整文件核对；不以摘要或单个数值贴合替代原始证据。714条源引文已逐字核验，覆盖61题，校验不执行SQL。

<a id="e-local010"></a>
### local010：任务文档要求无向城市对，实际最少箱3对；Gold6是有向两倍。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local010`：

```text
Distribute all the unique city pairs into the distance ranges 0, 1000, 2000, 3000, 4000, 5000, and 6000+, based on their average distance of all routes between them. Then how many pairs are there in the distance range with the fewest unique city paires?
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local010/attempts/attempt-001/trace.json`，pointer `/toolCalls/6/result/content/0/text`：

```text
5:[4000,5000) | 6
6:[5000,6000) | 3
7:[6000,inf) | 7
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local010.csv`：

```text
output
6
```

**边界**：无GoldSQL，附文不定义桶边界。；Gold SQL unavailable; directed variant is sufficient not unique internal explanation

<a id="e-local049"></a>
### local049：同公司ID被关联行重复计数：公司173/3=57.67，重复行179/3=59.67(Gold)。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local049`：

```text
Can you help me calculate the average number of new unicorn companies per year in the top industry from 2019 to 2021?
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local049/post-fintech-raw.json-response.json`，pointer `/details/preview/rows`：

```text
140
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local049.csv`：

```text
output
59.67
```

**边界**：Gold SQL未提供；未执行数据库SQL，不从不同数值恢复不可见口径。；date_joined event meaning not backed by reviewed business doc

<a id="e-local064"></a>
### local064：全年每月仅deposit−withdrawal且全500客户：唯一均值差557.704，Gold363.742不符；agent也遗漏无交易月份。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local064`：

```text
For each customer and each month of 2020, first calculate the month-end balance by adding all deposit amounts and subtracting all withdrawal amounts that occurred during that specific month. Then determine which month in 2020 has the highest count of customers with a positive month-end balance and which month has the lowest count. For each of these two months, compute the average month-end balance
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local064/publications/publication_4be5110e-1c5d-4d56-8de8-9ea8218c2a49/result.csv`：

```text
2020-01-01,424,557.704,2020-05-01,0,0,557.704
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local064.csv`：

```text
balance_diff
363.74199999999996
```

**边界**：Gold SQL缺失；全年缺月与全体客户政策细则缺证。；Gold SQL unavailable; numeric signature is not business evidence

<a id="e-local066"></a>
### local066：Gold包含已取消未送达订单，违反pizzas we delivered；agent还独立忽略加/去料。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local066`：

```text
Based on our customer pizza order information, summarize the total quantity of each ingredient used in the pizzas we delivered. Output the name and quantity for each ingredient.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local066/attempts/attempt-001/trace.json`，pointer `/toolCalls/11/result/details/artifact/preview`：

```text
{"columns": ["order_id", "pizza_id", "cancellation", "delivered", "total_rows"], "rows": [[1, 1, null, 1, 14], [2, 1, null, 1, 14], [3, 1, null, 1, 14], [3, 2, null, 1, 14], [4, 1, null, 1, 14], [4, 1, null, 1, 14], [4, 2, null, 1, 14], [5, 1, null, 1, 14], [6, 2, "Restaurant Cancellation", 0, 14], [7, 2, null, 1, 14], [8, 1, null, 1, 14], [9, 1, "Customer Cancellation", 0, 14], [10, 1, null, 1, 1
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local066.csv`：

```text
topping_name,topping_count
Bacon,14
Mushrooms,12
Chicken,11
Cheese,11
Salami,10
Pepperoni,10
Beef,10
BBQ Sauce,8
Tomatoes,4
Tomato Sauce,4
Peppers,4
Onions,4
```

**边界**：Gold与solver均有偏离；主分类Gold冲突不表示solver答案正确。

<a id="e-local073"></a>
### local073：订单10第一披萨无定制，Gold却输出第二披萨的加/去料结果，逐行身份冲突。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local073`：

```text
For each pizza order, provide a single result row with the row ID, order ID, customer ID, pizza name, and final set of ingredients. The final ingredients are determined by starting with the standard toppings from the pizza’s recipe, removing any excluded toppings, and adding any extra toppings. Present the ingredients in a string starting with the pizza name followed by ': ', with ingredients list
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local073/attempts/attempt-001/trace.json`，pointer `/toolCalls/5/result/details/artifact/preview`：

```text
{"columns": ["t", "order_id", "customer_id", "pizza_id", "exclusions", "extras", "order_time"], "rows": [["pizza_customer_orders", 1, 101, 1, null, null, "2021-01-01 18:05:02"], ["pizza_customer_orders", 2, 101, 1, null, null, "2021-01-01 19:00:52"], ["pizza_customer_orders", 3, 102, 1, null, null, "2021-01-02 23:51:23"], ["pizza_customer_orders", 3, 102, 2, null, null, "2021-01-02 23:51:23"], ["p
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local073.csv`：

```text
"order_id","customer_id","pizza_id","order_time","original_row_number","toppings"
1,101,1,"2021-01-01 18:05:02",1,"Meatlovers: BBQ Sauce, Bacon, Beef, Cheese, Chicken, Mushrooms, Pepperoni, Salami"
2,101,1,"2021-01-01 19:00:52",2,"Meatlovers: BBQ Sauce, Bacon, Beef, Cheese, Chicken, Mushrooms, Pepperoni, Salami"
3,102,1,"2021-01-02 23:51:23",3,"Meatlovers: BBQ Sauce, Bacon, Beef, Cheese, Chicken, 
```

**边界**：Gold SQL缺失，内部污染机制不可见；仅row13输入输出矛盾确定。

<a id="e-local096"></a>
### local096：Gold把未知演员/性别NULL影片算全女，违反no unknown/unspecified gender。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local096`：

```text
For each year, calculate the percentage of films that had exclusively female actors (meaning no male actors and no actors with unknown/unspecified gender). Consider actors with gender marked as 'Male' or 'None' as non-female. For the results, display the year, the total number of movies in that year, and the percentage of movies with exclusively female actors. Extract the year from the Movie.year 
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local096/attempts/attempt-001/trace.json`，pointer `/toolCalls/10/result/details/artifact/preview`：

```text
{"columns": ["movies_without_any_cast", "mcast_rows", "distinct_mid_in_cast"], "rows": [[0, 82837, 3475]], "columnTypes": ["INTEGER", "INTEGER", "INTEGER"], "rowCount": 1, "truncated": false}
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local096.csv`：

```text
"YEAR","TOTAL_NUM_OF_MOV","PERCENT_OF_MOV_WITH_ONLY_F"
1939,2,50.0
2018,104,1.9230769230769231
2000,64,1.5625
1999,66,1.5151515151515151
2009,110,0.9090909090909091
2012,111,0.9009009009009009
1931,1,0.0
1936,3,0.0
1941,1,0.0
1943,1,0.0
1946,2,0.0
1947,2,0.0
1948,3,0.0
1949,3,0.0
1950,2,0.0
1951,6,0.0
1952,6,0.0
1953,8,0.0
1954,6,0.0
1955,9,0.0
1956,6,0.0
1957,13,0.0
1958,9,0.0
1959,6,0.0
1960,14,
```

**边界**：Gold SQL/分子电影身份缺失；Person重复PID性别一致性未证。；Gold SQL缺失；重建NULL机制不是原标准SQL源码证据。

<a id="e-local098"></a>
### local098：Gold32585超过当前32127可识别出演者全集；原正确缺口计数28698。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local098`：

```text
From the first year each actor appeared in a film to the last, how many actors in the database never had a gap longer than three consecutive years without at least one new movie appearance, meaning there is no four-year span anywhere in their active career without at least a single film credit?
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local098/attempts/attempt-001/trace.json`，pointer `/toolCalls/15/result/details/artifact/preview`：

```text
{"columns": ["cast_rows", "distinct_cast_pids", "distinct_mids"], "rows": [[82837, 32127, 3475]], "columnTypes": ["INTEGER", "INTEGER", "INTEGER"], "rowCount": 1, "truncated": false}
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local098.csv`：

```text
output
32585
```

**边界**：Gold SQL/实体名单、年份解析及空主体政策缺失。；Gold生成机制/数据库版本未知，只确定当前出演者全集无法支持32585。

<a id="e-local100"></a>
### local100：当前完整合作图二跳且非直接合作者25698，Gold15911与明确完整图要求不兼容。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local100`：

```text
Find out how many actors have a 'Shahrukh number' of 2? This means they acted in a film with someone who acted with Shahrukh Khan, but not directly with him.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local100/attempts/attempt-001/trace.json`，pointer `/toolCalls/4/result/details/artifact/preview`：

```text
{"columns": ["srk_movies", "l1_incl_srk", "cast_rows", "cast_pids_with_lead_space", "distinct_pids", "dup_mid_pid_pairs", "pids_matched_person"], "rows": [[90, 2383, 82837, 82835, 32127, 0, 32127]], "columnTypes": ["INTEGER", "INTEGER", "INTEGER", "INTEGER", "INTEGER", "INTEGER", "INTEGER"], "rowCount": 1, "truncated": false}
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local100.csv`：

```text
output
15911
```

**边界**：Gold SQL/演员集合缺失，9787差异来源未知。；Gold只给总数，无法给出其具体遗漏人物；机制/数据版本未唯一定位。

<a id="e-local114"></a>
### local114：明确订单数应为897/2357/2024/1634，Gold9/21/10/10等于代表人数，其他列一致。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local114`：

```text
Provide a detailed web sales report for each region, including the number of orders, total sales amount, and the name and sales amount of all sales representatives who achieved the highest total sales amount in that region (include all representatives in case of a tie).
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-001/csv/local114.csv`：

```text
region,order_count,total_sales_amount,top_rep_name,top_rep_sales_amount
Northeast,2357,7744405.36,Tia Amato,1010690.6
Midwest,897,3013486.51,Charles Bidwell,675637.19
Southeast,2024,6458497,Earlie Schleusner,1098137.72
West,1634,5925122.96,Georgianna Chisholm,886244.12
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local114.csv`：

```text
region,total_orders,total_sales,top_selling_rep,max_sales
Midwest,9,3013486.51,Charles Bidwell,675637.19
Northeast,21,7744405.36,Tia Amato,1010690.6
Southeast,10,6458497.0,Earlie Schleusner,1098137.72
West,10,5925122.96,Georgianna Chisholm,886244.12
```

**边界**：GoldSQL缺失；代表人数来自本attempt explorer观测报告，不是业务定义。

<a id="e-local133"></a>
### local133：明确至少被排名一次，Gold仍含5个零偏好风格；差值与扩大到25风格平均相容。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local133`：

```text
Given a database of musical styles and user preferences, where Musical_Preferences contains user rankings of musical styles (PreferenceSeq=1 for first choice, PreferenceSeq=2 for second choice, PreferenceSeq=3 for third choice): Calculate a weighted score for each musical style by assigning 3 points for each time it was ranked as first choice, 2 points for each second choice, and 1 point for each 
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local133.csv`：

```text
StyleID,StyleName,weighted_score,abs_diff_from_avg
1,40's Ballroom Music,3,1.05
3,60's Music,3,1.05
4,70's Music,2,2.05
5,80's Music,1,3.05
6,Country,2,2.05
7,Classical,3,1.05
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local133.csv`：

```text
StyleName,score
40's Ballroom Music,0.2400000000000002
50's Music,3.24
60's Music,0.2400000000000002
70's Music,1.2400000000000002
80's Music,2.24
Country,1.2400000000000002
```

**边界**：GoldSQL缺失；Gold内部平均算法未直接可见。

<a id="e-local167"></a>
### local167：Gold含Katie Hill的CA43，但她任期不含任何12-31；有效CA42。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local167`：

```text
Based on the state each female legislator first represented, which state has the highest number of female legislators whose terms included December 31st at any point, and what is that count? Please provide the state's abbreviation.
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local167/ca-person-inventory.json-response.txt`，pointer `/details/preview/rows/0`：

```text
H001087
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local167.csv`：

```text
state,count_
CA,43
```

**边界**：GoldSQL/人员明细缺失；任期端点业务定义未提供。；Gold SQL缺失，不能确认生成43的真实机制

<a id="e-local170"></a>
### local170：Gold含PI，但当前PI全任期女性0，不可能男女各六期都非零。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local170`：

```text
Identify the state abbreviations where, for both male and female legislators, the retention rate remains greater than zero at specific intervals of 0, 2, 4, 6, 8, and 10 years after their first term start date. A legislator is considered retained if they are serving on December 31 of the respective year. Only include states where both gender cohorts maintain non-zero retention rates at all six of 
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local170.csv`：

```text
state
AK
AR
AZ
CA
CO
CT
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local170.csv`：

```text
state
AR
CA
CO
CT
FL
HI
```

**边界**：GoldSQL缺失；只证明PI矛盾，不宣称解释全部名单。；首次州/当时州及年龄对齐的Gold实现不可见。

<a id="e-local171"></a>
### local171：Gold可由未要求的1917..1999观察窗重现；合法31年末5人而Gold4，存在遗漏。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local171`：

```text
For male legislators from Louisiana, how many distinct legislators were actively serving on December 31 of each year from more than 30 years since their first term up to less than 50 years, grouping the results by the exact number of years elapsed since their first term?
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local171/comparison-input.json`，pointer `/originalSql`：

```text
WHERE t.state = 'LA' AND l.gender = 'M'
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local171.csv`：

```text
period,cohort_retained
31,4
32,3
33,3
34,3
35,2
36,1
```

**边界**：GoldSQL/人员明细缺失；资格阶段与锚点未确证。；Gold SQL缺失，不能证明Gold真实使用date dimension

<a id="e-local194"></a>
### local194：要求每演员Top3，Gold只给3电影；200演员不能被三片最多45人覆盖。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local194`：

```text
Please provide a list of the top three revenue-generating films for each actor, along with the average revenue per actor in those films, calculated by dividing the total film revenue equally among the actors for each film.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local194.csv`：

```text
actor_first_name,actor_last_name,film_title,film_revenue,revenue_per_actor,avg_revenue_per_actor
ADAM,GRANT,IDOLS SNATCHERS,114.7,14.34,20.31
ADAM,GRANT,GROUNDHOG UNCUT,102.82,14.69,20.31
ADAM,GRANT,SEABISCUIT PUNK,95.74,31.91,20.31
ADAM,HOPPER,TORQUE BOUND,198.72,39.74,26.98
ADAM,HOPPER,PRINCESS GIANT,142.74,28.55,26.98
ADAM,HOPPER,OPEN AFRICAN,113.79,12.64,26.98
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local194.csv`：

```text
title,rev_per_actor
YENTL IDAHO,135.77
MALTESE HOPE,123.78
GIANT TROOPERS,106.72
```

**边界**：GoldSQL缺失，内部排名金额无法恢复。；平均及排名细则有歧义，跨片AVG和总收入排序未独立证实。

<a id="e-local196"></a>
### local196：Gold五组后续次数可由付款行数−1重现，而真实租赁数不符；存在5笔rental_id NULL付款。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local196`：

```text
For each rating category of the first movie rented by customers—where the first movie is identified based on the earliest payment date per customer—please provide the average total amount spent per customer and the average number of subsequent rentals (calculated as the total number of rentals minus one) for customers whose first rented movie falls into that rating category.
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local196/parent-sakila-keys-response.json`，pointer `/details/preview/rows`：

```text
16049
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local196.csv`：

```text
"rating","avg_spend","avg_subsequent_rentals_number"
PG-13,115.24,26.38
PG,112.67,26.27
NC-17,111.94,25.37
R,111.42,25.49
G,110.66,25.32
```

**边界**：Gold SQL缺失，隐藏租赁计数实现未定。；Gold SQL缺失；只确认本次结果等价于错误付款事件计数，不断言其隐藏代码。

<a id="e-local220"></a>
### local220：Gold姓名可由同名合并重现：3个Marcelo胜301、5个Ricardo负163；独立球员赢家不同。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local220`：

```text
Which player has participated in the highest number of winning matches and which player has participated in the highest number of losing matches, considering only matches where they actually played (excluding null entries) and where their team won or lost (excluding draws)?
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local220/executor-events.jsonl`，pointer `/raw/rows/0`，行6：

```text
"Marcelo","Win",301,3
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local220_a.csv`：

```text
player
Marcelo
Ricardo
```

**边界**：Gold SQL缺失，无姓名合并观测。；Gold SQL absent: name-merging is experimentally sufficient, not proven to be Gold implementation.

<a id="e-local230"></a>
### local230：要求Top4导演，实际有四名各2片；Gold仅3人且电影计数等价类型连接行。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local230`：

```text
Determine the top three genres with the most movies rated above 8, and then identify the top four directors who have directed the most films rated above 8 within those genres. List these directors and their respective movie counts.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local230.csv`：

```text
director,movie_count
Anthony Russo,2
James Mangold,2
Joe Russo,2
Marianne Elliott,2
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local230.csv`：

```text
"director_name","movie_count"
James Mangold,4
Anthony Russo,3
Joe Russo,3
```

**边界**：Gold SQL缺失，数值吻合不证明Gold实现。

<a id="e-local253"></a>
### local253：同一个overall national平均被Gold变为随公司变化的20个值。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local253`：

```text
Using a Salary Dataset where the salary values need to be cleaned by removing non-numeric characters and converting them to a numeric type, write a detailed SQL query that identifies the top 5 companies by average salary in each of Mumbai, Pune, New Delhi, and Hyderabad, then compares each company’s average salary in those cities to the overall national average salary. The final result should disp
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local253.csv`：

```text
Location,Company Name,Average Salary in State,Average Salary in Country
Mumbai,Rahul Industries,6044006,767988.77
Mumbai,NVIDIA,4187500,767988.77
Mumbai,VINAYA KUMAR,4029337,767988.77
Mumbai,Goldman Sachs,3977066,767988.77
Mumbai,Zee Entertainment Enterprises Ltd.,3531413,767988.77
Pune,Atos,5273205,767988.77
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local253.csv`：

```text
"location","companyname","avg_sal_state","avg_salary_country"
Hyderabad,Qwerty Concepts,5081882.0,5081882.0
Hyderabad,SetuServ,4949704.0,4949704.0
Hyderabad,XYZ (Turkey),3000000.0,1510743.5
Hyderabad,ABCDEF,2745265.5,1643757.75
Hyderabad,MarketLinc,2658491.0,2658491.0
Mumbai,Rahul Industries,6044006.0,3037137.5
```

**边界**：Gold SQL缺失，Gold全国公式未定；多币种/年/月/小时，字面清洗未代表可业务比较。

<a id="e-local258"></a>
### local258：要求each bowler，Gold漏实际投球但零wicket者；其余球数/失分并未全面核验。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local258`：

```text
Calculate the total number of wickets taken by each bowler (excluding run-outs and other dismissals not attributed to the bowler), their economy rate (total runs conceded divided by total overs bowled, considering only runs scored off the bat and ignoring any extra runs like wides and no-balls), their strike rate (average number of balls bowled per wicket taken), and their best bowling performance
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local258.csv`：

```text
bowler_id,bowler_name,total_wickets,economy_rate,strike_rate,best_bowling
194,SL Malinga,143,6.31,16.01,5-12
136,A Mishra,123,7.13,19.37,5-17
71,DJ Bravo,122,7.9,16.54,4-21
50,Harbhajan Singh,119,6.8,22.46,5-17
67,PP Chawla,119,7.41,20.18,4-17
201,R Ashwin,100,6.29,22.66,4-34
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local258.csv`：

```text
"bowler","player_name","wickets","economy_rate","bowler_strike_rate","Best_Bowling_figure"
194,SL Malinga,159,6.0,15.138364779874214,"5-0"
71,DJ Bravo,137,7.558293838862559,15.401459854014599,"4-0"
136,A Mishra,131,6.955773955773957,18.641221374045802,"5-0"
50,Harbhajan Singh,128,6.630196936542669,21.421875,"5-0"
67,PP Chawla,126,7.325925925925926,19.285714285714285,"4-0"
81,R Vinay Kumar,117,7.95
```

**边界**：Gold SQL缺失；doc无具体dismissal/合法球映射；player35有事实无维表；数值错因未定。

<a id="e-local259"></a>
### local259：要求each player，Gold漏实际参赛/击球的McCullum/Ponting/Dravid，非未出场歧义。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local259`：

```text
For each player, list their ID, name, their most frequent role across all matches, batting hand, bowling skill, total runs scored, total matches played, total times they were dismissed, batting average (total runs divided by total dismissals), highest score in a single match, the number of matches in which they scored at least 30 runs, at least 50 runs, and at least 100 runs, total balls faced in 
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local259.csv`：

```text
player_id,player_name,most_frequent_role,batting_hand,bowling_skill,total_runs,total_matches,total_dismissals,batting_average,highest_score,matches_30plus,matches_50plus,matches_100plus,total_balls_faced,strike_rate,total_wickets,economy_rate,best_bowling
1,SC Ganguly,Captain,Left-hand bat,Right-arm medium,1303,57,52,25.06,91,20,7,0,1249,104.32,10,7.69,2-20
2,BB McCullum,Player,Right-hand bat,Righ
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local259.csv`：

```text
"striker","striker_name","role","batting_hand","bowling_skill","runs","matches","dismissals","batt_avg","Highest_score","thirties","fifties","hundreds","balls_faced_career","strike_rate","wickets_taken","economy_rate","best_bowling_figure"
1,SC Ganguly,Captain,Left-hand bat,Right-arm medium,1303,55,52,25.057692307692307,91,20,7,0,1291,100.92951200619676,12,7.694656488549618,"3-1"
4,DJ Hussey,Playe
```

**边界**：Gold SQL缺失；player35事实无维表排除；无得分记录球是否计面对球与dismissal归属未裁定。

<a id="e-local263"></a>
### local263：Gold108/234超过合法模型/状态步骤计数；漏step反事实可重现三倍值，但不证明Gold源码。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local263`：

```text
Identify the L1_model associated with each model (specified by name and version) that occurs most frequently for each status ('strong' or 'soft'), along with the number of times it occurs. A model has a 'strong' status if, for any of its steps, the maximum test score among non-'Stack' models is less than the 'Stack' model's test score. It has a 'soft' status if the maximum test score among non-'St
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local263/query-underkeyed-join-response.json`，pointer `/content/0/text`：

```text
108
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local263.csv`：

```text
status,L1_model,max_cnt
soft,regression,108
strong,regression,234
```

**边界**：Gold SQL缺失；实体一次/step/关联记录权重不等价，无业务裁定。；Gold SQL absent; incomplete join experimentally sufficient, not proven true implementation.

<a id="e-local264"></a>
### local264：合法同一步regression出现213；漏step反事实增加426跨步重复并重现Gold639。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local264`：

```text
Which model category (L1_model) appears the most frequently across all steps and versions when comparing traditional models to the Stack model, and what is the total count of its occurrences?
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local264/query-underkeyed-join-response.json`，pointer `/content/0/text`：

```text
426
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local264.csv`：

```text
L1_model,max_cnt
regression,639
```

**边界**：Gold SQL缺失，比较对象/传统集合/出现次数未定。；Gold SQL absent; underkeyed join is sufficient reconstruction, not proven exact code.

<a id="e-local270"></a>
### local270：根Pallet Mix SG内Bottle500cl两路径600+256=856>500，却被Gold漏掉。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local270`：

```text
Which top-level packaging containers, meaning those not contained within any other packaging, have any item for which the total quantity accumulated across all nested levels in the hierarchy exceeds 500, and what are the names of both these containers and the corresponding items?
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local270.csv`：

```text
top_container,item,total_quantity
Pallet Mix MS,Bottle 500cl,600
Pallet Mix SG,Bottle 500cl,856
Pallet of L,Bottle 500cl,864
Pallet of M,Bottle 330cl,720
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local270.csv`：

```text
p_name,c_name
Pallet of L,Bottle 500cl
Pallet of M,Bottle 330cl
Pallet Mix MS,Bottle 500cl
```

**边界**：Gold SQL缺失；这里只证明具体漏项，不推断Gold内部实现。

<a id="e-local272"></a>
### local272：产品6520需求40；Gold只拣14+12=26，违反需求守恒。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local272`：

```text
For order 423, identify the product IDs, aisles, and positions from which to pick the exact quantities needed for each order line, ensuring that the total picked quantity for each product matches the cumulative quantities ordered without exceeding the available inventory in warehouse 1. Calculate the quantities to be picked from each location by prioritizing inventory with earlier purchased dates 
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local272.csv`：

```text
product_id,aisle,position,pick_qty
4280,C,1,36
4280,D,18,24
6520,A,29,14
6520,C,13,20
6520,A,16,6
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local272.csv`：

```text
product_id,aisle,position,quantity_to_be_picked
4280,C,1,36.0
4280,D,18,24.0
6520,A,29,14.0
6520,C,13,12.0
```

**边界**：Gold SQL缺失，26的内部由来未定；多行序列在本订单没有触发。

<a id="e-local275"></a>
### local275：要求2017每月ratio>2，Gold包含实际零月产品，无法满足forall条件。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local275`：

```text
Based on monthly sales data starting in January 2016 and using a centered moving average to adjust for seasonality, which products had a seasonality-adjusted sales ratio that stayed consistently above 2 for every month in the year 2017?
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local275.csv`：

```text
product_id,product_name
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local275.csv`：

```text
product_name
Hazy Pink Cloud
Hoppy Crude Oil
Reindeer Fuel
Summer in India
```

**边界**：Gold SQL缺失；证实成员不满足forall，不反推它内部一定用MAX。

<a id="e-local286"></a>
### local286：Gold额外卖家仅54件/4795.91，却标108件/9591.82并越过>100资格。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local286`：

```text
Prepare a comprehensive performance report on our sellers, focusing on total sales, average item price, average review scores, and packing times. Ensure that the report includes only those sellers who have sold a quantity of more than 100 products and highlight the product category names in English with the highest sales volume.
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local286/probe-keys.response.json`，pointer `/details/preview/rows`：

```text
112650
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local286.csv`：

```text
"seller_id","product_cnt","avg_price","total_sales","avg_packing_time","avg_review_score","highlight_product"
febab0275244b9a49a623f0bd613ca2f,129,56.3753488372093,7272.42,1.8885301823272955,4.263565891472868,housewares
fe2032dab1a61af8794248c8196565c9,306,215.55428104575162,65959.61,1.9214672219050817,4.3841059602649,perfumery
fc906263ca5083d09dce42fe02247800,119,37.79579831932773,4497.7,2.181654
```

**边界**：Gold SQL未提供；未执行数据库SQL，不从不同数值恢复不可见口径。；54→108仅重现倍率，未确认Gold内部复制步骤或历史数据库版本。

<a id="e-local297"></a>
### local297：题面仅deposit/withdrawal，Gold36.4数值机制加入purchase等；明确算法结果54.2。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local297`：

```text
For each customer, group all deposits and withdrawals by the first day of each month to obtain a monthly net amount, then calculate each month’s closing balance by cumulatively summing these monthly nets. Next, determine the most recent month’s growth rate by comparing its closing balance to the prior month’s balance, treating deposits as positive and withdrawals as negative, and if the previous m
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local297/probe-null-abs-response.json`，pointer `/details/preview/rows/1`：

```text
36.4
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local297.csv`：

```text
output
36.4
```

**边界**：Gold SQL未提供，36.4%的分子分母不可恢复。；Gold generator SQL unavailable; exact numeric signature does not prove unique intended algorithm

<a id="e-local298"></a>
### local298：要求all users的前月正余额总额与Gold不符；排除本月不活跃者的反事实逐月重现Gold。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local298`：

```text
For each month, calculate the total balance from all users for the previous month (measured as of the 1st of each month), replacing any negative balances with zero. Ensure that data from the first month is used only as a baseline for calculating previous total balance, and exclude it from the final output. Sort the results in ascending order by month. 
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local298/probe-missing-users-response.json`，pointer `/details/preview/rows/2`：

```text
107824
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local298.csv`：

```text
month_,total_data_storage
2020-02-01,212579
2020-03-01,240602
2020-04-01,153147
```

**边界**：没有Gold SQL或客户月度余额明细，三个总额无法唯一恢复状态递推。；Gold SQL unavailable; reproduced current-active numerical signature not unique generator proof

<a id="e-local299"></a>
### local299：同日重复行＋31行窗口反事实精确重现Gold；其第30行仅28/29日，与明确30日要求冲突。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local299`：

```text
For a bank database with customer transactions, calculate each customer's daily running balance (where deposits add to the balance and other transaction types subtract). For each customer and each day, compute the 30-day rolling average balance (only after having 30 days of data, and treating negative averages as zero). Then group these daily averages by month and find each customer's maximum 30-d
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local299/probe-duplicate-days-response.json`，pointer `/details/preview/rows/3`：

```text
284935.45376344083
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local299.csv`：

```text
month,total_allocation
2020-02,284935.45376344083
2020-03,312844.32258064515
2020-04,170334.0
```

**边界**：月度合计不足以唯一识别窗口或日历差异。；Gold generator SQL unavailable; exact signature not unique program proof

<a id="e-local330"></a>
### local330：要求每页唯一会话数，Gold仅/detail一个路径且没有任何计数。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local330`：

```text
Using the activity log table, compute the total number of unique user sessions where each web page appears as either a landing page (the first page visited in a session based on timestamp) or an exit page (the last page visited in a session based on timestamp), or both. Count each session only once per page even if the page serves as both landing and exit for that session. 
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/inputs/attempt-20261010-154318Z/csv/local330.csv`：

```text
path,session_count
"",2
/,2
/complete,2
/detail,9
/detail/,9
/search_input,2
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local330.csv`：

```text
path2
/detail
```

**边界**：Gold SQL缺失，不能复原单行/detail来源。；不据此宣称预测9页计数在并列政策上唯一正确。

<a id="e-local331"></a>
### local331：Gold第三页面含END7，但实际没有END页面访问；合成终止不是第三次访问。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local331`：

```text
Which three distinct third-page visits are most frequently observed immediately after two consecutive visits to the '/detail' page, and how many times does each third-page visit occur?
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local331/end-is-not-observed.json-response.txt`，pointer `/details/preview/rows`：

```text
0
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local331.csv`：

```text
path2,count2
/detail,33
END,7
/,2
```

**边界**：无权威END定义，不能由7次反推精确算法。；Repeated rows and timestamp ties lack business event identities; retain rows and stable rowid ordering disclosed. Gold SQL unavailable but exact local category conflict verified.

<a id="e-local354"></a>
### local354：Gold仅3司机，漏明确合格Farina；agent另把Bill Aston非参赛记录当两round资格。

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local354`：

```text
Among Formula 1 drivers who raced during the 1950s, which drivers completed a season in that decade with the same constructor in both the first and the last race they participated in, while also taking part in at least two distinct race rounds during that season?
```

`D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/cases/local354/query-farina-strong-counterexample-response.json`，pointer `/content/0/text`：

```text
Alfa Romeo
```

`C:/data-agent-eval/Spider2/spider2-lite/evaluation_suite/gold/exec_result/local354.csv`：

```text
driver_id
501
554
579
```

**边界**：Gold仅3个ID无SQL和赛季，改投影不能单独修复104行。；Gold SQL absent; Gold3 mechanism not uniquely reconstructed.

### 核心模式的题面与成功Spec原文

#### local015

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local015`：

```text
Please calculate the fatality rate for motorcycle collisions, separated by helmet usage. Specifically, calculate two percentages: 1) the percentage of motorcyclist fatalities in collisions where parties (drivers or passengers) were wearing helmets, and 2) the percentage of motorcyclist fatalities in collisions where parties were not wearing helmets. For each group, compute this by dividing the total number of motorcyclist fatalities by the total number of collisions involving that group. Use the
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local015/attempts/attempt-001/trace.json`，pointer `/toolCalls/22/result/details/fields/2`：

```text
{"path": "population.conditions", "status": "assumed", "value": ["组A(helmet used)：碰撞中至少有一方 party 的 party_safety_equipment_1 或 party_safety_equipment_2 取值为 'driver, motorcycle helmet used' 或 'passenger, motorcycle helmet used'", "组B(helmet not used)：碰撞中至少有一方 party 的 party_safety_equipment_1 或 party_safety_equipment_2 取值为 'driver, motorcycle helmet not used' 或 'passenger, motorcycle helmet not used'", "条件作用于碰撞级资格总体（HAVING/EXISTS），不在聚合后过滤"], "rationale": "题面括号注明 drivers or passengers，与设备列中 'driver/passenger, motorcycle helmet used/not used' 四个观测取值一一对应；条件在碰撞级判定，避免 party 级多行影响碰撞计数。"}
```

**核验范围**：Gold两百分比按实际motorcycle分组3/18和0/1核验；长/宽输出另有合同失配。

#### local040

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local040`：

```text
In the combined dataset that unifies the trees data with the income data by ZIP code, filling missing ZIP values where necessary, which three boroughs, restricted to records with median and mean income both greater than zero and a valid borough name, contain the highest number of trees, and what is the average mean income for each of these three boroughs?
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local040/attempts/attempt-001/trace.json`，pointer `/toolCalls/33/result/details/fields/0`：

```text
{"path": "population.entity", "status": "request", "value": {"name": "individual tree record (one row of the trees table, identified by tree_id/idx); borough is the grouping attribute"}, "evidenceIds": ["evidence_bc723103-31d9-4108-b86c-9bb223938c02"]}
```

**核验范围**：实际去重复树实验逐borough重现全部Gold均值；同ID完整重复代表同树是身份推断，保留政策限制。

#### local156

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local156`：

```text
Analyze the annual average purchase price per Bitcoin by region, computed as the total dollar amount spent divided by the total quantity purchased each year, excluding the first year's data for each region. Then, for each year, rank the regions based on these average purchase prices, and calculate the annual percentage change in cost for each region compared to the previous year.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local156/attempts/attempt-20261010-154318Z/trace.json`，pointer `/toolCalls/20/result/details/fields/2`：

```text
{"path": "population.conditions", "status": "assumed", "value": ["txn_type='BUY' AND ticker='BTC'（仅比特币资产）；剔除各地区首年（year > 2017）"], "rationale": "题面称 'per Bitcoin'（每枚比特币的买入均价），而数据中 ticker 含 BTC 与 ETH（ETH 为以太坊，非比特币）。观测显示仅取 ticker='BTC' 时各地区各年均价（2017≈$3800–4000、2018≈$7600–8000、2019≈$7300–7700、2020≈$10300–11400、2021≈$44000–45000）与真实比特币年度均价高度吻合；若混入 ETH，均价被稀释至 $2000–33500，不再是比特币价格。故限定 ticker='BTC'，并剔除各地区首年（year > 2017）。"}
```

**核验范围**：保留25个年度原始价格可核验Gold20个均价/同比与升序排名；输出顺序/排名方向不是题面唯一约定。

#### local228

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local228`：

```text
For each IPL season, identify the top three batsmen with the highest total runs scored and the top three bowlers with the most wickets taken, excluding ‘run out’, ‘hit wicket’, and ‘retired hurt’ dismissals. In the event of ties in runs or wickets, break the tie using the smaller player ID. Then output these six players in matched positions—batsman 1 with bowler 1, batsman 2 with bowler 2, and batsman 3 with bowler 3—in ascending order of the season ID, along with each player’s total runs or wic
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local228/attempts/attempt-20261010-154318Z/trace.json`，pointer `/toolCalls/4/result/details/fields/14`：

```text
{"path": "output", "status": "assumed", "value": {"rowMode": "grouped", "rowCount": 9, "columns": ["season_id", "batsman1_id", "batsman1_name", "batsman1_runs", "bowler1_id", "bowler1_name", "bowler1_wickets", "batsman2_id", "batsman2_name", "batsman2_runs", "bowler2_id", "bowler2_name", "bowler2_wickets", "batsman3_id", "batsman3_name", "batsman3_runs", "bowler3_id", "bowler3_name", "bowler3_wickets"], "units": {"batsman1_runs": "runs", "batsman2_runs": "runs", "batsman3_runs": "runs", "bowler1_wickets": "wickets", "bowler2_wickets": "wickets", "bowler3_wickets": "wickets"}, "decimals": {"batsman1_runs": 0, "batsman2_runs": 0, "batsman3_runs
```

**核验范围**：离线展开原授权CSV后27条行关联完全等于Gold；业务数据并没有算错。

#### local283

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local283`：

```text
Analyze the soccer match dataset to determine the champion team for each season across all countries and leagues, awarding 3 points for every win, 1 point for every tie, and 0 points for every loss. For each season, return the champion’s team name, the league, the country, and the total points accumulated.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local283/attempts/attempt-20261010-154318Z/trace.json`，pointer `/toolCalls/17/result/details/fields/8`：

```text
{"path": "grouping", "status": "assumed", "value": ["season", "country", "league"]}
```

**核验范围**：从所有联赛冠军取赛季全局最大，8个身份/积分全等Gold；额外rank1列是有效但未明示输出合同。

#### local302

`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`，pointer `/question`，记录`local302`：

```text
Analyze the average percentage change in sales between the 12 weeks before and after June 15, 2020, for each attribute type: region, platform, age band, demographic, and customer type. For each attribute type, calculate the average percentage change in sales across all its attribute values. Identify the attribute type with the highest negative impact on sales and provide its average percentage change in sales.
```

`C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local302/attempts/attempt-20261010-154318Z/trace.json`，pointer `/toolCalls/17/result/details/fields/11`：

```text
{"path": "selection", "status": "not_applicable"}
```

**核验范围**：现有授权全表最小值demographic,-2.01与Gold-2.008662在容差内；只应返回1类型。


## 9. 验证与限制

- 61唯一题目、35子集关系、32确定Gold标记、6核心样本与3混合错误的集合关系均已校验。
- 原始源引文714条通过核验；Gold核心内容对照6例通过按业务键/行关联检查。local064追加标记的全年月份和唯一净额差已另核对。
- 本次不访问数据库、不重跑模型，不改官方Gold/评分；只基于此前真实执行记录、不可变发布CSV和原卷宗做合并复核。
- 没有声称Gold源码、原生成环境或所有样本业务定义都已核验。符合多个解释的题，仍然保留未决。
- 以前35题研究不是严格零先验盲实验，且探索预算较大；本合并沿用其证据边界，不据人工重算结果估计接口准确率。

历史材料：[61题审查](fieldtree-wrong118-20261010-analysis.md)、[35题实际重算](fieldtree-unresolved35-recompute.md)。本报告的新增标记不覆盖历史结论，local064增补与local358待确认状态有明确说明。
