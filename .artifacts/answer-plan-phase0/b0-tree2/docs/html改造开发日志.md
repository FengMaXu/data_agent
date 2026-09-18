# HTML 看板沉浸式预览开发日志

## 2026-05-17 - Phase 1: 全局预览容器落地

### 审阅结论

`docs/html改造方案.md` 的方向可执行。核心判断是：HTML 看板预览不应挂在单个文件卡片内部，而应放到应用顶层，由全局状态统一管理，避免聊天消息滚动、复用或卸载时影响预览层。

### 本轮假设

1. 本轮先支持 HTML/HTM 文件的 iframe 预览，下载能力保持不变。
2. PDF、图片等其他文件类型暂不扩展，避免超出方案第一阶段。
3. 看板 iframe 的 `postMessage` 先转成聊天输入草稿，不自动提交给 Agent。这样保留下钻闭环入口，同时避免用户点击看板时触发不可预期的自动请求。

### 变更内容

新增：

1. `frontend/src/context/PreviewContext.tsx`
2. `frontend/src/components/common/GlobalPreviewModal.tsx`

改造：

1. `frontend/src/App.tsx`
   - 登录后的应用层包裹 `PreviewProvider`。
   - 顶层挂载 `GlobalPreviewModal`。
2. `frontend/src/components/widgets/WidgetRenderer.tsx`
   - `file_link` 卡片新增 HTML 文件“查看”按钮。
   - 继续复用 `resolveInternalUrl()`，保留鉴权 token 和会话路径处理。
   - 下载按钮保留为次要动作。
3. `frontend/src/components/ChatArea.tsx`
   - 移除对任意 window `message` 的直接监听。
   - 改为订阅 `PreviewContext` 中由全局预览 iframe 发出的消息。
   - 下钻/返回消息只写入输入框草稿并关闭预览，不自动发送。
4. `frontend/src/context/LanguageContext.tsx`
   - 补充预览相关中英文文案。
5. `frontend/src/index.css`
   - 增加全局预览弹窗、iframe 容器和移动端全屏样式。

### 取舍

没有在本轮直接调用 Agent API 自动执行下钻。方案里提到这是可选方向，但当前更稳妥的产品行为是先让用户看到生成的下钻提示，再由用户决定是否发送。

没有扩展 PDF/图片预览。`PreviewContext` 已经按通用文件预览设计，后续可以在 `GlobalPreviewModal` 中增量支持。

### 验证

命令：

1. `npm run build`
2. `npm run preview -- --host 127.0.0.1 --port 4174`
3. `Invoke-WebRequest -Uri "http://127.0.0.1:4174/" -UseBasicParsing`

结果：

1. TypeScript 与 Vite 构建通过。
2. 本地预览服务返回 HTTP 200，页面包含 `#root` 挂载点。
3. Vite 输出 chunk 体积警告，属于当前前端包体积提示，不是本轮预览改造引入的构建错误。
4. 已尝试使用 Browser 做可视化烟测，但本地浏览器内核被 Windows 沙箱初始化失败阻断，因此用 HTTP 烟测作为降级验证。

## 2026-05-17 - Phase 1.1: Markdown 下载链接直连预览

### 问题

实际页面中，`build_dashboard` 生成的是普通 Markdown 下载链接，不是 `file_link` widget 卡片。因此用户看到的是“下载 xxx（HTML）”，不会出现前一阶段加在 widget 卡片上的“查看”按钮。

### 调整

改造 `frontend/src/components/AgentMarkdown.tsx`：

1. 识别 `/workspace/files/download?path=...` 形式的内部文件链接。
2. 对 `.html/.htm` 下载链接下方直接追加“查看”按钮。
3. 点击“查看”时复用 `PreviewContext.openPreview(...)` 打开全局预览弹窗。
4. 下载链接本身继续保留原下载行为，并继续复用 `resolveInternalUrl()` 的鉴权与会话路径处理。

补充 `frontend/src/index.css` 中的链接增强样式。

### 决策

预览入口不应强依赖 widget 卡片。更合理的架构是：

1. `PreviewContext` / `GlobalPreviewModal` 作为全局承载层。
2. Markdown 下载链接、file_link widget、工作区文件列表都可以作为触发入口。
3. 后续 CSV、图片、PDF 预览应扩展全局预览容器的渲染能力，而不是强制把所有文件都包装成 widget。

### 验证

命令：

1. `npm run build`

结果：

1. TypeScript 与 Vite 构建通过。
2. Vite 仍输出 chunk 体积警告，非本轮功能错误。

## 2026-05-17 - Phase 1.2: 预览与下载接口分离

### 问题

