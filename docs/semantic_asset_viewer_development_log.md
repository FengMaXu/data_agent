# 语义资产查看器开发日志

> 对应方案：`docs/semantic_asset_viewer_final_plan.md`
>
> 本日志区分：代码已写、局部测试通过、真实链路通过、产品完成。每次上下文压缩后，先读取本日志和终版计划再继续。

## 当前状态

- 方案版本：V2.3，只读 Semantic Asset Viewer + 可复用业务语义模型
- 当前阶段：V2.3 已完成业务模型重构，真实链路验收中
- 总体状态：V2.3 模型/schema/KTX 查询验证已完成，真实 Electron/FastAPI/KTX 重启后视觉验收仍未完成，不能声明产品完成
- 明确不做：编辑、保存、approve/reject、乐观锁、CodeMirror 编辑器

## 2026-08-16 — 开发启动

### 已检查

- 已完整阅读 `docs/semantic_asset_viewer_final_plan.md`。
- 计划指定的本日志文件此前不存在，已创建。
- 已确认当前后端已有 Host-managed Semantic MCP 生命周期：
  - `src/semantic_startup.py`
  - `src/config_manager.py`
  - `src/mcp/manager.py`
- 已确认 Agent 语义工具白名单为 `sl_discover`、`sl_read_source`、`sl_query`；`sl_ingest`、`sl_ingest_status`、`sl_validate` 不通过 Agent bridge 暴露。
- 已确认现有 `/knowledge/*` API 只访问 `KNOWLEDGE_ROOT`，不能用于语义项目目录。
- 已确认 `frontend/src/components/Sidebar.tsx` 尚无语义资产分组和查看器。
- 已确认 KTX 当前 `sl_discover` 只返回 source 计数，`sl_read_source` 返回 YAML 文本；source status 需要由 Host 根据 Semantic Project 目录和 KTX 返回结果派生，或后续补充 KTX DTO。

### 关键实现决策

1. 新增独立 `/semantic/sources` API，不复用 Knowledge API。
2. 后端在 Host 侧调用已连接的 Semantic MCP；前端不接触绝对路径。
3. 后端使用 `config_manager.semantic_project_dir` 只在 Host 内部派生 `sourceKind`，响应不返回路径。
4. manifest-only 资产的 `rawYaml` 对前端返回空字符串，结构化字段使用 KTX 返回的 resolved YAML 解析。
5. Viewer 为只读；Modal Header 统一承载文件名、sourceKind、模式切换和关闭动作。
6. 前端先完成 DTO、组件和 Sidebar 集成；测试基建若依赖安装则记录实际安装结果，不把“依赖已声明”误记为“测试已通过”。

### 待完成

- [ ] M0：后端/前端 DTO、依赖和白名单断言
- [ ] M1：Semantic API 列表与详情、sourceKind 派生、provenance
- [ ] M2：只读 Viewer 组件及组件测试
- [ ] M3：Sidebar 语义资产分组、弹窗、响应式/主题体验
- [ ] V-01 至 V-12 验收

### 验证记录

- `docs/semantic_asset_viewer_development_log.md`：已创建。
- 其他命令和测试结果将在对应批次追加；未执行的验证不得标记为通过。

## 2026-08-16 — M0/M1/M2/M3 首批实现

### 代码已写

#### 后端

- 新增 `src/api/semantic_api.py`：
  - `GET /semantic/sources`
  - `GET /semantic/sources/{connectionId}/{sourceName}`
  - 通过 `mcp_manager.find_server_by_type("semantic")` 调用 `sl_discover` / `sl_read_source`；
  - 不复用 `/knowledge/*`；
  - Host 内部扫描 `config_manager.semantic_project_dir/semantic-layer/<connectionId>`，派生 `standalone`、`manifest_only`、`manifest_with_overlay`、`standalone_shadows_manifest`、`orphan_overlay`；
  - `manifest_only` 不向前端暴露生成式 YAML，`rawYaml` 返回空字符串；
  - 输出列、指标、分群、关联、标签、默认时间维度及 description provenance；
  - 对 manifest + overlay 做只读结构化合并，不写回文件。
