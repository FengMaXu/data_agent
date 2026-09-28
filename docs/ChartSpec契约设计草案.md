# ChartSpec 契约设计草案

状态：草案，对应 ADR-0008“实施与验证”第 1 步。本文给出 ChartSpec 的结构、字段语义与校验规则，并记录 ADR 要求的图种推演结论。类型以 TypeScript 表达便于阅读，落地时改写为 `packages/contracts` 中的 typebox schema。

## 1. 推演得出的三条结构性结论

先给结论，因为它们决定了后面的全部结构。

**结论一：数据永远是一张平表，非平表结构用角色通道表达。** 查询结果本身就是平表。层级（树图、旭日图）用 `path` 通道或 `id`/`parent` 通道描述，网络（桑基图）用 `source`/`target`/`value` 通道描述，统计摘要（箱线图）用 `low`/`q1`/`median`/`q3`/`high` 通道描述。契约只需要一种数据形态，扩展图种只是新增通道。

**结论二：ADR 决策 2 需要收紧为“编译器只显示数据集中存在的数值”。** 推演发现，“不聚合”不足以覆盖所有情况：堆叠柱图、饼图、树图、桑基图都会在视觉上求和（堆叠高度、扇区角度、父节点面积、节点流量）。这类“部分与整体”的派生是图种本身的含义，不能禁止，但必须满足两个前提：

- 度量必须声明为可加（`additivity: "additive"`），比率、均值、单价等不可加度量不能堆叠、不能画饼、不能作树图面积；
- 参与构成的集合必须完整，不能与 Top-N 等数据选择同时使用，也不能包含负值。

除此之外，编译器显示的每一个数（坐标、标签、tooltip）都必须能在数据集中找到对应单元格。累计值、区间端点、统计量一律由查询提供。

**结论三：数值语义必须挂在字段上，而当前发布记录没有这一层。** `PublicationReceipt` 以 `receiptId` 与 `contentHash` 提供了不可变的数据身份，满足 ADR 决策 4；但 `ResultCandidateRecord.resultSchema` 只有列名，没有类型、尺度、单位和可加性。第 4 节给出首期的处理办法。

## 2. 顶层结构

```ts
type ChartSpec = {
  version: 1;
  title?: string;
  subtitle?: string;
  data: DatasetRef;
  fields?: Record<string, FieldMeta>;   // 只补充数据集元数据缺失的字段，见第 4 节
  chart: Mark;                          // 按 mark 区分的联合类型
  selection?: Selection;                // 数据选择，见第 6 节
  viewport?: Viewport;                  // 仅交互目标生效，见第 6 节
};

type DatasetRef =
  | { kind: "publication"; receiptId: string }   // 已发布查询结果
  | { kind: "derived"; derivedId: string };      // Python 等派生数据，Runtime 记录其输入引用与计算来源
```

`data` 只是引用。Runtime 解析引用、检查交付资格、读取不可变内容，再把数据交给编译器。模型不直接提供 rows。看板的实时数据绑定不在本草案范围内（ADR 实施第 4 步另立 ADR）。

## 3. 图种与通道

通道命名沿用 Vega-Lite/Flint 的 `x`、`y`、`color`、`size`，便于模型迁移已有知识；与二者不同的是，通道上**没有** `aggregate`、`bin`、`timeUnit` 等变换参数；唯一的派生是 `stack`，受结论二约束。

```ts
type FieldRef = { field: string };
type PositionRef = FieldRef & { axis?: "left" | "right" };   // 双轴，仅 y 系

type Mark =
  // ── 首期实现 ─────────────────────────────
  | { mark: "cartesian";                 // bar / line / scatter 及其组合，共享 x 轴
      x: FieldRef;
      layers: Layer[];                   // 至少一层；混合 mark 与双轴由多层表达
      orientation?: "vertical" | "horizontal"; }
  | { mark: "pie"; category: FieldRef; value: FieldRef; donut?: boolean }
  // ── 推演用，首期不实现 ───────────────────
  | { mark: "heatmap"; x: FieldRef; y: FieldRef; color: FieldRef & { midpoint?: number } }
  | { mark: "boxplot"; category: FieldRef; low: FieldRef; q1: FieldRef; median: FieldRef; q3: FieldRef; high: FieldRef; definition: string }
  | { mark: "histogram"; start: FieldRef; end: FieldRef; y: FieldRef }
  | { mark: "waterfall"; category: FieldRef; start: FieldRef; end: FieldRef; kind?: FieldRef }
  | { mark: "treemap"; path: FieldRef[]; value: FieldRef }
  | { mark: "sankey"; source: FieldRef; target: FieldRef; value: FieldRef };

type Layer = {
  type: "bar" | "line" | "scatter";
  y: PositionRef;
  series?: FieldRef & { order?: string[]; colors?: Record<string, string> };  // 长表按字段分系列
  id?: FieldRef;                         // scatter 的观测身份，允许坐标重复
  size?: FieldRef;                       // scatter 气泡
  label?: FieldRef;
  stack?: "none" | "stacked" | "percent";  // 仅 bar/line；非 none 时须满足结论二
  name?: string;                         // 图例名，默认取字段显示名
};
```

