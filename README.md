# SENSEX Expiry AI — D+0 / D+1 option-buying alerts

ML model + Claude second opinion + Telegram alerts for SENSEX weekly expiry, on OpenAlgo.
**Buy-only** (CE on bullish, PE on bearish). Alerts only — no orders are placed.

- **D+0** = expiry day · **D+1** = the trading day before expiry
- Real expiry dates come from OpenAlgo `expiry()`, so holiday shifts are handled. The `EXPIRY_WEEKDAY` + `HOLIDAYS` rule is a fallback.

## How it works

```
OpenAlgo 5m candles ──► features (up to decision time, no look-ahead)
                         │
                         ▼
        D0 model / D1 model (HistGradientBoosting, P(CE) P(PE) P(SKIP))
                         │ only if ML says CE/PE
                         ▼
        Claude (tool-use → Pydantic ClaudeVerdict: action, confidence, strike, reasoning, risk)
                         │ must agree (REQUIRE_CLAUDE_AGREEMENT)
                         ▼
        ATM/OTM option symbol + LTP via optionsymbol()/quotes()  ──►  Telegram alert
                         │
        15:20 EOD: score each alert (TARGET / STOP / TIME_EXIT) → SQLite journal → Telegram report
        Nightly `update`: refetch data + retrain = the model keeps learning
```

**Labels (option-buyer view):** from each decision time (09:45, 10:15, 10:45, 11:30, 12:30, 13:30),
`BUY_CE` if the index goes up by the target before it falls by the stop, `BUY_PE` for the reverse, otherwise `SKIP`. Exit 15:15.
Defaults: D0 +200/−120 pts, D1 +250/−150 pts.

**Training:** every trading day goes into the dataset, with `dte` as a feature. Each bucket's model gives
its own days 3× weight (`BUCKET_WEIGHT`), so ~50 expiry days a year still get a usable model.
Results are checked with an expanding walk-forward split by date, scored only on that bucket's days.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env        # fill in ANTHROPIC_API_KEY, TELEGRAM_*, OPENALGO_API_KEY

python -m sensex_ai.cli test-telegram
python -m sensex_ai.cli fetch               # 1 year of 5m SENSEX → data/SENSEX_5m.csv
python -m sensex_ai.cli train               # prints walk-forward stats for D0 and D1
python -m sensex_ai.cli replay --date 2026-11-13            # replay a past D0/D1 day (uses Claude)
python -m sensex_ai.cli replay --date 2026-11-13 --no-claude
python -m sensex_ai.cli run                 # live; exits at once if today isn't D0/D1
```

Offline test with no keys at all: `TELEGRAM_DRY_RUN=true python -m sensex_ai.cli train --synthetic`.

## Full auto mode (recommended)

One process does everything; no cron needed:

```bash
python -m sensex_ai.cli auto          # or:  docker compose up -d --build
```

- On first start: fetches 1 year of data and trains both models if none exist.
- Weekdays 09:05 IST: runs the day (silently does nothing unless today is D+0/D+1), alerts, 15:20 EOD report.
- Weekdays 19:30 IST: refetch + retrain (continuous learning).
- Errors go to Telegram and the loop keeps going; `data/scheduler_state.json` stops jobs repeating after a restart.
- Docker: set `OPENALGO_HOST=http://host.docker.internal:5000` in `.env`. Needs an always-on machine/VPS
  that can reach your OpenAlgo (and the broker must be logged in each day).
- Tests: `python -m pytest tests`

## Schedule (cron alternative)

```cron
# live scan every weekday at 09:10 (exits on non-D0/D1 days)
10 9 * * 1-5  cd /path/sensex_expiry_ai && python -m sensex_ai.cli run    >> logs/run.log 2>&1
# nightly learning: refresh data + retrain
30 19 * * 1-5 cd /path/sensex_expiry_ai && python -m sensex_ai.cli update >> logs/update.log 2>&1
```

## Tuning knobs (.env)

| Setting | Effect |
|---|---|
| `MIN_CONFIDENCE` | Higher = fewer, stronger ML calls |
| `REQUIRE_CLAUDE_AGREEMENT` | `false` = Claude only comments, ML decides |
| `TARGET/STOP_POINTS_D0/D1` | Changes the labels → retrain after changing |
| `DECISION_TIMES` | Changes the scan slots and training rows → retrain |
| `MAX_ALERTS_PER_DAY` | Cap; the same side is never alerted twice in a day |
| `SEND_SKIP_ALERTS` | Also post "no trade" at each slot |

## Files

```
sensex_ai/
  config.py          Pydantic Settings (.env)
  schemas.py         FeatureRow, MLPrediction, ClaudeVerdict, TradeAlert
  expiry.py          D0/D1 calendar, holiday shift, DDMMMYY formatting
  data.py            OpenAlgo history/expiry/option quotes + CSV cache + synthetic data
  features.py        features + option-buyer labels
  model.py           training, walk-forward, Predictor
  claude_analyst.py  Claude review, forced tool-use → validated ClaudeVerdict
  engine.py          one decision step + outcome scoring
  telegram.py        Bot API sender + alert format
  journal.py         SQLite log of alerts/outcomes
  live.py            live day runner + EOD report
  cli.py             commands
```

## Caveats
- Labels are on **index points**, not premium. On D0 a 200-pt move can still lose money if it comes late
  (theta) or IV crushes. Check `option_ltp` in alerts against outcomes in `data/journal.sqlite`.
- Don't trust the synthetic-data numbers; they only show the pipeline runs. Use the `train` output on real data.
- Confirm SENSEX lot size: `optionsymbol()` overrides `LOT_SIZE` when live.
- Paper-trade for several expiries before trading real money on any alert.
