import tempfile
from pathlib import Path

from src.agent.types import AgentContext
from src.api.agent import _apply_slash_skill_activation
from src.prompts import load_system_prompt
from src.skills import create_project_skill_manager


def test_apply_slash_skill_activation_injects_messages(monkeypatch):
    root = Path(tempfile.mkdtemp())
    skill_dir = root / ".agents" / "skills" / "demo-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: demo-skill\n"
        "description: Demo skill\n"
        "when_to_use: When the user wants a deterministic workflow\n"
        "allowed-tools:\n"
        "  - run_python\n"
        "model: claude-sonnet\n"
        "---\n"
        "# Demo\n"
        "Do the thing.\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "src.api.agent._build_skill_manager",
        lambda: create_project_skill_manager(root),
    )

    context = AgentContext(system_prompt="test", messages=[])
    prompt = _apply_slash_skill_activation("/skill:demo-skill continue", context)

    assert prompt == "continue"
    assert len(context.messages) == 2
    active = context.active_skills.list_active_skills()
    assert len(active) == 1
    assert active[0].name == "demo-skill"
    assert active[0].source == "slash_command"
    assert active[0].granted_permissions == ["run_python"]
    assert active[0].model_override == "claude-sonnet"


def test_load_system_prompt_includes_skill_rules_and_catalog():
    root = Path(tempfile.mkdtemp())
    skill_dir = root / ".agents" / "skills" / "demo-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: demo-skill\n"
        "description: Demo skill\n"
        "when_to_use: When the user wants a deterministic workflow\n"
        "---\n"
        "# Demo\n"
        "Do the thing.\n",
        encoding="utf-8",
    )

    prompt = load_system_prompt(root)

    assert "当用户显式输入 `/skill:name` 时，必须激活对应 skill。" in prompt
    assert "<available_skills>" in prompt
    assert "<name>demo-skill</name>" in prompt
