"""
知识库工具集 (Knowledge Tools)

提供对 knowledge/ 目录下 .md 文档的搜索、读取、写入能力。
统一替代原先分散的 grep_tool / AnnotationStore。

目录结构:
  knowledge/
  ├── agent.md              ← agent 人设
  └── doc/
      ├── business.md       ← 业务指标、规则、陷阱
      ├── db_schema.md      ← 表结构
      ├── rules.md          ← SQL 编写规范
      ├── query_patterns.md ← SQL 模板
      └── learning.md       ← 错题本
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

from src.context.query_pattern_retriever import QueryPatternRetriever

logger = logging.getLogger("data_agent.context.knowledge_tools")

# 知识库根目录（项目根目录下的 knowledge/）
KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent.parent / "knowledge"
QUERY_PATTERNS_PATH = KNOWLEDGE_ROOT / "doc" / "query_patterns.md"
DEFAULT_CONTEXT_LINES = 3
DEFAULT_MAX_RESULTS = 8
MAX_CONTEXT_LINES = 10
MAX_RESULTS = 20


@dataclass
class KnowledgeSearchHit:
    file_path: Path
    line_number: int
    score: int
    heading: str
    matched_terms: list[str]
    formatted_context: list[str]


def _safe_resolve(relative_path: str) -> Path:
    """安全解析相对路径，防止逃逸到 knowledge/ 之外"""
    cleaned = os.path.normpath(relative_path)
    if os.path.isabs(cleaned):
        raise ValueError(f"不允许使用绝对路径: {relative_path}")
    resolved = (KNOWLEDGE_ROOT / cleaned).resolve()
    try:
        resolved.relative_to(KNOWLEDGE_ROOT.resolve())
    except ValueError:
        raise ValueError(f"路径逃逸: {relative_path}")
    return resolved



def _discover_md_files() -> list[Path]:
    """递归发现 knowledge/ 下所有 .md 文件"""
    if not KNOWLEDGE_ROOT.exists():
        return []
    return sorted(KNOWLEDGE_ROOT.rglob("*.md"))



def _clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))



def _extract_keywords(query: str) -> list[str]:
    tokens = re.split(r"[\s,，。？！、；;：:（）()\[\]{}<>《》“”‘’\"'`|\-_/]+", query.lower())
    keywords: list[str] = []
    seen: set[str] = set()

    for token in tokens:
        normalized = token.strip()
        if len(normalized) < 2 or normalized in seen:
            continue
        keywords.append(normalized)
        seen.add(normalized)

    if not keywords:
        normalized_query = query.strip().lower()
        if normalized_query:
            keywords.append(normalized_query)

    return keywords



def _format_match_context(lines: list[str], line_index: int, context_lines: int) -> list[str]:
    start = max(0, line_index - context_lines)
    end = min(len(lines), line_index + context_lines + 1)

    formatted_context = []
    for line_num, ctx_line in enumerate(lines[start:end], start=start + 1):
        marker = " >>> " if line_num == line_index + 1 else "     "
        formatted_context.append(f"{marker}{line_num:4d} | {ctx_line}")
    return formatted_context



def _score_line(
    query_lower: str,
    keywords: list[str],
    line: str,
    heading: str,
    file_path: Path,
) -> tuple[int, list[str]]:
    line_lower = line.lower()
    heading_lower = heading.lower()
    file_lower = str(file_path.relative_to(KNOWLEDGE_ROOT)).lower()

    score = 0
    matched_terms: list[str] = []

    if query_lower and query_lower in line_lower:
        score += 12
        matched_terms.append(query_lower)
    elif query_lower and heading_lower and query_lower in heading_lower:
        score += 8
        matched_terms.append(query_lower)

    line_hits = [kw for kw in keywords if kw in line_lower]
    heading_hits = [kw for kw in keywords if kw in heading_lower and kw not in line_hits]
    file_hits = [
        kw for kw in keywords
        if kw in file_lower and kw not in line_hits and kw not in heading_hits
    ]

    score += len(line_hits) * 4
    score += len(heading_hits) * 2
    score += len(file_hits)

    seen: set[str] = set(matched_terms)
    for kw in [*line_hits, *heading_hits, *file_hits]:
        if kw not in seen:
            matched_terms.append(kw)
            seen.add(kw)

    return score, matched_terms



def _dedupe_hits(hits: list[KnowledgeSearchHit], context_lines: int) -> list[KnowledgeSearchHit]:
    deduped: list[KnowledgeSearchHit] = []
    for hit in hits:
        is_near_existing = any(
            existing.file_path == hit.file_path
            and existing.heading == hit.heading
            and abs(existing.line_number - hit.line_number) <= context_lines
            for existing in deduped
        )
        if not is_near_existing:
            deduped.append(hit)
    return deduped



def _format_search_results(query: str, search_mode: str, hits: list[KnowledgeSearchHit]) -> str:
    mode_label = "正则" if search_mode == "regex" else "智能关键词"
    lines = [
        "# 知识库搜索结果",
        "",
        f'查询: "{query}"',
        f"模式: {mode_label}",
        f"匹配: {len(hits)} 处",
        "",
    ]

    for index, hit in enumerate(hits, start=1):
        relative_path = hit.file_path.relative_to(KNOWLEDGE_ROOT)
        lines.append(
            f"## {index}. {relative_path} (第 {hit.line_number} 行, 评分 {hit.score})"
        )
        if hit.heading:
            lines.append(f"小节: {hit.heading}")
        if hit.matched_terms:
            lines.append("命中关键词: " + ", ".join(hit.matched_terms))
        lines.append("```")
        lines.extend(hit.formatted_context)
        lines.append("```")
        lines.append("")

    return "\n".join(lines).rstrip()



def _search_hits_by_regex(
    md_files: list[Path],
    query: str,
    context_lines: int,
    max_results: int,
) -> tuple[list[KnowledgeSearchHit], str | None]:
    try:
        pattern = re.compile(query, re.IGNORECASE)
    except re.error as exc:
        return [], f"错误: 非法正则表达式: {exc}"

    hits: list[KnowledgeSearchHit] = []
    for filepath in md_files:
        try:
            lines = filepath.read_text(encoding="utf-8").split("\n")
            current_heading = ""

            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped.startswith("#"):
                    current_heading = stripped.lstrip("# ").strip()

                if not pattern.search(line):
                    continue

                score = 100 if query.lower() in line.lower() else 80
                hits.append(
                    KnowledgeSearchHit(
                        file_path=filepath,
                        line_number=i + 1,
                        score=score,
                        heading=current_heading,
                        matched_terms=[query],
                        formatted_context=_format_match_context(lines, i, context_lines),
                    )
                )
        except Exception as e:
            logger.error(f"[search_knowledge] 读取文件失败 {filepath}: {e}")

    hits.sort(key=lambda item: (-item.score, str(item.file_path), item.line_number))
    return _dedupe_hits(hits, context_lines)[:max_results], None



def _search_hits_by_keywords(
    md_files: list[Path],
    query: str,
    context_lines: int,
    max_results: int,
) -> list[KnowledgeSearchHit]:
    query_lower = query.strip().lower()
    keywords = _extract_keywords(query)
    hits: list[KnowledgeSearchHit] = []

    for filepath in md_files:
        try:
            lines = filepath.read_text(encoding="utf-8").split("\n")
            current_heading = ""

            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped.startswith("#"):
                    current_heading = stripped.lstrip("# ").strip()

                score, matched_terms = _score_line(
                    query_lower=query_lower,
                    keywords=keywords,
                    line=line,
                    heading=current_heading,
                    file_path=filepath,
                )
                if score <= 0:
                    continue

                hits.append(
                    KnowledgeSearchHit(
                        file_path=filepath,
                        line_number=i + 1,
                        score=score,
                        heading=current_heading,
                        matched_terms=matched_terms,
                        formatted_context=_format_match_context(lines, i, context_lines),
                    )
                )
        except Exception as e:
            logger.error(f"[search_knowledge] 读取文件失败 {filepath}: {e}")

    hits.sort(key=lambda item: (-item.score, str(item.file_path), item.line_number))
    return _dedupe_hits(hits, context_lines)[:max_results]


# ─────────────────────────────────────────────
# 工具实现
# ─────────────────────────────────────────────


async def _search_knowledge(tool_call_id: str, arguments: dict) -> AgentToolResult:
    """
    在知识库 .md 文件中搜索内容。

    默认使用更适合自然语言查询的“智能关键词”模式；
    也支持显式切换到 grep 风格的 regex 模式。
    """
    query = str(arguments.get("query", "")).strip()
    context_lines = _clamp_int(
        arguments.get("context_lines"),
        DEFAULT_CONTEXT_LINES,
        0,
        MAX_CONTEXT_LINES,
    )
    max_results = _clamp_int(
        arguments.get("max_results"),
        DEFAULT_MAX_RESULTS,
        1,
        MAX_RESULTS,
    )
    search_mode = str(arguments.get("mode", "smart") or "smart").strip().lower()

    if not query:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 必须提供 query 参数")],
            is_error=True,
        )

    if search_mode not in {"smart", "regex"}:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: mode 仅支持 smart 或 regex")],
            is_error=True,
        )

    md_files = await asyncio.to_thread(_discover_md_files)
    if not md_files:
        return AgentToolResult(
            content=[ToolResultContent(text="知识库为空，未找到任何 .md 文件。")]
        )

    if search_mode == "regex":
        hits, error_message = await asyncio.to_thread(
            _search_hits_by_regex,
            md_files=md_files,
            query=query,
            context_lines=context_lines,
            max_results=max_results,
        )
        if error_message:
            return AgentToolResult(
                content=[ToolResultContent(text=error_message)],
                is_error=True,
            )
    else:
        hits = await asyncio.to_thread(
            _search_hits_by_keywords,
            md_files=md_files,
            query=query,
            context_lines=context_lines,
            max_results=max_results,
        )

    if hits:
        return AgentToolResult(
            content=[ToolResultContent(text=_format_search_results(query, search_mode, hits))]
        )

    return AgentToolResult(
        content=[
            ToolResultContent(
                text=f"未找到匹配 '{query}' 的内容。已扫描 {len(md_files)} 个知识文件。"
            )
        ]
    )


async def _search_query_patterns(tool_call_id: str, arguments: dict) -> AgentToolResult:
    """在 doc/query_patterns.md 中直接检索最相关的查询模板片段"""
    query = str(arguments.get("query", "")).strip()
    max_results = _clamp_int(
        arguments.get("max_results"),
        default=3,
        minimum=1,
        maximum=8,
    )

    if not query:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 必须提供 query 参数")],
            is_error=True,
        )

    retriever = QueryPatternRetriever(QUERY_PATTERNS_PATH)
    matches = await asyncio.to_thread(retriever.search, query, max_results=max_results)
    return AgentToolResult(
        content=[ToolResultContent(text=retriever.format_results(query, matches))],
        details={
            "query": query,
            "match_count": len(matches),
            "matched_titles": [match.title for match in matches],
            "source_path": "doc/query_patterns.md",
        },
    )


async def _read_knowledge(tool_call_id: str, arguments: dict) -> AgentToolResult:
    """读取知识库中的指定文件"""
    path = arguments.get("path", "")
    if not path:
        # 无参数时返回文件清单
        md_files = await asyncio.to_thread(_discover_md_files)
        listing = [
            str(f.relative_to(KNOWLEDGE_ROOT)) for f in md_files
        ]
        return AgentToolResult(
            content=[
                ToolResultContent(
                    text="知识库文件列表:\n" + "\n".join(f"  - {f}" for f in listing)
                    if listing
                    else "知识库为空。"
                )
            ]
        )

    try:
        resolved = _safe_resolve(path)
    except ValueError as e:
        return AgentToolResult(
            content=[ToolResultContent(text=f"路径错误: {e}")],
            is_error=True,
        )

    if not resolved.exists():
        return AgentToolResult(
            content=[ToolResultContent(text=f"文件不存在: {path}")],
            is_error=True,
        )
    if not resolved.is_file():
        return AgentToolResult(
            content=[ToolResultContent(text=f"不是文件: {path}")],
            is_error=True,
        )

    try:
        content = await asyncio.to_thread(resolved.read_text, encoding="utf-8")
        # 截断过大文件
        if len(content) > 50000:
            content = content[:50000] + "\n\n... [文件过大，已截断]"
        return AgentToolResult(
            content=[ToolResultContent(text=content)]
        )
    except Exception as e:
        return AgentToolResult(
            content=[ToolResultContent(text=f"读取失败: {e}")],
            is_error=True,
        )


async def _write_knowledge(tool_call_id: str, arguments: dict) -> AgentToolResult:
    """写入或更新知识库中的 .md 文件"""
    path = arguments.get("path", "")
    content = arguments.get("content", "")
    mode = arguments.get("mode", "overwrite")  # overwrite | append

    if not path:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 必须提供 path 参数")],
            is_error=True,
        )

    # 只允许写入 .md 文件
    if not path.endswith(".md"):
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 只允许写入 .md 文件")],
            is_error=True,
        )

    try:
        resolved = _safe_resolve(path)
    except ValueError as e:
        return AgentToolResult(
            content=[ToolResultContent(text=f"路径错误: {e}")],
            is_error=True,
        )

    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        if mode == "append" and resolved.exists():
            existing = resolved.read_text(encoding="utf-8")
            content = existing + "\n" + content
        resolved.write_text(content, encoding="utf-8")
        logger.info(f"[write_knowledge] 已写入: {path} ({len(content)} 字符)")
        return AgentToolResult(
            content=[
                ToolResultContent(
                    text=f"已保存知识文件: {path} ({len(content)} 字符)"
                )
            ]
        )
    except Exception as e:
        return AgentToolResult(
            content=[ToolResultContent(text=f"写入失败: {e}")],
            is_error=True,
        )


async def _edit_knowledge(tool_call_id: str, arguments: dict) -> AgentToolResult:
    """局部编辑知识库文件：用 new_text 替换 old_text"""
    path = arguments.get("path", "")
    old_text = arguments.get("old_text", "")
    new_text = arguments.get("new_text", "")

    if not path:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 必须提供 path 参数")],
            is_error=True,
        )
    if not old_text:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 必须提供 old_text 参数")],
            is_error=True,
        )

    try:
        resolved = _safe_resolve(path)
    except ValueError as e:
        return AgentToolResult(
            content=[ToolResultContent(text=f"路径错误: {e}")],
            is_error=True,
        )

    if not resolved.exists():
        return AgentToolResult(
            content=[ToolResultContent(text=f"文件不存在: {path}")],
            is_error=True,
        )

    try:
        content = resolved.read_text(encoding="utf-8")
        count = content.count(old_text)
        if count == 0:
            return AgentToolResult(
                content=[ToolResultContent(text=f"未找到匹配内容，未做修改。请检查 old_text 是否精确。")],
                is_error=True,
            )
        if count > 1:
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        text=f"old_text 在文件中出现 {count} 次，无法确定替换哪一处。请提供更长的上下文使其唯一。"
                    )
                ],
                is_error=True,
            )
        updated = content.replace(old_text, new_text, 1)
        resolved.write_text(updated, encoding="utf-8")
        logger.info(f"[edit_knowledge] 已编辑: {path}")
        return AgentToolResult(
            content=[ToolResultContent(text=f"已编辑 {path}，替换了 1 处内容。")]
        )
    except Exception as e:
        return AgentToolResult(
            content=[ToolResultContent(text=f"编辑失败: {e}")],
            is_error=True,
        )


# ─────────────────────────────────────────────
# 工具注册
# ─────────────────────────────────────────────



def create_knowledge_tools() -> list[AgentTool]:
    """创建知识库工具集"""
    return [
        AgentTool(
            name="search_query_patterns",
            label="检索查询模板",
            description=(
                "直接在 knowledge/doc/query_patterns.md 中检索最相关的查询模板片段。\n"
                "适用于单值查询、单指标查询、单月累计值查询等快速路径场景。\n"
                "返回最匹配的模板标题、适用片段、命中关键词和示例 SQL。\n"
                "命中后应优先直接改写模板并执行 SQL，而不是先 search_knowledge 再 read_knowledge_file。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "业务问题或关键词，如'2025年批发业累计销售额'、'行业大类 单月累计值'",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "最多返回多少个候选模板（默认3，最大8）",
                    },
                },
                "required": ["query"],
            },
            execute_fn=_search_query_patterns,
            read_only=True,
            resource="knowledge",
            max_concurrency=8,
        ),
        AgentTool(
            name="search_knowledge",
            label="搜索知识库",
            description=(
                "在 knowledge/ 下的 Markdown 文档中搜索内容。\n"
                "默认使用智能关键词模式，适合自然语言查询；也支持 regex 模式做 grep 风格精确搜索。\n"
                "返回文件路径、行号和上下文，适用于查找业务规则、表结构、SQL 模板、历史经验等。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索内容。默认按自然语言关键词检索；在 regex 模式下按正则表达式处理。",
                    },
                    "context_lines": {
                        "type": "integer",
                        "description": "返回匹配行前后的上下文行数（默认3，最大10）",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "最多返回多少条结果（默认8，最大20）",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["smart", "regex"],
                        "description": "smart=智能关键词检索（默认）；regex=grep 风格正则检索",
                    },
                },
                "required": ["query"],
            },
            execute_fn=_search_knowledge,
            read_only=True,
            resource="knowledge",
            max_concurrency=8,
        ),
        AgentTool(
            name="read_knowledge_file",
            label="读取知识文件",
            description=(
                "读取知识库中的指定文件完整内容。\n"
                "不传 path 时返回知识库文件清单。\n"
                "可用文件如: doc/business.md, doc/rules.md, doc/db_schema.md, "
                "doc/query_patterns.md, doc/learning.md, agent.md"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件相对路径（如 'doc/business.md'），留空返回文件列表",
                    },
                },
                "required": [],
            },
            execute_fn=_read_knowledge,
            read_only=True,
            resource="knowledge",
            max_concurrency=8,
        ),
        AgentTool(
            name="write_knowledge_file",
            label="更新知识文件",
            description=(
                "写入或更新知识库中的 .md 文件。\n"
                "用途：更新业务规则、补充表结构注释、记录新的SQL模板等。\n"
                "支持覆盖写入(overwrite)和追加写入(append)两种模式。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件相对路径（如 'doc/business.md'）",
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的 Markdown 内容",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["overwrite", "append"],
                        "description": "写入模式: overwrite=覆盖, append=追加（默认 overwrite）",
                    },
                },
                "required": ["path", "content"],
            },
            execute_fn=_write_knowledge,
            read_only=False,
            resource="knowledge",
            max_concurrency=1,
        ),
        AgentTool(
            name="edit_knowledge_file",
            label="编辑知识文件",
            description=(
                "局部编辑知识库中的 .md 文件。\n"
                "通过精确匹配 old_text 并替换为 new_text，实现定点修改。\n"
                "old_text 必须在文件中唯一匹配（出现恰好 1 次）。\n"
                "适用于：修改某条业务定义、更新某段规则、修正错误内容等。\n"
                "如需追加内容，使用 write_knowledge_file 的 append 模式。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件相对路径（如 'doc/business.md'）",
                    },
                    "old_text": {
                        "type": "string",
                        "description": "要被替换的原文（必须精确匹配，且在文件中唯一）",
                    },
                    "new_text": {
                        "type": "string",
                        "description": "替换后的新内容（传空字符串即为删除）",
                    },
                },
                "required": ["path", "old_text", "new_text"],
            },
            execute_fn=_edit_knowledge,
            read_only=False,
            resource="knowledge",
            max_concurrency=1,
        ),
    ]
