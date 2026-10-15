# local299 独立题解（揭示前）
原文："each customer's daily running balance (where deposits add to the balance and other transaction types subtract)"；"For each customer and each day"；"30-day rolling average balance (only after having 30 days of data, and treating negative averages as zero)"；"first month of each customer's transaction history as the baseline period and exclude it from the final results"。
逐客户逐日把同日交易合并为净额，补连续日历日；日末累计余额初始0（不截单日余额），对含当日的前30日余额平均，满30个日历观测才有效，平均之后将负值裁0。每客户每月取有效日平均的最大值，再对所有客户求和。客户首交易月仅从月级输出排除，不能先删基线交易/日历，否则窗口与累计失真。
历史起点为客户首交易日，终点选全库最后交易日作为共同数据观察截止（无交易日余额延续，不在客户最后交易日停止；不向未观测月底外推）。共同截止及初始余额是独立披露假定。验证30日窗口包含当前日的边界、29/30/31日计数、无交易日延续、同日多交易不变成多日，以及负余额平均前截断与平均后截断的区别。抽样输出30日SUM手工除30与窗口结果核对。
