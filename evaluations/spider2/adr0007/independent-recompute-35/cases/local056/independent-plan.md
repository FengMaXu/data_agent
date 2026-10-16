# 独立题解（揭示Gold前）
原题："Which customer has the highest average monthly change in payment amounts? Provide the customer's full name."
题面没有定义monthly change为金额差还是百分比、正负差还是绝对差，也没有规定缺月。业务文档为空。
我的主解释：每位客户先按payment_date的年-月汇总payment.amount，再按时间排序，对相邻有付款月份求有符号金额差（本月减上月），平均这些差。第一期无差而非0。不填补无观测月份。最高者保留全部并列，按customer_id确定实体后输出姓名。
理由：amounts指金额，change没有rate/absolute；月总额体现该月支付规模。数据库跨度、空值、间隔月和备选（月均交易金额、绝对差、百分比、补零）实际探索，披露无法由题面裁决的部分。
