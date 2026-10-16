# local050 独立题解（Gold前）
题面 "monthly sales data from 2019 and 2020 (filtered by promo_total_id=1 and channel_total_id=1)"，预测法国2021各商品每月销售，转换美元后求各月商品均值，再求这些月均值的中位数。

业务文档逐字 "Sum up the sales amounts for each product, country, month, and year."、"Determine how sales changed from 2019 to 2020 for each product and month."：不能先把全部商品总计再做总体增长。按客户国家France与渠道/促销total_id筛选，使用times日历年、月。先商品-月-年SUM(amount_sold)，将同商品同月2019/2020配对，预测2020²/2019。文档逐字 "Multiply the projected sales figures by the conversion rates to adjust to USD. If specific rates are not available, use a default rate of 1."：用currency法国2021对应月to_us，缺率1。文档逐字 "Round the results to two decimal places."：月均值先四舍五入2位，再取中位数，偶数月取中间两个均值。不使用实际2021销量。

未定义无2019或2019=0时同比，先查真实覆盖；暂定不可算的产品月不进入均值，不补零、不任造增长。检查历史键重复/币种重复、2021完整月份、增长分布，验证投影中间量与median排序。题面不要求月明细最终只交标量。