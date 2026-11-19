"""Trigger logic, shared by the live loop and the replay (backtest) of past D0/D1 days.

Entry trigger (on a completed 5m bar, between ENTRY_START and ENTRY_END):
  BUY_CE  close > opening-range high  AND close > avg price (VWAP proxy)  AND EMA9 > EMA21
  BUY_PE  close < opening-range low   AND close < avg price               AND EMA9 < EMA21
  … and, if the model passed its walk-forward check, P(UP)/P(DOWN) >= MIN_PROB
  … and the playbook does not mark this slot as mostly chop (p_chop > 0.6).
Exit trigger: target / stop in index points (from the playbook), EMA9/21 cross against the trade
(a trend shift), or EXIT_TIME.
"""
from __future__ import annotations

import logging
import time as _time
from datetime import date, datetime, timedelta

import httpx
import numpy as np
import pandas as pd

from .analysis import FEATURES, add_indicators, features_at
from .calendar import day_type, next_expiry
from .config import Settings
from .premium import bs_price, years_to_expiry
from .store import IST, Store

log = logging.getLogger(__name__)


def _slot_stats(playbook: dict, kind: str, ts: pd.Timestamp) -> dict | None:
    slots = playbook.get(kind, {}).get("slots") or []
    best = None
    for r in slots:  # latest slot at or before ts
        if r["slot"] <= ts.strftime("%H:%M"):
            best = r
    return best


def model_probs(model_bundle, feats: dict) -> dict[str, float]:
    if not model_bundle:
        return {}
    m = model_bundle["model"]
    x = pd.DataFrame([[feats[f] for f in model_bundle["features"]]], columns=model_bundle["features"])
    return dict(zip(m.classes_, m.predict_proba(x)[0]))


def evaluate_entry(bars: pd.DataFrame, i: int, kind: str, s: Settings, playbook: dict, model_bundle,
                   prev_close: float | None, dte: int, vix: float) -> tuple[str | None, float, str]:
    r, ts = bars.iloc[i], bars.index[i]
    if not (s.entry_start <= ts.time() <= s.entry_end):
        return None, 0.0, ""
    bull = r.close > r.or_high and r.close > r.vwap and r.ema9 > r.ema21
    bear = r.close < r.or_low and r.close < r.vwap and r.ema9 < r.ema21
    if not (bull or bear):
        return None, 0.0, ""
    side = "UP" if bull else "DOWN"
    st = _slot_stats(playbook, kind, ts)
    if st and st.get("p_chop", 0) > 0.6:
        return None, 0.0, f"slot {st['slot']} mostly chop"
    feats = features_at(bars, i, prev_close, dte, vix)
    probs = model_probs(model_bundle, feats)
    p = float(probs.get(side, np.nan)) if probs else float("nan")
    trusted = bool(playbook.get("model", {}).get("trusted"))
    if trusted and not (p >= s.min_prob):
        return None, p, f"model P({side})={p:.2f} < {s.min_prob}"
    why = (f"{kind} {ts:%H:%M} close {r.close:.0f} {'>' if bull else '<'} OR {'high' if bull else 'low'} "
           f"{(r.or_high if bull else r.or_low):.0f}, {'above' if bull else 'below'} avg price, EMA9/21 "
           f"{'up' if bull else 'down'}" + (f", model P={p:.2f}" if probs else ""))
    return ("BUY_CE" if bull else "BUY_PE"), (p if probs else 0.0), why


def targets(playbook: dict, kind: str, s: Settings) -> tuple[float, float]:
    k = playbook.get(kind, {})
    tgt = float(k.get("suggested_target_points") or 2 * s.move_points)
    stop = float(k.get("suggested_stop_points") or s.move_points)
    return max(tgt, s.move_points), max(stop, 30.0)


