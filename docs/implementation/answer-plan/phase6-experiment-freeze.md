# Answer Plan Phase 6：实验与灰度门槛冻结

冻结日期：2026-09-09（正式 100 题运行启动前）

## 数据与实验单位

- 开发集：`evaluations/spider2/phase6-development-35-ids.txt`，35 题，SHA-256 `caefe0d6469b05b4119cfd63c08437b7487ba18b051defb54c52f75e56b49fc4`。
- 独立留出集：`evaluations/spider2/phase6-frozen-100-ids.txt`，100 题，SHA-256 `bb715df43de1a7732e5c7392e857ce6bd4e3ebf4b72288a9c989c8e0deb92e91`。
- 两者无交集，均来自 135 题 SQLite 可运行题集。100 题留出集有既有双人复核并裁决的 Spec/ambiguity 标签；标签不得进入 Solver 输入。
- 每个 arm 运行 3 次；置信区间按 `instance_id` 聚类 bootstrap，重复运行不作为独立题目。
- 固定预算：20 turns / 50 tools / 6 exploration / 300 秒。
- **全局并发修订（正式完整运行前）**：GPT-5.5 三 arm 首轮若各用 concurrency=6，会超过同一 key 的全局 6 请求上限并返回可重试 429；这些不完整运行原样保留且不进入统计。随后将每 arm concurrency 冻结为 2，三 arm 并行时全局上限为 6。该调整同时作用于所有 arm 和全部重复，不改变单题预算。
- **运行前基础设施修订（2026-09-09）**：DeepSeek canary 成功后，首轮三 arm 在约 57–62/100 处统一出现供应商 `402 Insufficient Balance` 并按 formal fail-fast 终止，无法形成固定分母。三个不完整 run 原样保留，不进入效果统计。随后用 `gpt-5.5` profile 执行 `local058` canary，SQL/E2E 1/1 且交付成功；在任何完整 100 题结果产生前，将正式模型统一冻结为 `gpt-5.5`。三个 arm、三次重复均同时切换，其他预算与题集不变；不得将 DeepSeek 不完整结果与 GPT-5.5 结果拼接。

## 三个 arm

1. **legacy**：Phase 0 B1 冻结工作区补丁；旧模型工具/协议 Prompt；detectors off、interpretation hook off；身份阻断和导出后终止保留。
2. **new-off**：当前 `evidence-plan-v2`、当前 Prompt；detectors off、interpretation hook off；其余与 new-on 一致。
3. **new-on**：当前 `evidence-plan-v2`、当前 Prompt；Phase 4 bounded counterevidence/detectors on、interpretation hook on。

架构实验比较 legacy 与 new-on。旧/新工具与协议 Prompt 的差异就是 treatment，不声称 Prompt 相同。检测器消融比较 new-off 与 new-on，两者使用同一当前协议和 Prompt，只切换预先声明的检测/解释开关。

配置 hash：

- legacy：`14ee2480f0a92a015b4851fd783b271c40098f19e4105e247eaf655333024545`（额外声明只用于 Manifest 的 legacy protocol identity）
- new-off：`d74b634688802ee837d2e35cf95c67c739b90e3b3bbd3862eb338e91a385811a`
- new-on：`a8e72357ea8a81c8d0469609e18bf42aa95ada98103b790d582b6b892b500482`
- 三 arm 共用 Runner：`run.mjs` `3b63b1d3ada9b0edceee4aa6870bbcb9c3081f9789ed38e975cca5f54cf416c2`；`lib.mjs` `26479592bb9ce0c2e87891ed2a081516a051f9eb8120f2b84efc9321028bc3f9`。
- 门槛：`evaluations/spider2/phase6-thresholds.json`，SHA-256 `8951c70b43863282a4c027a74fe3004a3dd35ac40196e8049f22c3d955f3054d`。

## 预冻结门槛

完整门槛以 `phase6-thresholds.json` 为机器可读来源：

- 完整性负例 100%；越权确认、探索发布、错版本交付均为 0。
- 已识别、已采用、未确认口径漏披露率 0。
- 新协议相对 legacy 固定分母 E2E 配对差值 95% CI 下界不低于 -3 个百分点。
- SQL/CSV 覆盖下降不超过 2 个百分点；新增系统性发布失败为 0。
- 平均工具调用及平均 token 使用增量分别不超过 15%；P95 延迟增量不超过 20%。
- 独立风险标签集的重要歧义召回提升且 precision 不下降。
- Timeout 点估计不高于 legacy；简单 fast-path 为 2–3 次串行往返且无新增必需协议往返。

任何门槛失败都不允许宣布默认推广；不得在看到结果后修改本文件或 thresholds JSON 来追认通过。

## 灰度与回退

- 初始范围：内部只读任务，5%，观察 7 天。
- `AnswerPlanRolloutAuthority` 使用冻结 salt 对 task id 稳定分桶；首次分配后不可中途切换协议，恢复沿用原 assignment。
- 暂停时只影响新任务并将其路由到 legacy；已有任务保留协议及审计。
- 错候选交付、虚假用户确认、已识别且采用但未披露任一事件立即暂停。
- 回退目标必须是上一身份检查仍启用的可信版本；无法由旧版本恢复的新格式任务只读保留并提示重新发起。
