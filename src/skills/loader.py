from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

import yaml

from .catalog import generate_skill_catalog
from .models import LoadedSkill

logger = logging.getLogger("data_agent.skills.loader")

MAX_NAME_LENGTH = 64
_VALID_NAME_RE = re.compile(r"^[a-z0-9-]+$")
USER_DATA_AGENT_ROOT = Path.home() / ".data_agent"
SHARED_SKILLS_ROOT = USER_DATA_AGENT_ROOT / "skills"
LEGACY_USER_SKILLS_ROOT = Path.home() / ".agents" / "skills"


def _validate_name(name: str, parent_dir_name: str, file_path: Path) -> list[str]:
    """Validate skill name per Agent Skills spec. Returns list of warning strings."""
    warnings: list[str] = []

    if name != parent_dir_name:
        warnings.append(
            f'name "{name}" does not match parent directory "{parent_dir_name}" ({file_path})'
        )

    if len(name) > MAX_NAME_LENGTH:
        warnings.append(
            f"name exceeds {MAX_NAME_LENGTH} characters ({len(name)}) ({file_path})"
        )

    if not _VALID_NAME_RE.match(name):
        warnings.append(
            f"name contains invalid characters (must be lowercase a-z, 0-9, hyphens only) ({file_path})"
        )

    if name.startswith("-") or name.endswith("-"):
        warnings.append(f"name must not start or end with a hyphen ({file_path})")

    if "--" in name:
        warnings.append(f"name must not contain consecutive hyphens ({file_path})")

    return warnings


class SkillManager:
    """Manages discovery, parsing, and cataloging of file-based skills."""

    def __init__(self, search_paths: list[str | Path]):
        self.search_paths = [Path(path) for path in search_paths]
        self.skills: dict[str, LoadedSkill] = {}

    def _resolve_source_scope(self, search_path: Path) -> str:
        global_skill_roots = {
            SHARED_SKILLS_ROOT.resolve(),
            LEGACY_USER_SKILLS_ROOT.resolve(),
        }
        resolved_search_path = search_path.resolve()
        if any(
            resolved_search_path == root or root in resolved_search_path.parents
            for root in global_skill_roots
        ):
            return "global"
        return "project"

    def _parse_yaml_and_body(self, file_path: Path) -> tuple[dict[str, Any], str]:
        try:
            content = file_path.read_text(encoding="utf-8")
            if not content.startswith("---"):
                return {}, content

            end_idx = content.find("---", 3)
            if end_idx == -1:
                return {}, content

            yaml_content = content[3:end_idx].strip()
            body_content = content[end_idx + 3 :].strip()
            try:
                frontmatter = yaml.safe_load(yaml_content) or {}
                return frontmatter, body_content
            except yaml.YAMLError as exc:
                logger.warning(f"Failed to parse YAML in {file_path}: {exc}")
                return {}, content
        except Exception as exc:
            logger.error(f"Error reading skill file {file_path}: {exc}")
            return {}, ""

    def discover_and_parse(self):
        self.skills = {}
        discovered: dict[str, LoadedSkill] = {}

        for path in self.search_paths:
            if not path.exists():
                continue

            source_scope = self._resolve_source_scope(path)
            for root, dirs, files in os.walk(path):
                if ".git" in dirs:
                    dirs.remove(".git")
                if "node_modules" in dirs:
                    dirs.remove("node_modules")

                if "SKILL.md" not in files:
                    continue

                file_path = Path(root) / "SKILL.md"
                frontmatter, body = self._parse_yaml_and_body(file_path)
                if "name" not in frontmatter or "description" not in frontmatter:
                    logger.warning(
                        f"SKILL.md at {file_path} is missing required 'name' or 'description' in frontmatter."
                    )
                    continue

                skill_name = str(frontmatter["name"]).strip()
                if not skill_name:
                    continue

                # Validate name format and directory consistency
                parent_dir_name = Path(root).name
                name_warnings = _validate_name(skill_name, parent_dir_name, file_path)
                for w in name_warnings:
                    logger.warning(f"[Skill] {w}")

                # Project-priority deduplication: first-found wins (search_paths
                # are ordered project-first, global-second)
                if skill_name in discovered:
                    existing = discovered[skill_name]
                    logger.warning(
                        f'[Skill] name "{skill_name}" collision: '
                        f"keeping {existing.source_scope} ({existing.location}), "
                        f"skipping {source_scope} ({file_path})"
                    )
                    continue

                discovered[skill_name] = LoadedSkill(
                    name=skill_name,
                    description=str(frontmatter["description"]),
                    when_to_use=str(frontmatter.get("when_to_use", "") or ""),
                    location=str(file_path),
                    skill_dir=str(Path(root)),
                    body=body,
                    allowed_tools=list(frontmatter.get("allowed-tools", []) or []),
                    model=frontmatter.get("model"),
                    source_scope=source_scope,
                )

        self.skills = discovered

    def refresh(self) -> dict[str, LoadedSkill]:
        self.discover_and_parse()
        return self.skills

    def get_skill(self, skill_name: str) -> LoadedSkill | None:
        return self.refresh().get(skill_name)

    def list_skills(self) -> list[LoadedSkill]:
        self.refresh()
        return [self.skills[name] for name in sorted(self.skills.keys())]

    def generate_skill_catalog(self) -> str:
        return generate_skill_catalog(self.list_skills())


def get_default_skill_search_paths(project_root: str | Path) -> list[Path]:
    project_root = Path(project_root)
    shared_root = ensure_shared_skill_root(project_root)
    return [shared_root]


def create_project_skill_manager(project_root: str | Path) -> SkillManager:
    return SkillManager(get_default_skill_search_paths(project_root))


def ensure_shared_skill_root(project_root: str | Path) -> Path:
    project_root = Path(project_root)
    shared_root = SHARED_SKILLS_ROOT
    shared_root.mkdir(parents=True, exist_ok=True)

    legacy_roots = [
        project_root / ".agents" / "skills",
        LEGACY_USER_SKILLS_ROOT,
    ]
    for legacy_root in legacy_roots:
        _migrate_skills_into_shared_root(legacy_root, shared_root)

    return shared_root


def _migrate_skills_into_shared_root(source_root: Path, target_root: Path) -> None:
    if not source_root.exists() or not source_root.is_dir():
        return

    for child in source_root.iterdir():
        if child.name.startswith(".") or not child.is_dir():
            continue

        skill_manifest = child / "SKILL.md"
        if not skill_manifest.exists():
            continue

        target_dir = target_root / child.name
        if target_dir.exists():
            continue

        try:
            shutil.copytree(child, target_dir)
            logger.info(
                "[Skill] migrated legacy skill directory from %s to %s",
                child,
                target_dir,
            )
        except Exception as exc:
            logger.warning(
                "[Skill] failed to migrate %s to %s: %s",
                child,
                target_dir,
                exc,
            )

