# local285
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
