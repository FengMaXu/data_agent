# MCP 重置与增量管理方案

## 1. 背景

当前桌面客户端对 MCP 配置的任何修改，都会触发一次全量重启：

- 保存 MCP 配置后，`ConfigManager.save_mcp_settings()` 直接调用 `mcp_manager.restart(new_settings)`
- `MCPManager.restart()` 内部继续走 `start()`
- `start()` 的第一步是 `_stop_all()`，会停止当前所有 MCP server
- 然后再根据新配置把所有 `enabled` 的 MCP server 全部启动一遍

这导致几个明显问题：

- 只禁用/启用一个 MCP，也会影响所有其他 MCP
- 切换慢，UI 需要等待整组连接重建
- 容易出现短暂状态错乱，例如“已连接”和“已禁用”同时出现
- 已建立的工具缓存被整组刷新，用户感知像“整个系统抖一下”

## 2. 目标

本方案目标不是“继续优化全量重启”，而是把 MCP 管理从“整份配置重载”改成“按 server 粒度增量编排”。

最终目标：

1. 禁用/启用单个 MCP 时，只影响该 MCP 自己
2. 修改单个 MCP 配置时，只重启该 MCP
3. 未变化的 MCP 保持连接不断开
4. 前端切换时支持乐观更新与静默刷新
5. 列表状态以“配置状态 + 运行状态”清晰展示，不再相互打架
6. 为后续“临时停用但不改配置”“手动重连”“批量运维”留好接口

## 3. 当前实现分析

### 3.1 当前关键调用链

- `src/config_manager.py`
  - `save_mcp_settings()` 保存配置后直接 `await mcp_manager.restart(new_settings)`
- `src/mcp/manager.py`
  - `restart()` 直接调用 `start()`
  - `start()` 先 `_stop_all()`，再启动全部启用的 server

### 3.2 当前架构问题

当前 `MCPManager` 更像“生命周期启动器”，不是“增量运维管理器”。

它缺少以下能力：

- 对旧配置和新配置做 diff
- 单个 server 的 start/stop/restart
- 运行时状态与配置状态分离
- 已禁用 server 的状态保留与展示
- 前端快速切换所需的局部返回结果

## 4. 设计原则

### 4.1 单 server 粒度操作

MCP 管理动作必须下沉到 server 级别，而不是 settings 级别。

支持以下基本动作：

- `start_server(name)`
- `stop_server(name)`
- `restart_server(name, new_config)`
- `enable_server(name)`
- `disable_server(name)`
- `reconcile(settings)`

### 4.2 配置态与运行态分离

一个 MCP server 应同时具备两套状态：

- 配置态：是否启用、配置内容是什么
- 运行态：是否已连接、是否启动中、最近错误是什么、工具数多少

建议返回状态字段：

- `name`
- `enabled`
- `connected`
- `status`
  - `disabled`
  - `connecting`
  - `connected`
  - `error`
  - `stopped`
- `tool_count`
- `generation`
- `last_error`
- `description`
- `transport`
- `server_type`

### 4.3 增量 reconcile 优先

所有配置变更统一走一次 diff + reconcile，而不是 stop all + start all。

核心判断：

- 新增且启用：启动
- 删除：停止并移除
- 从启用改为禁用：停止该 server
- 从禁用改为启用：启动该 server
- 配置内容变化：仅重启该 server
- 配置未变化：保持不动

## 5. 目标架构

### 5.1 MCPManager 新职责

`MCPManager` 从“全量启动器”升级为“增量编排器”。

内部状态建议：

- `self._settings`
- `self._servers: dict[str, _ManagedServer]`
- `self._server_configs: dict[str, MCPServerConfig]`
- `self._server_runtime: dict[str, MCPServerRuntimeState]`

其中：

- `_ManagedServer` 负责单个连接生命周期
- `MCPManager` 负责 diff、调度、状态聚合、并发控制

### 5.2 新增运行时状态结构

建议新增一个轻量运行时状态对象：

