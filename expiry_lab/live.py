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


def entry_checks(bars: pd.DataFrame, i: int, kind: str, s: Settings, playbook: dict, model_bundle,
                 prev_close: float | None, dte: int, vix: float) -> dict:
    """The entry checklist for both sides, on bar i. Each item: name, ok (True/False/None = info only), value.
    A side triggers when every item that is not None is True. The dashboard shows this same list."""
    r, ts = bars.iloc[i], bars.index[i]
    in_window = s.entry_start <= ts.time() <= s.entry_end
    st = _slot_stats(playbook, kind, ts)
    p_chop = float(st.get("p_chop", 0)) if st else 0.0
    probs = model_probs(model_bundle, features_at(bars, i, prev_close, dte, vix))
    trusted = bool(playbook.get("model", {}).get("trusted"))
    win = f"{s.entry_start:%H:%M}–{s.entry_end:%H:%M}"
    out = {"time": ts.strftime("%H:%M"), "probs": {k: round(float(v), 3) for k, v in probs.items()},
           "model_trusted": trusted}
    for side, up in (("CE", True), ("PE", False)):
        p = float(probs.get("UP" if up else "DOWN", np.nan)) if probs else float("nan")
        model_item = {"name": f"Model P({'UP' if up else 'DOWN'}) ≥ {s.min_prob:.2f}",
                      "ok": (bool(p >= s.min_prob) if trusted else None),
                      "value": ("-" if np.isnan(p) else f"{p:.2f}") + ("" if trusted else " · info")}
        out[side] = [
            {"name": f"Entry time window {win}", "ok": in_window, "value": ts.strftime("%H:%M")},
            {"name": f"Close {'above' if up else 'below'} opening-range {'high' if up else 'low'}",
             "ok": bool(r.close > r.or_high) if up else bool(r.close < r.or_low),
             "value": f"{r.close:,.0f} vs {(r.or_high if up else r.or_low):,.0f}"},
            {"name": f"{'Above' if up else 'Below'} average price (VWAP)",
             "ok": bool(r.close > r.vwap) if up else bool(r.close < r.vwap), "value": f"{r.close - r.vwap:+.0f} pts"},
            {"name": f"EMA9 {'above' if up else 'below'} EMA21",
             "ok": bool(r.ema9 > r.ema21) if up else bool(r.ema9 < r.ema21), "value": f"{r.ema9 - r.ema21:+.1f}"},
            {"name": "This time slot not mostly chop (last 4 weeks)", "ok": p_chop <= 0.6,
             "value": f"chop {p_chop:.0%}" + (f" @ {st['slot']}" if st else "")},
            model_item,
        ]
    return out


def side_ready(items: list[dict]) -> bool:
    return all(x["ok"] is not False for x in items)


def evaluate_entry(bars: pd.DataFrame, i: int, kind: str, s: Settings, playbook: dict, model_bundle,
                   prev_close: float | None, dte: int, vix: float) -> tuple[str | None, float, str]:
    chk = entry_checks(bars, i, kind, s, playbook, model_bundle, prev_close, dte, vix)
    r = bars.iloc[i]
    for side, action, up in (("CE", "BUY_CE", True), ("PE", "BUY_PE", False)):
        if side_ready(chk[side]):
            p = chk["probs"].get("UP" if up else "DOWN", 0.0)
            why = (f"{kind} {chk['time']} close {r.close:,.0f} {'>' if up else '<'} OR {'high' if up else 'low'} "
                   f"{(r.or_high if up else r.or_low):,.0f}, {'above' if up else 'below'} avg price, EMA9/21 "
                   f"{'up' if up else 'down'}" + (f", model P={p:.2f}" if chk["probs"] else ""))
            return action, float(p), why
    return None, 0.0, ""


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


