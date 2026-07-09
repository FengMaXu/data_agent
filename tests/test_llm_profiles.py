import asyncio
import json

from src.ai.config import AIConfig
from src.ai.profiles import LLMProfileStore
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


def test_legacy_llm_update_changes_profile_not_secret_store(tmp_path):
    manager = ConfigManager()
    manager.ai_config = AIConfig(
        openai_api_key="existing-key",
        openai_base_url="https://old.example/v1",
        default_model="deepseek-chat",
    )
    manager.llm_profiles = LLMProfileStore(tmp_path / "llm_profiles.json", manager.ai_config)

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


def test_setting_default_profile_updates_runtime_config(tmp_path):
    manager = ConfigManager()
    manager.ai_config = AIConfig(default_model="deepseek-chat")
    manager.llm_profiles = LLMProfileStore(tmp_path / "llm_profiles.json", manager.ai_config)

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
