# Lane F：五题独立重算完成

五题均已独立SQL实算、发布CSV、freeze，随后才对照Gold，最后审查原Spec/SQL。逐题工件及查询日志保存在对应cases目录；[汇总索引](lanes/F/analysis.md)、[进度](lanes/F/progress.json)、[检查结果](lanes/F/validation.json)。

| Case | 独立结果 | 归因结论 |
|---|---|---|
| local220 | Ronaldo胜199；Gorka负107 | Gold同名合并候选实际得到Marcelo301/3身份、Ricardo163/5身份；局部gold_conflict |
| local263 | regression soft21/strong37 | 同步计步36/78；漏step关联实际得到Gold108/234；局部gold_conflict |
| local264 | regression213 | 漏step关联实际639，含426跨步重复；局部gold_conflict |
| local335 | Williams6、Toro Rosso5、Sauber3、Minardi3、Jordan2 | 得分车队归属与driver×constructor积分两种不同候选均重现Gold名称；ambiguous_after_recompute |
| local354 | 103名司机（授权CSV） | Gold3人遗漏明确合格Farina642；原104还误纳仅1真实round的Bill Aston；Gold冲突与原局部资格错误分开 |

五题官方独立分均0，但不是业务正确性的判据。Gold SQL均缺失；实验重建不证明Gold真实实现。local335未唯一归因，local354未唯一重建Gold3来源；输出表示差异也不能忽略。CLI UTF8故障已即时反馈并由父修复，未绕过适配器。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Five cases have analysis.md/analysis.json, independent-plan.md, published receipt/CSV/query.sql, immutable freeze, executor/tool logs and post-freeze comparisons; lanes/F/validation.json checks artifacts and verbatim quotes."
    }
  ],
  "changedFiles": [
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local220/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local220/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local263/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local263/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local264/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local264/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local335/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local335/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local354/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local354/analysis.json",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/F/progress.json",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/F/index.json",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/F/analysis.md",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/F/validation.json",
    "evaluations/spider2/adr0007/independent-recompute-35/workflow-result.lane-F.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "answering_bridge.mjs set/query/final/freeze/reveal for local220,local263,local264,local335,local354",
      "result": "passed",
      "summary": "Five independent publications and freezes; all SQL through readonly adapter; numerous intermediate and counterfactual queries retained."
    },
    {
      "command": "answering_bridge.mjs local354 query query-solution.json before UTF8 repair",
      "result": "failed",
      "summary": "GBK stdout UnicodeEncodeError reported to supervisor; parent repaired CLI; unchanged SQL succeeded on retry."
    },
    {
      "command": "compare_csv.py for all five cases",
      "result": "passed",
      "summary": "Official scores reproduced as 0; limitations and business-key differences separately investigated."
    },
    {
      "command": "Artifact presence, publication CSV row counts and verbatim evidence-quote checks",
      "result": "passed",
      "summary": "All five published/frozen; row counts 2,2,1,5,103; no missing quotes or mandatory artifacts."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Empty staged-file list."
    }
  ],
  "validationOutput": [
    "4 primary local gold_conflict cases; 1 ambiguous_after_recompute case.",
    "local354 additionally confirms original local participation-eligibility error, explicitly insufficient to explain all lost score."
  ],
  "residualRisks": [
    "Gold SQL absent: reconstructed alternatives establish sufficiency, not exact Gold implementations.",
    "local335 has two distinct experimentally supported explanations; local354 Gold3 hidden restriction remains unidentified despite actual alternatives.",
    "Output shape differences and scorer column-wise behavior mean local semantic differences are not exclusive explanations of whole-score failure.",
    "Recorded soccer lineups and F1 result statuses are participation proxies; historical shared-car endpoints require disclosed assumptions.",
    "Earlier GBK displays can corrupt accented names; final and name-critical local354 queries were rerun after parent UTF8 repair."
  ],
  "noStagedFiles": true,
  "diffSummary": "Only lane F and its five case artifacts plus the mandated workflow report were written; no source, database, original run, public CLI, commit or PR changes by this agent.",
  "reviewFindings": [
    "No completion blockers; unresolved business interpretations are explicitly retained, not asserted resolved."
  ],
  "manualNotes": "Sequential blind recomputation completed with actual database validation and immutable publication chains. Ready/publication were never treated as semantic certification. Per-case progress was persisted immediately; parent alone repaired the shared UTF8 fault."
}
```
