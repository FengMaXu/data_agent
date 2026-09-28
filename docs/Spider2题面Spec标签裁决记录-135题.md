# Spider2 题面 → Answer Spec 标签裁决记录

## 结论

`evaluations/spider2/spec-quality-labels.jsonl` 为 135 道 SQLite 题的离线 `adjudicated` 标签文件。它只用于评估题面理解，不是运行时证据，也不把 Gold SQL 注入 Solver。

## 复核链

1. `worker-draft`：按题面、附带文档、Gold 结构生成第一版候选。
2. `annotator-2`：独立复核并修正最终输出/中间 Top-N、统计实体、粒度、分母、时间窗口、过滤条件和聚合顺序。
3. `parent-adjudicator`：根据第二位复核报告逐项裁决，并修正已确认的冲突：
   - 题面要求与 Gold 行数/列合同冲突的题保留 question-driven 与 structural alternatives；
   - 普通叙述、计算公式、排序和格式化不再写入 filters；
   - `forbidden` 单独记录题面明确排除的对象；
   - 多级聚合显式记录中间粒度与 aggregationOrder。

## 文件状态

- 记录数：135/135
- 顶层状态：135 条 `adjudicated`
- 每条包含两个 annotators 和一个 adjudicator
- 11 个 facets：`output`、`grain`、`measure`、`denominator`、`ranking`、`time`、`unit`、`rounding`、`joins`、`filters`、`ambiguity`
- 每条包含题面哈希、证据引用和数据/G​​old provenance
- 多 Gold 形状：保留为 alternatives，不静默选择某一个形状

## 已知不可消除的歧义

题面与执行 Gold 存在张力的案例包括 `local035`、`local194`、`local197`、`local198`、`local209`、`local230`、`local283`、`local330` 等。标签中保留 `ambiguity`，并在 output 中区分题面驱动与 structural 形状；这些案例不应被当作单一无争议 hard contract。

## 可重现命令

```bash
npm run validate:spec-labels -- --validate-labels evaluations/spider2/spec-quality-labels.jsonl
npm run measure:spec -- --lite-root C:/data-agent-eval/Spider2/spider2-lite \
  --labels evaluations/spider2/spec-quality-labels.jsonl \
  --output docs/Spider2题面Spec提取质量-135题-槽位基线.json \
  --markdown docs/Spider2题面Spec提取质量-135题-槽位基线.md
```

默认 scorer 只接收 `reviewed`/`adjudicated` 标签；`draft` 与 `pending_manual` 不进入正式分母。
