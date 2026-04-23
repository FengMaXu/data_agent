# Database Schema

## 概览

本默认 Schema 采用企业分析中常见的“维度表 + 事实表”结构，适合作为通用企业数据库示例。实际接入真实业务时，可在此基础上映射到客户自己的表结构。

## 建议表清单

```text
dim_date
dim_customer
dim_product
dim_region
dim_channel
fact_orders
fact_order_items
fact_payments
fact_inventory_snapshot
fact_customer_activity
```

## 表结构说明

### 1. dim_date

用途：标准日期维表，用于统一时间分析口径。

| 字段 | 类型 | 说明 |
|---|---|---|
| date_key | int | 代理键，例如 20260131 |
| calendar_date | date | 自然日期 |
| year | int | 年 |
| quarter | int | 季度 |
| month | int | 月份 |
| month_name | varchar | 月份标签 |
| week_of_year | int | 年内周次 |
| is_month_end | tinyint | 是否月末 |

### 2. dim_customer

用途：客户主数据。

| 字段 | 类型 | 说明 |
|---|---|---|
| customer_id | bigint | 主键 |
| customer_code | varchar | 业务编码 |
| customer_name | varchar | 客户名称 |
| customer_type | varchar | 企业 / 个人 |
| industry_name | varchar | 客户所属行业 |
| region_id | bigint | 所属区域 |
| created_at | datetime | 建档时间 |
| is_active | tinyint | 是否有效 |

### 3. dim_product

用途：产品与品类层级信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| product_id | bigint | 主键 |
| sku_code | varchar | SKU 编码 |
| product_name | varchar | 产品名称 |
| category_name | varchar | 一级品类 |
| subcategory_name | varchar | 二级品类 |
| brand_name | varchar | 品牌 |
| standard_cost | decimal(18,2) | 标准成本 |
| is_active | tinyint | 是否有效 |

### 4. dim_region

用途：地理区域层级。

| 字段 | 类型 | 说明 |
|---|---|---|
| region_id | bigint | 主键 |
| country_name | varchar | 国家 |
| province_name | varchar | 省 / 州 |
| city_name | varchar | 城市 |
| district_name | varchar | 区县 |
| sales_area | varchar | 内部销售大区 |

### 5. dim_channel

用途：销售渠道定义。

| 字段 | 类型 | 说明 |
|---|---|---|
| channel_id | bigint | 主键 |
| channel_code | varchar | 渠道编码 |
| channel_name | varchar | 渠道名称 |
| channel_group | varchar | 渠道上级分组 |

### 6. fact_orders

用途：订单粒度事实表。

| 字段 | 类型 | 说明 |
|---|---|---|
| order_id | bigint | 主键 |
| order_no | varchar | 订单号 |
| customer_id | bigint | 客户 ID |
| channel_id | bigint | 渠道 ID |
| region_id | bigint | 区域 ID |
| order_status | varchar | created / paid / shipped / completed / cancelled |
| created_at | datetime | 下单时间 |
| paid_at | datetime | 支付时间 |
| completed_at | datetime | 完成时间 |
| gross_amount | decimal(18,2) | 原始金额 |
| discount_amount | decimal(18,2) | 优惠金额 |
| paid_amount | decimal(18,2) | 实付金额 |
| refund_amount | decimal(18,2) | 退款金额 |

### 7. fact_order_items

用途：订单明细粒度事实表。

| 字段 | 类型 | 说明 |
|---|---|---|
| order_item_id | bigint | 主键 |
| order_id | bigint | 订单 ID |
| product_id | bigint | 产品 ID |
| quantity | decimal(18,4) | 销售数量 |
| unit_price | decimal(18,2) | 单价 |
| net_amount | decimal(18,2) | 折后净额 |
| cost_amount | decimal(18,2) | 成本金额 |

### 8. fact_payments

用途：支付流水事实表。

| 字段 | 类型 | 说明 |
|---|---|---|
| payment_id | bigint | 主键 |
| order_id | bigint | 订单 ID |
| payment_method | varchar | card / transfer / cash / wallet |
| payment_status | varchar | success / failed / refunded |
| paid_amount | decimal(18,2) | 支付金额 |
| paid_at | datetime | 支付时间 |

### 9. fact_inventory_snapshot

用途：库存快照表。

| 字段 | 类型 | 说明 |
|---|---|---|
| snapshot_id | bigint | 主键 |
| snapshot_date | date | 快照日期 |
| product_id | bigint | 产品 ID |
| warehouse_name | varchar | 仓库名称 |
| on_hand_qty | decimal(18,4) | 账面库存 |
| reserved_qty | decimal(18,4) | 预留库存 |
| inventory_value | decimal(18,2) | 库存金额 |

### 10. fact_customer_activity

用途：客户行为事实表。

| 字段 | 类型 | 说明 |
|---|---|---|
| activity_id | bigint | 主键 |
| customer_id | bigint | 客户 ID |
| activity_date | date | 活动日期 |
| visit_count | int | 访问次数 |
| inquiry_count | int | 询盘次数 |
| order_count | int | 成功订单数 |
| revenue_amount | decimal(18,2) | 产出收入 |

## 常见关联路径

### 按产品看收入

```text
fact_order_items -> fact_orders -> dim_product
```

### 按客户行业看收入

```text
fact_orders -> dim_customer
```

### 按区域或渠道看收入

```text
fact_orders -> dim_region
fact_orders -> dim_channel
```

### 做库存分析

```text
fact_inventory_snapshot -> dim_product
```

## 查询约定

- 收入类问题优先使用 `paid_at` 或 `completed_at`，不要一律使用 `created_at`。
- 订单数使用 `COUNT(DISTINCT order_id)`。
- 产品收入优先从 `fact_order_items` 聚合。
- 库存问题通常先确定最新快照日期，再做汇总。

## 示例映射

- “月度营收” -> `fact_orders.paid_amount`
- “毛利” -> `fact_order_items.net_amount - fact_order_items.cost_amount`
- “热销产品” -> 按 `dim_product.product_name` 或 `sku_code` 分组
- “客户留存” -> 基于客户订单历史衍生计算
