"""Learning from the rolling 4-week window.

Two outputs, rebuilt every time `learn` runs (so the lab always reflects the latest 4 weeks):

1. playbook.json — plain statistics for D1 and D0 days: when trend shifts happen, how many points each
   time slot offered, how the ATM premium decays, how often an opening-range break follows through,
   and suggested targets / stops derived from what the market actually gave.
2. model.joblib  — a small multinomial logistic regression that predicts, at a slot, whether the index
   moves MOVE_POINTS UP first, DOWN first, or neither (CHOP) within HORIZON_MIN. It is checked
   walk-forward on the most recent week; if it does not beat "always predict the most common label",
   the playbook marks it untrusted and the live engine falls back to rules only.

Four weeks is ~20 sessions (only ~4 D0 + ~4 D1). Treat the numbers as a playbook, not a promise.
"""
from __future__ import annotations

import json
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .analysis import FEATURES, DayAnalysis, slots_frame
from .config import Settings

KIND_WEIGHT = {"D0": 3.0, "D1": 2.0, "OTHER": 1.0}


def _q(s: pd.Series, q: float) -> float:
    s = s.dropna()
    return round(float(s.quantile(q)), 1) if len(s) else 0.0


def kind_playbook(days: list[DayAnalysis], kind: str, move_points: float = 60.0) -> dict:
    sel = [d for d in days if d.kind == kind]
    if not sel:
        return {"n_days": 0}
    slots = slots_frame(sel)
    st = pd.DataFrame([d.stats for d in sel])

    # where trend shifts happen
    pivot_hours: dict[str, int] = {}
    for d in sel:
        for p in d.pivots:
            if p["kind"] != "OPEN" and p["confirmed"] is not None:
                h = p["ts"].strftime("%H:00")
                pivot_hours[h] = pivot_hours.get(h, 0) + 1
    legs = pd.DataFrame([leg for d in sel for leg in d.legs])

    by_slot = []
    for slot, g in slots.groupby("slot"):
        ce_cap = (g["ce_best"] - g["ce_entry"]) / g["ce_entry"].replace(0, np.nan) * 100
        pe_cap = (g["pe_best"] - g["pe_entry"]) / g["pe_entry"].replace(0, np.nan) * 100
        ce_decay = (g["ce_end"] - g["ce_entry"]) / g["ce_entry"].replace(0, np.nan) * 100
        pe_decay = (g["pe_end"] - g["pe_entry"]) / g["pe_entry"].replace(0, np.nan) * 100
        by_slot.append({
            "slot": slot, "n": int(len(g)),
            "p_up": round(float((g["label"] == "UP").mean()), 2),
            "p_down": round(float((g["label"] == "DOWN").mean()), 2),
            "p_chop": round(float((g["label"] == "CHOP").mean()), 2),
            "med_max_up": _q(g["max_up"], 0.5), "med_max_down": _q(g["max_down"], 0.5),
            "med_best_side": _q(np.maximum(g["max_up"], g["max_down"]), 0.5),
            "ce_entry": _q(g["ce_entry"], 0.5), "pe_entry": _q(g["pe_entry"], 0.5),
            "ce_capture_pct": _q(ce_cap, 0.5), "pe_capture_pct": _q(pe_cap, 0.5),
            "ce_hold_pct": _q(ce_decay, 0.5), "pe_hold_pct": _q(pe_decay, 0.5),
        })
    by_slot_df = pd.DataFrame(by_slot)
    by_slot_df["edge"] = (1 - by_slot_df["p_chop"]) * by_slot_df["med_best_side"]
    best = by_slot_df.sort_values("edge", ascending=False).head(4)["slot"].tolist()

    # straddle decay curve (fraction of the day's opening straddle left, by time)
    curves = []
    for d in sel:
        c = d.premiums["atm_straddle"] / d.premiums["atm_straddle"].iloc[0]
        curves.append(c.groupby(c.index.strftime("%H:%M")).last())
    decay = pd.concat(curves, axis=1).median(axis=1).sort_index()
    decay = decay[decay.index.str.endswith(("00", "15", "30", "45"))].round(3)

    moved = slots[slots["label"] != "CHOP"]
    fav = np.where(moved["label"] == "UP", moved["max_up"], moved["max_down"])
    adv = np.where(moved["label"] == "UP", moved["max_down"], moved["max_up"])
    orbs = [d.orb for d in sel if d.orb["break"]]
    return {
        "n_days": len(sel),
        "days": [str(d.day) for d in sel],
        "avg_range": round(float(st["range"].mean()), 1),
        "avg_abs_net": round(float(st["net"].abs().mean()), 1),
        "avg_gap": round(float(st["gap"].mean()), 1),
        "avg_trend_shifts": round(float(st["trend_shifts"].mean()), 1),
        "median_leg_points": _q(legs["points"].abs(), 0.5) if len(legs) else 0.0,
        "median_leg_minutes": _q(legs["minutes"], 0.5) if len(legs) else 0.0,
        "trend_shift_hours": dict(sorted(pivot_hours.items())),
        "straddle_open": round(float(st["straddle_open"].mean()), 1),
        "straddle_left_at": decay.to_dict(),
        "orb": {"breaks": len(orbs),
                "up": sum(o["break"] == "UP" for o in orbs),
                "down": sum(o["break"] == "DOWN" for o in orbs),
                "follow_through_rate": round(float(np.mean([o["follow_through"] for o in orbs])), 2) if orbs else None,
                "median_width": _q(pd.Series([o["or_width"] for o in orbs]), 0.5)},
        "best_slots": best,
        # target = a move that was reached in ~60% of moved slots; stop = typical heat taken, but never
        # tighter than MOVE_POINTS or half the target (expiry noise stops out tight stops)
        "suggested_target_points": max(_q(pd.Series(fav), 0.4), move_points),
        "suggested_stop_points": max(_q(pd.Series(adv), 0.6), move_points,
                                     round(0.5 * max(_q(pd.Series(fav), 0.4), move_points), 1)),
        "slots": by_slot_df.round(2).to_dict(orient="records"),
        "premium_source": sorted(set(st["premium_source"])),
    }


