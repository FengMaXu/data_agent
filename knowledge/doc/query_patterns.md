# SQL 查询模板

## 行业大类累计销售额查询模板

### 查询指定行业大类在指定月份的累计销售额和同比增速
```sql
-- 查询指定行业大类在指定月份的累计销售额和同比增速
-- 参数说明：
--   @industry_code_large: 行业大类代码（如：'51' 表示批发业）
--   @target_month: 目标月份（格式：'YYYY-MM-01'）

SELECT 
    di.industry_name_large as 行业大类,
    f.snapshot_month as 月份,
    ROUND(SUM(f.sales_ytd), 4) as 本年累计销售额_亿元,
    ROUND(SUM(f.sales_ytd_last_year), 4) as 上年同期累计销售额_亿元,
    ROUND((SUM(f.sales_ytd) - SUM(f.sales_ytd_last_year)) / SUM(f.sales_ytd_last_year) * 100, 2) as 同比增速_百分比
FROM fact_sales_monthly f
JOIN dim_company_monthly_snapshot s ON f.company_id = s.company_id AND f.snapshot_month = s.snapshot_month
JOIN dim_industry di ON s.industry_code = di.industry_code
WHERE di.industry_code_large = '51'  -- 替换为实际行业大类代码
    AND f.snapshot_month = '2025-12-01'  -- 替换为目标月份
GROUP BY di.industry_name_large, f.snapshot_month
```

### 查询行业大类全年各月累计销售额趋势
```sql
-- 查询行业大类全年各月累计销售额趋势
-- 参数说明：
--   @industry_code_large: 行业大类代码
--   @year: 目标年份

SELECT 
    f.snapshot_month as 月份,
    ROUND(SUM(f.sales_ytd), 4) as 本年累计销售额_亿元,
    ROUND(SUM(f.sales_ytd_last_year), 4) as 上年同期累计销售额_亿元,
    ROUND((SUM(f.sales_ytd) - SUM(f.sales_ytd_last_year)) / SUM(f.sales_ytd_last_year) * 100, 2) as 同比增速_百分比
FROM fact_sales_monthly f
JOIN dim_company_monthly_snapshot s ON f.company_id = s.company_id AND f.snapshot_month = s.snapshot_month
JOIN dim_industry di ON s.industry_code = di.industry_code
WHERE di.industry_code_large = '51'  -- 替换为实际行业大类代码
    AND f.snapshot_month >= '2025-01-01'  -- 替换为年份开始
    AND f.snapshot_month <= '2025-12-01'  -- 替换为年份结束
GROUP BY f.snapshot_month
ORDER BY f.snapshot_month
```

### 查询所有行业大类在指定月份的销售额排名
```sql
-- 查询所有行业大类在指定月份的销售额排名
-- 参数说明：
--   @target_month: 目标月份

SELECT 
    di.industry_name_large as 行业大类,
    ROUND(SUM(f.sales_ytd), 4) as 本年累计销售额_亿元,
    ROUND(SUM(f.sales_ytd_last_year), 4) as 上年同期累计销售额_亿元,
    ROUND((SUM(f.sales_ytd) - SUM(f.sales_ytd_last_year)) / SUM(f.sales_ytd_last_year) * 100, 2) as 同比增速_百分比,
    ROUND(SUM(f.sales_ytd) / (SELECT SUM(sales_ytd) FROM fact_sales_monthly WHERE snapshot_month = '2025-12-01') * 100, 2) as 占比_百分比
FROM fact_sales_monthly f
JOIN dim_company_monthly_snapshot s ON f.company_id = s.company_id AND f.snapshot_month = s.snapshot_month
JOIN dim_industry di ON s.industry_code = di.industry_code
WHERE f.snapshot_month = '2025-12-01'  -- 替换为目标月份
    AND di.industry_code_large IS NOT NULL
GROUP BY di.industry_code_large, di.industry_name_large
ORDER BY SUM(f.sales_ytd) DESC
```

