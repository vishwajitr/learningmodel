from datetime import date, datetime

import pandas as pd
import pytest

from expiry_lab.analysis import analyze_window, zigzag, add_indicators
from expiry_lab.calendar import day_type, next_expiry, openalgo_expiry_str, option_symbol
from expiry_lab.config import Settings
from expiry_lab.executor import Executor
from expiry_lab.learner import learn
from expiry_lab.premium import bs_price
from expiry_lab.sources import synthetic_candles
from expiry_lab.store import IST, Store


@pytest.fixture
def s(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DRY_RUN", "true")
    monkeypatch.setenv("HOOK_TOKEN", "secret")
    monkeypatch.setenv("OPENALGO_API_KEY", "")
    return Settings()


def test_calendar_thursday_and_holiday_shift():
    assert day_type(date(2026, 11, 19), 3, []) == "D0"
    assert day_type(date(2026, 11, 18), 3, []) == "D1"
    assert day_type(date(2026, 11, 17), 3, []) == "OTHER"
    # Thursday holiday -> Wednesday expiry, Tuesday is D1
    hol = [date(2026, 11, 19)]
    assert next_expiry(date(2026, 11, 16), 3, hol) == date(2026, 11, 18)
    assert day_type(date(2026, 11, 17), 3, hol) == "D1"
    assert openalgo_expiry_str(date(2026, 11, 19)) == "19NOV26"
    assert option_symbol("SENSEX", date(2026, 11, 19), 84500, "ce") == "SENSEX19NOV2684500CE"


def test_bs_put_call_parity():
    c = bs_price(80000, 80000, 2 / 365, 0.14, 0.065, "CE")
    p = bs_price(80000, 80000, 2 / 365, 0.14, 0.065, "PE")
    assert c > 0 and p > 0 and abs((c - p) - (80000 - 80000 * 2.718281828 ** (-0.065 * 2 / 365))) < 1


def test_zigzag_finds_reversal():
    idx = pd.date_range("2026-11-19 09:15", periods=6, freq="5min", tz=IST)
    px = [100, 300, 500, 300, 100, 120]
    df = pd.DataFrame({"open": px, "high": px, "low": px, "close": px}, index=idx)
    piv = zigzag(add_indicators(df, 10), 150)
    kinds = [p["kind"] for p in piv]
    assert "HIGH" in kinds and piv[kinds.index("HIGH")]["price"] == 500


def test_store_keeps_four_weeks(s):
    st = Store(s.db_path, 28)
    st.upsert_candles(synthetic_candles(60), "synthetic")
    st.prune()
    c = st.candles()
    assert (pd.Timestamp.now(tz=IST) - c.index.min()).days <= 28


def test_learn_and_report(s):
    st = Store(s.db_path, 28)
    st.upsert_candles(synthetic_candles(28), "synthetic")
    days = analyze_window(st.candles(), s)
    assert any(d.kind == "D0" for d in days) and any(d.kind == "D1" for d in days)
    pb = learn(days, s)
    assert pb["D0"]["n_days"] >= 3 and pb["D0"]["slots"]
    assert s.playbook_path.exists()


def test_executor_dry_run_and_guards(s):
    st = Store(s.db_path, 28)
    d0 = datetime(2026, 11, 19, 10, 30)  # a Thursday = D0
    ex = Executor(s, st, now=lambda: d0)
    r = ex.handle("BUY_CE", spot=84512)
    assert r["status"] == "dry_run" and r["symbol"] == "SENSEX19NOV2684500CE"
    assert ex.handle("BUY_PE")["status"] == "rejected"  # one position at a time
    assert ex.handle("EXIT")["status"] == "dry_run"
    s.kill_switch_path.write_text("x")
    assert ex.handle("BUY_PE")["status"] == "rejected"
    s.kill_switch_path.unlink()
    other = Executor(s, st, now=lambda: datetime(2026, 11, 17, 10, 30))  # Tuesday = OTHER
    assert other.handle("BUY_CE")["status"] == "rejected"
    late = Executor(s, st, now=lambda: datetime(2026, 11, 19, 16, 0))
    assert late.handle("BUY_CE")["status"] == "rejected"


def test_hook_auth_and_order(s):
    from expiry_lab.hook import create_app

    st = Store(s.db_path, 28)
    ex = Executor(s, st, now=lambda: datetime(2026, 11, 18, 11, 0))  # Wednesday = D1
    app = create_app(s, ex).test_client()
    assert app.post("/hook", json={"token": "nope", "action": "BUY_CE"}).status_code == 401
    r = app.post("/hook", json={"token": "secret", "action": "BUY_PE", "spot": 84460})
    assert r.status_code == 200 and r.json["symbol"] == "SENSEX19NOV2684500PE"
    assert app.post("/hook", headers={"X-Hook-Token": "secret"}, json={"action": "EXIT"}).status_code == 200
    assert app.get("/health").json["position"] is None


class FakeOA:
    def __init__(self):
        self.calls = []

    def expiries(self, *a):
        return ["19-NOV-26", "26-NOV-26"]

    def options_order(self, **kw):
        self.calls.append(("optionsorder", kw))
        return {"status": "success", "orderid": "1", "symbol": "SENSEX19NOV2684500CE"}

    def place_order(self, **kw):
        self.calls.append(("placeorder", kw))
        return {"status": "success", "orderid": "2"}


def test_live_mode_sends_openalgo_payload(s):
    s.dry_run = False
    oa = FakeOA()
    ex = Executor(s, Store(s.db_path, 28), oa=oa, now=lambda: datetime(2026, 11, 19, 10, 0))
    assert ex.handle("BUY_CE", lots=2)["status"] == "success"
    name, kw = oa.calls[0]
    assert name == "optionsorder" and kw["expiry_date"] == "19NOV26" and kw["quantity"] == 40
    assert kw["exchange"] == "BSE_INDEX" and kw["option_type"] == "CE" and kw["action"] == "BUY"
    assert ex.handle("EXIT")["status"] == "success"
    name, kw = oa.calls[1]
    assert name == "placeorder" and kw["action"] == "SELL" and kw["symbol"] == "SENSEX19NOV2684500CE"


def test_engine_replay_opens_and_closes_trades(s):
    from expiry_lab.analysis import analyze_window
    from expiry_lab.engine import simulate_day

    st = Store(s.db_path, 28)
    st.upsert_candles(synthetic_candles(28), "synthetic")
    c = st.candles()
    days = analyze_window(c, s)
    pb = learn(days, s)
    d = [x for x in days if x.kind == "D0"][-1]
    sent = []

    def send(order, now):
        sent.append(order["action"])
        return {"status": "dry_run", "symbol": "SENSEXTEST", "quantity": 20}

    states = simulate_day(s, c[c.index.date == d.day], "D0", d.expiry, pb, None, None, 13.0, 0, send)
    assert states[-1]["checks_count"] == len(states)
    assert all(x in ("BUY_CE", "BUY_PE", "EXIT") for x in sent)
    entries = [x for x in sent if x != "EXIT"]
    assert len(entries) <= s.max_trades_per_day
    in_trade = [x for x in states if x["position"]]
    if in_trade:
        p = in_trade[0]["position"]
        assert p["tp_spot"] != p["sl_spot"] and p["running_sec"] >= 0
        assert in_trade[0]["checks"]["CE"] and in_trade[0]["alerts"]
    # earlier states must not see later trades
    assert len(states[0]["trades"]) == 0


def test_dashboard_routes(s):
    from expiry_lab.hook import create_app

    app = create_app(s).test_client()
    assert b"SENSEX Expiry Lab" in app.get("/").data
    assert app.get("/api/state").status_code == 404
    (s.data_dir / "live_state.json").write_text('{"status": "WAITING"}')
    assert app.get("/api/state").json["status"] == "WAITING"
