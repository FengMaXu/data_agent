# local264：L1步骤计数与跨步骤连接
## 结论
独立regression213，原213，Gold639，官方均0。真实单变量漏step关联重现639：213正确步骤配426跨步组合。Gold局部统计单位超出了步骤×版本的L1出现，不能据评分认定原语义错误。
## 原文与算法
“Which model category (L1_model) appears the most frequently across all steps and versions when comparing traditional models to the Stack model, and what is the total count of its occurrences?”。无业务文档。对同name/version/step有传统和Stack分数的比较记一次L1，所有步骤计数，不擅自添加Stack胜出条件。原题未给strong/soft定义。
## 揭示前验证
regression71版本×3步=213，tree30×3=90；303步全部有可比分数。反事实Stack>=传统最大时regression114（strong78+soft36）、tree25；仅计版本71/30。Critical Heat Flux v1step1传统0.8836410197441006、Stack0.8767667331999809，为可比较但Stack落败反例；这些步不应无依据排除。
## Gold后实验
query-underkeyed-join实际同name/version但不约束step：regression639（其中426跨步）、tree270（180跨步）；成功子集342/75，也非Gold。Critical Heat Flux v1实查3×3九行，正确同一步只有三行。完整原始SQL/返回在executor-events.jsonl。不是仅乘3拟合。
## 最后原Spec/SQL审查
原Spec按model行（name+version+step），count(*)；原SQL同此，结果恰213。原conditions n/a没有声明比较分数存在，独立更严格，但全303可比故该局部遗漏目前无数值影响。原严格取1与独立保留并列也无现有影响。最早Gold重建分叉joinMultiplicity；没有确证原字段导致失分。Gold SQL不存在，只证反事实足以解释639，不证真实实现。
## 限制
when comparing是否隐含成功比较不能由文档确定，但所有合理候选213/114/71均不是639；倍率本身不作证明。
