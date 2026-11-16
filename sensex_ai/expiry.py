"""Expiry calendar: works out whether a trading day is D+0 (expiry day) or D+1 (one trading day before)."""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from .config import Settings


class ExpiryCalendar:
    def __init__(self, settings: Settings, expiries: list[date] | None = None):
        self.s = settings
        self.holidays = {date.fromisoformat(h) for h in settings.holidays}
        self._expiries = sorted(set(expiries)) if expiries else None

    # ---- trading days ----
    def is_trading_day(self, d: date) -> bool:
        return d.weekday() < 5 and d not in self.holidays

    def next_trading_day(self, d: date) -> date:
        d += timedelta(days=1)
        while not self.is_trading_day(d):
            d += timedelta(days=1)
        return d

    def prev_trading_day(self, d: date) -> date:
        d -= timedelta(days=1)
        while not self.is_trading_day(d):
            d -= timedelta(days=1)
        return d

    # ---- expiries ----
    def _rule_expiry_on_or_after(self, d: date) -> date:
        """Weekly expiry by weekday rule; if that day is a holiday, expiry moves to the previous trading day."""
        ahead = (self.s.expiry_weekday - d.weekday()) % 7
        exp = d + timedelta(days=ahead)
        while not self.is_trading_day(exp):
            exp -= timedelta(days=1)
        if exp < d:  # holiday shift moved it before d → use next week's
            return self._rule_expiry_on_or_after(d + timedelta(days=ahead + 1))
        return exp

    def next_expiry(self, d: date) -> date:
        if self._expiries:
            for e in self._expiries:
                if e >= d:
                    return e
        return self._rule_expiry_on_or_after(d)

    def dte(self, d: date) -> int:
        """Trading days to expiry (0 = expiry day)."""
        exp = self.next_expiry(d)
        n, cur = 0, d
        while cur < exp:
            cur = self.next_trading_day(cur)
            n += 1
        return n

    def bucket(self, d: date) -> str | None:
        n = self.dte(d)
        return {0: "D0", 1: "D1"}.get(n)


def parse_expiry_list(raw: list) -> list[date]:
    """OpenAlgo expiry() returns strings like '20-NOV-25' / '20NOV25' / '2025-11-20'."""
    out = []
    for x in raw:
        for fmt in ("%d-%b-%y", "%d%b%y", "%Y-%m-%d", "%d-%b-%Y"):
            try:
                out.append(pd.to_datetime(str(x).upper(), format=fmt).date())
                break
            except (ValueError, TypeError):
                continue
    return sorted(set(out))


def fmt_expiry(d: date) -> str:
    """DDMMMYY, as OpenAlgo option endpoints expect (e.g. 20NOV25)."""
    return d.strftime("%d%b%y").upper()
