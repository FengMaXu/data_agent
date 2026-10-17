# local049：Gold对应重复关联行计数，非独立公司数

原题逐字：“average number of new unicorn companies per year in the top industry from 2019 to 2021”。无业务文档。独立将new视为date_joined，不视为创立year_founded；top为这三年累计新增最多行业，逐公司ID计数、三年等权平均。

冻结发布：Fintech，**57.666666666666664**；原SQL取两位 **57.67**；Gold **59.67**；官方独立评分0。
真实数据库键检查：两个维度均1085行、1074唯一company_id，SELECT DISTINCT全行后均1074；每ID只有一个日期/行业，无版本或多行业差异。独立年度Fintech新增为 **20,15,138**，合173；次名Internet software & services合152。按2019..2021创立年份Fintech仅18/3=6，不能解释Gold。每年取当年top再平均为59.333333333333336，也非59.67。

## 单变量实验与反例
直接原维度JOIN、COUNT(*)，Fintech年度记录 **21,18,140**，总179/3=59.666...四舍五入 **59.67**，精确复现Gold。比公司数多6行；反例公司ID **109、162、316、318、450、983**各关联出2行，日期同一，业务上不是两家公司。所有重复全字段相同，无可见理由按两个独立公司计入。额外行仅改变计数，Fintech仍top，所以可足够解释全部标量数值失分；Gold内部SQL未见，不说唯一生成逻辑。

## 事后字段审查
原成功Spec实体键company_id，eligibility“Each unicorn company counts once”，joinMultiplicity明确“count each distinct company once per year (deduplicate) so a multi-row company does not inflate the count”，formula count_distinct再年avg，denominator3，timeField date_joined、top3年总数。旧SQL与独立算法一致，最后成功写入均覆盖这些关键语义，未发现原字段漏声明或实现不遵从Spec。原timeField决策被标verified不代表date_joined语义有业务文档支持；这里只是合理未证实映射。
结论 **gold_conflict**：在“公司”按相同company_id视为一公司这一身份解释下，Gold与公司数守恒冲突。原实现不是confirmed_semantic_error；最早Gold等值变体分叉在population.entity/joinMultiplicity的公司与关联行粒度。不能把匹配Gold的COUNT(*)提升为标准口径。

限制：date_joined是新增独角兽事件、top按新增总数、同ID为同公司均属有理由的解释而非已审核业务定义；无Gold SQL，精确重建是充分解释不是唯一解释。输出行业额外列不构成数值差异原因，官方比较忽略列名。未将揭示后探针重新交付。
