from __future__ import annotations

import re

from .models import SkillCommandParseResult

_SKILL_COMMAND_RE = re.compile(r"^/skill:([^\s]+)(?:\s+(.*))?$", re.DOTALL)


def parse_skill_command(prompt: str) -> SkillCommandParseResult | None:
    text = prompt.strip()
    match = _SKILL_COMMAND_RE.match(text)
    if not match:
        return None

    skill_name = match.group(1).strip()
    remainder = (match.group(2) or "").strip()
    if not skill_name:
        return None

    return SkillCommandParseResult(
        skill_name=skill_name,
        remainder=remainder,
        raw_command=text,
    )
