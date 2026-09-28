# Spider2 第 11 轮三臂配对抽样实验方案

> 执行调整：先进行三臂配对抽样；仅当抽样结果达到预注册的确认条件时，再执行一次 135 题全量回归。

## 1. 实验目的

本实验用于归因，而不是把三组结果直接当作三次独立验收：

- `control`：关闭检测器和异常解释 Hook，保留完整性阻断与导出终止；使用无 §1.5 的基础提示词。
- `hooks`：开启检测器和异常解释 Hook；使用同一份无 §1.5 的基础提示词。
- `fewshot`：在 `hooks` 基础上加入虚构化 §1.5 提示词示范。

每个 arm 使用完全相同的题目集合、SQLite 后端、模型、预算和 baseline surface lock。比较以同一题在不同 arm 的配对差异为主，不只比较总体平均值。

## 2. 配对样本

总体为 SQLite 的 135 题，样本固定为 40 题，选择文件：

- `C:\data-agent-eval\round11-paired-040-ids.txt`
- `C:\data-agent-eval\round11-paired-040-selection.json`

选择规则在运行前固定：

1. 纳入 P5 固定十题作为诊断锚点：`local003`、`local010`、`local025`、`local029`、`local032`、`local034`、`local035`、`local037`、`local050`、`local061`。
2. 对 30 个 SQLite 数据库各选 1 题；排除锚点后，以 `SHA-256("round11-paired-v1:" + instance_id)` 最小者确定代表题。锚点所在数据库仍额外纳入代表题，避免锚点样本替代数据库覆盖。
3. 三个 arm 使用同一份 40 题 ID 文件，禁止按 arm 重新抽样。

该样本包含诊断锚点并覆盖全部 SQLite 数据库，因此不是总体无偏随机样本；结论限定为配对归因和回归筛查，不外推为 135 题总体准确率。

## 3. 固定执行条件

- 三个 arm：`round11-paired-040-control`、`round11-paired-040-hooks`、`round11-paired-040-fewshot`
- 后端：SQLite
- 并行度：3
- `timeoutMs=120000`、`maxTurns=20`、`maxToolCalls=50`、`maxExploratoryQueries=6`
- 使用 `--baseline`；control/hooks 的有效提示词 hash 必须相同，fewshot hash 必须不同
- 记录每题 SQL/CSV 覆盖、SQL EX、E2E EX、发布状态、timeout/max_turns、工具调用、D1/D8 登记和解释 Hook 注入

## 4. 预注册的确认条件

抽样结果满足以下任一条件，才执行一次 135 题全量确认：

1. `hooks - control` 或 `fewshot - hooks` 的配对 E2E/SQL 正确题数增加至少 4/40（10 个百分点）；或
2. 任一干预 arm 在 CSV 覆盖不下降超过 1/40 的前提下，使 `timeout`、`max_turns` 或未发布题数减少至少 2 题；或
3. 出现明确的 Hook 归因信号（例如异常解释导致发布失败或预算耗尽），需要用全量确认其是否为系统性回归。

确认时只选择配对实验中主指标改善更大的干预 arm；若没有达到上述条件，则不进行 135 题全量，并将结论限定为“抽样未显示值得全量确认的效果”。

## 5. 中止与无效规则

- 任一 arm 出现模型额度/网络等基础设施错误，不把该 arm 的结果与其他 arm 比较；先恢复或重跑该 arm。
- 之前已启动但未完成的 `round11-full-003-*` 运行不纳入本实验；本实验以新的 paired Run ID 为准。
