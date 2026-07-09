from __future__ import annotations

import json

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

from .models import LoadedSkill, SkillActivationResult


def build_skill_activation_details(
    skill_name: str,
    skill: LoadedSkill,
    *,
    source: str = "tool",
    command_text: str | None = None,
) -> dict:
    model_payload = (
        f'<skill_content name="{skill_name}">\n'
        f"{skill.body}\n\n"
        f"Skill directory: {skill.skill_dir}\n"
        f"Relative paths in this skill are relative to the skill directory.\n"
        f"</skill_content>"
    )

    result = SkillActivationResult(
        skill_name=skill_name,
        location=skill.location,
        skill_dir=skill.skill_dir,
        source_scope=skill.source_scope,
        ui_message=f'<command-message>The "{skill_name}" skill is loading</command-message>',
        model_message_injection=model_payload,
        granted_permissions=list(skill.allowed_tools),
        model_override=skill.model,
        description=skill.description,
        when_to_use=skill.when_to_use,
        command_text=command_text or f"/skill:{skill_name}",
        source=source,
    )
    return result.to_details()


def activate_skill_by_name(
    skill_manager,
    skill_name: str,
    *,
    source: str = "tool",
    command_text: str | None = None,
) -> dict:
    if not skill_name:
        raise ValueError("Missing skill name.")

    skill = skill_manager.get_skill(skill_name)
    if not skill:
        raise KeyError(
            f"Skill '{skill_name}' not found. Make sure it is listed in <available_skills>."
        )

    return build_skill_activation_details(
        skill_name,
        skill,
        source=source,
        command_text=command_text,
    )


def create_skill_tools(skill_manager) -> list[AgentTool]:
    skill_manager.refresh()

    async def _activate_skill(tool_call_id: str, arguments: dict) -> AgentToolResult:
        command = arguments.get("command")
        if not command:
            return AgentToolResult(
                content=[ToolResultContent(type="text", text="Error: Missing 'command' parameter.")],
                is_error=True,
            )

        try:
            result_details = activate_skill_by_name(skill_manager, command, source="tool")
        except (KeyError, ValueError) as exc:
            return AgentToolResult(
                content=[ToolResultContent(type="text", text=f"Error: {exc}")],
                is_error=True,
            )

        return AgentToolResult(
            content=[ToolResultContent(type="text", text=json.dumps(result_details, ensure_ascii=False))],
            details=result_details,
        )

    description = (
        "The following skills provide specialized instructions for specific tasks. "
        "When a task matches a skill's description, call the activate_skill tool "
        "with the skill's name to load its full instructions.\n\n"
        f"{skill_manager.generate_skill_catalog()}"
    )

    return [
        AgentTool(
            name="activate_skill",
            label="Activate Skill",
            description=description,
            parameters={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The exact name of the skill to activate (no arguments)",
                    }
                },
                "required": ["command"],
            },
            execute_fn=_activate_skill,
            read_only=False,
            resource="session",
            max_concurrency=1,
        )
    ]
