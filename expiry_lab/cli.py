"""Command line.

  python -m expiry_lab update            refresh last 4 weeks -> analyse -> learn -> replay -> report
  python -m expiry_lab refresh           only pull data (OpenAlgo, else free Yahoo) into the 4-week store
  python -m expiry_lab learn             analyse + learn + replay + report from what is stored
  python -m expiry_lab collect           record live CE/PE premiums every minute (run on D0/D1)
  python -m expiry_lab hook              start the webhook -> OpenAlgo order server
  python -m expiry_lab live [--direct]   watch the market on D0/D1 and fire the hook on triggers
  python -m expiry_lab status            recent signals and orders
  python -m expiry_lab demo              full offline run on synthetic data (data/demo)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time as _time
from datetime import date, datetime, time
from pathlib import Path

import pandas as pd

from .analysis import analyze_window
from .calendar import day_type
from .charts import build_report
from .config import Settings, get_settings
from .learner import learn, load_model, load_playbook
from .store import Store

log = logging.getLogger("expiry_lab")


def _analyse_learn_report(s: Settings, store: Store) -> Path:
    from .live import replay_day

    candles = store.candles()
    if candles.empty:
        raise SystemExit("No candles stored - run `refresh` first.")
    vix = store.vix()
    days = analyze_window(candles, s, vix, store.premiums())
    pb = learn(days, s)
    model = load_model(s)
    trades, prev_close = [], None
    for d in sorted(set(candles.index.date)):
        day = candles[candles.index.date == d]
        if day_type(d, s.expiry_weekday, s.holidays) in ("D0", "D1") and len(day) >= 20:
            v = next((x.stats["vix"] for x in days if x.day == d), s.default_vix)
            trades += replay_day(day, d, s, pb, model, prev_close, v)
        prev_close = float(day["close"].iloc[-1]) if len(day) else prev_close
    pd.DataFrame(trades).to_csv(s.data_dir / "replay_trades.csv", index=False)
    report = build_report(days, pb, s.report_dir, trades)
    _print_summary(pb, trades)
    print(f"\nReport: {report.resolve()}")
    return report


def _print_summary(pb: dict, trades: list[dict]) -> None:
    for kind in ("D1", "D0"):
        k = pb.get(kind, {})
        if not k.get("n_days"):
            print(f"{kind}: no days in window")
            continue
        print(f"{kind}: {k['n_days']} days | avg range {k['avg_range']} | trend shifts/day {k['avg_trend_shifts']}"
              f" | median leg {k['median_leg_points']} pts / {k['median_leg_minutes']} min"
              f" | best slots {', '.join(k['best_slots'])} | target {k['suggested_target_points']}"
              f" stop {k['suggested_stop_points']} | ORB follow-through {k['orb']['follow_through_rate']}")
    m = pb.get("model", {})
    print(f"model: {json.dumps({x: m.get(x) for x in ('test_accuracy', 'baseline_accuracy', 'directional_precision', 'trusted')})}")
    if trades:
        tp = pd.DataFrame(trades)
        print(f"replay: {len(tp)} trades, {int((tp.points > 0).sum())} winners, {tp.points.sum():+.0f} pts, "
              f"₹{tp.rupees.sum():+,.0f} (modelled premium, in-sample)")


def cmd_collect(s: Settings, store: Store) -> None:
    from .openalgo_client import OpenAlgo
    from .sources import collect_snapshot

    oa = OpenAlgo(s.openalgo_host, s.openalgo_api_key)
    kind = day_type(date.today(), s.expiry_weekday, s.holidays)
    if kind not in ("D0", "D1"):
        print(f"Today is {kind}; collect only runs on D0/D1.")
        return
    while datetime.now().time() < time(9, 15):
        _time.sleep(20)
    while time(9, 15) <= datetime.now().time() <= time(15, 30):
        try:
            n = collect_snapshot(s, store, oa)
            log.info("recorded %s premium quotes", n)
        except Exception as e:  # noqa: BLE001
            log.error("collect failed: %s", e)
        _time.sleep(60)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="expiry_lab", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["update", "refresh", "learn", "collect", "hook", "live", "status", "demo"])
    ap.add_argument("--source", choices=["auto", "openalgo", "yahoo", "synthetic"])
    ap.add_argument("--direct", action="store_true", help="live: call OpenAlgo directly instead of the hook URL")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO if a.verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if a.command == "demo":
        os.environ.setdefault("DATA_DIR", "data/demo")
        os.environ["DRY_RUN"] = "true"
        a.source = "synthetic"
        a.command = "update"
    s = get_settings()
    store = Store(s.db_path, s.retention_days)

    if a.command in ("update", "refresh"):
        from .sources import refresh

        print("refresh:", refresh(s, store, a.source))
    if a.command in ("update", "learn"):
        _analyse_learn_report(s, store)
    elif a.command == "collect":
        cmd_collect(s, store)
    elif a.command == "hook":
        from .hook import serve

        serve(s)
    elif a.command == "live":
        from .live import run_live

        pb = load_playbook(s)
        if not pb:
            raise SystemExit("No playbook yet - run `update` first.")
        run_live(s, store, pb, load_model(s), direct=a.direct)
    elif a.command == "status":
        pd.set_option("display.width", 200)
        print("signals:\n", store.table("signals", 20).to_string(index=False))
        print("\norders:\n", store.table("orders", 20).drop(columns=["request"]).to_string(index=False))


if __name__ == "__main__":
    main()