设计取舍：

- **bar、line、scatter 合并为 `cartesian`。** v3 的混合 mark 与双轴本质上是“共享 x 轴的多层”，用 `layers` 表达比三个独立 mark 更少出现组合特例。
- **不支持按行过滤的系列。** v3 的 `series[].where` 在编译器里筛行，属于数据选择。新契约用两种方式替代：长表用 `series` 通道按字段拆系列；需要“2024 年画柱、2025 年画线”时，由查询返回宽表，各层引用不同列。
- **`stack: "percent"` 与饼图同类。** 两者都派生占比，适用结论二的全部前提。

## 4. 字段语义

```ts
type FieldMeta =
  | { type: "quantitative";
      label?: string;
      storage: "raw" | "ratio" | "percent";      // 数据里 0.12 的含义
      display?: "raw" | "percent";                 // 缺省按 storage 推导：ratio→percent
      unit?: string;                               // "CNY"、"kg"、"次"
      magnitude?: { stored: Magnitude; shown?: Magnitude };  // 元/万元/亿元
      additivity: "additive" | "non_additive"; }
  | { type: "temporal"; label?: string; grain: "year" | "quarter" | "month" | "week" | "day" | "hour" | "minute"; zone: "floating" | string }
  | { type: "ordinal"; label?: string; order: string[] }
  | { type: "nominal"; label?: string };

type Magnitude = 1 | 1e3 | 1e4 | 1e6 | 1e8;
```

- **没有缺省尺度。** `storage` 与 `additivity` 必填。编译器不按数值大小推断百分比，也不按列名推断可加性。
- **`zone: "floating"`** 表示不带时区的日历值（如 `2026-09`），浏览器与 Node 渲染结果一致；带时区的时间戳须给出 IANA 时区名。这是 ADR 验收“日期不因时区偏移”的落点。
- **允许的换算只有显示层换算：** ratio→percent 乘 100、元→万元除以 1e4。编译器不做任何业务指标计算。
- **空值** 不在 FieldMeta 里配置，规则固定：空值永不转为零；折线在空值处断开；柱图该位置留空；两者都产生一条布局类展示提示。
- **来自 Flint 的借鉴：** 热力图的 `midpoint` 沿用 Flint `divergingMidpoint` 的思路，即发散中点是对比问题的判断，必须声明而不能推断。Flint 的 `aggregationDefault`、`binningSuggested` 不引入，因为它们属于变换。

**字段语义从哪里来。** 按证据权威从高到低取值：

1. 语义模型或已审定业务定义中对该字段的声明；
2. 发布记录上的字段元数据（当前不存在，见下）；
3. ChartSpec 内联的 `fields`（模型声明）。

首期发布记录没有字段元数据，所以实际只有第 3 项可用。模型声明按 CONTEXT.md 的证据权威属于“模型推断”，因此：

- Runtime 记录每个字段语义的来源；来源为模型声明时，随图表交付一条提示；
- Runtime 可以做结构一致性检测，例如声明 `storage: "ratio"` 而多数值绝对值大于 1、声明 `additive` 而列名命中“率/均/占比”，按 ADR-0003 告知而不阻断，也不改写声明。

长期方案是在发布时生成字段元数据并挂在发布记录上，由 Query Digest 的输出列谱系提供可加性等信息。这需要改动 answering 模块，应作为单独议题。

## 5. 校验规则

| 代码 | 触发条件 | 适用 |
| --- | --- | --- |
| `FIELD_NOT_FOUND` | 通道引用的列不在数据集中 | 全部 |
| `SEMANTICS_MISSING` | 被引用的度量字段缺少 `storage` 或 `additivity` | 全部 |
| `SEMANTICS_CONFLICT` | 多个来源对同一字段给出不同语义且无更高权威来源 | 全部 |
| `DUPLICATE_KEY` | cartesian 中同一层、同一 x、同一系列有多行（scatter 且声明了 `id` 时除外）；heatmap 同一 (x, y) 有多行；pie 同一类别有多行 | 按图种 |
| `NON_ADDITIVE_PART_OF_WHOLE` | 不可加度量用于 pie、treemap、sankey 或 `stack` 非 none | 部分与整体 |
| `NEGATIVE_IN_PART_OF_WHOLE` | 部分与整体图种出现负值 | 部分与整体 |
| `INCOMPLETE_PART_OF_WHOLE` | 部分与整体图种同时声明了 `selection` | 部分与整体 |
| `STAT_ORDER_VIOLATION` | 箱线图某行不满足 low ≤ q1 ≤ median ≤ q3 ≤ high | boxplot |
| `BIN_OVERLAP` | 直方图区间重叠（区间之间的空隙允许，按空白显示） | histogram |
| `RANGE_INCONSISTENT` | 瀑布图相邻步骤的 `end` 与下一步 `start` 不衔接 | waterfall |
| `FLOW_CYCLE` | 桑基图存在环 | sankey |
| `CAPACITY_EXCEEDED` | 静态目标在给定尺寸下无法完整呈现，且未声明 `selection` | 静态目标 |

