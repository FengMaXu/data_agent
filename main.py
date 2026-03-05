"""
企业级数据智能体 - 主入口
CLI 交互式聊天界面
"""

from __future__ import annotations

import asyncio
import logging
import sys

from src.ai.config import AIConfig
from src.ai.gateway import AIGateway
from src.ai.base_provider import Message, Role
from src.agent.agent_loop import agent_loop
from src.agent.types import AgentContext, AgentLoopConfig, AgentEvent, AgentEventType
from src.mcp.mcp_client import MCPClient
from src.mcp.db_tools import create_db_tools
from src.mcp.sql_guard import SQLGuard
from src.context.metadata_store import MetadataStore
from src.context.annotations import AnnotationStore
from src.context.query_patterns import QueryPatternStore
from src.interaction.clarification import create_clarification_tool
from src.interaction.sql_evaluator import SQLEvaluator
from src.interaction.skill_registry import SkillRegistry, register_builtin_skills
from src.learning.learning_store import LearningStore
from src.learning.feedback import FeedbackCollector
from src.workspace.workspace_manager import WorkspaceManager
from src.workspace.file_tools import create_file_tools
from src.workspace.code_executor import CodeExecutor, create_code_tools
from src.ecosystem.mcp_registry import MCPRegistry
from src.ecosystem.http_hooks import HttpHookRegistry, create_http_tools
from src.prompts import SYSTEM_PROMPT

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


async def main_async():
    """异步主函数"""
    config = AIConfig.from_env()

    # 验证配置
    if not config.openai_api_key and not config.anthropic_api_key:
        print("⚠️  未检测到 API Key！")
        print("请在项目根目录创建 .env 文件：")
        print("  OPENAI_API_KEY=sk-...")
        print("  # 或")
        print("  ANTHROPIC_API_KEY=sk-ant-...")
        print()

    gateway = AIGateway(config)
    steering_queue = SteeringQueue()

    # Agent Loop 配置
    loop_config = AgentLoopConfig(
        model=config.default_model,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        get_steering_messages=steering_queue.get_steering_messages,
        get_follow_up_messages=steering_queue.get_follow_up_messages,
    )

    print_banner()

    # 判断是否连接 MCP Server
    if config.mcp_server_script:
        print(f"📡 连接 MCP Server: {config.mcp_server_script}")
        print(
            f"🗄️  数据库: {config.mysql_host}:{config.mysql_port}/{config.mysql_database}"
        )
        print()

        async with MCPClient.connect(
            command=config.mcp_server_command,
            script=config.mcp_server_script,
            env=config.get_mcp_env(),
        ) as mcp_client:
            guard = SQLGuard(strict=True)

            # 阶段一：数据库工具（使用沙箱验证版 execute_sql）
            tools = create_db_tools(mcp_client, guard)
            # 替换 execute_sql 为带沙箱验证的版本
            evaluator = SQLEvaluator(mcp_client, guard)
            tools = [t for t in tools if t.name != "execute_sql"]
            tools.append(evaluator.create_validated_execute_tool())

            # 阶段二：上下文引擎工具
            metadata_store = MetadataStore(mcp_client)
            tools.extend(metadata_store.create_tools())

            annotation_store = AnnotationStore()
            annotation_store.load()
            tools.extend(annotation_store.create_tools())

            query_store = QueryPatternStore()
            query_store.load()
            tools.extend(query_store.create_tools())

            # 阶段三：主动澄清 + 技能
            tools.append(create_clarification_tool(_cli_clarification_callback))

            skill_registry = SkillRegistry()
            register_builtin_skills(skill_registry)
            tools.extend(skill_registry.create_tools())

            # 阶段四：错题本 + 反馈
            learning_store = LearningStore()
            tools.extend(learning_store.create_tools())

            feedback_collector = FeedbackCollector(learning_store)
            tools.extend(feedback_collector.create_tools())

            # ────── 【新增】工作区 & 代码执行 ──────
            workspace = WorkspaceManager()
            tools.extend(create_file_tools(workspace))
            code_executor = CodeExecutor(workspace)
            tools.extend(create_code_tools(code_executor))
            print(f"📂 工作区已就绪: {workspace.session_dir}")

            # ────── 【新增】外部生态 MCP 注册表 ──────
            mcp_registry = MCPRegistry()
            # 可在此处通过配置文件动态注册外部 MCP Server：
            # mcp_registry.register("knowledge", command="python", script="kb_mcp.py")

            # ────── 【新增】外部 HTTP API Hooks ──────
            http_registry = HttpHookRegistry()
            # 可在此处注册外部 REST API：
            # http_registry.register("weather", url="https://api.weather.com/v1", ...)
            http_tools = create_http_tools(http_registry)
            tools.extend(http_tools)

            print(
                f"🧠 已加载全部模块：上下文引擎 + 沙箱验证 + 主动澄清 + "
                f"{len(skill_registry.list_skills())} 技能 + 错题本({learning_store.get_stats()['total']}条) "
                f"+ 工作区(代码执行) + 外部生态({len(http_tools)} API)"
            )

            context = AgentContext(
                system_prompt=SYSTEM_PROMPT,
                tools=tools,
            )
            await _chat_loop(context, loop_config, gateway)
    else:
        print("💬 纯对话模式（未配置 MCP Server，无数据库工具）")
        print("   设置 MCP_SERVER_SCRIPT 环境变量以启用数据库查询")
        print()

        tools = []
        annotation_store = AnnotationStore()
        annotation_store.load()
        tools.extend(annotation_store.create_tools())

        query_store = QueryPatternStore()
        query_store.load()
        tools.extend(query_store.create_tools())

        # 主动澄清 + 技能（纯对话模式也可用）
        tools.append(create_clarification_tool(_cli_clarification_callback))

        skill_registry = SkillRegistry()
        register_builtin_skills(skill_registry)
        tools.extend(skill_registry.create_tools())

        # 错题本 + 反馈（纯对话模式也可用）
        learning_store = LearningStore()
        tools.extend(learning_store.create_tools())

        feedback_collector = FeedbackCollector(learning_store)
        tools.extend(feedback_collector.create_tools())

        # ────── 【新增】工作区 & 代码执行（纯对话模式也可用）──────
        workspace = WorkspaceManager()
        tools.extend(create_file_tools(workspace))
        code_executor = CodeExecutor(workspace)
        tools.extend(create_code_tools(code_executor))
        print(f"📂 工作区已就绪: {workspace.session_dir}")

        # ────── 【新增】外部生态 ──────
        http_registry = HttpHookRegistry()
        http_tools = create_http_tools(http_registry)
        tools.extend(http_tools)

        context = AgentContext(
            system_prompt=SYSTEM_PROMPT,
            tools=tools,
        )
        await _chat_loop(context, loop_config, gateway)


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
