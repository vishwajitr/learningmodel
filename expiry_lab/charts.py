"""Charts (PNG, matplotlib) + one HTML report that ties them together."""
from __future__ import annotations

import html
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from .analysis import DayAnalysis  # noqa: E402

# reference palette (categorical slots 1-3 + neutral)
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
GRAY, INK, INK2, GRID = "#a3a29c", "#0b0b0b", "#52514e", "#e6e5e1"
SURFACE = "#fcfcfb"
CHOP = "#cfcdc6"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.spines.top": False,
    "axes.spines.right": False, "font.size": 9, "axes.titlesize": 10, "axes.titlecolor": INK,
    "lines.linewidth": 2, "legend.frameon": False,
})
HM = mdates.DateFormatter("%H:%M", tz="Asia/Kolkata")


def _pairs(days: list[DayAnalysis]) -> list[tuple[DayAnalysis | None, DayAnalysis | None]]:
    """Group into expiry weeks: (D1, D0)."""
    weeks: dict = {}
    for d in days:
        if d.kind in ("D0", "D1"):
            weeks.setdefault(d.expiry, {})[d.kind] = d
    return [(w.get("D1"), w.get("D0")) for _, w in sorted(weeks.items())]


def chart_paths(days: list[DayAnalysis], out: Path) -> Path | None:
    pairs = _pairs(days)
    if not pairs:
        return None
    fig, axes = plt.subplots(len(pairs), 2, figsize=(13, 3.1 * len(pairs)), squeeze=False)
    for r, pair in enumerate(pairs):
        for c, d in enumerate(pair):
            ax = axes[r][c]
            if d is None:
                ax.axis("off")
                continue
            b = d.bars
            ax.axhspan(b["or_low"].iloc[0], b["or_high"].iloc[0], color=GRID, alpha=0.7, lw=0,
                       label="Opening range")
            ax.plot(b.index, b["close"], color=BLUE, label="SENSEX")
            ax.plot(b.index, b["vwap"], color=GRAY, lw=1.2, ls="--", label="Avg price (VWAP proxy)")
            piv = [p for p in d.pivots if p["kind"] in ("HIGH", "LOW")]
            for p in piv:
                m = "v" if p["kind"] == "HIGH" else "^"
                ax.plot(p["ts"], p["price"], m, color=ORANGE, ms=8, mec=SURFACE, mew=1.5)
            big = sorted(d.legs, key=lambda x: -abs(x["points"]))[:4]
            for leg in big:
                mid = leg["start"] + (leg["end"] - leg["start"]) / 2
                y = b["close"].asof(mid)
                ax.annotate(f"{leg['points']:+.0f}", (mid, y), fontsize=8, color=INK2,
                            xytext=(0, 8), textcoords="offset points", ha="center")
            ax.xaxis.set_major_formatter(HM)
            st = d.stats
            ax.set_title(f"{d.kind} {d.day:%a %d %b}  range {st['range']:.0f}  net {st['net']:+.0f}  "
                         f"shifts {st['trend_shifts']}", loc="left")
            if r == 0 and c == 0:
                ax.legend(loc="upper left", fontsize=8)
    fig.suptitle("Last 4 expiry weeks — index path, trend shifts (▼ swing high ▲ swing low), leg points",
                 x=0.01, ha="left", color=INK, fontsize=12)
    fig.tight_layout()
    p = out / "paths.png"
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return p


def chart_premiums(days: list[DayAnalysis], out: Path) -> Path | None:
    pairs = _pairs(days)
    if not pairs:
        return None
    fig, axes = plt.subplots(len(pairs), 2, figsize=(13, 2.7 * len(pairs)), squeeze=False)
    for r, pair in enumerate(pairs):
        for c, d in enumerate(pair):
            ax = axes[r][c]
            if d is None:
                ax.axis("off")
                continue
            pr = d.premiums
            k = int(pr["strike"].iloc[0])
            ax.plot(pr.index, pr["ce"], color=BLUE, label=f"{k} CE")
            ax.plot(pr.index, pr["pe"], color=ORANGE, label=f"{k} PE")
            ax.plot(pr.index, pr["atm_straddle"], color=AQUA, lw=1.5, label="ATM straddle")
            ax.xaxis.set_major_formatter(HM)
            ax.set_ylabel("Premium ₹")
            ax.set_title(f"{d.kind} {d.day:%a %d %b}  (strike ATM at open, {d.stats['premium_source']} premium)",
                         loc="left")
            ax.legend(loc="upper right", fontsize=8)
    fig.suptitle("Premium through the day — CE vs PE of the opening ATM strike, and the re-centred ATM straddle",
                 x=0.01, ha="left", color=INK, fontsize=12)
    fig.tight_layout()
    p = out / "premiums.png"
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return p


