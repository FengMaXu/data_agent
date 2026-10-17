# local050：Gold被2021商品月可见性+单商品预测舍入精确重现

## 结论
独立发布2552.695 USD，原2552.70，Gold2604.2362912087915。已实际计算而非停在缺Gold SQL：**限定历史配对商品月同时存在2021销售，并对每个商品月预测先ROUND(...,2)，再计算未舍入月均值的median，精确重现Gold**。主要差异来自2021可见商品月总体；题面只要求2019/2020用于预测，没有明确要求2021有实际销量。该隐含资格仍不能唯一确证。最终status为ambiguous_after_recompute，另有明确局部舍入层级差异。

## 业务原文
blind.json `/question`："monthly sales data from 2019 and 2020 (filtered by promo_total_id=1 and channel_total_id=1)"、"determining the monthly averages before finding their median"。
projection_calculation.md（blind.json `/documents/projection_calculation.md/content`）逐字：
- "Sum up the sales amounts for each product, country, month, and year."
- "Apply this percentage change to the 2020 sales to estimate 2021 sales."
- "Multiply the projected sales figures by the conversion rates to adjust to USD. If specific rates are not available, use a default rate of 1."
- "Compute the average projected sales for each month in 2021, adjusting for currency conversion. Round the results to two decimal places."
文档还写 "including sales amounts each month for the years 2019, 2020, and 2021."；它支持收集2021，但不明说要仅预测2021已销售的商品月，和题面基于历史预测之间有余留歧义。

## 独立算法及真实中间量
历史按prod_id、calendar_month_number、calendar_year SUM金额，France和两个total_id=1；配对a19>0、a20非空；预测a20²/a19，2021月汇率乘法，缺率1；各月商品均值ROUND2，12个月取中间两个。实际法国currency2019-2021共36条、每年各12月，全部to_us=1：汇率选择与缺率补1不造成这次差值。
12月配对商品数47/52/46/43/46/46/49/51/53/52/49/56；月均值4054.99/2402.89/2888.48/1474.10/2904.71/1440.35/1600.13/1392.60/2702.50/2218.77/3208.94/3062.66。排序中间是2402.89及2702.50，median2552.695。无零2019，缺2019产品月每月12-20个，缺2020每月0-5个；并非完整历史面板。
授权CSV publications/publication_ebad7921-f825-4269-bf4c-fa5f9a82ea3d/result.csv；算法/SQL/结果freeze先于reveal。

## 后验单变量实验
post-roster-variants：全历史配对、不舍入median2552.6959807204075；加2021有销量资格变2604.236129353304（解释几乎全部差值）。补缺历史零方案为1988.9777693928731或1875.6139858014071，不能重现Gold，且没有文档要求。
post-roster-monthly：2021资格后每月有效商品46/49/44/41/44/44/47/50/52/52/49/53；中间2月及9月均值2454.400658113617及2754.0716005929908。post-product-rounding只再将商品预测ROUND2：二者2454.4014285714284及2754.071153846154，中位数2604.236291208791，和Gold浮点表示一致。此实验不是重新发布答案、更不是Gold业务口径已被证实。

## 事后原Spec/SQL审查
原Spec明确 "Only product-month cells that have sales in BOTH 2019 and 2020"，与独立总体相同。原公式也是商品预测→月均值→median，SQL正确实现其主要嵌套；总体相对重现Gold的最早分叉为population.eligibility，且原字段未包含2021资格。不是AVG/median层级颠倒。
原SQL只在最终median ROUND2，没有按文档先对月均值ROUND2；这是可确证的局部实现/输出层级差异，独立结果与原结果只差0.005，不能解释整个约51.54的失分。Gold重现则舍入商品预测而非文档月均值，存在局部gold_conflict候选，但舍入造成的差仅0.000162，不可扩大成全部失分解释。

## 未证实与限制
无Gold SQL；实验只证明两个操作精确重现Gold，不断言Gold源代码如此。2021资格不唯一，缺基期产品月不投影为独立披露假定。实测所有汇率1，不是美元普遍等于法国本币的业务规则。官方分0不否定题面/文档支持的自由题解；发布Ready也不证正确性。
