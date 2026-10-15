# local040：重复树记录被当独立树，已实测重建全部Gold均值

原题逐字：“highest number of trees”；“restricted to records with median and mean income both greater than zero and a valid borough name”；“average mean income”。无业务文档。

## 冻结的独立答案与自查错误
独立先做FULL ZIP JOIN、合并ZIP、正收入与非空borough筛选，按联合记录tree_count和树行加权AVG。冻结结果：Queens 256056 /79312.57225763114；Brooklyn 184711 /73675.97696942792；Staten Island 106374 /94029.32783386917，评分0。
**独立实现也有错误**：虽然探索已经看到690626树行但仅683788个tree_id、220收入行但仅216个ZIP，仍继续以原联合行计数，未在冻结前解决身份重复。不能把这份独立答案当标准答案。

## 真实实验与Gold核对
原SQL将收入按ZIP用MAX折成一行，结果Queens252846 /79366.73841785119、Brooklyn177132 /73555.19098751213、Staten Island106374 /94029.32783386917。
收入重复ZIP仅10463、11205、11218、11370，两行全部字段相同；因此MAX在现有数据不混合不同收入。树表SELECT DISTINCT *结果恰为683788，等于唯一tree_id，证明多余6838行是完整重复记录而非有意义版本。本题实际ZIP、borough都无NULL/空；有效borough恰五个官方名字。FULL JOIN组合705203行，收入单边31行；收入单边因无borough最终排除。
真实单变量改变旧SQL，只将trees替换成SELECT DISTINCT * FROM trees，得到：
- Queens **250364 /79366.23974692848**
- Brooklyn **175358 /73552.914734429**
- Staten Island **105318 /94026.03572038967**
三项均值按borough关联全部精确匹配Gold（Gold输出只有borough与mean_income）。按tree_id折叠产生同样结果；对两表全部字段DISTINCT再FULL JOIN也同样。只改树记录去重已足以解释原SQL全部数值失分。ZIP等权或家庭数权重已实测，均显著不同，不是差异根因。Gold原内部SQL未知，不声称唯一内部实现。

## 最后才看的原Spec
成功Spec实体原文：“individual tree record (one row of the trees table, identified by tree_id/idx); borough is the grouping attribute”；countGrain理由：“one row of trees is one tree”。joinMultiplicity只决策“duplicate income zips handled so tree count is not inflated”，未识别树自身完整重复。formula明确树记录加权，旧SQL与之一致。
最早分叉population.entity：将物理行等同独立树，没有树实体键去重；随后countGrain和denominator使重复树增加权重。不是SQL漏做已声明的树去重，而是身份语义与键唯一性未求证（Spec可见但含混，实体/计数/分母有文本，缺重复树处置）。收入去重方向正确，不能因失败强说应ZIP等权。

## 结论和限制
confirmed_semantic_error（重复树行实体化）；另明确独立_solution_error已自认。按同tree_id且全部字段相同的树记录应代表同一棵树是合理身份推断，题面没有专门重复数据业务文档，不能把观测提升为已审核业务规则。局部重复事实和精确Gold重建均确证；Gold内部去重步骤不唯一。额外tree_count仅解释排名并非Gold要求的输出列；冻结答案不更改、不用探索结果重新交付。
