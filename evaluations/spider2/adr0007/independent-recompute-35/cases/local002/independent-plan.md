# 独立题解（揭示前）
题目：“Can you calculate the 5-day symmetric moving average of predicted toy sales for December 5 to 8, 2018, using daily sales data from January 1, 2017, to August 29, 2018, with a simple linear regression model? Finally provide the sum of those four 5-day moving averages?”
没有业务文档。将sales理解为售出玩具件数，每order_items一行为一件；订单purchase时间为销售日期，类别翻译为toys。不额外过滤状态。sales也可指金额，属未证实假设，实验计算两种。
训练日历从2017-01-01到2018-08-29包含首尾，无销售日补零。x为相对起点日数，y为日玩具件数。OLS b=(sum(x*y)-sum(x)*sum(y)/n)/(sum(x*x)-sum(x)^2/n)，a=avg(y)-b*avg(x)。预测2018-12-03至10；各中心日12月5至8的对称窗口为前后2日含中心5天。线性预测的对称平均数学上等于中心预测，仍显式平均验证。输出四个平均的总和。不截负预测、不四舍五入中间值。另验证有销售日序与真实日序的差异。
