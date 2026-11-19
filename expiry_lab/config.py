"""All settings come from environment variables (or a .env file). See .env.example."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, time
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # dotenv is optional
    pass


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def _bool(name: str, default: bool) -> bool:
    return _env(name, str(default)).lower() in {"1", "true", "yes", "on"}


def _time(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def _dates(s: str) -> list[date]:
    return [date.fromisoformat(x.strip()) for x in s.split(",") if x.strip()]


@dataclass
class Settings:
    # ---- storage / learning window ----
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "data")))
    retention_days: int = field(default_factory=lambda: int(_env("RETENTION_DAYS", "28")))  # 4 weeks
    data_source: str = field(default_factory=lambda: _env("DATA_SOURCE", "auto"))  # auto|openalgo|yahoo|synthetic

    # ---- instrument ----
    underlying: str = field(default_factory=lambda: _env("UNDERLYING", "SENSEX"))
    index_exchange: str = field(default_factory=lambda: _env("INDEX_EXCHANGE", "BSE_INDEX"))
    options_exchange: str = field(default_factory=lambda: _env("OPTIONS_EXCHANGE", "BFO"))
    yahoo_symbol: str = field(default_factory=lambda: _env("YAHOO_SYMBOL", "^BSESN"))
    yahoo_vix_symbol: str = field(default_factory=lambda: _env("YAHOO_VIX_SYMBOL", "^INDIAVIX"))
    strike_step: int = field(default_factory=lambda: int(_env("STRIKE_STEP", "100")))
    lot_size: int = field(default_factory=lambda: int(_env("LOT_SIZE", "20")))
    expiry_weekday: int = field(default_factory=lambda: int(_env("EXPIRY_WEEKDAY", "3")))  # Mon=0 … Thu=3
    holidays: list[date] = field(default_factory=lambda: _dates(_env("HOLIDAYS", "")))

    # ---- analysis ----
    interval_min: int = field(default_factory=lambda: int(_env("INTERVAL_MIN", "5")))
    swing_points: float = field(default_factory=lambda: float(_env("SWING_POINTS", "150")))  # trend-shift threshold
    move_points: float = field(default_factory=lambda: float(_env("MOVE_POINTS", "60")))  # below this = chop
    horizon_min: int = field(default_factory=lambda: int(_env("HORIZON_MIN", "60")))
    risk_free: float = field(default_factory=lambda: float(_env("RISK_FREE", "0.065")))
    iv_mult_d0: float = field(default_factory=lambda: float(_env("IV_MULT_D0", "1.15")))
    iv_mult_d1: float = field(default_factory=lambda: float(_env("IV_MULT_D1", "1.05")))
    default_vix: float = field(default_factory=lambda: float(_env("DEFAULT_VIX", "13")))

    # ---- live trigger ----
    opening_range_min: int = field(default_factory=lambda: int(_env("OPENING_RANGE_MIN", "15")))
    entry_start: time = field(default_factory=lambda: _time(_env("ENTRY_START", "09:35")))
    entry_end: time = field(default_factory=lambda: _time(_env("ENTRY_END", "14:30")))
    exit_time: time = field(default_factory=lambda: _time(_env("EXIT_TIME", "15:10")))
    min_prob: float = field(default_factory=lambda: float(_env("MIN_PROB", "0.55")))
    max_trades_per_day: int = field(default_factory=lambda: int(_env("MAX_TRADES_PER_DAY", "2")))
    lots: int = field(default_factory=lambda: int(_env("LOTS", "1")))
    option_offset: str = field(default_factory=lambda: _env("OPTION_OFFSET", "ATM"))
    poll_seconds: int = field(default_factory=lambda: int(_env("POLL_SECONDS", "30")))
    trade_days: str = field(default_factory=lambda: _env("TRADE_DAYS", "D0,D1"))

    # ---- OpenAlgo + hook ----
    openalgo_host: str = field(default_factory=lambda: _env("OPENALGO_HOST", "http://127.0.0.1:5000"))
    openalgo_api_key: str = field(default_factory=lambda: _env("OPENALGO_API_KEY", ""))
    strategy_name: str = field(default_factory=lambda: _env("STRATEGY_NAME", "sensex_expiry_lab"))
    product: str = field(default_factory=lambda: _env("PRODUCT", "MIS"))
    hook_host: str = field(default_factory=lambda: _env("HOOK_HOST", "127.0.0.1"))
    hook_port: int = field(default_factory=lambda: int(_env("HOOK_PORT", "8787")))
    hook_token: str = field(default_factory=lambda: _env("HOOK_TOKEN", ""))
    hook_url: str = field(default_factory=lambda: _env("HOOK_URL", ""))  # where the live engine posts signals
    dry_run: bool = field(default_factory=lambda: _bool("DRY_RUN", True))  # True = never send real orders
    max_lots: int = field(default_factory=lambda: int(_env("MAX_LOTS", "2")))

    def __post_init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "expiry_lab.sqlite"

    @property
    def report_dir(self) -> Path:
        p = self.data_dir / "report"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def playbook_path(self) -> Path:
        return self.data_dir / "playbook.json"

    @property
    def model_path(self) -> Path:
        return self.data_dir / "model.joblib"

    @property
    def kill_switch_path(self) -> Path:
        return self.data_dir / "KILL"


def get_settings() -> Settings:
    return Settings()
