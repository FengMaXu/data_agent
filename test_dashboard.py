"""测试 HTML BI 看板 — 声明式数据驱动架构"""

import asyncio
import os

from src.agent.tool_providers.base import (
    GlobalRuntimeServices,
    SessionToolBuildContext,
)
from src.agent.tool_providers.html_dashboard import HTMLDashboardProvider
from src.workspace.workspace_manager import WorkspaceManager
from pathlib import Path


# ── 测试用 CSV 数据 ──

MONTHLY_SALES_CSV = """月份,销售额,成本
1月,120,80
2月,132,85
3月,101,70
4月,134,90
5月,90,60
6月,230,150
7月,210,140
8月,182,120
9月,191,130
10月,234,155
11月,290,180
12月,330,210
"""

INDUSTRY_CSV = """行业,销售额
制造业,1048
服务业,735
零售业,580
科技业,484
其他,300
"""

REGION_CSV = """区域,Q1,Q2,Q3,Q4
华东,320,332,301,334
华北,220,182,191,234
华南,150,232,201,154
西南,98,77,101,99
"""

PROVINCE_CSV = """区域,省份,销售额
华东,上海,120
华东,江苏,100
华东,浙江,80
华东,安徽,20
华北,北京,90
华北,天津,50
华北,河北,42
华北,山西,38
华南,广东,80
华南,广西,40
华南,海南,30
西南,四川,48
西南,重庆,30
西南,云南,20
"""


async def test_build_dashboard():
    """测试声明式看板创建"""
    print("=" * 60)
    print("测试 1: build_dashboard — 声明式创建看板")
    print("=" * 60)

    session_id = "test_session_dashboard"
    workspace = WorkspaceManager(session_id=session_id)
    context = SessionToolBuildContext(
        session_id=session_id,
        workspace=workspace,
        project_root=Path("."),
        global_services=GlobalRuntimeServices(metadata={}),
    )

    provider = HTMLDashboardProvider()
    tools = await provider.build_tools(context)
    build_dashboard = tools[0]

    # 先写 CSV 数据文件
    workspace.write_file("data/monthly_sales.csv", MONTHLY_SALES_CSV.strip())
    workspace.write_file("data/industry.csv", INDUSTRY_CSV.strip())
    workspace.write_file("data/region.csv", REGION_CSV.strip())
    print("[OK] CSV 数据文件已写入")

    # 调用 build_dashboard（声明式参数，极其简短）
    result = await build_dashboard.execute("test-1", {
        "title": "销售分析看板",
        "theme": "dark",
        "filename": "test_declarative",
        "charts": [
            {
                "title": "月度销售额趋势",
                "subtitle": "全年数据",
                "chart_type": "line",
                "data_file": "data/monthly_sales.csv",
                "x_column": "月份",
                "y_columns": ["销售额", "成本"],
                "width": "50%",
            },
            {
                "title": "行业分布",
                "chart_type": "pie",
                "data_file": "data/industry.csv",
                "name_column": "行业",
                "value_column": "销售额",
                "width": "50%",
            },
            {
                "title": "区域季度对比",
                "chart_type": "bar",
                "data_file": "data/region.csv",
                "x_column": "区域",
                "y_columns": ["Q1", "Q2", "Q3", "Q4"],
                "width": "100%",
            },
        ],
    })

    assert not result.is_error, f"build_dashboard 失败: {result.content[0].text}"
    print(f"[OK] 看板已生成: {result.details['filename']}")
    print(f"[OK] 路径: {result.details['relative_path']}")

    # 验证 HTML 内容
    html = workspace.read_file(result.details["relative_path"])
    assert "charts-data" in html, "HTML 中应包含 charts-data 数据块"
    assert "echarts" in html, "HTML 中应包含 ECharts 库"
    assert "月度销售额趋势" in html, "HTML 中应包含图表标题"
    print("[OK] HTML 内容验证通过")

    return workspace, tools, result.details["relative_path"]


