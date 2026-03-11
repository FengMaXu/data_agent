"""
完整测试：模拟 code_executor.py 的完整执行流程
"""
import asyncio
import subprocess
import sys
import os
from pathlib import Path

async def test_full_encoding():
    """完整模拟 code_executor.py 的执行"""

    # 模拟 font_config
    font_config = """# -*- coding: utf-8 -*-
import matplotlib.pyplot as plt
import matplotlib
import os
import sys

# 强制设置 stdout/stderr 编码为 UTF-8
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from pathlib import Path

# 环境变量
DATA_DIR = os.environ.get('DATA_DIR', os.getcwd())
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', os.getcwd())

# 字体配置（简化版）
from matplotlib import font_manager
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FONTS_DIR = PROJECT_ROOT / "src" / "workspace" / "fonts"
font_files = [FONTS_DIR / "SourceHanSansSC-Normal.otf"]
font_loaded = False
for fpath in font_files:
    if fpath.exists():
        try:
            font_manager.fontManager.addfont(str(fpath))
            prop = font_manager.FontProperties(fname=str(fpath))
            matplotlib.rc('font', family=prop.get_name())
            font_loaded = True
            break
        except:
            continue
if not font_loaded:
    matplotlib.rc('font', family='sans-serif')
matplotlib.rcParams['axes.unicode_minus'] = False
"""

    # 用户代码
    user_code = """
# 模拟数据分析
data = {
    '行业': ['批发业', '零售业', '住宿业'],
    '销售额': [7276.57, 499.88, 49.74],
    '增速': [-23.34, 16.46, 13.54]
}

print("=== 2025年12月各行业销售数据摘要 ===")
print(f"{'行业名称':<10} {'销售额_万元':<15} {'增速_%':<10}")
for i, industry in enumerate(data['行业']):
    print(f"{industry:<10} {data['销售额'][i]:<15.2f} {data['增速'][i]:<10.2f}")
print(f"总计: {sum(data['销售额']):.2f} 万元")

# 简单绘图测试
fig, ax = plt.subplots(figsize=(8, 5))
ax.bar(data['行业'], data['销售额'], color='steelblue')
ax.set_title('2025年12月各行业销售额对比')
ax.set_ylabel('销售额（万元）')
ax.grid(axis='y', alpha=0.3)

output_file = os.path.join(OUTPUT_DIR, 'test_chart.png')
plt.savefig(output_file, dpi=100, bbox_inches='tight')
print(f"图表已保存到: {output_file}")
"""

    full_code = font_config + "\n" + user_code

    # 写入脚本
    session_dir = Path("D:/data_agent/workspace/test_encoding_session")
    session_dir.mkdir(exist_ok=True)
    (session_dir / "output").mkdir(exist_ok=True)

    script_path = session_dir / "test_script.py"
    script_path.write_text(full_code, encoding="utf-8")

    # 环境变量
    env = {
        **os.environ,
        "WORKSPACE_DIR": str(session_dir),
        "DATA_DIR": str(session_dir / "data"),
        "OUTPUT_DIR": str(session_dir / "output"),
        "PYTHONIOENCODING": "utf-8",
    }

    # 构建命令
    python_cmd = [sys.executable]
    if sys.platform == "win32":
        python_cmd.extend(["-X", "utf8"])
    python_cmd.append(str(script_path))

    # 执行
    print(f"执行命令: {' '.join(python_cmd)}")
    result = subprocess.run(
        python_cmd,
        cwd=str(session_dir),
        capture_output=True,
        env=env,
        timeout=30,
        text=False,  # bytes 模式
    )

    # 解码
    stdout_text = result.stdout.decode("utf-8", errors="replace")
    stderr_text = result.stderr.decode("utf-8", errors="replace")

    print("\n=== STDOUT ===")
    print(stdout_text)
    if stderr_text:
        print("\n=== STDERR ===")
        print(stderr_text)

    # 验证
    success = True
    if "批发业" not in stdout_text or "零售业" not in stdout_text:
        print("\n[FAIL] 输出中有乱码")
        success = False
    else:
        print("\n[PASS] 中文输出正常")

    # 检查图表文件
    chart_file = session_dir / "output" / "test_chart.png"
    if chart_file.exists():
        print(f"[PASS] 图表已生成: {chart_file}")
    else:
        print(f"[FAIL] 图表未生成")

    return success

if __name__ == "__main__":
    result = asyncio.run(test_full_encoding())
    sys.exit(0 if result else 1)
