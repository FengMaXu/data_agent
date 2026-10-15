# local263：计数范围与Gold关联放大
## 结论
独立与原结果均regression：soft21、strong37，官方分0。Gold108/234不是同一步或模型级次数。实测只按name/version关联model（漏step）产生soft108、strong234，精确复现Gold。
## 原文依据与算法
“each model (specified by name and version)”；“A model has a 'strong' status if, for any of its steps”；“Count how many times each L1_model is associated with a 'strong' or 'soft' status across all models”。无业务文档。模型身份(name,version)；逐step传统最大分与Stack分比较，然后同模型×L1×状态去重。不是按字段树解题，见揭示前plan与freeze。
## 实验与边界
model303行/303步/101模型，model_score2872行，无同键分数重复。同一步关联累计regression soft36步/21模型、strong78步/37模型；tree11步/5模型、14步/6模型。Delaney solubility v1同一regression连续3个strong步，说明计步与计模型实质不同。改为跨所有步的传统最大分比较，regression soft34步/17模型、strong62步/32模型；不会得到Gold。漏step join使每个合格状态步配该模型3个model行：36×3=108、78×3=234；实际执行证明，不只倍率推断。sqlite_master显示stack_ok虽漏step关联但GROUP BY name/version/step恢复每步一行，读取其实际计数也为36/78，不是108/234。
## Gold与原Spec事后审查
冻结发布后才读Gold；上述实验后读原Spec和SQL。原COUNT(DISTINCT name||version)按模型；原Spec明确“one count per model (name, version) holding that status”，与独立推导一致。同一步范围也一致。局部Gold join multiplicity候选充分解释全部数字差异，但无Gold SQL不能声称真实代码已定位。原没有确证的语义错误；模型级/步级题面仍可歧义，较宽解释也只36/78，均不能解释108/234。
## 限制
Gold SQL缺失；反事实join不是Gold原SQL证明；官方列匹配非业务认证。全局基准范围与计数粒度已用真实数据库候选检验。
