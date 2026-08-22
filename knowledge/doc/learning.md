# Learnings

> 本文档记录运行时学习的成功/失败经验教训。通过 `save_learning` 工具自动追加内容。

## 模板：错误记录

### 错误: <错误标题>
**失败SQL**: `<失败的SQL语句>`
**修正SQL**: `<修正后的SQL>`
**说明**: `<错误原因和修正说明>`

---

## 历史记录

<!-- 以下是自动保存的学习记录 -->

## 查询模式提炼

### 1. 维度-事实查询模式
**规律**：所有数据查询都遵循"先维度，后事实"的模式
- **企业查询**：`dim_company` → `fact_sales_monthly`
- **行业查询**：`dim_industry` → `fact_sales_monthly` + `dim_company_monthly_snapshot`
- **关键**：维度表提供描述信息，事实表提供数值指标

### 2. 关联路径规律
**企业-行业关联路径**：
```
fact_sales_monthly → dim_company_monthly_snapshot → dim_industry
```
- 事实表通过`company_id`关联快照表
- 快照表通过`industry_code`关联行业表
- **注意**：行业信息在快照表中，不在企业主表

### 3. 聚合计算规则
**行业数据必须聚合**：
- 企业级数据：直接查询`fact_sales_monthly`
- 行业级数据：必须`SUM()`聚合所有企业的数据
- **增速计算**：先聚合再计算，不能先计算再平均

### 4. 时间查询模式
**月份处理统一规则**：
- 存储格式：`YYYY-MM-01`
- 范围查询：`>= '开始月-01' AND <= '结束月-01'`
- 显示格式化：`DATE_FORMAT(column, '%Y-%m')`

### 5. 名称匹配策略
**模糊查询模式**：
- 单关键词：`LIKE '%关键词%'`
- 多关键词：`LIKE '%词1%' OR LIKE '%词2%'`
- 适用于：企业名称、行业名称搜索

### 6. 模板设计原则
**可复用模板要素**：
1. 参数化注释（`-- @param: 说明`）
2. 清晰的结构分隔
3. 实际示例值
4. 多种实现方式对比

### 7. 数据验证流程
**查询前验证步骤**：
1. 确认维度对象存在（企业/行业）
2. 确认事实数据存在（时间范围）
3. 确认关联关系正确

## 核心经验
1. **维度先行**：先确定查询对象（企业/行业），再查数据
2. **关联明确**：理解表间关系，选择正确关联路径
3. **聚合正确**：区分个体查询和群体统计
4. **时间规范**：统一处理月份格式
5. **模板积累**：成功查询立即模板化
## HTML看板生成经验

### 2025-03-28: ECharts配置中的formatter字段错误

**问题描述：**
生成的HTML看板出现乱码，图表无法正常显示。

**错误原因：**
在`generate_html_dashboard`的ECharts配置中，`formatter`字段被错误地设置为字符串形式的JavaScript函数，例如：
```javascript
"formatter": "function(params) { return params.value + '%'; }"
```
这导致配置被序列化为JSON时，函数字符串被错误处理，浏览器解析时出现乱码。

**正确做法：**
1. **使用ECharts内置格式化语法**：
   ```javascript
   "formatter": "{c}%"      // 显示数据值加百分比符号
   "formatter": "{c}亿"     // 显示数据值加"亿"单位
   "formatter": "{a}: {c}"  // 显示系列名和数据值
   ```

2. **简化配置**：对于常见的格式化需求，优先使用简单语法
3. **避免字符串化函数**：不要在JSON配置中嵌入JavaScript函数字符串

**修复示例：**
```javascript
// 错误
"label": {
  "show": true,
  "position": "top",
  "formatter": "function(params) { return params.value.toFixed(1) + '亿'; }"
}

// 正确
"label": {
  "show": true,
  "position": "top",
  "formatter": "{c}亿"
}
```

