# Spider2 评测问题 → Agent 改进建议（v2）

综合三份材料：
- [Spider2基线评测报告](file:///D:/data_agent/docs/Spider2基线评测报告.md)
- [Spider2工具路由错误分析](file:///D:/data_agent/docs/Spider2工具路由错误分析.md)
- 知识库实际文件审查（[rules.md](file:///D:/data_agent/knowledge/doc/rules.md)、[learning.md](file:///D:/data_agent/knowledge/doc/learning.md)、[business.md](file:///D:/data_agent/knowledge/doc/business.md)）

以下按优先级列出具体改进方案。

---

## P0：基础设施缺陷（不修会持续污染所有评测）

### 1. System Prompt 硬编码 MySQL 方言 → 与 SQLite 后端直接冲突

**根因**：[agent-assembly.ts L444](file:///D:/data_agent/packages/runtime/src/agent-assembly.ts#L444) 硬编码了：

```
数据库为 MySQL 业务库：系统表查询用 SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()，禁止使用 sqlite_master。
```

通过 `TOOL_NAME_MAPPING` 无条件追加到 System Prompt 末尾（L458），**无论实际连接的是什么数据库**。直接导致模型在 SQLite 任务中使用 `information_schema`、`YEAR()`、`DATEDIFF()`、`DATE_FORMAT()` 等 MySQL 专有语法（评测报告 §3.5：37 次函数错误 + 11 次元数据查询错误）。

**改法**：`TOOL_NAME_MAPPING` 中的方言说明改为动态注入，由 `createDataAgentHarness` 的 `deps` 传入当前后端类型：

```typescript
// agent-assembly.ts
function dialectHint(backend: "sqlite" | "mysql" | "bigquery" | "snowflake"): string {
  switch (backend) {
    case "sqlite":
      return [
        "数据库后端为 SQLite。",
        "系统表查询用 `SELECT name FROM sqlite_master WHERE type='table'`。",
        "日期函数用 strftime()，不支持 YEAR/MONTH/DATEDIFF/DATE_FORMAT。",
        "浮点除法用 `CAST(x AS REAL)` 或 `1.0 * x / y`，整数除法会截断。",
        "字符串连接用 `||`，不支持 CONCAT()。",
        "不支持 information_schema。",
      ].join("\n");
    case "mysql":
      return "数据库为 MySQL 业务库：系统表查询用 `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()`，禁止使用 sqlite_master。";
    // ... bigquery / snowflake
  }
}
```

**验证**：修改后运行评测，检查 `information_schema` 和 MySQL 函数的工具错误数是否降至 0。

---

### 2. SQL Guard 误杀合法只读 SQL（92.6%）

**根因**：[sql-guard.ts L39](file:///D:/data_agent/packages/runtime/src/sql-guard.ts#L39) 将 `UNION [ALL] SELECT` 放在 `INJECTION_PATTERNS` 中全量拦截；[L29](file:///D:/data_agent/packages/runtime/src/sql-guard.ts#L29) 用 `\bREPLACE\b` 拦截了标量函数 `REPLACE(str, from, to)`。

**影响**：122 次拦截中 113 次为误杀（104 次 UNION + 9 次 REPLACE 函数），涉及 45 题，这些题正确率仅 8.9%（vs 无 Guard 错误题 36.7%）。工具路由诊断进一步确认：`local201`、`local220` 等案例先被 Guard 阻断，再转向 Python，形成次生错误链。

**改法**：

```typescript
// sql-guard.ts — INJECTION_PATTERNS
export const INJECTION_PATTERNS = [
  ";\\s*\\w",           // 多语句注入 — 保留
  "/\\*.*?\\*/",        // 块注释 — 保留
  // 删除: "\\bUNION\\s+(ALL\\s+)?SELECT\\b"
  "\\bEXEC\\b",         // 保留
  "\\bXP_\\w+",         // 保留
] as const;

// sql-guard.ts — DANGEROUS_KEYWORDS
// 将 "\\bREPLACE\\b" 改为精确匹配写操作：
"\\bREPLACE\\s+INTO\\b",  // 仅拦截 REPLACE INTO（写操作）
```

**验证**：
1. 现有合约测试通过；
2. 新增测试用例确认 `SELECT a UNION ALL SELECT b` 和 `SELECT REPLACE(col, 'x', 'y')` 通过 Guard；
3. `INSERT INTO`、`REPLACE INTO`、`DROP TABLE` 仍被拦截；
4. 在原 45 个受影响案例上复测，观察 Guard 错误清零和正确率变化。

---

### 3. Python 运行时接线错误 + 工具无条件暴露

**根因**（工具路由诊断 §2.1）：评测脚本 [run.mjs](file:///D:/data_agent/evaluations/spider2/run.mjs) 创建 Harness 时未传入 `pythonExecutable` 和 `pythonWorkspaceDir`（尽管 `config.local.json` 已配置 Python 路径，但只给了评分器，没给 Agent）。同时 [agent-assembly.ts](file:///D:/data_agent/packages/runtime/src/agent-assembly.ts) 的 `buildAgentTools()` 无条件注册 `run_python`、`show_widget`、`generate_dashboard`。

**影响**：
- `run_python`：27 次调用，100% 失败（`PYTHON_RUNTIME_NOT_AVAILABLE`），涉及 23 题
- `show_widget`：15 次调用，7 次失败（合同冲突），涉及 10 题
- `load_skill("analysis")`：8 次误加载，6 次纯浪费

**改法**（两步）：

**步骤 A**：评测脚本正确接线或不注册

```typescript
// run.mjs — createCaseRunner 中创建 harness 时
const harness = await runtime.createDataAgentHarness({
  // ...existing deps
  pythonExecutable: config.pythonExecutable,        // 传入
  pythonWorkspaceDir: prepared.workspaceRoot,       // 传入
}, profile);
```

如果评测环境确实不需要 Python，则在 `buildAgentTools` 中根据 `deps` 做条件注册：

```typescript
// agent-assembly.ts — buildAgentTools()
if (deps.pythonExecutable) {
  tools.push(runPythonTool);
}
```

**步骤 B**：不能让 `show_widget` 和 `generate_dashboard` 在纯查询评测中暴露

```typescript
if (deps.widgetRenderer) {
  tools.push(showWidgetTool);
}
if (deps.dashboardRenderer) {
  tools.push(generateDashboardTool);
}
```

同时清理 [SYSTEM.md L1](file:///D:/data_agent/.pi/SYSTEM.md#L1) 中已废弃的 `tool_search` 指引（指向不存在的工具）。

**验证**：评测模式下确认模型工具列表中不包含不可用工具，相关 27+7 次工具错误降至 0。

---

### 4. Widget 合同三源冲突

**根因**（工具路由诊断 §3.3）：模型看到三份互相矛盾的 Widget 文档：

| 来源 | `kind` 枚举 | 数据参数 |
|---|---|---|
| [SYSTEM.md L59-64](file:///D:/data_agent/.pi/SYSTEM.md#L59) | `metric_cards / table / chart / steps / rich_text / echarts` | `config`（echarts 时） |
| [Analysis SKILL.md L28](file:///D:/data_agent/.agents/skills/analysis/SKILL.md#L28) | `echarts` | `config` |
| [Runtime tools-catalog.ts L30](file:///D:/data_agent/packages/runtime/src/tools-catalog.ts#L30) | `kpi / chart / table / steps` | `spec` |

导致 `local286` 按 Skill 用 `kind=echarts` 被 Schema 拒绝，`local218` 的 KPI 结构不符，`local068`/`local301` 用 `rows` 而 Runtime 要求 `data` 等。

**改法**：以 [tools-catalog.ts](file:///D:/data_agent/packages/runtime/src/tools-catalog.ts) 为唯一事实来源，统一 SYSTEM.md 和 SKILL.md：

1. SYSTEM.md 中的 `show_widget` 说明改为 `kind = kpi / chart / table / steps`，参数为 `spec`，删除 `metric_cards`、`rich_text`、`echarts` 三个不存在的 kind 值
2. Analysis SKILL.md 路径 A 改为使用 `kind="chart"` + `spec={...}`，不再使用 `kind="echarts"` + `config={...}`

**验证**：Widget 合同冲突导致的 7 次失败降至 0。

---

### 5. 评测知识库覆盖：`rules.md` 被 3 行空壳替换

**根因**：[run.mjs L217](file:///D:/data_agent/evaluations/spider2/run.mjs#L217) 的 `prepareKnowledge` 为每道题生成全新的隔离知识库，直接用 3 行文本覆盖 `rules.md`：

```javascript
await writeFile(path.join(knowledgeDoc, "rules.md"),
  `# Evaluation Database Rules\n\nDatabase: ${instance.db}\nBackend: ${backendForCase(instance)}\nQueries must remain read-only.\n`, "utf8");
```

原始 [rules.md](file:///D:/data_agent/knowledge/doc/rules.md) 中积累的 8 条原则（NULLIF 除零保护、DISTINCT 去重、JOIN 前过滤、排序确定性等）在评测中**一条都没进去**。

> [!WARNING]
> 同时，[learning.md](file:///D:/data_agent/knowledge/doc/learning.md) 中积累的 2550 行历史错误记录（包括多表 JOIN 膨胀经验、ECharts 配置教训等）也被空壳替换。尽管评测应该用隔离环境，但完全丢弃通用规则是错误的。

**改法**：`prepareKnowledge` 应该**读取原始 `rules.md` 作为基础，追加评测特定信息**，而非覆盖：

```javascript
// run.mjs — prepareKnowledge
const baseRules = await readFile(
  path.join(projectRoot, "knowledge", "doc", "rules.md"), "utf8"
).catch(() => "");

const evalRules = `\n\n## Evaluation Database Rules\n\nDatabase: ${instance.db}\nBackend: ${backendForCase(instance)}\nQueries must remain read-only.\n`;

// 当 backend === "sqlite" 时追加方言规则（见 P1-9）
const dialectRules = backendForCase(instance) === "sqlite" ? sqliteDialectRules : "";

await writeFile(
  path.join(knowledgeDoc, "rules.md"),
  baseRules + evalRules + dialectRules, "utf8"
);
```

> [!IMPORTANT]
> 需要审查原始 `rules.md` 中是否有不适用于评测的内容（如特定业务的状态值定义 L45-47）。建议将 `rules.md` 拆分为 **通用 SQL 规则**（评测可用）和 **业务特定规则**（仅生产环境）两部分。

**验证**：评测中 Agent 的 `search_knowledge("rules")` 能返回完整规则内容。

---

### 6. 评测适配器：`selectFinalSql` 提取了未完成的调用

**根因**：[lib.mjs L177](file:///D:/data_agent/evaluations/spider2/lib.mjs#L177) 的过滤条件是 `!call.isError`，但超时中断时最后一个工具调用的 `isError` 仍为初始值 `false`（[run.mjs L261](file:///D:/data_agent/evaluations/spider2/run.mjs#L261) 只在 `tool_execution_end` 事件中设置，超时时该事件不会触发）。

**改法**：

```javascript
// lib.mjs — selectFinalSql
const successful = toolCalls.filter(
  (call) =>
    call.finishedAt &&       // 必须已完成
    !call.isError &&
    typeof call.args?.sql === "string" &&
    call.args.sql.trim(),
);
```

**验证**：对 9 个超时任务重新执行 `selectFinalSql`，确认不再选中未完成调用。`local032` 的虚假得分被修正。

---

### 7. 评测适配器：0 字节 CSV + maxTurns 越界

**0 字节 CSV**：SQLite MCP 的 `export_query` 在 SQL 返回 0 行时生成 0 字节空文件（无表头），`local275` 因此被误判通过。改法：0 行结果仍写入 CSV Header；`collectArtifacts` 拒绝 0 字节文件。

**maxTurns 越界**：[run.mjs L252](file:///D:/data_agent/evaluations/spider2/run.mjs#L252) 用 `turnCount > limits.maxTurns`，实际多跑 1 轮。改为 `>=`。

---

## P1：Agent 能力缺陷（直接影响正确率的核心改进）

### 8. 增加通用"最终答案契约"（Final Answer Contract）

**问题**：74 个导出错误的任务中，86.5%（64 题）的行数或列数与 Gold 不一致。31 题 Gold 仅需 1 行，Agent 却导出了多行明细。

**改法**：在 [SYSTEM.md](file:///D:/data_agent/.pi/SYSTEM.md) 的 Task Execution 部分加入：

```markdown
## Final Answer Contract

在调用 `export_query` 导出最终结果之前，必须自检：

1. **粒度匹配**：用户要求的是单个数值（标量）、Top-N、分组汇总，还是明细？
   当前结果的行数和列数是否与需求一致？
2. **完整性**：是否仍停留在中间 CTE / 中间统计（如各品类明细），
   还需要最后一步聚合（求和、平均、最值、排名过滤）？
3. **最终 SQL = 已验证 SQL**：导出的 SQL 必须是最后一次 query_database
   成功验证过的 SQL，不能是未执行的修改版本。

常见错误模式：
- 问"最长距离是多少" → 应返回 1 行 1 列，不是所有距离的明细
- 问"平均支付次数" → 应返回聚合值，不是各品类的支付次数
- 问"第一名是谁" → 应返回 1 行，不是所有参赛者排名
```

> [!IMPORTANT]
> 这个契约必须是通用规则，不能包含任何 Spider2 题目的具体字段或答案。

**验证**：在 74 个已导出错误任务上复测，目标：形状匹配率从当前 13.5%（10/74）提升到 40%+。

---

### 9. 知识库注入 SQLite 方言指南

**问题**：当前 `rules.md` 的通用规则不包含任何方言信息。更糟的是，[learning.md L143](file:///D:/data_agent/knowledge/doc/learning.md#L143) 中记录了 _"MySQL 不支持 JULIANDAY()，日期差用 DATEDIFF()"_——这条经验在 SQLite 环境中恰好是**反向误导**。

**改法**：在 `prepareKnowledge` 中，当 `backend === "sqlite"` 时追加 SQLite 专用规则到 `rules.md`：

```javascript
const sqliteDialectRules = `
## SQLite 方言规则

- 日期提取：用 strftime('%Y', date_col)，不支持 YEAR() / MONTH() / DATEDIFF() / DATE_FORMAT()
- 日期差：用 julianday(d1) - julianday(d2)
- 浮点除法：用 CAST(x AS REAL) / y 或 1.0 * x / y，整数除法会截断小数
- 字符串连接：用 ||，不支持 CONCAT()
- 字符串截取：用 substr()，不支持 SUBSTRING_INDEX()
- 系统表：用 sqlite_master，不支持 information_schema
- 不支持 LIMIT x, y 的双参数形式，用 LIMIT y OFFSET x
- GROUP BY 中引用列别名是合法的
- 没有 IF() 函数，用 CASE WHEN ... THEN ... ELSE ... END
- 没有 IFNULL()，用 COALESCE()
`;
```

**验证**：SQLite 不支持函数错误（当前 37 次）和语法错误（当前 36 次）应大幅下降。

---

### 10. 导出完成后缺少"任务终止"信号

**问题**（工具路由诊断 §3.1）：10 个 Widget case 中，9 个在 CSV 已成功导出后才触发 Widget。根因是 [SYSTEM.md L21](file:///D:/data_agent/.pi/SYSTEM.md#L21) 要求 _"data analysis should be a deep, insightful analytical report"_，导致模型在已完成导出后继续做不必要的可视化和报告，消耗轮次直至 max_turns。

**改法**：不删除 L21（它是生产需求），而是在 `export_query` 的返回结果中加入明确信号：

```typescript
// reference-sqlite-mcp.ts — export_query 成功返回时
return {
  content: [{
    type: "text",
    text: `File exported successfully: ${filename} (${rowCount} rows).\n` +
          `If the user's request was to query and export data, your task is complete.\n` +
          `Do not generate additional analysis or visualization unless the user explicitly asked for it.`
  }]
};
```

这比改 System Prompt 更精准——只在导出成功后触发，不影响用户真正要求分析的场景。

**验证**：复测 9 个导出后触发 Widget 的 case，确认 Agent 在导出后直接结束。

---

### 11. 确定性错误熔断：禁止对不可用工具重试

**问题**（工具路由诊断 §2.2）：`run_python` 返回 `PYTHON_RUNTIME_NOT_AVAILABLE` 后，模型仍会重试（23 题中至少 8 次属于无效重试或探测）。当前错误返回只有错误码，没有给模型任何替代指引。

**改法**：在 `run_python` 的错误返回中给出明确的禁止 + 替代路径：

```typescript
// agent-assembly.ts — run_python handler
if (!deps.pythonExecutable) {
  return {
    content: [{
      type: "text",
      text: "PYTHON_RUNTIME_NOT_AVAILABLE.\n" +
            "Python is not available in this environment. Do NOT call run_python again.\n" +
            "Use SQL (query_database / export_query) to complete this task instead.\n" +
            "For statistics like median, percentile, stddev — use SQLite window functions or subqueries."
    }],
    isError: true
  };
}
```

**验证**：确认模型在收到此错误后不再调用 `run_python`，无效重试降至 0。

---

### 12. Skill `allowed-tools` 会重新引入已隐藏的工具

**问题**：[Analysis SKILL.md](file:///D:/data_agent/.agents/skills/analysis/SKILL.md#L5) 的 `allowed-tools` 列表包含 `run_python` 和 `show_widget`。一旦 Skill 被加载，[skills.ts](file:///D:/data_agent/packages/runtime/src/skills.ts) 的 `effectiveTools` 会将可用工具裁剪为 Skill 声明的集合——这意味着即使 Harness 层已隐藏这两个工具，Skill 加载后它们又会被重新引入。

**改法**：`effectiveTools` 的逻辑改为 **Skill.allowed-tools ∩ 当前已注册工具**（取交集）：

```typescript
// skills.ts — effectiveTools
export function effectiveTools(
  registeredTools: Tool[],
  activeSkills: Skill[]
): Tool[] {
  if (activeSkills.length === 0) return registeredTools;
  const registeredNames = new Set(registeredTools.map(t => t.name));
  const allowed = new Set(
    activeSkills.flatMap(s => s.allowedTools)
      .filter(name => registeredNames.has(name))  // 取交集
  );
  return registeredTools.filter(t => allowed.has(t.name));
}
```

**验证**：在未注册 `run_python` 的环境中加载 Analysis Skill，确认 `run_python` 不会出现在可用工具中。

---

## P2：语义正确性改进

### 13. 聚合粒度与数值语义自检

**问题**：10 个错误任务结果形状与 Gold 完全一致，但数值不对。根因是聚合粒度、JOIN 基数、浮点截断、窗口边界等语义错误。

**改法**：在 `rules.md` 中加入通用自检清单（原始 `rules.md` 已有规则 4.1 除零保护和规则 2.1 DISTINCT，需补充以下缺失项）：

```markdown
## SQL 语义自检

在 query_database 验证结果后、export_query 导出前，检查：

1. **聚合粒度**：AVG 的分母是什么？是按行、按实体、还是按分组？
2. **JOIN 基数**：一对多 JOIN 是否导致行重复膨胀？
3. **浮点除法**：整数除以整数会截断（SQLite/MySQL），是否需要 CAST？
4. **窗口边界**：ROWS BETWEEN 的范围是否正确？PRECEDING/FOLLOWING 是否包含当前行？
5. **排序 Tie-breaker**：TOP-N 有并列时用什么规则打破？
6. **NULL 处理**：COUNT vs COUNT(col)、SUM 中的 NULL、COALESCE 兜底
7. **时间边界**：BETWEEN 包含两端；>= 和 < 的区间是否正确？
```

**验证**：在 10 个同形状数值错误任务上复测，目标：至少 3-4 个翻转为正确。

---

### 14. Skill 触发描述收紧

**问题**（工具路由诊断 §4）：Analysis Skill 的 `description` 为 _"数据分析与可视化"_，`when_to_use` 虽然写了 _"画图、趋势图..."_，但 System Prompt 要求 _"任务匹配时优先加载"_，导致 calculate、average、analyze、report 等普通查询词也触发加载。8 次加载中 6 次纯浪费。

**改法**：

```yaml
# SKILL.md frontmatter
description: 交互图表渲染 — 仅当用户明确要求画图或可视化时使用
when_to_use: 仅当用户明确要求"画图"、"图表"、"可视化"、"趋势图"、"折线图"、"柱状图"、"饼图"、"保存图表"、"下载图表"时使用。不要在纯数据查询、统计计算、数据导出任务中加载此 Skill。
```

**验证**：复测 8 个误加载 case，确认纯查询任务不再触发 Skill 加载。

---

## P3：效率优化

### 15. 错误路径早停 / 回退机制

**问题**：正确任务平均 9.6 轮 / 11.9 次工具调用；错误任务平均 14.8 轮 / 20.8 次。典型错误链（工具路由诊断 §5）：

```
SQL Guard 拒绝 → Python 失败 → 加载 Skill → Python 再次失败 → Widget 合同错误 → max_turns
```

**建议方向**：
- Guard 拦截后，返回消息应说明**被拦截的具体模式和替代写法**，而非只返回 `SQL blocked: injection pattern detected [...]`
- 连续 N 次（如 3 次）相同工具错误后，Agent 应切换策略
- 可选展示（Widget）失败不能推翻已成功完成的查询交付

---

### 16. `rules.md` 和 `learning.md` 质量治理

**问题**：[learning.md](file:///D:/data_agent/knowledge/doc/learning.md) 有 2550 行，但存在严重的质量问题：

- 大量占位垃圾记录（`q1`/`e1`/`f1`、`SELECT * FROM bad` → `SELECT * FROM good`），同一批占位记录被重复写入至少 3 次（L155-L300, L446-L610, L656-L800）
- L143 记录了 _"MySQL 不支持 JULIANDAY()，日期差用 DATEDIFF()"_——在 SQLite 环境中是**反向误导**
- 有价值的记录（如 L122 多表 JOIN 膨胀经验）被噪声淹没

**建议**：
- 清理占位和重复记录，保留真实有价值的经验
- 对方言相关的经验加上适用范围标注（如 `[MySQL only]`、`[SQLite only]`）
- `save_learning` 工具应做去重检查，防止同一条记录被重复写入

---

## 建议实验顺序

| 序号 | 实验 | 改动范围 | 主要验证指标 | 预期提升 |
|:---:|---|---|---|---|
| A | 修 SQL Guard（P0-2） | sql-guard.ts | Guard 误杀数 → 0 | +5~8 题 |
| B | 修方言硬编码 + 知识库追加（P0-1, P0-5, P1-9） | agent-assembly.ts, run.mjs | SQLite 函数/语法错误 → 0 | +3~5 题 |
| C | 修工具可见性 + Python 接线（P0-3） | agent-assembly.ts, run.mjs | run_python 错误 → 0 | +2~3 题 |
| D | 修 Widget 合同 + Skill 交集（P0-4, P1-12） | tools-catalog.ts, SYSTEM.md, SKILL.md, skills.ts | Widget 合同错误 → 0 | +1~2 题 |
| E | 加最终答案契约 + 导出终止信号（P1-8, P1-10） | SYSTEM.md, reference-sqlite-mcp.ts | 形状匹配率 13.5% → 40%+ | +8~12 题 |
| F | 加确定性错误熔断（P1-11） | agent-assembly.ts | 无效重试 → 0 | +1~2 题 |
| G | 修评测适配器（P0-6, P0-7） | lib.mjs, run.mjs, reference-sqlite-mcp.ts | 评分准确性 | 净减 1 题虚假得分 |
| H | 加语义自检 + Skill 收紧（P2-13, P2-14） | rules.md, SKILL.md | 同形状数值正确率 | +3~4 题 |

> [!IMPORTANT]
> 每项实验单独进行（单变量 A/B），先在受影响子集上验证，通过 Regression Set 后再跑完整 135 题。禁止将单题修复写入 Prompt 或 Skill。

保守估计：P0 + P1 全部修复后，审计后 E2E EX 有望从 27.41%（37/135）提升到 **40~46%**（54~62/135）。
