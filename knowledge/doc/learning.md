---
knowledgeId: learning-notes
name: 历史纠错与经验
description: 提供历史错误、方言陷阱和可复用经验；证据等级低于用户、业务定义和正式 Schema。
---

# Learnings

> 本文档记录已验证、可复用的查询和运行时经验。每条记录必须包含真实场景、失败原因和可验证的修正；禁止写入占位符、无意义的 SQL 或重复记录。

## 查询前检查清单

1. 先确认业务对象、时间范围、粒度和输出形状。
2. 先读取 `doc/db_schema.md` 与相关业务口径，再编写 SQL。
3. 先用 `query_database` 验证 SQL，确认结果列和行数，再用 `export_query` 交付完整结果。
4. 导出前确认 SQL 是最后一次成功验证的最终 SQL，不要导出中间 CTE 或明细中间表。
5. 用户要求标量、Top-N 或分组汇总时，必须检查最终结果的列数、行数和排序确定性。

## 可复用 SQL 经验

### 1. 维度与事实表

企业、行业等维度信息应通过明确的业务键关联事实表。行业汇总先汇总事实值，再计算整体增速；不要直接平均企业级增速。

### 2. 多表 JOIN 防止行膨胀

一对多或存在重复行的多表 JOIN 会放大 `SUM`、`COUNT` 等结果。JOIN 前应检查业务键基数；必要时对每张表按业务键 `SELECT DISTINCT`，或先按业务键预聚合，再进行 JOIN。单独对一张表去重不能解决多张表同时重复的问题。

### 3. 聚合与数值精度

- `COUNT(DISTINCT business_key)` 用于实体计数，不用代理键替代业务实体键。
- 汇总增速应使用汇总后的分子和分母计算。
- 除法要处理零分母；需要小数时显式使用 `CAST(... AS REAL)`、`1.0 * numerator / denominator` 或当前方言等价写法。
- `ROUND` 通常只放在最终投影层，避免中间层过早损失精度。

### 4. 时间和边界

时间范围必须明确是否包含结束端点。对于带时间的时间戳，优先使用 `>= start AND < next_boundary`，避免结束日的时分秒遗漏或重复。累计值预测必须满足业务单调性：预测值不能低于最新已知累计值；若同比套算违反该约束，应改为从最新累计值向前叠加未来增量。

### 5. 排序确定性

Top-N、第一名、最短或最长记录存在并列时，必须定义业务 Tie-breaker，并追加唯一标识符作为稳定排序的最后一项。使用 `LIMIT` 的预览也必须有稳定排序。

### 6. NULL 与状态

确认 `COUNT(*)`、`COUNT(column)`、`SUM` 和 `AVG` 的 NULL 语义。聚合前过滤无效状态，或使用 `COALESCE` 明确兜底。生产业务状态值只在明确对应的业务库中使用，不能迁移到陌生数据库或评测数据库。

## 方言范围

### [SQLite only]

- 日期提取使用 `strftime('%Y', date_col)`，日期差使用 `julianday(d1) - julianday(d2)`。
- 不使用 `YEAR()`、`MONTH()`、`DATEDIFF()`、`DATE_FORMAT()`、`CONCAT()`、`SUBSTRING_INDEX()`、`IF()` 或 `information_schema`。
- 字符串连接使用 `||`，条件表达式使用 `CASE WHEN`，空值处理使用 `COALESCE()`。
- 浮点除法显式使用 `CAST(... AS REAL)` 或 `1.0 * ...`。
- 系统表使用 `sqlite_master`；分页使用 `LIMIT count OFFSET offset`。

### [MySQL only]

- 日期格式化可使用 `DATE_FORMAT()`，日期差可使用 `DATEDIFF()`。
- 不要把 MySQL 函数经验复制到 SQLite、BigQuery 或 Snowflake。
- 系统表查询使用当前连接允许的元数据接口，不要在其他方言中假设 `information_schema` 可用。

## 运行时工具合同

- `query_database` 只做只读预览；完整结果使用 `export_query`。
- `show_widget` 当前只接受 `kind` 为 `kpi`、`chart`、`table` 或 `steps`，并通过 `spec` 传递对象。`kpi` 需要 `value` 或 `data`；其他类型需要 `data`，`chart` 也可使用 `series`。
- Widget 文档必须与运行时 Schema 一致，不使用旧的 `echarts/config` 合同。
- `run_python` 只有在当前工具列表中出现时才能调用；若返回 `PYTHON_RUNTIME_NOT_AVAILABLE`，不要重试，应使用可用的 SQL 或文件工具。
- 工具成功后优先结束当前任务。用户没有要求图表时，不在 CSV 已交付后追加 Widget 或 Python 报告处理。

## 已验证的失败经验

### 表名或字段类型必须以 Schema 为准

曾将 `usr` 写成表名，或将文本字段与数字字面量比较。修正方式是先读取 Schema，并使用真实表名、列名和列类型；不能凭名称猜测。