## 企业月度累计销售额查询模板

### 查询特定企业月度累计销售额和增速
```sql
-- 查询特定企业月度累计销售额和增速
-- 参数说明：
--   @company_name: 企业名称（支持模糊匹配）
--   @start_month: 开始月份（格式：'YYYY-MM-01'）
--   @end_month: 结束月份（格式：'YYYY-MM-01'）

-- 第一步：先查找企业ID
SELECT company_id, company_name 
FROM dim_company 
WHERE company_name LIKE '%春晓花开%'  -- 替换为实际企业名称关键词
   OR company_name LIKE '%春晓%' 
   OR company_name LIKE '%花开%';

-- 第二步：查询企业月度累计销售额和增速（使用上一步找到的company_id）
SELECT 
    DATE_FORMAT(snapshot_month, '%Y-%m') as 月份,
    sales_ytd as 累计销售额_亿元,
    yoy_growth_rate as 同比增速_百分比
FROM fact_sales_monthly 
WHERE company_id = 262497  -- 替换为实际企业ID
    AND snapshot_month >= '2025-02-01'  -- 替换为开始月份
    AND snapshot_month <= '2025-12-01'  -- 替换为结束月份
ORDER BY snapshot_month;

-- 或者使用企业名称直接查询（一步完成）
SELECT 
    DATE_FORMAT(f.snapshot_month, '%Y-%m') as 月份,
    f.sales_ytd as 累计销售额_亿元,
    f.yoy_growth_rate as 同比增速_百分比,
    c.company_name as 企业名称
FROM fact_sales_monthly f
JOIN dim_company c ON f.company_id = c.company_id
WHERE c.company_name LIKE '%春晓花开%'  -- 替换为实际企业名称
    AND f.snapshot_month >= '2025-02-01'  -- 替换为开始月份
    AND f.snapshot_month <= '2025-12-01'  -- 替换为结束月份
ORDER BY f.snapshot_month;
```
## 行业大类正增长企业统计模板

### 统计多个行业大类的正增长企业数量及累计销售额增量
```sql
-- 统计多个行业大类的正增长企业数量及累计销售额合计增量
-- 参数说明：
--   @industry_codes: 行业大类代码列表（如：'51','52','62' 表示批发业、零售业、餐饮业）
--   @start_month: 开始月份（格式：'YYYY-MM-01'）
--   @end_month: 结束月份（格式：'YYYY-MM-01'）

SELECT 
    i.industry_name_large AS 行业大类,
    COUNT(DISTINCT CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN s.company_id END) AS 正增长企业数量,
    ROUND(SUM(CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN s.sales_ytd - s.sales_ytd_last_year ELSE 0 END), 4) AS 累计销售额合计增量_亿元
FROM fact_sales_monthly s
JOIN dim_company_monthly_snapshot cs 
    ON s.company_id = cs.company_id 
    AND s.snapshot_month = cs.snapshot_month
JOIN dim_industry i ON cs.industry_code = i.industry_code
WHERE s.snapshot_month >= '2026-01-01'  -- 替换为开始月份
    AND s.snapshot_month <= '2026-02-01'  -- 替换为结束月份
    AND i.industry_code_large IN ('51', '52', '62')  -- 替换为实际行业大类代码列表
    AND s.sales_ytd IS NOT NULL 
    AND s.sales_ytd_last_year IS NOT NULL
GROUP BY i.industry_name_large
ORDER BY i.industry_name_large
```

