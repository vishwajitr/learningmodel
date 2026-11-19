"""Turns raw 5m candles into what an expiry trader cares about:

* trend shifts   — zig-zag swing pivots (a reversal of >= SWING_POINTS) and the legs between them
* points capture — from each 15-min slot, how far the index ran up / down in the next HORIZON_MIN and
                   which side hit MOVE_POINTS first (that is the label the model learns)
* premium        — ATM CE / PE / straddle path through the day (real if recorded, else Black-Scholes+VIX)
                   and how much premium a buyer could have captured from each slot
* opening range  — first-break direction and whether it followed through
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

import numpy as np
import pandas as pd

from .calendar import day_type, next_expiry
from .config import Settings
from .premium import bs_price, model_day_premiums, years_to_expiry
from .store import IST

FEATURES = ["mins", "ret_open", "dist_vwap", "or_pos", "ema_gap", "slope_15", "slope_30", "rv_30",
            "range_so_far", "gap", "dte", "vix"]


@dataclass
class DayAnalysis:
    day: date
    kind: str  # D0 / D1 / OTHER
    expiry: date
    bars: pd.DataFrame
    pivots: list[dict]
    legs: list[dict]
    slots: pd.DataFrame
    premiums: pd.DataFrame
    orb: dict
    stats: dict = field(default_factory=dict)


# ---------------- indicators ----------------
def add_indicators(day: pd.DataFrame, or_min: int) -> pd.DataFrame:
    d = day.copy()
    tp = (d["high"] + d["low"] + d["close"]) / 3
    d["vwap"] = tp.expanding().mean()  # index has no volume -> time-weighted average price
    d["ema9"] = d["close"].ewm(span=9, adjust=False).mean()
    d["ema21"] = d["close"].ewm(span=21, adjust=False).mean()
    or_end = d.index[0] + pd.Timedelta(minutes=or_min)
    orb = d[d.index < or_end]
    d["or_high"], d["or_low"] = orb["high"].max(), orb["low"].min()
    return d


def zigzag(d: pd.DataFrame, threshold: float) -> list[dict]:
    """Swing pivots: a new pivot is confirmed once price reverses >= threshold points from the extreme."""
    if d.empty:
        return []
    pivots: list[dict] = []
    trend = 0
    hi_ts, hi = d.index[0], d["high"].iloc[0]
    lo_ts, lo = d.index[0], d["low"].iloc[0]
    for ts, r in d.iterrows():
        if r.high > hi:
            hi, hi_ts = r.high, ts
        if r.low < lo:
            lo, lo_ts = r.low, ts
        if trend >= 0 and hi - r.low >= threshold and hi_ts <= ts:
            if trend == 1 or not pivots:
                pivots.append({"ts": hi_ts, "price": float(hi), "kind": "HIGH", "confirmed": ts})
            trend, lo, lo_ts = -1, r.low, ts
        elif trend <= 0 and r.high - lo >= threshold and lo_ts <= ts:
            if trend == -1 or not pivots:
                pivots.append({"ts": lo_ts, "price": float(lo), "kind": "LOW", "confirmed": ts})
            trend, hi, hi_ts = 1, r.high, ts
    # the unfinished last leg ends at the day's last extreme in the current direction
    if trend == 1:
        pivots.append({"ts": hi_ts, "price": float(hi), "kind": "HIGH", "confirmed": None})
    elif trend == -1:
        pivots.append({"ts": lo_ts, "price": float(lo), "kind": "LOW", "confirmed": None})
    # prepend the open so the first leg is measured from 09:15
    first = {"ts": d.index[0], "price": float(d["open"].iloc[0]), "kind": "OPEN", "confirmed": d.index[0]}
    pivots = [first] + [p for p in pivots if p["ts"] != d.index[0] or p["kind"] != "OPEN"]
    return pivots


def legs_from_pivots(pivots: list[dict]) -> list[dict]:
    legs = []
    for a, b in zip(pivots, pivots[1:]):
        pts = b["price"] - a["price"]
        if pts == 0:
            continue
        legs.append({"start": a["ts"], "end": b["ts"], "points": round(pts, 2),
                     "minutes": int((b["ts"] - a["ts"]).total_seconds() // 60),
                     "dir": "UP" if pts > 0 else "DOWN"})
    return legs


def slot_times(start: str = "09:30", end: str = "14:45", step: int = 15) -> list[time]:
    t = datetime.combine(date.today(), time.fromisoformat(start))
    stop = datetime.combine(date.today(), time.fromisoformat(end))
    out = []
    while t <= stop:
        out.append(t.time())
        t += timedelta(minutes=step)
    return out


def first_touch(fut: pd.DataFrame, entry: float, pts: float) -> tuple[str, float, float]:
    """Which side moves `pts` first. Returns (label, max_up, max_down) over the window."""
    if fut.empty:
        return "CHOP", 0.0, 0.0
    up_hit = fut.index[fut["high"] - entry >= pts]
    dn_hit = fut.index[entry - fut["low"] >= pts]
    max_up = float(fut["high"].max() - entry)
    max_dn = float(entry - fut["low"].min())
    if len(up_hit) and (not len(dn_hit) or up_hit[0] < dn_hit[0]):
        return "UP", max_up, max_dn
    if len(dn_hit) and (not len(up_hit) or dn_hit[0] < up_hit[0]):
        return "DOWN", max_up, max_dn
    return "CHOP", max_up, max_dn


def features_at(d: pd.DataFrame, i: int, prev_close: float | None, dte: int, vix: float) -> dict:
    """Features using bars up to and including i (no look-ahead)."""
    r = d.iloc[i]
    open_ = d["open"].iloc[0]
    rng = r.or_high - r.or_low
    diffs = d["close"].iloc[max(0, i - 6): i + 1].diff().dropna()
    return {
        "mins": (d.index[i] - d.index[0]).total_seconds() / 60,
        "ret_open": r.close - open_,
        "dist_vwap": r.close - r.vwap,
        "or_pos": (r.close - r.or_low) / rng if rng > 0 else 0.5,
        "ema_gap": r.ema9 - r.ema21,
        "slope_15": r.close - d["close"].iloc[max(0, i - 3)],
        "slope_30": r.close - d["close"].iloc[max(0, i - 6)],
        "rv_30": float(diffs.std()) if len(diffs) > 1 else 0.0,
        "range_so_far": d["high"].iloc[: i + 1].max() - d["low"].iloc[: i + 1].min(),
        "gap": open_ - prev_close if prev_close else 0.0,
        "dte": min(dte, 3),
        "vix": vix,
    }


def _premium_path(day: pd.DataFrame, strike: int, opt: str, expiry_close: datetime, iv: float, r: float,
                  real: pd.DataFrame | None) -> pd.Series:
    if real is not None and not real.empty:
        sub = real[(real["strike"] == strike) & (real["opt"] == opt)]
        if len(sub) >= max(3, len(day) // 2):
            return sub.set_index("ts")["ltp"].reindex(day.index, method="ffill")
    t = years_to_expiry(day.index, expiry_close)
    return pd.Series(bs_price(day["close"].to_numpy(), strike, t, iv, r, opt), index=day.index)


def analyze_day(day: pd.DataFrame, d: date, s: Settings, known_expiries: list[date] | None,
                prev_close: float | None, vix: float, real_prem: pd.DataFrame | None) -> DayAnalysis:
    kind = day_type(d, s.expiry_weekday, s.holidays, known_expiries)
    e = next_expiry(d, s.expiry_weekday, s.holidays, known_expiries)
    dte = int(np.busday_count(d, e)) if e > d else 0
    exp_close = pd.Timestamp(datetime.combine(e, time(15, 30)), tz=IST).to_pydatetime()
    bars = add_indicators(day, s.opening_range_min)
    # adaptive: never call a reversal smaller than ~4 typical 5m bars (keeps noise out on wild expiry days)
    swing = max(s.swing_points, 4 * float((bars["high"] - bars["low"]).median()))
    pivots = zigzag(bars, swing)
    legs = legs_from_pivots(pivots)
    iv_mult = s.iv_mult_d0 if kind == "D0" else s.iv_mult_d1 if kind == "D1" else 1.0
    iv = vix / 100 * iv_mult

    # premium curves for the day (real where available)
    prem = model_day_premiums(bars, exp_close, s.strike_step, vix, iv_mult, s.risk_free)
    if real_prem is not None and not real_prem.empty:
        k0 = int(prem["strike"].iloc[0])
        for opt, col in (("CE", "ce"), ("PE", "pe")):
            sub = real_prem[(real_prem["strike"] == k0) & (real_prem["opt"] == opt)]
            if len(sub) >= len(bars) // 2:
                prem[col] = sub.set_index("ts")["ltp"].reindex(bars.index, method="ffill").bfill()
                prem["source"] = "real"

    # slot table: points & premium a buyer could capture
    rows = []
    horizon = pd.Timedelta(minutes=s.horizon_min)
    exit_cut = pd.Timestamp(datetime.combine(d, s.exit_time), tz=IST)
    for st in slot_times():
        ts = pd.Timestamp(datetime.combine(d, st), tz=IST)
        if ts not in bars.index:
            continue
        i = bars.index.get_loc(ts)
        entry = float(bars["close"].iloc[i])
        fut = bars[(bars.index > ts) & (bars.index <= min(ts + horizon, exit_cut))]
        label, up, dn = first_touch(fut, entry, s.move_points)
        to_close = bars[(bars.index > ts) & (bars.index <= exit_cut)]
        k = int(round(entry / s.strike_step) * s.strike_step)
        win = bars[(bars.index >= ts) & (bars.index <= min(ts + horizon, exit_cut))]
        ce = _premium_path(win, k, "CE", exp_close, iv, s.risk_free, real_prem)
        pe = _premium_path(win, k, "PE", exp_close, iv, s.risk_free, real_prem)
        row = {"ts": ts, "slot": st.strftime("%H:%M"), "day": d, "kind": kind, "spot": entry, "label": label,
               "max_up": round(up, 1), "max_down": round(dn, 1),
               "close_move": round(float(to_close["close"].iloc[-1] - entry), 1) if len(to_close) else 0.0,
               "ce_entry": round(float(ce.iloc[0]), 2), "ce_best": round(float(ce.max()), 2),
               "ce_end": round(float(ce.iloc[-1]), 2),
               "pe_entry": round(float(pe.iloc[0]), 2), "pe_best": round(float(pe.max()), 2),
               "pe_end": round(float(pe.iloc[-1]), 2)}
        row.update(features_at(bars, i, prev_close, dte, vix))
        rows.append(row)
    slots = pd.DataFrame(rows)

    # opening range breakout
    after = bars[bars.index >= bars.index[0] + pd.Timedelta(minutes=s.opening_range_min)]
    orh, orl = float(bars["or_high"].iloc[0]), float(bars["or_low"].iloc[0])
    orb = {"or_high": orh, "or_low": orl, "or_width": round(orh - orl, 1), "break": None, "time": None,
           "follow_through": None}
    brk = after[(after["close"] > orh) | (after["close"] < orl)]
    if len(brk):
        b_ts = brk.index[0]
        up = brk["close"].iloc[0] > orh
        lab, _, _ = first_touch(bars[bars.index > b_ts], float(brk["close"].iloc[0]), s.move_points)
        orb.update({"break": "UP" if up else "DOWN", "time": b_ts.strftime("%H:%M"),
                    "follow_through": lab == ("UP" if up else "DOWN")})

    stats = {
        "open": float(bars["open"].iloc[0]), "close": float(bars["close"].iloc[-1]),
        "high": float(bars["high"].max()), "low": float(bars["low"].min()),
        "range": round(float(bars["high"].max() - bars["low"].min()), 1),
        "net": round(float(bars["close"].iloc[-1] - bars["open"].iloc[0]), 1),
        "gap": round(float(bars["open"].iloc[0] - prev_close), 1) if prev_close else 0.0,
        "trend_shifts": max(0, len([p for p in pivots if p["kind"] != "OPEN"]) - 1),
        "biggest_leg": max((abs(x["points"]) for x in legs), default=0.0),
        "straddle_open": float(prem["atm_straddle"].iloc[0]),
        "straddle_close": float(prem["atm_straddle"].iloc[-1]),
        "premium_source": str(prem["source"].iloc[0]),
        "dte": dte, "vix": vix, "swing_used": round(swing, 1),
    }
    return DayAnalysis(d, kind, e, bars, pivots, legs, slots, prem, orb, stats)


def analyze_window(candles: pd.DataFrame, s: Settings, vix_by_day: dict[str, float] | None = None,
                   real_prem: pd.DataFrame | None = None, known_expiries: list[date] | None = None
                   ) -> list[DayAnalysis]:
    vix_by_day = vix_by_day or {}
    out, prev_close, last_vix = [], None, s.default_vix
    for d in sorted(set(candles.index.date)):
        day = candles[candles.index.date == d]
        if len(day) < 20:  # skip half/broken sessions
            prev_close = float(day["close"].iloc[-1]) if len(day) else prev_close
            continue
        # use the PREVIOUS day's VIX close (known before the open)
        prior = [v for k, v in sorted(vix_by_day.items()) if k < str(d)]
        vix = float(prior[-1]) if prior else last_vix
        last_vix = vix
        rp = None
        if real_prem is not None and not real_prem.empty:
            rp = real_prem[real_prem["ts"].dt.date == d]
        out.append(analyze_day(day, d, s, known_expiries, prev_close, vix, rp))
        prev_close = float(day["close"].iloc[-1])
    return out


def slots_frame(days: list[DayAnalysis]) -> pd.DataFrame:
    frames = [x.slots for x in days if not x.slots.empty]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
