# Lane F 独立重算索引

全部五题已按“盲题解→实际SQL与中间验证→独立发布freeze→Gold→原Spec/SQL”的顺序完成；每题及时更新progress.json。每题analysis.md/analysis.json、plan、完整查询原始日志、授权CSV/receipt/query.sql、freeze均保留。工具发布不作为业务正确证明。

| 题目 | 独立答案 | 主要发现 |
|---|---|---|
| [local220](../../cases/local220/analysis.md) | Cristiano Ronaldo胜199；Gorka Iraizoz Moreno负107 | Gold Marcelo/Ricardo可由3/5个同名身份合并精确重现；局部身份冲突，非原字段错误 |
| [local263](../../cases/local263/analysis.md) | regression soft21/strong37模型 | 同步计步36/78；漏step关联实际108/234重现Gold；不能证明Gold真实SQL |
| [local264](../../cases/local264/analysis.md) | regression213步骤 | 漏step实际639，其中426跨步组合；成功比较候选114也不解释Gold |
| [local335](../../cases/local335/analysis.md) | Williams6、Toro Rosso5、Sauber3、Minardi3、Jordan2 | 两个不同积分/归属候选均重现Gold名称，真实实验后仍非唯一；保留未决 |
| [local354](../../cases/local354/analysis.md) | 103名司机，见授权CSV | Gold3人漏明确合格Farina；原104含只有1真实round的Bill Aston，局部资格错误不解释全部失分 |

所有独立官方分均0；评分不等于业务正确性。Gold SQL均缺失，重建候选只说明充分性。local220/335/354另存在输出列/表示差异；未将局部冲突冒充全部失分原因。local354编码故障立即报告父，由父修UTF8后同算法重试；未绕过适配器、未改公共代码。详细机器索引index.json，工件检查validation.json。
