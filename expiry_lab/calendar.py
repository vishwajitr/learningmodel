"""SENSEX weekly expiry calendar and day labels.

D0 = expiry day, D1 = the trading day before expiry, OTHER = any other trading day.
If the expiry weekday is a holiday, expiry moves to the previous trading day.
OpenAlgo's expiry list (when reachable) overrides this rule.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def is_trading_day(d: date, holidays: list[date]) -> bool:
    return d.weekday() < 5 and d not in holidays


def prev_trading_day(d: date, holidays: list[date]) -> date:
    d -= timedelta(days=1)
    while not is_trading_day(d, holidays):
        d -= timedelta(days=1)
    return d


def expiry_for_week(d: date, weekday: int, holidays: list[date]) -> date:
    """Expiry of the week containing d (rule based)."""
    e = d - timedelta(days=d.weekday()) + timedelta(days=weekday)
    while not is_trading_day(e, holidays):
        e -= timedelta(days=1)
    return e


def next_expiry(d: date, weekday: int, holidays: list[date], known: list[date] | None = None) -> date:
    """First expiry on or after d."""
    if known:
        future = sorted(x for x in known if x >= d)
        if future:
            return future[0]
    e = expiry_for_week(d, weekday, holidays)
    if e < d:
        e = expiry_for_week(d + timedelta(days=7), weekday, holidays)
    return e


def day_type(d: date, weekday: int, holidays: list[date], known: list[date] | None = None) -> str:
    if not is_trading_day(d, holidays):
        return "HOLIDAY"
    e = next_expiry(d, weekday, holidays, known)
    if d == e:
        return "D0"
    if prev_trading_day(e, holidays) == d:
        return "D1"
    return "OTHER"


def openalgo_expiry_str(e: date) -> str:
    """OpenAlgo expiry format, e.g. 20NOV25."""
    return f"{e.day:02d}{MONTHS[e.month - 1]}{e.year % 100:02d}"


def option_symbol(underlying: str, e: date, strike: int, opt: str) -> str:
    """OpenAlgo option symbol, e.g. SENSEX20NOV2584500CE."""
    return f"{underlying}{openalgo_expiry_str(e)}{int(strike)}{opt.upper()}"


def parse_expiry_list(items: list[str]) -> list[date]:
    out = []
    for s in items:
        s = s.strip().upper()
        for fmt in ("%d-%b-%y", "%d%b%y", "%d-%b-%Y", "%Y-%m-%d"):
            try:
                out.append(datetime.strptime(s.title() if "-" in s else s, fmt).date())
                break
            except ValueError:
                continue
    return sorted(set(out))
