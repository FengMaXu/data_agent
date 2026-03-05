import matplotlib.pyplot as plt
import pandas as pd
import os

# 数据准备
data = {
    '企业名称': ['深圳市怡亚通供应链股份有限公司', '深圳盛盟供应链管理有限公司', '深圳宏桥供应链管理有限公司'],
    '销售额_亿元': [764.0310, 675.2391, 343.4627],
    '行业中类': ['贸易经纪与代理', '机械设备批发', '矿产品批发']
}

df = pd.DataFrame(data)

# 创建图形
plt.figure(figsize=(10, 6))

# 创建柱形图
bars = plt.bar(df['企业名称'], df['销售额_亿元'], color=['#1f77b4', '#ff7f0e', '#2ca02c'])

# 设置标题和标签
plt.title('2025年12月批发业累计销售额前三名企业', fontsize=14, fontweight='bold')
plt.xlabel('企业名称', fontsize=12)
plt.ylabel('累计销售额（亿元）', fontsize=12)

# 在柱子上方添加数值标签
for bar in bars:
    height = bar.get_height()
    plt.text(bar.get_x() + bar.get_width()/2., height + 5,
            f'{height:.1f}亿元',
            ha='center', va='bottom', fontsize=10)

# 旋转x轴标签
plt.xticks(rotation=15, ha='right')

# 添加网格线
plt.grid(axis='y', alpha=0.3)

# 保存图表
output_dir = os.environ.get('OUTPUT_DIR', '.')
output_path = os.path.join(output_dir, 'wholesale_top3_companies_2025.png')
plt.tight_layout()
plt.savefig(output_path, dpi=300)
print(f"图表已保存到: {output_path}")

# 显示数据
print("\n2025年12月批发业累计销售额前三名企业:")
print("=" * 70)
for i, row in df.iterrows():
    print(f"第{i+1}名: {row['企业名称']}")
    print(f"  销售额: {row['销售额_亿元']:.1f}亿元")
    print(f"  行业中类: {row['行业中类']}")
    print("-" * 70)

total = df['销售额_亿元'].sum()
print(f"\n前三名总销售额: {total:.1f}亿元")
print(f"占批发业总额比例: 24.5%")