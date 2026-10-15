# 最新 fieldtree run 错题审阅协议

## 范围
只读 `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010` 与 Spider2 的题面、业务知识、Gold SQL/CSV、正式评测器。不查数据库、不执行 solver SQL、不重跑付费模型、不修改运行器/ADR/旧标注。此任务是离线审阅，不创建数据库 Query Task。无需加载 answer-spec。不得借用历史分类决定最新错因。

父协调者已将两次 `official_score/summary-attempt-001.json`、`summary-retry.json` 的 execResult.caseScores 合并并确认与最新 summary.json 逐题map一致；按101个实际CSV重放官方纯比较函数，101/101与评分相同。最新实际口径：40 correct、61 wrong、17 unscored，118固定分母；不能用旧report.md/score-record.json/evaluation.json的18/39，也不能直接用合并summary的score 22/62当40/101。

`registry.json`逐题明确attempt；优先`cases/<id>/attempts/<attempt>/...`，不能用case根result/trace（local099/130/131根记录仍是402，重试已产出）。分批reading packets保留了tool calls参数、真实返回里的fields/outcomes、查询预览、知识/子代理摘要与绑定的提交SQL/CSV，未包含重复的通用Skill与反馈概率大块。必要时回到原trace细读，尤其业务文档、拒绝原因、后续修订、explorer支持的物理事实。所有source_file/json_pointer引文应指向原始源，而不是阅读包。

## 评分与业务事实区别
官方 evaluate.py:77–125 的 CSV 比较忽略列名、列序；额外预测列不会单独导致失败；ignore_order=True时忽略行序；condition_cols只限定Gold检查列；数值abs_tol=0.01。必须读每题evaluation_settings，不能把多列/列序/改别名单独当本次错因。字符串、行数、指定比较列的数值仍会失配。

每题按 题面/标准 → 本attempt实际Spec状态（必须看返回是否applied/rejected）→ 实际提交SQL → 比较的CSV 追踪。别把最后探针当最终SQL；先比bound_final_sql与submitted_sql。输出实际结果与Gold的具体差异，不从结果变化倒推不可见Gold处理。

Gold SQL缺失时，题面显式规定可证明SQL违背；但只有粗标准和不同数值，无法恢复Gold隐含单位、总体、日期锚点、空值政策就留未定。Gold自身有问题必须有具体题面矛盾，不以Gold缺失/定义不唯一作证明。平均加权、计数对象/连接放大、单位、缺期等每一项都须引用原文；观察和模型推断不是标准业务事实。

字段路径以目前ADR-0007第二阶段18节点为词汇；可见性只对口径错标注（最新ADR已明确）；正确声明但SQL实现偏离单独说明，不强贴未声明。

## 每题JSONL输出（只写lane文件）
{
 "instance_id": "local...", "attempt_id": "...",
 "cause_status": "confirmed|probable|unresolved|gold_conflict",
 "bifurcation_node": "18节点或树外或null", "error_layer": "口径错|实现错|方言或数据错|标准答案有问题|null",
 "visibility": "未声明|误标不适用|题面引用错|假定错|待定后决定错|null",
 "title": "简短中文题意", "standard": "应求什么",
 "actual": "本次SQL实际上算什么", "observed_difference": "评分比较的具体结果差异",
 "spec_handling": "本次实际fields状态、依据、open/决定、拒绝/成功及与SQL的关系",
 "cause": "最早可证差异及排除上游疑点；或为何不能确定",
 "process_findings": ["接口错误、修订预算、反馈失效等次要机制，不冒充主因"],
 "primary_pattern": "下列统一标签之一", "secondary_patterns": [],
 "recommendation": "针对本题的修复/验证步骤，未知口径需补证不擅自替换",
 "limitations": [],
 "evidence": [{"role":"request|standard|sql|spec|result|process|score", "source_file":"绝对路径", "record_id":"JSONL才需", "json_pointer":"/toolCalls/原index/args/...（plain SQL/CSV可null）", "quote":"逐字连续子串", "supports":"为何支持结论"}]
}

至少三类证据：题面/标准、实际SQL、实际Spec成功返回或明确失败信息；结果差异必须给CSV/Gold或结果profile出处。原始JSON对象引文可采用json.dumps(ensure_ascii=False)的连续子串；字符串用实际文本，不用JSON转义形式。JSONL用record_id挑本题记录；纯文本SQL/CSV不设pointer。所有引文必须可程序核验，禁止省略号拼接。

统一pattern标签（每题primary一个，secondary可多）：
- population_scope：资格/条件及作用阶段、零实体
- source_or_identity：数据来源、业务键/姓名合并/版本
- formula_aggregation：嵌套顺序/粒度/加权/数学公式
- count_or_join：计数对象、连接权重/放大（需要事实）
- time_or_missing：时间事件、锚点/端点、缺期
- ranking_or_ties：排名域/argmin对象/并列
- units_or_precision：运算倍率/单位/数值精度
- output_values：实际被评分字符串/时间格式/行粒度（非单纯列名列序）
- spec_sql_drift：已成功正确声明但最终SQL违背
- spec_api_friction：字段接口/探针/证据引用循环（多为secondary）
- gold_conflict：Gold与明确题面冲突
- insufficient_evidence：标准细则缺失，无法定位

不强求每题已知根因；unresolved是证据边界而非完成定性。probable是候选机制，必须说怎样反证。过程接口失败不一定导致最终业务错，最终业务有错也不能说所有API报错是根因。

## 阅读方式与责任
父写最终md与统计，lane1..6各仅写自己的lane-N-analysis.jsonl；研究lane仅写score-and-process-audit.md。这是明确的单文件写入隔离，互不修改；源run严格只读。lanes.json列ID和路径。不要启动子代理，不提交git，不写数据库查询。
逐题完整读packet的question/standard_semantics/submitted_sql/Gold及全部Spec calls，遇超长逐字段分块，不能只看头尾。无须请父代替逐题判断：用协议unresolved/probable保留不确定性并完整产出；只有文件不可读/分工冲突才联系主管。Python打印须PYTHONIOENCODING=utf-8，避免中文乱码。完成后自检ID覆盖、最新attempt和逐字引文，摘要含困难个案及模式候选；父再统一复核。
