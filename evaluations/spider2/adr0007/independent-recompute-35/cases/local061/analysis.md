# local061：2021实际销售商品月资格解释全部月差异

## 结论
独立与原运行12个月逐键结果相同，官方均0。后验仅增同产品月2021有实际销量资格，即逐month业务键精确重现全部12行Gold。不是汇率、总体同比或嵌套AVG错误；**数值分叉已完整定位，业务资格仍未唯一证实**，status=ambiguous_after_recompute。

## 原文与自己的算法
blind.json `/question`："taking each product’s monthly sales from 2019 and 2020"；"for that same product and month"；"with the 2021 exchange rates"；"finally averaging and listing them by month"。
业务文档逐字 "Sum up the sales amounts for each product, country, month, and year."、"Apply this percentage change to the 2020 sales to estimate 2021 sales."、"Compute the average projected sales for each month in 2021, adjusting for currency conversion. Round the results to two decimal places."。因此自己的算法历史SUM→同产品月配对→2020*(1+(2020-2019)/2019)→2021FX→月均值ROUND2；不擅加2021实际销售资格。缺历史及基期0排除为假定。文档 "including sales amounts each month for the years 2019, 2020, and 2021."仅说收集，是否限定预测资格仍有歧义。

## 自由题解实际验证
本题重新登记任务并执行，未拿local050 Gold反推独立答案。currency法国2021每月唯一，全部1，故汇率年/默认率不是这次差异源。有效历史配对商品数47/52/46/43/46/46/49/51/53/52/49/56。实际增长反例prod_id118一月2019=16.3，2020=1227.04，增长74.27852760736197，预测92369.76451533742；没有因异常大增长静默截尾。
授权CSV publications/publication_38a25c9b-658e-4809-871f-d12c67586fb2/result.csv：月均预测4054.99/2402.89/2888.48/1474.10/2904.71/1440.35/1600.13/1392.60/2702.50/2218.77/3208.94/3062.66。final→freeze→reveal按序保存。

## 后验实验与三方差异
post-roster-rounding.response.json：同产品月2021非空后，商品数46/49/44/41/44/44/47/50/52/52/49/53；预测月均值4120.33/2454.40/2980.58/1517.54/3025.06/1482.95/1658.60/1419.89/2754.07/2218.77/3208.94/3131.66，逐键全部等于Gold，12个delta为0（post-keyed-gold-check.json）。10、11月有效总体未改变，Gold恰也未变。
真实排除反例：prod_id47一月2019销售242.33、2020销售504.28，预测1049.3885131845007，但无2021同月销量，Gold重现算法排掉它；2019/2020资料足够按题面预测。2月排除prod44/47/129，其他月相应改变分母。商品预测先ROUND2和不ROUND2在这12个2位月均值完全相同；不能据本题判定Gold是否先舍入产品预测。

## 事后字段审查
原成功Spec原文："A product is included for a month only if it has a summed sales amount in both 2019 and 2020 (so the growth rate is computable); products lacking either year are excluded, with no zero-fill."。原SQLSUM历史、NULLIF基期0、LEFT JOIN法国2021FX、ROUND(AVG,2)，在现数据正确实现原Spec，独立逐键复算也一致。相对Gold重现方案最早分叉population.eligibility，2021可见资格在原字段未声明；measure.denominator随之变化。原字段把历史配对标evidence，不代表用户确认目标年度销售资格。没有可确证的原实现错；业务资格有文档与题面表述张力，不能硬判原语义错。

## 限制
Gold SQL缺失但不妨碍完整数值定位。2021资格为何被参考结果采用仍属未证实；数值吻合不是业务定义。文档/题面没有规定缺历史补0，独立排除规则已披露。相近题先前可见，独立计划明确未把其Gold资格作为本题题解依据。发布不是正确性认证。
