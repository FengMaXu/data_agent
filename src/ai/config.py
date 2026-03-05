"""
AI Gateway 配置模块
从环境变量 / .env 文件加载 LLM 相关配置
"""

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class AIConfig:
    """AI 网关全局配置"""

    # API Keys
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # OpenAI-compatible 自定义 API 端点（用于智谱 GLM、DeepSeek 等）
    openai_base_url: str = ""

    # 默认模型
    default_model: str = "gpt-4o-mini"

    # 请求参数
    temperature: float = 0.0
    max_tokens: int = 4096

    # MCP Server 配置
    mcp_server_command: str = "python"
    mcp_server_script: str = ""  # mysql_mcp_server/server.py 的绝对路径

    # 数据库环境变量（传递给 MCP Server 子进程）
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = ""
    mysql_password: str = ""
    mysql_database: str = ""

    @classmethod
    def from_env(cls, dotenv_path: str | None = None) -> "AIConfig":
        """从 .env 文件和环境变量加载配置"""
        # 尝试加载 .env
        if dotenv_path:
            _load_dotenv(dotenv_path)
        else:
            # 自动查找项目根目录的 .env
            project_root = Path(__file__).resolve().parent.parent.parent
            env_file = project_root / ".env"
            if env_file.exists():
                _load_dotenv(str(env_file))

        return cls(
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
            openai_base_url=os.getenv("OPENAI_BASE_URL", ""),
            default_model=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"),
            temperature=float(os.getenv("TEMPERATURE", "0.0")),
            max_tokens=int(os.getenv("MAX_TOKENS", "4096")),
            mcp_server_command=os.getenv("MCP_SERVER_COMMAND", "python"),
            mcp_server_script=os.getenv("MCP_SERVER_SCRIPT", ""),
            mysql_host=os.getenv("MYSQL_HOST", "localhost"),
            mysql_port=int(os.getenv("MYSQL_PORT", "3306")),
            mysql_user=os.getenv("MYSQL_USER", ""),
            mysql_password=os.getenv("MYSQL_PASSWORD", ""),
            mysql_database=os.getenv("MYSQL_DATABASE", ""),
        )

    def get_mcp_env(self) -> dict[str, str]:
        """获取传递给 MCP Server 子进程的环境变量"""
        env = os.environ.copy()
        env.update(
            {
                "MYSQL_HOST": self.mysql_host,
                "MYSQL_PORT": str(self.mysql_port),
                "MYSQL_USER": self.mysql_user,
                "MYSQL_PASSWORD": self.mysql_password,
                "MYSQL_DATABASE": self.mysql_database,
            }
        )
        return env


def _load_dotenv(path: str) -> None:
    """手动解析 .env 文件，避免强依赖 python-dotenv"""
    try:
        from dotenv import load_dotenv

        load_dotenv(path)
    except ImportError:
        # fallback: 手动解析
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip().strip("'\"")
                        if key and key not in os.environ:
                            os.environ[key] = value
        except FileNotFoundError:
            pass
