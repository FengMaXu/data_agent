"""
企业级数据智能体 - 主入口
CLI 交互式聊天界面
"""

from __future__ import annotations

import asyncio
import logging

from src.ai.config import AIConfig
from src.ai.gateway import AIGateway
from src.ai.base_provider import Message, Role
from src.agent.agent_loop import agent_loop
from src.agent.tool_providers.base import GlobalRuntimeServices
from src.agent.types import AgentContext, AgentLoopConfig, AgentEventType
from src.config_manager import config_manager
from src.prompts import load_system_prompt
from src.workspace.workspace_manager import WorkspaceManager

# ─────────────────────────────────────────────
# 日志配置
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[logging.FileHandler("data_agent.log", encoding="utf-8")],
)
logger = logging.getLogger("data_agent")

# 控制台只显示 WARNING 以上
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.WARNING)
logging.getLogger().addHandler(console_handler)


# ─────────────────────────────────────────────
# Steering 队列（打断机制的基础设施）
# ─────────────────────────────────────────────


class SteeringQueue:
    """
    用户消息队列，支持 Agent 运行中的打断与追加

    在 CLI 模式下，我们用一个简单的 asyncio.Queue 来模拟。
    实际生产环境中可替换为 Redis / 消息队列。
    """

    def __init__(self):
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    def put(self, message: str) -> None:
        self._queue.put_nowait(message)

    async def get_steering_messages(self) -> list[Message]:
        """获取所有排队中的消息（非阻塞）"""
        messages = []
        while not self._queue.empty():
            try:
                text = self._queue.get_nowait()
                messages.append(Message(role=Role.USER, content=text))
            except asyncio.QueueEmpty:
                break
        return messages

    async def get_follow_up_messages(self) -> list[Message]:
        """获取追加消息（同 steering，CLI 模式下复用）"""
        return await self.get_steering_messages()


# ─────────────────────────────────────────────
# 主动澄清 CLI 回调
# ─────────────────────────────────────────────


async def _cli_clarification_callback(question: str, options: list[str]) -> str:
    """CLI 模式下的主动澄清回调：打印问题并等待用户输入"""
    print(f"\n  🤔 Agent 需要你的确认:")
    print(f"     {question}")
    if options:
        for i, opt in enumerate(options, 1):
            print(f"     {i}. {opt}")
        print(f"     (输入序号或直接输入你的回答)")

    loop = asyncio.get_event_loop()
    answer = await loop.run_in_executor(None, lambda: input("  👤 你的回答: ").strip())
    # 如果输入了序号，转换为选项内容
    if options and answer.isdigit():
        idx = int(answer) - 1
        if 0 <= idx < len(options):
            return options[idx]
    return answer


# ─────────────────────────────────────────────
# 主函数
# ─────────────────────────────────────────────


def print_banner():
    """打印欢迎横幅"""
    print()
    print("╔══════════════════════════════════════════════════╗")
    print("║        🤖 企业级数据智能体 v0.1.0               ║")
    print("║        Enterprise Data Agent                    ║")
    print("╠══════════════════════════════════════════════════╣")
    print("║  输入自然语言查询数据库                          ║")
    print("║  输入 'quit' 或 'exit' 退出                     ║")
    print("╚══════════════════════════════════════════════════╝")
    print()


