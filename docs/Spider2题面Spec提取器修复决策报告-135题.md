# Spider2 题面 → Answer Spec 提取器修复决策

## 结论

1. **立即保留并发布过滤谓词修复**：只接受 SQL 形状明确的 `IN/NOT IN`、比较、`LIKE`、`IS NULL` 谓词，修复了英文介词 `in` 被误识别为 SQL `IN` 的问题。
2. **暂不通过继续堆叠正则扩展完整 Answer Spec**：当前确定性接口只有 `rowMode/rowCount` 和显式 SQL 过滤谓词，不能可靠承担 grain、measure、denominator、ranking、time、unit、rounding、joins 等语义槽位。
3. **下一项工程修复应是 Planner 优先、版本化 Spec 接线**：确定性提取器只提供低风险 request evidence；完整槽位由 Answer Spec Planner 产生为 Hypothesis/ambiguity，经证据和版本链绑定后再用于 Runtime，不把自然语言正则结果直接升级为 Hard Constraint。

## 证据

### 过滤提取器

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| 有过滤输出的题目 | 83/135 | 6/135 |
| 过滤约束总数 | 139 | 12 |
| 严格 SQL 形状通过 | 12/139 | 12/12 |
| 明显普通英文短语误提取 | 127 | 0 |

典型修复对象：`fatalities in collisions`、`runs in any`、`lifespan in weeks` 等不再被当成 SQL 谓词。修复后保留的 12 条均来自题面明确写出的比较、等值、`IN` 或 `IS NOT NULL` 形状。

### 输出形状

- `rowMode` 非空：30/135（22.22%）。
- `rowCount` 非空：30/135（22.22%）。
- 与任一 Gold 形状行数一致：18/135（13.33%）；在已预测子集为 18/30（60.00%）。
- 预测缺失：105 题；已预测但行数不一致：12 题。
- 列合同：0/135；当前接口不输出 columns，故不能假装得到列 Precision。

这说明仅以“看到 top N / how many / average”继续扩大正则会把中间 Top-N、宽表/长表、分组结果和最终 scalar 混淆。`local015`、`local028`、`local035`、`local061`、`local078`、`local081`、`local171`、`local195`、`local230`、`local263`、`local331`、`local358` 是代表性错例。

### 槽位级标签评估

正式标签：`evaluations/spider2/spec-quality-labels.jsonl`，135/135，状态为 `adjudicated`。执行器当前没有独立的 Answer Spec facet extractor，因此：

- `grain`、`measure`、`denominator`、`ranking`、`time`、`unit`、`rounding`、`joins`：预测覆盖均为 0，Recall 均为 0；这不是标签缺失，而是接口尚未输出这些槽位。
- `filters`：预测 12 条，匹配 6 条；Coverage 8.89%，Precision 50.00%，Recall 6.52%，错配/过度约束率均为 50.00%。未匹配部分主要是自然语言/派生资格条件不能由低风险正则确认，不能直接判为物理字段错误；非 filters 槽位的错配率与过度约束率在报告中分开，避免把漏提取误称为过度约束。
- `ambiguity`：75 个歧义实例，当前确定性接口没有歧义输出；当前 abstention accuracy 为 100%，但这不等于完整 Answer Spec 正确。
- `output.columns`：0/135，明确属于接口能力缺失。

完整机器可读结果：

```text
docs/Spider2题面Spec提取质量-135题-槽位基线.json
docs/Spider2题面Spec提取质量-135题-槽位基线.md
```

## 修复边界

### 可以立即做

- 保持显式 SQL 谓词正则的严格边界，并为新增操作符补单元测试。
- 将 deterministic filter result 标记为 request evidence/candidate，而不是自动声明业务 Hard Constraint。
- 让 Planner 输出的完整 Answer Spec 成为语义槽位的唯一主来源，并保留 Hypothesis、ambiguity 和 Spec version。

### 不应立即做

- 不把 `in`、`where`、`between`、`excluding`、`for each` 等自然语言 token 直接映射成物理 SQL filter。
- 不用 Gold 行数/列名回填运行时 Answer Spec。
- 不以单一 `latest` Artifact 或自然语言正则结果覆盖已有 Spec 版本。
- 不在没有 columns、columnRoles、aggregationOrder 和 denominator contract 的接口上宣称完整输出合同准确率。

## 可复核命令

```bash
npm run build:runtime
npm run test:eval:spider2
npm run validate:spec-labels -- --validate-labels evaluations/spider2/spec-quality-labels.jsonl
npm run measure:spec -- --lite-root C:/data-agent-eval/Spider2/spider2-lite \
  --labels evaluations/spider2/spec-quality-labels.jsonl \
  --output docs/Spider2题面Spec提取质量-135题-槽位基线.json \
  --markdown docs/Spider2题面Spec提取质量-135题-槽位基线.md
```

数据集与 Gold 的哈希已写入槽位基线 JSON 的 `sources`，用于同一版本重跑核对。
