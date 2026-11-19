"""Webhook server: POST a signal, OpenAlgo places the order.

    POST /hook   {"token": "...", "action": "BUY_CE" | "BUY_PE" | "EXIT" | "EXIT_ALL",
                  "lots": 1, "offset": "ATM", "reason": "free text", "spot": 84512.3}
                 (token may also be sent as header X-Hook-Token)
    GET  /health  status, dry-run flag, open position, entries today
    GET  /        live dashboard (timer, spot & option prices, entry checklist, active trade, alert log)
    GET  /api/state   the live engine's latest state (data/live_state.json) as JSON
    POST /kill    {"token": "..."} turns the kill switch on (blocks all new entries)

Anything can fire it: the built-in live engine, TradingView / ChartInk alerts, or curl.
"""
from __future__ import annotations

import hmac
import logging
from pathlib import Path

from flask import Flask, Response, jsonify, request

from .config import Settings
from .executor import Executor
from .store import Store

log = logging.getLogger(__name__)


def create_app(s: Settings, executor: Executor | None = None) -> Flask:
    if not s.hook_token:
        raise SystemExit("Set HOOK_TOKEN in .env before starting the hook (any long random string).")
    store = Store(s.db_path, s.retention_days)
    ex = executor or Executor(s, store)
    app = Flask(__name__)

    def authorised(body: dict) -> bool:
        tok = request.headers.get("X-Hook-Token") or str(body.get("token", ""))
        return hmac.compare_digest(tok, s.hook_token)

    @app.post("/hook")
    def hook():
        body = request.get_json(silent=True) or {}
        if not authorised(body):
            return jsonify({"status": "error", "reason": "bad token"}), 401
        action = str(body.get("action", "")).upper()
        if action not in {"BUY_CE", "BUY_PE", "EXIT", "EXIT_ALL"}:
            return jsonify({"status": "error", "reason": f"unknown action {action!r}"}), 400
        try:
            lots = int(body.get("lots") or s.lots)
            spot = float(body["spot"]) if body.get("spot") else None
        except (TypeError, ValueError):
            return jsonify({"status": "error", "reason": "lots/spot must be numbers"}), 400
        res = ex.handle(action, lots=lots, offset=body.get("offset"), reason=str(body.get("reason", ""))[:300],
                        spot=spot)
        code = 200 if res.get("status") in ("success", "dry_run") else 409 if res.get("status") == "rejected" else 502
        return jsonify(res), code

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "dry_run": s.dry_run, "position": ex.position(),
                        "entries_today": store.orders_today(), "kill_switch": s.kill_switch_path.exists()})

    @app.get("/")
    def dashboard():
        html = (Path(__file__).parent / "static" / "dashboard.html").read_text(encoding="utf-8")
        return Response(html, mimetype="text/html")

    @app.get("/api/state")
    def state():
        path = s.data_dir / "live_state.json"
        if not path.exists():
            return jsonify({"error": "live engine not running yet - start `python -m expiry_lab live`"}), 404
        return Response(path.read_text(), mimetype="application/json")

    @app.post("/kill")
    def kill():
        body = request.get_json(silent=True) or {}
        if not authorised(body):
            return jsonify({"status": "error", "reason": "bad token"}), 401
        s.kill_switch_path.write_text("killed via /kill\n")
        return jsonify({"status": "ok", "kill_switch": True})

    return app


def serve(s: Settings) -> None:
    app = create_app(s)
    log.warning("Hook on http://%s:%s/hook  DRY_RUN=%s", s.hook_host, s.hook_port, s.dry_run)
    app.run(host=s.hook_host, port=s.hook_port)
