"""
测试本地字体配置是否正常工作
"""
import sys
import matplotlib
import matplotlib.pyplot as plt
from matplotlib import font_manager
from pathlib import Path

# 获取字体目录
FONTS_DIR = Path(__file__).parent.parent / "src" / "workspace" / "fonts"
font_file = FONTS_DIR / "SourceHanSansSC-Normal.otf"

print(f"字体文件路径: {font_file}")
print(f"字体文件存在: {font_file.exists()}")

if font_file.exists():
    try:
        # 注册字体
        font_manager.fontManager.addfont(str(font_file))
        prop = font_manager.FontProperties(fname=str(font_file))
        font_name = prop.get_name()
        print(f"字体内部名称: {font_name}")

        # 设置为默认字体
        matplotlib.rc('font', family=font_name)
        matplotlib.rcParams['axes.unicode_minus'] = False

        # 测试绘图
        fig, ax = plt.subplots(figsize=(8, 5))
        x = ['一月', '二月', '三月', '四月', '五月', '六月']
        y = [120, 150, 180, 220, 260, 310]

        ax.bar(x, y, color='steelblue')
        ax.set_title('2025年上半年销售趋势测试', fontsize=14)
        ax.set_xlabel('月份', fontsize=12)
        ax.set_ylabel('销售额（万元）', fontsize=12)
        ax.grid(axis='y', alpha=0.3)

        # 保存测试图片
        output_path = Path(__file__).parent / "test_font_output.png"
        plt.savefig(output_path, dpi=100, bbox_inches='tight')
        print(f"测试图片已保存: {output_path}")
        print("字体配置测试通过！中文字符应正常显示。")

    except Exception as e:
        print(f"字体加载失败: {e}")
        import traceback
        traceback.print_exc()
else:
    print("错误: 字体文件不存在，请先下载字体文件")
    sys.exit(1)
