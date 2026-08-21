# KTX 语义看板联动设计

## 1. 设计结论

Omega 的 `HTML + QueryRegistry + DTBridge` 是很好的参考，但不是本项目的最佳终态。

Omega 需要兼容 AI 生成的任意 HTML 和任意 SQL，因此必须额外维护 SQL 模板、参数占位符、字段绑定表和客户端查询调度。Data Agent 已经拥有 KTX 语义查询、受控 Dashboard Renderer 和结构化看板工具，没有必要复制这层补偿性复杂度。

本项目采用更直接的模型：

> **一个规范化的 Semantic Dashboard Document，经过同一个编译器和求值器，生成初始快照并驱动运行时刷新。HTML 只负责显示和上报参数变化。**

核心链路：

```text
Semantic Dashboard Document
        ↓ compile
Parameter Graph + KTX Query Plans + View Manifest
        ↓ evaluate(default parameters)
Initial Data Snapshot
        ↓ render
HTML Dashboard
        ↓ parameter change
Host Bridge → evaluate(changed parameters) → KTX sl_query
        ↓
Data Patch → deterministic re-render
```

这不是在 Dashboard V3 上附加一个 QueryRegistry，而是重新确定语义看板的数据与状态模型。V3 继续作为静态 CSV 看板契约保留，V4 作为新的语义看板契约。

---

## 2. 从 Omega 保留什么

保留四个正确原则：

1. 数据不能永久写死在 HTML 中。
2. 查询必须有结构化契约，不能由页面临时拼 SQL。
3. 参数变化只刷新受影响的数据。
4. 身份、权限和查询执行必须留在服务端。

不照搬以下实现：

1. 不在 HTML 中保存 `sqlTemplate`。
2. 不扫描 SQL 占位符推断依赖。
3. 不让浏览器逐图调度查询。
4. 不维护独立于看板文档的 QueryRegistry。
5. 不让 AI 分别生成 SQL 别名和图表字段，再用 `fieldBindings` 修补两者。

---

## 3. 设计原则

### 3.1 一个事实源

查询、参数、视图和交互统一保存在一个 V4 文档中。HTML 是该文档的可运行投影，不是另一份业务定义。

### 3.2 查询是数据节点

不使用 `dataset → queryId → QueryRegistry` 三层间接引用。每个 `data` 节点本身就是一条可执行的 KTX 声明式查询。

### 3.3 参数是唯一交互状态

筛选和预定义下钻都归一化为“设置参数”。数据节点通过结构化 `$param` 引用声明依赖，编译器直接得到依赖图。

### 3.4 输出字段由服务端确定性映射

V4 文档为每个查询选择项声明稳定输出名，但这些名字不会传给 KTX。KTX 的 `sl_query` 输入不支持别名，返回的 `headers` 来自数据库驱动：

```text
ktx/packages/cli/src/semantic-context/mcp.ts:44      measures/dimensions 只接受 semantic ref，无 alias
ktx/packages/cli/src/context/sl/local-query.ts:151   headers: execution.headers
ktx/packages/cli/src/connectors/mysql/connector.ts:750  headers = fields.map(f => f.name)
```

因此“稳定输出名”是**服务端列映射契约**，映射规则必须先由真实探测确定（见 §4），不能假设 KTX 会返回我们指定的名字。

### 3.5 同一个求值器服务构建和运行

构建 HTML 时执行默认参数；运行时参数变化后调用同一求值器。禁止形成“构建时一套查询、运行时另一套查询”。

### 3.6 HTML 是无凭据渲染器

HTML 不持有数据库凭据、Bearer Token、原始 SQL 或 MCP 连接能力。认证由宿主 React 页面持有。

### 3.7 参数值是受控枚举

浏览器提交的参数值必须落在服务端已知值域内。KTX 侧 filter 会被渲染成 SQL 字面量：

```text
ktx/packages/cli/src/semantic-context/mcp.ts:renderFilter / sqlLiteral
```

`sqlLiteral` 只做单引号翻倍，而 MySQL 默认把反斜杠当转义符，所以自由文本进入 filter 是不可接受的。V4 通过“参数值必须来自 options 值域”消除这条路径。

---

## 4. Phase 0：冻结列映射前的必要探测

在实现编译器之前，必须先用真实 KTX 执行一次查询并记录：