- `server.py` 已注册 Semantic API 路由。
- 新增 `tests/test_semantic_api.py`，覆盖五种 sourceKind、manifest-only 空 rawYaml、继承字段、overlay 结构化展示和 Agent 白名单无写工具。

#### 前端

- `frontend/package.json` / `frontend/package-lock.json` 增加 `js-yaml`、Vitest、Testing Library、jsdom 和 jest-dom；新增 `npm test`。
- 新增 `frontend/src/components/semantic-viewer/`：
  - `SemanticAssetViewer`
  - `SemanticCodePane`
  - `SemanticVisualPane`
  - Description、Measure、Column、Join、Segment、SourceKind 子组件
  - DTO `types.ts`
- `Sidebar.tsx` 新增「语义资产」分组、连接/source 树、详情加载和只读查看弹窗。
- `client.ts` 新增 Semantic sources 列表与详情 API 客户端。
- `index.css` 增加双栏、sourceKind、manifest-only、响应式窄屏、焦点和 reduced-motion 样式。
- 新增 `SemanticAssetViewer.test.tsx`，覆盖原文/结构化卡片、manifest-only 引导、继承字段及模式切换。

### 验证结果

- **专项后端测试通过**：`.venv/Scripts/python.exe -m pytest -q tests/test_semantic_api.py tests/test_semantic_startup.py` → `15 passed`；连同 `tests/test_mcp_manager_reconcile.py` 回归 → `26 passed`。
- **前端组件测试通过**：`cd frontend && npm test` → `1 test file / 4 tests passed`（含五种 sourceKind Badge）。
- **前端生产构建通过**：`cd frontend && npm run build` → `tsc -b` 与 Vite build 均通过。
- **新增前端文件 ESLint 通过**：`npx eslint src/components/semantic-viewer src/test/setup.ts vitest.config.ts` 无输出。
- **Semantic API 路由注册通过**：使用 `.venv` 导入 `server.app.openapi()`，确认两个 `/semantic/sources` 路径存在。
- **全量前端 ESLint 未通过**：现有 `release-final` 生成的 KTX `.d.ts`、既有 `any`、既有 React hook 规则问题共 143 项；这些不是本批新增组件引入。`src/api/client.ts` 也存在本批前的既有 `any` 报告。
- **Python 系统解释器测试未通过收集**：系统解释器缺少 `fastapi`；已改用项目 `.venv` 验证，不能把系统解释器失败误记为代码失败。

### 当前未完成/风险

- [ ] 尚未完成真实运行中的 Electron/FastAPI → Semantic MCP → KTX 产物链路验证；当前后端 fixture 仅为局部 API 证据。
- [ ] KTX 内部 `getSourceStatuses()` 目前不是 MCP DTO；本批在 Host 内部按同一目录语义做只读派生。若要完全按计划“由 sl_discover 返回状态”实现，需要后续冻结 KTX discover contract。
- [ ] 尚未做 Sidebar Playwright/视觉验收和窄屏实际截图验证。
- [ ] 尚未验证无 Semantic MCP、空 `ktx.yaml`、连接重连时 Sidebar 的错误展示。
- [ ] `js-yaml` 已声明并安装，但 V2 只读查看器右栏使用后端 DTO，不在前端重复解析 YAML；本批没有制造未使用的本地解析路径。
- [ ] 不能声明 V-01 至 V-12 全部通过，不能声明产品完成。

## 2026-08-16 — 现场截图诊断：当前数据以 manifest 为主

