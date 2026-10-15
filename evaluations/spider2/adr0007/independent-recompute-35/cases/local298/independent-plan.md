# local298 独立题解（揭示前）
原文："the total balance from all users for the previous month (measured as of the 1st of each month), replacing any negative balances with zero"；"data from the first month is used only as a baseline"；"exclude it from the final output"；"Sort the results in ascending order by month."。
独立理解：balance是累计账户余额，不是本月净流量。由于题面不定义交易类别，按账户现金流假定deposit正，withdrawal与purchase负。每月1日的余额为截至前月末（不包括当月1日交易）的累计额；先按客户计算累计、将每客户负余额裁0，再汇总所有客户。不得先截断月净额再累计，也不得先汇总所有用户再裁0。
取数据覆盖的连续日历月范围，每月×所有客户补零；首月作为基线，输出后续已有月份；不额外创建最后数据月之后的未来月。初始余额假定0。验证交易类型/范围、不同截断阶段的中间量、负值回升客户反例及当前月1日交易不进入当日月初余额。