def train_model(slots: pd.DataFrame, test_days: int = 5) -> tuple[object | None, dict]:
    if slots.empty or slots["label"].nunique() < 2:
        return None, {"trained": False, "reason": "not enough labelled data"}
    days = sorted(slots["day"].unique())
    X, y = slots[FEATURES].astype(float).fillna(0), slots["label"]
    w = slots["kind"].map(KIND_WEIGHT).fillna(1.0)

    def fit(idx):
        m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=0.5, class_weight="balanced"))
        m.fit(X[idx], y[idx], logisticregression__sample_weight=w[idx])
        return m

    metrics: dict = {"trained": True, "rows": int(len(slots)), "days": len(days),
                     "label_mix": y.value_counts().to_dict()}
    if len(days) > test_days + 5:
        cut = days[-test_days]
        tr, te = slots["day"] < cut, slots["day"] >= cut
        if y[tr].nunique() >= 2:
            m = fit(tr)
            pred = m.predict(X[te])
            acc = float((pred == y[te]).mean())
            base = float((y[te] == y[tr].value_counts().idxmax()).mean())
            # directional precision: when it says UP/DOWN, how often right
            directional = pred != "CHOP"
            dir_prec = float((pred[directional] == y[te][directional]).mean()) if directional.any() else None
            metrics.update({"test_days": test_days, "test_accuracy": round(acc, 3),
                            "baseline_accuracy": round(base, 3),
                            "directional_precision": round(dir_prec, 3) if dir_prec is not None else None,
                            "trusted": acc > base})
    else:
        metrics.update({"trusted": False, "reason": "fewer than test_days+5 sessions"})
    model = fit(pd.Series(True, index=slots.index))
    return model, metrics


def learn(days: list[DayAnalysis], s: Settings) -> dict:
    slots = slots_frame(days)
    model, metrics = train_model(slots)
    if model is not None:
        joblib.dump({"model": model, "features": FEATURES}, s.model_path)
    playbook = {
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "window": {"from": str(days[0].day) if days else None, "to": str(days[-1].day) if days else None,
                   "sessions": len(days), "retention_days": s.retention_days},
        "params": {"swing_points": s.swing_points, "move_points": s.move_points, "horizon_min": s.horizon_min},
        "D1": kind_playbook(days, "D1", s.move_points),
        "D0": kind_playbook(days, "D0", s.move_points),
        "OTHER": {k: v for k, v in kind_playbook(days, "OTHER", s.move_points).items() if k != "slots"},
        "model": metrics,
    }
    s.playbook_path.write_text(json.dumps(playbook, indent=2, default=str))
    return playbook


def load_model(s: Settings):
    if not s.model_path.exists():
        return None
    return joblib.load(s.model_path)


def load_playbook(s: Settings) -> dict:
    return json.loads(s.playbook_path.read_text()) if s.playbook_path.exists() else {}
