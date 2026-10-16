# local037 独立题解（揭示前）
题目："Identify the top three product categories whose most commonly used payment type has the highest number of payments across all categories, and specify the number of payments made in each category using that payment type."

先计算每个类别、支付方式的支付记录数，找到类别内最常见方式，再在这些类别的最大支付记录数之间取前三。支付记录按(order_id,payment_sequential)识别；一个订单同类别多个商品不应复制同一支付。一张跨类别订单的支付会分别归属于每个涉及类别，此处没有支付分摊要求。未指定时间/订单状态筛选。类别使用原始葡语名；未知类别不作有名类别纳入。先检查支付键、商品键和重复关联，比较去重订单类别关联与直接商品关联的实际差异。并列方式按支付方式字典序选一，并列类别按类别字典序截取三，披露无题面规定的tie规则。这些粒度与空类别处理属于独立假定，不是业务文档事实。