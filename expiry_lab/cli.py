"""Command line.

  python -m expiry_lab update            refresh last 4 weeks -> analyse -> learn -> replay -> report
  python -m expiry_lab refresh           only pull data (OpenAlgo, else free Yahoo) into the 4-week store
  python -m expiry_lab learn             analyse + learn + replay + report from what is stored
  python -m expiry_lab collect           record live CE/PE premiums every minute (run on D0/D1)
  python -m expiry_lab hook              start the webhook -> OpenAlgo order server
  python -m expiry_lab live [--direct]   watch the market on D0/D1 and fire the hook on triggers
  python -m expiry_lab status            recent signals and orders
  python -m expiry_lab replay            practice: replay the latest D0/D1 day on the live screen (any day)
  python -m expiry_lab check             readiness check: OpenAlgo, key, quotes, expiry, playbook, hook
  python -m expiry_lab demo              full offline run on synthetic data (data/demo)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time as _time
from datetime import time
from pathlib import Path

import pandas as pd

from .analysis import analyze_window
from .calendar import day_type, ist_now, ist_today
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
    demo_screen = build_live_demo(s, candles, days, pb, model)
    if demo_screen:
        print(f"Live screen replay: {demo_screen.resolve()}")
    report = build_report(days, pb, s.report_dir, trades)
    _print_summary(pb, trades)
    print(f"\nReport: {report.resolve()}")
    return report


def replay_states(s: Settings, candles: pd.DataFrame, days, pb: dict, model) -> list[dict]:
    """Play the latest stored D0 (else D1) day through the live engine, in practice mode."""
    import tempfile

    from .engine import simulate_day
    from .executor import Executor

    pick = [d for d in days if d.kind == "D0"] or [d for d in days if d.kind == "D1"]
    if not pick:
        return []
    d = pick[-1]
    day = candles[candles.index.date == d.day]
    prev = candles[candles.index.date < d.day]
    prev_close = float(prev["close"].iloc[-1]) if len(prev) else None
    with tempfile.TemporaryDirectory() as tmp:
        sim = Settings()
        sim.data_dir, sim.dry_run = Path(tmp), True
        sim_store = Store(sim.db_path, sim.retention_days)

        def send(order, now):
            ex = Executor(sim, sim_store, now=lambda: now.tz_localize(None).to_pydatetime())
            return ex.handle(order["action"], lots=order.get("lots"), reason=order.get("reason", ""),
                             spot=order.get("spot"))

        return simulate_day(sim, day, d.kind, d.expiry, pb, model, prev_close, d.stats["vix"], d.stats["dte"], send)


def build_live_demo(s: Settings, candles: pd.DataFrame, days, pb: dict, model) -> Path | None:
    """Save the live screen with a replay of the latest D0/D1 day baked in (opens without a server)."""
    states = replay_states(s, candles, days, pb, model)
    if not states:
        return None
    page = (Path(__file__).parent / "static" / "dashboard.html").read_text(encoding="utf-8")
    inject = "<script>window.__DEMO__=" + json.dumps(states, default=str, separators=(",", ":")) + ";</script>"
    out = s.report_dir / "live_demo.html"
    out.write_text(page.replace("<script>\nconst DEMO", inject + "\n<script>\nconst DEMO", 1), encoding="utf-8")
    return out


def cmd_replay(s: Settings, store: Store, step: float) -> None:
    """Feed the live screen (served by `hook`) with a replay of the latest stored D0/D1 day, on a loop.
    Practice only: no order is sent. Use it to see the screen working on any day."""
    from .engine import write_state

    candles = store.candles()
    if candles.empty:
        raise SystemExit("No data stored - run `update` (or `demo`) first.")
    pb = load_playbook(s)
    if not pb:
        raise SystemExit("No playbook yet - run `update` first.")
    days = analyze_window(candles, s, store.vix(), store.premiums())
    states = replay_states(s, candles, days, pb, load_model(s))
    if not states:
        raise SystemExit("No D0/D1 day in the stored window to replay.")
    path = s.data_dir / "live_state.json"
    print(f"Replaying {states[0]['day']} ({states[0]['kind']}), {len(states)} checks, one every {step:g}s. "
          f"Open http://{s.hook_host}:{s.hook_port}/  (Ctrl+C to stop)")
    while True:
        for st in states:
            st = dict(st, poll_seconds=step, data_source="replay of a past day (practice)", mode="PRACTICE",
                      next_check=(pd.Timestamp(st["now"]) + pd.Timedelta(seconds=step)).isoformat())
            write_state(path, st)
            _time.sleep(step)


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
    kind = day_type(ist_today(), s.expiry_weekday, s.holidays)
    if kind not in ("D0", "D1"):
        print(f"Today is {kind}; collect only runs on D0/D1.")
        return
    while ist_now().time() < time(9, 15):
        _time.sleep(20)
    while time(9, 15) <= ist_now().time() <= time(15, 30):
        try:
            n = collect_snapshot(s, store, oa)
            log.info("recorded %s premium quotes", n)
        except Exception as e:  # noqa: BLE001
            log.error("collect failed: %s", e)
        _time.sleep(60)


def cmd_check(s: Settings) -> bool:
    """Pre-flight: is everything ready for a live day? Prints ✓/✗ with what to fix."""
    import httpx

    from .calendar import next_expiry, option_symbol, parse_expiry_list
    from .learner import load_playbook
    from .openalgo_client import OpenAlgo

    ok_all = True

    def line(ok, name, detail="", fix=""):
        nonlocal ok_all
        mark = "✓" if ok else ("!" if ok is None else "✗")
        if ok is False:
            ok_all = False
        print(f" {mark} {name}" + (f" — {detail}" if detail else "") + (f"\n     fix: {fix}" if fix and not ok else ""))

    print("SENSEX Expiry Lab — readiness check\n")
    today = ist_today()
    kind = day_type(today, s.expiry_weekday, s.holidays)
    line(True, "India time", f"{ist_now():%a %d %b %H:%M} IST, today is {kind}")
    line(Path(".env").exists(), ".env file", str(Path(".env").resolve()), "copy .env.example to .env and fill it in")
    line(bool(s.hook_token) and s.hook_token != "change-me-to-a-long-random-string", "HOOK_TOKEN set",
         fix="put any long random string in HOOK_TOKEN")
    line(None if s.dry_run else True, "Order mode", "PRACTICE (DRY_RUN=true, no real orders)" if s.dry_run
         else "LIVE — real orders will be placed")
    if not s.openalgo_api_key or s.openalgo_api_key == "your-openalgo-api-key":
        line(False, "OPENALGO_API_KEY", "not set", "OpenAlgo → API Key page, paste into .env")
    else:
        oa = OpenAlgo(s.openalgo_host, s.openalgo_api_key)
        spot = None
        try:
            spot = float(oa.quote(s.underlying, s.index_exchange).get("ltp") or 0) or None
            line(bool(spot), f"OpenAlgo at {s.openalgo_host}", f"SENSEX LTP {spot:,.2f}" if spot else "no LTP")
        except Exception as e:  # noqa: BLE001
            line(False, f"OpenAlgo at {s.openalgo_host}", str(e)[:150],
                 "start OpenAlgo, log in to your broker today, check OPENALGO_HOST and the API key")
        exps = []
        try:
            exps = parse_expiry_list(oa.expiries(s.underlying, s.options_exchange))
            e = next_expiry(today, s.expiry_weekday, s.holidays, exps)
            rule = next_expiry(today, s.expiry_weekday, s.holidays)
            line(e == rule if exps else None, "Expiry", f"broker says {e}, weekday rule says {rule}",
                 "set EXPIRY_WEEKDAY / HOLIDAYS so the rule matches the broker")
        except Exception as err:  # noqa: BLE001
            e = next_expiry(today, s.expiry_weekday, s.holidays)
            line(None, "Expiry list", f"unavailable ({str(err)[:80]}); using rule: {e}")
        if spot:
            k = int(round(spot / s.strike_step) * s.strike_step)
            for opt in ("CE", "PE"):
                sym = option_symbol(s.underlying, e, k, opt)
                try:
                    ltp = oa.quote(sym, s.options_exchange).get("ltp")
                    line(ltp is not None, f"Option quote {sym}", f"LTP {ltp}")
                except Exception as err:  # noqa: BLE001
                    line(False, f"Option quote {sym}", str(err)[:120],
                         "symbol format/expiry mismatch: check the symbol in OpenAlgo's search and tell me")
        try:
            from datetime import timedelta
            h = oa.history(s.underlying, s.index_exchange, f"{s.interval_min}m", today - timedelta(days=5), today)
            line(len(h) > 0, "5-min history", f"{len(h)} bars, last {h.index[-1]:%d %b %H:%M}" if len(h) else "empty")
        except Exception as err:  # noqa: BLE001
            line(False, "5-min history", str(err)[:120], "check the broker supports intraday history in OpenAlgo")
    pb = load_playbook(s)
    line(bool(pb), "Playbook (learning)", f"built {pb.get('built_at')} from {pb.get('window', {}).get('sessions')} sessions"
         if pb else "missing", "run: python -m expiry_lab update")
    try:
        base = (s.hook_url or f"http://{s.hook_host}:{s.hook_port}/hook").rsplit("/hook", 1)[0]
        r = httpx.get(base + "/health", timeout=3).json()
        line(True, "Hook server", f"running at {base}/  (dry_run={r.get('dry_run')}, kill_switch={r.get('kill_switch')})")
    except Exception:  # noqa: BLE001
        line(None, "Hook server", "not running yet", "start it with: python -m expiry_lab hook")
    print("\n" + ("READY. Start `hook`, then `live`, and open the screen." if ok_all else
                  "NOT READY: fix the ✗ items above."))
    return ok_all


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="expiry_lab", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["update", "refresh", "learn", "collect", "hook", "live", "status", "demo", "check", "replay"])
    ap.add_argument("--step", type=float, default=2.0, help="replay: seconds between checks")
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
    elif a.command == "replay":
        cmd_replay(s, store, a.step)
    elif a.command == "check":
        raise SystemExit(0 if cmd_check(s) else 1)
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