**经验总结：**
- `generate_html_dashboard`的charts配置必须是纯JSON对象
- JavaScript函数无法在JSON中正确序列化
- 使用ECharts的模板语法满足大多数格式化需求
- 复杂格式化应在HTML的script标签中定义回调函数

---

## 2025-07-18: 多表 JOIN 数据膨胀 — 未对重复行做 DISTINCT 去重

**场景**：查询 Top 3 客户的平均客单价和生命周期，需要 JOIN `customers` + `orders` + `order_payments`。

**错误**：直接 JOIN 三张表后 SUM(payment_value)，结果膨胀了 8 倍。

**根因**：三张表均存在完全重复的行（行级重复）：
- `customers`：同 `customer_unique_id` 出现 2 次
- `orders`：同 `order_id` 出现 2 次  
- `order_payments`：同笔支付记录出现 2 次
- 2 × 2 × 2 = 8 倍放大

**教训**：多表 JOIN 前，先对各表用 `SELECT DISTINCT` 子查询去重。只对单表去重不够，必须三张表都去重。

**正确写法**：
```sql
FROM (SELECT DISTINCT customer_unique_id, customer_id FROM customers) c
JOIN (SELECT DISTINCT order_id, customer_id, order_purchase_timestamp FROM orders) o ...
JOIN (SELECT DISTINCT order_id, payment_sequential, payment_type, payment_installments, payment_value FROM order_payments) p ...
```

**注意**：MySQL 不支持 `JULIANDAY()`，日期差用 `DATEDIFF()`。


## 2026-07: 多行业整体新增四上企业需剔除行业内部互转

**场景**：统计"2026年1-7月批发零售餐饮三行业新增四上企业总数"。
**错误**：直接按"单行业新增"口径求和，把三行业内部互转（零售业→批发业的深圳前海聚朋投资发展有限公司）也计入总数，得到318家。
**修正**：三行业整体新增 = 新纳统(311) + 三行业外部转入(6) = **317家**；三行业内部互转企业（基准月已是51/52/62之一四上）不计入整体新增，但计入单行业新增。
**教训**：统计多行业整体新增前，必须将转行业企业细分为"三行业外部转入 / 三行业内部互转"两类；内部互转只影响单行业口径，不影响整体口径。相关SQL模板见 doc/query_patterns.md「四上企业整体新增」。

## 迁移的历史错题（来自 context/doc/learning.md）

### 错误: table_not_found
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-03-12 10:07:35
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: other
**时间**: 2026-03-12 10:07:35
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM x
```

**错误信息**: 不存在

**修正SQL**:
```sql
SELECT * FROM y
```

**说明**: 

---


### 错误: logic
**时间**: 2026-03-29 23:35:25
**来源**: agent

**失败SQL**:
```sql
-- 这不是SQL错误，而是HTML看板生成错误
-- 原始看板生成代码中的ECharts配置问题：
-- 在echarts_option中，formatter字段被错误地设置为字符串形式的JavaScript函数
-- 例如："formatter": "function(params) { return params.value + '%'; }"

```

**错误信息**: 生成的HTML看板出现乱码，原因是ECharts配置中的formatter字段被错误地设置为字符串形式的JavaScript函数，而不是实际的函数对象或简单的格式化字符串。这导致浏览器解析错误，可能显示乱码或图表无法正常渲染。

**修正SQL**:
```sql
-- 修复方案：使用ECharts内置的简单格式化语法
-- 错误做法："formatter": "function(params) { return params.value + '%'; }"
-- 正确做法："formatter": "{c}%" 或 "formatter": "{c}亿"
-- 或者完全移除复杂的formatter，使用默认tooltip显示

-- 修复后的ECharts配置示例：
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "series": [
    {
      "name": "同比增速",
      "type": "line",
      "label": {
        "show": true,
        "position": "top",
        "formatter": "{c}%"  -- 使用简单格式化语法
      }
    }
  ]
}

