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

