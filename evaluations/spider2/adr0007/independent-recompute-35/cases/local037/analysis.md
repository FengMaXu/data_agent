# local037：实际定位为支付事件 vs 使用支付方式的订单

## 结论
独立答案与原运行按业务键完全相同，官方分均0；Gold前三类别也相同，但数值正好是按支付方式去重订单数。**已完全解释数值差异，不把Gold吻合认定为原解语义错误。** 题面没有payment业务定义，保留`ambiguous_after_recompute`；文字更支持支付事件，Gold更像支付方式使用订单数。

## 原题逐字依据
blind.json `/question`："number of payments made in each category using that payment type"；"top three product categories"。业务文档为空；DDL逐字含 "payment_sequential BIGINT"，仅支持存在支付顺序列，不单独证明一次真实付款的业务定义。

## 独立算法与返回
先DISTINCT订单-类别，再接支付表；类别内支付方式计数取众数，再在类别间取前三。冻结前检查支付表103886行且103886个(order_id,payment_sequential)键。商品112650行，但订单-类别99470行，故直接商品×支付关联会复制支付。
授权CSV：publications/publication_caf1b2d3-4cce-44c1-b09d-c51ccedbd1f1/result.csv。
- cama_mesa_banho / credit_card：7565
- beleza_saude / credit_card：6898
- esporte_lazer / credit_card：5923
直接商品关联为8959/7566/6635。独立答案已final发布并freeze后才reveal。

## Gold及反例实验
post-grain.response.json实测每类credit_card：事件/订单/多余事件分别7565/7540/25、6898/6874/24、5923/5904/19。Gold逐行7540/6874/5904：三个差值全部由同一订单同支付方式多条支付记录解释。
post-counterexamples-optimized.response.json：订单041f09bbcd85d178903f5bb71f11a02e有credit_card顺序2,1，2条支付记录，总额279.20000000000005；另4个实际订单同样有两条。这不是商品关联造成重复，支付源键本来不同。以预聚合+JOIN取反例；此前相关EXISTS版本达到SQLite120秒上限，已supervisor批准保义优化，失败日志保留。

## 事后原Spec审查
original-spec-extract.json最后成功set（原record/events.jsonl第9937行）逐字："按付款事件计数：每个 (order_id, payment_sequential) 计一次付款（探索已证实该组合在 olist_order_payments 中唯一）"。总体实体也明确相同事件键，joinMultiplicity去重商品扇出；原最终SQL正确实现Spec，与独立算法一致。相对Gold的最早分叉为population.entity（支付事件 vs 订单），度量countGrain同步可见；不是已确认实现错。原探针只覆盖商品扇出与支付事件，未实验订单粒度是可见的备选遗漏；不因此声称框架造成失分。输出额外payment_type虽Gold不含，但题面可支持且真正数值差已定位。

## 限制
Gold SQL缺失，不声称它实际使用哪条SQL；仅确证DISTINCT订单算法逐类别重现Gold。没有已审核业务证据把payments唯一映射到事件或订单。空类别排除、跨类别支付重复归属与严格字典序tie为已披露独立假定。观测不是业务定义；Ready/发布不是正确性证明。