def evaluate_exit(bars: pd.DataFrame, i: int, pos: dict, tgt: float, stop: float, s: Settings) -> str | None:
    r, ts = bars.iloc[i], bars.index[i]
    sign = 1 if pos["action"] == "BUY_CE" else -1
    fav = sign * (r.high if sign > 0 else r.low) - sign * pos["entry_spot"]
    adv = sign * pos["entry_spot"] - sign * (r.low if sign > 0 else r.high)
    if adv >= stop:
        return f"stop {stop:.0f} pts"
    if fav >= tgt:
        return f"target {tgt:.0f} pts"
    if sign * (r.ema9 - r.ema21) < 0 and i - pos["i"] >= 3:
        return "trend shift (EMA9/21 crossed against)"
    if ts.time() >= s.exit_time:
        return "time exit"
    return None


# ---------------- replay / backtest over the stored window ----------------
def replay_day(day_bars: pd.DataFrame, d: date, s: Settings, playbook: dict, model_bundle,
               prev_close: float | None, vix: float, known: list[date] | None = None) -> list[dict]:
    kind = day_type(d, s.expiry_weekday, s.holidays, known)
    e = next_expiry(d, s.expiry_weekday, s.holidays, known)
    dte = int(np.busday_count(d, e)) if e > d else 0
    exp_close = pd.Timestamp(datetime.combine(e, datetime.min.time()).replace(hour=15, minute=30), tz=IST)
    iv = vix / 100 * (s.iv_mult_d0 if kind == "D0" else s.iv_mult_d1)
    bars = add_indicators(day_bars, s.opening_range_min)
    tgt, stop = targets(playbook, kind, s)
    trades, pos = [], None
    for i in range(len(bars)):
        ts = bars.index[i]
        if pos is None:
            if len(trades) >= s.max_trades_per_day:
                continue
            action, p, why = evaluate_entry(bars, i, kind, s, playbook, model_bundle, prev_close, dte, vix)
            if action:
                spot = float(bars["close"].iloc[i])
                k = round(spot / s.strike_step) * s.strike_step
                opt = "CE" if action == "BUY_CE" else "PE"
                prem = float(bs_price(spot, k, years_to_expiry(pd.DatetimeIndex([ts]), exp_close), iv,
                                      s.risk_free, opt)[0])
                pos = {"action": action, "entry_spot": spot, "i": i, "ts": ts, "strike": k, "opt": opt,
                       "entry_prem": prem, "why": why, "p": p}
        else:
            why_exit = evaluate_exit(bars, i, pos, tgt, stop, s)
            if why_exit or i == len(bars) - 1:
                r = bars.iloc[i]
                sign = 1 if pos["action"] == "BUY_CE" else -1
                if why_exit and why_exit.startswith("stop"):
                    exit_spot = pos["entry_spot"] - sign * stop
                elif why_exit and why_exit.startswith("target"):
                    exit_spot = pos["entry_spot"] + sign * tgt
                else:
                    exit_spot = float(r.close)
                prem = float(bs_price(exit_spot, pos["strike"], years_to_expiry(pd.DatetimeIndex([ts]), exp_close),
                                      iv, s.risk_free, pos["opt"])[0])
                trades.append({"day": str(d), "kind": kind, "action": pos["action"], "entry": pos["ts"].strftime("%H:%M"),
                               "exit": ts.strftime("%H:%M"), "entry_spot": round(pos["entry_spot"], 1),
                               "points": round(sign * (exit_spot - pos["entry_spot"]), 1),
                               "strike": int(pos["strike"]), "entry_prem": round(pos["entry_prem"], 1),
                               "exit_prem": round(prem, 1), "prem_pnl": round(prem - pos["entry_prem"], 1),
                               "rupees": round((prem - pos["entry_prem"]) * s.lot_size * s.lots, 0),
                               "exit_reason": why_exit or "end of data", "signal": pos["why"]})
                pos = None
    return trades


# ---------------- live loop ----------------
def _post_hook(s: Settings, payload: dict) -> dict:
    r = httpx.post(s.hook_url, json={**payload, "token": s.hook_token}, timeout=20)
    try:
        return r.json()
    except ValueError:
        return {"status": "error", "reason": r.text[:200]}


