# Lane A 独立重算索引

全部逐题先自由推导、实际查询、发布冻结，再揭Gold，最后看原Spec/SQL。validation.json记录25项完整性/顺序/引文检查全部通过，80条真实数据库SQL；五题官方独立评分均0，不据此否定业务解或证明Gold正确。

| 题目 | 状态 | 经实测定位 |
|---|---|---|
| [local002](../../cases/local002/analysis.md) | ambiguous_after_recompute | 金额日历OLS精确复现旧4340.10；单位、缺期、日序、订单状态/单数多变体均未恢复Gold14334.62114 |
| [local010](../../cases/local010/analysis.md) | gold_conflict | 文档明确无向城市对最少3；仅方向拆开，各箱全部翻倍，得到Gold6 |
| [local040](../../cases/local040/analysis.md) | confirmed_semantic_error | 旧SQL漏树自身完整重复；只树表DISTINCT即恢复三项Gold均值。独立冻结解也漏重复，已明确承认 |
| [local049](../../cases/local049/analysis.md) | gold_conflict | 独立公司173/3=57.67；六公司重复关联后179/3=Gold59.67 |
| [local168](../../cases/local168/analysis.md) | ambiguous_after_recompute | 短标题、具名技能、技能均薪等权三改变精确得Gold101300；实际只有2具名技能，业务分母未唯一确定 |

每题analysis.json包含分叉、层次、可见性和逐字证据；independent-plan.md、independent.sql、授权publications/<receipt>/result.csv、receipt、freeze、executor-events、tool-events及所有实验输入/返回均保留。progress.json每题完成即更新。

风险：无Gold SQL，等值变体是充分重建而非唯一内部解释。实体重复作为同一实体的身份判断、销售单位、标题字段及收入/薪资权重存在未审核业务假定；不能把观测当定义。没有运行原runner、绕过bridge、修改公共代码或数据库、派代理、commit/PR。
