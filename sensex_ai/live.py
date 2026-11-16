"""Live runner: on D+0 / D+1 days, evaluates at each decision time, alerts on Telegram, sends an EOD report."""
from __future__ import annotations

import logging
import time as _time
from datetime import date, datetime, time, timedelta

import pandas as pd

from .config import Settings
from .data import MarketData
from .engine import Engine, score_outcome
from .expiry import ExpiryCalendar
from .journal import Journal
from .schemas import Signal
from .telegram import Telegram, format_alert

log = logging.getLogger(__name__)
BAR_SETTLE_SEC = 20  # wait this long after the bar closes so the broker has it


def _sleep_until(t: time) -> None:
    target = datetime.combine(date.today(), t) + timedelta(seconds=BAR_SETTLE_SEC)
    while (left := (target - datetime.now()).total_seconds()) > 0:
        _time.sleep(min(left, 30))


def run_today(s: Settings) -> None:
    md = MarketData(s)
    cal = ExpiryCalendar(s, md.expiries())
    tg, journal = Telegram(s), Journal(s.db_path)
    today = date.today()

    bucket = cal.bucket(today) if cal.is_trading_day(today) else None
    if bucket is None:
        log.info("%s is not D+0/D+1 (next expiry %s). Nothing to do.", today, cal.next_expiry(today))
        return

    eng = Engine(s, cal, md)
    label = "D+0 (expiry day)" if bucket == "D0" else "D+1 (day before expiry)"
    tg.send(f"📅 <b>SENSEX {label}</b>\nExpiry {cal.next_expiry(today):%d %b %Y}. Scanning at "
            + ", ".join(t.strftime("%H:%M") for t in s.decision_times))

    sent, sides = 0, set()
    for t in s.decision_times:
        if datetime.now().time() > (datetime.combine(today, t) + timedelta(minutes=10)).time():
            continue  # started late; skip stale slots
        _sleep_until(t)
        try:
            df = md.today_candles()
            alert = eng.evaluate(df, today, t, live_options=True)
        except Exception as e:  # noqa: BLE001
            log.exception("evaluate failed at %s", t)
            tg.send(f"⚠️ SENSEX bot error at {t:%H:%M}: {e}")
            continue
        if alert is None:
            continue
        journal.add(alert)
        is_trade = alert.final_signal != Signal.SKIP
        if is_trade and (sent >= s.max_alerts_per_day or alert.final_signal in sides):
            log.info("Suppressed %s at %s (limit / same side already alerted)", alert.final_signal, t)
            continue
        if is_trade or s.send_skip_alerts:
            tg.send(format_alert(alert))
        if is_trade:
            sent += 1
            sides.add(alert.final_signal)

    _sleep_until(time(15, 20))
    eod_report(s, today, md.today_candles(), journal, tg)


def eod_report(s: Settings, d: date, df: pd.DataFrame, journal: Journal, tg: Telegram) -> None:
    day_df = df[df.index.date == d]
    rows = [r for r in journal.for_day(d) if r["final_signal"] != "SKIP"]
    if not rows:
        tg.send(f"📊 SENSEX EOD {d:%d %b}: no trade alerts today.")
        return
    lines = [f"📊 <b>SENSEX EOD {d:%d %b}</b>"]
    for r in rows:
        ts = pd.Timestamp(r["ts"]).tz_convert("Asia/Kolkata") if pd.Timestamp(r["ts"]).tzinfo else \
            pd.Timestamp(r["ts"], tz="Asia/Kolkata")
        outcome, pts = score_outcome(day_df, ts, r["final_signal"], r["spot"], r["target"], r["stop"], s.exit_time)
        journal.set_outcome(r["id"], outcome)
        icon = {"TARGET": "✅", "STOP": "❌", "TIME_EXIT": "⏱"}[outcome]
        lines.append(f"{icon} {ts:%H:%M} {r['final_signal']} @ {r['spot']:,.0f} → {outcome} ({pts:+.0f} index pts)")
    st = journal.stats()
    for b, v in st.items():
        if v["alerts"]:
            lines.append(f"{b} lifetime: {v['target_hit']}/{v['alerts']} targets ({v['hit_rate']:.0%})")
    tg.send("\n".join(lines))
