# Lane E：5题独立重算完成

所有题先自由题解、真实SQL验证、授权CSV发布及freeze，再揭示Gold，最后审查原Spec/SQL。累计60次桥接只读SQL，5次最终查询。每题analysis.md/analysis.json、plan、SQL、CSV、receipt、freeze与原始日志齐全；progress.json已逐题完成。

| 题 | 独立分 | 结论 |
|---|---:|---|
| local070 | 1 | 日期15行与Gold逐日期完全相等；原6个城市差异来自MIN名称而非最小ID。代表城规则未明示，保留未决。 |
| local167 | 0 | CA=42。Gold43多出的Katie Hill唯一任期2019-01-03..11-03不含年末，确证Gold资格冲突。 |
| local169 | 0 | 固定队列4033；对齐、删失、浮点周年、周年快照、端点、空隙桥接、任期重复等真实实验仍未唯一定位Gold分子，诚实未决。 |
| local171 | 0 | 原及独立只加1917..1999年末观察窗均全部匹配Gold；题面无此限制，合法在任者下界反例确证Gold局部冲突。首州/任一LA另有歧义。 |
| local358 | 0 | 原声明user_id实体却COUNT320重复行，实为30用户，局部实现错。原-Gold全部raw数值差异由2024-04-07..10-22参考日区间复现，但无权威日依据。 |

索引：[lanes/E/analysis-index.md](lanes/E/analysis-index.md)。证据自检：[lanes/E/artifact-checks.json](lanes/E/artifact-checks.json)。两项Gold冲突、两项未决、一项局部实现错，不把评分匹配等同业务事实，也不据独立离线预算评价接口因果收益。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "五题analysis.md/analysis.json逐题落盘；artifact-checks.json确认五条发布CSV/SQL/freeze链、freeze先于reveal、引文逐字可定位；完成60次实际桥接只读SQL验证并披露未决项。"
    }
  ],
  "changedFiles": [
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local070/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local167/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local169/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local171/",
    "evaluations/spider2/adr0007/independent-recompute-35/cases/local358/",
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/E/",
    "evaluations/spider2/adr0007/independent-recompute-35/workflow-result.lane-E.md"
  ],
  "testsAddedOrUpdated": [
    "evaluations/spider2/adr0007/independent-recompute-35/lanes/E/verify_artifacts.py"
  ],
  "commandsRun": [
    {
      "command": "answering_bridge.mjs localNNN set/query/final/freeze/reveal，5题",
      "result": "passed",
      "summary": "60次实际SQL，5个最终Candidate及授权CSV，均先freeze后reveal；local070早期selection序列化拒绝已修正且算法不变，日志保留。"
    },
    {
      "command": "compare_csv.py local070/local167/local169/local171/local358",
      "result": "passed",
      "summary": "独立官方评分依次1、0、0、0、0；评分仅作为对照，不认证业务正确性。"
    },
    {
      "command": "python evaluations/spider2/adr0007/independent-recompute-35/lanes/E/verify_artifacts.py",
      "result": "passed",
      "summary": "5个授权链完整，发布SQL与独立SQL相同，冻结早于揭示，全部结构化引文路径和原文核对成功。"
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "无暂存文件。"
    }
  ],
  "validationOutput": [
    "60 actual read-only SQL executions; 5 final executions; 5 freeze-before-reveal checks passed.",
    "local167 CA闭/开端点、显式年末枚举均42；Gold43含无年末任期者。",
    "local171加入日期维表覆盖窗后按period全部复现Gold，原题未给覆盖窗。",
    "local358 birthday-transition sweep唯一匹配Gold区间2024-04-07..2024-10-22，非唯一业务参考日。"
  ],
  "residualRisks": [
    "local070代表城裁决无明确依据；最小ID匹配Gold不证明业务优先级。",
    "local169经过真实合理变体实验仍未唯一解释Gold全部20期分子，保留未决。",
    "local171来自LA、完整周年与连续时长未完全指定；Gold截断不能裁决首州定义。",
    "local358参考日未指定；重复计数缺陷确证，但与全部Gold失分日期解释应分开。",
    "Gold SQL均缺失；可复现变体不等于确证Gold生成机制。"
  ],
  "noStagedFiles": true,
  "diffSummary": "仅新增或更新本人五个case研究产物、lane E目录及指定总结；未修改公共CLI、源码、数据库、原运行、旧报告。",
  "reviewFindings": [
    "local167/local171：可确证的局部Gold冲突。",
    "local358：原实体计数实现缺陷，Gold亦重复计数；日期选择未唯一。",
    "local070/local169：保持未决，不以得分或猜测宣称业务错误。"
  ],
  "manualNotes": "按独立盲解顺序逐题完成并落盘，未自主派Agent、运行评测runner、提交或PR。local070接口格式错误已反馈并修正；没有绕过桥接执行SQL。验证及详细反例均可在本人case日志复核。"
}
```
