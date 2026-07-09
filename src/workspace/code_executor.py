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
import subprocess
import threading
from pathlib import Path
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.workspace.workspace_manager import WorkspaceManager

logger = logging.getLogger("data_agent.workspace.code_executor")

# 默认超时（秒）
DEFAULT_TIMEOUT = 60

# Windows 平台检测
IS_WINDOWS = sys.platform == "win32"

# 原子计数器，用于生成唯一脚本名
_script_counter_lock = threading.Lock()
_script_counter = 0


def _next_script_name() -> str:
    """使用时间戳 + 原子计数器生成唯一脚本名"""
    global _script_counter
    with _script_counter_lock:
        _script_counter += 1
        count = _script_counter
    import time
    return f"script_{int(time.time())}_{count}.py"


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
        python_runtime: dict[str, Any] | None = None,
    ):
        self.workspace = workspace
        self.timeout = timeout
        self.python_runtime = python_runtime or {"mode": "bundled", "executable": ""}
        # 预期可用的数据分析包（不做强制校验，仅用于提示 Agent）
        self.allowed_packages = allowed_packages or [
            "pandas",
            "numpy",
            "matplotlib",
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

    def _python_command(self, script_path: Path) -> list[str]:
        mode = str(self.python_runtime.get("mode") or "bundled").lower()
        executable = str(self.python_runtime.get("executable") or "").strip()

        if mode == "external" and executable:
            cmd = [executable]
            if IS_WINDOWS:
                cmd.extend(["-X", "utf8"])
            cmd.append(str(script_path))
            return cmd

        if getattr(sys, "frozen", False):
            return [
                sys.executable,
                "--data-agent-run-python-script",
                str(script_path),
            ]

        cmd = [sys.executable]
        if IS_WINDOWS:
            cmd.extend(["-X", "utf8"])
        cmd.append(str(script_path))
        return cmd

    async def execute_code(self, code: str, description: str = "") -> dict:
        """
        在沙盒子进程中执行 Python 代码

        Args:
            code: Python 代码字符串
            description: 代码描述（用于日志）

        Returns:
            包含 stdout, stderr, exit_code, output_files 的字典
        """
        logger.info(
            f"[CodeExecutor] 执行代码: {description or '(未命名)'} (代码长度: {len(code)} 字符)"
        )

        # 将代码保存到工作区的 scripts 目录
        script_name = _next_script_name()
        script_path = self.workspace.scripts_dir / script_name
        # 注入中文字体配置和环境代码
        # 使用项目本地字体，摆脱对操作系统的依赖
        # -*- coding: utf-8 -*-
        font_config = """# -*- coding: utf-8 -*-
import matplotlib
import os
import sys

# 在桌面打包环境中固定使用无头后端，避免拉起 Qt/Tk GUI 依赖。
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# 强制设置 stdout/stderr 编码为 UTF-8，解决 Windows 中文输出乱码问题
# 这在沙盒环境中是安全的，因为输出是通过管道捕获的
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 获取环境变量中定义的目录
DATA_DIR = os.environ.get('DATA_DIR', os.getcwd())
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', os.getcwd())

# 使用项目本地字体文件（资源本地化）
# 这些字体文件作为项目代码的一部分，确保跨环境一致性
from matplotlib import font_manager
from pathlib import Path

# 获取项目根目录下的字体文件夹
_PROJECT_ROOT = Path(__file__).resolve().parents[4]  # 从 workspace/session_xxx/scripts/script_x.py 回溯到项目根目录
FONTS_DIR = _PROJECT_ROOT / "src" / "workspace" / "fonts"

font_files = [
    FONTS_DIR / "SourceHanSansSC-Normal.otf",  # 思源黑体（主选）
]

font_loaded = False
for fpath in font_files:
    if fpath.exists():
        try:
            # 内存级注册：将字体文件加入当前进程的可用字体清单
            font_manager.fontManager.addfont(str(fpath))
            # 指纹识别：通过 FontProperties 获取字体的内部名称
            prop = font_manager.FontProperties(fname=str(fpath))
            font_name = prop.get_name()
            # 声明：设置 Matplotlib 默认使用该字体
            matplotlib.rc('font', family=font_name)
            font_loaded = True
            break
        except Exception as e:
            continue

if not font_loaded:
    # 备选方案：尝试系统字体（仅作为降级方案）
    for font in ['Microsoft YaHei', 'SimHei', 'Arial Unicode MS', 'sans-serif']:
        try:
            matplotlib.rc('font', family=font)
            break
        except:
            continue

# 符号修正：解决中文字体加载后负号显示为方块的问题
matplotlib.rcParams['axes.unicode_minus'] = False

# 劫持 plt.savefig，实现自动重定向到 output 目录
_original_savefig = plt.savefig
def _patched_savefig(fname, *args, **kwargs):
    # 如果 fname 是简单的文件名（不包含路径分隔符），则重定向到 OUTPUT_DIR
    if isinstance(fname, str) and not os.path.isabs(fname) and os.path.sep not in fname:
        target_path = os.path.join(OUTPUT_DIR, fname)
        # 确保目录存在
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        return _original_savefig(target_path, *args, **kwargs)
    return _original_savefig(fname, *args, **kwargs)

plt.savefig = _patched_savefig
"""
        full_code = font_config + "\n" + code
        script_path.write_text(full_code, encoding="utf-8")

        # 在 Windows 上添加 UTF-8 BOM 来让 Python 识别源文件编码
        # 这对于 print() 语句中的中文字符串字面量很重要
        logger.debug(f"[CodeExecutor] 脚本已保存: {script_path}")

        # 记录 output 目录执行前的文件快照（路径 -> mtime）
        output_before: dict[str, float] = {}
        for p in self.workspace.output_dir.rglob("*"):
            if p.is_file():
                output_before[str(p)] = p.stat().st_mtime

        # 在子进程中执行
        try:
            # 定义执行逻辑以在线程中运行（针对 Windows 的优化）
            def run_subprocess_blocked():
                env = {
                    **os.environ,
                    "WORKSPACE_DIR": str(self.workspace.session_dir),
                    "DATA_DIR": str(self.workspace.data_dir),
                    "OUTPUT_DIR": str(self.workspace.output_dir),
                    "MPLBACKEND": "Agg",
                    # 强制 Python 使用 UTF-8 编码处理 stdin/stdout/stderr
                    "PYTHONIOENCODING": "utf-8",
                }
                # 在 Windows 上使用 -X utf8 选项强制 UTF-8 模式
                python_cmd = self._python_command(script_path)

                return subprocess.run(
                    python_cmd,
                    cwd=str(self.workspace.session_dir),
                    capture_output=True,
                    env=env,
                    timeout=self.timeout,
                    # 关键：使用 bytes 模式而非 text 模式，然后手动用 UTF-8 解码
                    # 这避免 Windows 使用系统默认编码 (GBK) 解码输出
                    text=False,
                )

            # 使用 to_thread 避免在 Windows 上阻塞事件循环，或者在 Unix 上保持一致性
            # 注意：在 Unix 上也可以用 create_subprocess_exec，但 to_thread + run 相对更鲁棒
            if IS_WINDOWS:
                logger.debug("[CodeExecutor] Windows 环境使用线程池+同步子进程")
                process_result = await asyncio.to_thread(run_subprocess_blocked)
                # 手动用 UTF-8 解码 bytes 输出，避免 Windows 系统编码干扰
                stdout_text = process_result.stdout.decode("utf-8", errors="replace")
                stderr_text = process_result.stderr.decode("utf-8", errors="replace")
                exit_code = process_result.returncode
            else:
                logger.debug("[CodeExecutor] Unix 环境使用异步子进程")
                # Unix 环境也添加 UTF-8 支持
                python_cmd = self._python_command(script_path)

                process = await asyncio.create_subprocess_exec(
                    *python_cmd,
                    cwd=str(self.workspace.session_dir),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={
                        **os.environ,
                        "WORKSPACE_DIR": str(self.workspace.session_dir),
                        "DATA_DIR": str(self.workspace.data_dir),
                        "OUTPUT_DIR": str(self.workspace.output_dir),
                        "MPLBACKEND": "Agg",
                        # 强制 Python 使用 UTF-8 编码处理 stdin/stdout/stderr
                        "PYTHONIOENCODING": "utf-8",
                    },
                )
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=self.timeout
                )
                stdout_text = stdout.decode("utf-8", errors="replace")
                stderr_text = stderr.decode("utf-8", errors="replace")
                exit_code = process.returncode

            # 检测新增或修改的文件（比较 mtime）
            new_files = []
            for p in self.workspace.output_dir.rglob("*"):
                if p.is_file():
                    fpath = str(p)
                    mtime = p.stat().st_mtime
                    if fpath not in output_before or mtime > output_before[fpath]:
                        new_files.append(
                            str(p.relative_to(self.workspace.session_dir))
                        )

            result = {
                "status": "success" if exit_code == 0 else "error",
                "exit_code": exit_code,
                "stdout": stdout_text[:10000] if stdout_text else "",
                "stderr": stderr_text[:5000] if stderr_text else "",
                "script_saved_as": str(Path(script_name)),
                "new_output_files": new_files,
            }

            logger.info(
                f"[CodeExecutor] 执行完成: exit_code={exit_code}, "
                f"新文件={len(new_files)}"
            )
            return result

        except (asyncio.TimeoutError, subprocess.TimeoutExpired):
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
            import traceback

            error_detail = traceback.format_exc()
            logger.error(f"[CodeExecutor] 执行异常: {e}\n{error_detail}")
            return {
                "status": "error",
                "exit_code": -1,
                "stdout": "",
                "stderr": f"执行异常: {str(e)}\n{error_detail}",
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
                "用途：数据清洗、统计计算、绘制图表等。\n\n"
                "环境变量可用:\n"
                "  - os.environ['DATA_DIR']: 数据文件目录\n"
                "  - os.environ['OUTPUT_DIR']: 图表/结果输出目录\n\n"
                "示例：读取 data/result.csv 并绘制柱状图保存到 output/chart.png\n\n"
                f"可用的常见库: {packages_hint}\n\n"
                "重要提示：\n"
                "1. 图表请保存到 OUTPUT_DIR 目录下\n"
                "2. matplotlib 不要调用 plt.show()，请用 plt.savefig()\n"
                "3. 使用 print() 输出关键数据摘要\n"
                "4. 避免使用 seaborn 等未安装的库\n"
                "5. 如果代码较长，建议分步骤执行（先准备数据，再绘图）"
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
            read_only=False,
            resource="process",
            max_concurrency=1,
        ),
    ]