- 检查当前 `.data_agent/semantic-context/semantic-layer/default-mysql`：`_schema/qianhai_data_analysis.yaml` 包含 25 个表；目录下没有 24 个源对应的独立 base YAML。
- 语义项目 Git 工作区显示原先的 25 个独立 YAML 被删除/收敛；`mart_industry_sales_summary.yaml` 只保留 `name + measures`，不再含 `table`/`sql`，因此按 KTX 语义属于 Overlay，不属于 standalone。
- Host 扫描结果为 `manifest_only: 24`、`manifest_with_overlay: 1`。截图中可见的前 8 个源均属于 manifest-only，显示“系统 manifest”是当前文件状态的正确结果，并非前端把独立 YAML 全部误判。
- 若运行中的客户端连 `mart_industry_sales_summary` 也显示“系统 manifest”，需进一步检查运行实例是否使用旧后端或另一份 `DATA_AGENT_SEMANTIC_PROJECT_DIR`；当前代码对本地该文件应返回“含覆盖层”。
- 暂不自动恢复独立 YAML，避免覆盖 KTX 当前 manifest/overlay 事实；恢复策略需先决定是保留 manifest-only，还是重新建立 standalone（并处理同名 manifest 的遮蔽关系）。

## 2026-08-16 — 设计疑问：KTX 已提供 Manifest 生成的 YAML

- 复核 `ktx/packages/cli/src/context/sl/local-sl.ts`：`loadLocalSlSourceRecords()` 会将 `_schema` 的 manifest entry 投影为完整 `SemanticLayerSource`，再通过 `sourceToYaml()` 生成 YAML；`readLocalSlSource()` 在没有独立文件时返回该生成 YAML。
- 因此“manifest-only 时 rawYaml 为空”是 V2 方案为区分“独立文件原文”而做的产品约束，不是 KTX 后端没有 YAML，也不是 KTX 无法提供 YAML。
- 用户反馈后确认：只读查看器并不需要用户手写原文；更合理的 UI 是展示 KTX ingest/manifest 生成的 resolved YAML，并明确标注“系统生成、非独立源文件”。当前空白代码栏需要重新评估/调整 DTO 与验收标准，不能继续把“无独立文件”解释成“无 YAML 模型”。

## 2026-08-16 — 语义审核对象与 Manifest 分层

- 进一步确认：`_schema` Manifest 主要是 ingest 产生的数据库/物理元数据目录（表、字段、类型、自动描述及部分关系），不是用户真正需要审核的业务查询语义文件。
- 真正需要业务/数据工程审核的是 standalone semantic source 或 overlay/resolved model，重点包括 `measures.expr`、`filter`、`segments`、`grain`、`joins.on/relationship`、默认时间维度等查询口径。
- 当前项目实际为 24 个 manifest-only、1 个 overlay，因而当前 Sidebar 把全部条目放在“语义资产”下虽可用于查看，但不应继续暗示它们都是“待审核 YAML”。后续应区分“系统元数据（只读查看/校验）”与“业务语义模型（可进入审核范围）”。
- 若恢复审核闭环，审核对象应是 overlay/standalone 或其与 Manifest 合并后的 resolved semantic model；Manifest 本身不参与 approve/reject，除非另建自动摄入质量/关系候选校验状态。

## 2026-08-16 — V2.1 调整：隐藏系统元数据并导入业务知识

### Decision

- `manifest_only` 只作为 KTX 内部基础元数据，不进入前端业务语义模型目录；若连接没有业务模型，整个连接不展示。
- 将项目中实际存在的 `knowledge/doc/business.md`（用户所称 `business.ma`）和 `knowledge/doc/query_patterns.md` 手动整理为业务语义 YAML。
- （V2.1 决策，已由 V2.2 修订）当时将完整 SQL 模板放在 Host-owned `business-semantic/<connectionId>/`；用户确认模板已验证后，V2.2 改为直接生成 KTX SQL source。

### Implemented

- `src/api/semantic_api.py`：
  - 列表/详情排除 `manifest_only`；
  - 新增 `assetType`、业务规则、SQL 模板 DTO；
  - 读取 `business-semantic/<connectionId>/*.yaml`；
  - 业务知识不经过 `sl_read_source`，不污染 KTX executable layer。
