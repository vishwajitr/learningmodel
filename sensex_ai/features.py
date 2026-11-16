"""Feature engineering + labels. Features only use candles up to the decision time (no look-ahead)."""
from __future__ import annotations

from datetime import date, datetime, time

import numpy as np
import pandas as pd

from .config import Settings
from .expiry import ExpiryCalendar
from .schemas import FeatureRow, Signal

SESSION_OPEN = time(9, 15)


def _rsi(close: pd.Series, n: int = 9) -> float:
    d = close.diff().dropna()
    if len(d) < 2:
        return 50.0
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean().iloc[-1]
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean().iloc[-1]
    if dn == 0:
        return 100.0
    return float(100 - 100 / (1 + up / dn))


def daily_bars(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby(df.index.date)
    return pd.DataFrame({"open": g.open.first(), "high": g.high.max(), "low": g.low.min(), "close": g.close.last()})


def build_features(day_df: pd.DataFrame, daily: pd.DataFrame, trade_date: date, decision: time, dte: int) -> FeatureRow | None:
    """day_df: candles for trade_date. daily: daily bars of previous sessions (index = date)."""
    ts = pd.Timestamp(datetime.combine(trade_date, decision), tz="Asia/Kolkata")
    seen = day_df[day_df.index < ts]           # bar labelled 09:40 closes at 09:45 → strictly before
    prev = daily[daily.index < trade_date].tail(6)
    if len(seen) < 3 or len(prev) < 2:
        return None

    o = seen.open.iloc[0]
    c = seen.close.iloc[-1]
    hi, lo = seen.high.max(), seen.low.min()
    pc = prev.close.iloc[-1]
    ph, pl, po = prev.high.iloc[-1], prev.low.iloc[-1], prev.open.iloc[-1]

    tr = pd.concat([prev.high - prev.low, (prev.high - prev.close.shift()).abs(),
                    (prev.low - prev.close.shift()).abs()], axis=1).max(axis=1)
    atr5 = tr.tail(5).mean()

    ema = seen.close.ewm(span=20, adjust=False).mean()
    slope = (ema.iloc[-1] - ema.iloc[-4]) / c * 100 if len(ema) >= 4 else 0.0
    twap = ((seen.high + seen.low + seen.close) / 3).mean()

    orb = seen[seen.index < pd.Timestamp(datetime.combine(trade_date, time(9, 30)), tz="Asia/Kolkata")]
    orb_break = 0
    if len(orb):
        orb_break = 1 if c > orb.high.max() else (-1 if c < orb.low.min() else 0)

    rets = np.log(seen.close).diff().dropna()
    minutes = (ts - pd.Timestamp(datetime.combine(trade_date, SESSION_OPEN), tz="Asia/Kolkata")).total_seconds() / 60

    return FeatureRow(
        dte=min(dte, 3),
        minutes_since_open=minutes,
        gap_pct=(o / pc - 1) * 100,
        prev_ret_pct=(pc / po - 1) * 100,
        prev_range_pct=(ph - pl) / pc * 100,
        atr5_pct=atr5 / pc * 100,
        ret_since_open_pct=(c / o - 1) * 100,
        ret_last_3_pct=(c / seen.close.iloc[-4] - 1) * 100 if len(seen) >= 4 else 0.0,
        day_range_pct=(hi - lo) / o * 100,
        pos_in_range=(c - lo) / (hi - lo) if hi > lo else 0.5,
        dist_twap_pct=(c / twap - 1) * 100,
        dist_ema20_pct=(c / ema.iloc[-1] - 1) * 100,
        ema20_slope_pct=slope,
        rsi9=_rsi(seen.close),
        orb_break=orb_break,
        realized_vol_pct=float(rets.std() * np.sqrt(len(rets)) * 100) if len(rets) > 1 else 0.0,
    )


def label(day_df: pd.DataFrame, trade_date: date, decision: time, exit_t: time, target: float, stop: float) -> Signal | None:
    """Option-buyer label. Entry at the close of the last seen bar.
    BUY_CE if +target is reached before -stop; BUY_PE if -target before +stop; otherwise SKIP.
    If a single bar touches both levels, it's treated as SKIP (ambiguous)."""
    ts = pd.Timestamp(datetime.combine(trade_date, decision), tz="Asia/Kolkata")
    te = pd.Timestamp(datetime.combine(trade_date, exit_t), tz="Asia/Kolkata")
    seen = day_df[day_df.index < ts]
    fut = day_df[(day_df.index >= ts) & (day_df.index < te)]
    if seen.empty or fut.empty:
        return None
    entry = seen.close.iloc[-1]

    def first_hit(level_up: float, level_dn: float) -> str | None:
        for _, b in fut.iterrows():
            up, dn = b.high >= level_up, b.low <= level_dn
            if up and dn:
                return "both"
            if up:
                return "up"
            if dn:
                return "down"
        return None

    long_res = first_hit(entry + target, entry - stop)
    short_res = first_hit(entry + stop, entry - target)
    if long_res == "up":
        return Signal.BUY_CE
    if short_res == "down":
        return Signal.BUY_PE
    return Signal.SKIP


def build_dataset(df: pd.DataFrame, cal: ExpiryCalendar, s: Settings) -> pd.DataFrame:
    """One row per (trading day, decision time) for ALL days; dte column lets the model weight D+0/D+1."""
    daily = daily_bars(df)
    rows = []
    for d, day_df in df.groupby(df.index.date):
        dte = cal.dte(d)
        tgt, stp = s.target_stop(0 if dte == 0 else 1)
        for t in s.decision_times:
            f = build_features(day_df, daily, d, t, dte)
            if f is None:
                continue
            y = label(day_df, d, t, s.exit_time, tgt, stp)
            if y is None:
                continue
            rows.append({"date": d, "time": t.strftime("%H:%M"), **f.model_dump(), "y": y.value})
    return pd.DataFrame(rows)