### 业务口径不能自行猜测

当“去年同期”可能指上年同月或上年同期累计时，必须结合并列字段和业务定义确认。若仍有歧义，应请求澄清，而不是选择一个看似合理的字段。

### 退款和无效状态必须在数据源层过滤

收入类指标不能直接对所有订单求和；必须依据业务定义排除退款或其他无效状态，并在 JOIN/WHERE 层完成过滤。

### Widget 数据必须是纯 JSON

图表格式化优先使用内置模板字符串，例如 `{c}%` 或 `{a}: {c}`；不要把 JavaScript 函数字符串写入 JSON 配置。

### 生产业务规则（仅适用于对应业务库）

- 多行业整体新增企业的统计，需要区分新纳统、外部转入和行业内部互转；内部互转不能计入多行业整体新增，但可以计入单行业新增。
- 企业、行业和月度快照的关联关系必须以对应数据库 Schema 和业务文档为准。

## 通用 SQL 验证模板

以下模板只描述可迁移的 SQL 方法，不绑定任何数据库实体或业务领域；先按当前数据库 Schema 替换占位符，再执行验证。

### 日期差

```sql
SELECT julianday(end_date) - julianday(start_date) AS elapsed_days
FROM source_table
WHERE start_date IS NOT NULL AND end_date IS NOT NULL;
```

不要按年份、月份、日期字段分别相减。SQLite 使用 `julianday`；其他方言使用其等价的日期差函数。

### 带历史基线的 LAG/rolling 窗口

```sql
WITH history AS (
    SELECT entity_id, period, value
    FROM source_table
    WHERE period >= :calculation_start
      AND period < :display_end
), windowed AS (
    SELECT
        entity_id,
        period,
        value,
        LAG(value) OVER (PARTITION BY entity_id ORDER BY period) AS previous_value,
        AVG(value) OVER (
            PARTITION BY entity_id
            ORDER BY period
            ROWS BETWEEN :lookback PRECEDING AND CURRENT ROW
        ) AS rolling_value
    FROM history
)
SELECT entity_id, period, value, previous_value, rolling_value
FROM windowed
WHERE period >= :display_start AND period < :display_end;
```

计算范围必须覆盖展示期之前所需的历史基线，最后一步才裁剪到展示期。

### as-of 累计余额

```sql
SELECT entity_id, COALESCE(SUM(amount), 0) AS balance_as_of
FROM transactions
WHERE transaction_time < :as_of_boundary
GROUP BY entity_id;
```

`<`、`<=` 和边界时间的选择必须由题目定义；不能把“截至某月初”改成该月净额。

### 日期区间覆盖某个时点

```sql
WHERE start_time <= :point_in_time
  AND (end_time >= :point_in_time OR end_time IS NULL)
```

必须明确开放区间、结束端点是否包含以及 NULL 是否代表仍然有效。

### 日历年过滤

```sql
WHERE strftime('%Y', date_col) = :calendar_year
```

不要用年份差近似日历年，也不要把财年、自然年和滚动十二个月混为一谈。

### 比例和百分数

先在答案合同中写明量纲。`ratio`/`proportion` 通常保留 0–1，`percentage` 是否要求 0–100 需依据题目或业务文档确认；不得静默乘以 100，也不得把一个单位的经验当成所有任务的默认规则。

## 通用递归与逐期状态模板

### 递归展开叶节点

```sql
WITH RECURSIVE expanded(root_id, node_id, quantity) AS (
    SELECT root_id, child_id, CAST(quantity AS REAL)
    FROM root_components
    UNION ALL
    SELECT e.root_id, c.child_id, e.quantity * c.quantity
    FROM expanded e
    JOIN components c ON c.parent_id = e.node_id
), leaves AS (
    SELECT e.root_id, e.node_id, e.quantity
    FROM expanded e
    WHERE NOT EXISTS (
        SELECT 1 FROM components c WHERE c.parent_id = e.node_id
    )
)
SELECT root_id, node_id, SUM(quantity) AS total_quantity
FROM leaves
GROUP BY root_id, node_id;
```

递归结果要明确是每条路径、每个叶节点还是每个根节点；不能把路径数直接当叶节点数。

### 有序逐期状态

```sql
WITH RECURSIVE states(entity_id, sequence_no, period, state_value) AS (
    SELECT entity_id, 0, first_period, initial_value
    FROM initial_state
    UNION ALL
    SELECT s.entity_id, n.sequence_no, n.period, s.state_value + n.delta
    FROM states s
    JOIN ordered_events n
      ON n.entity_id = s.entity_id
     AND n.sequence_no = s.sequence_no + 1
)
SELECT entity_id, period, state_value
FROM states;
```

每个递归步骤必须有唯一的下一期、明确的初始状态和可检查的不变量；FIFO 分配、库存滚动和会话序列都应先验证前几步和最后一步。