点击“查看”后弹窗打开但内容空白，同时浏览器自动下载 HTML。根因是查看按钮仍把 iframe `src` 指向 `/workspace/files/download`。该接口会带附件下载语义，浏览器在 iframe 加载时会触发下载，导致弹窗没有可渲染内容。

### 修复

1. `src/api/workspace_api.py`
   - 新增 `/workspace/files/preview` 接口。
   - 复用工作区路径安全校验和会话归属校验。
   - 返回 inline `FileResponse`，不设置下载文件名。
2. `frontend/src/utils/resolveInternalUrl.ts`
   - 新增 `resolveWorkspacePreviewUrl(...)`。
   - 将 `/workspace/files/download` 转换为 `/workspace/files/preview`，同时保留鉴权 token 和会话路径修正。
3. `frontend/src/components/AgentMarkdown.tsx`
   - 下载链接继续使用 download URL。
   - “查看”按钮改用 preview URL。
4. `frontend/src/components/widgets/WidgetRenderer.tsx`
   - `file_link` widget 的查看按钮同样改用 preview URL。
5. `frontend/src/components/common/GlobalPreviewModal.tsx`
   - 移除弹窗内下载按钮，避免预览弹窗承担下载职责。

### 决策

查看和下载必须是两个不同动作：

1. 下载：`/workspace/files/download`，由明确的下载链接触发。
2. 查看：`/workspace/files/preview`，由预览按钮触发，并在全局弹窗 iframe 中内联渲染。

后续 CSV、图片、PDF 预览也应沿用 preview 接口和全局预览容器，而不是复用下载接口。

### 验证

命令：

1. `python -m py_compile src\api\workspace_api.py`
2. `npm run build`

结果：

1. 后端接口文件编译通过。
2. TypeScript 与 Vite 构建通过。
3. Vite 仍输出 chunk 体积警告，非本轮功能错误。

## 2026-05-18 - Phase 1.3: 预览窗口拖动与等比缩放

### 问题

预览弹窗只能固定居中显示，用户无法拖动位置；窗口尺寸变化时，iframe 中的 HTML 看板按容器裁切/重排，不能随弹窗尺寸等比例缩小。

### 修复

1. `frontend/src/components/common/GlobalPreviewModal.tsx`
   - 增加预览窗口位置和尺寸状态。
   - 标题栏支持拖动窗口。
   - 右下角支持拖拽调整窗口大小。
   - 使用 `ResizeObserver` 监听内容区尺寸，按固定预览基准宽度计算 iframe scale。
2. `frontend/src/index.css`
   - 预览窗口改为 fixed 定位。
   - 增加拖动光标、resize handle、交互期间禁选与 iframe pointer-events 保护。
   - 移动端仍保持全屏预览，不显示 resize handle。

### 决策

HTML 看板预览采用“缩放 iframe 舞台”的方式，而不是让 iframe 内容随窗口宽度重新排版。这样窗口缩小时，看板整体比例保持一致，更符合用户对“预览窗口缩小”的预期。

### 验证

命令：

1. `npm run build`

结果：

1. TypeScript 与 Vite 构建通过。
2. Vite 仍输出 chunk 体积警告，非本轮功能错误。

## 2026-05-18 - Phase 1.4: 修复预览弹窗无法打开

### 问题

点击“查看”后预览弹窗无法弹出。根因是 Phase 1.3 添加拖动/缩放时，将 `useCallback` 放在了 `if (!isOpen || !url) return null` 之后，导致关闭态和打开态执行的 React hooks 数量不同。

### 修复

调整 `frontend/src/components/common/GlobalPreviewModal.tsx`：

1. 所有 hooks 都在早返回之前稳定执行。
2. `handleOpenExternal` 增加 `url` 空值保护，满足 TypeScript 类型检查。

### 验证

命令：

1. `npm run build`

结果：

1. TypeScript 与 Vite 构建通过。
2. 前端 Vite dev 服务仍在 `127.0.0.1:5173` 监听。

## 2026-05-18 - Phase 1.5: 预览窗与主窗口共存

### 问题

预览窗按 modal 实现：全屏遮罩拦截鼠标事件，主窗口无法继续操作。这不符合“看板预览窗与聊天主窗口共存”的使用方式。

### 修复

1. `frontend/src/components/common/GlobalPreviewModal.tsx`
   - 将 `aria-modal` 改为 `false`。
   - 移除点击遮罩关闭行为。
2. `frontend/src/index.css`
   - overlay 改为 `pointer-events: none`。
   - 仅预览窗口本体保留 `pointer-events: auto`。
   - 移除全屏灰色遮罩和背景模糊。

### 验证

命令：

1. `npm run build`

结果：

1. TypeScript 与 Vite 构建通过。
2. Vite 仍输出 chunk 体积警告，非本轮功能错误。
