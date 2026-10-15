# 35题独立解题与事后字段审查

用户纠正：不要以字段树指导解题或重跑原框架。必须先自己的理解 -> 实际数据库计算 -> 冻结独立答案 -> Gold对照 -> 原Spec和SQL归因。

## 独立性

每题先只看cases/localNNN/blind.json（原题、官方DDL、题目业务文档）。不得读原Spec/原SQL/Gold/旧诊断/spec-quality-labels.jsonl，直到自己的SQL结果已发布并freeze。先写自己的自然语言解题推导，不按字段节点组织；数据库验证自己的推导。遇到歧义写理由和备选，不以数值吻合替代业务依据。每题先做完再揭示即可，不要求整lane做完才揭示。

工具侧仅作查询授权、任务记账和原始证据持久化，不能把工具的Ready或发布当正确性认证。当前环境要求查询前有独立任务记录；旧begin/revise已被仓库删除，CLI使用其现行替代set_answer_spec，不能让这个技术接口决定业务理解。原运行的Spec一律不复用。查询适配器不调用模型、没有外部反馈或自动口径建议。不要运行评测runner，不要让旧框架再解一遍。

## 文件/写入边界

lane-board.json给每lane5题。只写自己lane目录和自己cases/localNNN目录。只读源运行、数据库、Gold、原审计和所有源代码。公共脚本归父Agent，不要改；遇到故障立即用supervisor反馈。不要再派子Agent。所有任务持续逐题落盘，不要等五题全做完才保存。

## 实际数据库执行

所有SQL通过answering_bridge.mjs，它调用真实工具且保持required qualification；数据库read-only。不得绕过它直接sqlite3.connect或其他DB客户端。先建立该题任务（可以只登记题面明确的实体），即可进行探索，其余尚未声明的字段不妨碍探索。之后自由设计SQL、检查原始数据、计算所需量。不要用字段树猜业务答案。

从D:/data_agent运行：

```bash
node evaluations/spider2/adr0007/independent-recompute-35/answering_bridge.mjs localNNN set <input.json>
node evaluations/spider2/adr0007/independent-recompute-35/answering_bridge.mjs localNNN query <input.json>
node evaluations/spider2/adr0007/independent-recompute-35/answering_bridge.mjs localNNN final <input.json>
node evaluations/spider2/adr0007/independent-recompute-35/answering_bridge.mjs localNNN inspect
node evaluations/spider2/adr0007/independent-recompute-35/answering_bridge.mjs localNNN freeze <note.json>
node evaluations/spider2/adr0007/independent-recompute-35/answering_bridge.mjs localNNN reveal
PYTHONIOENCODING=utf-8 python evaluations/spider2/adr0007/independent-recompute-35/compare_csv.py localNNN
```

输入JSON放自己cases目录。set输入{"fields":{"population.entity":{"value":"独立识别的实体","basis":"request","quote":"题目逐字片段"}}}；首次自动创建真实任务，后续自动复用。修改附reason。
query输入{"sql":"SELECT ...","limit":100}，只做只读SELECT/WITH（可查询sqlite_master获取Schema），运行都在同一独立任务下。完整SQL与原始数据库返回保存在executor-events.jsonl，真实工具响应/观测ID在tool-events.jsonl。探索结果不作为交付；它们是验证证据。

自己算法确定、SQL验证后，再把已经形成的独立答案登记到技术接口，不能反过来用字段表指导求解。最终必需字段为population.entity/eligibility/conditions/time，measure.formula，grouping，selection，output。表达复杂算法可用custom+description，务必准确记录自己推导；avg/count等运算需计数粒度/分母，排名需ties。真不适用才n/a；不确定就披露假定或候选，不随意n/a。没有任何外部advisor建议；不能声称被机器核验了业务正确性。工具写法详见answer-fields Skill，但只用于接口序列化，不作为独立题解方法。

final输入{"sql":"自己的最终SQL"}，生成当前Candidate并自动export_query，授权CSV保存publications/<receiptId>/result.csv和query.sql。遇到拒绝先读实际返回；不能为了通过删口径。所有提供的独立最终数据必须出自这条最终Candidate/Receipt链。freeze输入记自己的算法/假定/限制，封存不可覆盖；freeze后才能reveal。reveal保存在comparison-input.json，含Gold、旧SQL/CSV和原trace/result路径。之后compare_csv.py只读这些CSV，复现官方评分。该评分忽略列名、对列独立匹配，不保证行关联正确，需自己按业务键核对。

## 差异归因与事后审查

完成Gold对照后，必要时通过query探索复跑旧SQL、单变量改变和中间量；不能把探针/探索拼成最终答案。不同参数贴近Gold不等于标准口径已确定。Gold实际违背明确题意或守恒约束时可定局部gold_conflict。独立实现也可能错，应明确承认。

最后再看原trace中成功写入的Spec和最终SQL，确定分叉节点（总体->度量->分组->选取->输出按最早），错误层及可见性。实现错/Gold问题不要硬套语义可见性；树外说明原因。

每题产出：
- independent-plan.md：看Gold前的自然语言题解与假定；
- 独立SQL/授权CSV/Receipt/freeze（CLI持久化）；
- analysis.md：中文原题逐字引文、自己的算法和关键返回、三方差异、验证、根因、事后字段审查、仍未证实项；
- analysis.json：instance_id、status（confirmed_semantic_error/confirmed_implementation_error/gold_conflict/ambiguous_after_recompute/data_or_dialect_error/independent_solution_error/not_completed）、summary、fork_node、error_layer、visibility、independent_score、evidence（source文件与逐字quote；JSON source给pointer）、limitations。

一次只处理一题，做完立即落盘。lanes/<lane>/progress.json持续记各题阶段。最终lane汇总analysis索引。35题全部数据库文件已找到；不要仅因Gold SQL缺失结束调查。需检查键、实际数值、中间分布、时间边界等，真正穷尽合理解释才保留未决。所有脚本/假定/放大预算是独立离线研究，不是原模型同预算A/B，不据此评价接口因果收益。
