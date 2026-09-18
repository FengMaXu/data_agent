# Spider2 第 11 轮阶段 1a 报告

## 结论

P1a 已通过固定十题验收：交付恢复，SQL/CSV 均为 10/10，`not_published_review_unavailable` 为 0。准确率按计划不作为阶段门槛。

## 实现

- `DeliveryPolicy` 改为 deliver-with-disclosure：Review Unavailable、Rejected、Abstained、Needs Clarification 和确定性检测观察均可生成披露式 Receipt。
- 确定性 gates/preflight 结果继续进入 outcome/audit，但不再改变发布资格或 token 签发。
- 删除导出/内联发布路径中的自动语义修复抛错和探索 Artifact 发布阻断。
- Spider2 runner 默认关闭运行时 reviewer（`assurance.reviewer.enabled=false`），配置仍可显式开启。
- Electron host 只有显式 `query_assurance_reviewer_enabled=true` 时才注入 reviewer。

## 固定十题证据

Run ID：`round11-p1a-001`

- 10/10 completed
- SQL coverage：10/10
- CSV coverage：10/10
- publication status：10/10 `published_with_disagreement`
- `not_published_review_unavailable`：0
- 平均工具调用：23.7，低于第 9 轮 35.8
- 官方 SQL/E2E：1/10；准确率不是 P1a 验收项

## 残余风险

旧的生命周期状态和 calibration/review 类型仍保留，属于 P1b 结构拆除范围；尚未执行 P1b。