```python
@dataclass
class MCPServerRuntimeState:
    name: str
    enabled: bool
    status: str
    connected: bool
    tool_count: int = 0
    generation: int = 0
    last_error: str | None = None
    updated_at: float | None = None
```

说明：

- `enabled` 来自配置
- `connected` 来自连接状态
- `status` 是面向 UI 的聚合态
- `last_error` 用于列表页提示与日志联动

## 6. 接口方案

### 6.1 保留现有接口

保留：

- `GET /mcp/config`
- `POST /mcp/config`
- `GET /mcp/servers`
- `GET /mcp/tools`
- `POST /mcp/test`

但内部不再一律全量重启。

### 6.2 新增细粒度接口

建议新增：

#### 1. 切换启用状态

`PATCH /mcp/servers/{name}/enabled`

请求体：

```json
{
  "enabled": true
}
```

行为：

- 更新配置文件中的该项
- 仅对该 server 做启停
- 返回最新 server 状态

#### 2. 手动重连单个 server

`POST /mcp/servers/{name}/restart`

行为：

- 不改配置
- 只重连该 server

#### 3. 停止单个 server

`POST /mcp/servers/{name}/stop`

行为：

- 仅改运行态
- 可选：是否持久化配置

#### 4. 启动单个 server

`POST /mcp/servers/{name}/start`

行为：

- 仅启动该 server
- 适合运维面板使用

## 7. 后端实施方案

### 阶段 A：先做最小可用增量重启

目标：

- 替换“保存配置 = 全量重启”为“保存配置 = diff 后局部重启”

实施点：

1. 在 `MCPManager` 新增 `reconcile(settings)` 方法
2. `save_mcp_settings()` 改为调用 `await mcp_manager.reconcile(new_settings)`
3. `reconcile()` 内部对比旧配置与新配置，输出动作集
4. 只对受影响 server 做 start/stop/restart

动作集定义建议：

- `to_add`
- `to_remove`
- `to_enable`
- `to_disable`
- `to_restart`
- `unchanged`

这是整个方案最关键的一步，也是收益最高的一步。

### 阶段 B：补齐单 server 生命周期 API

目标：

- 为前端列表页提供真正快速的启用/禁用能力

实施点：

1. 新增单 server `enabled` 切换接口
2. 新增单 server `restart` 接口
3. 列表页调用单 server 接口，不再提交整份 config
4. 返回局部状态，前端直接更新卡片

### 阶段 C：增强状态系统

目标：

- 消除“connected/disabled”冲突
- 给前端更清晰的状态来源

实施点：

1. `list_servers()` 返回所有配置项，而不只是 `_servers.values()`
2. 对禁用 server 也返回状态项
3. 增加 `status` 和 `last_error`
4. `tool_count` 直接来自运行态缓存

### 阶段 D：运行时与持久化操作分离

目标：

- 支持“临时停用”与“持久化禁用”两类操作

实施点：

1. 引入“运行态 stop/start”接口
2. 与“配置态 enabled”分开
3. UI 上区分：
   - 禁用：修改配置
   - 停止：仅停当前连接

这个阶段不是当前最急，但会让 MCP 管理更专业。

## 8. 前端改造方案

### 8.1 列表状态显示规则

推荐规则：

- `enabled = false`：左侧固定显示 `已禁用`
- `enabled = true && connected = true`：显示 `已连接`
- `enabled = true && status = connecting`：显示 `连接中`
- `enabled = true && status = error`：显示 `异常`
- `enabled = true && connected = false`：显示 `未连接`

右侧按钮规则：

- `enabled = true`：按钮显示 `禁用`
- `enabled = false`：按钮显示 `启用`
- 永远不要出现“左侧已禁用，右侧还是禁用”

### 8.2 前端请求策略

禁用/启用时：

1. 先本地乐观更新按钮与标签
2. 请求单 server 接口
3. 成功则静默刷新该卡片
4. 失败则回滚该卡片并显示行内错误

不要再使用：

- `alert()`
- 全量刷新配置 + servers + tools 三套接口

