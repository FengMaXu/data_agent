from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class LoadedSkill:
    name: str
    description: str
    when_to_use: str = ""
    location: str = ""
    skill_dir: str = ""
    body: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    model: str | None = None
    source_scope: str = "project"


@dataclass
class SkillActivationResult:
    skill_name: str
    location: str
    skill_dir: str
    source_scope: str
    ui_message: str
    model_message_injection: str
    granted_permissions: list[str] = field(default_factory=list)
    model_override: str | None = None
    description: str = ""
    when_to_use: str = ""
    command_text: str = ""
    success: bool = True
    source: str = "tool"

    def to_details(self) -> dict:
        return {
            "_is_skill_activation": True,
            "command_name": self.skill_name,
            "success": self.success,
            "source": self.source,
            "command_text": self.command_text,
            "ui_message": self.ui_message,
            "model_message_injection": self.model_message_injection,
            "granted_permissions": self.granted_permissions,
            "model_override": self.model_override,
            "skill": {
                "name": self.skill_name,
                "description": self.description,
                "when_to_use": self.when_to_use,
                "location": self.location,
                "skill_dir": self.skill_dir,
                "source_scope": self.source_scope,
            },
            "location": self.location,
            "source_scope": self.source_scope,
        }


@dataclass
class SkillCommandParseResult:
    skill_name: str
    remainder: str = ""
    raw_command: str = ""


@dataclass
class ActiveSkillState:
    name: str
    source: str
    command_text: str = ""
    location: str = ""
    skill_dir: str = ""
    source_scope: str = "project"
    description: str = ""
    when_to_use: str = ""
    granted_permissions: list[str] = field(default_factory=list)
    model_override: str | None = None
    ui_message: str = ""

    @classmethod
    def from_activation_details(cls, details: dict) -> "ActiveSkillState":
        skill_meta = details.get("skill") or {}
        return cls(
            name=skill_meta.get("name") or details.get("command_name", ""),
            source=details.get("source", "tool"),
            command_text=details.get("command_text", ""),
            location=skill_meta.get("location") or details.get("location", ""),
            skill_dir=skill_meta.get("skill_dir", ""),
            source_scope=skill_meta.get("source_scope") or details.get("source_scope", "project"),
            description=skill_meta.get("description", ""),
            when_to_use=skill_meta.get("when_to_use", ""),
            granted_permissions=list(details.get("granted_permissions", []) or []),
            model_override=details.get("model_override"),
            ui_message=details.get("ui_message", ""),
        )

    def to_dict(self) -> dict:
        return asdict(self)
