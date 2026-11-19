"""The trading day as one state machine. The live loop feeds it market data on every poll; it decides
entries and exits and keeps everything the dashboard shows (checklist, open trade, TP/SL, alerts, today
vs the last 4 weeks). The demo feeds it a past day bar by bar, so the demo screen is the real screen.

Status: WAITING (watching, no trade) → IN_TRADE → WAITING … → DONE (day limit or exit time reached)
"""
from __future__ import annotations

import json
import os
from collections import deque
from datetime import datetime, time

import numpy as np
import pandas as pd

from .analysis import add_indicators, zigzag
from .calendar import openalgo_expiry_str, option_symbol
from .config import Settings
from .live import entry_checks, side_ready, targets
from .premium import bs_price, years_to_expiry
from .store import IST


def _f(x, nd=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


class DayEngine:
    def __init__(self, s: Settings, playbook: dict, model_bundle, kind: str, expiry, prev_close: float | None,
                 vix: float, dte: int, data_source: str = "openalgo"):
        self.s, self.pb, self.model, self.kind, self.expiry = s, playbook, model_bundle, kind, expiry
        self.prev_close, self.vix, self.dte, self.source = prev_close, vix, dte, data_source
        self.tgt, self.stop = targets(playbook, kind, s)
        self.pos: dict | None = None
        self.trades: list[dict] = []
        self.alerts: deque = deque(maxlen=300)
        self.bars = pd.DataFrame()
        self.checks: dict = {}
        self.spot = None
        self.opt = {"strike": None, "ce": None, "pe": None, "held": None, "estimated": True}
        self.opt_hist: list[dict] = []
        self.straddle_open = None
        self.fixed_strike: int | None = None  # ATM at the first tick: its CE/PE give a clean premium chart
        self.checks_count = 0
        self.last_bar_ts = None
        self.status = "WAITING"
        exp_close = datetime.combine(expiry, time(15, 30))
        self.exp_close = pd.Timestamp(exp_close, tz=IST)
        iv_mult = s.iv_mult_d0 if kind == "D0" else s.iv_mult_d1
        self.iv = vix / 100 * iv_mult

    # ---------- helpers ----------
    def alert(self, now: pd.Timestamp, level: str, msg: str) -> None:
        self.alerts.appendleft({"time": now.strftime("%H:%M:%S"), "level": level, "msg": msg})

    def model_premium(self, spot: float, strike: int, opt: str, now: pd.Timestamp) -> float:
        t = years_to_expiry(pd.DatetimeIndex([now]), self.exp_close)
        return float(bs_price(spot, strike, t, self.iv, self.s.risk_free, opt)[0])

    def atm(self, spot: float) -> int:
        return int(round(spot / self.s.strike_step) * self.s.strike_step)

    def symbol(self, strike: int, opt: str) -> str:
        return option_symbol(self.s.underlying, self.expiry, strike, opt)

    # ---------- inputs ----------
    def on_bars(self, bars: pd.DataFrame, now: pd.Timestamp) -> dict | None:
        """Completed 5m bars of today. Returns an entry/exit order to send, or None."""
        if bars.empty:
            return None
        new_bar = bars.index[-1] != self.last_bar_ts
        self.bars = add_indicators(bars, self.s.opening_range_min)
        self.last_bar_ts = bars.index[-1]
        if not new_bar or len(self.bars) < 2:
            return None
        i = len(self.bars) - 1
        self.checks = entry_checks(self.bars, i, self.kind, self.s, self.pb, self.model, self.prev_close,
                                   self.dte, self.vix)
        r = self.bars.iloc[i]
        if self.status == "DONE":
            return None
        if self.pos is None:
            if len(self.trades) >= self.s.max_trades_per_day:
                self.status = "DONE"
                self.alert(now, "info", f"Day limit reached ({self.s.max_trades_per_day} trades) - only watching now")
                return None
            if self.bars.index[i].time() > self.s.entry_end:
                self.status = "DONE"
                self.alert(now, "info", f"Entry window closed at {self.s.entry_end:%H:%M} - no new trades today")
                return None
            for side, action in (("CE", "BUY_CE"), ("PE", "BUY_PE")):
                if side_ready(self.checks[side]):
                    p = self.checks["probs"].get("UP" if side == "CE" else "DOWN")
                    reason = (f"{side}: close {r.close:,.0f} {'>' if side == 'CE' else '<'} OR "
                              f"{(r.or_high if side == 'CE' else r.or_low):,.0f}, "
                              f"{'above' if side == 'CE' else 'below'} VWAP, EMA9/21 {'up' if side == 'CE' else 'down'}"
                              + (f", model {p:.2f}" if p is not None else ""))
                    self.alert(now, "signal", f"SIGNAL {action} - all conditions met. {reason}")
                    return {"action": action, "lots": self.s.lots, "reason": reason, "spot": float(r.close)}
            ce_ok = sum(x["ok"] is True for x in self.checks["CE"])
            pe_ok = sum(x["ok"] is True for x in self.checks["PE"])
            n = sum(x["ok"] is not None for x in self.checks["CE"])
            self.alert(now, "check", f"{self.bars.index[i]:%H:%M} bar: CE {ce_ok}/{n}, PE {pe_ok}/{n} conditions - no trade")
        else:
            sign = 1 if self.pos["side"] == "CE" else -1
            if sign * (r.ema9 - r.ema21) < 0 and i - self.pos["bar_i"] >= 3:
                return self._exit_order(now, "Trend shift: EMA9/21 crossed against the trade")
        return None

    def on_tick(self, now: pd.Timestamp, spot: float, ce: float | None = None, pe: float | None = None,
                held: float | None = None, fce: float | None = None, fpe: float | None = None,
                count: bool = True) -> dict | None:
        """Every poll: latest spot and option LTPs (ATM CE/PE, fixed-strike CE/PE, held option) when the
        broker gave them; missing ones are estimated. Returns an exit order or None."""
        self.checks_count += int(count)
        self.spot = float(spot)
        k = self.atm(spot)
        if self.fixed_strike is None:
            self.fixed_strike = k
        est = ce is None or pe is None
        ce = ce if ce is not None else self.model_premium(spot, k, "CE", now)
        pe = pe if pe is not None else self.model_premium(spot, k, "PE", now)
        fce = fce if fce is not None else self.model_premium(spot, self.fixed_strike, "CE", now)
        fpe = fpe if fpe is not None else self.model_premium(spot, self.fixed_strike, "PE", now)
        if self.straddle_open is None:
            self.straddle_open = ce + pe
        if self.pos:
            held = held if held is not None else self.model_premium(spot, self.pos["strike"], self.pos["side"], now)
            self.pos["prem_now"] = held
        self.opt = {"strike": k, "ce": _f(ce), "pe": _f(pe), "held": _f(held), "estimated": est,
                    "fixed_strike": self.fixed_strike, "fce": _f(fce), "fpe": _f(fpe),
                    "held_symbol": self.pos["symbol"] if self.pos else None}
        self.opt_hist.append({"t": now.strftime("%H:%M:%S"), "spot": _f(spot, 1), "ce": _f(ce), "pe": _f(pe),
                              "strike": k, "fce": _f(fce, 1), "fpe": _f(fpe, 1), "held": _f(held, 1)})
        if self.pos:
            sign = 1 if self.pos["side"] == "CE" else -1
            if sign * (spot - self.pos["tp_spot"]) >= 0:
                return self._exit_order(now, f"Target hit: spot {spot:,.0f} reached TP {self.pos['tp_spot']:,.0f}")
            if sign * (spot - self.pos["sl_spot"]) <= 0:
                return self._exit_order(now, f"Stop-loss hit: spot {spot:,.0f} reached SL {self.pos['sl_spot']:,.0f}")
            if now.time() >= self.s.exit_time:
                return self._exit_order(now, f"Time exit at {self.s.exit_time:%H:%M}")
        return None

    def _exit_order(self, now, reason):
        self.alert(now, "exit", f"EXIT signal - {reason}")
        return {"action": "EXIT", "reason": reason}

    # ---------- order results ----------
    def confirm(self, order: dict, resp: dict, now: pd.Timestamp) -> None:
        ok = resp.get("status") in ("success", "dry_run")
        tag = "practice, not sent" if resp.get("status") == "dry_run" else resp.get("status")
        if order["action"] in ("BUY_CE", "BUY_PE"):
            if not ok:
                self.alert(now, "error", f"Order rejected: {resp.get('reason', resp)}")
                return
            side = order["action"][-2:]
            spot = order["spot"]
            k = self.atm(spot)
            sym = resp.get("symbol") or self.symbol(k, side)
            prem = self.opt["ce"] if side == "CE" else self.opt["pe"]
            sign = 1 if side == "CE" else -1
            self.pos = {"action": order["action"], "side": side, "symbol": sym, "strike": k,
                        "qty": resp.get("quantity") or self.s.lots * self.s.lot_size,
                        "entry_time": now.isoformat(), "entry_spot": spot, "entry_prem": prem, "prem_now": prem,
                        "tp_spot": spot + sign * self.tgt, "sl_spot": spot - sign * self.stop,
                        "bar_i": len(self.bars) - 1, "reason": order["reason"], "orderid": resp.get("orderid")}
            self.status = "IN_TRADE"
            self.alert(now, "order", f"BUY {sym} x{self.pos['qty']} @ ~₹{prem:.1f} ({tag}). "
                                     f"TP {self.pos['tp_spot']:,.0f} / SL {self.pos['sl_spot']:,.0f}")
        else:
            if self.pos is None:
                return
            p = self.pos
            sign = 1 if p["side"] == "CE" else -1
            pts = sign * (self.spot - p["entry_spot"])
            prem_pnl = (p["prem_now"] or 0) - (p["entry_prem"] or 0)
            dur = (now - pd.Timestamp(p["entry_time"])).total_seconds()
            self.trades.append({"symbol": p["symbol"], "side": p["side"], "entry": pd.Timestamp(p["entry_time"]).strftime("%H:%M"),
                                "exit": now.strftime("%H:%M"), "minutes": round(dur / 60),
                                "entry_spot": _f(p["entry_spot"], 1), "exit_spot": _f(self.spot, 1),
                                "points": _f(pts, 1), "entry_prem": _f(p["entry_prem"]),
                                "exit_prem": _f(p["prem_now"]), "rupees": _f(prem_pnl * p["qty"], 0),
                                "reason": order["reason"]})
            self.alert(now, "order", f"SELL {p['symbol']} x{p['qty']} @ ~₹{p['prem_now']:.1f} ({tag}). "
                                     f"{pts:+.0f} pts, ₹{prem_pnl * p['qty']:+,.0f}")
            self.pos = None
            self.status = "DONE" if len(self.trades) >= self.s.max_trades_per_day else "WAITING"

    # ---------- output ----------
    def state(self, now: pd.Timestamp, next_check: pd.Timestamp, mode: str) -> dict:
        b = self.bars
        today: dict = {}
        if not b.empty:
            rng = float(b["high"].max() - b["low"].min())
            swing = max(self.s.swing_points, 4 * float((b["high"] - b["low"]).median()))
            shifts = len([p for p in zigzag(b, swing) if p["kind"] != "OPEN" and p["confirmed"] is not None])
            k = self.pb.get(self.kind, {})
            typ_left = None
            curve = k.get("straddle_left_at") or {}
            for t_, v in sorted(curve.items()):
                if t_ <= now.strftime("%H:%M"):
                    typ_left = v
            str_now = (self.opt["ce"] or 0) + (self.opt["pe"] or 0)
            today = {"range": round(rng, 1), "typical_range": k.get("avg_range"),
                     "trend_shifts": shifts, "typical_shifts": k.get("avg_trend_shifts"),
                     "move_from_open": round(float(b["close"].iloc[-1] - b["open"].iloc[0]), 1),
                     "straddle_left": round(str_now / self.straddle_open, 3) if self.straddle_open else None,
                     "typical_straddle_left": typ_left,
                     "or_high": _f(b["or_high"].iloc[0], 1), "or_low": _f(b["or_low"].iloc[0], 1),
                     "vwap": _f(b["vwap"].iloc[-1], 1), "ema9": _f(b["ema9"].iloc[-1], 1),
                     "ema21": _f(b["ema21"].iloc[-1], 1), "open": _f(b["open"].iloc[0], 1)}
        pos = None
        if self.pos:
            p = self.pos
            sign = 1 if p["side"] == "CE" else -1
            pos = {k_: p[k_] for k_ in ("action", "side", "symbol", "strike", "qty", "entry_time", "entry_spot",
                                         "entry_prem", "prem_now", "tp_spot", "sl_spot", "reason", "orderid")}
            pos["running_sec"] = int((now - pd.Timestamp(p["entry_time"])).total_seconds())
            pos["points"] = _f(sign * (self.spot - p["entry_spot"]), 1)
            pos["rupees"] = _f(((p["prem_now"] or 0) - (p["entry_prem"] or 0)) * p["qty"], 0)
            pos["to_tp"] = _f(sign * (p["tp_spot"] - self.spot), 1)
            pos["to_sl"] = _f(sign * (self.spot - p["sl_spot"]), 1)
        return {
            "now": now.isoformat(), "next_check": next_check.isoformat(), "poll_seconds": self.s.poll_seconds,
            "checks_count": self.checks_count, "status": self.status, "mode": mode,
            "data_source": self.source, "day": now.date().isoformat(), "kind": self.kind,
            "expiry": openalgo_expiry_str(self.expiry), "prev_close": self.prev_close,
            "spot": _f(self.spot, 1), "options": self.opt,
            "bars": [{"t": ts.strftime("%H:%M"), "o": _f(r.open, 1), "h": _f(r.high, 1), "l": _f(r.low, 1),
                      "c": _f(r.close, 1), "vwap": _f(r.vwap, 1), "ema9": _f(r.ema9, 1), "ema21": _f(r.ema21, 1)}
                     for ts, r in b.iterrows()],
            "opt_hist": self.opt_hist[-800:],
            "checks": self.checks, "position": pos, "trades": [dict(x) for x in self.trades],
            "rules": {"target_pts": self.tgt, "stop_pts": self.stop, "max_trades": self.s.max_trades_per_day,
                      "entry_window": f"{self.s.entry_start:%H:%M}–{self.s.entry_end:%H:%M}",
                      "exit_time": f"{self.s.exit_time:%H:%M}", "lots": self.s.lots, "lot_size": self.s.lot_size},
            "today": today, "alerts": list(self.alerts)[:150],
            "learning": {"built_at": self.pb.get("built_at"), "window": self.pb.get("window"),
                         "model": {k_: self.pb.get("model", {}).get(k_) for k_ in
                                   ("test_accuracy", "baseline_accuracy", "trusted")},
                         "best_slots": self.pb.get(self.kind, {}).get("best_slots"),
                         "days_learnt": self.pb.get(self.kind, {}).get("n_days")},
        }


def write_state(path, state: dict) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, default=str)
    os.replace(tmp, path)


