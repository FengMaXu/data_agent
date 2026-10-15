# 独立题解（揭示前）
原题：“In Formula 1 seasons since 2001, considering only drivers who scored points in a season, which five constructors have had the most seasons where their drivers scored the fewest total points among all point-scoring drivers in that season?”
先求每年最终可用积分榜的driver-season总积分，排除<=0，再求该年正积分车手的最小值，保留并列车手。少积分车手归属其该年实际参赛constructor，而非整个生涯。一个constructor同一年即使有多个并列最少积分车手也只算一季。since2001含2001，无上限，未完成赛季只到数据库最新积分榜。按constructor累计满足的不同年份，恰取5；并列第5用constructor_id稳定裁决并披露。
总积分优先driver_standings同年最后已有积分榜，避免把累积积分榜再SUM；独立验证results比赛积分加sprint_results与榜积分关系。跨队车手按当年所有实际参赛constructor归属，因为题面没有指定最终车队或只在哪队拿分；跑中间最少者名单验证影响。替代解释是每constructor的车手积分相加后找最小，但“among all point-scoring drivers”明确车手级比较，主答案不按车队总分排名。
