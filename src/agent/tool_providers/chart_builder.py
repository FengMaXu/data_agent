"""
Chart Builder — CSV 数据到 ECharts option 的映射引擎

将声明式图表描述 + CSV 文件自动转换为完整的 ECharts option 对象，
Agent 无需手动编写 echarts_option，只需指定图表类型、数据文件和列名。
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Any

logger = logging.getLogger("data_agent.chart_builder")

# ───────────────────────────────────────────
# 公共接口
# ───────────────────────────────────────────


def build_echarts_option(chart_desc: dict[str, Any], csv_content: str | None) -> dict[str, Any]:
    """
    将声明式图表描述转换为完整的 ECharts option。

    Args:
        chart_desc: 图表声明式描述，含 chart_type, x_column, y_columns 等
        csv_content: CSV 文件的文本内容（chart_type="custom" 时可为 None）

    Returns:
        完整的 ECharts option dict
    """
    chart_type = chart_desc.get("chart_type", "custom")

    # custom 类型：直接返回用户提供的 echarts_option
    if chart_type == "custom":
        option = chart_desc.get("echarts_option")
        if not option:
            raise ValueError("chart_type='custom' 时必须提供 echarts_option 字段")
        return option

    # 声明式类型：解析 CSV → 构建 option
    if csv_content is None:
        raise ValueError(f"chart_type='{chart_type}' 时必须提供 data_file")

    rows = _parse_csv(csv_content)
    if not rows:
        raise ValueError("CSV 文件为空或解析失败")

    builder = _CHART_BUILDERS.get(chart_type)
    if not builder:
        raise ValueError(
            f"不支持的 chart_type: '{chart_type}'，"
            f"可选值: {', '.join(_CHART_BUILDERS.keys())}, custom"
        )

    option = builder(chart_desc, rows)

    # 应用用户覆盖
    overrides = chart_desc.get("echarts_option", {})
    if overrides:
        option = _deep_merge(option, overrides)

    return option


def build_drilldown_data(
    drilldown_desc: dict[str, Any], csv_content: str
) -> dict[str, list[dict[str, Any]]]:
    """
    构建下钻数据映射。

    Args:
        drilldown_desc: 下钻配置
        csv_content: 明细 CSV 文件内容

    Returns:
        {父级维度值: [子级数据项, ...]}
    """
    rows = _parse_csv(csv_content)
    if not rows:
        return {}

    group_col = drilldown_desc.get("group_column", "")
    detail_type = drilldown_desc.get("detail_chart_type", "bar")
    x_col = drilldown_desc.get("detail_x_column", "")
    y_cols = drilldown_desc.get("detail_y_columns", [])
    name_col = drilldown_desc.get("detail_name_column", "")
    value_col = drilldown_desc.get("detail_value_column", "")

    if not group_col:
        raise ValueError("drilldown 配置必须指定 group_column")

    # 按 group_column 分组
    groups: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        key = row.get(group_col, "")
        if key:
            groups.setdefault(key, []).append(row)

    # 为每组构建 ECharts option
    result: dict[str, Any] = {}
    for group_key, group_rows in groups.items():
        if detail_type == "pie":
            desc = {
                "chart_type": "pie",
                "name_column": name_col or x_col,
                "value_column": value_col or (y_cols[0] if y_cols else ""),
            }
        else:
            desc = {
                "chart_type": detail_type,
                "x_column": x_col,
                "y_columns": y_cols,
            }
        builder = _CHART_BUILDERS.get(detail_type, _build_bar)
        result[group_key] = builder(desc, group_rows)

    return result


# ───────────────────────────────────────────
# CSV 解析
# ───────────────────────────────────────────


def _parse_csv(content: str) -> list[dict[str, str]]:
    """解析 CSV 文本为字典列表，兼容 UTF-8 BOM。"""
    # 去除 BOM
    if content.startswith("\ufeff"):
        content = content[1:]

    reader = csv.DictReader(io.StringIO(content))
    rows = []
    for row in reader:
        # 清理列名中的空白
        cleaned = {k.strip(): v.strip() if v else "" for k, v in row.items() if k}
        rows.append(cleaned)
    return rows


def _to_number(value: str) -> int | float | str:
    """尝试将字符串转为数值，失败则返回原字符串。"""
    if not value:
        return 0
    try:
        # 处理千分位逗号
        cleaned = value.replace(",", "")
        if "." in cleaned:
            return float(cleaned)
        return int(cleaned)
    except (ValueError, TypeError):
        return value


def _extract_column(rows: list[dict[str, str]], col: str) -> list[str]:
    """提取某列的值列表。"""
    return [row.get(col, "") for row in rows]


def _extract_numeric_column(rows: list[dict[str, str]], col: str) -> list[int | float]:
    """提取某列并转为数值。"""
    result = []
    for row in rows:
        val = _to_number(row.get(col, "0"))
        result.append(val if isinstance(val, (int, float)) else 0)
    return result


# ───────────────────────────────────────────
# 图表构建器
# ───────────────────────────────────────────


def _build_line(desc: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    """构建折线图 option。"""
    x_col = desc.get("x_column", "")
    y_cols = desc.get("y_columns", [])

    if not x_col or not y_cols:
        raise ValueError("line 图表需要 x_column 和 y_columns")

    x_data = _extract_column(rows, x_col)
    series = []
    for y_col in y_cols:
        series.append({
            "name": y_col,
            "type": "line",
            "data": _extract_numeric_column(rows, y_col),
            "smooth": True,
        })

    return {
        "tooltip": {"trigger": "axis"},
        "legend": {"data": y_cols},
        "xAxis": {"type": "category", "data": x_data},
        "yAxis": {"type": "value"},
        "series": series,
    }


def _build_bar(desc: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    """构建柱状图 option。"""
    x_col = desc.get("x_column", "")
    y_cols = desc.get("y_columns", [])

    if not x_col or not y_cols:
        raise ValueError("bar 图表需要 x_column 和 y_columns")

    x_data = _extract_column(rows, x_col)
    series = []
    for y_col in y_cols:
        series.append({
            "name": y_col,
            "type": "bar",
            "data": _extract_numeric_column(rows, y_col),
        })

    return {
        "tooltip": {"trigger": "axis"},
        "legend": {"data": y_cols},
        "xAxis": {"type": "category", "data": x_data},
        "yAxis": {"type": "value"},
        "series": series,
    }


def _build_pie(desc: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    """构建饼图 option。"""
    name_col = desc.get("name_column", "")
    value_col = desc.get("value_column", "")

    if not name_col or not value_col:
        raise ValueError("pie 图表需要 name_column 和 value_column")

    data = []
    for row in rows:
        name = row.get(name_col, "")
        val = _to_number(row.get(value_col, "0"))
        if name:
            data.append({"name": name, "value": val if isinstance(val, (int, float)) else 0})

    return {
        "tooltip": {"trigger": "item", "formatter": "{b}: {c} ({d}%)"},
        "legend": {"orient": "vertical", "left": "left"},
        "series": [{
            "type": "pie",
            "radius": ["40%", "70%"],
            "data": data,
            "emphasis": {
                "itemStyle": {
                    "shadowBlur": 10,
                    "shadowOffsetX": 0,
                    "shadowColor": "rgba(0, 0, 0, 0.5)",
                }
            },
        }],
    }


def _build_scatter(desc: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    """构建散点图 option。"""
    x_col = desc.get("x_column", "")
    y_col = desc.get("y_column", "") or (desc.get("y_columns", [""])[0])

    if not x_col or not y_col:
        raise ValueError("scatter 图表需要 x_column 和 y_column")

    data = []
    for row in rows:
        x_val = _to_number(row.get(x_col, "0"))
        y_val = _to_number(row.get(y_col, "0"))
        data.append([
            x_val if isinstance(x_val, (int, float)) else 0,
            y_val if isinstance(y_val, (int, float)) else 0,
        ])

    return {
        "tooltip": {"trigger": "item"},
        "xAxis": {"type": "value", "name": x_col},
        "yAxis": {"type": "value", "name": y_col},
        "series": [{
            "type": "scatter",
            "data": data,
            "symbolSize": 8,
        }],
    }


def _build_radar(desc: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    """构建雷达图 option。"""
    indicator_col = desc.get("indicator_column", "")
    value_cols = desc.get("value_columns", [])

    if not indicator_col or not value_cols:
        raise ValueError("radar 图表需要 indicator_column 和 value_columns")

    indicators = _extract_column(rows, indicator_col)

    # 计算每个指标的最大值
    all_values: list[list[int | float]] = []
    for v_col in value_cols:
        all_values.append(_extract_numeric_column(rows, v_col))

    max_vals = [0.0] * len(indicators)
    for vals in all_values:
        for i, v in enumerate(vals):
            if i < len(max_vals) and isinstance(v, (int, float)):
                max_vals[i] = max(max_vals[i], v)

    # 留 20% 余量
    indicator_config = [
        {"name": name, "max": max_val * 1.2 if max_val > 0 else 100}
        for name, max_val in zip(indicators, max_vals)
    ]

    series_data = []
    for v_col in value_cols:
        series_data.append({
            "name": v_col,
            "value": _extract_numeric_column(rows, v_col),
        })

    return {
        "tooltip": {"trigger": "item"},
        "legend": {"data": value_cols},
        "radar": {"indicator": indicator_config},
        "series": [{
            "type": "radar",
            "data": series_data,
        }],
    }


# ───────────────────────────────────────────
# 注册表
# ───────────────────────────────────────────

_CHART_BUILDERS = {
    "line": _build_line,
    "bar": _build_bar,
    "pie": _build_pie,
    "scatter": _build_scatter,
    "radar": _build_radar,
}


# ───────────────────────────────────────────
# 工具函数
# ───────────────────────────────────────────


def _deep_merge(base: dict, override: dict) -> dict:
    """深度合并两个字典，override 优先。"""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result
