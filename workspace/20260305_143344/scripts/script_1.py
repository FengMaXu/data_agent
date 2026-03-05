import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
import os

# 数据准备
data = {
    '企业名称': ['深圳市怡亚通供应链股份有限公司', '深圳盛盟供应链管理有限公司', '深圳宏桥供应链管理有限公司'],
    '销售额_亿元': [764.0310, 675.2391, 343.4627],
    '行业中类': ['贸易经纪与代理', '机械设备批发', '矿产品批发']
}

# 创建DataFrame
df = pd.DataFrame(data)

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 创建图形
fig, ax = plt.subplots(figsize=(12, 8))

# 创建柱形图
bars = ax.bar(df['企业名称'], df['销售额_亿元'], color=['#1f77b4', '#ff7f0e', '#2ca02c'], alpha=0.8)

# 设置标题和标签
ax.set_title('2025年12月批发业累计销售额前三名企业', fontsize=16, fontweight='bold', pad=20)
ax.set_xlabel('企业名称', fontsize=12)
ax.set_ylabel('累计销售额（亿元）', fontsize=12)

# 在柱子上方添加数值标签
for bar in bars:
    height = bar.get_height()
    ax.text(bar.get_x() + bar.get_width()/2., height + 5,
            f'{height:.1f}亿元',
            ha='center', va='bottom', fontsize=11, fontweight='bold')

# 添加行业中类信息
for i, (bar, industry) in enumerate(zip(bars, df['行业中类'])):
    ax.text(bar.get_x() + bar.get_width()/2., -max(df['销售额_亿元'])*0.05,
            industry,
            ha='center', va='top', fontsize=10, color='gray', fontstyle='italic')

# 设置y轴范围
ax.set_ylim(0, max(df['销售额_亿元']) * 1.15)

# 添加网格线
ax.grid(axis='y', alpha=0.3, linestyle='--')

# 添加总销售额信息
total_sales = df['销售额_亿元'].sum()
ax.text(0.02, 0.98, f'前三名总销售额: {total_sales:.1f}亿元\n占批发业总额: 24.5%',
        transform=ax.transAxes, fontsize=11,
        verticalalignment='top',
        bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

# 调整布局
plt.tight_layout()

# 保存图表
output_dir = os.environ.get('OUTPUT_DIR', '.')
output_path = os.path.join(output_dir, 'wholesale_top3_companies_2025.png')
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"图表已保存到: {output_path}")

# 显示数据摘要
print("\n数据摘要:")
print("=" * 60)
print(f"{'排名':<4} {'企业名称':<25} {'销售额(亿元)':<15} {'行业中类':<15}")
print("-" * 60)
for i, row in df.iterrows():
    print(f"{i+1:<4} {row['企业名称'][:22]:<25} {row['销售额_亿元']:<15.1f} {row['行业中类']:<15}")

print("=" * 60)
print(f"前三名销售额合计: {total_sales:.1f}亿元")
print(f"第一名占比: {df['销售额_亿元'][0]/total_sales*100:.1f}%")
print(f"第二名占比: {df['销售额_亿元'][1]/total_sales*100:.1f}%")
print(f"第三名占比: {df['销售额_亿元'][2]/total_sales*100:.1f}%")

# 显示图表
plt.show()