# local010：Gold与明确对称城市对定义冲突

题目逐字：“all the unique city pairs”；“average distance of all routes between them”。业务文档haversine_formula.md逐字：“This ensures that a flight from City A to City B is treated the same as a flight from City B to City A.”；“dividing by the total number of flights between those cities”。半径原文：“approximately 6371 km”。

## 独立重算与关键证据
独立按机场坐标Haversine km，每航班一行、按字典序无向城市名归并、flight行权重平均、按0/1000/...6000+左闭右开分箱。冻结授权CSV结果 **3**，官方评分0，原结果也3，Gold为6。
33121航班/33121唯一flight_id、618有向机场路线、258无向城市对，航班总数守恒33121，无同城对。七箱计数依次 **92,93,37,20,6,3,7**，和258。机场多路线例Moscow-Ulyanovsk有4个无向机场组合、距离672.2644至742.8161，说明必须先按城市平均而非直接机场路线计数。
真实单变量实验：改成有向城市对，七箱变 **184,186,74,40,12,6,14**，最小6，恰好Gold；机场路线等权替代航班权重，七箱仍原样，不能解释本题失分。最少箱城市对及其正反向反例已分别查询保存于post-min-bin-pairs、post-directed-counterexample，原始数据见executor-events.jsonl。

## 三方结论与事后字段审查
独立SQL、原SQL都是文档明确支持的无向城市对，结果相同3。原成功Spec明确“unique unordered city pair, identified by standardized city names: lexicographically smaller city name as city1, larger as city2”，denominator为flight行数，旧SQL与之吻合。原Spec未丢对称性也未把航班数作为最终对数。
判为 **gold_conflict**：在文档对称性、6371km及常规区间定义下最少唯一城市对只有3，Gold6与之冲突。实验确定仅将方向计为独立对即精确得到6；这是一种足以解释全部标量失分的实现，但没有Gold SQL，不能断言Gold内部一定如此实现。不是原字段语义错误，错误可见性分类不适用；若强制比较与Gold等值的变体，最早分叉是population.entity的城市对对称键。

限制：英文城市名为实体键，区间解释为给定下界；Gold内部逻辑未知。官方按列评分不是关联正确性证明，但本题标量且原/独立相同。冻结早于揭示，所有SQL通过只读bridge。
