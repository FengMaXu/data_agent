"""
Layer 3：历史高分 SQL 模板库 (Query Patterns)

解析 knowledge/queries/*.sql 文件，
提供关键词匹配，返回验证过的 SQL 模板作为 Few-shot 参考。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.context.query_patterns")


@dataclass
class QueryPattern:
    """一条经过验证的 SQL 模板"""

    name: str
    description: str
    sql: str
    source_file: str = ""


class QueryPatternStore:
    """
    历史高分 SQL 模板库

    解析 knowledge/queries/*.sql 文件。
    每条模板用 XML 风格标签标注（兼容 dash 格式）：
        -- <query name>名称</query name>
        -- <query description>描述</query description>
        -- <query>
        SELECT ...
        -- </query>
    """

    def __init__(self, knowledge_dir: str | Path | None = None):
        self._knowledge_dir = Path(knowledge_dir) if knowledge_dir else None
        self._patterns: list[QueryPattern] = []
        self._initialized = False

    def load(self, directory: str | Path | None = None) -> None:
        """从目录加载所有 .sql 文件"""
        load_dir = Path(directory) if directory else self._knowledge_dir
        if not load_dir:
            project_root = Path(__file__).resolve().parent.parent.parent
            load_dir = project_root / "knowledge" / "queries"

        if not load_dir.exists():
            logger.warning(f"[QueryPatterns] 目录不存在: {load_dir}")
            self._initialized = True
            return

        files = list(load_dir.glob("*.sql"))
        logger.info(f"[QueryPatterns] 从 {load_dir} 加载 {len(files)} 个 SQL 文件")

        for f in files:
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    content = fp.read()
                patterns = self._parse_sql_file(content, str(f.name))
                self._patterns.extend(patterns)
                logger.info(f"  → {f.name}: {len(patterns)} 个模板")
            except Exception as e:
                logger.error(f"[QueryPatterns] 解析 {f} 失败: {e}")

        self._initialized = True

    def _parse_sql_file(self, content: str, source: str) -> list[QueryPattern]:
        """
        解析 SQL 文件中的标签结构

        支持两种格式：
        1. dash 风格 XML 标签
        2. 简化的注释分割（用 --- 或双空行分割不同查询）
        """
        patterns = []

        # 尝试 XML 标签解析
        # 匹配 <query name>...</query name>
        name_regex = re.compile(
            r"--\s*<query\s+name>(.*?)</query\s*name>",
            re.IGNORECASE | re.DOTALL,
        )
        desc_regex = re.compile(
            r"--\s*<query\s+description>(.*?)</query\s*description>",
            re.IGNORECASE | re.DOTALL,
        )
        query_regex = re.compile(
            r"--\s*<query>(.*?)--\s*</query>",
            re.IGNORECASE | re.DOTALL,
        )

        names = name_regex.findall(content)
        descs = desc_regex.findall(content)
        queries = query_regex.findall(content)

        if names and queries:
            # XML 标签模式
            for i, query_sql in enumerate(queries):
                name = names[i].strip() if i < len(names) else f"query_{i + 1}"
                desc = descs[i].strip() if i < len(descs) else ""
                # 清理描述中的注释前缀
                desc = re.sub(r"^--\s*", "", desc, flags=re.MULTILINE).strip()

                sql = query_sql.strip()
                # 移除 SQL 中的注释行（但保留有意义的内容）
                sql_lines = []
                for line in sql.split("\n"):
                    stripped = line.strip()
                    if stripped and not stripped.startswith("--"):
                        sql_lines.append(line.rstrip())
                    elif stripped.startswith("--") and len(stripped) > 3:
                        # 保留有意义的注释
                        sql_lines.append(line.rstrip())

                patterns.append(
                    QueryPattern(
                        name=name,
                        description=desc,
                        sql="\n".join(sql_lines).strip(),
                        source_file=source,
                    )
                )
        else:
            # Fallback: 用双空行分割
            blocks = re.split(r"\n\s*\n\s*\n", content)
            for i, block in enumerate(blocks):
                block = block.strip()
                if not block or all(
                    l.strip().startswith("--") and len(l.strip()) <= 3
                    for l in block.split("\n")
                ):
                    continue

                # 提取注释作为描述
                comment_lines = []
                sql_lines = []
                for line in block.split("\n"):
                    stripped = line.strip()
                    if stripped.startswith("--"):
                        comment_lines.append(stripped.lstrip("-").strip())
                    else:
                        sql_lines.append(line)

                if sql_lines:
                    patterns.append(
                        QueryPattern(
                            name=f"query_{i + 1}",
                            description=" ".join(comment_lines),
                            sql="\n".join(sql_lines).strip(),
                            source_file=source,
                        )
                    )

        return patterns

    def search(self, query: str) -> str:
        """
        关键词搜索 SQL 模板

        在模板名称和描述中匹配关键词，
        返回最相关的模板（最多 5 个）。
        """
        if not self._initialized:
            self.load()

        if not self._patterns:
            return (
                "⚠️ 未加载任何 SQL 模板。请在 knowledge/queries/ 目录下添加 .sql 文件。"
            )

        query_lower = query.lower()
        keywords = re.split(r"[\s,，。？！、\-_/]+", query_lower)
        keywords = [k.strip() for k in keywords if len(k.strip()) >= 2]
        if not keywords:
            keywords = [query_lower.strip()]

        # 评分匹配
        scored: list[tuple[int, QueryPattern]] = []
        for pattern in self._patterns:
            searchable = f"{pattern.name} {pattern.description}".lower()
            score = sum(1 for kw in keywords if kw in searchable)
            if score > 0:
                scored.append((score, pattern))

        # 按分数排序，取前 5
        scored.sort(key=lambda x: x[0], reverse=True)
        top = [p for _, p in scored[:5]]

        if not top:
            # 无匹配，返回全部（如果不多）
            if len(self._patterns) <= 5:
                top = self._patterns
            else:
                return f"未找到匹配 '{query}' 的 SQL 模板。共有 {len(self._patterns)} 个模板可用。"

        return self._format_patterns(top, query)

    def get_all(self) -> str:
        """返回全部 SQL 模板"""
        if not self._initialized:
            self.load()
        if not self._patterns:
            return "⚠️ SQL 模板库为空。"
        return self._format_patterns(self._patterns, "")

    def _format_patterns(self, patterns: list[QueryPattern], query: str) -> str:
        """格式化 SQL 模板列表"""
        lines = ["# 📝 历史验证 SQL 模板\n"]
        if query:
            lines.append(f'搜索: "{query}" | 匹配: {len(patterns)} 个模板\n')

        for i, p in enumerate(patterns, 1):
            lines.append(f"## {i}. {p.name}")
            if p.description:
                lines.append(f"**说明**: {p.description}")
            lines.append(f"```sql\n{p.sql}\n```")
            lines.append("")

        lines.append(
            "> 💡 以上 SQL 已经过人工验证，可作为 Few-shot 参考。"
            "请根据用户的具体需求进行调整。"
        )
        return "\n".join(lines)

    def create_tools(self) -> list[AgentTool]:
        """创建 SQL 模板搜索工具"""

        store = self

        async def search_query_patterns(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            query = arguments.get("query", "")
            if not store._initialized:
                store.load()
            result = store.search(query) if query else store.get_all()
            return AgentToolResult(content=[ToolResultContent(text=result)])

        return [
            AgentTool(
                name="search_query_patterns",
                description=(
                    "搜索经过人工验证的历史 SQL 模板库。"
                    "输入关键词（如'冠军'、'销售额'、'趋势'），返回相关的 SQL 范例。"
                    "这些 SQL 已被验证为 100% 正确，可作为 Few-shot 参考直接改写。"
                    "在编写复杂查询前，建议先搜索是否有类似的经验模板。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词，如'销售排名'、'月度趋势'、'JOIN查询'",
                        },
                    },
                    "required": [],
                },
                execute_fn=search_query_patterns,
                label="搜索SQL模板",
            ),
        ]
