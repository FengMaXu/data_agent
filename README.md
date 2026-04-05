# 企业级数据智能体 (Enterprise Data Agent)

支持 CLI 与 Web UI 的单用户数据智能体，面向数据查询、分析推演、报告生成与工作区协作场景。

## 当前 V1.1 收口能力

- 同一个 `session_id` 同时只允许一个 active run
- `/agent/stop` 为真实 session-scoped cooperative stop
- Web 端区分普通发送与运行中补充说明（steer / follow-up）
- session / workspace 映射稳定，浏览器刷新后可恢复当前会话与最小 transcript
- `show_widget` / `widget_patch` / `tool_result` 使用稳定 ID，减少重复与串线
- Workspace 文件可显式附加到本次提问，通过 `attached_files` 发送给后端

## 后端启动

```bash
python server.py
```

默认监听：

- API: `http://localhost:8080`
- Health: `http://localhost:8080/health`

## 前端启动

```bash
cd frontend
npm install
npm run dev
```

默认前端地址：

- Web UI: `http://localhost:5173`

## 前后端联调

前端通过 `VITE_API_BASE_URL` 连接后端。

```bash
# frontend/.env.local
VITE_API_BASE_URL=http://localhost:8080
```

如果不配置，前端默认走同源路径；这适合反向代理或生产部署。

## CORS 说明

`server.py` 默认允许以下本地开发源：

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:5174`
- `http://127.0.0.1:5174`

如果你修改了前端端口，需要同步调整 `server.py` 中的 `CORSMiddleware` 配置。

## 会话与工作区约定

- 每个 session 使用稳定 `session_id`
- 后端工作区目录为 `workspace/<session_id>/`
- 后端会在每个 session 工作区下写入轻量快照 `.session_snapshot.json`
- `/agent/clear` 会清空会话上下文与快照，但默认不删除工作区文件
- `/workspace/files?session_id=<id>` 只返回当前 session 工作区文件
- 勾选的 workspace 文件会以 `attached_files` 形式随聊天请求发送

## CLI 模式

```bash
python main.py
```

CLI 保留统一 agent loop 能力，适合本地调试与工具链验证。

## 目录概览

- `src/api/agent.py`：session runtime、chat / steer / stop / clear、SSE 事件桥接
- `src/agent/agent_loop.py`：agent loop、工具执行、stop / steering / follow-up 检查点
- `src/api/workspace_api.py`：workspace 文件列表、上传、下载、删除
- `frontend/src/components/ChatArea.tsx`：聊天流、会话恢复、stop / steer UI
- `frontend/src/components/Sidebar.tsx`：session 切换、workspace 文件、附加文件选择
- `frontend/src/components/ToolPanel.tsx`：工具调用调试镜像

## License

MIT License