def _today_bars(s: Settings) -> tuple[pd.DataFrame, float | None]:
    from .openalgo_client import OpenAlgo
    from .sources import openalgo_candles, yahoo_candles

    try:
        df = openalgo_candles(OpenAlgo(s.openalgo_host, s.openalgo_api_key), s, 6)
    except Exception as e:  # noqa: BLE001
        log.warning("OpenAlgo candles failed (%s) - using Yahoo (delayed)", e)
        df = yahoo_candles(s.yahoo_symbol, 6, s.interval_min)
    today = date.today()
    prev = df[df.index.date < today]
    return df[df.index.date == today], (float(prev["close"].iloc[-1]) if len(prev) else None)


def run_live(s: Settings, store: Store, playbook: dict, model_bundle, direct: bool = False) -> None:
    from .executor import Executor

    today = date.today()
    known: list[date] = []
    kind = day_type(today, s.expiry_weekday, s.holidays, known)
    allowed = [x.strip() for x in s.trade_days.split(",")]
    if kind not in allowed:
        log.warning("Today is %s, not in TRADE_DAYS=%s - nothing to do.", kind, s.trade_days)
        return
    if not direct and not s.hook_url:
        raise SystemExit("Set HOOK_URL (e.g. http://127.0.0.1:8787/hook) or run with --direct")
    ex = Executor(s, store) if direct else None
    send = (lambda p: ex.handle(p["action"], lots=p.get("lots"), reason=p.get("reason", ""), spot=p.get("spot"))) \
        if direct else (lambda p: _post_hook(s, p))
    vix_hist = store.vix()
    vix = float(sorted(vix_hist.items())[-1][1]) if vix_hist else s.default_vix
    e = next_expiry(today, s.expiry_weekday, s.holidays, known)
    dte = int(np.busday_count(today, e)) if e > today else 0
    tgt, stop = targets(playbook, kind, s)
    pos, entries, seen = None, 0, None
    log.warning("LIVE %s  target %.0f / stop %.0f pts  DRY_RUN=%s  mode=%s", kind, tgt, stop, s.dry_run,
                "direct" if direct else "hook")
    while True:
        now = datetime.now()
        if now.time() >= (datetime.combine(today, s.exit_time) + timedelta(minutes=5)).time():
            if pos:
                log.warning("EXIT %s", send({"action": "EXIT", "reason": "end of day safety"}))
            break
        try:
            bars, prev_close = _today_bars(s)
        except Exception as err:  # noqa: BLE001
            log.error("data error: %s", err)
            _time.sleep(s.poll_seconds)
            continue
        # only completed bars
        bars = bars[bars.index + pd.Timedelta(minutes=s.interval_min) <= pd.Timestamp.now(tz=IST)]
        if len(bars) < 3 or bars.index[-1] == seen:
            _time.sleep(s.poll_seconds)
            continue
        seen = bars.index[-1]
        b = add_indicators(bars, s.opening_range_min)
        i = len(b) - 1
        if pos is None and entries < s.max_trades_per_day:
            action, p, why = evaluate_entry(b, i, kind, s, playbook, model_bundle, prev_close, dte, vix)
            if action:
                spot = float(b["close"].iloc[i])
                store.log_signal(b.index[i].to_pydatetime(), kind, action, p, spot, why)
                res = send({"action": action, "lots": s.lots, "reason": why, "spot": spot})
                log.warning("SIGNAL %s -> %s", why, res)
                if res.get("status") in ("success", "dry_run"):
                    pos, entries = {"action": action, "entry_spot": spot, "i": i}, entries + 1
        elif pos is not None:
            why_exit = evaluate_exit(b, i, pos, tgt, stop, s)
            if why_exit:
                store.log_signal(b.index[i].to_pydatetime(), kind, "EXIT", 0.0, float(b["close"].iloc[i]), why_exit)
                res = send({"action": "EXIT", "reason": why_exit})
                log.warning("EXIT %s -> %s", why_exit, res)
                if res.get("status") in ("success", "dry_run", "rejected"):
                    pos = None
        _time.sleep(s.poll_seconds)


__all__ = ["evaluate_entry", "evaluate_exit", "replay_day", "run_live", "FEATURES"]