def chart_decay(playbook: dict, out: Path) -> Path | None:
    fig, axes = plt.subplots(1, 2, figsize=(13, 3.6), sharey=True)
    any_ = False
    for ax, kind in zip(axes, ("D1", "D0")):
        curve = playbook.get(kind, {}).get("straddle_left_at") or {}
        if not curve:
            ax.axis("off")
            continue
        any_ = True
        x = list(curve.keys())
        y = [v * 100 for v in curve.values()]
        ax.plot(x, y, color=AQUA, marker="o", ms=4)
        ax.set_ylim(0, max(110, max(y) + 5))
        step = max(1, len(x) // 9)
        ax.set_xticks(x[::step])
        ax.set_ylabel("% of opening straddle left")
        ax.set_title(f"{kind}: ATM straddle decay (median of {playbook[kind]['n_days']} days, "
                     f"opens ≈ ₹{playbook[kind]['straddle_open']:.0f})", loc="left")
        ax.annotate(f"{y[-1]:.0f}%", (x[-1], y[-1]), xytext=(4, 4), textcoords="offset points", color=INK2)
    fig.tight_layout()
    p = out / "decay.png"
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return p if any_ else None


def chart_capture(playbook: dict, out: Path) -> Path | None:
    kinds = [k for k in ("D1", "D0") if playbook.get(k, {}).get("slots")]
    if not kinds:
        return None
    fig, axes = plt.subplots(3, len(kinds), figsize=(6.6 * len(kinds), 9.5), squeeze=False)
    for c, kind in enumerate(kinds):
        df = pd.DataFrame(playbook[kind]["slots"])
        x = np.arange(len(df))
        w = 0.38
        a = axes[0][c]
        a.bar(x - w / 2 - 0.01, df["med_max_up"], w, color=BLUE, label="Up (CE side)")
        a.bar(x + w / 2 + 0.01, df["med_max_down"], w, color=ORANGE, label="Down (PE side)")
        a.set_title(f"{kind}: median points available in next {playbook['params']['horizon_min']} min",
                    loc="left")
        a.set_ylabel("Index points")
        a.legend(fontsize=8, ncol=2, loc="lower right", bbox_to_anchor=(1, 1))
        b = axes[1][c]
        b.bar(x, df["p_up"], 0.8, color=BLUE, label="Up first")
        b.bar(x, df["p_down"], 0.8, bottom=df["p_up"], color=ORANGE, label="Down first", edgecolor=SURFACE, lw=1)
        b.bar(x, df["p_chop"], 0.8, bottom=df["p_up"] + df["p_down"], color=CHOP, label="Chop",
              edgecolor=SURFACE, lw=1)
        b.set_ylim(0, 1)
        b.set_title(f"{kind}: which side moved {playbook['params']['move_points']:.0f} pts first", loc="left")
        b.legend(fontsize=8, ncol=3, loc="lower right", bbox_to_anchor=(1, 1))
        d = axes[2][c]
        d.bar(x - w / 2 - 0.01, df["ce_capture_pct"], w, color=BLUE, label="ATM CE best")
        d.bar(x + w / 2 + 0.01, df["pe_capture_pct"], w, color=ORANGE, label="ATM PE best")
        d.set_title(f"{kind}: median best premium gain % from slot", loc="left")
        d.set_ylabel("% of entry premium")
        d.legend(fontsize=8, ncol=2, loc="lower right", bbox_to_anchor=(1, 1))
        for ax in (a, b, d):
            ax.set_xticks(x)
            ax.set_xticklabels(df["slot"], rotation=45)
        for s_ in playbook[kind].get("best_slots", []):
            if s_ in list(df["slot"]):
                i = list(df["slot"]).index(s_)
                a.annotate("★", (i, max(df["med_max_up"][i], df["med_max_down"][i])), ha="center",
                           xytext=(0, 3), textcoords="offset points", color=INK)
    fig.tight_layout()
    p = out / "capture.png"
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return p


def chart_shift_hours(playbook: dict, out: Path) -> Path | None:
    hours = [f"{h:02d}:00" for h in range(9, 16)]
    fig, ax = plt.subplots(figsize=(8, 3.2))
    x = np.arange(len(hours))
    w = 0.38
    ok = False
    for i, (kind, col) in enumerate((("D1", BLUE), ("D0", ORANGE))):
        hh = playbook.get(kind, {}).get("trend_shift_hours") or {}
        n = max(playbook.get(kind, {}).get("n_days", 0), 1)
        if hh:
            ok = True
        ax.bar(x + (i - 0.5) * (w + 0.02), [hh.get(h, 0) / n for h in hours], w, color=col, label=kind)
    ax.set_xticks(x)
    ax.set_xticklabels(hours)
    ax.set_ylabel("Trend shifts per day")
    ax.set_title("When trend shifts happen (confirmed swing reversals by hour)", loc="left")
    ax.legend()
    fig.tight_layout()
    p = out / "shift_hours.png"
    fig.savefig(p, dpi=110)
    plt.close(fig)
    return p if ok else None


def _table(rows: list[dict], cols: list[str]) -> str:
    head = "".join(f"<th>{html.escape(c)}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(r.get(c, '')))}</td>" for c in cols) + "</tr>"
                   for r in rows)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def build_report(days: list[DayAnalysis], playbook: dict, out: Path, trades: list[dict] | None = None) -> Path:
    imgs = [chart_paths(days, out), chart_premiums(days, out), chart_decay(playbook, out),
            chart_capture(playbook, out), chart_shift_hours(playbook, out)]
    day_rows = [{"date": str(d.day), "type": d.kind, "expiry": str(d.expiry), **{k: d.stats[k] for k in (
        "gap", "range", "net", "trend_shifts", "biggest_leg", "straddle_open", "straddle_close",
        "premium_source")}, "orb": f"{d.orb['break'] or '-'} {d.orb['time'] or ''} "
                                   f"{'✓' if d.orb['follow_through'] else '✗' if d.orb['break'] else ''}"}
                for d in days if d.kind in ("D0", "D1")]
    summary = []
    for kind in ("D1", "D0"):
        k = playbook.get(kind, {})
        if not k.get("n_days"):
            continue
        summary.append({"day": kind, "days": k["n_days"], "avg range": k["avg_range"],
                        "avg |net|": k["avg_abs_net"], "trend shifts/day": k["avg_trend_shifts"],
                        "median leg pts": k["median_leg_points"], "median leg min": k["median_leg_minutes"],
                        "ORB follow-through": k["orb"]["follow_through_rate"],
                        "best slots": ", ".join(k["best_slots"]),
                        "target pts": k["suggested_target_points"], "stop pts": k["suggested_stop_points"]})
    model = playbook.get("model", {})
    trades = trades or []
    tcols = ["day", "kind", "action", "entry", "exit", "entry_spot", "points", "strike", "entry_prem",
             "exit_prem", "prem_pnl", "rupees", "exit_reason"]
    if trades:
        tp = pd.DataFrame(trades)
        wins = int((tp["points"] > 0).sum())
        trade_sum = (f"<p>{len(tp)} trades · {wins} winners · {tp['points'].sum():+.0f} index pts · "
                     f"premium {tp['prem_pnl'].sum():+.0f} ₹/unit · ₹{tp['rupees'].sum():+,.0f} total "
                     f"(modelled premium, before costs; in-sample — the rules/model were learnt on these days)</p>")
    else:
        trade_sum = "<p class='muted'>No trigger fired on the stored D0/D1 days.</p>"
    imgs_html = "".join(f'<img src="{p.name}" alt="{p.stem}">' for p in imgs if p)
    page = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>SENSEX expiry lab</title>
