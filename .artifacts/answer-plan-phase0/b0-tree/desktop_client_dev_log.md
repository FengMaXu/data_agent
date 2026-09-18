# 桌面客户端改造开发日志

更新时间：2026-04-22

## 1. 计划审阅结论

`task.md` 的总体方向可行，目标是把现有 FastAPI + React/Vite 项目改造成本地 Electron 桌面客户端。审阅时发现并修正了以下落地点：

- 现有后端设置路由是 `/settings/*`，计划中写的是 `/api/settings`。实现时保留原 `/settings/*`，同时新增 `/api/settings/*` 兼容入口。
- 原 `ConfigManager.update_llm_config()` 只更新 OpenAI 兼容配置，没有完整覆盖 Anthropic API Key。实现时已补齐 provider 推断、OpenAI/Anthropic key 热更新和验证接口。
- 前端设置弹窗原先会把 provider 配置连同 key 写入 `localStorage`。实现时已改成只持久化非敏感偏好，密钥交给 Electron `safeStorage`。
- `server.py` 原先固定 `0.0.0.0:8080` 并固定写 `data_agent.log`。实现时已改为默认绑定 `127.0.0.1`，支持 `--port`、`PORT`、`--log-dir`。

## 2. 已完成开发范围

### 后端

- `server.py` 支持 `--host`、`--port`、`--log-dir` 启动参数。
- 默认 host 改为 `127.0.0.1`，避免桌面服务暴露到局域网。
- `--port` 优先于 `PORT` 环境变量，未指定时回退到 `8080`。
- 默认仅输出到控制台，不再在项目根目录写死 `data_agent.log`；Electron 传入 `--log-dir` 后写到用户数据目录。
- `/settings/*` 继续兼容现有前端，额外注册 `/api/settings/*` 供 Electron 主进程调用。
- 新增 `/settings/llm/test` 轻量验证接口，通过 provider 的 `/models` 接口验证 key。
- `ConfigManager` 支持 OpenAI/Anthropic runtime key 更新、模型更新和 OpenAI-compatible base URL 更新。

### 前端

- API client 支持从 `window.__PORT__` 或 `window.dataAgent.backendPort` 读取 Electron 注入的动态端口。
- 新增首次启动配置向导 `Onboarding.tsx`。
- Onboarding 支持 OpenAI compatible 与 Anthropic 两类 provider。
- Onboarding 在保存前调用后端 LLM 验证接口。
- Onboarding 提供可选 MySQL 配置入口，填写后调用后端数据库配置接口。
- 设置弹窗不再把 API Key 明文保存到 `localStorage`，只保存 base URL、模型等非敏感偏好。

### Electron 融合层

- 新增 `frontend/electron/main.js` 主进程。
- 启动时查找空闲端口，使用 `child_process.spawn` 启动 Python 后端。
- 实现单实例锁，避免重复启动端口冲突。
- 启动 Loading 页面，等待 `/health` 成功后再加载 Vite dev server 或静态前端。
- 定期健康检查，后端异常退出时自动重启。
- 应用退出时同步关闭 Python 后端进程。
- 新增 `preload.cjs`，只暴露 backend port、密钥存取 IPC 和更新相关 IPC。
- 使用 Electron `safeStorage` 加密保存 LLM 密钥到用户数据目录。
- 已接入 `electron-updater` 占位能力，默认不自动检查更新。

### 打包链路

- 新增 `build.spec`，用于 PyInstaller 打包 `data_agent_server.exe`。
- 显式收集 `src.*`、`mcp`、`uvicorn` 等动态导入。
- 将 `knowledge/`、`src/templates/`、`.env.example` 作为 datas 打包。
- `frontend/package.json` 新增 Electron 入口、开发脚本、后端打包脚本和 `electron-builder` 配置。
- 已新增 `build:unpacked` 与 `build:installer`，将 unpacked 调试和 NSIS 安装包构建拆分。
- 新增 `desktop_packaging.md`，记录开发模式、后端 exe 构建、桌面安装包构建、代码签名、自动更新和最终验收清单。
- `task.md` 已按实际完成范围更新勾选状态，未验证的最终安装包流程仍保持未完成。

## 3. 自动更新接入记录

- 已安装 `electron-updater`。
- 已在 Electron 主进程接入 updater 事件监听和 IPC：
- `data-agent:check-for-updates`
- `data-agent:download-update`
- `data-agent:quit-and-install-update`
- 自动更新检查默认关闭，仅在 `DATA_AGENT_ENABLE_AUTO_UPDATE=1` 且应用为 packaged build 时自动触发。
- preload 已暴露 `checkForUpdates()`、`downloadUpdate()`、`quitAndInstallUpdate()` 和 `onUpdateEvent()`。
- 当前尚未配置正式发布源，后续需要补 electron-builder `publish` 配置并生成带 `latest.yml` 的发布产物。

## 4. 依赖漏洞处理记录

- 已执行 `npm audit --json` 和 `npm outdated` 确认漏洞来源。
- 漏洞集中在 Vite 7.3.1 与传递依赖 `brace-expansion`、`flatted`、`picomatch`。
- 已执行非强制修复 `npm audit fix`，未使用 `--force`，避免跨 major 升级破坏 Electron/Vite 构建链路。
- 修复后 `npm audit` 结果为 `found 0 vulnerabilities`。
- 修复后 Vite 实际构建版本为 7.3.2。

