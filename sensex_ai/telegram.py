"""Telegram alerts via the Bot API."""
from __future__ import annotations

import html
import logging

import httpx

from .config import Settings
from .schemas import Signal, TradeAlert

log = logging.getLogger(__name__)


class Telegram:
    def __init__(self, s: Settings):
        self.s = s

    def send(self, text: str) -> bool:
        if self.s.telegram_dry_run or not self.s.telegram_bot_token.get_secret_value():
            print("\n[TELEGRAM DRY-RUN]\n" + text + "\n")
            return True
        url = f"https://api.telegram.org/bot{self.s.telegram_bot_token.get_secret_value()}/sendMessage"
        try:
            r = httpx.post(url, json={"chat_id": self.s.telegram_chat_id, "text": text,
                                      "parse_mode": "HTML", "disable_web_page_preview": True}, timeout=15)
            r.raise_for_status()
            return True
        except Exception as e:  # noqa: BLE001
            log.error("Telegram send failed: %s", e)
            return False


def format_alert(a: TradeAlert) -> str:
    icon = {Signal.BUY_CE: "🟢", Signal.BUY_PE: "🔴", Signal.SKIP: "⚪"}[a.final_signal]
    side = {"BUY_CE": "BUY CALL (CE)", "BUY_PE": "BUY PUT (PE)", "SKIP": "NO TRADE"}[a.final_signal.value]
    day = "Expiry day (D+0)" if a.bucket == "D0" else "Day before expiry (D+1)"
    lines = [
        f"{icon} <b>SENSEX {side}</b>",
        f"{day} · expiry {a.expiry:%d %b %Y} · {a.ts:%H:%M}",
        f"Spot: <b>{a.spot:,.2f}</b>",
    ]
    if a.final_signal != Signal.SKIP:
        sgn = 1 if a.final_signal == Signal.BUY_CE else -1
        lines += [
            f"Index target: {a.spot + sgn * a.target_pts:,.0f} ({sgn * a.target_pts:+.0f} pts)",
            f"Index stop: {a.spot - sgn * a.stop_pts:,.0f} ({-sgn * a.stop_pts:+.0f} pts)",
        ]
        if a.option_symbol:
            ltp = f" @ ₹{a.option_ltp:.2f}" if a.option_ltp else ""
            lines.append(f"Option: <code>{html.escape(a.option_symbol)}</code>{ltp} · qty {a.qty}")
    lines.append(f"\n🤖 ML: {a.ml.signal.value} · CE {a.ml.p_ce:.0%} / PE {a.ml.p_pe:.0%} / skip {a.ml.p_skip:.0%}")
    if a.claude:
        lines += [
            f"🧠 Claude: {a.claude.action.value} ({a.claude.confidence}%) · {a.claude.strike_offset}",
            f"<i>{html.escape(a.claude.reasoning)}</i>",
            f"⚠️ {html.escape(a.claude.risk_notes)}",
        ]
    lines.append("\n<i>Not advice. Paper-trade before going live.</i>")
    return "\n".join(lines)
