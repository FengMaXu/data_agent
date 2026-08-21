from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import yaml


DEFAULT_CONNECTION_ID = "default-mysql"
REGISTRY_VERSION = 1
SUPPORTED_DATABASE_DRIVERS = {"mysql"}
CONNECTION_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
MANAGED_ENV_PREFIX = "DATA_AGENT_CONNECTION_"


class ConnectionRegistry:
    """Persistent database connections shared by database and semantic runtimes."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def snapshot(self) -> dict[str, Any]:
        if not self.path.is_file():
            return self._empty_snapshot()
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Connection registry must contain a JSON object")
        connections = data.get("connections", {})
        if not isinstance(connections, dict):
            raise ValueError("Connection registry connections must be a JSON object")

        normalized: dict[str, dict[str, Any]] = {}
        for connection_id, connection in connections.items():
            if not isinstance(connection_id, str) or not isinstance(connection, dict):
                raise ValueError("Connection registry contains an invalid connection")
            normalized[connection_id] = self._normalize_connection(
                connection_id,
                connection,
                existing=connection,
            )

        default_id = str(data.get("default_connection_id") or "")
        if default_id not in normalized:
            default_id = next(iter(sorted(normalized)), "")
        return {
            "version": REGISTRY_VERSION,
            "default_connection_id": default_id or None,
            "connections": normalized,
        }

    def api_snapshot(self) -> dict[str, Any]:
        data = self.snapshot()
        connections = []
        for connection_id, connection in sorted(data["connections"].items()):
            connections.append(
                {
                    "id": connection_id,
                    "name": connection["name"],
                    "driver": connection["driver"],
                    "host": connection["host"],
                    "port": connection["port"],
                    "user": connection["user"],
                    "database": connection["database"],
                    "semantic_enabled": connection["semantic_enabled"],
                    "password_configured": bool(connection["password"]),
                }
            )
        return {
            "default_connection_id": data["default_connection_id"],
            "connections": connections,
        }

    def get(self, connection_id: str) -> dict[str, Any] | None:
        connection = self.snapshot()["connections"].get(connection_id)
        return dict(connection) if connection is not None else None

    def default_connection(self) -> tuple[str, dict[str, Any]] | None:
        data = self.snapshot()
        connection_id = data["default_connection_id"]
        if not connection_id:
            return None
        return connection_id, dict(data["connections"][connection_id])

    def upsert(self, connection_id: str, values: dict[str, Any]) -> dict[str, Any]:
        data = self.snapshot()
        existing = data["connections"].get(connection_id)
        connection = self._normalize_connection(connection_id, values, existing=existing)
        data["connections"][connection_id] = connection
        if not data["default_connection_id"]:
            data["default_connection_id"] = connection_id
        self._write(data)
        return dict(connection)

    def delete(self, connection_id: str) -> None:
        data = self.snapshot()
        if connection_id not in data["connections"]:
            raise KeyError(connection_id)
        del data["connections"][connection_id]
        if data["default_connection_id"] == connection_id:
            data["default_connection_id"] = next(iter(sorted(data["connections"])), None)
        self._write(data)

    def set_default(self, connection_id: str) -> None:
        data = self.snapshot()
        if connection_id not in data["connections"]:
            raise KeyError(connection_id)
        data["default_connection_id"] = connection_id
        self._write(data)

    def migrate_legacy(self, connection: dict[str, Any]) -> bool:
        if self.snapshot()["connections"]:
            return False
        try:
            self.upsert(
                DEFAULT_CONNECTION_ID,
                {
                    "name": "Default MySQL",
                    "driver": "mysql",
                    **connection,
                    "semantic_enabled": True,
                },
            )
        except (TypeError, ValueError):
            return False
        return True

    def semantic_environment(self) -> dict[str, str]:
        environment: dict[str, str] = {}
        for connection_id, connection in self.snapshot()["connections"].items():
            if not connection["semantic_enabled"]:
                continue
            environment[self.environment_name(connection_id)] = json.dumps(
                {
                    "driver": connection["driver"],
                    "host": connection["host"],
                    "port": connection["port"],
                    "user": connection["user"],
                    "password": connection["password"],
                    "database": connection["database"],
                },
                ensure_ascii=True,
                separators=(",", ":"),
            )
        return environment

    def sync_ktx_project(self, project_dir: Path) -> bool:
        semantic_connections = {
            connection_id: connection
            for connection_id, connection in self.snapshot()["connections"].items()
            if connection["semantic_enabled"]
        }
        config_path = project_dir / "ktx.yaml"
        if not semantic_connections and not config_path.is_file():
            return False

        if config_path.is_file():
            loaded = yaml.safe_load(config_path.read_text(encoding="utf-8"))
            if loaded is None:
                config: dict[str, Any] = {}
            elif isinstance(loaded, dict):
                config = loaded
            else:
                raise ValueError("ktx.yaml must contain a YAML object")
        else:
            config = {}

        connections = config.get("connections")
        if connections is None:
            connections = {}
        if not isinstance(connections, dict):
            raise ValueError("ktx.yaml connections must contain a YAML object")

        old_managed_ids = {
            str(connection_id)
            for connection_id, value in connections.items()
            if isinstance(value, dict)
            and isinstance(value.get("ref"), str)
            and value["ref"].startswith(f"env:{MANAGED_ENV_PREFIX}")
        }
        for connection_id in old_managed_ids:
            connections.pop(connection_id, None)
        for connection_id in semantic_connections:
            connections[connection_id] = {
                "ref": f"env:{self.environment_name(connection_id)}",
            }
        config["connections"] = connections

        setup = config.get("setup")
        if setup is None:
            setup = {}
        if not isinstance(setup, dict):
            raise ValueError("ktx.yaml setup must contain a YAML object")
        configured_ids = setup.get("database_connection_ids", [])
        if not isinstance(configured_ids, list):
            raise ValueError("ktx.yaml setup.database_connection_ids must contain a YAML list")
        preserved_ids = [
            value
            for value in configured_ids
            if isinstance(value, str) and value not in old_managed_ids and value not in semantic_connections
        ]
        setup["database_connection_ids"] = [*preserved_ids, *sorted(semantic_connections)]
        config["setup"] = setup

        if semantic_connections:
            ingest = config.get("ingest")
            if ingest is None:
                ingest = {}
            if not isinstance(ingest, dict):
                raise ValueError("ktx.yaml ingest must contain a YAML object")
            adapters = ingest.get("adapters", [])
            if not isinstance(adapters, list):
                raise ValueError("ktx.yaml ingest.adapters must contain a YAML list")
            if "live-database" not in adapters:
                adapters.append("live-database")
            ingest["adapters"] = adapters

            embeddings = ingest.get("embeddings")
            if embeddings is None:
                embeddings = {}
            if not isinstance(embeddings, dict):
                raise ValueError("ktx.yaml ingest.embeddings must contain a YAML object")
            # The host owns this policy field.  Keeping the rest of the user
            # block intact preserves unrelated KTX settings while ensuring a
            # managed semantic scan never starts an embedding runtime.
            embeddings.clear()
            embeddings["backend"] = "none"
            ingest["embeddings"] = embeddings
            config["ingest"] = ingest

            scan = config.get("scan")
            if scan is None:
                scan = {}
            if not isinstance(scan, dict):
                raise ValueError("ktx.yaml scan must contain a YAML object")
            enrichment = scan.get("enrichment")
            if enrichment is None:
                enrichment = {}
            if not isinstance(enrichment, dict):
                raise ValueError("ktx.yaml scan.enrichment must contain a YAML object")
            enrichment.clear()
            enrichment["mode"] = "llm"
            scan["enrichment"] = enrichment
            relationships = scan.get("relationships")
            if relationships is None:
                relationships = {}
            if not isinstance(relationships, dict):
                raise ValueError("ktx.yaml scan.relationships must contain a YAML object")
            relationships["enabled"] = True
            relationships["llmProposals"] = True
            relationships["validationRequiredForManifest"] = True
            scan["relationships"] = relationships
            config["scan"] = scan

        self._ensure_project_layout(project_dir)
        serialized = yaml.safe_dump(
            config,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )
        self._atomic_write_text(config_path, serialized)
        return True

    @staticmethod
    def environment_name(connection_id: str) -> str:
        return f"{MANAGED_ENV_PREFIX}{connection_id.upper().replace('-', '_')}"

    @staticmethod
    def _empty_snapshot() -> dict[str, Any]:
        return {
            "version": REGISTRY_VERSION,
            "default_connection_id": None,
            "connections": {},
        }

    @staticmethod
    def _normalize_connection(
        connection_id: str,
        values: dict[str, Any],
        *,
        existing: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if not CONNECTION_ID_PATTERN.fullmatch(connection_id):
            raise ValueError("Connection ID must use lowercase letters, numbers, and hyphens")
        if not isinstance(values, dict):
            raise TypeError("Connection must be a JSON object")

        base = dict(existing or {})
        base.update(values)
        password = values.get("password")
        if existing is not None and (password is None or str(password) == ""):
            base["password"] = existing.get("password", "")

        driver = str(base.get("driver") or "mysql").strip().lower()
        if driver not in SUPPORTED_DATABASE_DRIVERS:
            raise ValueError(f"Unsupported database driver: {driver}")
        host = str(base.get("host") or "").strip()
        user = str(base.get("user") or "").strip()
        database = str(base.get("database") or "").strip()
        if not host:
            raise ValueError("Database host is required")
        if not user:
            raise ValueError("Database user is required")
        if not database:
            raise ValueError("Database name is required")
        port = int(base.get("port") or 3306)
        if port < 1 or port > 65535:
            raise ValueError("Database port must be between 1 and 65535")

        return {
            "name": str(base.get("name") or connection_id).strip() or connection_id,
            "driver": driver,
            "host": host,
            "port": port,
            "user": user,
            "password": str(base.get("password") or ""),
            "database": database,
            "semantic_enabled": bool(base.get("semantic_enabled", True)),
        }

    def _write(self, data: dict[str, Any]) -> None:
        self._atomic_write_text(
            self.path,
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        )

    @staticmethod
    def _ensure_project_layout(project_dir: Path) -> None:
        for relative_dir in (".ktx/cache", "semantic-layer", "raw-sources", "wiki/global"):
            (project_dir / relative_dir).mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _atomic_write_text(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary_path.write_text(content, encoding="utf-8")
        os.replace(temporary_path, path)
