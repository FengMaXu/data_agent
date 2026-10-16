# local064 独立题解（揭示前）
题面原文："first calculate the month-end balance by adding all deposit amounts and subtracting all withdrawal amounts that occurred during that specific month"。因此本题的 balance 是当月 deposit-withdrawal，不是累计余额；purchase 不能擅自计作 withdrawal。
原文："For each customer and each month of 2020"、"across all customers"。构建全年12个月×客户的日历脊，无当月指定交易的客户记0；客户全集先取 customer_nodes，检查与交易客户集合是否一致。每月正余额人数、所有客户平均余额，再挑人数最多/最少月，差为最多月均值减最少月均值。题目未指定并列：若存在并列，以最早月确定输出并披露，这只是独立假定。
验证：查看交易类别/日期范围/客户集合；列出12月人数、均值、净额；抽样月净额与累计额对照。允许探索证明数值，不将观测变成业务定义。