1. 纯维度 + 单 measure 的 `headers` 实际名称；
2. `dimensions` 带 `granularity` 时的 header 名称；
3. `headers` 顺序与请求中 `dimensions`/`measures` 顺序的关系；
4. `plan` 中是否包含可用于列对齐的结构化信息。

冻结规则：

- 若 header 名称稳定可预测：以**名称映射**为主，列数校验为辅；
- 若 header 名称不稳定：以**位置映射**为主，列数与类型校验为辅；
- 两种情况都要求：列数不符立即报契约错误，绝不静默产出空图。

探测结果写入本文件的附录，作为实现依据。未完成探测不得开始编译器实现。

---

## 5. V4 文档模型

```json
{
  "version": "4",
  "title": "行业经营分析",
  "connection": "default-mysql",
  "parameters": {},
  "data": {},
  "views": [],
  "interactions": [],
  "layout": {},
  "exports": []
}
```

V4 只保留五类核心对象：

- `parameters`：页面状态与筛选控件；
- `data`：KTX 声明式查询节点；
- `views`：数据的确定性呈现；
- `interactions`：把用户事件转成参数变化；
- `layout`：页面布局。

`connection` 必填，用于确定性执行，即使当前只有单连接。

### 5.1 Parameters

```json
{
  "parameters": {
    "month": {
      "type": "select",
      "label": "月份",
      "default": null,
      "options": { "data": "month_options", "field": "month" }
    },
    "industry": {
      "type": "select",
      "label": "行业",
      "default": null,
      "options": { "data": "industry_options", "field": "industry" }
    }
  }
}
```

规则：

1. `null` 表示未设置；未设置的参数对应的 filter 直接省略，因此不需要 `omitWhenEmpty` 之类的开关。
2. `options` 必须指向一个 data 节点及其输出字段，不允许隐式从主查询结果推断。
3. **options 节点不得引用任何 `$param`**。这保证值域稳定、白名单确定，并从根上排除级联筛选的复杂度。
4. options 值域同时用于 UI 渲染和服务端白名单校验，两者共用同一份数据。
5. 首期只有 `select`。`multi_select` 与 `date_range` 属于后续扩展，随它们一起引入 `in` 与 `between`。

### 5.2 Data Nodes

```json
{
  "data": {
    "month_options": {
      "source": "business_industry_sales_trend",
      "dimensions": {
        "month": { "field": "snapshot_month", "granularity": "month" }
      },
      "measures": { "sales": "sales_ytd_total" },
      "orderBy": [{ "field": "month", "direction": "desc" }],
      "limit": 200
    },
    "industry_trend": {
      "source": "business_industry_sales_trend",
      "dimensions": {
        "month": { "field": "snapshot_month", "granularity": "month" },
        "industry": { "field": "industry_name_large" }
      },
      "measures": {
        "sales": "sales_ytd_total",
        "yoy": "yoy_growth_rate"
      },
      "where": [
        { "field": "snapshot_month", "operator": "eq", "value": { "$param": "month" } },
        { "field": "industry_name_large", "operator": "eq", "value": { "$param": "industry" } }
      ],
      "orderBy": [{ "field": "month", "direction": "asc" }],
      "limit": 1000
    }
  }
}
```

编译规则：

- `source + field` 编译为 KTX 完整 semantic ref；
- `dimensions` 与 `measures` 的键是 View 可用字段，由服务端按 §4 冻结的规则映射；
- `orderBy.field` 引用本节点输出字段，编译时转回 semantic ref；
- `where[].value` 支持 `{ "$param": ... }` 与字面量常量；
- 参数未设置时该 filter 整条省略；
- **每个节点至少一个 measure**，这是 KTX 硬约束（`mcp.ts:44` 中 `measures` 为 `min(1)`），因此 options 节点也必须带一个 measure；
- `limit` 上限 1000（`mcp.ts:51`），`maxRows` 上限 10000 且由服务端统一施加（`mcp.ts:53`）。

映射后的行形如：

```json
{ "month": "2026-06-01", "industry": "零售业", "sales": 499.88, "yoy": 16.46 }
```

### 5.3 Views

View 只引用 data 节点的输出字段，不知道 KTX source、SQL 或物理列名。

Chart：

