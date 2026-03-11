import tempfile
from pathlib import Path

import pytest

from src.context.skill_activation import SkillManager, create_skill_tools


@pytest.mark.asyncio
async def test_skill_activation():
    root = Path(tempfile.mkdtemp())
    skill_dir = root / "test-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: test-skill\n"
        "description: A skill for testing the activation tool.\n"
        "when_to_use: When running tests.\n"
        "allowed-tools:\n"
        "  - Bash(echo:*)\n"
        "---\n"
        "# Workflow\n"
        "1. Do something cool\n",
        encoding="utf-8",
    )

    manager = SkillManager(search_paths=[root])
    manager.discover_and_parse()
    tool = create_skill_tools(manager)[0]

    assert "test-skill" in manager.skills
    assert manager.skills["test-skill"].source_scope == "project"

    description = tool.description
    assert "<available_skills>" in description
    assert "<name>test-skill</name>" in description
    assert "<source_scope>project</source_scope>" in description

    result_obj = await tool.execute(
        tool_call_id="mock_test", arguments={"command": "test-skill"}
    )
    result = result_obj.details

    assert result.get("success") is True
    assert result.get("_is_skill_activation") is True
    assert result.get("granted_permissions") == ["Bash(echo:*)"]
    assert result.get("source_scope") == "project"
    assert result["skill"]["source_scope"] == "project"
    assert '<skill_content name="test-skill">' in result.get(
        "model_message_injection", ""
    )
