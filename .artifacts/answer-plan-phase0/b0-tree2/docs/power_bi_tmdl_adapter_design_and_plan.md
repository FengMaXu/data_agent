# Data Agent Power BI TMDL 轻量适配器设计与实施计划

## 1. 文档状态

- 状态：设计完成，待实施
- 日期：2026-08-13
- 产品仓库：`D:\data_agent`
- **ktx** 工作区：`D:\data_agent\ktx`
- 目标：扫描 Power BI TMDL 项目，由 **ktx** 自研轻量模块提取模型结构和 DAX 信息；简单 DAX 确定性转换，复杂 DAX 交给现有 Ingest LLM 转换为 **ktx** YAML，最终跑通 `sl_ingest -> sl_validate -> sl_query`。

### 实施硬性原则

1. **禁止“差不多就可以了”**：任何阶段都必须以本阶段退出门禁、测试和真实证据为准；局部通过、近似结果、临时 fallback 或“看起来能跑”不得写成完成。
2. **禁止急于完成任务**：先完整理解现有架构、契约、依赖和风险，再按阶段实施；不得为了进度跳过设计约束、模块级验证、失败闭环或安装态验收。

> 术语更正：Power BI 官方名称是 **TMDL**（Tabular Model Definition Language），文件扩展名是 `.tmdl`，不是 TDML/`.tdml`。实现只接受标准拼写和 `.tmdl` 扩展名。

## 2. 结论

不再把 Sidemantic 作为运行时或构建依赖。采用“**自研最小 TMDL 提取器 + 自研 DAX 轻量分析器 + 现有 Ingest LLM + ktx 验证执行**”方案：

```text
Power BI Desktop Project / SemanticModel / definition / **/*.tmdl
    -> PowerBiSourceAdapter（detect、复制、diff）
    -> TmdlProjectExtractor（完整项目只解析一次）
         -> table / column / measure / relationship / role / partition
    -> DaxAnalyzer
         -> simple_native：简单聚合的确定性映射
         -> llm_required：保留复杂 DAX、引用和函数摘要
         -> invalid：结构错误，禁止生成可执行定义
    -> 每张 Power BI 语义表一个 WorkUnit
         -> powerbi_ingest skill + 现有 LLM/tools
         -> 复杂 DAX 转换为 ktx YAML
    -> semantic-layer/<target-warehouse>/*.yaml
    -> 现有 sl_validate
    -> 现有 sl_query -> QueryExecutor -> native connector
```

转换管线固定为：

```text
TMDL 结构提取
  -> DAX 轻量分析
  -> 简单 DAX 确定性映射
  -> 复杂 DAX 由 LLM 转换
  -> 物理标识符验证
  -> YAML/schema/query 验证
  -> 成功发布或明确降级
```

核心取舍：

1. **不依赖 Sidemantic 源码、包、Rust crate 或 AST**；Sidemantic 仅作为前期架构调研参考。
2. **不开发完整 DAX-to-SQL 编译器**；自研模块只负责可靠提取、引用分析和简单聚合识别。
3. **复杂 DAX 转 YAML 由 LLM 负责**，但 LLM 必须使用模型上下文、目标仓库 schema 和现有受约束写入/验证工具。
4. **不增加 Python bridge、HTTP endpoint、第二个 MCP 或 sidecar**；解析全部在现有 TypeScript CLI 内完成。
5. **不让 LLM 直接信任 Power BI 逻辑表名**；物理表、列、grain 和 join key 必须在目标仓库验证。
6. **转换失败不伪装成功**；无法验证的表达式保留原 DAX 和原因，通过 `emit_unmapped_fallback` 进入报告。

## 3. 设计依据与独立实现边界

### 3.1 当前 **ktx** 已具备所需主干

