# local269
## 结论
独立与原答案946，Gold530.67。经真实实验定位：若跨根去重相同(leaf_id, expanded_qty)，再对叶路径数量平均，可精确复现530.67（3184/6），但这不是“每组合总量的平均”。判定ambiguous_after_recompute：可确证Gold数量不等于任一守恒的根组合均值；缺Gold SQL，无法唯一确认它是否有另一个“final combinations”定义，不能称原答案确定错。
## 原文与独立推导
“What is the average total quantity across all final packaging combinations, considering only the leaf-level items within each combination after fully expanding any nested packaging relationships?”（blind.json#/question）。无业务文档。父->子qty乘积，每根完整展开后所有叶路径累加；根531/532/533/534总量864/720/960/1240，(3784/4)=946。
## 实验与反例
graph.json、leaf-expansion.json、totals.json均实际只读执行。图11节点、12条关系，无可见环；两叶501/502。root-paths.json列7条根到叶路径：864,720,360,600,384,600,256，和3784。534->523->502的600与534->524->511->502的256应相加为856；不能任选一条。all-combination-leaves.json显示所有9个非叶起点总和3967，均值440.7778；14叶路径均值283.3571；根叶对6组均值630.6667；根叶路径7组均值540.5714。distinct-leaf-quantity.json实际跨根去重(leaf,qty)得6项、3184、530.67，丢掉533和534之间一个600。该实验提供精确数值解释而不是Gold业务定义；跨根去重与“within each combination”冲突。
## 事后审查
original-spec-evidence.json成功Spec明确以“final packaging combination, i.e. a packaging item that is not a component (contains_id) of any other packaging”为实体，并要求路径相乘、不去重。SQL符合这一决定，和独立结果一致。最早潜在分叉population.entity（final组合域），Gold潜在还混淆measure平均粒度；数值机制在树外可能是实现去重失误。不能由相同标量反推唯一Gold SQL。
## 限制
独立分数0；不停止于无Gold SQL，已经验证主要替代总体/分母和精确复现机制。Gold“组合”粒度尚无文档证实。
