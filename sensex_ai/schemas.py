"""Pydantic models shared across the pipeline."""
from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Signal(str, Enum):
    BUY_CE = "BUY_CE"
    BUY_PE = "BUY_PE"
    SKIP = "SKIP"


Bucket = Literal["D0", "D1"]


class FeatureRow(BaseModel):
    """Snapshot of the session at a decision time. Field order = model column order."""
    dte: int
    minutes_since_open: float
    gap_pct: float
    prev_ret_pct: float
    prev_range_pct: float
    atr5_pct: float
    ret_since_open_pct: float
    ret_last_3_pct: float
    day_range_pct: float
    pos_in_range: float          # 0 = at day low, 1 = at day high
    dist_twap_pct: float
    dist_ema20_pct: float
    ema20_slope_pct: float
    rsi9: float
    orb_break: int               # +1 above 15-min ORB high, -1 below low, 0 inside
    realized_vol_pct: float

    @classmethod
    def columns(cls) -> list[str]:
        return list(cls.model_fields.keys())


class MLPrediction(BaseModel):
    bucket: Bucket
    signal: Signal
    p_ce: float
    p_pe: float
    p_skip: float

    @property
    def confidence(self) -> float:
        return {Signal.BUY_CE: self.p_ce, Signal.BUY_PE: self.p_pe, Signal.SKIP: self.p_skip}[self.signal]


class ClaudeVerdict(BaseModel):
    """Structured answer Claude must return (enforced via tool schema + Pydantic validation)."""
    action: Signal = Field(description="BUY_CE, BUY_PE or SKIP. Option BUYING only.")
    confidence: int = Field(ge=0, le=100, description="Your confidence 0-100")
    strike_offset: Literal["ATM", "ITM1", "OTM1", "OTM2"] = Field(
        description="Which strike to buy relative to ATM"
    )
    reasoning: str = Field(max_length=600, description="2-4 short sentences on why")
    risk_notes: str = Field(max_length=300, description="Main thing that would invalidate the trade")


class TradeAlert(BaseModel):
    ts: datetime
    trade_date: date
    bucket: Bucket
    expiry: date
    spot: float
    ml: MLPrediction
    claude: ClaudeVerdict | None = None
    final_signal: Signal
    option_symbol: str | None = None
    option_ltp: float | None = None
    qty: int
    target_pts: float
    stop_pts: float
