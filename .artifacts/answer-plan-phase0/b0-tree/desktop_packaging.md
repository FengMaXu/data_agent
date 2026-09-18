# 桌面客户端打包与发布说明

## 1. 开发模式

先启动 Vite：

```powershell
cd D:\data_agent\frontend
npm run dev
```

再启动 Electron：

```powershell
cd D:\data_agent\frontend
npm run electron:dev
```

Electron 主进程会自动：

- 寻找 `127.0.0.1` 空闲端口。
- 启动 `D:\data_agent\server.py`。
- 传入 `--host 127.0.0.1 --port <动态端口> --log-dir <Electron userData>`。
- 等待 `/health` 成功后加载 `http://localhost:5173`。

## 2. 后端 exe 构建

```powershell
cd D:\data_agent\frontend
npm run build:backend
```

预期输出：

```text
D:\data_agent\dist\data_agent_server.exe
```

建议构建后先单独验证：

```powershell
D:\data_agent\dist\data_agent_server.exe --host 127.0.0.1 --port 18080 --log-dir D:\data_agent\.data_agent\logs
```

然后访问：

```powershell
Invoke-RestMethod http://127.0.0.1:18080/health
```

## 3. 前端构建

```powershell
cd D:\data_agent\frontend
npm run build
```

预期输出：

```text
D:\data_agent\frontend\dist
```

## 4. 桌面安装包构建

```powershell
cd D:\data_agent\frontend
npm run build:desktop
```

该命令会依次执行：

- PyInstaller 构建 Python 后端 exe。
- Vite 构建 React 前端。
- electron-builder 构建 Windows NSIS 安装包。

## 5. Windows 代码签名

当前仓库未包含真实代码签名证书。生产发布建议使用受信任 CA 证书，并通过环境变量提供给 electron-builder：

```powershell
$env:CSC_LINK="D:\certs\data-agent-code-signing.pfx"
$env:CSC_KEY_PASSWORD="<pfx-password>"
npm run build:desktop
```

自签名证书只适合内部测试，不能真正消除 SmartScreen 风险。正式发布前需要完成证书采购、签名策略和安装包验签流程。

## 6. 自动更新接入点

主进程已接入 `electron-updater`，但默认不会自动检查更新。原因是当前还没有正式发布源。

启用自动检查需要：

- 配置 electron-builder `publish` 发布源。
- 设置 `DATA_AGENT_ENABLE_AUTO_UPDATE=1`。
- 构建并发布带 `latest.yml` 的安装包产物。

渲染进程可通过 preload 暴露的 API 手动触发：

```ts
await window.dataAgent?.checkForUpdates();
```

后续如果要做完整 UI，可以监听：

```ts
const dispose = window.dataAgent?.onUpdateEvent((event) => {
  console.log(event);
});
```

## 7. 最终验收清单

- 安装包可正常安装。
- 首次启动展示 Loading，后端健康后进入主界面或 Onboarding。
- Onboarding 能验证并保存 OpenAI/Anthropic key。
- 密钥文件写入 Electron userData，项目根目录不出现明文 key。
- 后端日志写入 Electron userData 下的 `data_agent.log`。
- 配置 MySQL 后 MCP 能正常连接。
- 退出桌面客户端后 Python 后端进程被销毁。
- 断开后端进程后主进程能自动重启。
- 发布源配置后更新检查能收到 available / not-available / error 事件。
