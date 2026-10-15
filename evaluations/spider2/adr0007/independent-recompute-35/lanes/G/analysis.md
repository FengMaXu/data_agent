# Lane G 独立复算索引

五题逐题独立推导、实际查询、发布、freeze后揭示；共43次真实只读数据库执行（5条正式结果）。每题保存plan、SQL、授权CSV/receipt、freeze、原始执行日志、analysis.md/json。完整时序/发布链检查见artifact-validation.json。未运行评测runner，也未修改公共脚本、数据库或源运行。

| case | 结论 | 可确证发现 | 尚未证实 |
|---|---|---|---|
| [local131](../../cases/local131/analysis.md) | ambiguous_after_recompute | 25/20行差异仅5个零计数风格；其余按风格关联完全一致；非零资格反事实解释全部失分 | “each musical style”是否包含零风格 |
| [local269](../../cases/local269/analysis.md) | ambiguous_after_recompute | 独立/原946；跨根DISTINCT(leaf,qty)丢一个600后均值530.67精确复现Gold；四根总量守恒3784 | 精确标量匹配不证明Gold算法或组合域 |
| [local273](../../cases/local273/analysis.md) | ambiguous_after_recompute | FIFO区间交集34条；各产品min(需求,库存)守恒；按库存实际总分配量归一化平均精确复现六项Gold；原订单满足率抹去位置事件 | pick percentage分母、平均粒度无业务定义 |
| [local279](../../cases/local279/analysis.md) | ambiguous_after_recompute | 原/独立递归一致，Gold差值一致但日期非最小；168种有效状态候选结果排查，不能联合匹配Gold；并列政策不足解释 | 初始化/补货业务规则或Gold日期关联错误尚未唯一确认 |
| [local331](../../cases/local331/analysis.md) | gold_conflict | 实际END访问0条，7个终止detail对；补合成END精确复现完整Gold前三名，违反实际第三页访问资格 | 日志重复、尾斜杠规范化、同秒先后仍有数据限制 |

全部独立官方分数为0，不等于独立算法已证错。所有观测/反事实仅作为计算证据，未提升为业务定义。未从Ready推断正确，亦不据此次额外离线实验评价原框架的因果收益。
