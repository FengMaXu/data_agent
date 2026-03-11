# 数据库 Schema 文档

## 数据库概览

本数据库包含企业统计相关的维度表和事实表，主要用于行业销售额和零售额的分析统计。

### 表关系图
```
dim_company (企业主表)
    ↑
dim_company_monthly_snapshot (企业月度快照)
    ↑
dim_industry (行业维度表)
    ↑
fact_sales_monthly (销售额事实表)
fact_retail_monthly (零售额事实表)
```

## 表详细结构

### 1. dim_company (企业主维度表)
**说明**: 存储企业的核心身份信息
**行数**: ~89,639

| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |
|------|------|------|-----|--------|------|
| company_id | bigint | ✗ | PK | None | 主键。系统生成的唯一ID（代理键）。 |
| unified_social_credit_code | varchar(50) | ✗ | UNI | None | 唯一键。统一社会信用代码。 |
| company_name | varchar(255) | ✓ |  | None | 企业官方名称。 |
| org_code | varchar(50) | ✓ |  | None | 组织机构代码。 |

### 2. dim_company_monthly_snapshot (企业月度快照维度表)
**说明**: 记录企业每月的动态属性
**行数**: ~881,898

| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |
|------|------|------|-----|--------|------|
| snapshot_id | bigint | ✗ | PK | None | 主键。快照记录的唯一ID。 |
| company_id | bigint | ✗ | FK | None | 外键，关联到 dim_company。 |
| industry_code | varchar(20) | ✗ | FK | None | 外键，关联到 dim_industry。 |
| snapshot_month | date | ✗ | FK | None | 快照月份，格式为 YYYY-MM-01。 |
| is_four_above | tinyint(1) | ✓ |  | None | 该企业在本月是否为"四上"企业 (1:是, 0:否)。 |
| operating_address | text | ✓ |  | None | 企业在本月的实际经营地址。 |
| district | varchar(100) | ✓ |  | None | 企业在本月所属的片区。 |

### 3. dim_industry (行业维度表)
**说明**: 存储所有行业的分类标准信息
**行数**: ~1,381

| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |
|------|------|------|-----|--------|------|
| industry_code | varchar(20) | ✗ | PK | None | 主键。行业小类代码，唯一标识一个行业细分。 |
| industry_name_small | varchar(255) | ✓ |  | None | 行业小类名称。 |
| industry_code_medium | varchar(20) | ✓ |  | None | 行业中类代码。 |
| industry_name_medium | varchar(255) | ✓ |  | None | 行业中类名称。 |
| industry_code_large | varchar(20) | ✓ |  | None | 行业大类代码。 |
| industry_name_large | varchar(255) | ✓ |  | None | 行业大类名称。 |
| industry_code_category | varchar(10) | ✓ |  | None | 行业门类代码。 |
| industry_name_category | varchar(255) | ✓ |  | None | 行业门类名称。 |
| gdp_industry_code | varchar(20) | ✓ |  | None | GDP行业分类代码。 |
| gdp_industry_name | varchar(255) | ✓ |  | None | GDP行业分类名称。 |
| tertiary_industry_code | varchar(10) | ✓ |  | None | 三次产业代码。 |
| tertiary_industry_name | varchar(50) | ✓ |  | None | 三次产业划分名称。 |

### 4. fact_sales_monthly (企业月度销售额事实表)
**说明**: 企业月度销售额事实表（亿元）
**行数**: ~14,851

| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |
|------|------|------|-----|--------|------|
| fact_id | bigint | ✗ | PK | None | 主键。 |
| company_id | bigint | ✗ | FK | None | 外键，关联到 dim_company。 |
| snapshot_month | date | ✗ | FK | None | 关联的快照月份。 |
| sales_ytd | decimal(20,4) | ✓ |  | None | 商品销售额_本年1月至本月累计。 |
| sales_ytd_last_year | decimal(20,4) | ✓ |  | None | 商品销售额_上年1月至本月累计。 |
| sales_current_month | decimal(20,4) | ✓ |  | None | 商品销售额_本月。 |
| sales_same_month_last_year | decimal(20,4) | ✓ |  | None | 商品销售额_上年同月。 |
| sales_ytd_prev_month | decimal(20,4) | ✓ |  | None | 商品销售额_本年1月至上月累计。 |
| sales_ytd_prev_month_last_year | decimal(20,4) | ✓ |  | None | 商品销售额_上年1月至上月累计。 |
| yoy_growth_rate | decimal(12,6) | ✓ |  | None | 同比增速。 |
| yoy_growth_rate_prev_month | decimal(12,6) | ✓ |  | None | 上月同比增速。 |
| yoy_narrowing | decimal(12,6) | ✓ |  | None | 同比收窄幅度。 |
| large_category_pull_effect | decimal(20,6) | ✓ |  | None | 本月大类拉动效应。 |
| large_category_pull_effect_prev_month | decimal(20,6) | ✓ |  | None | 上月大类拉动效应。 |
| pull_effect_increment | decimal(20,6) | ✓ |  | None | 拉动增量。 |
| medium_category_pull_effect | decimal(20,6) | ✓ |  | None | 本月中类拉动效应。 |
| medium_category_pull_effect_prev_month | decimal(20,6) | ✓ |  | None | 上月中类拉动效应。 |
| medium_category_pull_increment | decimal(20,6) | ✓ |  | None | 中类拉动增量。 |
| sub_industry_proportion | decimal(12,6) | ✓ |  | None | 细分行业占比。 |
| proportion | decimal(12,6) | ✓ |  | None | 占比。 |

