# SENSEX Expiry Lab — D1 (day before expiry) & D0 (expiry day)

Learns how SENSEX behaves on the **day before expiry (D1)** and **expiry day (D0)** from a rolling
**last-4-weeks** window, draws it as charts, and fires a **hook → OpenAlgo** order when the live trigger hits.

```
           free Yahoo (^BSESN 5m, ^INDIAVIX)  ─┐
 OpenAlgo history + live option quotes  ───────┼─► SQLite store (only the last 28 days are kept)
                                               │
                                               ▼
   analysis: trend shifts · points available per slot · premium path & decay · opening-range breaks
                                               │
                                               ▼
   learner: playbook.json (D1 / D0 stats, targets, stops, best slots) + small model (walk-forward checked)
                                               │
            ┌──────────────────────────────────┴───────────────┐
            ▼                                                  ▼
   report: data/report/index.html + charts            live engine (D0/D1 only)
                                                               │ trigger
                                                               ▼
                                  POST /hook  ──►  safety checks  ──►  OpenAlgo /api/v1/optionsorder
                                (also callable from TradingView, ChartInk, curl)
```

## What it learns from the last 4 weeks

| Question | How it is measured | Where to see it |
|---|---|---|
| **How is the trend shifting?** | Zig-zag swing pivots: a reversal ≥ `SWING_POINTS` (or 4 typical bars on wild days) is a trend shift. Legs between pivots give points and minutes. | `paths.png` (▼/▲ = swing high/low, leg points labelled), `shift_hours.png` (which hour shifts happen) |
| **How many points can be captured?** | From every 15-min slot 09:30–14:45: max up and max down in the next `HORIZON_MIN`, and which side moved `MOVE_POINTS` first (UP / DOWN / CHOP). | `capture.png` rows 1–2, best slots ★ |
| **How does premium behave?** | Opening-ATM CE & PE through the day, re-centred ATM straddle decay, and the best premium gain % a buyer got from each slot. | `premiums.png`, `decay.png`, `capture.png` row 3 |
| **Does the opening range break work?** | First close outside the first 15 min range, and whether it then ran `MOVE_POINTS` in that direction. | report table "ORB follow-through" |
| **Targets / stops** | Target = a move reached in ~60% of slots that moved; stop = typical heat taken, never tighter than `MOVE_POINTS` or half the target. | `playbook.json`, report |

Plus a small multinomial logistic regression (features: time of day, move from open, distance from average
price, opening-range position, EMA9–21 gap, 15/30-min slope, recent volatility, range so far, gap, days to
expiry, VIX). It is tested walk-forward on the latest week; **if it does not beat "always guess the most common
outcome", it is marked untrusted and the live engine uses rules only.**

### Free resources used
* **Data:** Yahoo Finance via `yfinance` — `^BSESN` 5-minute candles (Yahoo keeps ~60 days of 5m, enough for
  4 weeks) and `^INDIAVIX` daily. No key needed.
* **Premiums:** free sources don't keep intraday premium history of expired weeklies, so for those days the
  premium path is rebuilt with **Black-Scholes** from the index path and the previous day's India VIX
  (marked `model` in the report). When OpenAlgo is connected, real option candles are pulled where the broker
  still serves them, and `collect` records live CE/PE quotes every minute on D0/D1 (marked `real`/`live`).
  Real data always replaces modelled data.
* **Expiry-day ideas built in** (widely taught, free): theta decay of the straddle into expiry, the afternoon
  "gamma" move on D0, opening-range breakout, trading above/below average price, EMA trend filter.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env      # set OPENALGO_API_KEY, HOOK_TOKEN; keep DRY_RUN=true to start
```

Try everything offline first (synthetic data, no keys, nothing sent):

```bash
python -m expiry_lab demo
```

Open `data/demo/report/index.html`.

## Daily use

```bash
python -m expiry_lab update     # pull last 4 weeks → analyse → learn → replay → report (run each evening)
python -m expiry_lab hook       # start the order hook (keep running during market hours)
python -m expiry_lab live       # on D0/D1: watch 5m bars and POST to the hook when the trigger fires
python -m expiry_lab collect    # optional, on D0/D1: record real CE/PE premiums every minute
python -m expiry_lab status     # recent signals and orders
```

`live --direct` skips the HTTP hop and calls OpenAlgo from the same process (same safety checks).

Cron example (IST machine):

```cron
40 18 * * 1-5  cd /path/learningmodel && python -m expiry_lab update  >> data/update.log 2>&1
10 9  * * 1-5  cd /path/learningmodel && python -m expiry_lab hook    >> data/hook.log 2>&1
15 9  * * 1-5  cd /path/learningmodel && python -m expiry_lab live    >> data/live.log 2>&1
15 9  * * 1-5  cd /path/learningmodel && python -m expiry_lab collect >> data/collect.log 2>&1
```

`live` and `collect` exit at once on days that aren't D0/D1. Stop the hook after market (e.g. `pkill -f "expiry_lab hook"` at 15:35).

## The hook (trigger → OpenAlgo order)

`POST http://127.0.0.1:8787/hook` with header `X-Hook-Token: <HOOK_TOKEN>` (or `"token"` in the body):