```json
{
  "id": "industry_trend_chart",
  "type": "chart",
  "data": "industry_trend",
  "title": "行业累计销售额趋势",
  "x": { "field": "month", "type": "category" },
  "axes": [
    { "id": "sales_axis", "orient": "y", "name": "销售额", "unit": "亿元" },
    { "id": "yoy_axis", "orient": "y", "name": "同比", "unit": "%" }
  ],
  "series": [
    { "field": "sales", "name": "累计销售额", "mark": "bar", "axis": "sales_axis" },
    { "field": "yoy", "name": "同比增速", "mark": "line", "axis": "yoy_axis" }
  ]
}
```

Table：

```json
{
  "id": "company_detail_table",
  "type": "table",
  "data": "company_detail",
  "columns": [
    { "field": "company", "label": "企业" },
    { "field": "sales", "label": "累计销售额", "format": "number:2" },
    { "field": "yoy", "label": "同比增速", "format": "percent:2" }
  ]
}
```

Metric cards 必须是数据绑定的，不能是构建期字符串，否则参数变化后会出现“图表已刷新、KPI 是旧值”的最坏状态：

```json
{
  "id": "kpi_summary",
  "type": "metric_cards",
  "data": "kpi_summary",
  "cards": [
    { "label": "累计销售额", "field": "sales", "agg": "first", "format": "number:2", "unit": "亿元" },
    { "label": "同比增速", "field": "yoy", "agg": "first", "format": "percent:2" }
  ]
}
```

`agg` 首期只支持 `first`、`sum`、`avg`、`max`、`min`，作用于该 data 节点当前行集合。

### 5.4 Interactions

所有确定性交互都归一化为参数变化：

```json
{
  "interactions": [
    {
      "source": { "view": "industry_ranking_chart", "event": "click", "field": "industry" },
      "action": {
        "type": "set_parameter",
        "parameter": "industry",
        "value": { "$event": "industry" },
        "toggle": true
      }
    }
  ]
}
```

状态语义：

- `toggle: true` 时，点击当前已选中的值等于清除该参数；
- 参数值为 `null` 即“返回上层”，V4 不需要独立的 `navigate-back`；
- 运行时必须提供 `reset` 操作，把全部参数恢复为 `default`；
- 页面顶部展示当前生效参数（chips），点击 chip 上的清除即置 `null`。

开放式问题，例如“为什么这个行业下降”，仍可交给 Agent；筛选、联动和预定义下钻不经过 Agent。

---

## 6. 编译与求值

### 6.1 Compile

编译器只做五件事：

1. 校验 parameters、data、views、interactions 的相互引用；
2. 校验 data 节点与字段存在于 KTX catalog（构建时借助 `sl_discover`）；
3. 把 source-relative 字段编译为 semantic refs；
4. 从 `$param` 引用生成依赖图；
5. 生成 View Manifest 与列映射表。

示例依赖图：

```text
month    → industry_trend, industry_ranking, kpi_summary
industry → industry_trend, company_detail
（options 节点不参与依赖图）
```

### 6.2 Evaluate

请求：

```json
{
  "requestId": "r-7",
  "dashboard": "20260817_101500/dashboards/industry_dashboard.html",
  "parameters": { "month": "2026-06-01", "industry": null },
  "changed": ["month"]
}
```

`changed` 只是提示。省略或为 `null` 时执行全量刷新；错误恢复、首次桥接和 reset 都必须提交全量刷新。

响应：

```json
{
  "requestId": "r-7",
  "parameters": { "month": "2026-06-01", "industry": null },
  "data": {
    "industry_trend": {
      "rows": [],
      "totalRows": 12,
      "fingerprint": "month=2026-06-01|industry="
    }
  },
  "errors": {
    "company_detail": { "code": "query_timeout", "message": "查询超时" }
  }
}
```

一致性规则：

1. 客户端只接受最新 `requestId` 的响应，旧响应直接丢弃；
2. 每个节点带 `fingerprint`，与当前参数不一致的视图标记“数据过期”，而不是假装是最新数据；
3. 单节点失败时保留其他节点与该节点最后一次成功数据，并在该视图上显示错误。

并发预算（MCP 侧上限为 3，且与 Agent 共用；见 `src/mcp/manager.py:69` 与 `:214`）：

- 单次 evaluate 最多 8 个节点；
- 请求内并发上限 2；
- 单节点超时 15s，请求总超时 25s；
- 超时节点单独报错，不影响其他节点。

