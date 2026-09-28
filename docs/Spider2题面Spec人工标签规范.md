# Spider2 题面 → Answer Spec 人工标签规范

## 目的

这份标签是**离线评测参照**，用于测量题面到 Answer Spec 提取器的 Coverage、Precision、Recall、过度约束率和 Hard-binding error。它不是运行时知识，不能被注入 Solver，也不能把 Gold SQL 当作运行时证据。

标签文件：

```text
docs/Spider2题面Spec标签草稿-135题.jsonl
```

正式版建议另存为：

```text
evaluations/spider2/spec-quality-labels.jsonl
```

当前已生成 P5 十题初标草稿：

```text
docs/Spider2题面Spec标签试标-P5-10题.jsonl
```

该文件的状态仍是 `draft`，不能当作最终 Gold 标签。

当前全量候选与裁决文件：

```text
docs/Spider2题面Spec标签复核候选-135题.jsonl
evaluations/spider2/spec-quality-labels.jsonl
```

`evaluations/spider2/spec-quality-labels.jsonl` 是本轮离线裁决版，135 条记录为 `adjudicated`；仍保留题面与 Gold 形状冲突的 `ambiguity`，不能把这些冲突解释为运行时业务事实。

## 标签状态

- `pending_manual`：尚未人工填写。
- `prefilled_structural`：仅预填 Gold CSV 的行数、列数和原始列名，必须人工确认最终输出意图。
- `draft`：已经有人填写，但未完成独立复核。
- `reviewed`：至少一名标注者完成，证据引用完整。
- `adjudicated`：多人意见已裁决，可用于正式指标。

未达到 `adjudicated` 的标签只能用于开发，不用于宣称提取器准确率。

## 单题标注顺序

1. 先只读题面，标出最终问题、最终输出和中间操作。
2. 阅读题目附带文档、业务文档和 Schema；每个业务判断记录精确引用。
3. 查看 Gold CSV 的形状和 Gold SQL 作为离线核对材料；Gold 只能帮助发现遗漏，不能覆盖题面或文档的语义。
4. 将明确要求写入 `hard` 类标签，将合理但未被证据决定的解释写入 `ambiguities` 或候选 alternatives。
5. 最后填写 `measure`、`grain`、`denominator`、`ranking`、`filters`、`time`、`unit` 等槽位。

## 槽位要求

### output

记录最终输出，不记录中间 CTE 或中间 Top-N：

```json
{
  "status": "reviewed",
  "alternatives": [
    {
      "rowMode": "scalar",
      "rowCount": 1,
      "columnCount": 2,
      "columnNames": ["百分比1", "百分比2"],
      "columnRoles": [
        {"role": "percentage", "position": 1},
        {"role": "percentage", "position": 2}
      ],
      "evidenceRefs": ["Q-1"]
    }
  ]
}
```

若题面允许宽表和长表两种输出，放入同一个 `alternatives` 数组。

### measure / grain / denominator

必须明确统计实体、计算粒度和聚合顺序。例如：

```json
{
  "measure": {
    "status": "reviewed",
    "alternatives": [{
      "kind": "avg",
      "entity": "customer",
      "sourceGrain": "customer",
      "aggregationOrder": ["per_customer", "average_by_segment"]
    }],
    "evidenceRefs": ["Q-2", "D-1"]
  }
}
```

不要因为 Gold SQL 使用了某个字段，就把该字段直接写成题面 hard 约束；物理字段映射和业务语义要分开标记。

### ranking

必须区分：

- 最终输出 Top-N；
- 中间候选集合 Top-N；
- 分组内 Top-N；
- 并列是否保留。

例如 `local195` 的 Top 5 演员是中间集合，最终输出是一个总体百分比，不能标成最终 `rowCount=5`。

### filters / time / unit

过滤标签记录：

```json
{
  "questionSpan": "promo_total_id = 1",
  "semanticPredicate": "promotion total member equals 1",
  "physicalMappingRequired": true,
  "evidenceRefs": ["Q-3"]
}
```

普通介词短语（例如 `fatalities in collisions`）不是过滤条件。无法确定物理字段或边界时，记录 ambiguity，不强行生成 hard filter。

## 证据引用

每个非空槽位至少引用一个证据：

```json
{
  "id": "Q-1",
  "source": "question",
  "quote": "For each group, compute ..."
}
```

允许的 `source`：

- `question`
- `task_document`
- `schema`
- `gold_shape`
- `gold_sql`
- `annotator_inference`

其中 `gold_shape`、`gold_sql` 只能作为离线证据，不能单独把语义标为题面 hard。

## 双人复核方案

建议分三步：

1. 先用 10 道 P5 诊断锚点试标，统一 `grouped/scalar`、中间 Top-N、分母和聚合顺序定义。
2. 第一名完成 135 题；第二名独立复核至少 40 题，必须覆盖简单题、复杂聚合题、时间题、文档题和已知错题。
3. 对所有不一致的槽位逐项裁决，形成 `adjudicated`。

## 指标计算原则

- 有多个合法 Gold 时，与任意一个 alternative 一致即可。
- `unknown` 不计入 Recall 的分母，但错误填充要计入过度约束率。
- 题面没有明确、却被预测为 hard 的内容计入 `Hard-binding error`。
- 不把“非空”当作正确；必须同时检查值、粒度、列语义和证据。

验证草稿文件：

```bash
npm run validate:spec-labels -- --validate-labels docs/Spider2题面Spec标签草稿-135题.jsonl
```
