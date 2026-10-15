# local285 独立题解（揭示前）
原文："financial performance over the years 2020 to 2023"；"average wholesale price, maximum wholesale price, minimum wholesale price, wholesale price difference, total wholesale price, total selling price, average loss rate, total loss, and profit for each category within each year"；"Round all calculated values to two decimal places."。
没有业务文档定义total price、loss或profit，DDL只有每日SKU批发单位价格、零售数量/单价与单品损耗率，没有采购数量或库存。因此财务总成本/利润只能按明确披露的估计模型计算，不能称确证会计事实。
独立选择：批发均值/最大/最小/差幅取该分类年每日SKU报价，无销量重复权重；总批发成本为净售量×同日同SKU批发价；总销售额为净售量×成交单价（售价已为实际价格，不再叠乘discount字段）；分类损耗率取该年报价SKU的单品率算术平均。若loss rate为采购量中损耗占比r，净售量q需要采购q/(1-r)，额外损失成本为q*w*r/(1-r)，profit=销售额-已售单位批发成本-损失成本。该模型损耗分母与售价处理未被业务证据证实。检查sale/return数量是否已经有符号；精确同日缺价不使用随意未来价格或默认为0，输出缺价覆盖验证。
先验证日期、主键重复、成交类别、负数量、匹配覆盖，抽一个类别年份手工核验成本/损失/利润恒等式，真实SQL产出后冻结。
