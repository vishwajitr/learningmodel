"""Market data: OpenAlgo history/expiry/option quotes, with a CSV cache and a synthetic generator for offline tests."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from functools import cached_property

import numpy as np
import pandas as pd

from .config import Settings
from .expiry import fmt_expiry, parse_expiry_list

log = logging.getLogger(__name__)
IST = "Asia/Kolkata"


def _normalise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.lower() for c in df.columns]
    if "timestamp" in df.columns:
        df = df.set_index("timestamp")
    idx = pd.to_datetime(df.index)
    if idx.tz is None:
        idx = idx.tz_localize(IST)
    else:
        idx = idx.tz_convert(IST)
    df.index = idx
    df = df[~df.index.duplicated()].sort_index()
    return df[["open", "high", "low", "close"]].astype(float)


class MarketData:
    def __init__(self, settings: Settings):
        self.s = settings

    @cached_property
    def client(self):
        from openalgo import api
        return api(
            api_key=self.s.openalgo_api_key.get_secret_value(),
            host=self.s.openalgo_host,
            ws_url=self.s.openalgo_ws_url,
        )

    # ---------- candles ----------
    def fetch_history(self, start: date, end: date, chunk_days: int = 30) -> pd.DataFrame:
        """Intraday index candles, fetched in chunks (brokers cap intraday ranges)."""
        frames, cur = [], start
        while cur <= end:
            stop = min(cur + timedelta(days=chunk_days - 1), end)
            res = self.client.history(
                symbol=self.s.underlying, exchange=self.s.index_exchange, interval=self.s.interval,
                start_date=cur.isoformat(), end_date=stop.isoformat(),
            )
            if isinstance(res, pd.DataFrame) and not res.empty:
                frames.append(_normalise(res))
            else:
                log.warning("history %s→%s returned %s", cur, stop, res if isinstance(res, dict) else "empty")
            cur = stop + timedelta(days=1)
        if not frames:
            raise RuntimeError("No history returned from OpenAlgo — check API key, host and broker login.")
        return _normalise(pd.concat(frames))

    def cache_path(self):
        return self.s.data_dir / f"{self.s.underlying}_{self.s.interval}.csv"

    def load_or_update_cache(self, days: int | None = None) -> pd.DataFrame:
        days = days or self.s.history_days
        path, end = self.cache_path(), date.today()
        if path.exists():
            cached = _normalise(pd.read_csv(path, index_col=0))
            start = cached.index.max().date()  # refetch last day to complete it
            new = self.fetch_history(start, end)
            df = _normalise(pd.concat([cached[cached.index.date < start], new]))
        else:
            df = self.fetch_history(end - timedelta(days=days), end)
        df.to_csv(path)
        return df

    def today_candles(self) -> pd.DataFrame:
        today = date.today()
        prev = today - timedelta(days=10)  # include previous sessions for prev-day features
        return self.fetch_history(prev, today, chunk_days=15)

    # ---------- expiries / options ----------
    def expiries(self) -> list[date]:
        try:
            res = self.client.expiry(symbol=self.s.underlying, exchange=self.s.options_exchange,
                                     instrumenttype="options")
            return parse_expiry_list(res.get("data", []))
        except Exception as e:  # noqa: BLE001
            log.warning("expiry() failed (%s); using weekday rule", e)
            return []

    def option_contract(self, expiry: date, offset: str, option_type: str) -> tuple[str | None, int | None, float | None]:
        """Returns (symbol, lot_size, ltp) for e.g. offset='ATM', option_type='CE'."""
        try:
            info = self.client.optionsymbol(
                underlying=self.s.underlying, exchange=self.s.index_exchange,
                expiry_date=fmt_expiry(expiry), offset=offset, option_type=option_type,
            )
            sym, lot = info.get("symbol"), info.get("lotsize")
            q = self.client.quotes(symbol=sym, exchange=info.get("exchange", self.s.options_exchange))
            ltp = (q.get("data") or {}).get("ltp")
            return sym, lot, ltp
        except Exception as e:  # noqa: BLE001
            log.warning("option lookup failed: %s", e)
            return None, None, None


# ---------- synthetic data for offline testing ----------
def synthetic_history(days: int = 400, interval_min: int = 5, start_price: float = 80000, seed: int = 7) -> pd.DataFrame:
    """Random-walk SENSEX-like 5m candles with regime drift, gaps and fatter expiry-day moves."""
    rng = np.random.default_rng(seed)
    rows, price = [], start_price
    d = date.today() - timedelta(days=int(days * 1.45))
    n_days = 0
    while n_days < days:
        d += timedelta(days=1)
        if d.weekday() >= 5:
            continue
        n_days += 1
        expiry_like = d.weekday() == 3
        drift = rng.normal(0, 0.00025)               # intraday trend for the day
        vol = 0.0011 * (1.5 if expiry_like else 1.0)
        price *= 1 + rng.normal(0, 0.004)            # overnight gap
        t = datetime(d.year, d.month, d.day, 9, 15)
        end = datetime(d.year, d.month, d.day, 15, 30)
        momentum = 0.0
        while t < end:
            momentum = 0.6 * momentum + rng.normal(drift, vol)
            o = price
            c = o * (1 + momentum)
            h = max(o, c) * (1 + abs(rng.normal(0, vol / 2)))
            l_ = min(o, c) * (1 - abs(rng.normal(0, vol / 2)))
            rows.append((pd.Timestamp(t, tz=IST), o, h, l_, c))
            price = c
            t += timedelta(minutes=interval_min)
    df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close"]).set_index("timestamp")
    return df.round(2)
