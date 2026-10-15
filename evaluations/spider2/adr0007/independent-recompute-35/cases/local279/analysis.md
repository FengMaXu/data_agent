# local279
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
