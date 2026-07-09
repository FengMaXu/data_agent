from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from .config import AIConfig

LLMProvider = Literal["openai", "anthropic"]


@dataclass
class LLMProfile:
    id: str
    name: str
    provider: LLMProvider
    model: str
    base_url: str = ""
    api_key_ref: str = ""
    enabled: bool = True
    is_default: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LLMProfile":
        provider = data.get("provider")
        if provider not in {"openai", "anthropic"}:
            provider = "anthropic" if str(data.get("model", "")).startswith("claude-") else "openai"
        model = str(data.get("model") or "gpt-4o-mini")
        api_key_ref = str(data.get("api_key_ref") or _default_api_key_ref(provider))
        return cls(
            id=str(data.get("id") or _make_profile_id(provider, model)),
            name=str(data.get("name") or model),
            provider=provider,
            model=model,
            base_url=str(data.get("base_url") or ""),
            api_key_ref=api_key_ref,
            enabled=bool(data.get("enabled", True)),
            is_default=bool(data.get("is_default", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LLMProfileStore:
    """Persistent non-secret LLM profile store."""

    def __init__(self, path: Path, legacy_config: AIConfig):
        self.path = path
        self.legacy_config = legacy_config
        self._profiles: list[LLMProfile] | None = None

    def list_profiles(self) -> list[LLMProfile]:
        self._ensure_loaded()
        return list(self._profiles or [])

    def default_profile(self) -> LLMProfile:
        self._ensure_loaded()
        profiles = self._profiles or []
        for profile in profiles:
            if profile.is_default:
                return profile
        if profiles:
            profiles[0].is_default = True
            self._save()
            return profiles[0]
        profile = self._legacy_profile()
        profile.is_default = True
        self._profiles = [profile]
        self._save()
        return profile

    def upsert_profile(self, data: dict[str, Any], *, make_default: bool = False) -> LLMProfile:
        self._ensure_loaded()
        profile = LLMProfile.from_dict(data)
        profiles = self._profiles or []
        replaced = False
        for index, existing in enumerate(profiles):
            if existing.id == profile.id:
                profile.is_default = make_default or existing.is_default or profile.is_default
                profiles[index] = profile
                replaced = True
                break
        if not replaced:
            profile.is_default = make_default or profile.is_default or not profiles
            profiles.append(profile)

        if profile.is_default:
            for item in profiles:
                item.is_default = item.id == profile.id

        self._profiles = profiles
        self._save()
        return profile

    def set_default(self, profile_id: str) -> LLMProfile:
        self._ensure_loaded()
        profiles = self._profiles or []
        for profile in profiles:
            if profile.id == profile_id:
                profile.is_default = True
                profile.enabled = True
                for item in profiles:
                    if item.id != profile_id:
                        item.is_default = False
                self._save()
                return profile
        raise KeyError(f"LLM profile not found: {profile_id}")

    def delete_profile(self, profile_id: str) -> None:
        self._ensure_loaded()
        profiles = self._profiles or []
        removed_default = any(p.id == profile_id and p.is_default for p in profiles)
        remaining = [p for p in profiles if p.id != profile_id]
        if len(remaining) == len(profiles):
            raise KeyError(f"LLM profile not found: {profile_id}")
        if removed_default and remaining:
            remaining[0].is_default = True
        self._profiles = remaining
        self._save()

    def apply_default_to(self, config: AIConfig) -> AIConfig:
        profile = self.default_profile()
        config.default_model = profile.model
        if profile.provider == "openai":
            config.openai_base_url = profile.base_url
        return config

    def _ensure_loaded(self) -> None:
        if self._profiles is not None:
            return
        if not self.path.exists():
            self._profiles = [self._legacy_profile()]
            self._profiles[0].is_default = True
            self._save()
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        raw_profiles = data.get("profiles") if isinstance(data, dict) else None
        profiles = [
            LLMProfile.from_dict(item)
            for item in raw_profiles or []
            if isinstance(item, dict)
        ]
        if not profiles:
            profiles = [self._legacy_profile()]
        if not any(profile.is_default for profile in profiles):
            profiles[0].is_default = True
        self._profiles = profiles
        self._save()

    def _save(self) -> None:
        profiles = self._profiles or []
        self.path.parent.mkdir(parents=True, exist_ok=True)
        default_profile_id = ""
        for profile in profiles:
            if profile.is_default:
                default_profile_id = profile.id
                break
        payload = {
            "version": 1,
            "default_profile_id": default_profile_id,
            "profiles": [profile.to_dict() for profile in profiles],
        }
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _legacy_profile(self) -> LLMProfile:
        model = self.legacy_config.default_model or "gpt-4o-mini"
        provider: LLMProvider = "anthropic" if model.startswith("claude-") else "openai"
        return LLMProfile(
            id=_make_profile_id(provider, model),
            name=model,
            provider=provider,
            model=model,
            base_url=self.legacy_config.openai_base_url if provider == "openai" else "",
            api_key_ref=_default_api_key_ref(provider),
            enabled=True,
            is_default=True,
        )


def _default_api_key_ref(provider: str) -> str:
    return "anthropic_api_key" if provider == "anthropic" else "openai_api_key"


def _make_profile_id(provider: str, model: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", model.lower()).strip("-") or "model"
    return f"{provider}-{slug}"
