# local273
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
