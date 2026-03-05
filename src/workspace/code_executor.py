"""
Python 代码沙盒执行器
允许 Agent 编写和执行 Python 分析脚本，用于数据清洗、统计计算和图表绘制。

安全机制：
- 在独立子进程中执行，设置超时限制
- 工作目录锁定在 workspace 内
- 捕获 stdout/stderr 作为工具结果返回
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
from pathlib import Path

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.workspace.workspace_manager import WorkspaceManager

logger = logging.getLogger("data_agent.workspace.code_executor")

# 默认超时（秒）
DEFAULT_TIMEOUT = 60


class CodeExecutor:
    """
    Python 沙盒代码执行器

    在独立子进程中运行 Agent 生成的 Python 脚本，
    工作目录设定为 WorkspaceManager 的 session_dir。
    """

    def __init__(
        self,
        workspace: WorkspaceManager,
        timeout: int = DEFAULT_TIMEOUT,
        allowed_packages: list[str] | None = None,
    ):
        self.workspace = workspace
        self.timeout = timeout
        # 预期可用的数据分析包（不做强制校验，仅用于提示 Agent）
        self.allowed_packages = allowed_packages or [
            "pandas",
            "numpy",
            "matplotlib",
            "seaborn",
            "json",
            "csv",
            "os",
            "pathlib",
            "math",
            "statistics",
            "datetime",
            "collections",
            "re",
        ]

    async def execute_code(self, code: str, description: str = "") -> dict:
        """
        在沙盒子进程中执行 Python 代码

        Args:
            code: Python 代码字符串
            description: 代码描述（用于日志）

        Returns:
            包含 stdout, stderr, exit_code, output_files 的字典
        """
        logger.info(f"[CodeExecutor] 执行代码: {description or '(未命名)'}")

        # 将代码保存到工作区的 scripts 目录
        script_name = f"script_{len(list(self.workspace.scripts_dir.iterdir())) + 1}.py"
        script_path = self.workspace.scripts_dir / script_name
        script_path.write_text(code, encoding="utf-8")

        # 记录 output 目录执行前的文件快照
        output_before = set(
            str(p) for p in self.workspace.output_dir.rglob("*") if p.is_file()
        )

        # 在子进程中执行
        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(script_path),
                cwd=str(self.workspace.session_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={
                    **os.environ,
                    "WORKSPACE_DIR": str(self.workspace.session_dir),
                    "DATA_DIR": str(self.workspace.data_dir),
                    "OUTPUT_DIR": str(self.workspace.output_dir),
                },
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=self.timeout
            )

            stdout_text = stdout.decode("utf-8", errors="replace")
            stderr_text = stderr.decode("utf-8", errors="replace")

            # 检测新生成的文件
            output_after = set(
                str(p) for p in self.workspace.output_dir.rglob("*") if p.is_file()
            )
            new_files = [
                str(Path(f).relative_to(self.workspace.session_dir))
                for f in (output_after - output_before)
            ]

            result = {
                "status": "success" if process.returncode == 0 else "error",
                "exit_code": process.returncode,
                "stdout": stdout_text[:10000] if stdout_text else "",
                "stderr": stderr_text[:5000] if stderr_text else "",
                "script_saved_as": str(Path(script_name)),
                "new_output_files": new_files,
            }

            logger.info(
                f"[CodeExecutor] 执行完成: exit_code={process.returncode}, "
                f"新文件={len(new_files)}"
            )
            return result

        except asyncio.TimeoutError:
            logger.warning(f"[CodeExecutor] 执行超时 ({self.timeout}s)")
            return {
                "status": "timeout",
                "exit_code": -1,
                "stdout": "",
                "stderr": f"代码执行超时（限制 {self.timeout} 秒）",
                "script_saved_as": script_name,
                "new_output_files": [],
            }
        except Exception as e:
            logger.error(f"[CodeExecutor] 执行异常: {e}")
            return {
                "status": "error",
                "exit_code": -1,
                "stdout": "",
                "stderr": f"执行异常: {str(e)}",
                "script_saved_as": script_name,
                "new_output_files": [],
            }


def create_code_tools(executor: CodeExecutor) -> list[AgentTool]:
    """创建代码执行相关的 Agent 工具"""

    async def _run_python(tool_call_id: str, arguments: dict) -> AgentToolResult:
        """执行 Python 分析脚本"""
        code = arguments.get("code", "")
        description = arguments.get("description", "")

        if not code.strip():
            return AgentToolResult(
                content=[ToolResultContent(type="text", text="错误: 代码不能为空")],
                is_error=True,
            )

        result = await executor.execute_code(code, description)

        # 格式化输出
        output_parts = []
        if result["status"] == "success":
            output_parts.append("✅ 代码执行成功")
        elif result["status"] == "timeout":
            output_parts.append("⏰ 代码执行超时")
        else:
            output_parts.append(f"❌ 代码执行失败 (exit_code={result['exit_code']})")

        if result["stdout"]:
            output_parts.append(f"\n--- stdout ---\n{result['stdout']}")
        if result["stderr"]:
            output_parts.append(f"\n--- stderr ---\n{result['stderr']}")
        if result["new_output_files"]:
            output_parts.append(
                f"\n📁 新生成的文件:\n"
                + "\n".join(f"  - {f}" for f in result["new_output_files"])
            )

        return AgentToolResult(
            content=[ToolResultContent(type="text", text="\n".join(output_parts))],
            is_error=(result["status"] != "success"),
        )

    packages_hint = ", ".join(executor.allowed_packages)

    return [
        AgentTool(
            name="run_python",
            label="执行 Python 代码",
            description=(
                "在沙盒环境中执行 Python 分析脚本。\n"
                "用途：数据清洗、统计计算、绘制图表(Matplotlib/Seaborn)等。\n\n"
                "环境变量可用:\n"
                "  - os.environ['DATA_DIR']: 数据文件目录\n"
                "  - os.environ['OUTPUT_DIR']: 图表/结果输出目录\n\n"
                "示例：读取 data/result.csv 并绘制柱状图保存到 output/chart.png\n\n"
                f"可用的常见库: {packages_hint}\n\n"
                "重要提示：\n"
                "1. 图表请保存到 OUTPUT_DIR 目录下\n"
                "2. matplotlib 不要调用 plt.show()，请用 plt.savefig()\n"
                "3. 使用 print() 输出关键数据摘要"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "要执行的 Python 代码",
                    },
                    "description": {
                        "type": "string",
                        "description": "代码功能简述（用于日志记录）",
                    },
                },
                "required": ["code"],
            },
            execute_fn=_run_python,
        ),
    ]
