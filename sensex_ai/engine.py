"""Core decision step (shared by live runner and replay) + outcome scoring."""
from __future__ import annotations

import logging
from datetime import date, datetime, time

import pandas as pd

from .claude_analyst import ClaudeAnalyst
from .config import Settings
from .data import MarketData
from .expiry import ExpiryCalendar
from .features import build_features, daily_bars
from .model import Predictor
from .schemas import Signal, TradeAlert

log = logging.getLogger(__name__)


class Engine:
    def __init__(self, s: Settings, cal: ExpiryCalendar, md: MarketData | None = None, use_claude: bool | None = None):
        self.s, self.cal, self.md = s, cal, md
        self.pred = Predictor(s)
        use_claude = s.claude_enabled if use_claude is None else use_claude
        self.claude = ClaudeAnalyst(s) if use_claude and s.anthropic_api_key.get_secret_value() else None

    def evaluate(self, df: pd.DataFrame, d: date, t: time, live_options: bool = False) -> TradeAlert | None:
        bucket = self.cal.bucket(d)
        if bucket is None:
            return None
        day_df = df[df.index.date == d]
        daily = daily_bars(df[df.index.date < d])
        dte = 0 if bucket == "D0" else 1
        f = build_features(day_df, daily, d, t, dte)
        if f is None:
            log.info("Not enough candles yet for %s %s", d, t)
            return None

        ts = pd.Timestamp(datetime.combine(d, t), tz="Asia/Kolkata")
        seen = day_df[day_df.index < ts]
        spot = float(seen.close.iloc[-1])
        target, stop = self.s.target_stop(dte)
        ml = self.pred.predict(bucket, f)
        expiry = self.cal.next_expiry(d)

        # Option quotes (live only) so Claude sees real premiums
        ltps, contracts = {}, {}
        if live_options and self.md:
            for ot in ("CE", "PE"):
                sym, lot, ltp = self.md.option_contract(expiry, "ATM", ot)
                contracts[ot] = (sym, lot, ltp)
                ltps[f"ATM_{ot}"] = ltp

        verdict = None
        if self.claude and ml.signal != Signal.SKIP:   # only spend Claude calls when ML sees a setup
            verdict = self.claude.review(bucket=bucket, spot=spot, features=f, ml=ml,
                                         model_stats=self.pred.meta(bucket), recent=seen,
                                         target=target, stop=stop, option_ltps=ltps)

        final = ml.signal
        if verdict and self.s.require_claude_agreement and verdict.action != ml.signal:
            final = Signal.SKIP

        sym = ltp = None
        lot = self.s.lot_size
        if final != Signal.SKIP and live_options and self.md:
            ot = "CE" if final == Signal.BUY_CE else "PE"
            offset = verdict.strike_offset if verdict else "ATM"
            sym, lot_live, ltp = (self.md.option_contract(expiry, offset, ot) if offset != "ATM" else contracts[ot])
            lot = lot_live or lot

        return TradeAlert(ts=ts.to_pydatetime(), trade_date=d, bucket=bucket, expiry=expiry, spot=spot, ml=ml,
                          claude=verdict, final_signal=final, option_symbol=sym, option_ltp=ltp,
                          qty=lot * self.s.lots, target_pts=target, stop_pts=stop)


def score_outcome(day_df: pd.DataFrame, alert_ts: pd.Timestamp, signal: str, spot: float,
                  target: float, stop: float, exit_t: time) -> tuple[str, float]:
    """Returns (TARGET | STOP | TIME_EXIT, index points captured)."""
    end = pd.Timestamp(datetime.combine(alert_ts.date(), exit_t), tz="Asia/Kolkata")
    fut = day_df[(day_df.index >= alert_ts) & (day_df.index < end)]
    sgn = 1 if signal == "BUY_CE" else -1
    for _, b in fut.iterrows():
        fav = (b.high - spot) if sgn == 1 else (spot - b.low)
        adv = (spot - b.low) if sgn == 1 else (b.high - spot)
        if adv >= stop:                     # conservative: stop checked first within a bar
            return "STOP", -stop
        if fav >= target:
            return "TARGET", target
    last = fut.close.iloc[-1] if len(fut) else spot
    return "TIME_EXIT", round(sgn * (last - spot), 2)
