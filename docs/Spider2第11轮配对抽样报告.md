# Spider2 第 11 轮三臂配对抽样报告

> 日期：2026-09-03
> 范围：SQLite 配对抽样 40 题，覆盖全部 30 个 SQLite 数据库，并包含 P5 十题诊断锚点。
> 目的：按预注册协议判断是否值得执行一次 135 题确认；本报告不把 40 题样本外推为总体准确率。

## 1. 有效 Run

| arm | Run ID | 配置 | 运行状态 | baseline lock |
|---|---|---|---|---|
| control | `round11-paired-040-control-002` | 检测器关闭、解释 Hook 关闭 | completed | `202379479ab3...` |
| hooks | `round11-paired-040-hooks` | 检测器和解释 Hook 开启 | completed | `202379479ab3...` |
| fewshot | `round11-paired-040-fewshot` | hooks + 虚构化 §1.5 | completed | `202379479ab3...` |

三个有效 Run 使用同一题目 ID 文件、SQLite、`deepseek-chat`、同一预算和当前 baseline lock。fewshot 首次运行的一个 413 provider 错误已通过 resume 恢复；最终 Run 无基础设施失败。此前的 `round11-paired-040-control` 在 baseline freeze 前启动，lock 为旧值，不用于正式配对结论；其结果仅保留为历史记录。

## 2. 结果

| 指标 | control-002 | hooks | fewshot |
|---|---:|---:|---:|
| 题目 | 40 | 40 | 40 |
| SQL 覆盖 | 36/40 | 40/40 | 38/40 |
| CSV 覆盖 | 36/40 | 40/40 | 38/40 |
| SQL EX（固定分母） | 11/40 | 11/40 | 12/40 |
| E2E EX（固定分母） | 11/40 | 11/40 | 12/40 |
| timeout | 9 | 9 | 7 |
| max_turns | 1 | 0 | 1 |
| 未发布 | 4 | 0 | 2 |
| 解释 Hook 注入 | 0 | 3 | 3 |
| 预算守卫跳过 | 0 | 0 | 0 |

官方评分使用串行模式执行，避免官方 evaluator 的共享 `temp/` 目录互相干扰。

## 3. 配对差异

### 3.1 hooks − control-002

- E2E：净变化 `0` 题；hooks 赢 1 题（`local032`），输 1 题（`local059`）。
- SQL：与 E2E 相同，净变化 `0` 题。
- CSV：`36/40 → 40/40`，增加 4 题。
- 未发布：`4 → 0`，减少 4 题。
- timeout：均为 9；max_turns：`1 → 0`。
- hooks 的 A 级 `join_fanout` 在 `local034`、`local195` 登记；在这两个触发题上相对 control-002 没有得分增加。

### 3.2 fewshot − hooks

- E2E：净增加 `1` 题；fewshot 赢 `local007`、`local009`、`local130`，输 `local019`、`local032`。
- SQL：与 E2E 相同，净增加 `1` 题。
- CSV：`40/40 → 38/40`，下降 2 题。
- timeout：`9 → 7`；max_turns：`0 → 1`；未发布：`0 → 2`。
- fewshot 的 A 级 `join_fanout` 触发题为 `local195`；在 hooks 与 fewshot 的共同 A 级触发集合上，fewshot 得分不低于 hooks。
- 首候选 D1 登记数从 2 降为 1，解释 Hook 注入数未增加，预算守卫跳过仍为 0。

## 4. 预注册条件判定

1. **准确率提升至少 4/40：不满足。** hooks 相对 control-002 为 0，fewshot 相对 hooks 为 +1。
2. **交付/稳定性改善至少 2 题：满足（hooks）。** hooks 相对 control-002 的 CSV 没有下降，且未发布题减少 4 题（4→0）；max_turns 也减少 1 题。timeout 没有改善。
3. **明确 Hook 故障归因：未观察到。** 本样本没有预算守卫跳过或解释 Hook 导致的发布失败；A 级触发题也没有得分净增。

因此，按协议第 4 条第 2 款，抽样结果足以执行一次 135 题确认。按“主指标改善更大的干预 arm”选择 fewshot：fewshot 相对 hooks 的 E2E/SQL 固定分母净增 1 题，且满足 F-arm 的不低于门槛；但其 CSV 覆盖下降 2 题，不能把它视为交付稳定性改善。

## 5. 下一步

执行一次冻结配置下的 135 题 SQLite 确认 Run：

- Run ID：`round11-full-confirm-fewshot-001`
- 配置：`config-round11-full-003-fewshot.json`
- 并发：3
- 预算：`timeoutMs=120000`、`maxTurns=20`、`maxToolCalls=50`
- 评分：完成后使用官方 evaluator 串行评分

确认阶段仍按 P6' 主标准记录：E2E、CSV、timeout/max_turns、发布状态、A 级检测器触发题集和解释周期。若确认失败，继续按单检测器关闭做归因，不整体回退。
