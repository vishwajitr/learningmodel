"""Turns a signal (BUY_CE / BUY_PE / EXIT) into an OpenAlgo order, behind safety checks.

Used by the webhook server (hook.py) and by the live engine in --direct mode.

Safety checks for entries (exits are never blocked): kill switch file (data/KILL) · market hours · trade day (TRADE_DAYS) ·
max entries per day · one open position at a time · lots <= MAX_LOTS. DRY_RUN=true (the default)
logs exactly what would be sent and sends nothing.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, time

from .calendar import day_type, next_expiry, openalgo_expiry_str, option_symbol, parse_expiry_list
from .config import Settings
from .openalgo_client import OpenAlgo, OpenAlgoError
from .store import Store

log = logging.getLogger(__name__)
ENTRY = {"BUY_CE": "CE", "BUY_PE": "PE"}
MARKET_OPEN, MARKET_CLOSE = time(9, 15), time(15, 25)


class Rejected(Exception):
    pass


class Executor:
    def __init__(self, s: Settings, store: Store, oa: OpenAlgo | None = None, now=datetime.now):
        self.s, self.store, self.now = s, store, now
        self._oa = oa
        self.pos_path = s.data_dir / "position.json"

    @property
    def oa(self) -> OpenAlgo:
        if self._oa is None:
            self._oa = OpenAlgo(self.s.openalgo_host, self.s.openalgo_api_key)
        return self._oa

    # ---------- position state ----------
    def position(self) -> dict | None:
        if self.pos_path.exists():
            return json.loads(self.pos_path.read_text()) or None
        return None

    def _set_position(self, p: dict | None) -> None:
        self.pos_path.write_text(json.dumps(p or {}))

    # ---------- helpers ----------
    def _expiries(self) -> list[date]:
        if self.s.dry_run and not self.s.openalgo_api_key:
            return []
        try:
            return parse_expiry_list(self.oa.expiries(self.s.underlying, self.s.options_exchange))
        except (OpenAlgoError, Exception) as e:  # noqa: BLE001
            log.warning("expiry list unavailable (%s); using weekday rule", e)
            return []

    def _check(self, action: str, lots: int, today_kind: str) -> None:
        now = self.now()
        if action in ("EXIT", "EXIT_ALL"):
            return  # exits are never blocked
        if self.s.kill_switch_path.exists():
            raise Rejected("kill switch is on (delete data/KILL to resume)")
        if not (MARKET_OPEN <= now.time() <= MARKET_CLOSE):
            raise Rejected(f"outside market hours ({now:%H:%M})")
        if action in ENTRY:
            allowed = [x.strip() for x in self.s.trade_days.split(",")]
            if today_kind not in allowed:
                raise Rejected(f"today is {today_kind}; TRADE_DAYS={self.s.trade_days}")
            if now.time() > self.s.entry_end:
                raise Rejected(f"after ENTRY_END {self.s.entry_end:%H:%M}")
            if self.store.orders_today() >= self.s.max_trades_per_day:
                raise Rejected(f"max {self.s.max_trades_per_day} entries per day reached")
            if self.position():
                raise Rejected(f"already holding {self.position()['symbol']}")
            if not 1 <= lots <= self.s.max_lots:
                raise Rejected(f"lots must be 1..{self.s.max_lots}")

    # ---------- main entry point ----------
    def handle(self, action: str, lots: int | None = None, offset: str | None = None, reason: str = "",
               spot: float | None = None) -> dict:
        action = action.upper()
        lots = int(lots or self.s.lots)
        offset = (offset or self.s.option_offset).upper()
        known = self._expiries()
        today = self.now().date()
        kind = day_type(today, self.s.expiry_weekday, self.s.holidays, known)
        try:
            self._check(action, lots, kind)
        except Rejected as e:
            self.store.log_order(action, "", 0, self.s.dry_run, "rejected", {"reason": reason}, str(e))
            return {"status": "rejected", "reason": str(e)}

        if action in ENTRY:
            return self._enter(action, lots, offset, known, today, reason, spot)
        if action in ("EXIT", "EXIT_ALL"):
            return self._exit(action, reason)
        return {"status": "rejected", "reason": f"unknown action {action}"}

    def _enter(self, action, lots, offset, known, today, reason, spot) -> dict:
        opt = ENTRY[action]
        e = next_expiry(today, self.s.expiry_weekday, self.s.holidays, known)
        qty = lots * self.s.lot_size
        req = {"strategy": self.s.strategy_name, "underlying": self.s.underlying,
               "exchange": self.s.index_exchange, "expiry_date": openalgo_expiry_str(e), "offset": offset,
               "option_type": opt, "action": "BUY", "quantity": qty, "product": self.s.product}
        if self.s.dry_run:
            sym = option_symbol(self.s.underlying, e, round((spot or 0) / self.s.strike_step) * self.s.strike_step,
                                opt) if spot and offset == "ATM" else f"{self.s.underlying}{req['expiry_date']}{offset}{opt}"
            resp = {"status": "dry_run", "symbol": sym, "orderid": "DRYRUN"}
        else:
            try:
                resp = self.oa.options_order(**req)
            except OpenAlgoError as err:
                if "404" not in str(err):
                    self.store.log_order(action, "", qty, False, "error", req, str(err))
                    return {"status": "error", "reason": str(err)}
                # older OpenAlgo without /optionsorder: resolve ATM ourselves
                ltp = spot or float(self.oa.quote(self.s.underlying, self.s.index_exchange).get("ltp") or 0)
                sym = option_symbol(self.s.underlying, e, round(ltp / self.s.strike_step) * self.s.strike_step, opt)
                try:
                    resp = self.oa.place_order(strategy=self.s.strategy_name, symbol=sym,
                                               exchange=self.s.options_exchange, action="BUY", quantity=qty,
                                               product=self.s.product)
                    resp.setdefault("symbol", sym)
                except OpenAlgoError as err2:
                    self.store.log_order(action, sym, qty, False, "error", req, str(err2))
                    return {"status": "error", "reason": str(err2)}
        status = "dry_run" if self.s.dry_run else "success"
        self.store.log_order(action, resp.get("symbol", ""), qty, self.s.dry_run, status,
                             {**req, "reason": reason}, resp)
        self._set_position({"symbol": resp.get("symbol"), "action": action, "qty": qty, "opt": opt,
                            "expiry": str(e), "entry_ts": self.now().isoformat(timespec="seconds"),
                            "entry_spot": spot, "orderid": resp.get("orderid")})
        log.info("ENTRY %s %s qty=%s (%s)", action, resp.get("symbol"), qty, status)
        return {"status": status, "symbol": resp.get("symbol"), "quantity": qty, "orderid": resp.get("orderid")}

    def _exit(self, action, reason) -> dict:
        pos = self.position()
        if action == "EXIT_ALL":
            resp = {"status": "dry_run"} if self.s.dry_run else self.oa.close_all(self.s.strategy_name)
            self.store.log_order(action, "*", 0, self.s.dry_run, "dry_run" if self.s.dry_run else "success",
                                 {"reason": reason}, resp)
            self._set_position(None)
            return {"status": "dry_run" if self.s.dry_run else "success", "closed": "all"}
        if not pos:
            return {"status": "rejected", "reason": "no open position"}
        req = {"strategy": self.s.strategy_name, "symbol": pos["symbol"], "exchange": self.s.options_exchange,
               "action": "SELL", "quantity": pos["qty"], "product": self.s.product}
        if self.s.dry_run:
            resp = {"status": "dry_run", "orderid": "DRYRUN"}
        else:
            try:
                resp = self.oa.place_order(**req)
            except OpenAlgoError as err:
                self.store.log_order(action, pos["symbol"], pos["qty"], False, "error", req, str(err))
                return {"status": "error", "reason": str(err)}
        status = "dry_run" if self.s.dry_run else "success"
        self.store.log_order(action, pos["symbol"], pos["qty"], self.s.dry_run, status, {**req, "reason": reason}, resp)
        self._set_position(None)
        log.info("EXIT %s (%s) %s", pos["symbol"], status, reason)
        return {"status": status, "symbol": pos["symbol"], "quantity": pos["qty"]}
