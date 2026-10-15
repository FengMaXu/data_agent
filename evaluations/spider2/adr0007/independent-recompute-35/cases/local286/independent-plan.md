# local286 独立题解（Gold前）
原题逐字 "performance report on our sellers, focusing on total sales, average item price, average review scores, and packing times"、"sold a quantity of more than 100 products"、"product category names in English with the highest sales volume"。以seller_id为卖家身份，一行一卖家。销售量是order_items行数（无quantity字段，每条商品明细代表一件），严格>100，不是不同product_id数量；销售额SUM(price)，商品均价AVG(price)，均不把freight计入商品收入。暂纳入全部记录商品，不以未要求的delivered状态替换销售范围；须检查取消等实际覆盖并披露。

评论按每卖家所涉订单集合关联order_reviews，每条评论记录一次，避免订单内多商品复制评分快照；不假装评分本来seller级。packing times以order_approved_at至order_delivered_carrier_date的天数近似，每seller/order计一次，无法获取卖家独立包装事件。起点题面未定义；审批到交承运商较贴近可处理到发出的时间，但不是正式业务定义。缺事件或负时间不纳入有效packing均值，其余销售不删除。最高销售量类别按每卖家order_items单位数而非销售额；英文翻译左连接，缺译保留原名并披露。并列最高类别全保留，分号联结成一列。

先实查键/缺失/订单状态/评论扇出/时间负值、类别量额最高是否分叉，再验证完整report。独立最终只从final Candidate授权CSV交付，所有探针为内部验证。