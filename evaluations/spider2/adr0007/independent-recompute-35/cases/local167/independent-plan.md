# 揭示前自由题解
题面原文："Based on the state each female legislator first represented"、"highest number of female legislators whose terms included December 31st at any point"。
按人(id_bioguide)统计，不按任职记录或人年。先找每人最早term_start的州，再筛女性；只要任一任期包含任一年12-31即可。每人只归首州一次。included默认闭区间（含起止日）；检查端点。任期内第一个可能年末是起始年份12-31，若不晚于term_end就满足。没有限定统计年代，不依赖日期维表覆盖范围。最高州保留并列。
无业务文档；多条同时最早不同州时按term_number/term_id作稳定选择，验证是否有这种歧义。
