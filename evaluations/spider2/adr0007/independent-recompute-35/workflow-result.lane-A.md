# Lane A：5题独立重算完成

全部按“自由题解→实际SQL验证→授权CSV→freeze→Gold→原Spec/SQL”逐题落盘；80条真实SQL，完整性与先后顺序25项检查通过。索引：[lanes/A/analysis-index.md](lanes/A/analysis-index.md)。

| 题目 | 结论 |
|---|---|
| local002 | 常规金额OLS复现旧4340.10；多项真实变体仍未唯一定位Gold14334.62114，保留未决。 |
| local010 | 无向城市对最少3；方向拆分全部箱翻倍得Gold6，与明确对称业务文档冲突。 |
| local040 | 仅树表去完整重复，即精确恢复全部Gold收入均值；原实体粒度有问题，独立冻结解亦漏重复，已认错。 |
| local049 | 独立公司173/3=57.67；六个ID重复关联后179/3=Gold59.67，公司数与关联行数冲突。 |
| local168 | 短标题＋具名技能＋技能均薪等权精确得Gold101300；实际仅2种具名技能，仍有业务歧义。 |

五题独立官方评分均0，评分不是业务裁决。Gold SQL均缺失；精确重建证明充分解释，不证明唯一内部算法。未修改公共代码、数据库、原运行或旧报告；未派代理、提交或PR。所有最终数据来源于冻结的Candidate/Receipt，揭示后实验未重新交付。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Five per-case analysis.md/analysis.json files; lanes/A/validation.json confirms all 25 artifact, receipt, freeze-order, real-execution and verbatim-quote checks; 80 executed SQL records."
    }
  ],
  "changedFiles": [
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local002/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local010/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local040/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local049/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local168/",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/A/",
    "evaluations/spider2/adr0007/independent-recompute-35/workflow-result.lane-A.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "python evaluations/spider2/adr0007/independent-recompute-35/lanes/A/verify.py",
      "result": "passed",
      "summary": "All five cases: artifacts, current receipt CSV/SQL, freeze before reveal, actual result SQL execution, and quoted evidence present."
    },
    {
      "command": "python evaluations/spider2/adr0007/independent-recompute-35/lanes/A/do002.py",
      "result": "failed",
      "summary": "Initial local print encoding and later empty-grouping serialization failure; no Gold read. Supervisor identified grouping=n/a correction; subsequent final publication/freeze/reveal succeeded without changing algorithm."
    },
    {
      "command": "python evaluations/spider2/adr0007/independent-recompute-35/lanes/A/post168.py",
      "result": "failed",
      "summary": "Outer 240-second batch timeout after many successful bridge queries; subsequent bridge experiments completed Gold reconstruction, all raw returns retained."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "Real executed SQL counts: local002=13, local010=10, local040=15, local049=14, local168=28.",
    "All five have authorized CSV, receipt, immutable freeze and subsequent reveal.",
    "Official independent scores: 0 for all five; no Ready/publication assertion used as correctness evidence."
  ],
  "residualRisks": [
    "local002 remains unexplained after actual unit, missing-day, day-index, status and order/item experiments.",
    "local168 Gold has an exact skill-equal reconstruction using only two known skills, but wording does not uniquely settle cohort, missing skill dimension or averaging entity.",
    "Gold SQL unavailable: sufficient numeric reconstructions are not unique internal explanations.",
    "local040 independent publication also mishandled duplicate source rows; preserved immutable and explicitly acknowledged.",
    "Entity identity, date_joined meaning and some averaging/range choices remain disclosed inference rather than reviewed business definitions."
  ],
  "noStagedFiles": true,
  "diffSummary": "Offline evidence and reports only, restricted to assigned cases/lane plus required authoritative workflow report.",
  "reviewFindings": [
    "No protocol blocker: all reveals follow immutable published freezes.",
    "Unresolved substantive business assumptions and local002/local168 ambiguity are retained, not relabeled as proven errors."
  ],
  "manualNotes": "Independent reasoning never used original field trees or old diagnoses before freeze. Gold/document conflicts are stated under documented symmetry or explicit entity-identity assumptions; observations are not promoted to business definitions. This is expanded offline investigation, not an interface causal-benefit experiment."
}
```
