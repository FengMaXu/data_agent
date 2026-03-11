from __future__ import annotations

from .models import LoadedSkill


def generate_skill_catalog(skills: list[LoadedSkill]) -> str:
    if not skills:
        return "<available_skills/>"

    catalog = "<available_skills>\n"
    for skill in sorted(skills, key=lambda item: item.name):
        desc = skill.description
        if skill.when_to_use:
            desc += f" - {skill.when_to_use}"

        catalog += "  <skill>\n"
        catalog += f"    <name>{skill.name}</name>\n"
        catalog += f"    <description>{desc}</description>\n"
        catalog += f"    <location>{skill.location}</location>\n"
        catalog += f"    <source_scope>{skill.source_scope}</source_scope>\n"
        catalog += "  </skill>\n"

    catalog += "</available_skills>"
    return catalog
