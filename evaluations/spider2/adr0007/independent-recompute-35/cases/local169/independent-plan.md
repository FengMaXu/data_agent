# 揭示前独立题解
原文："legislators who began their first term between January 1, 1917 and December 31, 1999"；"proportion of this cohort still in office on December 31st for each of the first 20 years following their initial term start"；"all 20 periods in sequence"。
先在全部任期上求每人第一次term_start，再含端点筛1917-01-01..1999-12-31，不可先筛任期再min。固定全cohort人数为分母，每人每期只计一次，任一期若至少一任期包含观察日则留存，不要求此前从未离任。独立生成20个周年日历期：period0=首次起始年的12-31，period19=起始年+19年的12-31（这不是20个完整周年，题面年末与following的对齐未完全确定；选最早后续年末作为第一观测）。闭区间任期，比例0..1，无随访年份1999截止，因为限制的是首次开始日。日期维表仅作观测，不把维表最后一天当随访截止。若某期无人留存仍保留零值。
备选：期1..20对应起始年后一年开始，或按完整周年取年末；将真实计算此备选，但不靠Gold决定。
无业务文档；term_end闭/开是未证实假定，实际做敏感性验证。
