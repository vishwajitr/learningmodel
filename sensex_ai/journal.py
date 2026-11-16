"""SQLite journal of every alert and its outcome — used for EOD reports and tracking live edge."""
from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import date

from .schemas import TradeAlert

DDL = """CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, trade_date TEXT, bucket TEXT, spot REAL,
  ml_signal TEXT, p_ce REAL, p_pe REAL, claude_action TEXT, claude_conf INTEGER,
  final_signal TEXT, option_symbol TEXT, option_ltp REAL, target REAL, stop REAL,
  outcome TEXT, payload TEXT)"""


class Journal:
    def __init__(self, path):
        self.path = path
        with closing(sqlite3.connect(path)) as c:
            c.execute(DDL)
            c.commit()

    def add(self, a: TradeAlert) -> int:
        with closing(sqlite3.connect(self.path)) as c:
            cur = c.execute(
                "INSERT INTO alerts(ts,trade_date,bucket,spot,ml_signal,p_ce,p_pe,claude_action,claude_conf,"
                "final_signal,option_symbol,option_ltp,target,stop,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (a.ts.isoformat(), a.trade_date.isoformat(), a.bucket, a.spot, a.ml.signal.value, a.ml.p_ce,
                 a.ml.p_pe, a.claude.action.value if a.claude else None, a.claude.confidence if a.claude else None,
                 a.final_signal.value, a.option_symbol, a.option_ltp, a.target_pts, a.stop_pts,
                 a.model_dump_json()))
            c.commit()
            return cur.lastrowid

    def for_day(self, d: date) -> list[sqlite3.Row]:
        with closing(sqlite3.connect(self.path)) as c:
            c.row_factory = sqlite3.Row
            return c.execute("SELECT * FROM alerts WHERE trade_date=? ORDER BY ts", (d.isoformat(),)).fetchall()

    def set_outcome(self, alert_id: int, outcome: str) -> None:
        with closing(sqlite3.connect(self.path)) as c:
            c.execute("UPDATE alerts SET outcome=? WHERE id=?", (outcome, alert_id))
            c.commit()

    def stats(self) -> dict:
        with closing(sqlite3.connect(self.path)) as c:
            rows = c.execute("SELECT bucket, final_signal, outcome FROM alerts "
                             "WHERE final_signal!='SKIP' AND outcome IS NOT NULL").fetchall()
        out = {}
        for b in ("D0", "D1"):
            r = [x for x in rows if x[0] == b]
            wins = sum(1 for x in r if x[2] == "TARGET")
            out[b] = {"alerts": len(r), "target_hit": wins, "hit_rate": wins / len(r) if r else None}
        return out