def _quotes(s: Settings, strike: int, expiry: date, held: str | None,
            fixed: int | None = None) -> tuple[float | None, ...]:
    """Live LTPs from OpenAlgo: spot, ATM CE, ATM PE, held option, fixed-strike CE, PE. Failures come back None."""
    from .calendar import option_symbol
    from .openalgo_client import OpenAlgo

    try:
        oa = OpenAlgo(s.openalgo_host, s.openalgo_api_key)
    except Exception:  # noqa: BLE001
        return None, None, None, None, None, None

    def q(sym, ex):
        try:
            v = oa.quote(sym, ex).get("ltp")
            return float(v) if v is not None else None
        except Exception:  # noqa: BLE001
            return None

    spot = q(s.underlying, s.index_exchange)
    ce = q(option_symbol(s.underlying, expiry, strike, "CE"), s.options_exchange)
    pe = q(option_symbol(s.underlying, expiry, strike, "PE"), s.options_exchange)
    fce = q(option_symbol(s.underlying, expiry, fixed, "CE"), s.options_exchange) if fixed else None
    fpe = q(option_symbol(s.underlying, expiry, fixed, "PE"), s.options_exchange) if fixed else None
    return spot, ce, pe, (q(held, s.options_exchange) if held else None), fce, fpe


def run_live(s: Settings, store: Store, playbook: dict, model_bundle, direct: bool = False) -> None:
    from .engine import DayEngine, write_state
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
    state_path = s.data_dir / "live_state.json"
    mode = "PRACTICE" if s.dry_run else "LIVE"

    eng: DayEngine | None = None
    stop_at = (datetime.combine(today, s.exit_time) + timedelta(minutes=10)).time()
    log.warning("LIVE %s  DRY_RUN=%s  mode=%s  dashboard: http://%s:%s/", kind, s.dry_run,
                "direct" if direct else "hook", s.hook_host, s.hook_port)
    while True:
        now = pd.Timestamp.now(tz=IST)
        nxt = now + pd.Timedelta(seconds=s.poll_seconds)
        if now.time() >= stop_at:
            if eng and eng.pos:
                order = {"action": "EXIT", "reason": "end of day safety exit"}
                eng.confirm(order, send(order), now)
            if eng:
                eng.status = "DONE"
                write_state(state_path, eng.state(now, now, mode))
            break
        try:
            bars, prev_close = _today_bars(s)
        except Exception as err:  # noqa: BLE001
            log.error("data error: %s", err)
            if eng:
                eng.alert(now, "error", f"Data error: {err}")
                write_state(state_path, eng.state(now, nxt, mode))
            _time.sleep(s.poll_seconds)
            continue
        if eng is None:
            eng = DayEngine(s, playbook, model_bundle, kind, e, prev_close, vix, dte)
            eng.alert(now, "info", f"Started: {kind}, expiry {e}, target {eng.tgt:.0f} / stop {eng.stop:.0f} pts, {mode}")
        done = bars[bars.index + pd.Timedelta(minutes=s.interval_min) <= now]
        if done.empty:
            eng.status = "PRE_OPEN"
            write_state(state_path, eng.state(now, nxt, mode))
            _time.sleep(s.poll_seconds)
            continue
        if eng.status == "PRE_OPEN":
            eng.status = "WAITING"
        last = float(bars["close"].iloc[-1])
        spot, ce, pe, held, fce, fpe = _quotes(s, eng.atm(last), e, eng.pos["symbol"] if eng.pos else None,
                                               eng.fixed_strike)
        spot = spot or last
        eng.source = "openalgo" if ce is not None else "estimated premiums"
        order = eng.on_bars(done, now)
        if order:
            eng.on_tick(now, spot, ce, pe, held, fce, fpe, count=False)
            res = send(order)
            store.log_signal(now.to_pydatetime(), kind, order["action"], 0.0, spot, order.get("reason", ""))
            eng.confirm(order, res, now)
        order = eng.on_tick(now, spot, ce, pe, held, fce, fpe)
        if order:
            res = send(order)
            store.log_signal(now.to_pydatetime(), kind, order["action"], 0.0, spot, order.get("reason", ""))
            eng.confirm(order, res, now)
        # learn from current data: today's bars and live premiums go into the 4-week store
        store.upsert_candles(bars[["open", "high", "low", "close"]], "live")
        if ce is not None and pe is not None:
            k = eng.atm(spot)
            store.upsert_premiums([(now.floor("min").isoformat(), e.isoformat(), k, "CE", ce, "live"),
                                   (now.floor("min").isoformat(), e.isoformat(), k, "PE", pe, "live")])
        write_state(state_path, eng.state(now, nxt, mode))
        _time.sleep(s.poll_seconds)


__all__ = ["evaluate_entry", "evaluate_exit", "replay_day", "run_live", "FEATURES"]