## 5. 已执行验证

- `npm run build`：通过。
- `node --check electron\main.js`：通过。
- `node --check electron\preload.cjs`：通过。
- Python 语法检查：通过。
- `python server.py --help`：通过，能显示 `--host`、`--port`、`--log-dir`。
- `npm audit`：通过，0 vulnerabilities。
- `npm run build:backend`：通过，生成 `D:\data_agent\dist\data_agent_server.exe`，大小约 363 MB。
- 独立 exe 验证：通过，`/health` 返回 `{"status":"ok"}`，日志能写入指定目录。
- `npm run build:unpacked`：通过，生成 `D:\data_agent\frontend\release\win-unpacked`。
- unpacked app smoke test：通过。Electron 主进程成功拉起 packaged backend，backend `/health` 通过，日志写入 userData。
- `npm run build:installer`：通过，生成 `D:\data_agent\frontend\release\Data Agent Setup 0.0.0.exe`，大小约 468 MB。
- 已验证运行时名称修正：packaged app 的 userData/log 目录现为 `C:\Users\Negan\AppData\Roaming\Data Agent`。
- `python -m pytest tests -p no:cacheprovider`：执行完成，结果为 89 passed / 6 failed。

## 6. 当前已知问题

- pytest 失败集中在未触碰模块：
- `tests/test_context.py` 的知识库搜索匹配/输出格式断言失败。
- `tests/test_setup_timing.py` 的 monkeypatch 路径 `src.agent.tool_assembly.MCPConfigLoader` 找不到。
- `tests/test_widget_sse_flow.py` 的 clear_session 未关闭 cached runtime registry。
- 这些失败与本轮桌面客户端改造文件没有直接重叠，未在本轮中修复，避免误改用户已有脏工作区。
- 还未实际生成 PyInstaller exe，也未完成 electron-builder 安装包端到端测试。
- 已生成 PyInstaller exe 和 NSIS 安装包，但还没有实际执行安装器安装流程。
- packaged app 首次健康检查较慢，当前观察到首次后端就绪大约需要 95 秒，和 PyInstaller onefile 解包/扫描有关。
- Windows 代码签名需要证书策略，当前尚未真实完成；当前构建通过 `CSC_IDENTITY_AUTO_DISCOVERY=false` 生成未签名开发安装包。
- 自动更新发布源尚未配置，因此 updater 目前只是安全占位接入。

## 7. 下一步开发建议

- 运行 `npm run build:backend`，验证 `data_agent_server.exe` 能启动 `/health`。
- 对安装包执行安装、启动、配置向导、正常对话、退出全流程测试。
- 评估是否保留 PyInstaller onefile；如果首次启动时间不可接受，可改成 one-dir 或增加首次启动提示。
- 配置 Windows 代码签名证书，验证签名后的安装包。
- 配置 electron-builder `publish` 发布源，验证更新检查事件。
- 单独处理现有 pytest 失败，避免把桌面端改造和历史测试债混在一个变更里。
## 2026-04-22 One-Dir Packaging Follow-up

- Cleaned pure build artifacts under `frontend/release`, `build`, and `dist` before rebuilding to avoid repeated multi-GB duplication on `D:`.
- Tightened `build.spec` by removing broad `collect_submodules("src.*")` usage, keeping only `mcp` dynamic collection plus explicit uvicorn and MCP client hidden imports.
- Added explicit PyInstaller excludes for heavyweight optional ML packages (`torch`, `transformers`, `datasets`, `onnxruntime`, etc.) and GUI backends (`PyQt6`, `PySide*`, `tkinter`) that are not required for desktop startup.
- Pinned matplotlib collection to the `Agg` backend in PyInstaller `hooksconfig`, and updated `src/workspace/code_executor.py` to force `Agg` at runtime via `matplotlib.use('Agg')` and `MPLBACKEND=Agg`.
- Disabled uvicorn's default `log_config` in `server.py` so the packaged windowed backend no longer crashes on startup with `AttributeError: 'NoneType' object has no attribute 'isatty'`.
- Removed the unused `reload_excludes` argument from `uvicorn.run(...)` to eliminate the packaged startup warning about reload configuration.
- Rebuilt backend successfully with `npm run build:backend`; final one-dir output size is about `325.6 MB` at `D:\\data_agent\\dist\\data_agent_server`.
- Verified direct one-dir backend cold start: `/health` ready in about `3303 ms`.
- Rebuilt Electron unpacked app successfully with `npm run build:unpacked`.
- Verified unpacked packaged startup via `desktop_main.log`: backend health check passed in about `8418 ms`, down from the earlier packaged onefile path that took about `95 s`.
- Built the formal NSIS installer at `D:\data_agent\frontend\release\Data Agent Setup 0.0.0.exe` (about `224 MB`).
- Verified silent installer end-to-end in a dedicated test directory: install exit code `0`, installed app startup passed backend health in about `7914 ms`, and silent uninstall exit code `0` removed the test install directory cleanly.
- Recommendation: keep the desktop backend on PyInstaller `onedir`. It materially improves first launch time and avoids the onefile self-extraction delay.
