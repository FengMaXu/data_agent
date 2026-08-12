from __future__ import annotations

from copy import deepcopy
from typing import Any


# Project-owned business palette. Recipes and runtime themes may choose roles,
# but must not replace these data-encoding colors.
COMMERCIAL_PALETTE = [
    "#4F6980",
    "#F47942",
    "#638B66",
    "#FBB04E",
    "#B66353",
    "#849DB1",
    "#B9AA97",
    "#7E756D",
]

SEMANTIC_COLORS = {
    "primary": "#4F6980",
    "accent": "#F47942",
    "positive": "#638B66",
    "warning": "#FBB04E",
    "negative": "#B66353",
    "secondary": "#849DB1",
    "muted": "#B9AA97",
    "neutral": "#7E756D",
}

DEFAULT_DESIGN_TOKENS: dict[str, Any] = {
    "palette": COMMERCIAL_PALETTE,
    "semantic": SEMANTIC_COLORS,
    "radius": {"panel": 8, "control": 6},
    "spacing": {"grid": 14, "panel": 16},
    "typography": {
        "family": '"Segoe UI", Arial, sans-serif',
        "title_weight": 650,
        "value_weight": 700,
    },
}


def dashboard_design_tokens() -> dict[str, Any]:
    return deepcopy(DEFAULT_DESIGN_TOKENS)