- `.data_agent/semantic-context/semantic-layer/default-mysql/` 新增 7 个业务语义模型：
  - `industry_sales_detail.yaml`
  - `industry_sales_summary.yaml`
  - `industry_sales_top50.yaml`
  - `social_retail_detail.yaml`
  - `social_retail_industry_summary.yaml`
  - `social_retail_district_summary.yaml`
  - `social_retail_special_summary.yaml`
- `industry_sales_summary.yaml` 增加“先汇总再计算同比、禁止平均个体增速”的业务 measure。
- （V2.1 产物，已被 V2.2 替换）旧 `qianhai_business_knowledge.yaml` 曾包含 4 条业务规则和 13 条 advisory SQL 模板；V2.2 已删除该查询模板资产，改由 13 个 `semantic-layer/query_*.yaml` 承载。
- 前端将分组名称改为“业务语义模型”，增加“业务知识”徽章、业务规则卡片、SQL 模板折叠展示；系统 manifest 条目不再显示。
- 方案文档追加 §9 V2.1 调整说明。

### Verification

- KTX `sourceDefinitionSchema` 校验新增 7 个业务模型全部通过。
- `.venv/Scripts/python.exe -m pytest -q tests/test_semantic_api.py tests/test_semantic_startup.py tests/test_mcp_manager_reconcile.py` → `27 passed`。
- `cd frontend && npm test` → `1 test file / 5 tests passed`。
- `cd frontend && npm run build` 通过；仅保留既有的大 bundle warning。
- 新增前端组件 ESLint 通过；`py_compile` 和 `git diff --check` 通过。

### Residual / Risk

- 业务规则 YAML 是手工整理产物，未自动同步后续知识库 Markdown 变更。
- （已被 V2.3 取代）当前 13 条 SQL source 曾保留知识库模板中的默认示例参数；V2.3 已移除这些字面量，改由 KTX filters 传入。
- 尚未完成 Electron/FastAPI/KTX 真实运行链路重启后的最终视觉截图验收。

## 2026-08-16 — V2.2：已验证 SQL 模板直接转为可查询 KTX source（历史实现）

### Decision

- 用户确认 `knowledge/doc/query_patterns.md` 中的 SQL 是经过验证的查询模板，不再将其放在 Host-owned `business_knowledge` 中标记为 advisory。
- 13 条模板各生成一个 `semantic-layer/default-mysql/query_*.yaml` SQL source；该产物随后由 V2.3 重构为 `business_*.yaml` 可复用模型。`business.md` 中不能独立执行的规则单独保留为 `qianhai_business_rules.yaml`。
- 前端继续只读展示，但语义模型列表直接展示这些 KTX source，并标记“可查询”。

### Implemented

- 删除旧的 `qianhai_business_knowledge.yaml` 查询模板资产，生成 13 个 KTX SQL source：行业销售、企业月度、正增长、新纳统、四上企业增减等全部模板。
- 每个 source 增加 `sql`、`grain`、输出 columns、measures、来源描述和 `query_template` 标签；该阶段保留默认参数，已由 V2.3 重构。
- 为 MySQL 实际执行修正保留字别名 `row_number`，统一为 `result_row_number`；补齐行业排名模型的月份和行业代码投影。
- 修复原 `industry_sales_detail` 中 KTX 重复指标校验错误：正增长企业数改由 `company_count + positive_growth` segment 表达。
- `SemanticSourceSummaryDto`/`SemanticSourceViewDto` 增加 `isQueryable`；Sidebar 和弹窗增加“可查询”徽章。
- `ConfigManager` 为 Windows KTX Python daemon 注入 `PYTHONUTF8=1`，避免中文 YAML/SQL 经 stdin/stdout 编码错误。

### Verification

