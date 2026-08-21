from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import src.api.semantic_api as semantic_api


class FakeSemanticServer:
    def __init__(self, project: Path) -> None:
        self.project = project

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        if name == "sl_discover":
            return json.dumps(
                {
                    "connections": [
                        {
                            "connectionId": "warehouse",
                            "sources": [
                                {"name": "orders", "columnCount": 3, "measureCount": 1, "joinCount": 0},
                                {"name": "manifest_only", "columnCount": 2, "measureCount": 0, "joinCount": 0},
                                {"name": "plain", "columnCount": 1, "measureCount": 0, "joinCount": 0},
                                {"name": "shadow", "columnCount": 1, "measureCount": 0, "joinCount": 0},
                            ],
                        }
                    ]
                }
            )
        if name == "sl_read_source":
            source_name = arguments["sourceName"]
            source_path = self.project / "semantic-layer" / "warehouse" / f"{source_name}.yaml"
            if source_path.exists():
                return json.dumps(
                    {
                        "connectionId": "warehouse",
                        "sourceName": source_name,
                        "yaml": source_path.read_text(encoding="utf-8"),
                    }
                )
            if source_name == "manifest_only":
                return json.dumps(
                    {
                        "connectionId": "warehouse",
                        "sourceName": source_name,
                        "yaml": (
                            "name: manifest_only\n"
                            "table: analytics.manifest_only\n"
                            "grain: [id]\n"
                            "columns:\n  - name: id\n    type: number\n"
                            "measures: []\njoins: []\n"
                        ),
                    }
                )
            return json.dumps({"error": "semantic_source_not_found"})
        raise AssertionError(name)


class FakeManager:
    def __init__(self, server: FakeSemanticServer) -> None:
        self.server = server

    def find_server_by_type(self, server_type: str) -> FakeSemanticServer | None:
        return self.server if server_type == "semantic" else None


@pytest.fixture
def semantic_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    project = tmp_path / "semantic-context"
    source_dir = project / "semantic-layer" / "warehouse"
    (source_dir / "_schema").mkdir(parents=True)
    (project / "ktx.yaml").write_text("connections: {}\n", encoding="utf-8")
    (source_dir / "_schema" / "schema.yaml").write_text(
        """tables:
  orders:
    table: analytics.orders
    descriptions:
      user: Manifest orders
    columns:
      - name: id
        type: number
        pk: true
      - name: customer_id
        type: string
    joins: []
  manifest_only:
    table: analytics.manifest_only
    descriptions:
      db: Manifest-only table
    columns:
      - name: id
        type: number
        pk: true
      - name: status
        type: string
    joins: []
  shadow:
    table: analytics.shadow
    columns:
      - name: id
        type: number
        pk: true
    joins: []
""",
        encoding="utf-8",
    )
    (source_dir / "orders.yaml").write_text(
        """name: orders
measures:
  - name: order_count
    expr: count(*)
    description: Order count
""",
        encoding="utf-8",
    )
    (source_dir / "plain.yaml").write_text(
        """name: plain
table: analytics.plain
grain: [id]
columns:
  - name: id
    type: number
measures: []
joins: []
""",
        encoding="utf-8",
    )
    (source_dir / "shadow.yaml").write_text(
        """name: shadow
table: analytics.shadow_override
grain: [id]
columns:
  - name: id
    type: number
measures: []
joins: []
""",
        encoding="utf-8",
    )
    (source_dir / "orphan.yaml").write_text(
        """name: orphan
measures:
  - name: broken
    expr: count(*)
""",
        encoding="utf-8",
    )
    business_dir = project / "business-semantic" / "warehouse"
    business_dir.mkdir(parents=True)
    (business_dir / "business.yaml").write_text(
        """asset_type: business_knowledge
name: business
title: Business rules
descriptions:
  user: Rules from the knowledge base.
source_documents:
  - knowledge/doc/business.md
business_rules:
  - id: yoy
    name: Recompute aggregate growth
    statement: Aggregate first, then calculate growth.
    severity: critical
    source: knowledge/doc/business.md
    details:
      - Do not average row-level growth.
query_templates:
  - id: template-1
    name: Industry sales
    category: Sales
    description: Monthly industry sales template.
    parameters:
      - name: target_month
        description: Target month.
    sql: SELECT SUM(sales_ytd) FROM fact_sales_monthly
    semantic_models:
      - industry_sales_summary
    execution_status: advisory
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(semantic_api.config_manager, "semantic_project_dir", project)
    monkeypatch.setattr(semantic_api, "mcp_manager", FakeManager(FakeSemanticServer(project)))
    return project


@pytest.mark.asyncio
async def test_list_semantic_sources_includes_status_kinds(semantic_project: Path) -> None:
    response = await semantic_api.list_semantic_sources()
    sources = {item.sourceName: item for item in response.connections[0].sources}

    assert sources["plain"].sourceKind == "standalone"
    assert sources["plain"].isQueryable is True
    assert "manifest_only" not in sources
    assert sources["orders"].sourceKind == "manifest_with_overlay"
    assert sources["shadow"].sourceKind == "standalone_shadows_manifest"
    assert sources["orphan"].sourceKind == "orphan_overlay"
    assert sources["business"].assetType == "business_knowledge"
    assert sources["business"].isQueryable is False
    assert sources["business"].title == "Business rules"
    assert sources["orders"].hasOverlay is True


@pytest.mark.asyncio
async def test_manifest_only_detail_is_not_exposed_as_business_asset(semantic_project: Path) -> None:
    with pytest.raises(semantic_api.HTTPException) as error:
        await semantic_api.get_semantic_source("warehouse", "manifest_only")

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_business_knowledge_detail_is_read_from_host_yaml(semantic_project: Path) -> None:
    response = await semantic_api.get_semantic_source("warehouse", "business")

    assert response.assetType == "business_knowledge"
    assert response.isQueryable is False
    assert response.title == "Business rules"
    assert response.rawYaml.startswith("asset_type: business_knowledge")
    assert response.sourceDocuments == ["knowledge/doc/business.md"]
    assert response.queryTemplates[0].sql.startswith("SELECT SUM")
    assert response.queryTemplates[0].parameters[0].name == "target_month"
    assert response.businessRules[0].severity == "critical"


@pytest.mark.asyncio
async def test_overlay_detail_uses_composed_display_view_and_raw_overlay(semantic_project: Path) -> None:
    response = await semantic_api.get_semantic_source("warehouse", "orders")

    assert response.sourceKind == "manifest_with_overlay"
    assert response.isQueryable is True
    assert response.rawYaml.startswith("name: orders")
    assert response.table == "analytics.orders"
    assert [column.name for column in response.columns] == ["id", "customer_id"]
    assert response.measures[0].expr == "count(*)"
    assert response.measures[0].description == "Order count"


def test_semantic_agent_whitelist_has_no_write_tool() -> None:
    from src.semantic_startup import VISIBLE_SEMANTIC_TOOLS

    assert "sl_edit_source" not in VISIBLE_SEMANTIC_TOOLS
    assert "sl_write_source" not in VISIBLE_SEMANTIC_TOOLS