### 统计行业大类月度正增长企业详细数据
```sql
-- 统计行业大类月度正增长企业详细数据（分月展示）
-- 参数说明：
--   @industry_codes: 行业大类代码列表
--   @start_month: 开始月份
--   @end_month: 结束月份

SELECT 
    DATE_FORMAT(s.snapshot_month, '%Y-%m') AS 月份,
    i.industry_name_large AS 行业大类,
    COUNT(DISTINCT s.company_id) AS 总企业数,
    COUNT(DISTINCT CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN s.company_id END) AS 正增长企业数,
    ROUND(SUM(s.sales_ytd), 4) AS 本月累计销售额_亿元,
    ROUND(SUM(s.sales_ytd_last_year), 4) AS 上年同期累计销售额_亿元,
    ROUND(SUM(s.sales_ytd - s.sales_ytd_last_year), 4) AS 总增量_亿元,
    ROUND(COUNT(DISTINCT CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN s.company_id END) * 100.0 / COUNT(DISTINCT s.company_id), 2) AS 正增长企业占比_百分比
FROM fact_sales_monthly s
JOIN dim_company_monthly_snapshot cs 
    ON s.company_id = cs.company_id 
    AND s.snapshot_month = cs.snapshot_month
JOIN dim_industry i ON cs.industry_code = i.industry_code
WHERE s.snapshot_month >= '2026-01-01'  -- 替换为开始月份
    AND s.snapshot_month <= '2026-02-01'  -- 替换为结束月份
    AND i.industry_code_large IN ('51', '52', '62')  -- 替换为实际行业大类代码列表
    AND s.sales_ytd IS NOT NULL 
    AND s.sales_ytd_last_year IS NOT NULL
GROUP BY s.snapshot_month, i.industry_name_large
ORDER BY s.snapshot_month, i.industry_name_large
```
## 新纳统企业统计模板

### 统计多个行业大类的新纳统企业数量及累计销售额增量
```sql
-- 统计多个行业大类的新纳统企业数量及累计销售额合计增量
-- 参数说明：
--   @industry_codes: 行业大类代码列表（如：'51','52','62' 表示批发业、零售业、餐饮业）
--   @base_month: 基准月份（格式：'YYYY-MM-01'，如：'2025-12-01'）
--   @target_month: 目标月份（格式：'YYYY-MM-01'，如：'2026-02-01'）

SELECT 
    i.industry_name_large AS 行业大类,
    COUNT(DISTINCT cs_target.company_id) AS 新纳统企业数量,
    ROUND(SUM(s.sales_ytd - s.sales_ytd_last_year), 4) AS 累计销售额合计增量_亿元
FROM dim_company_monthly_snapshot cs_target
JOIN dim_industry i ON cs_target.industry_code = i.industry_code
LEFT JOIN (
    SELECT company_id 
    FROM dim_company_monthly_snapshot 
    WHERE snapshot_month = '2025-12-01'  -- 替换为基准月份
        AND is_four_above = 1
) cs_base ON cs_target.company_id = cs_base.company_id
JOIN fact_sales_monthly s ON cs_target.company_id = s.company_id 
    AND cs_target.snapshot_month = s.snapshot_month
WHERE cs_target.snapshot_month = '2026-02-01'  -- 替换为目标月份
    AND cs_target.is_four_above = 1
    AND i.industry_code_large IN ('51', '52', '62')  -- 替换为实际行业大类代码列表
    AND cs_base.company_id IS NULL
    AND s.sales_ytd IS NOT NULL
    AND s.sales_ytd_last_year IS NOT NULL
GROUP BY i.industry_name_large
ORDER BY i.industry_name_large
```

