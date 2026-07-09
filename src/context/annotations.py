"""
Layer 2：业务标注字典库 (Human Annotations)

加载 knowledge/business/*.json 文件，
提供关键词检索，让 LLM 理解企业特有的业务术语和规则。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.context.annotations")


@dataclass
class MetricDefinition:
    """指标定义"""

    name: str
    definition: str
    table: str = ""
    calculation: str = ""


@dataclass
class GotchaEntry:
    """常见陷阱"""

    issue: str
    tables_affected: list[str] = field(default_factory=list)
    solution: str = ""


@dataclass
class BusinessKnowledge:
    """一个 JSON 文件包含的全部业务知识"""

    source_file: str = ""
    metrics: list[MetricDefinition] = field(default_factory=list)
    business_rules: list[str] = field(default_factory=list)
    gotchas: list[GotchaEntry] = field(default_factory=list)
    # 还支持自定义字段的 raw 内容
    raw_extra: dict[str, Any] = field(default_factory=dict)


class AnnotationStore:
    """
    业务标注知识库

    加载 knowledge/business/*.json 文件，提供关键词检索。
    JSON 格式兼容 dash 项目的 metrics.json 结构：
    - metrics[]: 指标定义（名称、含义、相关表、计算方式）
    - business_rules[]: 文字规则
    - common_gotchas[]: 常见陷阱及解决方案
    """

    def __init__(self, knowledge_dir: str | Path | None = None):
        self._knowledge_dir = Path(knowledge_dir) if knowledge_dir else None
        self._knowledge_items: list[BusinessKnowledge] = []
        self._initialized = False

    def load(self, directory: str | Path | None = None) -> None:
        """从目录加载所有 JSON 文件"""
        load_dir = Path(directory) if directory else self._knowledge_dir
        if not load_dir:
            # 默认查找项目根目录下的 knowledge/business/
            project_root = Path(__file__).resolve().parent.parent.parent
            load_dir = project_root / "knowledge" / "business"

        if not load_dir.exists():
            logger.warning(f"[Annotations] 目录不存在: {load_dir}")
            self._initialized = True
            return

        files = list(load_dir.glob("*.json"))
        logger.info(f"[Annotations] 从 {load_dir} 加载 {len(files)} 个文件")

        for f in files:
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                knowledge = self._parse_json(data, str(f.name))
                self._knowledge_items.append(knowledge)
                logger.info(
                    f"  → {f.name}: "
                    f"{len(knowledge.metrics)} 指标, "
                    f"{len(knowledge.business_rules)} 规则, "
                    f"{len(knowledge.gotchas)} 陷阱"
                )
            except Exception as e:
                logger.error(f"[Annotations] 解析 {f} 失败: {e}")

        self._initialized = True

    def _parse_json(self, data: dict, source: str) -> BusinessKnowledge:
        """解析一个 JSON 文件的内容"""
        knowledge = BusinessKnowledge(source_file=source)

        # 解析 metrics
        for m in data.get("metrics", []):
            knowledge.metrics.append(
                MetricDefinition(
                    name=m.get("name", ""),
                    definition=m.get("definition", ""),
                    table=m.get("table", ""),
                    calculation=m.get("calculation", ""),
                )
            )

        # 解析 business_rules
        knowledge.business_rules = data.get("business_rules", [])

        # 解析 common_gotchas
        for g in data.get("common_gotchas", []):
            knowledge.gotchas.append(
                GotchaEntry(
                    issue=g.get("issue", ""),
                    tables_affected=g.get("tables_affected", []),
                    solution=g.get("solution", ""),
                )
            )

        # 保存未识别的顶层字段
        known_keys = {"metrics", "business_rules", "common_gotchas"}
        knowledge.raw_extra = {k: v for k, v in data.items() if k not in known_keys}

        return knowledge

    def search(self, query: str) -> str:
        """
        关键词检索业务知识

        在所有指标名称、定义、规则、陷阱中搜索匹配项，
        返回格式化的知识摘要。
        """
        if not self._initialized:
            self.load()

        if not self._knowledge_items:
            return "⚠️ 未加载任何业务标注文件。请在 knowledge/business/ 目录下添加 JSON 文件。"

        query_lower = query.lower()
        # 提取查询中的关键词（中英文混合支持）
        keywords = self._extract_keywords(query_lower)

        matched_metrics: list[MetricDefinition] = []
        matched_rules: list[str] = []
        matched_gotchas: list[GotchaEntry] = []

        for knowledge in self._knowledge_items:
            # 搜索指标
            for metric in knowledge.metrics:
                searchable = f"{metric.name} {metric.definition} {metric.table} {metric.calculation}".lower()
                if any(kw in searchable for kw in keywords):
                    matched_metrics.append(metric)

            # 搜索规则
            for rule in knowledge.business_rules:
                if any(kw in rule.lower() for kw in keywords):
                    matched_rules.append(rule)

            # 搜索陷阱
            for gotcha in knowledge.gotchas:
                searchable = f"{gotcha.issue} {gotcha.solution} {' '.join(gotcha.tables_affected)}".lower()
                if any(kw in searchable for kw in keywords):
                    matched_gotchas.append(gotcha)

        # 如果没有精确匹配，返回全部知识（作为兜底上下文）
        if not matched_metrics and not matched_rules and not matched_gotchas:
            return self._format_all()

        return self._format_results(matched_metrics, matched_rules, matched_gotchas)

    def get_all(self) -> str:
        """返回全部业务知识"""
        if not self._initialized:
            self.load()
        return self._format_all()

    def _extract_keywords(self, query: str) -> list[str]:
        """提取搜索关键词"""
        # 基础分词：按空格和标点分割，过滤短词
        tokens = re.split(r"[\s,，。？！、\-_/]+", query)
        keywords = [t.strip() for t in tokens if len(t.strip()) >= 2]

        # 如果分词太少，把整个 query 也作为关键词
        if len(keywords) <= 1:
            keywords.append(query.strip())

        return keywords

    def _format_all(self) -> str:
        """格式化全部知识"""
        if not self._knowledge_items:
            return "⚠️ 业务标注库为空。"

        all_metrics = []
        all_rules = []
        all_gotchas = []
        for k in self._knowledge_items:
            all_metrics.extend(k.metrics)
            all_rules.extend(k.business_rules)
            all_gotchas.extend(k.gotchas)

        return self._format_results(all_metrics, all_rules, all_gotchas)

    def _format_results(
        self,
        metrics: list[MetricDefinition],
        rules: list[str],
        gotchas: list[GotchaEntry],
    ) -> str:
        """格式化搜索结果"""
        lines = ["# 📚 业务上下文\n"]

        if metrics:
            lines.append("## 指标定义")
            for m in metrics:
                lines.append(f"- **{m.name}**: {m.definition}")
                if m.table:
                    lines.append(f"  - 相关表: `{m.table}`")
                if m.calculation:
                    lines.append(f"  - 计算方式: `{m.calculation}`")
            lines.append("")

        if rules:
            lines.append("## ⚠️ 业务规则")
            for rule in rules:
                lines.append(f"- {rule}")
            lines.append("")

        if gotchas:
            lines.append("## 🚨 常见陷阱")
            for g in gotchas:
                tables_str = ", ".join(f"`{t}`" for t in g.tables_affected)
                lines.append(f"- **{g.issue}** ({tables_str})")
                lines.append(f"  - 解决方案: {g.solution}")
            lines.append("")

        if not metrics and not rules and not gotchas:
            lines.append("未找到匹配的业务知识。")

        return "\n".join(lines)

    def create_tools(self) -> list[AgentTool]:
        """创建业务标注工具"""

        store = self

        async def search_business_context(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            query = arguments.get("query", "")

            def _run_search() -> str:
                if not store._initialized:
                    store.load()
                return store.search(query) if query else store.get_all()

            result = await asyncio.to_thread(_run_search)
            return AgentToolResult(content=[ToolResultContent(text=result)])

        return [
            AgentTool(
                name="search_business_context",
                description=(
                    "搜索企业业务标注知识库，获取业务指标定义、计算规则和常见陷阱。"
                    "当用户提到模糊的业务术语（如'大客户'、'净收入'、'活跃用户'）时，"
                    "应先调用此工具确认其精确定义，避免误解。"
                    "不传 query 参数时返回全部业务知识。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词，如'净收入'、'大客户'、'position类型'",
                        },
                    },
                    "required": [],
                },
                execute_fn=search_business_context,
                label="搜索业务知识",
                read_only=True,
                resource="business_knowledge",
                max_concurrency=8,
            ),
        ]