求值器保持无状态：浏览器每次提交完整参数状态，服务端不维护 Dashboard Session。

---

## 7. HTML 与宿主通信

现状：预览通过 `srcDoc + sandbox="allow-scripts"` 承载，宿主已校验 `event.source`，但目前只有 iframe → 宿主 → Agent 的单向路径：

```text
frontend/src/components/common/GlobalPreviewModal.tsx:9    SUPPORTED_MESSAGE_TYPES = {'drill_down','navigate_back'}
frontend/src/components/common/GlobalPreviewModal.tsx:150   event.source 校验
frontend/src/components/common/GlobalPreviewModal.tsx:290   srcDoc + sandbox
```

V4 新增三种消息，并补齐宿主 → iframe 回写通道：

```text
dashboard_parameters_changed   iframe → 宿主
dashboard_data_patch           宿主 → iframe
dashboard_data_error           宿主 → iframe
```

运行过程：

1. HTML 更新本地参数状态并生成 `requestId`；
2. HTML 发送完整参数与 `changed`；
3. 宿主从当前预览 URL 解析看板路径，用已有认证调用 FastAPI；
4. 服务端读取 HTML 内嵌的 V4 文档，重新校验并求值受影响节点；
5. 宿主把 patch 或 error 发回原 iframe；
6. HTML 替换对应 data 节点并重绘关联 View。

通道约束：

- iframe origin 为 `null`，双向 `postMessage` 只能使用 `'*'`；
- 宿主校验 `event.source === iframeRef.current.contentWindow`；
- iframe 校验 `event.source === window.parent`；
- 认证 Token 不进入 iframe；
- V4 看板不再自动发送 `drill_down`；只有显式的“问 Agent”按钮才会触发对话，避免一次点击同时改参数又发消息。

接口只有一个：

```text
POST /dashboard-runtime/evaluate
```

看板路径由宿主注入，不接受 iframe 指定任意工作区文件。

模式判定：

- `window.parent === window` → 离线快照模式，隐藏实时刷新能力；
- 在 iframe 中但 8s 内没有任何响应 → 降级为快照模式并提示“实时刷新不可用”。

---

## 8. 工具契约与错误回环

- `build_dashboard` 保持 V3 语义不变。
- 新增 `build_semantic_dashboard(spec)`，只接受 `version: "4"`。
- Agent 必须先通过 `sl_discover` 获取 source、measure、dimension，禁止凭记忆填写 semantic ref。
- 编译错误以结构化、可修复的形式返回，例如：

```json
{
  "status": "invalid_spec",
  "errors": [
    { "path": "data.industry_trend.measures.yoy", "code": "unknown_measure", "message": "business_industry_sales_trend 无 yoy_growth_rate_recomputed" },
    { "path": "parameters.month.options", "code": "options_node_uses_param", "message": "options 节点不得引用 $param" },
    { "path": "views.kpi_summary.cards[0].field", "code": "unknown_field", "message": "data 节点 kpi_summary 无输出字段 sales" }
  ]
}
```

- 列映射失败（列数不符或名称缺失）在构建阶段即失败，并明确指出节点与字段。

---

## 9. 产物与离线边界

仍然只生成一个 HTML 文件：

```text
dashboards/industry_dashboard.html
```

内嵌内容与格式：

```html
<script id="dashboard-document" type="application/json">{...}</script>
```

要求：

1. JSON 中的 `<` 必须转义为 `\u003c`，避免 `</script` 截断，并保证宿主 `rewriteHtmlAssets` 的 DOMParser 往返安全；
2. 内嵌默认参数下的数据快照、options 值域、View Manifest 和确定性运行时；
3. 不写入 KTX 返回的 `sql` 字段；
4. 不增加 Registry 数据库、sidecar 文件或第二份看板定义。

运行边界：

- 在 Data Agent 中预览：参数变化实时调用 KTX；
- 下载后离线打开：展示最后一次快照，实时刷新不可用；
- 首期不提供可公开分享的在线 Dashboard URL。

---

## 10. 安全边界

