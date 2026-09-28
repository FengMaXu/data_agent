# Flint Chart 对 Data Agent 看板的适配评估

## 范围

静态源码核对；未安装依赖、运行渲染测试或修改产品代码。上游检查版本为 commit `683d5de1ffd0c1a76001ca5aa044f297276d7734`（2026-09-23），`packages/flint-js/package.json` 版本 0.5.1，MIT。源码临时克隆位于 `scratch/flint-chart-review`。

## 结论

适合作为单图规格编译与布局能力的候选依赖，不是整套 BI 看板替代品。Data Agent 已有 View Spec → ECharts 编译路径，优先在该内部 seam 试点，而非向模型同时公开两套完整图表协议。

## 已核对上游能力

- 高层输入包括 data、semantic_types、chart_spec、theme_spec 等，输出为后端原生规格。TypeScript 库支持 ECharts、Vega-Lite、Chart.js、Plotly 和 Office.js Excel artifact。[API](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/docs/api-reference.md#L29-L107)
- ECharts assemble 实际完成语义解析、数据转换、布局及模板实例化；不是仅包装 LLM 提示词。[assemble](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/assemble.ts#L115-L296)
- validateChart 提供结构化 warnings/errors/computedSize；支持字段存在、编码通道及模板、数据和画布上限检查，但不校验业务口径和来源权威。[validate](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/validate/index.ts#L106-L183)
- ECharts 图种参考列出 37 种，实际应按模板 registry 判定支持，而不能假设每个后端支持同样能力。[reference](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/docs/reference-echarts.md#L1-L13)

## 与当前实现的对应

- `packages/runtime/src/dashboard-v3.ts::compileDashboardView/compileEChartsOptions` 为图表、饼图、表格、KPI 提供已有编译路径。Flint 可增强图表分支，表格和 KPI 不必随之替换。
- `renderStandaloneDashboardHtml` 将编译结果 JSON 序列化后嵌入独立 HTML，浏览器再 `echarts.init/setOption`；因此并非把 Flint option 直接替换即可。
- `packages/runtime/src/dashboard-v4.ts` 定义参数、语义查询和桥接刷新消息。Flint 不应取得数据查询、身份授权、业务聚合或发布权。
- 不把文档中的完整筛选联动/下钻蓝图等同于当前 TS 渲染路径已完成的能力。

## 接入前必须处理的四项限制

### 1. 后端能力不对称

当前 ECharts assembler 不消费 `theme_spec`，而 Vega-Lite 和 Plotly 消费。README/类型注释中仍有“仅 Vega-Lite”的旧说明，应以具体 assembler 为准。不能承诺 ECharts 接入后即可获得 Economist 等主题全部效果。

- [ECharts assemble](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/assemble.ts#L115-L140)
- [Plotly theme resolution](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/plotly/assemble.ts#L95-L103)

完整 `interaction_spec` 预设在校验器中仅对 Vega-Lite运行，其他后端返回 ignored；但 ECharts 另有 category viewport interactive renderer，不能笼统说 ECharts 没有交互。

- [interaction validation](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/validate/index.ts#L311-L327)
- [ECharts interactive renderer](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/interactive.ts)

### 2. 编译器可能改变实际绘制数据

编码指定 aggregate 时会进行聚合；overflow 也可能筛选用于绘图的数据并产生 warnings/viewports。Data Agent 必须自己控制聚合口径，尤其禁止对已计算比率盲目平均；高基数数据显示应保留视口/滚动或明确披露截取范围，不可把被筛选的部分展示成完整结果。

- [aggregation](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/assemble.ts#L179-L180)
- [overflow](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/assemble.ts#L269-L296)
- [returned warnings/viewports](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/assemble.ts#L537-L547)

### 3. 编译结果不全是可 JSON 序列化的数据

ECharts tooltip formatter 等可以是函数。当前 HTML 路径序列化 option 会丢弃函数，应评估在浏览器使用打包后的受信编译器，持久化可序列化的 Flint 输入；不要采用任意 eval 或模型生成 JS 修补。

- [formatter assignment](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/packages/flint-js/src/echarts/instantiate-spec.ts#L1444-L1456)
- 本地：`packages/runtime/src/dashboard-v3.ts:242-252`。

### 4. 部署与扩展不是零成本

建议优先本地 TS 库，或受控本地 MCP；不把企业数据默认发到 README 的公共 hosted MCP。原生 Excel 输出依赖 Office.js 环境，不等于直接提供独立 xlsx 导出器。[Excel requirements](https://github.com/microsoft/flint-chart/blob/683d5de1ffd0c1a76001ca5aa044f297276d7734/docs/api-reference.md#L82-L107)

## 建议的小规模验证

同一批已授权、已发布数据，对比现有编译器和 Flint：行业柱图、月份折线、分组柱图、散点图、热力图。测试中文长标签、负数、空值、空结果、高基数、百分比尺度、固定画布和离线 HTML。

指标：模型输入长度、首轮生成成功率、修复次数、渲染耗时、包体积、标签遮挡、警告可见性、数据/聚合一致性及事件映射。收益目前是设计预期，不是已测得结论。