- KTX `sourceDefinitionSchema`：13 个新增 SQL source 全部通过。
- MySQL 直接执行 13 个转换后的 SQL：全部成功返回结果；返回行数覆盖 1～286 行。
- 真实 KTX `sl_validate`：`valid=true`、`catalogReady=true`、`errors=[]`；仅剩现有模型组件断开 warning。
- 设置 `PYTHONUTF8=1` 后真实 KTX `sl_query` 已逐一执行 13 个新增模型，全部返回 MySQL 结果；返回行数为 1～10（按验证查询的 limit）。
- 回归结果：后端专项测试 `27 passed`；前端组件测试 `5 passed`；前端生产构建通过；新增前端 ESLint 与 Python 编译通过。Electron 重启/截图尚未完成。

## 2026-08-16 — V2.3：重构为可复用业务语义模型

### Decision

- 用户指出固定企业、行业、月份条件使 `query_*.yaml` 只是可执行模板，不是可复用业务语义模型。
- 保留 KTX SQL source 形态，但将 SQL 限定为可复用底层关系；所有查询参数改由 `sl_query.filters` / `order_by` 传入。
- 13 个 source 重命名为 `business_*.yaml`，作为前端展示的业务语义模型；`qianhai_business_rules.yaml` 继续只承载不能独立执行的业务规则。

### Implemented

- 重构行业销售 3 个模型：删除固定行业/月条件，补齐行业代码、月份维度；排名占比按当前行月份关联全行业合计计算。
- 重构企业月度销售模型：删除固定企业和日期，增加 `company_id`，补齐上年同期字段，并提供汇总同比 measure。
- 重构正增长 2 个模型：按行业代码和月份输出可筛选的企业数、销售额、正增长占比，并增加汇总占比 measure。
- 重构新增/减少四上 7 个模型：使用无固定日期的 `month_pairs` 关系暴露 `base_month`/`target_month`，支持动态比较月份；删除展示用 `ROW_NUMBER()`，增加企业 ID、行业代码和目标行业维度。
- 删除旧 `query_*.yaml` 文件，前端现在列出 `business_*.yaml`；模型描述明确要求使用 KTX filters，不再提示“模板参数保留在 SQL 注释中”。

### Verification

- TypeScript `sourceDefinitionSchema`：13 个 `business_*.yaml` 全部通过。
- MySQL 直接执行 13 个重构 SQL：全部成功；带实际行业/月份过滤的 13 个包装查询全部返回结果。
- 真实打包 KTX MCP：`sl_validate` 返回 `valid=true`、`catalogReady=true`、`errors=[]`；使用对象化 filters 逐一调用 13 个 `sl_query`，全部返回 MySQL 结果，执行计划显示 `execution.mode=executed`。
- 回归验证：后端专项测试与模型测试 `29 passed`；前端组件测试 `5 passed`；前端构建、定向 ESLint、Python 编译通过。

### Residual / Risk

- KTX 当前使用 SQL source 是因为这些业务口径包含多表关联、跨月比较和行级计算；SQL 不再是固定查询文本，但仍是底层关系实现。
- 新增/减少四上模型要求调用方同时传入 `base_month` 和 `target_month`；不传比较月份会产生更大范围的跨月关系，Agent/业务调用规范应继续强调必填。
- Electron/FastAPI/KTX 重启后的最终视觉截图尚未完成。

## 2026-08-17 — 生成结果相对链接跳转修复

### Problem

Agent 返回的 `[data/xxx.csv](data/xxx.csv)` 是当前会话工作区的相对路径，但 Markdown 渲染器只识别 `/workspace/*` API 路径，于是浏览器把链接交给 Vite 前端路由，最终回退到 Landing Page。

### Implemented

- `frontend/src/utils/resolveInternalUrl.ts` 增加工作区相对路径识别、下载 URL 和预览 URL 解析。
- `frontend/src/components/AgentMarkdown.tsx` 将 `data/`、`output/`、`reports/`、`dashboards/` 等结果链接解析到当前 session 的 `/workspace/files/download`，不再按外部链接处理。
- 结果文件名本身改为可点击下载链接；预览按钮继续使用 `/workspace/files/preview`。
- 增加相对工作区链接单元测试。

### Verification

- 前端测试：2 个测试文件、8 个测试通过。
- 前端生产构建通过；定向 ESLint 通过。
