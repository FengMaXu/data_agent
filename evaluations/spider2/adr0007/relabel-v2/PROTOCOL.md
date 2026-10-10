# wrong118 逐卷宗重标协议

## 范围与写入隔离
这是离线评测卷宗重标，不取数据库，不创建 Query Task。原卷宗及原有 classification 文件只读。父协调者最终合并、核对引文；六个 lane 只写各自 lane-N-labels.jsonl。来源行号以 wrong118-dossiers.jsonl 为准，lanes.json 记录隔离路径与分工。不得查旧标注来决定答案，不得凭 diff_clue / 结果行数推断错误节点。

## 权威与比较
阅读 docs/ADR-0007字段模型转交文档.md、docs/adr/0007-answer-spec-as-one-field-vocabulary.md 第二阶段字段树定义。逐题完整阅读 instruction、standard_semantics（含 gold_sql）、final_sql、our_spec_and_decisions（spec_info 与全部 decisions）。gold_sql 为 null 时必须披露，没有 SQL 或结果全集，不臆造 Gold 隐藏处理。Spec tool 的参数是声明/处置意图；卷宗若不含工具返回，不能宣称成功生效，优先实际 spec_info，提议与已采纳必须区分。

18 节点：population；population.entity；population.eligibility；population.conditions；population.source；population.time；population.timeField；population.missing；population.joinMultiplicity；measure；measure.formula；measure.countGrain；measure.denominator；measure.window；grouping；selection；selection.ties；output。选最早实际分叉节点，总体→度量→分组→选取→输出；父节点只用于跨多个子节点无法更细定位，不因为任何 filter/join 存在就判它有错。总体内部依实际 SQL 数据流依赖次序，无依赖并列时按 ADR 展示顺序。同一数据事实但金额列不同（price vs payment）通常是度量成分 measure.formula，不因列来自另一表就自动判 population.source；替换总体数据集/不同业务实体来源才是 source。资格实体纳入/零空实体归 eligibility，一般具体条件及 WHERE/HAVING 阶段归 conditions。嵌套均值/权重/顺序先归 formula，仅计数对象错归 countGrain，仅分母总体错归 denominator。单位/舍入归 output（中间取整实质改变运算也说明）。没有证据证明上游错误，不凭下游数值不同猜上游。

错误层四选一：口径错 / 实现错 / 方言或数据错 / 标准答案有问题。明确 Spec 与标准一致但 SQL 违背它才是实现错；声明本身采用另一业务读法是口径错。结构行放大/类型运算可属实现错，不假称数据库有重复。Gold 有问题必须引用题面/标准与 Gold 的具体矛盾；没有 Gold SQL、不完整业务文档、不唯一解释本身不证明 Gold 错。

可见性只依据该分叉节点在 Spec 及决定里的声明：未声明 / 误标不适用 / 题面引用错 / 假定错 / 待定后决定错。一般 inferred/模型直接值但无合格题面证据归假定错；以题面片段声称支持错误细项归题面引用错；确实有备选与后续选取归待定后决定错（仅列备选无采纳记录，不臆称已决定；注明证据边界）。不适用只能引用该节点对应的明确 n/a，不能借 time 或 ties 的 n/a 判金额公式不可见。节点正确声明而 SQL 实现错，或 Gold 错而声明正确时，这五个“错误可见性”值可能没有适用值：visibility=null、visibility_status="taxonomy_gap" 并解释，不制造“未声明”。这是一项明确的分类定义缺口，不增造第六类；能放入五类时必须归类。

## 证据不足的统一处置（主管补充）
若标准与最终SQL并无可证实的差异、只有结果不匹配，而缺少Gold SQL/业务细则无法定位，不能为凑四类捏造错因。该题仍输出完整引文记录，但 bifurcation_node=null、error_layer=null、visibility=null、classification_status="insufficient_evidence"、visibility_status="insufficient_evidence"、confidence="low"；解释需补的标准细则。无法定位不等于“树外”；“树外”只用于已知错因确实无法在树上表达。其余已能分类的题设 classification_status="classified"（只可见性有定义缺口时仍为 classified）。此类记录是待补证据，不能计为已确定三项标签。

## 每题输出 JSON（每行一题）
- instance_id, latest_wrong_run, dossier_line（父合并时补）
- bifurcation_node（18节点或树外）, error_layer, visibility（五类或 null，仅无法诚实适用时）
- comparison: {standard: 中文标准要求, actual: 中文 SQL 实际, earliest_reason: 最早节点理由且排除可疑上游, secondary_nodes: 其他分叉节点列表}
- layer_reason, visibility_reason, visibility_status: classified 或 taxonomy_gap
- evidence: 数组，每个 {role: standard|sql|spec|result, path: 源卷宗 RFC6901 JSON pointer, quote: 原文连续子串, supports: 这条原文支持什么}。至少标准、SQL、Spec 各一条。Spec 原文可以字段文本或完整空结构 {} / []（此时取 canonical json.dumps ensure_ascii=False 形式），并说明逐题检索覆盖范围；非空结构不可只用空 hardConstraints 断言整个 Spec 未声明。
- classification_status: classified 或 insufficient_evidence；confidence: high|medium|low；limitations: 数组；tree_out_reason: 树外必填理由，否则 null。

引文必须逐字存在于指定字段；不得省略号拼接。每题至少一条 path 在 /our_spec_and_decisions 下。未声明是完整检查 Spec 后的结论，不是某条空数组直接证明。把没有任何 Spec 的 {} 当作记录缺失而不是证明运行时从没声明，写证据限制。不使用旧标注的自称 consensus、adjudicated 等作为证据。

## 阅读与校验
不要一次打印整个 lane 超出工具输出上限。用 Python json.loads 逐题完整 pretty print，或每次 1–2 题；巨大卷宗分字段/分 decisions 块读完（特别 local063）。可以自动生成字段位置索引供引用，但节点、错误层、可见性必须人工逐题比较，不用批量关键词启发式替代。完成后本地验证条数、唯一ID、原文 quote 确实位于 JSON pointer 指定值内。只写自己的 label 文件，最后简报标签计数/困难个案。
