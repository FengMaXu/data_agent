from __future__ import annotations

from src.skills.models import ActiveSkillState


class SkillRuntimeState:
    def __init__(self):
        self._active_skills: list[ActiveSkillState] = []

    def record_activation(self, details: dict) -> ActiveSkillState:
        skill_state = ActiveSkillState.from_activation_details(details)
        self._active_skills.append(skill_state)
        return skill_state

    def list_active_skills(self) -> list[ActiveSkillState]:
        return list(self._active_skills)

    def to_dict(self) -> list[dict]:
        return [skill.to_dict() for skill in self._active_skills]

    @classmethod
    def from_dict(cls, items: list[dict] | None) -> "SkillRuntimeState":
        state = cls()
        for item in items or []:
            state._active_skills.append(ActiveSkillState(**item))
        return state

    def clear(self) -> None:
        self._active_skills.clear()