### 8.3 列表性能优化

列表页不要再依赖 `GET /mcp/tools` 来计算 tool 数。

改为：

- `GET /mcp/servers` 直接返回 `tool_count`

这样可减少额外请求和等待。

## 9. 关键数据流

### 9.1 启用单个 server

1. 前端点击“启用”
2. 调用 `PATCH /mcp/servers/{name}/enabled`
3. 后端更新配置文件中的该 server
4. `MCPManager` 仅启动该 server
5. 返回该 server 最新状态
6. 前端更新该卡片

### 9.2 禁用单个 server

1. 前端点击“禁用”
2. 调用 `PATCH /mcp/servers/{name}/enabled`
3. 后端更新配置文件中的该 server
4. `MCPManager` 仅停止该 server
5. 该 server 从 bridge_tools 中移除
6. 前端将卡片更新为 `已禁用`

### 9.3 修改单个 server 配置

1. 前端在编辑页保存
2. 后端只比较当前 server 与旧配置的差异
3. 若配置有变化，则仅重启该 server
4. 不影响其他 server

## 10. 风险与注意事项

### 10.1 会话中的工具快照问题

已有会话可能已经装配过某个 MCP 工具。

要确认：

- 禁用某个 server 后，已有会话是否还持有旧工具引用
- 是否需要新请求时重新装配工具集

建议：

- 以“新请求重新获取可用工具集”为准
- 不强行修改正在运行中的历史 tool 对象

### 10.2 并发修改问题

多个前端操作可能同时改 MCP 配置。

建议：

- `MCPManager.reconcile()` 保持单锁串行
- 配置保存与运行态变更统一走同一条调度通道

### 10.3 失败回滚

启用某个 server 失败时：

- 配置是否保留为 enabled
- 还是回滚成 disabled

建议当前版本：

- 配置保留用户意图
- 运行态标记为 `error`
- 列表页显示“异常/未连接”

这样更符合用户预期，也更便于排障。

## 11. 验收标准

### 阶段 A 验收

- 修改一个 MCP 配置，不会让其他 MCP 断开重连
- 禁用一个 MCP，只停止该 MCP
- 启用一个 MCP，只启动该 MCP
- 日志中不再出现每次都“重启所有连接”

### 阶段 B 验收

- 列表页启用/禁用直接调用单 server 接口
- 无弹窗
- 状态切换时间明显缩短
- 其他 MCP 卡片状态不抖动

### 阶段 C 验收

- 列表页不会再出现“已连接 + 已禁用”冲突
- 禁用的 server 仍能在列表中完整显示
- 异常状态有明确标记

## 12. 建议开发顺序

### 第一步

先做后端 `reconcile(settings)`，替换当前全量重启。

原因：

- 收益最大
- 不依赖前端改造
- 能立刻降低切换时的整体抖动

### 第二步

增加单 server 启用/禁用接口。

原因：

- 能把前端切换从“提交整份配置”变成“局部动作”

### 第三步

升级 `GET /mcp/servers` 返回完整状态。

原因：

- 统一前端展示逻辑
- 去掉对 `/mcp/tools` 的依赖

### 第四步

前端列表页切到局部刷新与乐观更新。

原因：

- 这一步依赖前端，但后端准备好后改起来很快

## 13. 本轮开发建议

建议按以下顺序逐步开发：

1. 后端：实现 `MCPManager.reconcile(settings)`
2. 后端：将 `save_mcp_settings()` 从 `restart()` 切到 `reconcile()`
3. 后端：补 `PATCH /mcp/servers/{name}/enabled`
4. 后端：补 `GET /mcp/servers` 完整状态字段
5. 前端：列表页改调用单 server 启用/禁用接口
6. 前端：移除弹窗，改为行内错误与静默刷新
7. 测试：补增量启停与状态展示回归测试

---

这份方案的核心结论只有一句话：

**把 MCP 从“配置全量重载”改成“按 server 增量编排”，这是当前性能、交互和稳定性问题的共同解法。**
