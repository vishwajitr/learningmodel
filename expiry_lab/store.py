"""SQLite store with a rolling 4-week window (RETENTION_DAYS).

Tables
  candles   index OHLC bars (5m) — from OpenAlgo or Yahoo
  premiums  option premium bars/snapshots (real ones from OpenAlgo; source column says where from)
  vix       daily India VIX close (used to model premiums when real ones are missing)
  signals   every trigger the live engine fired
  orders    every order request the hook handled (dry-run or live) and OpenAlgo's reply
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from .calendar import ist_now

IST = "Asia/Kolkata"

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (ts TEXT PRIMARY KEY, open REAL, high REAL, low REAL, close REAL, source TEXT);
CREATE TABLE IF NOT EXISTS premiums (
  ts TEXT, expiry TEXT, strike INTEGER, opt TEXT, ltp REAL, source TEXT,
  PRIMARY KEY (ts, expiry, strike, opt));
CREATE TABLE IF NOT EXISTS vix (day TEXT PRIMARY KEY, close REAL);
CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, day_type TEXT,
  action TEXT, prob REAL, spot REAL, reason TEXT);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, action TEXT,
  symbol TEXT, quantity INTEGER, dry_run INTEGER, status TEXT, request TEXT, response TEXT);
"""


class Store:
    def __init__(self, path: Path, retention_days: int = 28):
        self.path = Path(path)
        self.retention_days = retention_days
        with self.conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, timeout=30)
        try:
            yield c
            c.commit()
        finally:
            c.close()

    # ---------- candles ----------
    def upsert_candles(self, df: pd.DataFrame, source: str) -> int:
        if df.empty:
            return 0
        rows = [(ts.isoformat(), r.open, r.high, r.low, r.close, source) for ts, r in df.iterrows()]
        with self.conn() as c:
            c.executemany("INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?)", rows)
        return len(rows)

    def candles(self) -> pd.DataFrame:
        with self.conn() as c:
            df = pd.read_sql("SELECT ts, open, high, low, close FROM candles ORDER BY ts", c)
        if df.empty:
            return df
        df["ts"] = pd.to_datetime(df["ts"], utc=True, format="ISO8601").dt.tz_convert(IST)
        return df.set_index("ts")

    # ---------- premiums ----------
    def upsert_premiums(self, rows: list[tuple]) -> int:
        """rows: (ts_iso, expiry_iso, strike, opt, ltp, source)"""
        if not rows:
            return 0
        with self.conn() as c:
            c.executemany("INSERT OR REPLACE INTO premiums VALUES (?,?,?,?,?,?)", rows)
        return len(rows)

    def premiums(self) -> pd.DataFrame:
        with self.conn() as c:
            df = pd.read_sql("SELECT * FROM premiums ORDER BY ts", c)
        if not df.empty:
            df["ts"] = pd.to_datetime(df["ts"], utc=True, format="ISO8601").dt.tz_convert(IST)
        return df

    # ---------- vix ----------
    def upsert_vix(self, s: pd.Series) -> None:
        with self.conn() as c:
            c.executemany("INSERT OR REPLACE INTO vix VALUES (?,?)",
                          [(str(pd.Timestamp(d).date()), float(v)) for d, v in s.items()])

    def vix(self) -> dict[str, float]:
        with self.conn() as c:
            return dict(c.execute("SELECT day, close FROM vix").fetchall())

    # ---------- signals / orders ----------
    def log_signal(self, ts: datetime, day_type: str, action: str, prob: float, spot: float, reason: str) -> None:
        with self.conn() as c:
            c.execute("INSERT INTO signals (ts, day_type, action, prob, spot, reason) VALUES (?,?,?,?,?,?)",
                      (ts.isoformat(), day_type, action, prob, spot, reason))

    def log_order(self, action: str, symbol: str, qty: int, dry_run: bool, status: str,
                  request: dict, response: dict | str) -> None:
        req = {k: v for k, v in request.items() if k != "apikey"}  # never store the key
        with self.conn() as c:
            c.execute("INSERT INTO orders (ts, action, symbol, quantity, dry_run, status, request, response) "
                      "VALUES (?,?,?,?,?,?,?,?)",
                      (ist_now().isoformat(timespec="seconds"), action, symbol, qty, int(dry_run), status,
                       json.dumps(req), json.dumps(response, default=str)))

    def orders_today(self, entries_only: bool = True) -> int:
        today = ist_now().date().isoformat()
        q = "SELECT COUNT(*) FROM orders WHERE ts >= ? AND status IN ('success','dry_run')"
        if entries_only:
            q += " AND action IN ('BUY_CE','BUY_PE')"
        with self.conn() as c:
            return c.execute(q, (today,)).fetchone()[0]

    def table(self, name: str, limit: int = 50) -> pd.DataFrame:
        with self.conn() as c:
            return pd.read_sql(f"SELECT * FROM {name} ORDER BY rowid DESC LIMIT ?", c, params=(limit,))

    # ---------- rolling window ----------
    def prune(self, now: datetime | None = None) -> None:
        """Keep only the last RETENTION_DAYS of market data (signals/orders are kept as an audit log)."""
        now = now or ist_now()
        cutoff = pd.Timestamp(now - timedelta(days=self.retention_days)).tz_localize(IST)
        cut_iso = cutoff.isoformat()
        with self.conn() as c:
            # ISO strings with the same +05:30 offset sort correctly
            c.execute("DELETE FROM candles WHERE ts < ?", (cut_iso,))
            c.execute("DELETE FROM premiums WHERE ts < ?", (cut_iso,))
            c.execute("DELETE FROM vix WHERE day < ?", (str(cutoff.date() - timedelta(days=7)),))