当前 `SourceAdapter` 已提供 `detect/fetch/chunk/project/finalize` 生命周期，不需要创建平行 Ingest 框架（[源码](https://github.com/Kaelio/ktx/blob/45aa95d2cc121267bbbc8c184402a19573956dd4/packages/cli/src/context/ingest/types.ts#L176-L200)）。默认适配器在统一 composition 中注册（[源码](https://github.com/Kaelio/ktx/blob/45aa95d2cc121267bbbc8c184402a19573956dd4/packages/cli/src/context/ingest/local-adapters.ts#L78-L145)）。

Power BI 应作为新的 `powerbi` context-source adapter 接入现有 Ingest 管道，而不是增加独立命令、任务系统或服务。

### 3.2 可以吸收的通用思路

从 Sidemantic 的调研中只吸收下列通用架构思想：

- TMDL 结构提取和 DAX 表达式分析分层；
- 先合并完整 TMDL 项目，再构建表和关系；
- 原始 DAX 永远保留；
- 解析成功与可转换成功是两个不同状态；
- 简单聚合确定性转换，复杂表达式交给后续处理；
- warning 必须包含文件和位置。

这些是通用解析器设计原则，不使用其具体实现。

### 3.3 独立实现约束

实现依据仅为：

- Microsoft TMDL 官方文档；
- Microsoft DAX syntax/operator/function 官方文档；
- 由本项目自行创建或从 Power BI Desktop 导出的测试 fixture；
- **ktx** 自身 YAML schema 和执行行为。

实施中必须：

1. 自己定义 Token、最小 AST、IR、错误码和测试；
2. 不复制或逐段改写 Sidemantic 的 Python/Rust 源码、测试、注释和内部数据结构；
3. 不导入 Sidemantic 生成的代码或 fixture；
4. 在依赖锁和打包清单中确认不存在 `sidemantic`、`sidemantic-dax`；
5. 对外只承诺本文明确列出的 TMDL/DAX 子集。

## 4. 范围

### 4.1 MVP 支持

- Power BI Desktop Project（PBIP）中的 TMDL semantic model；
- `source_dir` 指向 `<name>.SemanticModel`、`definition/` 或其直接父目录；
- 默认以 `definition/` 作为权威模型输入；可选读取同级 `TMDLScripts/` 作为脚本 evidence/patch 输入；
- 本地目录扫描；
- table、column、calculatedColumn、measure、description、visibility、data type、`isKey`；
- relationship 的 from/to column、cardinality、active 状态；
- 检测 role/RLS/OLS；
- partition 原文及简单物理表候选提取；
- 简单同表聚合 DAX 的确定性映射；
- 复杂 DAX 的 LLM 转换；
- measure 引用、表列引用和函数名摘要；
- model-level DAX function IR；
- 可选 TMDL script function/measure IR、脚本与 definition 冲突诊断；
- 增量 diff、删除隔离、provenance、last-known-good；
- 目标数据库已有 **ktx** enriched manifest，并先于 Power BI source ingest 完成。

### 4.2 MVP 不做

- 读取或解包 `.pbix`；用户必须先保存为 PBIP/TMDL；
- Power BI Service REST API、XMLA、Fabric API；
- Git 拉取、定时监听或文件系统 watcher；
- TMDL 反向导出；
- 完整通用 TMDL parser；
- 完整 DAX grammar、DAX evaluator 或 DAX-to-SQL 编译器；
- calculation groups、field parameters、perspectives、translations；
- calculated table 的自动执行；
- TMDL script 的无条件执行或直接覆盖 definition；
- RLS/OLS 的模拟；
- Direct Lake、composite model、多 partition 的自动物理映射；
- Power BI 配置 UI。MVP 先通过 `ktx.yaml` 手工配置跑通闭环。

## 5. 配置

新增唯一的 context-source driver：`powerbi`。

```yaml
setup:
  database_connection_ids:
    - warehouse

connections:
  warehouse:
    ref: env:DATA_AGENT_CONNECTION_WAREHOUSE

  sales-powerbi:
    driver: powerbi
    source_dir: D:/bi/Sales.SemanticModel/definition
    target_connection_id: warehouse
    # 可选；默认 false。TMDLScripts 是脚本/evidence，不是权威 definition。
    include_tmdl_scripts: false

ingest:
  adapters:
    - live-database
    - powerbi
```

约束：

1. `source_dir` 必填，运行时解析为绝对目录；不接受 `.pbix` 文件。
2. `target_connection_id` 必填，必须引用同一 `ktx.yaml` 中已配置的数据库 driver。
3. 一个 Power BI source 在 MVP 中只映射一个目标数据库。
4. Power BI 凭据不进入本适配器；数据库查询使用目标数据库的现有 connection ref。
5. `include_tmdl_scripts` 默认 `false`；启用后适配器读取 `TMDLScripts/`，但仍以 `definition/` 生成当前模型，脚本只作为 Agent evidence/候选变更。
6. Data Agent 当前 `ConnectionRegistry.sync_ktx_project()` 会保留非宿主管理的 `ktx.yaml` connection，因此 MVP 不增加第二份配置存储。

## 6. 运行流程

### 6.1 Acquisition 与 detect

1. Public Ingest 先执行 database target，再执行 Power BI context source，使目标 manifest 先可用。
2. `PowerBiSourceAdapter.fetch()` 将 `source_dir` 中的 definition `.tmdl` 文件复制到隔离 staging；仅在 `include_tmdl_scripts: true` 时追加同级 `TMDLScripts/`。
3. `detect()` 递归确认至少一个 `.tmdl`，并确认项目包含 table/calculatedTable 声明。
4. 找不到 `.tmdl`、发现输入是 `.pbix`、目标 connection 非数据库或路径越界时立即失败。

### 6.2 完整项目解析

`TmdlProjectExtractor` 一次读取 staging 中全部 `.tmdl` 文件：

```text
files
  -> 行预处理（BOM、换行、缩进、位置）
  -> TMDL 最小结构解析
  -> 按 object type + name 合并 ref/body
  -> 提取模型字段
  -> 建立 table/column/measure symbol table
  -> 提取 definition functions
  -> 可选提取 TMDL script functions/measures
  -> 分析每个 DAX
  -> 输出 PowerBiModelIR
```

不得先按文件独立生成 WorkUnit。`model.tmdl`、`relationships.tmdl` 和 table 文件共同组成一个模型；先按文件切块会丢失跨文件关系和引用。

### 6.3 Chunk

- 完整模型解析后，每张普通 table 一个 WorkUnit；没有 measure 的维表也要进入模型和关系上下文。
- 当前 table 文件为 `rawFiles`；共享 model/relationship/role 文件和被引用表文件为 `dependencyPaths`。
- WorkUnit 带当前表 IR、全局 symbol index、definition functions，以及与当前表有候选引用关系的 script measures/functions；不把无关表的完整 DAX 全部塞入提示词。
- `ref table` 的 script measure 不自动变成模型表或物理 YAML；声明表、候选引用和原始 DAX 一并交给 Agent 判断。
- table 文件变化只重跑对应表及依赖它的 measure WorkUnit。
- relationship/model/role 文件变化重跑受影响表；无法精确判定时重跑全部表，优先正确而不是构建复杂增量图。
- 删除 table 文件生成 eviction candidate，并继续受现有 ownership/content-hash gate 保护。
- 单文件 TMDL 仍按解析后的 table 切块，而不是把整个文件当作一个不可分单元。

### 6.4 LLM 投影

每个 WorkUnit 的 LLM 输入包括：

- 当前表的原始 TMDL；
- 当前表的结构化 IR；
- model-level function IR；
- 可选 script measure/function evidence；
- 当前 measure 的原始 DAX；
- DAX 引用的 measure、table、column 和函数摘要；
- 必要的传递 measure 定义；
- active relationship 子图；
- 目标 warehouse 的 `sl_discover/entity_details` 结果；
- 目标数据库 dialect；
- 现有 `sl_capture`、provenance 和 validation 规则。

Agent 写入后仍经过三层门禁：每次写入后的 `sl_validate`、隔离 patch 集成校验，以及 Power BI adapter 的最终全目标连接审计。重复的完全相同 YAML collection entry 在写入边界去重；同名但内容不同的 column/measure/join/segment fail-closed，不按 Agent 顺序猜选。

LLM 通过现有受约束工具写 YAML，不能直接写最终文件。复杂 DAX 的转换结果必须进入 `semantic-layer/<target_connection_id>/`，随后经过 `sl_validate`；WorkUnit 失败时由现有 isolated-diff 回滚。

## 7. 自研模块设计

自研实现全部位于 TypeScript CLI，不新增 Python 或 Rust 组件。

```text
packages/cli/src/context/ingest/adapters/powerbi/
  powerbi.adapter.ts   # SourceAdapter 生命周期编排
  config.ts            # powerbi connection/pull config 校验
  tmdl.ts              # TMDL 最小结构解析和模型提取
  dax.ts               # DAX tokenizer、简单子集解析、引用分析和分类
  ir.ts                # PowerBiModelIR 的 Zod schema/type
  chunk.ts             # 按表 WorkUnit、依赖和 diff/eviction
```

如果实现后 `tmdl.ts` 或 `dax.ts` 明显过大，再按职责拆分；不为目录形式预建空模块或只有一个实现的抽象接口。

### 7.1 `powerbi.adapter.ts`

职责：

- 实现 `SourceAdapter` 的 `detect/fetch/listTargetConnectionIds/chunk`；
- 解析并校验 source/target connection；
- 调用 `parseTmdlProject()` 一次；
- 将解析结果传给 `chunkPowerBiModel()`；
- 指定 `powerbi_ingest` skill；
- 不包含具体 TMDL/DAX 语法逻辑。

关键约束：

- `listTargetConnectionIds()` 只返回配置的 `target_connection_id`；
- 不把 `powerbi` source connection 当作可执行 catalog；
- parser 错误必须到达 ingest report，不能返回空模型假装成功。

### 7.2 `config.ts`

职责：

- 用 Zod 校验 `driver/source_dir/target_connection_id`；
- 解析路径并拒绝 `.pbix`、绝对路径逃逸和不存在目录；
- 校验 target 是可执行数据库 driver；
- 提供唯一的规范化配置类型。

不同时支持 `sourceDir`/`source_dir` 或多个目标字段拼写，遵循“一种意图一种表达”。

### 7.3 `tmdl.ts`：最小 TMDL 结构解析器

该模块不是通用 TMDL 引擎，只提取适配器需要的信息。

#### 输入

```typescript
interface TmdlInputFile {
  path: string;
  content: string;
}
```

#### 内部最小节点

```typescript
interface TmdlNode {
  kind: string;
  name: string | null;
  isReference: boolean;
  properties: Map<string, TmdlValue>;
  children: TmdlNode[];
  expression: TmdlExpression | null;
  location: { path: string; line: number; column: number };
}

interface TmdlExpression {
  text: string;
  form: 'inline' | 'indented' | 'backtick';
}
```

#### 必须处理

- BOM、CRLF/LF；
- tab 或固定宽度 space 缩进；
- `table/column/calculatedColumn/measure/relationship/role/partition`；
- `ref` 对象；
- 单引号/双引号名称和转义；
- `:` value property；
- `=` expression property；
- 内联、多行缩进、三反引号表达式；
- `///` description 和普通注释；
- 文件、行、列位置；
- 多文件中同名 ref/body 的合并和冲突检测。

#### 明确不做

- round-trip/export；
- 保留所有未知 passthrough metadata；
- 执行 M expression；
- 解释 annotation/culture JSON；
- 容错修复损坏 TMDL。

未知对象默认忽略并记录 warning；结构错误、同名对象冲突、未闭合引号/反引号块必须失败。

### 7.4 `dax.ts`：DAX 轻量分析器

复杂 DAX 由 LLM 转换，因此该模块只承担四项职责：

1. 安全切分 Token；
2. 检查括号、字符串、注释等基本结构；
3. 提取 function/table/column/measure 引用；
4. 识别可确定性转换的简单聚合。

#### Token 范围

```text
identifier              SUM、CALCULATE、VAR、RETURN
quoted table            'Sales Table'
bracket reference       [Amount]、[Total Sales]
number/string/boolean   1、1.5、"Paid"、TRUE
punctuation             ( ) { } , ; .
operator                + - * / ^ & = == <> < <= > >= && || IN
comment                 --、//、/* ... */
```

每个 Token 保留 `start/end` span，错误能回到原始 DAX 位置。

#### 最小 AST

只为确定性子集创建最小 AST：

```typescript
type SimpleDaxNode =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'table'; name: string }
  | { kind: 'column'; table: string | null; name: string }
  | { kind: 'measure'; name: string }
  | { kind: 'call'; name: string; args: SimpleDaxNode[] };
```

不为复杂 `CALCULATE`、iterator、time intelligence 或 filter context 实现完整 AST。轻量 parser 不能识别为简单子集时，保留 Token 摘要和原始 DAX，状态设为 `llm_required`，而不是报语法失败。

#### Symbol resolution

`[Name]` 可能是 measure 或当前表 column。解析顺序固定为：

1. 显式 `Table[Column]` 按 table/column symbol 校验；
2. 无表名前缀的 `[Name]` 优先匹配全局 measure；
3. 若不存在同名 measure，再匹配当前表 column；
4. 同时存在且语义不唯一时标记 `ambiguous_reference`，交给 LLM 前必须补充上下文或降级；
5. 未解析引用不得静默丢弃。

#### 分析结果

```typescript
interface DaxAnalysis {
  status: 'simple_native' | 'llm_required' | 'invalid';
  raw: string;
  functions: string[];
  measureRefs: string[];
  columnRefs: Array<{ table: string | null; column: string }>;
  native?: {
    aggregation: 'sum' | 'avg' | 'min' | 'max' | 'median' | 'count' | 'count_distinct';
    table: string;
    column: string | null;
  };
  diagnostics: Array<{
    code: string;
    message: string;
    start: number;
    end: number;
  }>;
}
```

分类规则：

- `simple_native`：完整表达式精确匹配白名单结构；
- `llm_required`：结构可读取但不是简单白名单，包括复杂 DAX；
- `invalid`：未闭合字符串/括号、非法 Token 或明显损坏表达式。

不得使用“置信度百分比”。状态必须表达明确的处理决策。

### 7.5 `ir.ts`：KTX-owned Power BI IR

IR 是 parser、chunk 和 LLM prompt 之间唯一的数据契约：

```json
{
  "schemaVersion": 1,
  "models": [
    {
      "name": "Sales",
      "kind": "table",
      "sourceFile": "tables/Sales.tmdl",
      "description": "Sales fact table",
      "primaryKeyCandidates": ["SalesKey"],
      "partitionExpressions": ["let ..."],
      "columns": [
        {
          "name": "Amount",
          "sourceColumn": "Amount",
          "type": "number",
          "hidden": false,
          "language": "unknown",
          "dax": null
        }
      ],
      "measures": [
        {
          "name": "Total Sales",
          "language": "dax",
          "dax": "SUM(Sales[Amount])",
          "analysis": {
            "status": "simple_native",
            "native": {
              "aggregation": "sum",
              "table": "Sales",
              "column": "Amount"
            }
          }
        },
        {
          "name": "Sales LY",
          "dax": "CALCULATE([Total Sales], SAMEPERIODLASTYEAR(Calendar[Date]))",
          "analysis": {
            "status": "llm_required",
            "functions": ["CALCULATE", "SAMEPERIODLASTYEAR"],
            "measureRefs": ["Total Sales"],
            "columnRefs": [{"table": "Calendar", "column": "Date"}]
          }
        }
      ]
    }
  ],
  "relationships": [],
  "security": {"hasRoles": false},
  "warnings": []
}
```

IR 表达式语言约定：

- partition source expression 标记为 `m`；
- measure、calculated column、function、script measure 标记为 `dax`；
- 没有可执行表达式的物理 column 标记为 `unknown`；
- M/DAX 原文仍必须保留，language 只是处理边界，不代表已经完成 SQL 转换。

IR 原则：

- 原始 DAX 必须保留；
- logical table 和 physical table candidate 分开；
- warning/diagnostic 保留 source location；
- 不复制完整 TMDL passthrough metadata；
- 用 Zod 在 parser 输出和消费边界校验；
- `schemaVersion` 只在真实不兼容变更时递增。

### 7.6 `chunk.ts`

职责：

- 按解析后的 semantic table 创建 WorkUnit；
- 根据 DAX 引用生成 measure dependency graph；
- 为当前表附带传递依赖定义和 relationship 子图；
- 将共享文件放入 `dependencyPaths`；
- 根据 `DiffSet` 计算 affected WorkUnit 和 eviction；
- 生成稳定 `unitKey`，不依赖遍历顺序。

循环 measure dependency 不在 chunk 阶段展开；整个循环组一并提供给 LLM并标记 `cyclic_measure_dependency`。若 LLM 无法将其转为无环 **ktx** 表达式，则降级。

## 8. DAX 到 **ktx** YAML 的转换规则

### 8.1 简单 DAX：确定性映射

| DAX | **ktx** YAML |
| --- | --- |
| `SUM(Sales[Amount])` | `expr: sum(amount)` |
| `AVERAGE(Sales[Amount])` | `expr: avg(amount)` |
| `COUNT(Sales[Id])` | `expr: count(id)` |
| `COUNTROWS(Sales)` | `expr: count(*)` |
| `DISTINCTCOUNT(Sales[CustomerId])` | `expr: count(distinct customer_id)` |
| `MIN/MAX/MEDIAN` 同表单列 | 对应 `min/max/median(column)` |

只有在 table/column 引用完整解析并通过目标 manifest 验证时才直接采用。确定性结果不再交给 LLM 重译，但 LLM负责将它与当前表其他内容一起写入 YAML。

### 8.2 复杂 DAX：由 LLM 转换

下列表达式统一进入 `llm_required`，由 LLM结合模型上下文转换为 **ktx** YAML：

- measure 之间的派生算术；
- `DIVIDE`、`IF`、`SWITCH`；
- `VAR ... RETURN`；
- `CALCULATE` 和 filter 参数；
- `SUMX/AVERAGEX` 等 iterator；
- time intelligence；
- 跨表 measure/column 引用；
- 其他非简单聚合函数。

LLM 转换优先级：

1. 优先生成 `measures[].expr/filter`；
2. 需要派生列时生成 `columns[].expr`；
3. 只有目标 **ktx** 表达能力不足、且能证明 row grain 不变时，才生成 standalone `sql:` source；
4. 无法保持 DAX filter context、relationship 或时间语义时，调用 `emit_unmapped_fallback`。

LLM 不是字符串替换器。它必须：

1. 读取原始 DAX和引用摘要；
2. 解析依赖 measure 的语义；
3. 检查 active relationship 和目标表 grain；
4. 验证所有物理表、列和 join key；
5. 按目标数据库 dialect 生成表达式；
6. 通过 `sl_validate`；
7. 对 E2E fixture 中的代表性复杂公式执行查询并与预期结果比较。

### 8.3 不可发布条件

复杂 DAX 交给 LLM不代表无条件发布。以下情况必须降级：

- DAX 分析状态为 `invalid`；
- 引用的表、列或 measure 无法解析；
- 依赖 inactive relationship，但 **ktx** 无法表达 measure-specific relationship；
- many-to-many/bidirectional filter 无法证明等价；
- calculated table 或 virtual table 无法保持稳定 grain；
- 依赖 RLS/OLS、calculation group 或 field parameter；
- LLM 输出无法通过 YAML schema、`sl_validate` 或查询验证；
- LLM只能给出近似语义而不能说明等价转换。

降级时保留原始 DAX、引用、函数摘要和失败原因到 evidence，并调用 `emit_unmapped_fallback`。

### 8.4 目标 YAML 示例

```yaml
name: sales
descriptions:
  user: "Power BI logical table: Sales. Physical table verified from the target warehouse."
table: dbo.Sales
grain: [sales_key]
columns:
  - name: sales_key
    type: number
    expr: SalesKey
  - name: product_key
    type: number
    expr: ProductKey
  - name: amount
    type: number
    expr: Amount
  - name: order_date
    type: time
    role: time
    expr: OrderDate
joins:
  - to: products
    "on": product_key = products.product_key
    relationship: many_to_one
measures:
  - name: total_sales
    expr: sum(amount)
    description: "Power BI measure: Total Sales"
  - name: margin_rate
    expr: "gross_margin / nullif(total_sales, 0)"
    description: "Converted from Power BI DAX by the Power BI ingest workflow."
```

## 9. 物理表、关系与安全边界

### 9.1 物理表解析

Power BI table 名不是数据库表名。解析优先级固定为：

1. partition M 中的明确 schema/item 候选；
2. 显式配置映射（后续真实需求出现时再加入 schema，不在 MVP 预建）；
3. 目标 manifest 中的完全匹配；
4. `entity_details`/只读 `SELECT 1 ... LIMIT 0` 验证；
5. 无法唯一确认则不写 executable source。

禁止仅按字符串相似度自动选表。自研模块只保存 partition 原文并提取少量已知简单形态，不开发通用 M parser。

### 9.2 关系

- 只直接写 active 的 `many_to_one/one_to_many/one_to_one`；
- from/to key 必须存在于已验证列；
- inactive、many-to-many、bidirectional 进入 LLM上下文，但只有能通过明确等价建模时才发布；
- 关系缺失不影响完全同表的简单 measure；受影响的跨表复杂 measure 必须降级。

### 9.3 RLS/OLS

**ktx** 当前查询直接访问数据库，不会自动执行 Power BI 的 RLS/OLS。若项目存在 role/table permission/object permission：

- MVP 默认 fail closed，不发布该 Power BI source 的可执行 overlay；
- 报告错误码 `powerbi_security_policy_unsupported`；
- 不允许仅记录 warning 后继续查询。

## 10. Catalog 归属修正

当前 Semantic Context 把“需要 ingest 的 connection”和“承载可执行 YAML 的 connection”混在同一个集合中。Power BI source 必须投影到目标 warehouse，否则 `sl_query` 会尝试用 `powerbi` driver 执行 SQL。

最小修正：

```text
semanticIngestConnectionIds
  = database connections + context-source connections

semanticCatalogConnectionIds
  = database connections（可由 native connector 执行）
```

用途：

- `sl_ingest` 使用 `semanticIngestConnectionIds`；
- `sl_discover/sl_validate/catalogSnapshot/sl_query` 使用 `semanticCatalogConnectionIds`；
- Power BI ingest report 参与本轮 ingest 状态；
- Power BI 产物写入 `semantic-layer/<target_connection_id>/`；
- 刷新失败时目标 warehouse 的 last-known-good snapshot 继续可查询。

不增加 catalog alias、虚拟 connector 或查询转发层。

## 11. 预计代码变更

### 11.1 **ktx**

```text
packages/cli/src/context/project/driver-schemas.ts
packages/cli/src/context/ingest/types.ts                    # 仅在 target context 确有需要时最小扩展
packages/cli/src/context/ingest/adapters/powerbi/
  powerbi.adapter.ts
  config.ts
  tmdl.ts
  dax.ts
  ir.ts
  chunk.ts
packages/cli/src/context/ingest/local-adapters.ts
packages/cli/src/public-ingest.ts
packages/cli/src/semantic-context/application.ts
packages/cli/src/skills/powerbi_ingest/SKILL.md

packages/cli/test/context/ingest/adapters/powerbi/
  tmdl.test.ts
  dax.test.ts
  chunk.test.ts
  powerbi.adapter.test.ts
packages/cli/test/public-ingest.test.ts
packages/cli/test/semantic-context/application.test.ts
```

本方案不修改：

```text
python/ktx-daemon/
python/ktx-sl/                        # 除非 E2E 暴露现有 schema/compiler 的真实缺陷
scripts/build-python-runtime-wheel.mjs
uv.lock                              # 不新增 Python 依赖
```

### 11.2 Data Agent

MVP 不增加 Python 服务、MCP、状态表或前端页面。只需：

```text
tests/test_connection_registry.py    # powerbi unmanaged config 不被同步覆盖
docs/                                # 用户配置和支持边界
安装态 smoke                         # 使用打包后的 ktx CLI 解析 TMDL
```

## 12. 实施阶段

### P0：独立规格与 fixture

- [ ] 根据 Microsoft 官方文档写出最小 TMDL/DAX 支持清单；
- [ ] 从 Power BI Desktop 导出脱敏 fixture；
- [ ] 固定 IR schema 和 diagnostic code；
- [ ] 增加依赖检查，确认无 `sidemantic`/`sidemantic-dax`；
- [ ] 确认复杂 DAX 的 LLM 输入/输出契约。

退出门禁：fixture 覆盖 table、column、measure、多行 DAX、relationship、role；设计不依赖第三方 AGPL 代码或制品。

### P1：TMDL 提取器

- [ ] 实现行预处理、缩进和 source location；
- [ ] 实现对象、属性、quoted name、inline/indented/backtick expression；
- [ ] 合并完整项目的 ref/body；
- [ ] 提取模型、关系、partition 和 security 信号；
- [ ] 用 Zod 校验 PowerBiModelIR；
- [ ] 覆盖结构错误、冲突、未知对象和空项目测试。

退出门禁：完整 fixture 一次解析为稳定 IR，原始 DAX 和位置不丢失。

### P2：DAX 轻量分析器

- [ ] 实现 tokenizer、comment/string/quoted identifier/span；
- [ ] 实现括号和基本结构检查；
- [ ] 实现 table/column/measure/function 引用提取；
- [ ] 实现 symbol resolution 和 ambiguity diagnostic；
- [ ] 实现简单聚合子集 parser；
- [ ] 将其余合法复杂表达式分类为 `llm_required`；
- [ ] 增加深度、长度和 token 数量上限，避免恶意输入耗尽资源。

退出门禁：简单聚合稳定映射；复杂 `CALCULATE/VAR/time intelligence` 保留原文和引用并进入 `llm_required`，不被误报为 native。

### P3：SourceAdapter 与 LLM skill

- [ ] 增加 `powerbi` driver schema；
- [ ] 实现 detect、fetch、完整模型解析、按表 chunk、diff 和 eviction；
- [ ] 注册 default adapter 和 Public Ingest；
- [ ] 增加 `powerbi_ingest` skill；
- [ ] 为复杂 DAX提供必要的依赖定义和关系子图；
- [ ] 强制 target connection、manifest 验证和失败降级；
- [ ] 复用 ownership/provenance/rollback，不增加 Power BI 状态库。

退出门禁：fixture 可生成稳定 WorkUnit；LLM 能把至少一个复杂 DAX 转换为目标 warehouse 下的合法 YAML。

### P4：Catalog、E2E 与文档

- [ ] 拆分 ingest connection 与 executable catalog connection；
- [ ] 数据库 scan 在 Power BI ingest 前完成；
- [ ] 跑通 SQLite fixture：`sl_ingest -> sl_validate -> sl_query`；
- [ ] 复杂 DAX 查询结果与手写基准 SQL 对比；
- [ ] 验证 unchanged、删除、未知物理表、invalid DAX、RLS fail-closed；
- [ ] 增加真实配置 LLM 的 opt-in E2E，不能只用 fake LLM 声明完成；
- [ ] 完成 Electron unpacked/安装态、无系统 Python、无网络首启 smoke；
- [ ] 更新 **ktx** integration docs 和 Data Agent 配置说明。

退出门禁：同一 Semantic MCP 实例查询 Power BI 导入的简单和复杂 measure，得到预期数据库结果。

## 13. 测试矩阵

| 层 | 必测项 |
| --- | --- |
| TMDL | definition folder、单文件、quoted name、CRLF、tab/space、多行/backtick DAX、类型、key、relationship、role、warning location |
| DAX tokenizer | string escape、quoted table、bracket ref、comment、operator、括号、非法输入、深度/长度上限 |
| DAX 分类 | 简单 aggregate、derived arithmetic、`VAR`、`CALCULATE`、iterator、time intelligence、跨表引用、ambiguous ref |
| Adapter | `.tmdl` detect、拒绝 `.tdml/.pbix`、完整模型只解析一次、一表一 WU、shared dependency、diff/eviction |
| LLM | complex DAX 上下文完整、只写 target warehouse、所有标识符已验证、失败调用 unmapped fallback |
| Fail-closed | 无 grain、未知表/列、invalid DAX、无法表达的关系、calculated table、RLS/OLS |
| Ownership | 只更新/删除本 source 拥有的 artifact，人工改动不删除，cross-source conflict 失败 |
| Query | simple measure、complex measure、dimension group、join、dialect、max rows、read-only guard、fanout |
| 产品 | one MCP、no Database MCP、last-known-good、retry、installed offline smoke |
| 依赖 | lock/package manifest 不包含 Sidemantic、Rust DAX crate 或新增 Python parser |

最小 E2E fixture 包含：

- `Sales`、`Products`、`Calendar` 三张 SQLite 表；
- active many-to-one relationship；
- 简单 `SUM`、`DISTINCTCOUNT`；
- 复杂 `DIVIDE`、`VAR ... RETURN`、带过滤的 `CALCULATE`；
- 一个 time-intelligence measure，用于验证 LLM成功转换或明确降级；
- 查询 `total_sales` 按 product category 分组并断言精确结果；
- fanout 回归：**ktx** 结果等于手写基准 SQL，事实值不因 join 重复放大。

## 14. 复杂性预算

本方案最多新增：

- 1 个 `PowerBiSourceAdapter`；
- 1 个最小 TMDL 模块；
- 1 个 DAX 轻量分析模块；
- 1 个稳定 Power BI IR；
- 1 个 `powerbi_ingest` skill；
- 1 个 `powerbi` connection schema。

明确禁止：

1. 新 MCP、新端口、新 sidecar、新 job database；
2. Python/Rust parser bridge；
3. Power BI API client；
4. 第二套 semantic YAML schema；
5. 完整 DAX evaluator/compiler；
6. 用正则直接解释多行 TMDL 或复杂 DAX 结构；
7. LLM直接写文件或绕过 `sl_validate`；
8. parser 失败后静默把所有原文交给 LLM继续发布；
9. 为只有一个实现的模块预建 interface/port 抽象。

## 15. 主要风险

| 风险 | 处理 |
| --- | --- |
| 自研 TMDL 子集遗漏真实语法 | 官方 fixture + Power BI Desktop 导出 fixture；未知结构显式 warning/fail，不猜测 |
| DAX tokenizer 将引用识别错误 | symbol table、span diagnostic、quoted/bracket 单测；未解析引用禁止发布 |
| LLM复杂 DAX转换语义偏差 | 提供依赖和关系上下文；物理验证；代表性公式与基准 SQL 比对；无法证明则降级 |
| DAX filter context 与 SQL 不等价 | Skill 明确语义检查顺序；禁止仅按函数名字符串替换 |
| Power BI 逻辑表名不等于物理表 | partition 仅作候选，必须对目标 manifest/数据库验证 |
| RLS 被直接数据库查询绕过 | 检测 security policy 后禁止发布 executable overlay |
| 增量依赖图过度复杂 | 共享文件变化可重跑全部表；先保证正确，不做精细缓存 |
| 自研范围膨胀为完整 parser | 坚持简单 native + complex LLM；新增语法只有真实 fixture 和用例驱动 |

## 16. Definition of Done

- [ ] 只接受标准 `.tmdl`；
- [ ] 运行时、构建和锁文件均不依赖 Sidemantic；
- [ ] 自研 TMDL 模块完整提取 table/column/measure/relationship/security；
- [ ] 自研 DAX 模块能区分 `simple_native/llm_required/invalid`；
- [ ] 原始复杂 DAX、引用和 source location 不丢失；
- [ ] 复杂 DAX 由现有 Ingest LLM 转换为 **ktx** YAML；
- [ ] Power BI source 只向明确的 target warehouse 写 YAML；
- [ ] 物理表、列、grain、join 全部经过 manifest/数据库验证；
- [ ] 无法验证的复杂 DAX 和 RLS/OLS fail closed；
- [ ] unchanged 不改写，删除受 ownership/content-hash 保护；
- [ ] 同一 MCP 完成 `sl_ingest -> sl_validate -> sl_query`；
- [ ] 简单和复杂 measure 的 E2E 查询结果符合基准；
- [ ] 真实 LLM opt-in E2E 和安装态离线 smoke 通过；
- [ ] 没有新增服务、端口、状态库、Python/Rust 依赖或用户侧运行时要求。

## 17. 参考资料

- [Power BI Desktop project semantic model folder](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset)
- [Microsoft TMDL overview](https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview?view=sql-analysis-services-2025)
- [Microsoft DAX syntax reference](https://learn.microsoft.com/en-us/dax/dax-syntax-reference)
- [Microsoft DAX operator reference](https://learn.microsoft.com/en-us/dax/dax-operator-reference)
- [Microsoft DAX function reference](https://learn.microsoft.com/en-us/dax/dax-function-reference)
- [Sidemantic repository](https://github.com/sidequery/sidemantic)（仅作为前期架构调研参考，不作为实现依赖或代码来源）
- `D:\data_agent\ktx\ktx_project_analysis.md`
- `D:\data_agent\docs\ktx_semantic_context_component_development_plan_v2.md`
