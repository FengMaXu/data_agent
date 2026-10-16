# 独立题解（揭示前）
原题：“A model has a 'strong' status if, for any of its steps, the maximum test score among non-'Stack' models is less than the 'Stack' model's test score.”以及“Count how many times each L1_model is associated with a 'strong' or 'soft' status across all models”。
把模型识别为(name,version)。每一步在相同name/version/step内比较传统模型最高test_score与Stack test_score；严格小于为strong、等于为soft。没有可用传统分数或Stack分数不判定。将该步model.L1_model关联，然后每(name,version,L1_model,status)只计一次：题面问跨模型而不是跨步骤次数。某模型既有strong步也有soft步则两类都可计，但各类不重复。先实查每步分数唯一性与L1多步分布。按L1汇总各status的模型数，各取最大，并列都保留。
假定：比较范围同一步，不拿未来/其他步骤模型当基准；SQL最大Stack仅为防重复，发现多Stack时必须披露。step不代表独立模型。
