# local297 独立题解（揭示前）
原文："For each customer, group all deposits and withdrawals by the first day of each month to obtain a monthly net amount"；"closing balance by cumulatively summing these monthly nets"；"the most recent month’s growth rate"；"if the previous month’s balance is zero, the growth rate should be the current month’s balance multiplied by 100"；"percentage of customers"。
先从deposit/withdrawal逐月净额，purchase不计，再以零初值累计。对每客户在其最后一个deposit/withdrawal发生的日历月，比较该月与前一个日历月closing；中间缺月按0净额延续余额。非零前月分母为有符号前月余额，而非绝对值；增长百分数=(本月closing-前月closing)/前月closing*100；零前月按题面本月closing*100，严格>5。
“most recent”存在全库末月与每客户末月的歧义。因题面以For each customer统领，独立采用每客户最近指定交易月，覆盖所有客户；不将仅purchase的月份当指定净额的末月。先实际检查末月分布、缺月、负分母反例和累计恒等式，并在freeze中披露选择。