| action | What OpenAlgo gets |
|---|---|
| `BUY_CE` / `BUY_PE` | `/api/v1/optionsorder` — underlying SENSEX, exchange BSE_INDEX, current expiry (`19NOV26` format), `offset` (ATM/OTM1/…), BUY, `lots × LOT_SIZE`, MARKET, `PRODUCT`. Falls back to `/placeorder` with a computed ATM symbol on older OpenAlgo builds. |
| `EXIT` | `/api/v1/placeorder` SELL of the open position's symbol and quantity |
| `EXIT_ALL` | `/api/v1/closeposition` for `STRATEGY_NAME` |

```bash
curl -s -X POST http://127.0.0.1:8787/hook -H "Content-Type: application/json" \
  -H "X-Hook-Token: $HOOK_TOKEN" -d '{"action":"BUY_CE","lots":1,"offset":"ATM","reason":"manual test"}'
```

```bash
curl -s http://127.0.0.1:8787/health
```

TradingView alert message (needs the hook reachable from the internet — put it behind HTTPS, e.g. a reverse proxy, and keep the token secret):

```json
{"token": "<HOOK_TOKEN>", "action": "BUY_PE", "lots": 1, "reason": "TV {{ticker}} {{close}}"}
```

**Safety checks on every entry** (exits are never blocked): `DRY_RUN` (default **true** — logs exactly what
would be sent, sends nothing) · kill switch (`data/KILL` file, or `POST /kill`) · market hours · only on
`TRADE_DAYS` (D0, D1) · not after `ENTRY_END` · `MAX_TRADES_PER_DAY` · one open position at a time ·
`lots ≤ MAX_LOTS`. The API key is never written to the database.

## Live trigger rules

* **BUY_CE:** 5m close above the opening-range high, above the average price, EMA9 > EMA21
* **BUY_PE:** the mirror image
* skipped if the playbook says this slot was mostly chop (>60%) in the last 4 weeks
* if the model passed its walk-forward check, also needs P(direction) ≥ `MIN_PROB`
* **Exit:** playbook target / stop in index points, EMA9/21 crossing against the trade (trend shift), or `EXIT_TIME`

The report's **replay** section runs these exact rules over the stored D0/D1 days with modelled premiums.
It is **in-sample** (the playbook was learnt on the same days) and ignores costs and slippage, so treat it as a
sanity check, not expected profit.

## Honest limits

* 4 weeks ≈ 20 sessions, of which only ~4 are D0 and ~4 are D1. That is a small sample: the playbook shows
  what *recently* happened, it does not guarantee the next expiry. That is why the model has to pass a
  walk-forward test before it can gate trades.
* Yahoo data is delayed and occasionally has gaps; for live trading use OpenAlgo data (the default when
  `OPENALGO_API_KEY` works).
* Modelled premiums use one IV for the whole day; real expiry-day IV moves a lot. Run `collect` on D0/D1 so
  real premiums replace modelled ones over the next weeks.
* Start with `DRY_RUN=true`, check `status` and the report for a few expiries before setting it to false.

## Files

```
expiry_lab/
  config.py          settings from .env
  calendar.py        D0/D1 labels, expiry (Thursday + holiday shift), OpenAlgo symbol format
  store.py           SQLite, rolling 28-day prune
  sources.py         OpenAlgo / Yahoo / synthetic data, premium snapshots
  premium.py         Black-Scholes premium model
  analysis.py        trend shifts, slot capture, premium paths, opening range
  learner.py         playbook.json + model.joblib
  charts.py          PNG charts + HTML report
  live.py            trigger rules, replay, live loop
  executor.py        signal → OpenAlgo order with safety checks
  openalgo_client.py REST client (/api/v1/…)
  hook.py            Flask webhook server
tests/test_lab.py
```

Tests: `python -m pytest -q tests`
