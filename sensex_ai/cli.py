"""CLI.

  python -m sensex_ai.cli fetch                 # pull/refresh SENSEX candles from OpenAlgo into data/
  python -m sensex_ai.cli train [--synthetic]   # build dataset, walk-forward test, train D0 + D1 models
  python -m sensex_ai.cli replay --date 2026-11-13 [--no-claude]   # re-run a past day from cached data
  python -m sensex_ai.cli test-telegram         # send a test message
  python -m sensex_ai.cli run                   # live: run today (exits if today isn't D+0/D+1)
  python -m sensex_ai.cli auto                  # FULL AUTO: daemon that scans, reports and retrains by itself
  python -m sensex_ai.cli update                # nightly: refresh data + retrain (the "learning" step)
"""
from __future__ import annotations

import argparse
import json
import logging
from datetime import date

import pandas as pd

from .config import get_settings
from .data import MarketData, _normalise, synthetic_history
from .engine import Engine, score_outcome
from .expiry import ExpiryCalendar
from .features import build_dataset
from .live import run_today
from .model import train
from .schemas import Signal
from .telegram import Telegram, format_alert


def _load(s, synthetic: bool) -> pd.DataFrame:
    if synthetic:
        return synthetic_history(days=s.history_days)
    p = MarketData(s).cache_path()
    if not p.exists():
        raise SystemExit(f"{p} not found — run `fetch` first (or use --synthetic).")
    return _normalise(pd.read_csv(p, index_col=0))


def _calendar(s, synthetic: bool) -> ExpiryCalendar:
    if synthetic:
        return ExpiryCalendar(s)
    return ExpiryCalendar(s, MarketData(s).expiries())


def cmd_train(s, synthetic: bool) -> None:
    df = _load(s, synthetic)
    cal = _calendar(s, synthetic)
    ds = build_dataset(df, cal, s)
    ds.to_csv(s.data_dir / "dataset.csv", index=False)
    print(f"Dataset: {len(ds)} rows over {ds.date.nunique()} days "
          f"(D0 rows {int((ds.dte == 0).sum())}, D1 rows {int((ds.dte == 1).sum())})")
    for b in ("D0", "D1"):
        meta = train(ds, b, s)
        print(f"\n== {b} model ==\n" + json.dumps(meta.model_dump(mode="json"), indent=2))


def cmd_replay(s, d: date, synthetic: bool, use_claude: bool) -> None:
    df = _load(s, synthetic)
    cal = _calendar(s, synthetic)
    if cal.bucket(d) is None:
        raise SystemExit(f"{d} is DTE {cal.dte(d)}, not D+0/D+1.")
    eng, tg = Engine(s, cal, use_claude=use_claude), Telegram(s)
    day_df = df[df.index.date == d]
    for t in s.decision_times:
        a = eng.evaluate(df, d, t)
        if a is None:
            continue
        print(format_alert(a))
        if a.final_signal != Signal.SKIP:
            out, pts = score_outcome(day_df, pd.Timestamp(a.ts), a.final_signal.value, a.spot,
                                     a.target_pts, a.stop_pts, s.exit_time)
            print(f"   → outcome: {out} ({pts:+.0f} pts)")
        print("-" * 50)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="sensex_ai")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch")
    tr = sub.add_parser("train"); tr.add_argument("--synthetic", action="store_true")
    rp = sub.add_parser("replay"); rp.add_argument("--date", required=True)
    rp.add_argument("--synthetic", action="store_true"); rp.add_argument("--no-claude", action="store_true")
    sub.add_parser("test-telegram"); sub.add_parser("run"); sub.add_parser("update"); sub.add_parser("auto")
    a = ap.parse_args()
    s = get_settings()

    if a.cmd == "fetch":
        df = MarketData(s).load_or_update_cache()
        print(f"{len(df)} candles, {df.index.min()} → {df.index.max()}")
    elif a.cmd == "train":
        cmd_train(s, a.synthetic)
    elif a.cmd == "replay":
        cmd_replay(s, date.fromisoformat(a.date), a.synthetic, not a.no_claude)
    elif a.cmd == "test-telegram":
        ok = Telegram(s).send("✅ SENSEX expiry bot connected.")
        print("sent" if ok else "failed")
    elif a.cmd == "run":
        run_today(s)
    elif a.cmd == "auto":
        from .scheduler import auto
        auto(s)
    elif a.cmd == "update":
        MarketData(s).load_or_update_cache()
        cmd_train(s, synthetic=False)


if __name__ == "__main__":
    main()
