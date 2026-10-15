# 独立题解（揭示前，初步）
原题：“Among Formula 1 drivers who raced during the 1950s”；“the same constructor in both the first and the last race they participated in”；“at least two distinct race rounds during that season”。1950-1959含端点。逐driver/year统计实际参与round，至少两不同round；取该司机自己参与的MIN/MAX round，不是全年赛历端点。两端constructor相同即可，中间转队后返回不排除。跨年不能拼first/last。最终返回满足至少一季的去重司机名，不输出赛季明细。
results有比赛记录但可能不实际参赛，应先检查status原始值；明确DNS/DNQ/withdrawal等不参赛文本可以排除；不能用laps>0，因为起跑后第一圈退赛也算参赛。shared-car年代同司机同round多constructor需检查：若两端各包含同一constructor，则认为该司机在两端都参与过它，不能用不确定ROW_NUMBER任选一队。
探查后将判定规则记在本plan，再真正计算，不以Gold指导。

## 探查后的独立判定
实际1950s有50个Did not qualify（全0lap），26个Withdrew（24个0lap、2个>0lap）。排除Did not qualify；Withdrew仅0lap排除，正lap明确实际参赛保留。其他0lap机械/事故退赛保留，不把零完圈当未起跑。该判定是标签语义与实际记录的透明推断，非审核业务定义。共有多构造者同round记录，按两端集合相交处理。
