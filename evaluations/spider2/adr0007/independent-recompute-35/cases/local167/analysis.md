
# local167
结论：Gold CA=43与明确年末任职条件冲突；独立和原答案均 CA=42，解释全部1人的差异。

## 原文与独立口径
"Based on the state each female legislator first represented"；"female legislators whose terms included December 31st at any point"。每人按最早任期归首州；任一任期含任一年末即可；count distinct人。不将任期行、人年或日期维表当总体。计划及发布冻结均在揭示前完成。

## 实证
数据库366女性，最早任期无跨州并列。任期1789-03-04至2025-01-03，日期维表1917..1999仅83个12-31。CA首州女性全部43人，只有 H001087 Katie Hill 无符合年末的任期：2019-01-03至2019-11-03，唯一1条。其余42符合。独立COUNT输出42；原SQL重跑42。递归枚举1789..2025每个12-31的第二种算法验证42，排除终点改为不含仍42；日期维表限定版本仅25人，实测见dimension-limited-years日志（不作为业务定义）。去掉年末筛选恰为43，是Gold数字的局部可复现解释，不能认定其真实SQL如此实现。
因此任何符合题意的distinct女性人数上限为42；Gold43不能靠闭/开端点、首次州排序或重复去重解释为正确值。没有Gold SQL仍足以凭完整43人清单与唯一反例定位人口条件冲突。

## 事后原Spec
成功字段 population.conditions 写："该议员的任期中至少有一条覆盖某年 12 月 31 日（作用于议员层 HAVING/EXISTS）"；SQL `lt.term_end >= date(lt.term_start, 'start of year', '+1 year', '-1 day')` 正确实现。原时间字段n/a虽缺乏显式端点记录，SQL含端点，与独立一致，女性端点例子只有MI/NM，不能影响CA。最早分叉若以Gold未筛解释为population.conditions；它不是原语义错误或原实现错，不硬套树可见性。

## 限制
Gold SQL未提供，不能确认其生成机制；可以确证的是CA43违反必须曾覆盖12-31的资格条件。数据库无任期终点业务定义，闭/开两法已证明不影响本答案。
