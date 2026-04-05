from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class QueryPatternSection:
    title: str
    level: int
    body: str
    source_path: str
    score: int
    keywords: list[str]
    sql_blocks: list[str]


class QueryPatternRetriever:
    """从 knowledge/doc/query_patterns.md 中提取最相关的查询模板片段。"""

    def __init__(self, doc_path: str | Path):
        self.doc_path = Path(doc_path)

    def search(self, query: str, max_results: int = 3) -> list[QueryPatternSection]:
        if not self.doc_path.exists():
            return []

        content = self.doc_path.read_text(encoding="utf-8")
        sections = self._parse_sections(content)
        keywords = self._extract_keywords(query)
        query_lower = query.strip().lower()

        scored: list[QueryPatternSection] = []
        for section in sections:
            score, matched = self._score_section(section, query_lower, keywords)
            if score <= 0:
                continue
            scored.append(
                QueryPatternSection(
                    title=section.title,
                    level=section.level,
                    body=section.body,
                    source_path=section.source_path,
                    score=score,
                    keywords=matched,
                    sql_blocks=section.sql_blocks,
                )
            )

        scored.sort(key=lambda item: (-item.score, item.level, item.title))
        return scored[:max_results]

    def format_results(self, query: str, matches: list[QueryPatternSection]) -> str:
        if not matches:
            return (
                f"未在 doc/query_patterns.md 中找到与“{query}”直接匹配的查询模板。"
                "请改用 search_knowledge / read_knowledge_file 补充查阅知识文档。"
            )

        lines = [
            "# 查询模板检索结果",
            "",
            f'问题: "{query}"',
            f"命中模板数: {len(matches)}",
            "",
            "使用建议: 若命中模板足够贴近，直接改写 SQL 并执行；不要先做通用知识搜索。",
            "",
        ]

        for index, match in enumerate(matches, start=1):
            lines.append(f"## {index}. {match.title} (评分 {match.score})")
            lines.append(f"来源: {match.source_path}")
            if match.keywords:
                lines.append("命中关键词: " + ", ".join(match.keywords))
            lines.append("适用片段:")
            lines.append("```")
            lines.extend(self._snippet_lines(match.body))
            lines.append("```")
            if match.sql_blocks:
                lines.append("示例 SQL:")
                lines.append("```sql")
                lines.append(match.sql_blocks[0].strip())
                lines.append("```")
            lines.append("")

        lines.append("若这些模板仍不足以回答，再回退到 search_knowledge / read_knowledge_file / schema 工具。")
        return "\n".join(lines).rstrip()

    def _parse_sections(self, content: str) -> list[QueryPatternSection]:
        sections: list[QueryPatternSection] = []
        current_title: str | None = None
        current_level = 0
        current_lines: list[str] = []

        def flush() -> None:
            nonlocal current_title, current_level, current_lines
            if current_title is None:
                current_lines = []
                return
            body = "\n".join(current_lines).strip()
            if body:
                sections.append(
                    QueryPatternSection(
                        title=current_title,
                        level=current_level,
                        body=body,
                        source_path="doc/query_patterns.md",
                        score=0,
                        keywords=[],
                        sql_blocks=self._extract_sql_blocks(body),
                    )
                )
            current_lines = []

        for raw_line in content.splitlines():
            line = raw_line.rstrip()
            if line.startswith("##"):
                flush()
                current_level = len(line) - len(line.lstrip("#"))
                current_title = line.lstrip("#").strip()
                continue
            if current_title is not None:
                current_lines.append(line)

        flush()
        return sections

    def _score_section(
        self,
        section: QueryPatternSection,
        query_lower: str,
        keywords: list[str],
    ) -> tuple[int, list[str]]:
        title_lower = section.title.lower()
        body_lower = section.body.lower()
        score = 0
        matched: list[str] = []

        if query_lower and query_lower in title_lower:
            score += 12
            matched.append(query_lower)
        if query_lower and query_lower in body_lower:
            score += 16
            if query_lower not in matched:
                matched.append(query_lower)

        for keyword in keywords:
            keyword_score = 0
            if keyword in title_lower:
                keyword_score += 5
            if keyword in body_lower:
                keyword_score += 4
            if keyword_score:
                score += keyword_score
                if keyword not in matched:
                    matched.append(keyword)

        if section.sql_blocks:
            score += 3
        if "参数说明" in section.body:
            score += 2
        return score, matched

    def _extract_keywords(self, query: str) -> list[str]:
        tokens = re.split(r"[\s,，。？！、；;：:（）()\[\]{}<>《》“”‘’\"'`|\-_/]+", query.lower())
        keywords: list[str] = []
        seen: set[str] = set()
        for token in tokens:
            normalized = token.strip()
            if len(normalized) < 2 or normalized in seen:
                continue
            keywords.append(normalized)
            seen.add(normalized)
        if not keywords and query.strip():
            keywords.append(query.strip().lower())
        return keywords

    def _extract_sql_blocks(self, body: str) -> list[str]:
        return [match.strip() for match in re.findall(r"```sql\s*(.*?)```", body, re.IGNORECASE | re.DOTALL)]

    def _snippet_lines(self, body: str, limit: int = 14) -> list[str]:
        lines = [line for line in body.splitlines() if line.strip()]
        if len(lines) <= limit:
            return lines
        return [*lines[:limit], "... [片段已截断]"]
