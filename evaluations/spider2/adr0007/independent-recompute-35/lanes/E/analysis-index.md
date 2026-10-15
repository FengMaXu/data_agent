# Lane E 独立重算索引

全部5题先独立SQL实算、final发布并freeze，再揭示Gold及原SQL/Spec。60次实际只读SQL（含5个最终查询），执行均经过answering_bridge.mjs。progress.json逐题更新。artifact-checks.json验证5条CSV/SQL/receipt/freeze链、freeze早于reveal及逐字引文路径。

| Case | 独立分 | 结论 | 审查 |
|---|---:|---|---|
| [local070](../../cases/local070/analysis.md) | 1 | 全部6城差异定位到同日代表城；规则未明示，ambiguous_after_recompute | measure.formula显式待定后未证实决定 |
| [local167](../../cases/local167/analysis.md) | 0 | CA42；Gold43包括无任何年末任期的Katie Hill，gold_conflict | 原条件正确，非原实现错 |
| [local169](../../cases/local169/analysis.md) | 0 | cohort4033；周期/删失/周年/端点/实体重复等实测仍无唯一Gold解释，ambiguous_after_recompute | 原population.time决定清楚，但不解释全部失分 |
| [local171](../../cases/local171/analysis.md) | 0 | 原/独立仅加未请求1917..1999观察窗即完全匹配Gold，gold_conflict | 首州/任一LA另有未决；原SQL忠实 |
| [local358](../../cases/local358/analysis.md) | 0 | 原Spec用户键但COUNT320重复行、只有30用户，confirmed_implementation_error；raw Gold全差由2024-04-07..10-22参考日期区间复现 | measure.countGrain局部实现错误；日期无权威规定 |

业务结论不以工具Ready、评分或观测匹配认证。Gold SQL均未提供，但没有因此停止调查。167/171可确证局部Gold冲突；358实体计数缺陷不等于解释Gold失分；070/169保持诚实未决。原运行、源代码、数据库、公共CLI和旧报告未修改，无提交或PR。
