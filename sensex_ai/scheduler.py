"""Fully automatic mode: one long-running process that does everything, no cron needed.

Daily loop (Asia/Kolkata, weekdays):
  09:05  run_today()  - exits quickly unless today is D+0/D+1; otherwise scans, alerts, sends EOD report (~15:20)
  19:30  nightly update - refetch candles + retrain both models (the "learning" step)
On first start it bootstraps (fetch + train) if no models exist. Any failure is reported on Telegram
and the loop carries on. A state file prevents repeating a job after a restart.
"""
from __future__ import annotations

import json
import logging
import time as _time
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .config import Settings
from .telegram import Telegram

log = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")
RUN_AT, UPDATE_AT = time(9, 5), time(19, 30)


def now_ist() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)  # naive IST; live.py also uses naive local time (TZ=Asia/Kolkata)


class State:
    def __init__(self, s: Settings):
        self.path = s.data_dir / "scheduler_state.json"
        self.d = json.loads(self.path.read_text()) if self.path.exists() else {}

    def done(self, job: str, d: date) -> bool:
        return self.d.get(job) == d.isoformat()

    def mark(self, job: str, d: date) -> None:
        self.d[job] = d.isoformat()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.d))


def due_jobs(now: datetime, st: State) -> list[str]:
    """Pure function: which jobs should run right now."""
    if now.weekday() >= 5:
        return []
    jobs = []
    if RUN_AT <= now.time() < time(15, 30) and not st.done("run", now.date()):
        jobs.append("run")
    if now.time() >= UPDATE_AT and not st.done("update", now.date()):
        jobs.append("update")
    return jobs


def _bootstrap(s: Settings, tg: Telegram) -> None:
    from .cli import cmd_train
    from .data import MarketData
    if (s.model_dir / "sensex_D0.joblib").exists() and (s.model_dir / "sensex_D1.joblib").exists():
        return
    log.info("No models found - bootstrapping (fetch + train)")
    MarketData(s).load_or_update_cache()
    cmd_train(s, synthetic=False)
    tg.send("🧠 SENSEX bot: initial data fetch + training done.")


def _job_run(s: Settings) -> None:
    from .live import run_today
    run_today(s)


def _job_update(s: Settings) -> None:
    from .cli import cmd_train
    from .data import MarketData
    MarketData(s).load_or_update_cache()
    cmd_train(s, synthetic=False)


def auto(s: Settings, poll_sec: int = 30, once: bool = False) -> None:
    s.data_dir.mkdir(parents=True, exist_ok=True)
    tg, st = Telegram(s), State(s)
    tg.send("🤖 SENSEX expiry bot started in AUTO mode (scan 09:05, retrain 19:30 IST, weekdays).")
    try:
        _bootstrap(s, tg)
    except Exception as e:  # noqa: BLE001
        log.exception("bootstrap failed")
        tg.send(f"⚠️ Bootstrap failed: {e}")
    handlers = {"run": _job_run, "update": _job_update}
    while True:
        now = now_ist()
        for job in due_jobs(now, st):
            st.mark(job, now.date())          # mark first: a crash must not cause a repeat alert storm
            try:
                log.info("Starting job %s", job)
                handlers[job](s)
                if job == "update":
                    tg.send("🧠 Nightly retrain complete.")
            except Exception as e:  # noqa: BLE001
                log.exception("job %s failed", job)
                tg.send(f"⚠️ SENSEX bot job '{job}' failed: {e}")
        if once:
            return
        _time.sleep(poll_sec)
