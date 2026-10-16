# 独立题解（揭示前）
原题：“Which model category (L1_model) appears the most frequently across all steps and versions when comparing traditional models to the Stack model, and what is the total count of its occurrences?”
每个name/version/step为一次可比较的步骤；该步model.L1_model为类别。需要该步具有Stack与传统非Stack的非空test_score。题目没有说Stack获胜、持平或strong/soft，不能自行添加比较结果的过滤条件。累计所有可比较步骤×版本中各L1_model次数，取最大，保留并列。同一类别在同一版本的多个步骤均算，因为明确“across all steps and versions”。
歧义：when comparing可能暗指数据库stack_ok的成功比较子集，但DDL没有说明该业务定义，先以全比较总体为主；另跑Stack>=传统最大分的反事实与distinct版本计数，作为歧义影响验证，不静默替换独立答案。多个传统模型一组只计该步的L1一次，不按传统分数行数重复。
