# Spider2 第 4 轮改进建议

基于 [第 3 轮未通过题目推理审计报告](file:///D:/data_agent/docs/Spider2第3轮未通过题目推理审计报告.md) 的 86 个失败案例分析。

## 一、当前态势判断

### 基础设施修复已验证有效

| 指标 | 基线 full-002 | 第 3 轮 full-003 | 变化 |
|---|---:|---:|---:|
| E2E 正确率 | 28.15% (38/135) | 36.30% (49/135) | **+11 题** |
| 工具错误 | 273 | 61 | **-77.7%** |
| SQL Guard 误杀 | 122 | 5 | -95.9% |
| Python 错误 | 27 | 0 | -100% |
| Widget 错误 | 7 | 0 | -100% |
| max_turns | 25 | 12 | -52% |
| timeout | 16 | 8 | -50% |

### 瓶颈已转移

86 个失败案例的分布：

| 类别 | 数量 | 占比 | 核心问题 |
|---|---:|---:|---|
| 形状不匹配 | 45 | 52.3% | 算出了结果但没收敛到正确粒度 |
| 同形异值 | 22 | 25.6% | SQL 能跑，但业务口径错 |
| 无 CSV 交付 | 19 | 22.1% | 探索失控耗尽轮次/超时 |

> [!IMPORTANT]
> 关键发现：无工具错误的题正确率仍只有 42.9%。问题不再是"工具坏了"，而是**模型的语义规划和输出契约执行力**。继续加提示词长度的收益已经递减，需要转向运行时强制机制。

---

## 二、改进建议

### P0：导出前强制 Shape 断言（解决 45 题形状错误的系统性根因）

**问题本质**：审计发现 45 个形状错误中，14 个（G1）是模型**已经算出标量/第一名，却主动导出全量明细**；11 个（G2）是**核心结果正确但多带了诊断列**。这不是"不会算"，是"算完没收敛"。

典型证据链（报告中反复出现）：
- `local020`：确认 `AC Gilchrist` 第一 → 认为 "complete result" 应为 282 人排名 → 无 `LIMIT 1`
- `local025`：验证平均值 `19.4261` → 决定 "most useful result is per-match rows" → 导出 568 行
- `local202`：执行 `SELECT COUNT(*) ... → 5` → 导出切回 Top-10 州七列明细

**改法**：在 `export_query` 工具的入口增加强制的 shape 声明参数：

```typescript
// agent-assembly.ts — export_query 工具参数扩展
{
  sql: Type.String(),
  target: Type.String(),
  // 新增：强制声明预期形状
  expected_rows: Type.Optional(Type.Union([
    Type.Literal("scalar"),    // 1×N
    Type.Literal("top_n"),     // 明确几行
    Type.Literal("grouped"),   // 按维度分组
    Type.Literal("full"),      // 全量
  ])),
  expected_row_count: Type.Optional(Type.Integer()),  // top_n 时必填
  expected_columns: Type.Optional(Type.Array(Type.String())),  // 列白名单
}
```

运行时校验逻辑：

```typescript
// export_query handler 中，在实际写 CSV 前
if (params.expected_rows === "scalar" && rowCount > 1) {
  return error("SHAPE_MISMATCH: You declared scalar but got " + rowCount + " rows. " +
    "Add final aggregation (MAX/MIN/AVG/COUNT) or LIMIT 1 before exporting.");
}
if (params.expected_rows === "top_n" && params.expected_row_count
    && rowCount > params.expected_row_count * 1.5) {
  return error("SHAPE_MISMATCH: You declared top_" + params.expected_row_count +
    " but got " + rowCount + " rows. Add LIMIT or stricter filter.");
}
```

> [!TIP]
> 这个机制不是 Spider2 特化——在生产环境中，用户问"最高是多少"时导出 500 行也是错误的。shape 声明让模型在导出前必须显式承诺输出形状，运行时做基本 sanity check。

**预期收益**：直接解决 G1（14 题）和部分 G2（11 题中约 5-6 题），预估 +8~12 题。

---

### P0：约束表模板（解决 22 题同形异值 + 防止 6 个真回归）

**问题本质**：22 个同形异值案例的共性是——模型的 sanity check 只能证明 SQL 自洽，不能证明业务合同正确。典型错误：
- 分子分母来自不同事件集合（`local034`：支付被商品行膨胀）
- 多个一对多表在同层 JOIN（`local196`：支付×租赁笛卡尔积）
- 用"合理"替代"题目说的"（`local081`：排除折扣 → 乘以 `(1-discount)`）
- 窗口先裁后算（`local077`：删掉历史月再算 LAG）

**改法**：在 SYSTEM.md 的 Final Answer Contract 中，要求模型在写第一个 CTE 之前，先输出一个**约束表**（自然语言，不是代码）：

```markdown
## 约束表（在首次 query_database 前必须输出）

在写 SQL 之前，先用自然语言回答以下问题并输出为约束表：

1. **最终输出一行代表什么**：一个客户？一个月份？一个产品-年份组合？全局标量？
2. **预期行数**：1？N？全量分组数？
3. **输出列白名单**：题目明确要求的列名，不多不少
4. **分子事件**：什么表的什么行构成分子
5. **分母事件**：什么表的什么行构成分母（必须与分子来自同一事件集合吗？）
6. **过滤条件**：题目明确要求包含/排除的条件
7. **时间范围**：报告期 vs 计算基线期（窗口函数需要更早的数据吗？）
8. **精度与单位**：百分比是 0-100 还是 0-1？小数保留几位？
9. **排序**：题目要求的排序键是什么？

约束表一旦输出，后续 SQL 必须逐项符合。如果执行过程中发现需要修改约束表，必须显式更新并说明原因。
```

> [!WARNING]
> 约束表是纯提示词机制，模型可能忽略或敷衍。但审计显示当前 22 个同形异值中，至少 15 个的错误在第一次 CTE 设计时就已固化——如果模型被迫先写出"分母是什么"，至少能拦截 `local034`（支付膨胀）、`local196`（笛卡尔积）、`local081`（折扣方向）这类显性错误。

**防回归**：报告确认 6 个真回归（`local007`/`local081`/`local085`/`local131`/`local229`/`local309`），其中 4 个是模型用"更合理的领域知识"覆盖了题目明确公式。约束表中的"过滤条件"和"精确公式"字段，要求模型逐字引用题目原文，可降低这类漂移。

**预期收益**：22 题中预估 +4~6 题（那些 sanity check 循环验证自身公式的案例）。

---

### P1：探索预算与交付闭环（解决 19 题无 CSV）

**问题本质**：19 个无 CSV 案例中：
- 12 个 max_turns、6 个 timeout、1 个 completed 但未导出
- `local253` 已得到与 Gold 一致的 20×4 结果，仍未调用 `export_query`
- `local099` 已查到正确数量 `107`，继续探索直至耗尽
- 平均工具调用 20.11 次（正确题仅 8.22 次）

**改法**（三个互补机制）：

#### 1a. Schema 探索预算

```typescript
// agent-assembly.ts — query_database handler
// 跟踪每个会话中"探索类查询"的次数
const isExploratoryQuery = (sql: string) =>
  /^\s*(SELECT\s+(name|sql)\s+FROM\s+sqlite_master|PRAGMA|SELECT\s+\*\s+FROM\s+\S+\s+LIMIT|SELECT\s+DISTINCT|SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM)/i.test(sql);

if (isExploratoryQuery(sql) && exploratoryCount >= MAX_EXPLORATORY) {
  return text(
    `You have used ${exploratoryCount}/${MAX_EXPLORATORY} exploratory queries. ` +
    `Stop exploring and write your final analytical SQL now. ` +
    `If you already have a validated result, call export_query immediately.`,
    { warning: "EXPLORATION_BUDGET_EXCEEDED" }
  );
}
```

#### 1b. 导出 deadline 提醒

在 `query_database` 返回结果时，如果当前轮次已过总预算的 60%，追加提醒：

```typescript
if (turnCount >= maxTurns * 0.6 && !hasExported) {
  result += "\n\n⚠️ You have used " + turnCount + "/" + maxTurns + " turns and have not exported yet. " +
    "Prioritize calling export_query with your best validated SQL.";
}
```

#### 1c. 工具名合同校验

第 3 轮仍有 `read_knowledge_file`（不存在）和 `check_connection`（不存在）的调用。在工具分发层做显式拦截：

```typescript
// 当模型调用未注册工具时
return error(
  `Tool "${toolName}" does not exist. Available tools: ${registeredTools.join(", ")}. ` +
  `Use search_knowledge to find knowledge, query_database to query.`
);
```

**预期收益**：19 题中预估 +3~5 题（`local253` 和 `local099` 等已有正确结果但未导出的案例最可能翻转）。

---

### P1：消除仍存在的工具文档漂移（上轮遗留）

**问题**：报告第 6 节和逐案审计中发现：
- `TOOL_NAME_MAPPING` 和 `DATA_AGENT_SYSTEM_PROMPT` 仍作为模型可见提示追加到上下文
- SYSTEM.md 中 `tool_search` 引用仍存在
- 工具历史名称映射表让模型混淆当前可用工具名

**改法**：

1. 删除 [agent-assembly.ts](file:///D:/data_agent/packages/runtime/src/agent-assembly.ts#L461-L492) 中的 `DATA_AGENT_SYSTEM_PROMPT` 和 `TOOL_NAME_MAPPING`
2. `resolveSystemPrompt` 找不到 `.pi/SYSTEM.md` 时显式报错，不静默降级
3. 新增合同测试：从 SYSTEM.md 中提取所有工具名引用，断言每个都存在于 `tools-catalog.ts` 的注册表中

```typescript
// agent-assembly.test.ts — 新增
test("SYSTEM.md only references registered tool names", () => {
  const systemPrompt = readFileSync(".pi/SYSTEM.md", "utf8");
  const toolNames = extractToolReferences(systemPrompt);
  const registered = new Set(TOOLS_CATALOG.map(t => t.name));
  for (const name of toolNames) {
    expect(registered.has(name)).toBe(true);
  }
});
```

---

## 三、不建议做的事

1. **不要给 86 个失败题逐题写提示词补丁**——这是过拟合评测集，不能提升通用能力
2. **不要继续加长 SYSTEM.md**——当前已经有 Final Answer Contract + 语义自检 + 方言规则，模型已经在轨迹中"读到"了这些规则，但仍然选择了"更完整的结果"。问题不是规则缺失，是规则没有运行时强制力
3. **不要把约束表做成强制的结构化工具调用**——这会增加每题至少一轮开销。先作为提示词指引实验效果，如果模型确实按约束表执行则收益足够

## 四、实验顺序

| 序号 | 实验 | 改动范围 | 验证集 | 预期提升 |
|:---:|---|---|---|---|
| A | 导出前 shape 断言 | agent-assembly.ts（export_query handler） | 45 个形状错误题 | +8~12 题 |
| B | 约束表模板 | SYSTEM.md | 22 个同形异值 + 6 个回归题 | +4~6 题 |
| C | 探索预算 + 导出 deadline | agent-assembly.ts（query_database handler） | 19 个无 CSV 题 | +3~5 题 |
| D | 删除兼容层 + 工具合同测试 | agent-assembly.ts, SYSTEM.md | 全量 135 题 | +0~1 题（防回归） |

> [!IMPORTANT]
> 实验 A 和 C 是运行时强制机制，效果最确定；实验 B 是提示词机制，收益取决于模型执行力。建议 A → C → D → B 的顺序。
>
> 保守预估：全部完成后 E2E 正确率从 36.30%（49/135）提升到 **47~53%**（63~72/135）。

## 五、6 个真回归的根因与防护

| 案例 | 回归内容 | 根因 | 防护 |
|---|---|---|---|
| `local007` | 日期差：组件公式 → 日历借位 | 模型用"更标准"的日期算法覆盖题目公式 | 约束表强制引用题目原文公式 |
| `local081` | 折扣：排除 → 应用 `(1-discount)` | 模型用 Northwind 惯用公式覆盖"excluding discounts" | 约束表"过滤条件"字段 |
| `local085` | 比例：0-100 → 0-1 | 忘记乘 100 | shape 断言的 `expected_columns` 可附带单位 |
| `local131` | 偏好：三列透视 → 单列合计 | 误读"1st, 2nd, 3rd"为合并 | 约束表"一行代表什么"字段 |
| `local229` | Partnership：runs only → runs+extras | 自行加入 extras | 约束表"精确公式"字段 |
| `local309` | Constructor：results → standings | 用 standings 表替代 results 聚合 | 约束表"分子事件"字段 |
