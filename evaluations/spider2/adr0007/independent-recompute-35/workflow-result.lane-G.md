# Lane G 完成

5题均逐题独立计算、授权发布并冻结后才揭示Gold与原Spec/SQL；完成43次实际只读SQL执行，保留全部查询日志与发布链。

- **local131**：25/20行仅差5个零计数风格，全部失分机制已定位；全集资格仍有歧义。
- **local269**：946独立守恒；跨根去重叶数量并改变平均粒度可精确复现Gold530.67，但不是唯一业务解释。
- **local273**：FIFO交集与守恒已验证；以库存实际总分配量作分母，可精确复现完整Gold向量。原订单行满足率与位置分配事件粒度不同；分母仍未证实。
- **local279**：原/独立递归一致，Gold日期非该模型最小月。真实计算168组有效替代状态结果，不能联合复现Gold；保留未决，不归因于并列政策。
- **local331**：确证局部 **gold_conflict**。实际END访问0条，7个会话终止对被合成END；该单变量改动精确复现全部Gold前三名，违反实际第三页访问资格。

索引：`lanes/G/analysis.md`；逐题结论：`cases/localNNN/analysis.md`、`analysis.json`；进度：`lanes/G/progress.json`；时序与发布校验：`lanes/G/artifact-validation.json`。五份独立官方评分均0；评分、Ready和发布均不作为业务正确性证明。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Five per-case analysis.md/json reports, independent plans/SQLs, authorized CSV receipts, immutable freezes, executor/tool logs; artifact-validation.json confirms all five freeze-before-reveal and matching published SQLs."
    }
  ],
  "changedFiles": [
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/G/helpers.py",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/G/progress.json",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/G/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/G/artifact-validation.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local131/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local131/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local269/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local269/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local273/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local273/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local279/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local279/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local331/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local331/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/workflow-result.lane-G.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "answering_bridge.mjs local131/local269/local273/local279/local331 set/query/final/freeze/reveal",
      "result": "passed",
      "summary": "43 actual read-only SQL executions, including five published final queries; all five freezes precede reveal."
    },
    {
      "command": "local131 initial complete-set/final/freeze attempt",
      "result": "failed",
      "summary": "Own empty conditions list rejected; no SQL executed on blocked final. Corrected only interface representation to n/a, then published and froze unchanged algorithm. Supervisor notified."
    },
    {
      "command": "compare_csv.py local131/local269/local273/local279/local331",
      "result": "passed",
      "summary": "Official scorer reproduced original and independent score0 for all five; scalar/vector/row differences investigated separately."
    },
    {
      "command": "Artifact file, receipt SQL and freeze/reveal timestamp validation",
      "result": "passed",
      "summary": "All required per-case artifacts present; five receipt SQLs equal independent.sql; five freeze-before-reveal checks true."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "131: Nonzero-eligibility counterfactual equals all20 Gold keyed rows; count totals15/15/6.",
    "269: Root totals864/720/960/1240 conserve3784; cross-root DISTINCT leaf quantity mean530.67 reproduces Gold.",
    "273: 34 allocation intersections conserve min(stock,demand) per product; allocated-stock normalization reproduces all six Gold values.",
    "279: 26 monthly states conserve final200/60; 168 effective alternative results do not jointly reproduce Gold dates and differences.",
    "331: No observed END path; seven terminal pairs; synthetic-END counterfactual equals complete Gold top3."
  ],
  "residualRisks": [
    "131 zero-style eligibility is not uniquely established by wording.",
    "269 and273 exact counterfactual matches do not uniquely prove hidden Gold SQL or business grain/denominator.",
    "279 initialization/restock semantics and Gold date association remain unresolved after actual alternative recurrence tests.",
    "331 repeated log rows, trailing-slash normalization and timestamp ties lack business event-order definitions."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only assigned case/lane audit artifacts and this requested lane result; no source, shared CLI, database, original run, commit or PR changes.",
  "reviewFindings": [
    "local331: confirmed Gold synthetic nonvisit category conflicts with third-page visits and explains entire scored difference.",
    "local131/local269/local273/local279: four honestly retained semantic/Gold ambiguities; specific differences and exact numerical mechanisms recorded without asserting unverified business facts."
  ],
  "manualNotes": "Independent plans and actual DB verification precede interface completion, publication and freeze; Gold/original evidence was read only afterward, one case at a time. Missing Gold SQL did not stop investigation. Extra offline experiments are not same-budget framework A/B evidence. ChangedFiles lists principal reports; each assigned case also contains its plan, SQL inputs/responses, publications, freeze and raw logs."
}
```