async def test_add_chart(workspace, tools, dashboard_path):
    """测试增量追加图表"""
    print("\n" + "=" * 60)
    print("测试 2: add_chart — 增量追加图表")
    print("=" * 60)

    add_chart = tools[1]

    # 写入新的 CSV 数据
    scatter_csv = "广告费用,销售额\n10,100\n20,180\n30,250\n40,310\n50,400\n60,520"
    workspace.write_file("data/scatter.csv", scatter_csv)

    result = await add_chart.execute("test-2", {
        "dashboard_path": dashboard_path,
        "chart": {
            "title": "广告投入 vs 销售额",
            "chart_type": "scatter",
            "data_file": "data/scatter.csv",
            "x_column": "广告费用",
            "y_column": "销售额",
            "width": "50%",
        },
    })

    assert not result.is_error, f"add_chart 失败: {result.content[0].text}"
    assert result.details["chart_count"] == 4, f"预期 4 个图表，实际 {result.details['chart_count']}"
    print(f"[OK] 图表已追加，现共 {result.details['chart_count']} 个图表")

    # 验证 HTML 中包含新图表
    html = workspace.read_file(dashboard_path)
    assert "广告投入 vs 销售额" in html, "HTML 中应包含新增图表标题"
    assert "chart-3" in html, "HTML 中应包含第 4 个图表容器"
    print("[OK] 增量追加验证通过")


async def test_drilldown(workspace, tools):
    """测试下钻配置"""
    print("\n" + "=" * 60)
    print("测试 3: 下钻配置")
    print("=" * 60)

    build_dashboard = tools[0]

    # 写入下钻明细数据
    workspace.write_file("data/province.csv", PROVINCE_CSV.strip())

    result = await build_dashboard.execute("test-3", {
        "title": "下钻测试看板",
        "filename": "test_drilldown",
        "charts": [
            {
                "title": "区域销售",
                "chart_type": "bar",
                "data_file": "data/region.csv",
                "x_column": "区域",
                "y_columns": ["Q1"],
                "width": "100%",
                "drilldown": {
                    "detail_data_file": "data/province.csv",
                    "detail_chart_type": "bar",
                    "detail_x_column": "省份",
                    "detail_y_columns": ["销售额"],
                    "group_column": "区域",
                },
            },
        ],
    })

    assert not result.is_error, f"drilldown 测试失败: {result.content[0].text}"
    print(f"[OK] 看板已生成: {result.details['filename']}")

    html = workspace.read_file(result.details["relative_path"])
    assert "drilldown_data" in html, "HTML 中应包含 drilldown_data"
    assert "华东" in html, "下钻数据应包含华东分组"
    print("[OK] 下钻配置验证通过")


async def test_custom_fallback(workspace, tools):
    """测试 custom 类型 fallback"""
    print("\n" + "=" * 60)
    print("测试 4: custom 类型 fallback")
    print("=" * 60)

    build_dashboard = tools[0]

    result = await build_dashboard.execute("test-4", {
        "title": "自定义图表测试",
        "filename": "test_custom",
        "charts": [
            {
                "title": "自定义仪表盘",
                "chart_type": "custom",
                "echarts_option": {
                    "tooltip": {"formatter": "{a} <br/>{b} : {c}%"},
                    "series": [{
                        "name": "Pressure",
                        "type": "gauge",
                        "detail": {"formatter": "{value}"},
                        "data": [{"value": 50, "name": "SCORE"}],
                    }],
                },
                "width": "50%",
            },
        ],
    })

    assert not result.is_error, f"custom 测试失败: {result.content[0].text}"
    print(f"[OK] 自定义图表看板已生成")

    html = workspace.read_file(result.details["relative_path"])
    assert "gauge" in html, "HTML 中应包含 gauge 图表类型"
    print("[OK] custom fallback 验证通过")


async def main():
    workspace, tools, dashboard_path = await test_build_dashboard()
    await test_add_chart(workspace, tools, dashboard_path)
    await test_drilldown(workspace, tools)
    await test_custom_fallback(workspace, tools)

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED!")
    print("=" * 60)

    session_id = getattr(workspace, "_session_id", "test")
    print(f"\n看板文件位于: workspace/{session_id}/dashboards/")


if __name__ == "__main__":
    asyncio.run(main())