def simulate_day(s: Settings, day_bars: pd.DataFrame, kind: str, expiry, playbook: dict, model_bundle,
                 prev_close: float | None, vix: float, dte: int, send, ticks_per_bar: int = 2) -> list[dict]:
    """Play a past day through the engine as if live: `ticks_per_bar` polls per 5m bar.
    Returns the list of states (used by the demo screen)."""
    eng = DayEngine(s, playbook, model_bundle, kind, expiry, prev_close, vix, dte, data_source="replay")
    states = []
    idx = day_bars.index
    for j in range(len(idx)):
        bar_end = idx[j] + pd.Timedelta(minutes=s.interval_min)
        for k in range(ticks_per_bar):
            frac = (k + 1) / ticks_per_bar
            now = idx[j] + pd.Timedelta(minutes=s.interval_min * frac)
            r = day_bars.iloc[j]
            spot = r.open + (r.close - r.open) * frac  # walk inside the bar
            done = day_bars[day_bars.index + pd.Timedelta(minutes=s.interval_min) <= now]
            if now == bar_end and len(done):
                order = eng.on_bars(done, now)
                if order:
                    eng.on_tick(now, spot, count=False)
                    eng.confirm(order, send(order, now), now)
            order = eng.on_tick(now, spot)
            if order:
                eng.confirm(order, send(order, now), now)
            nxt = now + pd.Timedelta(seconds=s.poll_seconds)
            states.append(eng.state(now, nxt, "PRACTICE" if s.dry_run else "LIVE"))
    return states