```

**说明**: **经验教训：**

1. **ECharts配置原则**：在JSON配置中，formatter字段应该使用ECharts内置的格式化语法（如`{c}`表示数据值，`{a}`表示系列名等），而不是字符串化的JavaScript函数。

2. **JSON与JavaScript函数**：当通过`generate_html_dashboard`生成看板时，配置会被序列化为JSON。JavaScript函数对象无法被正确序列化，如果以字符串形式包含，会导致解析错误。

3. **简单化优先**：对于常见的格式化需求（如添加单位、百分比符号），优先使用ECharts的简单格式化语法，而不是复杂的JavaScript函数。

4. **测试验证**：生成看板后，应该检查HTML文件中的JavaScript部分，确保没有语法错误。

5. **编码一致性**：确保所有文本内容使用UTF-8编码，特别是在包含中文字符时。

**最佳实践：**
- 使用`{c}`表示数据值，`{c}%`表示百分比，`{c}亿`表示亿元单位
- 避免在JSON配置中嵌入JavaScript函数字符串
- 复杂的tooltip格式化可以通过ECharts的tooltip.formatter回调函数实现，但需要在HTML的script标签中定义，而不是在JSON配置中

---


### 错误: table_not_found
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-04-22 10:14:20
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-22 10:14:20
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: table_not_found
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-22 10:16:49
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: other
**时间**: 2026-04-22 10:16:49
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM x
```

**错误信息**: 不存在

**修正SQL**:
```sql
SELECT * FROM y
```

**说明**: 

---


### 错误: table_not_found
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-22 10:37:05
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: other
**时间**: 2026-04-22 10:37:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM x
```

**错误信息**: 不存在

**修正SQL**:
```sql
SELECT * FROM y
```

**说明**: 

---


### 错误: logic
**时间**: 2026-04-29 17:33:48
**来源**: agent

**失败SQL**:
```sql
WITH order_payment_totals AS (
    SELECT order_id, SUM(payment_value) AS total_payment
    FROM order_payments
    GROUP BY order_id
),
customer_order_stats AS (
    SELECT 
        c.customer_unique_id,
        COUNT(DISTINCT o.order_id) AS order_count,
        SUM(op.total_payment) AS total_spent,
        MIN(o.order_purchase_timestamp) AS first_purchase,
        MAX(o.order_purchase_timestamp) AS last_purchase
    FROM orders o
    JOIN customers c ON o.customer_id = c.customer_id
    JOIN order_payment_totals op ON o.order_id = op.order_id
    WHERE o.order_status != 'canceled'
    GROUP BY c.customer_unique_id
)
SELECT 
    customer_unique_id,
    order_count,
    ROUND(total_spent / order_count, 2) AS avg_payment_per_order,
    ROUND(GREATEST((JULIANDAY(last_purchase) - JULIANDAY(first_purchase)) / 7.0, 1.0), 2) AS lifespan_weeks
FROM customer_order_stats
ORDER BY avg_payment_per_order DESC
LIMIT 3
```

**错误信息**: 结果中 avg_payment_per_order 为 109312.64，正确值应为 13664.08（8倍偏差），原因是 customers/orders/order_payments 三张表均存在完全重复的行，导致 JOIN 后数据膨胀 8倍

**修正SQL**:
```sql
SELECT
    cd.customer_unique_id,
    cd.order_count AS PF,
    ROUND(cd.total_payment / cd.order_count, 2) AS AOV,
    CASE WHEN cd.days_diff < 7 THEN 1.0 ELSE ROUND(cd.days_diff / 7.0, 2) END AS ACL
