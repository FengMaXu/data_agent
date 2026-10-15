# 独立题解
原题逐字："For each year, calculate the percentage of films that had exclusively female actors (meaning no male actors and no actors with unknown/unspecified gender). Consider actors with gender marked as 'Male' or 'None' as non-female. For the results, display the year, the total number of movies in that year, and the percentage of movies with exclusively female actors. Extract the year from the Movie.year field by taking the last 4 characters and converting to a number."
没有业务文档。分母是每年全部Movie，不应因演员连接丢掉电影。年份严格substr(year,-4)转换integer。分子要求至少一位已知Female演员且没有任何非Female/NULL/缺Person演员；空cast不能证实had female actors，故主解释排除，另算空cast无反例的逻辑备选。按MID区分电影并避免cast重复扩张分母。核对键唯一性、Gender取值、PID/MID空白、无法连接和cast空集，真实验证后冻结。

## 父Agent接手后的独立探查补充（仍未揭示Gold）
cast身份字符串实际带空白，主算法TRIM链接身份，Person同PID多条记录先合并其非Female标志，再每电影聚合，避免演员重复放大；任意重复记录标记非Female则保守排除。只将字符串外围空白作为物理键清理，不把Male/NULL改成Female。键/空cast及正例均实际查询。
