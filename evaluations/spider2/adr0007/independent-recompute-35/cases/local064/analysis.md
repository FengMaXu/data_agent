# local064
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
