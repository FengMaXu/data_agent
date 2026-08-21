import json

import yaml

from src.connection_registry import ConnectionRegistry, DEFAULT_CONNECTION_ID


def test_registry_projects_redacted_api_ktx_reference_and_secret_environment(tmp_path):
    registry = ConnectionRegistry(tmp_path / "connections.json")
    registry.upsert(
        DEFAULT_CONNECTION_ID,
        {
            "name": "Warehouse",
            "driver": "mysql",
            "host": "db.internal",
            "port": 3307,
            "user": "analyst",
            "password": "top-secret",
            "database": "analytics",
            "semantic_enabled": True,
        },
    )

    project_dir = tmp_path / "semantic-context"
    assert registry.sync_ktx_project(project_dir) is True

    config = yaml.safe_load((project_dir / "ktx.yaml").read_text(encoding="utf-8"))
    assert config["connections"][DEFAULT_CONNECTION_ID] == {
        "ref": "env:DATA_AGENT_CONNECTION_DEFAULT_MYSQL"
    }
    assert config["setup"]["database_connection_ids"] == [DEFAULT_CONNECTION_ID]
    assert "live-database" in config["ingest"]["adapters"]
    assert config["ingest"]["embeddings"]["backend"] == "none"
    assert config["scan"]["enrichment"]["mode"] == "llm"
    assert config["scan"]["relationships"] == {
        "enabled": True,
        "llmProposals": True,
        "validationRequiredForManifest": True,
    }

    payload = json.loads(registry.semantic_environment()["DATA_AGENT_CONNECTION_DEFAULT_MYSQL"])
    assert payload == {
        "driver": "mysql",
        "host": "db.internal",
        "port": 3307,
        "user": "analyst",
        "password": "top-secret",
        "database": "analytics",
    }
    api_connection = registry.api_snapshot()["connections"][0]
    assert api_connection["password_configured"] is True
    assert "password" not in api_connection


def test_registry_preserves_password_and_unmanaged_ktx_connections(tmp_path):
    registry = ConnectionRegistry(tmp_path / "connections.json")
    registry.upsert(
        DEFAULT_CONNECTION_ID,
        {
            "host": "localhost",
            "user": "root",
            "password": "keep-me",
            "database": "old_db",
        },
    )
    registry.upsert(
        "reporting-mysql",
        {
            "host": "reports.internal",
            "user": "reporter",
            "password": "report-secret",
            "database": "reports",
        },
    )
    registry.upsert(DEFAULT_CONNECTION_ID, {"database": "new_db", "password": ""})
    assert registry.get(DEFAULT_CONNECTION_ID)["password"] == "keep-me"

    project_dir = tmp_path / "semantic-context"
    project_dir.mkdir()
    (project_dir / "ktx.yaml").write_text(
        "connections:\n  analytics-dbt:\n    driver: dbt\n    source_dir: analytics/dbt\n",
        encoding="utf-8",
    )
    registry.sync_ktx_project(project_dir)
    registry.delete("reporting-mysql")
    registry.sync_ktx_project(project_dir)

    config = yaml.safe_load((project_dir / "ktx.yaml").read_text(encoding="utf-8"))
    assert config["connections"]["analytics-dbt"]["driver"] == "dbt"
    assert "reporting-mysql" not in config["connections"]
    assert DEFAULT_CONNECTION_ID in config["connections"]


def test_registry_migrates_one_legacy_mysql_connection(tmp_path):
    registry = ConnectionRegistry(tmp_path / "connections.json")
    assert registry.migrate_legacy(
        {
            "host": "legacy.internal",
            "port": 3306,
            "user": "legacy",
            "password": "secret",
            "database": "legacy_db",
        }
    ) is True
    assert registry.migrate_legacy(
        {
            "host": "ignored.internal",
            "port": 3306,
            "user": "ignored",
            "password": "ignored",
            "database": "ignored",
        }
    ) is False
    assert registry.default_connection()[0] == DEFAULT_CONNECTION_ID
    assert registry.get(DEFAULT_CONNECTION_ID)["host"] == "legacy.internal"
