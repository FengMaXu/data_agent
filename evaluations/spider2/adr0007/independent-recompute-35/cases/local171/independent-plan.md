# 独立自然语言题解（Gold前）
原文："For male legislators from Louisiana"、"actively serving on December 31 of each year"、"more than 30 years since their first term up to less than 50 years"、"grouping the results by the exact number of years elapsed since their first term"。
先在全部任期求每人首次任职，取最早任期的州归属（from Louisiana没有明确首次州还是当前任职州；选择首次州LA作为未证实假定，另实测任一LA/当期LA）。限定gender M；生成所有任期覆盖范围内的年末，不把日期维表1917..1999当用户限定。在任用term_start<=Dec31<=term_end（含端点假定）。完整周年数是年末年份减首次年份，因年末总在当年开始月日之后；按整数完成年数过滤31..49，按period count distinct id_bioguide。多任期覆盖一日期去重；同人在不同日历年能归不同period，一人同period计一次。不补零，因为本题没有明确要求空period也输出，独立只输出有人的组。
备选：按浮点天数/365.25直接判断大于30，此时整数期30可能入选；区别整数完成周年与连续时长，真实计算核对但不以Gold作选择依据。
无业务文档。
