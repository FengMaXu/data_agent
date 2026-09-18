# Power BI TMDL Adapter 模块级开发日志

> 对应设计方案：`docs/power_bi_tmdl_adapter_design_and_plan.md`
>
> 本日志只记录 Power BI TMDL 适配器模块的实施事实、决策、验证和未完成项。不得把局部测试、fixture、fake、fallback 或“模块可导入”写成整体完成。

## 2026-08-13：实施前原则与基线

### Decision

1. **禁止“差不多就可以了”**：任何阶段必须通过对应退出门禁并提供可复核证据；不以代码存在、局部 smoke、近似语义或任务状态代替验收。
2. **禁止急于完成任务**：先阅读设计方案、现有 KTX Ingest/Query 契约和当前工作区状态，再按 P0→P4 顺序实施；遇到未确认的接口或语义时先查证，不猜测、不绕过。
3. 只实现 `docs/power_bi_tmdl_adapter_design_and_plan.md` 明确批准的标准 `.tmdl` MVP，不采用旧的 Sidemantic/Python bridge 方案。
4. 保护现有未提交改动；本批只修改 Power BI 适配器及其必要的 KTX 注册、配置、Public Ingest/catalog 边界、测试和文档。

### Implemented

- 在设计方案第 1 节新增两条实施硬性原则。
- 创建本模块级开发日志，作为后续每一批开发、验证和上下文压缩后的恢复入口。
- 完成开发前基线检查：确认 `ktx` 当前已有大量未提交的 Semantic Context V2 改动，后续不得重置或覆盖这些改动。

### Verification

- 已完整阅读 `docs/power_bi_tmdl_adapter_design_and_plan.md`。
- 已检查 `ktx` 当前 SourceAdapter、driver schema、project config、adapter registry、Public Ingest 入口及现有开发日志。
- 已确认当前仓库中不存在 Power BI TMDL 实现；发现并明确排除旧的 `docs/powerbi_adapter_implementation_plan.md` 中 Sidemantic/Python daemon 方案。

### Residual / Risk

- Power BI adapter 尚未实现。
- 现有 `ktx` 工作区包含未提交的其他功能改动；需要继续以最小、可回溯的编辑方式开发。
- 在新增代码前仍需完成现有 Ingest WorkUnit、raw staging/diff、LLM skill、catalog ownership 和 connection driver 的精确接口审计。

### Next exact step

1. 继续读取并记录现有 SourceAdapter 生命周期、WorkUnit 执行上下文、配置/target connection 判定和 semantic catalog 归属实现。
2. 固定 P0 fixture、IR/diagnostic schema 和依赖检查，再开始编写 TMDL 模块。

## 2026-08-14：IR function 与可选 TMDLScripts 层

### Decision

1. `definition/functions.tmdl` 是权威模型定义的一部分，新增 `PowerBiFunctionIR`，不再把 `function` 节点只当 metadata 丢弃。
2. `TMDLScripts/` 是 Power BI TMDL View 保存的脚本目录，不默认并入模型；新增 `include_tmdl_scripts: true` 可选开关。
3. 脚本中的 `ref table` 不创建 phantom model table。脚本 measure 保留声明表、是否为 reference、候选引用表、原始 DAX 和分析结果，交给 Agent 做 evidence-backed 映射。
4. definition 与 script 同名对象内容冲突时不选“最新”或“脚本优先”，生成 `tmdl_script_definition_conflict` warning；Agent/最终门禁不得把冲突表达式直接发布为可执行 YAML。
5. YAML collection 在写入边界执行安全去重：完全相同的重复 column/measure/join/segment/grain entry 去重；同名但内容不同 fail-closed。
6. Power BI adapter 增加最终全目标连接 semantic-layer audit；通用 Stage 4 仍主要负责 context/wiki reconciliation，不将其误写成 YAML semantic dedup。

### Implemented

- `PowerBiModelIR.functions`、`PowerBiModelIR.tmdlScripts` 及 Zod schemas。
- definition function DAX、script function、script measure 提取和 DAX analysis。
- IR expression language markers: partition source `m`; measure/calculated-column/function/script measure `dax`; physical columns `unknown`.
- `include_tmdl_scripts` 配置、definition/TMDLScripts 选择性 staging、override snapshot 对脚本目录的识别。
- WorkUnit notes/dependency paths 传递 model functions 和相关 script measure/function evidence。
- semantic-layer collection normalization、重复项去重和矛盾项拒绝。
- Power BI adapter finalization 接入全目标连接校验。

### Verification

- Power BI adapter tests：15 项通过。
- Semantic-layer normalization tests：2 项通过。
- Contoso optional script parse：6 张模型表保持不变；3 个脚本被解析；`Script 3` 的 `Net Revenue`/`Cost` 进入 Sales WorkUnit evidence。
- Local Contoso YAML ingest：通过；Agent test 明确看到 script evidence，未把 `_measures`/`SUMX` 未验证映射成可执行 YAML。
- TypeScript source/test type-check：通过。
- Combined targeted verification (`powerbi` adapter/local ingest, driver schema, source normalization, existing SL write tests)：5 test files / 49 tests passed。
- Full package test was also sampled but is not a clean gate in this Windows workspace: unrelated existing path-separator assertions, SQLite `EBUSY` cleanup failures, missing benchmark fixture paths, and hook timeouts remain; no Power BI targeted failure was observed.

### Residual / Risk

- 真实 LLM 尚未在带 `TMDLScripts` 的目标 warehouse 上完成完整执行；当前 local E2E 使用确定性 Agent。
- 最终 audit 会 fail-closed，但不会在 Stage 4 后自动改写已提交的 YAML；冲突需要 Agent 修正后重新通过门禁。
- `TMDLScripts` 中函数的 SQL/UDF 执行语义仍不自动生成，只作为 evidence。

