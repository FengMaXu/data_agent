# Data Agent Frontend

React + Vite 前端，用于连接 `server.py` 暴露的 FastAPI 后端。

## 开发启动

```bash
npm install
npm run dev
```

默认前端运行在 `http://localhost:5173`。

## API 地址配置

前端通过 `VITE_API_BASE_URL` 指定后端地址：

```bash
# .env.local
VITE_API_BASE_URL=http://localhost:8080
```

如果未配置该变量，前端会默认走同源路径（适合反向代理或同域部署）。

## 本地联调

推荐本地开发组合：

- 后端：`http://localhost:8080`
- 前端：`http://localhost:5173`

后端 `server.py` 已默认放行：

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:5174`
- `http://127.0.0.1:5174`

如果你改了 Vite 端口，需要同步更新后端 CORS。

## 会话与工作区行为

V1.1 当前约定：

- 每个 session 使用稳定 `session_id`
- session 列表、当前 session、最小 transcript、已附加文件保存在浏览器 localStorage
- Workspace 文件按 `workspace/<session_id>/...` 隔离
- 勾选 Workspace 文件后，文件路径会通过 `attached_files` 随 `/agent/chat` 提交
- 同一个 session 同时只允许一个 active run
- 运行中输入的新内容会走 steer / follow-up 语义
- 点击停止会调用 `/agent/stop`，SSE `done.reason` 会返回 `completed | stopped | error`

## 常用命令

```bash
npm run dev
npm run build
npm run preview
```
