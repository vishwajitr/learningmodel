"""All settings, loaded from .env / environment and validated by Pydantic."""
from __future__ import annotations

from datetime import time
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Claude ---
    anthropic_api_key: SecretStr = Field(default=SecretStr(""), alias="ANTHROPIC_API_KEY")
    claude_model: str = "claude-sonnet-5-5"
    claude_enabled: bool = True
    # ML and Claude must agree before an alert goes out (False = Claude's view is just added to the alert)
    require_claude_agreement: bool = True

    # --- Telegram ---
    telegram_bot_token: SecretStr = Field(default=SecretStr(""), alias="TELEGRAM_BOT_TOKEN")
    telegram_chat_id: str = Field(default="", alias="TELEGRAM_CHAT_ID")
    telegram_dry_run: bool = False  # True = print alerts instead of sending

    # --- OpenAlgo ---
    openalgo_api_key: SecretStr = Field(default=SecretStr(""), alias="OPENALGO_API_KEY")
    openalgo_host: str = "http://127.0.0.1:5000"
    openalgo_ws_url: str = "ws://127.0.0.1:8765"

    # --- Instrument ---
    underlying: str = "SENSEX"
    index_exchange: str = "BSE_INDEX"
    options_exchange: str = "BFO"
    strike_step: int = 100
    lot_size: int = 20                      # check optionsymbol() response; it overrides this when live
    lots: int = 1
    expiry_weekday: int = 3                 # Mon=0 … Thu=3. Fallback only; real dates come from OpenAlgo expiry()
    holidays: Annotated[list[str], NoDecode] = Field(default_factory=list)  # "YYYY-MM-DD", used only for the fallback calendar

    # --- Strategy / labels (index points) ---
    interval: Literal["1m", "3m", "5m", "15m"] = "5m"
    decision_times: Annotated[list[time], NoDecode] = Field(
        default_factory=lambda: [time(9, 45), time(10, 15), time(10, 45), time(11, 30), time(12, 30), time(13, 30)]
    )
    exit_time: time = time(15, 15)
    max_alerts_per_day: int = 2
    send_skip_alerts: bool = False          # also post "no trade" updates at each decision time
    target_points_d0: float = 200.0
    stop_points_d0: float = 120.0
    target_points_d1: float = 250.0
    stop_points_d1: float = 150.0

    # --- Model ---
    min_confidence: float = 0.55            # min ML probability for CE/PE
    bucket_weight: float = 3.0              # sample weight for rows of the model's own bucket (D+0 or D+1)
    history_days: int = 365
    data_dir: Path = Path("data")
    model_dir: Path = Path("models")
    db_path: Path = Path("data/journal.sqlite")

    @field_validator("decision_times", mode="before")
    @classmethod
    def _parse_times(cls, v):
        if isinstance(v, str):
            v = [s.strip() for s in v.split(",") if s.strip()]
        return [time.fromisoformat(x) if isinstance(x, str) else x for x in v]

    @field_validator("holidays", mode="before")
    @classmethod
    def _parse_holidays(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    def target_stop(self, dte: int) -> tuple[float, float]:
        if dte == 0:
            return self.target_points_d0, self.stop_points_d0
        return self.target_points_d1, self.stop_points_d1


def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.model_dir.mkdir(parents=True, exist_ok=True)
    return s
