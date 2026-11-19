"""Option premium model (Black-Scholes) used when real premium history is not available.

Free sources rarely have intraday premium history for expired weekly contracts, so for those days the
lab rebuilds the ATM CE/PE premium path from the index path + India VIX. Real premiums (recorded by
`collect` or fetched from OpenAlgo) always win over modelled ones; every row says which it is.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import pandas as pd

YEAR_MIN = 365 * 24 * 60


def _ncdf(x):
    return 0.5 * (1.0 + np.vectorize(math.erf)(np.asarray(x, dtype=float) / math.sqrt(2.0)))


def bs_price(spot, strike, t_years, iv, r, opt: str):
    spot, strike = np.asarray(spot, float), np.asarray(strike, float)
    t = np.maximum(np.asarray(t_years, float), 1.0 / YEAR_MIN)  # at least 1 minute
    sig = np.maximum(iv, 1e-4) * np.sqrt(t)
    d1 = (np.log(spot / strike) + (r + 0.5 * iv * iv) * t) / sig
    d2 = d1 - sig
    if opt.upper() == "CE":
        p = spot * _ncdf(d1) - strike * np.exp(-r * t) * _ncdf(d2)
        intrinsic = np.maximum(spot - strike, 0)
    else:
        p = strike * np.exp(-r * t) * _ncdf(-d2) - spot * _ncdf(-d1)
        intrinsic = np.maximum(strike - spot, 0)
    return np.maximum(p, intrinsic)


def years_to_expiry(ts: pd.DatetimeIndex, expiry_close: datetime) -> np.ndarray:
    mins = (pd.Timestamp(expiry_close) - ts).total_seconds() / 60.0
    return np.maximum(np.asarray(mins, float), 1.0) / YEAR_MIN


def model_day_premiums(day: pd.DataFrame, expiry_close: datetime, strike_step: int, vix: float,
                       iv_mult: float, r: float) -> pd.DataFrame:
    """Premium path for the strike that was ATM at the open (what a buyer at 09:15 would hold),
    plus the always-ATM straddle (re-centred every bar) which shows pure time decay."""
    iv = vix / 100.0 * iv_mult
    spot = day["close"].to_numpy()
    t = years_to_expiry(day.index, expiry_close)
    k0 = round(day["open"].iloc[0] / strike_step) * strike_step
    k_live = np.round(spot / strike_step) * strike_step
    out = pd.DataFrame(index=day.index)
    out["strike"] = k0
    out["ce"] = bs_price(spot, k0, t, iv, r, "CE")
    out["pe"] = bs_price(spot, k0, t, iv, r, "PE")
    out["atm_straddle"] = bs_price(spot, k_live, t, iv, r, "CE") + bs_price(spot, k_live, t, iv, r, "PE")
    out["source"] = "model"
    return out.round(2)