所有错误都以结构化形式返回给模型，附带字段名与可选修正方向（例如 `CAPACITY_EXCEEDED` 建议加大尺寸、改为横向柱图或声明 Top-N）。编译器不自动修复。

## 6. 数据选择与视口

```ts
type Selection = { kind: "top_n"; by: string; n: number; order: "desc" | "asc" };
type Viewport = { mode: "scroll" | "zoom"; window: number };
```

- `selection` 是 ADR 决策 6 中唯一允许的数据选择入口。它只能省略行，不能生成“其他”行；需要“其他”时由查询返回该行。与部分与整体图种互斥（`INCOMPLETE_PART_OF_WHOLE`）。编译器随图交付提示“显示前 N 项，共 M 项”及完整数据的获取方式。
- `viewport` 只在交互目标生效，不改变数据，编译器随图提示当前可见范围。静态目标忽略 `viewport`；放不下时按 `CAPACITY_EXCEEDED` 处理，不裁剪。

## 7. 推演结论汇总

| 图种 | 表达方式 | 契约影响 | 结论 |
| --- | --- | --- | --- |
| 热力图 | `x`、`y` 两个类别通道加 `color` 度量通道；缺格按空白 | `color.midpoint` 须声明；`DUPLICATE_KEY` 以 (x, y) 为键 | 相容 |
| 箱线图 | 五个统计角色通道，统计量由查询算好 | 新增 `definition` 必填，说明须线口径（极值或 1.5 IQR），随图交付 | 相容 |
| 直方图 | 查询返回 `bin_start`、`bin_end`、计数，spec 用 `start`/`end` 区间通道 | 分箱不进 spec，与决策 2 相容 | 相容 |
| 桑基图 | 边表：`source`、`target`、`value` | 节点流量是视觉求和，适用结论二；需环检测 | 相容，依赖结论二 |
| 树图 | 叶子行加 `path` 字段序列 | 父节点面积是视觉求和，适用结论二；只接受叶子行，避免父子值不一致 | 相容，依赖结论二 |
| 瀑布图 | 查询返回每步 `start`、`end`，可选 `kind` 标记合计行 | 累计值不由编译器计算 | 相容 |

推演没有发现需要第二种数据形态的图种，也没有发现需要在编译器内做变换的图种。唯一需要回写 ADR 的是结论二：决策 2 的“不得隐式合并观测”应补充“部分与整体图种的视觉求和须满足可加、完整、非负三项前提”。

## 8. v3 表达能力保留情况

| v3 能力 | 新契约 | 迁移方式 |
| --- | --- | --- |
| line、bar、scatter 单系列 | `cartesian` 单层 | 自动迁移 |
| 显式 `series` 多系列（各引用一列） | 多层 | 自动迁移 |
| `series_by` 分组，含 `order`、`colors` | 层上的 `series` 通道 | 自动迁移 |
| 混合 mark | 多层不同 `type` | 自动迁移 |
| 多 y 轴（`axes` + `series[].axis`） | 层上的 `y.axis` | 两轴以内自动迁移，超过两轴返回不支持说明 |
| `series[].where` 行过滤 | 不支持 | 返回结构化说明：需改为宽表查询 |
| 旧路径 `aggregate` | 不支持，聚合移入查询 | 返回结构化说明；原图只读保留 |
| pie | `pie` | 自动迁移；数据含负值或度量不可加时返回说明 |
| kpi、table、metric_cards | 不属于 ChartSpec | 由看板规格的 KPI、Table 视图承接，共用 FieldMeta |
| 所有字段语义 | v3 无 | 迁移时标注来源为“迁移推断”，随图交付提示 |

## 9. 未决问题

1. **字段元数据挂在发布记录上**：需要 answering 模块在发布时产出字段语义，并确定与 Query Digest 输出谱系的关系。建议单独立 issue。
2. **Table 与 KPI 共用 FieldMeta**：`WidgetRenderer` 表格的百分比推断应改用同一套字段语义；这会把 FieldMeta 的使用范围扩展到图表之外，放在 contracts 中的位置需要与看板规格一起确定。
3. **颜色覆盖**：`series.colors` 允许按值指定颜色，是否应改为只允许引用主题中的语义色（如“正向”“负向”），以免模型写出不可访问的配色。
4. **ADR 回写**：结论二是否在 ADR-0008 接受前并入决策 2。
