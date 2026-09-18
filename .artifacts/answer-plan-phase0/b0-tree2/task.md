# 桌面客户端改造开发计划日志

- `[x]` **阶段一：后端（Python）动态端口与密钥改造**
  - `[x]` 1. 修改 `server.py` 及 FastAPI 服务，使其不写死 8080 端口，而是支持从命令行参数（如 `--port`）启动，同时支持环境变量 `PORT` 作为备选（`--port` 优先）
  - `[x]` 2. 将绑定地址从 `0.0.0.0` 改为 `127.0.0.1`，避免桌面客户端服务暴露到局域网
  - `[x]` 3. 改造密钥加载逻辑：复用现有 `ConfigManager.update_llm_config()` 和 `/api/settings` 路由，允许后端通过 HTTP 接口接收 Electron 传入的 API Keys，而不是仅依赖 `.env` 文件
  - `[x]` 4. 配置 PyInstaller：编写 `build.spec` 脚本，将 Python 服务打包为隐藏命令行的 `data_agent_server.exe`
    - `[x]` 4a. 显式声明 `hiddenimports`（MCP 子进程调用、workspace/code_executor 沙箱等动态导入）
    - `[x]` 4b. 将 `knowledge/`、`templates/` 等资源目录作为 `datas` 打包
    - `[ ]` 4c. 验证打包后的 exe 能正常启动 MCP server 和数据库连接
  - `[x]` 5. 改造日志路径：支持通过参数指定日志输出目录（供 Electron 传入 `app.getPath('userData')` 路径），不再写死 `data_agent.log`

- `[x]` **阶段二：前端首次启动配置向导 (Onboarding UI)**
  - `[x]` 1. 在 React/Vite 前端编写"初始配置"页面，检测到本地无密钥配置时强制跳转
  - `[x]` 2. UI 需同时支持 OpenAI 和 Anthropic 两种 API Key 输入，标明至少填写一个
  - `[x]` 3. 用户输入 Key 后，先调用后端做轻量验证（如请求模型的 `/models` 接口），验证通过再保存
  - `[x]` 4. 使用 Electron `safeStorage` 加密存储密钥，不使用浏览器 `localStorage`（明文落盘不安全）
  - `[x]` 5. 向运行中的本地后端发送配置指令（`/api/settings`）激活引擎
  - `[x]` 6. 增加数据库连接配置入口（`MYSQL_*` 参数），或提供内嵌 SQLite 的降级方案

- `[x]` **阶段三：Electron 融合层开发与进程生命周期管理**
  - `[x]` 1. 安装所需依赖：`electron`、`electron-builder`（动态端口与安全存储使用 Node/Electron 原生能力）
  - `[x]` 2. 编写 `main.js` 主进程：启动时寻找系统空闲端口
  - `[x]` 3. 实现单实例锁（`app.requestSingleInstanceLock()`），防止重复打开导致端口冲突
  - `[x]` 4. 使用 `child_process.spawn` 带动态端口启动后台 Python `.exe` 服务
  - `[x]` 5. 编写启动等待/Loading 页面：轮询 `GET /health` 直到后端就绪，再跳转主界面
  - `[x]` 6. 通过 `preload.js` 将动态端口注入 `window.__PORT__`，前端 API 基础 URL 从此读取
  - `[x]` 7. 实现运行时健康监控：主进程定期轮询 `/health`，后端崩溃时自动重启或提示用户
  - `[x]` 8. 监听应用退出事件，同步销毁 Python 进程，防止后台资源占用
  - `[x]` 9. 开发模式支持：`dev` 环境下 Electron 加载 Vite dev server（`http://localhost:5173`），而非打包后的静态文件

- `[ ]` **阶段四：自动化打包构建流**
  - `[x]` 1. 修改 `package.json` 构建脚本：先 PyInstaller 编译后端 exe（输出到 `extraResources` 目录），再 `vite build` 打包前端
  - `[x]` 2. 配置 `electron-builder` 以产生一键安装形态的桌面程序
  - `[ ]` 3. 添加 Windows 代码签名步骤，避免 SmartScreen 拦截警告（初期可用自签名证书）
  - `[x]` 4. 评估打包体积（PyInstaller exe + Electron 预计 200MB+），考虑 `--onefile` + UPX 压缩优化
  - `[x]` 5. 预留 `electron-updater` 接入点，为后续自动更新做准备（v1 可不完整实现）
  - `[ ]` 6. 测试最终生成的 `.exe` 安装包（安装、启动、配置向导、正常使用、退出全流程）
## 2026-04-22 Packaging Follow-up

- `[x]` Switched backend packaging handoff from PyInstaller `onefile` to `onedir` for desktop evaluation and successful unpacked delivery.
- `[x]` Cleaned pure build outputs before rebuilding to prevent `dist` and `frontend/release` from duplicating multi-GB artifacts on a nearly full `D:` drive.
- `[x]` Slimmed `build.spec` hidden imports and excludes so optional ML stacks are no longer bundled into the desktop backend output.
- `[x]` Forced matplotlib to use `Agg` in both PyInstaller hook config and runtime code execution paths to avoid Qt backend collection.
- `[x]` Rebuilt backend and verified direct `/health` readiness in about `3.3 s`.
- `[x]` Rebuilt `win-unpacked` and verified packaged backend health success in about `8.4 s`.
- `[x]` Built the formal NSIS installer and verified silent install, startup, and uninstall against a dedicated test directory.
- `[x]` Recommendation recorded: keep `onedir` as the desktop backend packaging mode unless installer-only distribution constraints later outweigh startup performance.
