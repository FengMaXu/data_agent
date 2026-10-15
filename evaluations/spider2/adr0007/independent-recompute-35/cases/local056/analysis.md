# local056：实际复算后口径仍未唯一确定

## 结论
独立冻结答案为 **HECTOR POINDEXTER**，官方比对0；原答案MICHEAL FORMAN，Gold为STEPHEN QUALLS。真实实验定位到两个足以改变赢家的选择：是否只允许日历相邻月份，以及有符号差还是绝对差。观测月绝对差恰好完整复现Gold，但不能据此宣称Gold口径是业务事实。

## 题意与独立推导
原题逐字："Which customer has the highest average monthly change in payment amounts? Provide the customer's full name."
无业务文档；DDL逐字片段："amount DECIMAL(5,2)"、"payment_date TIMESTAMP"。题面未规定absolute、rate或缺月策略。Gold揭示前按客户ID汇总年月付款总额、相邻有付款月有符号差、平均非首期差、取所有最大者；详见independent-plan.md及independent.sql。

## 数据与中间量
02-profile实际发现付款月份2005-05/06/07/08及2006-02；有缺月，不能混同相邻观测与相邻日历。
03-top-signed：HECTOR(487)平均32.45，两差；MICHEAL(445)平均30.44，两差。
96-three-customer-months：487的6/7/8月总额3.99/46.86/68.89；445的5/7/8月5.98/29.90/66.86；332(STEPHEN)的5/7/8月10.98/78.83/28.91。
332有符号平均(67.85-49.92)/2=8.965，绝对平均(67.85+49.92)/2=58.885。
04-alternatives在揭示前已经算出：观测月绝对差STEPHEN 58.885；变化率及月内平均金额差均为ASHLEY RICHARDSON。05-calendar-zero补全日历零月有符号差赢家CATHY SPENCER。
94-original-replay真实复跑原SQL仍为MICHEAL；其仅有7→8的日历相邻差36.96；95-abs-adjacent只改单变量为日历相邻绝对差时赢家WADE DELVALLE 55.37，非Gold。故从原SQL复现Gold需同时允许跨缺月观测并取绝对差；不是只加ABS即可。

## 三方及事后字段审查
freeze 2026-10-11T09:01:57.631Z后才reveal，随后compare_csv.py评分及原trace审查。原最终成功Spec population.missing逐字："不补零（无业务证据证明缺月代表零活动）；只在两个日历月份严格相邻（如 2005-07 与 2005-08）时计算一次月度变化；跨月缺口（2005-08 → 2006-02）不计作“月度变化”而被排除。" 原SQL用月份减1自连接实现此选择。measure.formula为signed difference而非ABS；实现与Spec基本一致。最早分叉population.missing/eligibility在前，measure.formula第二；两项在树上可见但均无题面唯一裁决。原理由中把金额difference称“绝对差值”不等于数学ABS。

## 限制
Gold SQL不存在并未阻止调查；上述原始SQL、候选、中间量均由只读桥真实执行。足以解释赢家变换的候选已定位，未足以证明唯一意图；保留ambiguous_after_recompute，不夸大成confirmed_semantic_error或gold_conflict。发布Receipt/CSV、freeze、executor-events.jsonl是独立计算链；工具Ready不作为正确性证据。首次序列化conditions空列表及selection数组被接口拒绝；修正为n/a和字符串orderBy，算法未改变，故障已上报supervisor。
