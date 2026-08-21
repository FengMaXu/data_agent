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

### 新纳统企业 (Newly Added Four-Above Enterprises)
- **定义**: 相较与基准月份，新增的四上企业
- **具体标准**: 
  1. 在目标月份是四上企业 (`is_four_above = 1`)
  2. 在基准月份不是四上企业 (`is_four_above = 0` 或企业不存在于基准月份的四上企业名单中)
- **关联表**: `dim_company_monthly_snapshot`
- **关键字段**: `is_four_above` (tinyint(1)) - 标识企业是否为"四上"企业 (1:是, 0:否)
- **常见应用场景**:
  - 统计月度/季度新增的四上企业数量
  - 分析新纳统企业对行业增长的贡献
  - 监测"四上"企业培育成效
- **SQL识别逻辑**:
  ```sql
  -- 识别新纳统企业的核心逻辑
  SELECT 目标月.company_id
  FROM dim_company_monthly_snapshot 目标月
  LEFT JOIN (
      SELECT company_id 
      FROM dim_company_monthly_snapshot 
      WHERE snapshot_month = '基准月份' 
          AND is_four_above = 1
  ) 基准月 ON 目标月.company_id = 基准月.company_id
  WHERE 目标月.snapshot_month = '目标月份'
      AND 目标月.is_four_above = 1
      AND 基准月.company_id IS NULL  -- 在基准月份不是四上企业
  ```
- **注意事项**:
  1. 需要明确基准月份和目标月份
  2. 企业可能在基准月份不存在（新成立企业），也可能存在但不是四上企业
  3. 统计时应确保企业有完整的销售额数据用于增量计算

#### 多行业整体新增口径（三行业合计统计时）
- **单行业口径**：该行业目标月为四上、基准月不是四上（含基准月为其他行业四上的转行业进入企业）。内部互转计入目标行业新增。
- **三行业整体新增口径**（批发/零售/餐饮合计）：
  1. 新纳统：基准月非四上（或不存在），目标月为三行业中某一行业四上
  2. 三行业外部转入：基准月为三行业以外行业的四上企业，目标月转入三行业中某一行业
  3. **剔除三行业内部互转**：基准月已是三行业之一（51/52/62）的四上企业，目标月转至另一行业（如零售业→批发业），不计入三行业整体新增；此类企业仅计入单行业新增
- **示例**：2026年1-7月（基准2025-12，目标2026-07），批发零售餐饮三行业整体新增 = 311 新纳统 + 6 外部转入 = **317 家**（含内部互转则为318家，需剔除1家零售→批发互转）