<style>
body{{font:14px/1.45 system-ui,sans-serif;background:{SURFACE};color:{INK};max-width:1400px;margin:24px auto;padding:0 16px}}
h1{{font-size:22px}} h2{{font-size:17px;margin-top:28px}} .muted{{color:{INK2}}}
table{{border-collapse:collapse;margin:8px 0;font-size:13px}} th,td{{padding:4px 10px;border-bottom:1px solid {GRID};text-align:right}}
th{{color:{INK2};font-weight:600}} td:first-child,th:first-child{{text-align:left}}
img{{max-width:100%;display:block;margin:14px 0;border:1px solid {GRID}}}
pre{{background:#f3f2ef;padding:10px;overflow:auto}}
</style></head><body>
<h1>SENSEX expiry lab — D1 (day before) &amp; D0 (expiry day)</h1>
<p class="muted">Window {playbook['window']['from']} → {playbook['window']['to']} ·
{playbook['window']['sessions']} sessions · built {playbook['built_at']} ·
swing {playbook['params']['swing_points']:.0f} pts · move {playbook['params']['move_points']:.0f} pts ·
horizon {playbook['params']['horizon_min']} min</p>
<h2>What the last 4 weeks say</h2>{_table(summary, list(summary[0].keys()) if summary else [])}
<h2>Model check (walk-forward on the latest week)</h2><pre>{html.escape(json.dumps(model, indent=2, default=str))}</pre>
<h2>Replay of the trigger on these D0/D1 days</h2>{trade_sum}{_table(trades, tcols) if trades else ""}
<h2>Day by day</h2>{_table(day_rows, list(day_rows[0].keys()) if day_rows else [])}
<h2>Charts</h2>{imgs_html}
<p class="muted">Premium marked "model" is rebuilt with Black-Scholes from the index path and the previous
day's India VIX; "real" comes from OpenAlgo/recorded quotes. Run <code>collect</code> on D0/D1 to build real
premium history.</p>
</body></html>"""
    p = out / "index.html"
    p.write_text(page, encoding="utf-8")
    return p
