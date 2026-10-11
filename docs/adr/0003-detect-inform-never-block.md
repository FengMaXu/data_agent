---
status: accepted
---

# 确定性检测默认告知而非裁决

## 背景

Query Digest、基数、形状和过滤器检测器能够可靠地描述候选查询的结构性观测，但未必能够证明唯一的业务口径。将未校准、不可判定或业务语义异常直接转化为交付阻断，会同时减少可交付样本并阻止后续校准。

## 决策

1. 检测与动作解耦。检测器只产生绑定 Answer Spec 槽位的 Anomaly Record，并在观测结果中告知模型。
2. `unavailable`、`inconclusive`、`not_applicable` 和未校准状态默认记录并随结果披露，不阻断交付。
3. 运行时硬阻断保留三类：发布候选的完整性身份不匹配；题面要求标量却返回多行、或要求 Top-N 却返回非 N 行等必然得到零分的形状违规；以及当前 Answer Spec 仍存在 `handlingStatus=unhandled` 候选假设时的 result SQL 与发布/导出。第三类是处置生命周期完整性约束，不判断假设正确或错误，且不得阻塞 exploration。
4. 稳定规范排序只拥有重现性，不拥有业务裁决权。对于 material population Decision，如果权威证据、结构化最小附加假设和冻结默认均不能唯一选择，稳定排序只能固定候选展示顺序，Decision 保持未决，相关 hypothesis 不得因该排序变为 `handled`。
5. 异常触发独立上下文的解释枚举；至少两个候选解释在进入 Solver 前可见。解释选择与引用写入发布记录，但不拥有语义裁决权。
6. Reviewer 不在默认运行时交付路径中拥有发布权；离线 replay 可以继续使用 Reviewer 分析历史结果。

## 后果

- 获得更多带披露的可交付样本，供后续离线评估和校准使用。
- Anomaly Record、Interpretation 和 Disclosure 成为比“门通过/失败”更适合审计的领域对象。
- 放行不是正确性证明；产品若需要严格策略，必须显式配置额外政策，而不能把检测器的未知状态伪装成批准。
- `unhandled` 阻塞只要求形成用户确认、合格证据、反驳或合格的 selected provisional Decision；它不把提醒、自然语言自报或 material population 的稳定排序平局当作验证或有效处置。
- ADR-0002 中“无已校准版本时 fail-closed”和门默认拥有阻断权的决策被本 ADR 取代；其关于 `not_applicable`/`unsupported` 区分和固定版本 Digest 的约束继续有效。

## 修订（2026-10-01）：部署层面未配置的检查不逐条披露

第 2 条的“随结果披露”针对的是对**这一条结果**的观测。部署中没有配置某个检查器（目前是 Answer Spec 反馈器，`status=disabled`）时，它对任何结果都没有观测，逐条披露只会在每个结果上重复同一句部署状态。

- 这种情况在检查覆盖中记为 `not_applicable`，原因写明“未配置”，发布记录仍可审计；不生成 Disclosure。
- 应用启动时报告一次该部署状态。
- 检查器已配置但本次不可用、未完成或不确定（`unavailable`、`unknown`），以及确定性规则发现的风险，仍按第 2 条随结果披露。

## 修订（2026-10-11）：Spec Realization 进入第 3 条的硬阻断

Answer Spec 负责语义理解，SQL 负责实现已封存的理解。ADR-0001 的 Reviewer 承担过这道核验，失去发布权后其实现被移除，此后没有任何机制检查 SQL 是否实现了封存字段。Spec Realization 补上这一层：只读封存字段与 SQL 文本，不读对话，只判断实现，不判断语义对错。

- 第 3 条的硬阻断增加一类：SQL 在结构上不可能实现某个封存字段——最外层行数上限与 `selection.n` 不同（`strict`）、`include_ties` 却以不带 WITH TIES 的行数上限截断、`measure.formula` 含 `percentage` 而 SQL 从未乘 100。此时 SQL 不执行，以 `SPEC_NOT_REALIZED` 拒绝，可重试。
- 有已知例外的结构信号（声明的来源表未被读取、`count_distinct` 无 DISTINCT、聚合层数少于公式嵌套、声明的日历粒度未被派生、`include_ties` 只用 ROW_NUMBER）按第 2 条记为 finding 并随结果披露，不阻断。
- 规则读不懂的字段记为不可判定，不记为已实现。
- 阻断规则须在已有运行上回放校准：2026-10-10 字段树运行 102 题中，阻断规则只在 1 道正确题上触发（`include_ties` 却 `LIMIT 1`，因无并列而碰巧正确），声明来源表未读取在 5 道正确题上触发（按键过滤代替连接查找表），故列为披露项。新增阻断规则前须做同样的回放。