FROM (
    SELECT
        c.customer_unique_id,
        COUNT(DISTINCT o.order_id) AS order_count,
        SUM(p.payment_value) AS total_payment,
        DATEDIFF(MAX(o.order_purchase_timestamp), MIN(o.order_purchase_timestamp)) AS days_diff
    FROM (SELECT DISTINCT customer_unique_id, customer_id FROM customers) c
    JOIN (SELECT DISTINCT order_id, customer_id, order_purchase_timestamp FROM orders) o 
        ON c.customer_id = o.customer_id
    JOIN (SELECT DISTINCT order_id, payment_sequential, payment_type, payment_installments, payment_value FROM order_payments) p 
        ON o.order_id = p.order_id
    GROUP BY c.customer_unique_id
) cd
ORDER BY AOV DESC
LIMIT 3
```

**说明**: 多表 JOIN 前必须先检查每张表是否有重复行。这个案例中 customers(2x) × orders(2x) × order_payments(2x) = 8倍数据膨胀。解决方案：对每张表用 SELECT DISTINCT 子查询先做行级去重，然后再 JOIN。另外 MySQL 不支持 JULIANDAY()，应改用 DATEDIFF()。

---


### 错误: table_not_found
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-05-11 22:44:50
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-11 22:44:50
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: other
**时间**: 2026-05-11 22:44:51
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM x
```

**错误信息**: 不存在

**修正SQL**:
```sql
SELECT * FROM y
```

**说明**: 

---


### 错误: table_not_found
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-05-12 10:57:02
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 10:57:02
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: table_not_found
**时间**: 2026-05-12 10:58:46
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-05-12 10:58:46
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-05-12 10:58:46
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-05-12 10:58:46
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-05-12 10:58:46
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-05-12 10:58:46
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-05-12 10:58:47
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 10:58:47
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-05-12 10:58:47
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 10:58:47
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: table_not_found
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-05-12 11:16:55
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 11:16:55
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: table_not_found
**时间**: 2026-05-12 11:19:34
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-05-12 11:19:34
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-05-12 11:19:34
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-05-12 11:19:35
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-05-12 11:19:35
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-05-12 11:19:35
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-05-12 11:19:35
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 11:19:35
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-05-12 11:19:35
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-05-12 11:19:35
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: logic
**时间**: 2026-05-18 10:41:49
**来源**: agent

**失败SQL**:
```sql
-- 我的错误查询（使用了上年同月销售额而非上年同期累计销售额）
SELECT 
    DATE_FORMAT(f.snapshot_month, '%Y-%m') as 月份,
    c.company_name as 企业名称,
    ROUND(f.sales_current_month, 4) as 本月销售额_亿元,
    ROUND(f.sales_ytd, 4) as 本月累计销售额_亿元,
    ROUND(f.sales_same_month_last_year, 4) as 去年同期__亿元,   -- ❌ 误用上年同月
    ROUND(f.yoy_growth_rate, 2) as 同比增速_百分比
FROM fact_sales_monthly f
JOIN dim_company c ON f.company_id = c.company_id
WHERE f.company_id = 262497
    AND f.snapshot_month >= '2025-02-01'
    AND f.snapshot_month <= '2025-04-01'
ORDER BY f.snapshot_month
```

**错误信息**: 用户要查询"去年同期"时，我自行判断为"上年同月销售额"（sales_same_month_last_year），但用户实际指的是"上年同期累计销售额"（sales_ytd_last_year）。在"本月销售额、本月累计销售额、去年同期、同比增速"这个并列语境中，"去年同期"应理解为累计值的去年同期即sales_ytd_last_year，不应擅自猜测。

**修正SQL**:
```sql
SELECT 
    DATE_FORMAT(f.snapshot_month, '%Y-%m') as 月份,
    c.company_name as 企业名称,
    ROUND(f.sales_current_month, 4) as 本月销售额_亿元,
    ROUND(f.sales_ytd, 4) as 本月累计销售额_亿元,
    ROUND(f.sales_ytd_last_year, 4) as 去年同期累计销售额_亿元,   -- ✅ 使用上年同期累计
    ROUND(f.yoy_growth_rate, 2) as 同比增速_百分比
FROM fact_sales_monthly f
JOIN dim_company c ON f.company_id = c.company_id
WHERE f.company_id = 262497
    AND f.snapshot_month >= '2025-02-01'
    AND f.snapshot_month <= '2025-04-01'
ORDER BY f.snapshot_month
```