### 5. fact_retail_monthly (企业月度零售额事实表)
**说明**: 企业月度零售额事实表（亿元）
**行数**: ~16,128

| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |
|------|------|------|-----|--------|------|
| fact_id | bigint | ✗ | PK | None | 主键。 |
| company_id | bigint | ✗ | FK | None | 外键，关联到 dim_company。 |
| snapshot_month | date | ✗ | FK | None | 关联的快照月份。 |
| retail_sales_ytd | decimal(20,4) | ✓ |  | None | 零售额_本年1月至本月累计。 |
| retail_sales_ytd_last_year | decimal(20,4) | ✓ |  | None | 零售额_上年1月至本月累计。 |
| online_retail_sales_ytd | decimal(20,4) | ✓ |  | None | 其中通过公共网络实现的零售额_本年1月至本月累计。 |
| online_retail_sales_ytd_last_year | decimal(20,4) | ✓ |  | None | 其中通过公共网络实现的零售额_上年1月至本月累计。 |

### 6. temp_company (临时企业表)
**说明**: 无注释
**行数**: ~85,967

| 列名 | 类型 | 可空 | 键 | 默认值 | 注释 |
|------|------|------|-----|--------|------|
| unified_social_credit_code | text | ✓ |  | None |  |
| company_name | text | ✓ |  | None |  |
| org_code | text | ✓ |  | None |  |

## 关键字段说明

### 1. 行业分类层级
- **行业门类 (category)**: 最高层级分类
- **行业大类 (large)**: 如"批发业" (代码: 51)
- **行业中类 (medium)**: 大类下的细分
- **行业小类 (small)**: 最细粒度的行业分类

### 2. 时间字段格式
- 所有月份字段格式为 `YYYY-MM-01`
- 表示该月的第一天，用于标识月份

### 3. 金额单位
- `fact_sales_monthly` 和 `fact_retail_monthly` 表中的金额单位为 **亿元**
- 数据类型为 `decimal(20,4)`，表示最多20位数字，其中4位小数

### 4. 关键指标字段
- `sales_ytd`: 本年1月至本月累计销售额
- `sales_ytd_last_year`: 上年1月至本月累计销售额
- `retail_sales_ytd`: 本年1月至本月累计零售额
- `online_retail_sales_ytd`: 本年1月至本月累计网络零售额

## 常用查询关联关系

### 1. 获取企业行业信息
```sql
SELECT c.*, s.industry_code, s.snapshot_month
FROM dim_company c
JOIN dim_company_monthly_snapshot s ON c.company_id = s.company_id
```

### 2. 获取企业销售额及行业信息
```sql
SELECT f.*, s.industry_code, i.industry_name_large
FROM fact_sales_monthly f
JOIN dim_company_monthly_snapshot s ON f.company_id = s.company_id AND f.snapshot_month = s.snapshot_month
JOIN dim_industry i ON s.industry_code = i.industry_code
```

### 3. 获取行业大类销售额汇总
```sql
SELECT 
    i.industry_code_large,
    i.industry_name_large,
    f.snapshot_month,
    SUM(f.sales_ytd) as total_sales_ytd
FROM fact_sales_monthly f
JOIN dim_company_monthly_snapshot s ON f.company_id = s.company_id AND f.snapshot_month = s.snapshot_month
JOIN dim_industry i ON s.industry_code = i.industry_code
GROUP BY i.industry_code_large, i.industry_name_large, f.snapshot_month
```

## 数据质量说明

1. **数据完整性**: 
   - 2025年数据从2月开始，缺少1月数据
   - 所有表都有主键约束，数据唯一性有保障

2. **外键关系**:
   - 所有外键关系都已正确定义
   - 事实表通过 `company_id` 和 `snapshot_month` 关联到快照表

3. **数据一致性**:
   - 行业代码采用标准分类体系
   - 时间格式统一为月份第一天

## 更新历史
- 文档创建时间: 2024年
- 最后更新: 基于当前数据库schema生成