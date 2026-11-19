"""Thin REST client for OpenAlgo (https://docs.openalgo.in). Uses /api/v1/* endpoints directly so it does
not depend on a particular SDK version. Every call sends the API key in the JSON body, as OpenAlgo expects."""
from __future__ import annotations

import logging
from datetime import date

import httpx
import pandas as pd

log = logging.getLogger(__name__)
IST = "Asia/Kolkata"


class OpenAlgoError(RuntimeError):
    pass


class OpenAlgo:
    def __init__(self, host: str, api_key: str, timeout: float = 15.0):
        if not api_key:
            raise OpenAlgoError("OPENALGO_API_KEY is not set")
        self.host = host.rstrip("/")
        self.api_key = api_key
        self.http = httpx.Client(timeout=timeout)

    def _post(self, endpoint: str, payload: dict) -> dict:
        body = {"apikey": self.api_key, **payload}
        r = self.http.post(f"{self.host}/api/v1/{endpoint}", json=body)
        try:
            data = r.json()
        except ValueError:
            raise OpenAlgoError(f"{endpoint}: HTTP {r.status_code} {r.text[:200]}") from None
        if r.status_code >= 400 or data.get("status") == "error":
            raise OpenAlgoError(f"{endpoint}: HTTP {r.status_code} {data.get('message', data)}")
        return data

    # ---------- market data ----------
    def history(self, symbol: str, exchange: str, interval: str, start: date, end: date) -> pd.DataFrame:
        data = self._post("history", {"symbol": symbol, "exchange": exchange, "interval": interval,
                                      "start_date": start.isoformat(), "end_date": end.isoformat()})
        rows = data.get("data") or []
        if not rows:
            return pd.DataFrame(columns=["open", "high", "low", "close"])
        df = pd.DataFrame(rows)
        ts = df["timestamp"]
        idx = pd.to_datetime(ts, unit="s", utc=True) if pd.api.types.is_numeric_dtype(ts) else pd.to_datetime(ts, utc=True)
        df.index = pd.DatetimeIndex(idx).tz_convert(IST)
        return df[["open", "high", "low", "close"]].astype(float).sort_index()

    def quote(self, symbol: str, exchange: str) -> dict:
        return self._post("quotes", {"symbol": symbol, "exchange": exchange}).get("data") or {}

    def expiries(self, symbol: str, exchange: str) -> list[str]:
        return self._post("expiry", {"symbol": symbol, "exchange": exchange,
                                     "instrumenttype": "options"}).get("data") or []

    # ---------- orders ----------
    def options_order(self, *, strategy: str, underlying: str, exchange: str, expiry_date: str, offset: str,
                      option_type: str, action: str, quantity: int, product: str) -> dict:
        """OpenAlgo resolves ATM/ITMn/OTMn itself and returns the traded symbol."""
        return self._post("optionsorder", {
            "strategy": strategy, "underlying": underlying, "exchange": exchange, "expiry_date": expiry_date,
            "offset": offset, "option_type": option_type, "action": action, "quantity": str(quantity),
            "pricetype": "MARKET", "product": product, "splitsize": "0"})

    def place_order(self, *, strategy: str, symbol: str, exchange: str, action: str, quantity: int,
                    product: str) -> dict:
        return self._post("placeorder", {
            "strategy": strategy, "symbol": symbol, "exchange": exchange, "action": action,
            "quantity": str(quantity), "pricetype": "MARKET", "product": product,
            "price": "0", "trigger_price": "0", "disclosed_quantity": "0"})

    def close_all(self, strategy: str) -> dict:
        return self._post("closeposition", {"strategy": strategy})
