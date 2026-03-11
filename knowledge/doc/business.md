# Business Knowledge

## 业务指标定义

### 同比增速 (Year-over-Year Growth Rate)
- **定义**: 与去年同期相比的增长百分比
- **关联表**: fact_sales_monthly, fact_retail_monthly
- **正确计算方式**: `(SUM(本年累计值) - SUM(上年同期累计值)) / SUM(上年同期累计值) * 100`
- **错误做法**: 不能直接对各个企业的增速进行平均（AVG(yoy_growth_rate)）
- **示例**:
  - 批发业2025年12月累计销售额: 7,276.5712亿元
  - 批发业2024年12月累计销售额: 9,492.5824亿元
  - 正确增速: `(7276.5712 - 9492.5824) / 9492.5824 * 100 = -23.34%`
  - 错误增速: `AVG(yoy_growth_rate) = 23.59%` (完全错误!)

### 行业分类信息
- **批发业**: 行业大类代码为 "51"
- **行业层级**: 行业门类 → 行业大类 → 行业中类 → 行业小类
- **常用行业大类代码**:
  - 51: 批发业
  - 52: 零售业
  - 其他行业代码可通过 `dim_industry` 表查询


### 汇总指标计算规则
1. **汇总值的同比增速必须重新计算**，不能直接对个体增速进行平均
2. **正确SQL示例**:
   ```sql
   -- 正确：先汇总再计算增速
   SELECT 
       industry,
       SUM(sales_ytd) as current_year_total,
       SUM(sales_ytd_last_year) as last_year_total,
       (SUM(sales_ytd) - SUM(sales_ytd_last_year)) / SUM(sales_ytd_last_year) * 100 as correct_growth_rate
   FROM fact_sales_monthly
   GROUP BY industry
   
   -- 错误：直接平均个体增速
   SELECT 
       industry,
       AVG(yoy_growth_rate) as wrong_growth_rate  -- 这是错误的！
   FROM fact_sales_monthly
   GROUP BY industry
   ```
3. **原因**: 个体增速的权重不同，直接平均会扭曲整体趋势
4. **适用场景**: 行业汇总、区域汇总、品类汇总等所有需要计算汇总增速的场景

## 常见问题

### 汇总增速计算错误
- **影响表**: fact_sales_monthly, fact_retail_monthly
- **错误表现**: 使用 `AVG(yoy_growth_rate)` 计算汇总增速
- **正确做法**: 先计算汇总值，再计算增速
- **严重后果**: 可能导致增速方向完全相反（如负增长显示为正增长）

## 图表风格
| 元素       | 常见咨询风格设置                  | 备注                              |
|------------|-----------------------------------|-----------------------------------|
| 主色       | #003087 (深蓝) / #005566 (深青)   | BCG / Bain 常用深蓝系            |
| 辅助色     | #A6192E (暗红) / #F5A623 (橙)     | 用于警示或重点                    |
| 背景       | #FFFFFF 或 #F5F5F5 极浅灰         | 大量留白                          |
| 字体       | Segoe UI / Calibri 9–12pt/黑色       | 标题加粗 14–18pt                  |
| 图表边框   | 无边框 或 极细 0.5pt 灰           | 几乎看不到边框                    |
| 数据标签   | 直接标在柱子上 / 线上，不用图例   | 减少认知负担                      |
