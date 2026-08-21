import asyncio
import json

from src.ai.config import AIConfig
from src.ai.profiles import LLMProfileStore
from src.connection_registry import ConnectionRegistry
from src.config_manager import ConfigManager


def test_profile_store_migrates_legacy_model_without_secret(tmp_path):
    config = AIConfig(
        openai_api_key="secret-key",
        openai_base_url="https://api.deepseek.com/v1",
        default_model="deepseek-v4-flash",
    )

    store = LLMProfileStore(tmp_path / "llm_profiles.json", config)
    profile = store.default_profile()

    assert profile.model == "deepseek-v4-flash"
    assert profile.base_url == "https://api.deepseek.com/v1"

    payload = json.loads((tmp_path / "llm_profiles.json").read_text(encoding="utf-8"))
    assert "secret-key" not in json.dumps(payload)


def _configure_manager_for_llm_test(manager, tmp_path, monkeypatch):
    semantic_project_dir = tmp_path / "semantic-context"
    semantic_project_dir.mkdir()
    (semantic_project_dir / "ktx.yaml").write_text("connections: {}\n", encoding="utf-8")

    async def reload_mcp():
        return None

    monkeypatch.setattr(manager, "semantic_project_dir", semantic_project_dir)
    monkeypatch.setattr(manager, "connection_registry", ConnectionRegistry(tmp_path / "connections.json"))
    monkeypatch.setattr(manager, "_reload_mcp", reload_mcp)
    return semantic_project_dir


def test_legacy_llm_update_changes_profile_not_secret_store(tmp_path, monkeypatch):
    manager = ConfigManager()
    semantic_project_dir = _configure_manager_for_llm_test(manager, tmp_path, monkeypatch)
    monkeypatch.setattr(manager, "ai_config", AIConfig(
        openai_api_key="existing-key",
        openai_base_url="https://old.example/v1",
        default_model="deepseek-chat",
    ))
    monkeypatch.setattr(
        manager,
        "llm_profiles",
        LLMProfileStore(tmp_path / "llm_profiles.json", manager.ai_config),
    )

    asyncio.run(
        manager.update_llm_config(
            {
                "provider": "openai",
                "model": "deepseek-v4-flash",
                "openai_base_url": "https://api.deepseek.com/v1",
            }
        )
    )

    default_profile = manager.llm_profiles.default_profile()
    assert default_profile.model == "deepseek-v4-flash"
    assert default_profile.base_url == "https://api.deepseek.com/v1"
    assert manager.ai_config.default_model == "deepseek-v4-flash"
    assert manager.ai_config.openai_api_key == "existing-key"
    semantic_config = (semantic_project_dir / "ktx.yaml").read_text(encoding="utf-8")
    assert "backend: openai-compatible" in semantic_config
    assert "api_key: env:DATA_AGENT_KTX_LLM_API_KEY" in semantic_config
    assert "default: env:DATA_AGENT_KTX_LLM_MODEL" in semantic_config
    assert "existing-key" not in semantic_config


def test_setting_default_profile_updates_runtime_config(tmp_path, monkeypatch):
    manager = ConfigManager()
    _configure_manager_for_llm_test(manager, tmp_path, monkeypatch)
    monkeypatch.setattr(manager, "ai_config", AIConfig(default_model="deepseek-chat"))
    monkeypatch.setattr(
        manager,
        "llm_profiles",
        LLMProfileStore(tmp_path / "llm_profiles.json", manager.ai_config),
    )

    asyncio.run(
        manager.save_llm_profile(
            {
                "id": "fast",
                "name": "Flash",
                "provider": "openai",
                "model": "deepseek-v4-flash",
                "base_url": "https://api.deepseek.com/v1",
                "is_default": True,
            }
        )
    )

    assert manager.ai_config.default_model == "deepseek-v4-flash"
    assert manager.ai_config.openai_base_url == "https://api.deepseek.com/v1"