async def run_agent_turn(
    user_input: str,
    context: AgentContext,
    config: AgentLoopConfig,
    gateway: AIGateway,
) -> None:
    """运行一轮 Agent 对话"""
    print()

    async for event in agent_loop(user_input, context, config, gateway):
        match event.type:
            case AgentEventType.AGENT_START:
                pass  # 静默

            case AgentEventType.TURN_START:
                pass

            case AgentEventType.MESSAGE_UPDATE:
                # 流式输出文本
                if event.text_delta:
                    print(event.text_delta, end="", flush=True)

            case AgentEventType.MESSAGE_START:
                if event.message and event.message.role == Role.ASSISTANT:
                    if event.message.tool_calls:
                        # 有工具调用时显示
                        for tc in event.message.tool_calls:
                            print(f"\n  🔧 调用工具: {tc.name}", flush=True)
                            if tc.arguments:
                                for k, v in tc.arguments.items():
                                    val_str = str(v)
                                    if len(val_str) > 100:
                                        val_str = val_str[:100] + "..."
                                    print(f"     {k}: {val_str}", flush=True)

                elif event.message and event.message.role == Role.TOOL_RESULT:
                    # 工具结果（简短显示）
                    content = event.message.content or ""
                    if "安全拦截" in content:
                        print(f"\n  ⛔ {content}", flush=True)
                    elif "error" in content.lower() or "错误" in content:
                        print(f"\n  ❌ {content[:200]}", flush=True)
                    else:
                        display = (
                            content[:300] + "..." if len(content) > 300 else content
                        )
                        print(f"\n  📊 结果: {display}", flush=True)

            case AgentEventType.MESSAGE_END:
                pass

            case AgentEventType.TURN_END:
                pass

            case AgentEventType.ERROR:
                print(f"\n  ❌ 错误: {event.error}", flush=True)

            case AgentEventType.AGENT_END:
                pass

    print()  # 换行


async def _build_cli_context() -> tuple[AgentContext, WorkspaceManager, GlobalRuntimeServices]:
    workspace = WorkspaceManager()
    runtime_overrides = {"clarification_callback": _cli_clarification_callback}
    enabled_mcp_servers = None

    if not config_manager.ai_config.mcp_server_script:
        enabled_mcp_servers = []

    tools, session_runtime_services = await config_manager.build_session_tools(
        session_id="cli",
        workspace=workspace,
        runtime_overrides=runtime_overrides,
        enabled_mcp_servers=enabled_mcp_servers,
    )
    context = AgentContext(
        system_prompt=load_system_prompt(config_manager.project_root),
        tools=tools,
    )
    return context, workspace, session_runtime_services


async def main_async():
    """异步主函数"""
    config = AIConfig.from_env()
    config_manager.ai_config = config
    config_manager.gateway = AIGateway(config)
    steering_queue = SteeringQueue()

    # 验证配置
    if not config.openai_api_key and not config.anthropic_api_key:
        print("⚠️  未检测到 API Key！")
        print("请在项目根目录创建 .env 文件：")
        print("  OPENAI_API_KEY=sk-...")
        print("  # 或")
        print("  ANTHROPIC_API_KEY=sk-ant-...")
        print()

    # Agent Loop 配置
    loop_config = AgentLoopConfig(
        model=config.default_model,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        get_steering_messages=steering_queue.get_steering_messages,
        get_follow_up_messages=steering_queue.get_follow_up_messages,
        should_stop=None,
    )

    print_banner()

    if config.mcp_server_script:
        print(f"📡 连接 MCP Server: {config.mcp_server_script}")
        print(
            f"🗄️  数据库: {config.mysql_host}:{config.mysql_port}/{config.mysql_database}"
        )
        print()
    else:
        print("💬 纯对话模式（未配置 MCP Server，无数据库工具）")
        print("   设置 MCP_SERVER_SCRIPT 环境变量以启用数据库查询")
        print()

    context, workspace, session_runtime_services = await _build_cli_context()

    print(f"📂 工作区已就绪: {workspace.session_dir}")
    print(f"🧠 已通过统一装配链加载 {len(context.tools)} 个工具")

    gateway = config_manager.gateway
    if gateway is None:
        raise RuntimeError("Gateway 未初始化")

    try:
        await _chat_loop(context, loop_config, gateway)
    finally:
        registry = session_runtime_services.metadata.get("mcp_registry")
        if registry is not None:
            await registry.shutdown()


async def _chat_loop(
    context: AgentContext,
    config: AgentLoopConfig,
    gateway: AIGateway,
) -> None:
    """交互式聊天循环"""
    while True:
        try:
            user_input = input("👤 你: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n👋 再见！")
            break

        if not user_input:
            continue

        if user_input.lower() in ("quit", "exit", "q", "退出"):
            print("👋 再见！")
            break

        await run_agent_turn(user_input, context, config, gateway)


def main():
    """入口点"""
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        print("\n👋 再见！")


if __name__ == "__main__":
    main()