### 统计新纳统企业详细数据（包含增长情况分析）
```sql
-- 统计新纳统企业详细数据（包含增长情况分析）
-- 参数说明：
--   @industry_codes: 行业大类代码列表
--   @base_month: 基准月份
--   @target_month: 目标月份

SELECT 
    i.industry_name_large AS 行业大类,
    COUNT(DISTINCT cs_target.company_id) AS 新纳统企业总数,
    COUNT(DISTINCT CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN cs_target.company_id END) AS 正增长新纳统企业数,
    COUNT(DISTINCT CASE WHEN s.sales_ytd <= s.sales_ytd_last_year THEN cs_target.company_id END) AS 非正增长新纳统企业数,
    ROUND(COUNT(DISTINCT CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN cs_target.company_id END) * 100.0 / COUNT(DISTINCT cs_target.company_id), 2) AS 正增长企业占比_百分比,
    ROUND(SUM(s.sales_ytd), 4) AS 目标月累计销售额_亿元,
    ROUND(SUM(s.sales_ytd_last_year), 4) AS 上年同期累计销售额_亿元,
    ROUND(SUM(s.sales_ytd - s.sales_ytd_last_year), 4) AS 累计销售额合计增量_亿元,
    ROUND(AVG(s.sales_ytd), 4) AS 平均累计销售额_亿元,
    ROUND(AVG(s.sales_ytd_last_year), 4) AS 平均上年同期销售额_亿元,
    ROUND(AVG(s.sales_ytd - s.sales_ytd_last_year), 4) AS 平均增量_亿元
FROM dim_company_monthly_snapshot cs_target
JOIN dim_industry i ON cs_target.industry_code = i.industry_code
LEFT JOIN (
    SELECT company_id 
    FROM dim_company_monthly_snapshot 
    WHERE snapshot_month = '2025-12-01'  -- 替换为基准月份
        AND is_four_above = 1
) cs_base ON cs_target.company_id = cs_base.company_id
JOIN fact_sales_monthly s ON cs_target.company_id = s.company_id 
    AND cs_target.snapshot_month = s.snapshot_month
WHERE cs_target.snapshot_month = '2026-02-01'  -- 替换为目标月份
    AND cs_target.is_four_above = 1
    AND i.industry_code_large IN ('51', '52', '62')  -- 替换为实际行业大类代码列表
    AND cs_base.company_id IS NULL
    AND s.sales_ytd IS NOT NULL
    AND s.sales_ytd_last_year IS NOT NULL
GROUP BY i.industry_name_large
ORDER BY i.industry_name_large
```

### 识别新纳统企业清单（企业级明细）
```sql
-- 识别新纳统企业清单（企业级明细）
-- 参数说明：
--   @industry_codes: 行业大类代码列表
--   @base_month: 基准月份
--   @target_month: 目标月份

SELECT 
    c.company_name AS 企业名称,
    i.industry_name_large AS 行业大类,
    i.industry_name_medium AS 行业中类,
    i.industry_name_small AS 行业小类,
    ROUND(s.sales_ytd, 4) AS 目标月累计销售额_亿元,
    ROUND(s.sales_ytd_last_year, 4) AS 上年同期累计销售额_亿元,
    ROUND(s.sales_ytd - s.sales_ytd_last_year, 4) AS 销售额增量_亿元,
    CASE WHEN s.sales_ytd > s.sales_ytd_last_year THEN '正增长' ELSE '非正增长' END AS 增长状态
FROM dim_company_monthly_snapshot cs_target
JOIN dim_industry i ON cs_target.industry_code = i.industry_code
JOIN dim_company c ON cs_target.company_id = c.company_id
LEFT JOIN (
    SELECT company_id 
    FROM dim_company_monthly_snapshot 
    WHERE snapshot_month = '2025-12-01'  -- 替换为基准月份
        AND is_four_above = 1
) cs_base ON cs_target.company_id = cs_base.company_id
JOIN fact_sales_monthly s ON cs_target.company_id = s.company_id 
    AND cs_target.snapshot_month = s.snapshot_month
WHERE cs_target.snapshot_month = '2026-02-01'  -- 替换为目标月份
    AND cs_target.is_four_above = 1
    AND i.industry_code_large IN ('51', '52', '62')  -- 替换为实际行业大类代码列表
    AND cs_base.company_id IS NULL
    AND s.sales_ytd IS NOT NULL
    AND s.sales_ytd_last_year IS NOT NULL
ORDER BY i.industry_name_large, s.sales_ytd - s.sales_ytd_last_year DESC