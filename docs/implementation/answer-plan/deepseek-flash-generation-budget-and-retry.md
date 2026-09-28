# DeepSeek Flash 生成预算调整与 Spider2 失败题重试记录

日期：2026-09-11  
状态：实现完成；40 题续跑进行中

## 1. 背景

Spider2 Gold109 运行 `spider2-gold109-deepseek-flash-001` 的结果为：

- 109 题中发布 69 题；68 题进入官方评分；
- `not_published_no_export_call=36`；
- `not_published_provider_error=4`；
- 官方固定分母 End-to-End EX：44/109（40.37%）。

对 36 个 `not_published_no_export_call` Trace 的复核表明：

- 36/36 未执行 `mode=result` 查询，也未调用 `export_query`；
- 35/36 最后一次模型响应为 `stopReason=length`；
- 其中 34 题的最终单轮输出精确达到 8192 token；
- 34 题的上限响应中 reasoning 占输出 token 的 99.9666%；
- `local279` 因超大上下文只剩 16 个输出 token；
- `local259` 最终为模型响应错误。

逐题证据见：

- `.artifacts/spider2-gold109-deepseek-flash/no-export-root-cause.md`
- `.artifacts/spider2-gold109-deepseek-flash/no-export-diagnostics.json`

## 2. 系统提示词调整

文件：`.pi/SYSTEM.md`

首行加入：

> 请小心求证，大胆假设，但不要过度思考。

目的：保留证据优先和显式假设要求，同时明确要求有界收敛，减少在同一候选解释之间反复犹豫。

## 3. 模型预算与思考层级配置

### 3.1 Runtime 接口

文件：`packages/runtime/src/agent-assembly.ts`

`AgentModelProfile` 新增：

```ts
contextWindow?: number;
maxTokens?: number;
thinkingLevel?: ThinkingLevel;
```

模型构造由固定值改为可配置值：

```ts
contextWindow: profile.contextWindow ?? 128000,
maxTokens: profile.maxTokens ?? 8192,
```

Agent Harness 思考层级由固定关闭改为：

```ts
thinkingLevel: profile.thinkingLevel ?? "off"
```

默认行为保持不变；只有显式配置的模型 Profile 使用新值。

### 3.2 Spider2 配置透传与审计

文件：`evaluations/spider2/run.mjs`

Runner 现在会把下列字段从 `llm` 配置传入 Runtime：

- `contextWindow`
- `maxTokens`
- `thinkingLevel`
- 原有 `reasoning` 与 `thinkingLevelMap`

生效值同时写入 `manifest.json.model`，避免只依赖本地配置自报。

### 3.3 本次 DeepSeek Flash 生效配置

本次评测配置：`.artifacts/spider2-gold109-deepseek-flash/config.json`

```json
{
  "reasoning": true,
  "maxTokens": 102400,
  "thinkingLevel": "max",
  "thinkingLevelMap": {
    "max": "max"
  }
}
```

本机默认 Spider2 DeepSeek Profile 也同步至：

- `evaluations/spider2/config.local.json`

说明：本轮将用户所说的“提升至 102400”按前序关于 8192 单轮输出截断的上下文，落实为 **单轮生成上限 `maxTokens=102400`**，不是把总上下文窗口改成 102400。总上下文仍使用 Runtime 默认声明值，除非 Profile 另行设置 `contextWindow`。

## 4. 测试与验证

代码验证：

```text
npm run build:runtime                         PASS
npm run build:server                          PASS
packages/runtime/src/agent-assembly.test.ts   56/56 PASS
npm run test:eval:spider2                     45/45 PASS
```

新增定向测试验证：

- `contextWindow` 与 `maxTokens` 进入模型描述；
- `thinkingLevel=max` 进入 Agent Harness；
- `thinkingLevelMap.max=max` 保持在模型配置中。

40 题续跑前预检：

- 40/40 SQLite 资源可用；
- Gold compatibility：3/3；
- 余额恢复后的模型 canary：HTTP 200。

## 5. 40 题重试

题目集合：

- 原运行 36 个 `not_published_no_export_call`；
- 原运行 4 个 `not_published_provider_error`；
- 合计 40 题，无重复。

题单：

- `.artifacts/spider2-gold109-deepseek-flash/retry40-ids.txt`

Run ID：

```text
spider2-gold109-deepseek-flash-retry40-max-001
```

运行目录：

```text
C:\data-agent-eval\runs\spider2-gold109-deepseek-flash-retry40-max-001
```

首次启动后完成 6 题即中断：

- `local015/local017/local020/local040`：原 300 秒任务超时；
- `local050/local055`：HTTP 402 `Insufficient Balance`。

余额恢复后，同一 Run ID 使用 `--resume` 续跑；因为 `thinkingLevel=max` 下已实际观察到 300 秒不足，任务超时调整为：

```json
{
  "timeoutMs": 900000,
  "maxTurns": 20,
  "maxToolCalls": 50,
  "maxExploratoryQueries": 6
}
```

并发保持 3，完成后自动运行官方评分。当前生效值以运行目录的 `manifest.json` 为准。

### 续跑状态更新

第二次运行在完成 25/40 后再次因余额不足中断，Manifest 状态为 `incomplete`：

```text
completed=19
max_turns=3
provider_error=3
published_with_disagreement=9
not_published_no_export_call=10
not_published_provider_error=6
尚未开始=15
```

直接中断点为 `local275/local277/local279` 的 HTTP 402 `Insufficient Balance`。由于运行不完整，尚未生成正式 `official_score/summary.json` 和 `report.md`，不得报告最终 40 题正确率。再次续跑时应复用同一 Run ID，并重跑 `provider_error` 及继续缺失题目；是否重跑 `max_turns` 需显式决定。

为了解当前 25 题的阶段效果，已把现有 9 份 SQL/CSV 复制到独立目录并运行官方 evaluator，避免把部分评分写成正式 40 题结果：

```text
现有结果分母：25
已提交：9（36.00%）
官方正确：2
已提交样本正确率：2/9 = 22.22%
当前严格分母正确率：2/25 = 8.00%
正确题：local065、local157
```

阶段评分证据：`.artifacts/spider2-gold109-deepseek-flash/partial25-score/summary.json`。该指标是 provisional partial diagnostic，不代表最终 40 题通过率。

日志：

- `.artifacts/spider2-gold109-deepseek-flash/retry40-run.log`：首次启动
- `.artifacts/spider2-gold109-deepseek-flash/retry40-resume.log`：余额恢复后的续跑

## 6. 风险与解释边界

1. `thinkingLevel=max` 与提示词中的“不要过度思考”方向上存在张力；前者提高推理强度，后者要求行为收敛，实际净效果必须由 Trace 和交付率判断。
2. 把单轮生成上限提高到 102400 只能解除 8192 截断，不能保证模型会更早调用 result/export；也可能增加时延和 token 使用。
3. 本轮 40 题是失败题重试，不是随机留出集，也不是严格 Control/Treatment A/B，不能用于声称总体正确率净提升。
4. 当前 Runner 对部分生成截断仍可能标记为 `completed`；状态分类问题尚需单独修复。
5. 最终结果必须等待 40 题运行完成及官方评分，不得根据进行中的部分结果外推。