**说明**: 用户问"本月销售额、本月累计销售额、去年同期、同比增速"，这里的"去年同期"与"本月累计销售额"对应，应使用sales_ytd_last_year（上年同期累计销售额），而非sales_same_month_last_year（上年同月销售额）。当字段含义存在二义性时，不应自行猜测，而应向用户确认后执行。

---


### 错误: table_not_found
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM usr
```

**错误信息**: Table 'usr' doesn't exist

**修正SQL**:
```sql
SELECT * FROM users
```

**说明**: 表名拼错了，应该是 users 不是 usr

---


### 错误: type_mismatch
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM orders WHERE status = 1
```

**错误信息**: 类型不匹配

**修正SQL**:
```sql
SELECT * FROM orders WHERE status = 'paid'
```

**说明**: status 是字符串，不是数字

---


### 错误: type_mismatch
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM users WHERE age > 'abc'
```

**错误信息**: 无效比较

**修正SQL**:
```sql
SELECT * FROM users WHERE age > 18
```

**说明**: 

---


### 错误: type_mismatch
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT position FROM race_results WHERE position = 1
```

**错误信息**: position 是 TEXT 类型

**修正SQL**:
```sql
SELECT position FROM race_results WHERE position = '1'
```

**说明**: position 列是 TEXT 类型，需要用字符串比较

---


### 错误: table_not_found
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM bad
```

**错误信息**: 表不存在

**修正SQL**:
```sql
SELECT * FROM good
```

**说明**: 表名错误

---


### 错误: syntax
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
q1
```

**错误信息**: e1

**修正SQL**:
```sql
f1
```

**说明**: 

---


### 错误: syntax
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
q2
```

**错误信息**: e2

**修正SQL**:
```sql
f2
```

**说明**: 

---


### 错误: logic
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
q3
```

**错误信息**: e3

**修正SQL**:
```sql
f3
```

**说明**: 

---


### 错误: other
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id
```

**错误信息**: error

**修正SQL**:
```sql
fixed
```

**说明**: 

---


### 错误: logic
**时间**: 2026-08-17 23:48:05
**来源**: user_feedback

**失败SQL**:
```sql
SELECT SUM(amount) FROM orders
```

**错误信息**: 没排除退款订单

**修正SQL**:
```sql
SELECT SUM(amount) FROM orders WHERE status != 'refunded'
```

**说明**: 统计收入需排除退款

---


### 错误: other
**时间**: 2026-08-17 23:48:05
**来源**: agent

**失败SQL**:
```sql
SELECT * FROM x
```

**错误信息**: 不存在

**修正SQL**:
```sql
SELECT * FROM y
```

**说明**: 

---


### 错误: logic
**时间**: 2026-08-20 15:41:57
**来源**: agent

**失败SQL**:
```sql
-- 预测2026-09累计销售额时，用近3月平均同比增速103.13%直接套到2025-09基数72.60亿 => 147.48亿
```

**错误信息**: 用户指出：2026-07累计已达154.44亿，预测的2026-09累计值147.48亿低于当前实际累计值，逻辑不可能成立。累计销售额(YTD)是单调递增口径，预测值必须 >= 最新已知累计值。

**修正SQL**:
```sql
-- 修正：以2026-07实际累计154.44亿为锚，向前叠加估算的8、9月累计增量(按5-7月增量衰减趋势 68.3->42.4->21.8 约每两月减半, 或同比倍数2.29, 或回落至2025年节奏), 得159.7~173.8亿, 中性166.4亿(+129%)
```

**说明**: 预测"本年累计销售额(YTD)"时必须满足单调性约束：预测值不能低于最新已知累计值。若用同比增速×上年同期基数得到的结果低于当前累计值，说明该方法失效，应改为"当前累计值+未来月份增量"自下而上构建预测。

---
