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