1. HTML 只能提交参数名与参数值，不能提交 source、measure、field、operator 或 SQL。
2. 参数值必须命中服务端 options 值域白名单，未命中直接拒绝；未声明参数、类型不符、超长值同样拒绝。
3. 看板文档可被用户上传替换，因此服务端抽取后必须**完整重新校验**：参数声明、operator、节点数、limit、maxRows、options 节点无参数引用。
4. 文件访问沿用既有校验：`_ensure_owned_session` 与 `_safe_resolve_path`。
5. KTX 继续负责 approved semantic refs、只读执行与方言编译。
6. 服务端统一限制并发、超时与 `maxRows`。
7. HTML 中不保存数据库凭据、访问 Token 或原始 SQL。

---

## 11. 与 V3 的关系

- V3 保持现状：CSV 快照、本地筛选、独立 HTML。
- V4 是新的 canonical semantic dashboard contract。
- 不把 V4 编译回 V3，也不把 `semantic` source 塞进 V3 Dataset。
- V4 复用现有 ECharts 引擎、商业配色、布局 token 和 chart/table/KPI 视图语法；语义数据生命周期由独立的 V4 patch adapter 驱动，不复制 V3 的 CSV 状态模型。
- 已有 V3 看板无需迁移。

版本隔离用于保护语义边界，不意味着维护两套渲染引擎。

---

## 12. 首期范围

实现闭环所需能力：

1. 单连接；
2. KTX business/standalone source；
3. `select` 参数，值域来自无参数 options 节点；
4. 只支持 `eq`（`in`、`between` 随 `multi_select`、`date_range` 一起进入）；
5. chart、table、数据绑定型 metric_cards；
6. `set_parameter`，含 toggle、清除与 reset；
7. 构建时快照与应用内实时刷新；
8. 逐节点 loading / error / 数据过期状态；
9. `requestId` 丢弃旧响应，保留最后一次成功数据。

明确不做：

- SQL Template；
- arbitrary HTML callbacks；
- WebSocket / SSE；
- 查询缓存；
- Dashboard Runtime Session；
- Registry 数据库；
- 级联 options 查询、多选与复杂日期控件；
- 在线分享与定时推送；
- 把普通筛选或预定义下钻转成 Agent 对话。

---

## 13. 验收标准

以 `business_industry_sales_trend` 与 `business_industry_sales_ranking` 作为首个闭环：

1. Phase 0 探测结果已记录，列映射规则已冻结；
2. 构建时通过真实 KTX `sl_query` 得到初始快照与 options 值域；
3. 月份变化只刷新依赖月份的节点，其余节点不发起查询；
4. 点击行业通过 `set_parameter` 驱动趋势与明细联动，再次点击同值可清除；
5. reset 恢复默认参数并全量刷新；
6. KPI 随参数变化刷新，不出现图表已更新而 KPI 未更新；
7. 列数或字段不匹配时构建失败，并指明节点与字段；
8. 单节点超时或失败时其他节点正常，该节点显示错误并保留上次成功数据；
9. 参数值不在 options 值域内时服务端返回拒绝，且不发起 KTX 查询；
10. 并发预算生效：多节点刷新不会长时间阻塞同会话的 Agent 工具调用；
11. 整个刷新过程不调用 Agent、不生成 SQL；
12. HTML 中不存在数据库凭据、Bearer Token 与 SQL；
13. 下载后的 HTML 展示快照并明确处于离线模式；宿主无桥接时 8s 后降级提示；
14. 修改颜色或布局不改变 data 节点与指标口径。

---

## 附录 A：Phase 0 探测记录

已完成（2026-08-17），完整记录见 `docs/ktx_semantic_dashboard_development_log.md`：

```text
request:  business_industry_sales_trend
headers:  [snapshot_month_month, industry_name_large, sales_ytd_total]
mapping:  name-first + position-fallback
notes:    granularity=month 的实际 header 为 snapshot_month_month；
          plan.columns 保留逻辑名 snapshot_month；
          options 的时间值必须规范化为底层 filter 可接受的 YYYY-MM-01。
```

补充冻结结果：

- 无 granularity 的时间 header 为 `snapshot_month`；
- `business_industry_sales_ranking` 的行业查询 header 为 `[industry_name_large, sales_ytd_total]`；
- `yoy_growth_rate_recomputed` 当前真实执行返回 `semantic_operation_failed`，首期使用真实验证可执行的 `yoy_growth_rate`；
- V4 求值器不把 KTX 返回的 `sql` 或 `plan` 写入 HTML。
