# Spider2 第 11 轮阶段 5 报告

> 状态：验收通过
> Run ID：`round11-p5-deepseek-001`
> 模型：默认 `deepseek-chat`（DeepSeek OpenAI-compatible API）

## 固定十题验收

| 指标 | 结果 | P5 门槛 |
|---|---:|---:|
| 完成题数 | 10/10 | 完成 |
| SQL 覆盖 | 10/10 | 不低于 P4 |
| CSV 覆盖 | 10/10 | 不低于 P4 |
| `not_published_review_unavailable` | 0 | 不增加 |
| 平均工具调用 | 25.3 | P4 为 24.8，交付仍稳定 |
| 发布成功 | 10/10 | 完成 |
| 完整性身份阻断 | 1 | 仅允许的第一类 |
| 必然零分形状阻断 | 1 | 仅允许的第二类 |
| 其他发布前硬阻断 | 0 | 必须为 0 |
| 其他发布失败 | 0 | 必须为 0 |

## 阻断证据

- `local034` 第一次导出使用了非最新 Query Artifact，触发：`[INTEGRITY_ARTIFACT_MISMATCH]`；模型随后重新预览并成功导出最新候选。
- `local061` 第一次导出为标量题却返回 12 行，触发：`[SHAPE_ZERO_SCORE]`；模型随后改为单行结果并成功导出。
- 其余 8 题没有发布前阻断；所有 10 题最终均为 `published_with_disagreement`。
- 未发现由异常、未校准 Reviewer、语义分歧或其他检测器引起的第三类硬阻断。

## 结论

P5 通过。`beforeToolCall(export_query | publish_query_result)` 的运行时硬阻断仅出现计划规定的两类：候选完整性身份不匹配，以及形状违规且官方评分必然为零。两次阻断都允许模型重新预览，随后成功交付；没有形成新的交付阻断路径。
