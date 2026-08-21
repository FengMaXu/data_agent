

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
