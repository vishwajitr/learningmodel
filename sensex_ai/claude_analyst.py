"""Claude as a second opinion. Output is forced into the ClaudeVerdict Pydantic schema via tool use."""
from __future__ import annotations

import json
import logging

import pandas as pd
from anthropic import Anthropic
from pydantic import ValidationError

from .config import Settings
from .schemas import ClaudeVerdict, FeatureRow, MLPrediction

log = logging.getLogger(__name__)

SYSTEM = """You are a disciplined intraday options analyst for the BSE SENSEX weekly expiry.
The trader is an option BUYER only: BUY_CE on bullish setups, BUY_PE on bearish setups, otherwise SKIP.
D0 = expiry day (fast theta decay, gamma spikes, premiums can go to zero by close).
D1 = one trading day before expiry.
You receive engineered features, a machine-learning model's class probabilities and its historical
walk-forward stats, and the recent 5-minute candles. Be sceptical: SKIP when the edge is weak, the move
is already extended, or it's late in the session on D0. Never invent data you weren't given."""

TOOL = {
    "name": "submit_verdict",
    "description": "Submit the trade verdict.",
    "input_schema": ClaudeVerdict.model_json_schema(),
}


class ClaudeAnalyst:
    def __init__(self, s: Settings):
        self.s = s
        self.client = Anthropic(api_key=s.anthropic_api_key.get_secret_value())

    def review(self, *, bucket: str, spot: float, features: FeatureRow, ml: MLPrediction,
               model_stats: dict, recent: pd.DataFrame, target: float, stop: float,
               option_ltps: dict[str, float | None] | None = None) -> ClaudeVerdict | None:
        candles = recent.tail(15).reset_index()
        candles["timestamp"] = candles["timestamp"].dt.strftime("%H:%M")
        payload = {
            "bucket": bucket,
            "spot": round(spot, 2),
            "plan": {"target_points": target, "stop_points": stop, "exit_by": self.s.exit_time.isoformat("minutes")},
            "features": {k: round(v, 4) if isinstance(v, float) else v for k, v in features.model_dump().items()},
            "ml_model": {"signal": ml.signal.value, "p_ce": round(ml.p_ce, 3), "p_pe": round(ml.p_pe, 3),
                         "p_skip": round(ml.p_skip, 3), "walk_forward": model_stats.get("walk_forward", {})},
            "atm_option_ltp": option_ltps or {},
            "last_15_candles": candles.round(2).to_dict(orient="records"),
        }
        msg = [{"role": "user", "content": "Review this setup and submit your verdict.\n\n" + json.dumps(payload, default=str)}]
        for attempt in range(2):
            try:
                resp = self.client.messages.create(
                    model=self.s.claude_model, max_tokens=800, system=SYSTEM, messages=msg,
                    tools=[TOOL], tool_choice={"type": "tool", "name": "submit_verdict"},
                )
                block = next(b for b in resp.content if b.type == "tool_use")
                return ClaudeVerdict.model_validate(block.input)
            except ValidationError as e:
                log.warning("Claude output failed validation (attempt %d): %s", attempt + 1, e)
            except Exception as e:  # noqa: BLE001 — network/API errors shouldn't kill the bot
                log.error("Claude call failed: %s", e)
                return None
        return None
