"""
System Prompt 构建器
运行时从 knowledge/agent.md 加载系统提示词，不再使用硬编码字符串。
"""

import logging
from pathlib import Path

from src.skills import create_project_skill_manager

logger = logging.getLogger("data_agent.prompts")

# knowledge 目录
KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent / "knowledge"
AGENT_MD = KNOWLEDGE_ROOT / "agent.md"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _build_skill_prompt_block(project_root: Path | None = None) -> str:
    manager = create_project_skill_manager(project_root or PROJECT_ROOT)
    catalog = manager.generate_skill_catalog()
    return (
        "\n\n## Skills\n\n"
        "以下是当前会话可用的文件型 Skills。\n"
        "当任务与某个 skill 描述匹配时，优先调用 `activate_skill` 加载该 skill。\n"
        "当用户显式输入 `/skill:name` 时，必须激活对应 skill。\n"
        "激活后，必须遵循 skill 正文中的流程与约束。\n\n"
        f"{catalog}"
    )


def load_system_prompt(project_root: Path | None = None) -> str:
    """
    从 knowledge/agent.md 加载系统提示词，并追加当前可用 skill catalog。
    如果文件不存在则返回最小化的 fallback。
    """
    base_prompt = ""
    if AGENT_MD.exists():
        try:
            base_prompt = AGENT_MD.read_text(encoding="utf-8").strip()
            logger.info(
                f"[Prompt] 已从 {AGENT_MD} 加载系统提示词 ({len(base_prompt)} 字符)"
            )
        except Exception as e:
            logger.error(f"[Prompt] 加载 agent.md 失败: {e}")

    if not base_prompt:
        logger.warning("[Prompt] agent.md 不存在，使用 fallback 提示词")
        base_prompt = (
            "你是一位企业数据分析师 AI 助手。"
            "使用提供的工具查询数据库、分析数据并回答用户问题。用中文回答。"
        )

    return base_prompt + _build_skill_prompt_block(project_root)


# 向后兼容：保留 SYSTEM_PROMPT 变量名，但改为动态加载
SYSTEM_PROMPT = load_system_prompt()
