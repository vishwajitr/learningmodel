"""Where data comes from.

  openalgo  — your broker via OpenAlgo: index 5m candles + real option premiums (best, needs login)
  yahoo     — free: ^BSESN 5m candles (Yahoo keeps ~60 days of 5m) and ^INDIAVIX daily
  synthetic — offline random-walk data for demos/tests

`auto` tries OpenAlgo, then Yahoo.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

import numpy as np
import pandas as pd

from .calendar import day_type, ist_today, next_expiry, option_symbol, parse_expiry_list
from .config import Settings
from .openalgo_client import OpenAlgo, OpenAlgoError
from .store import IST, Store

log = logging.getLogger(__name__)


def _session_only(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df[~df.index.duplicated()].sort_index()
    t = df.index.time
    return df[(t >= time(9, 15)) & (t < time(15, 30))]


# ---------------- Yahoo (free) ----------------
def yahoo_candles(symbol: str, days: int, interval_min: int = 5) -> pd.DataFrame:
    import yfinance as yf

    period = f"{min(days + 7, 59)}d"
    df = yf.Ticker(symbol).history(period=period, interval=f"{interval_min}m", auto_adjust=False)
    if df.empty:
        raise RuntimeError(f"Yahoo returned no data for {symbol}")
    df.index = pd.DatetimeIndex(df.index).tz_convert(IST)
    df.columns = [c.lower() for c in df.columns]
    return _session_only(df[["open", "high", "low", "close"]].astype(float))


def yahoo_vix(symbol: str, days: int) -> pd.Series:
    import yfinance as yf

    df = yf.Ticker(symbol).history(period=f"{days + 14}d", interval="1d")
    return df["Close"].rename("vix")


# ---------------- OpenAlgo ----------------
def openalgo_candles(oa: OpenAlgo, s: Settings, days: int) -> pd.DataFrame:
    end = ist_today()
    df = oa.history(s.underlying, s.index_exchange, f"{s.interval_min}m", end - timedelta(days=days), end)
    return _session_only(df)


def openalgo_expiries(oa: OpenAlgo, s: Settings) -> list[date]:
    try:
        return parse_expiry_list(oa.expiries(s.underlying, s.options_exchange))
    except OpenAlgoError as e:
        log.warning("expiry list unavailable: %s", e)
        return []


def openalgo_day_premiums(oa: OpenAlgo, s: Settings, day: date, expiry: date, strike: int) -> list[tuple]:
    """Real CE/PE candles for one strike on one day. Many brokers drop expired contracts — then this is empty."""
    rows = []
    for opt in ("CE", "PE"):
        sym = option_symbol(s.underlying, expiry, strike, opt)
        try:
            df = oa.history(sym, s.options_exchange, f"{s.interval_min}m", day, day)
        except OpenAlgoError as e:
            log.info("no premium history for %s: %s", sym, e)
            return []
        rows += [(ts.isoformat(), expiry.isoformat(), strike, opt, float(r.close), "openalgo")
                 for ts, r in _session_only(df).iterrows()]
    return rows


# ---------------- synthetic ----------------
def synthetic_candles(days: int = 28, start_price: float = 82000, seed: int = 7, end: date | None = None,
                      interval_min: int = 5, expiry_weekday: int = 3) -> pd.DataFrame:
    """SENSEX-like 5m bars with regime drift, trend shifts and bigger expiry-day moves."""
    rng = np.random.default_rng(seed)
    end = end or date.today()
    d, rows, price = end - timedelta(days=days), [], start_price
    while d <= end:
        if d.weekday() < 5:
            exp_like = d.weekday() == expiry_weekday
            vol = 0.0004 * (1.2 if exp_like else 1.0)
            price *= 1 + rng.normal(0, 0.0035)
            regime, t = rng.normal(0, 0.00005), datetime(d.year, d.month, d.day, 9, 15)
            mom = 0.0
            while t.time() < time(15, 30):
                if rng.random() < 0.04:  # trend shift
                    regime = rng.normal(0, 0.00012)
                if exp_like and t.time() >= time(13, 30):
                    vol_now = vol * 1.3  # afternoon gamma move
                else:
                    vol_now = vol
                mom = 0.5 * mom + rng.normal(regime, vol_now)
                o, c = price, price * (1 + mom)
                h = max(o, c) * (1 + abs(rng.normal(0, vol_now / 3)))
                l_ = min(o, c) * (1 - abs(rng.normal(0, vol_now / 3)))
                rows.append((pd.Timestamp(t, tz=IST), o, h, l_, c))
                price, t = c, t + timedelta(minutes=interval_min)
        d += timedelta(days=1)
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close"]).set_index("ts")
    return df.round(2)


# ---------------- refresh into the store ----------------
def refresh(s: Settings, store: Store, source: str | None = None) -> dict:
    """Pull the last RETENTION_DAYS into the store, then prune anything older. Returns a short summary."""
    source = source or s.data_source
    days = s.retention_days
    summary: dict = {"source": None, "candles": 0, "premium_rows": 0, "expiries": []}
    oa = None

    if source in ("auto", "openalgo"):
        try:
            oa = OpenAlgo(s.openalgo_host, s.openalgo_api_key)
            df = openalgo_candles(oa, s, days)
            if df.empty:
                raise OpenAlgoError("empty history")
            summary.update(source="openalgo", candles=store.upsert_candles(df, "openalgo"))
        except Exception as e:  # noqa: BLE001
            log.warning("OpenAlgo candles failed (%s)", e)
            oa = None
            if source == "openalgo":
                raise
    if summary["source"] is None and source in ("auto", "yahoo"):
        df = yahoo_candles(s.yahoo_symbol, days, s.interval_min)
        summary.update(source="yahoo", candles=store.upsert_candles(df, "yahoo"))
    if source == "synthetic":
        df = synthetic_candles(days, expiry_weekday=s.expiry_weekday)
        summary.update(source="synthetic", candles=store.upsert_candles(df, "synthetic"))

    # VIX for the premium model (free); ignore failures — DEFAULT_VIX is used instead
    if source != "synthetic":
        try:
            store.upsert_vix(yahoo_vix(s.yahoo_vix_symbol, days))
        except Exception as e:  # noqa: BLE001
            log.warning("VIX download failed (%s); using DEFAULT_VIX=%s", e, s.default_vix)

    # Real option premiums for past D0/D1 days, where the broker still serves them
    if oa is not None:
        known = openalgo_expiries(oa, s)
        summary["expiries"] = [str(x) for x in known[:4]]
        candles = store.candles()
        for d in sorted(set(candles.index.date)):
            if day_type(d, s.expiry_weekday, s.holidays, known) not in ("D0", "D1"):
                continue
            day = candles[candles.index.date == d]
            strike = int(round(day["open"].iloc[0] / s.strike_step) * s.strike_step)
            e = next_expiry(d, s.expiry_weekday, s.holidays, known)
            summary["premium_rows"] += store.upsert_premiums(openalgo_day_premiums(oa, s, d, e, strike))

    store.prune()
    return summary


def collect_snapshot(s: Settings, store: Store, oa: OpenAlgo, strikes_each_side: int = 3) -> int:
    """Record live CE/PE LTPs around ATM (run every minute on D0/D1) so real premium data builds up."""
    known = openalgo_expiries(oa, s)
    today = ist_today()
    e = next_expiry(today, s.expiry_weekday, s.holidays, known)
    spot = float(oa.quote(s.underlying, s.index_exchange).get("ltp") or 0)
    if not spot:
        return 0
    atm = int(round(spot / s.strike_step) * s.strike_step)
    now = pd.Timestamp.now(tz=IST).floor("min").isoformat()
    rows = []
    for k in range(atm - strikes_each_side * s.strike_step, atm + (strikes_each_side + 1) * s.strike_step,
                   s.strike_step):
        for opt in ("CE", "PE"):
            try:
                ltp = oa.quote(option_symbol(s.underlying, e, k, opt), s.options_exchange).get("ltp")
            except OpenAlgoError:
                continue
            if ltp is not None:
                rows.append((now, e.isoformat(), k, opt, float(ltp), "live"))
    return store.upsert_premiums(rows)
