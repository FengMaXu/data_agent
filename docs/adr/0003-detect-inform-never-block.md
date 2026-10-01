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
