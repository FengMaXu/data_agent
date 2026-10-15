# local070 独立重算与事后审查
结论：连续日期岛无误，全部失分能定位到“同日选哪城”；但业务规则不唯一，保留 ambiguous_after_recompute。

## 题面与独立解
原文："shortest and longest streaks of consecutive date entries"；"return exactly one record per date along with the corresponding city name"。无业务文档。
去重日期→日历连续岛→最短/最长→每日期最小city_id代表城。岛长度8、2、3、13；最终15日期，07-12..13和07-19..31。完整计划、SQL、CSV与freeze已先于reveal保存。

## 实测和三方对照
独立官方分1，原分0；不仅列集合匹配，按日期键逐行相等Gold。原SQL实测重跑一致，仍为15行、完全相同日期。改变唯一变量代表城为最小city_id即全匹配。原词典序选择导致6日期不同：12、19、23、27、29、30（key-comparison.json完整列表）。反例：07-12有 Xiaoganzhan、Qingyang、Guangshui、Gaotan、Hejiaji；MIN名称=Gaotan，而最小ID=Xiaoganzhan。probe返回保存在executor-events.jsonl / representative-counterexamples.json-response.txt。观测只是解释Gold，不是业务定义。

## 原Spec事后
trace工具/toolCalls/13成功决定measure.formula："故选字典序最小 city_name 作为该日期的代表城市（可确定、可复现）。此为未证实业务假定，发布时披霞。"。此前最小ID候选两次决定失败，最后采用字典序；SQL忠实实现最后决定，不是实现漏项。最早分叉measure.formula，候选、不同输出和假定在接口均可见。不存在可证明的Gold矛盾：两种代表城都符合一日一城。不能把独立得1分推成原业务错误，也不据此评价框架因果效果。

## 未证实
最小ID是否代表插入先后未由DDL或文档定义；没有Gold SQL，但真实单变量实验已解释全部差异，不以缺SQL停止。
