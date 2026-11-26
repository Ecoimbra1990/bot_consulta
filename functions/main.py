import asyncio
import json
from zoneinfo import ZoneInfo

from app.admin.routes import admin_bp
from app.bootstrap import ensure_bootstrap
from app.bot.webhook import process_telegram_update
from app.core.config import settings
from app.core.logging import setup_logging
from app.services.billing import expire_subscriptions, process_mercadopago_payment
from app.services.dsr import purge_expired_raw
from app.services.mercadopago import fetch_payment, verify_webhook_signature
from firebase_functions import https_fn, scheduler_fn
from flask import Flask, jsonify, request

setup_logging()

FUNCTION_SECRETS = [
    "SECRET_KEY",
    "FERNET_KEY",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "MERCADOPAGO_ACCESS_TOKEN",
    "MERCADOPAGO_WEBHOOK_SECRET",
    "APIBRASIL_TOKEN",
]
JOB_SECRETS = [
    "SECRET_KEY",
    "FERNET_KEY",
    "MERCADOPAGO_ACCESS_TOKEN",
    "APIBRASIL_TOKEN",
]

admin_app = Flask(__name__)
admin_app.secret_key = settings.secret_key
admin_app.register_blueprint(admin_bp)

webhooks_app = Flask(__name__)


@webhooks_app.post("/webhooks/telegram")
def telegram_webhook():
    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if not settings.telegram_webhook_secret or secret != settings.telegram_webhook_secret:
        return jsonify({"ok": False, "error": "invalid secret"}), 401
    payload = request.get_json(silent=True) or {}
    result = asyncio.run(process_telegram_update(payload))
    status = 200 if result.get("ok") else 503
    return jsonify(result), status


@webhooks_app.post("/webhooks/mercadopago")
def mercadopago_webhook():
    payload = request.get_json(silent=True) or {}
    data_id = str((payload.get("data") or {}).get("id") or payload.get("id") or "")
    if not data_id:
        return jsonify({"ok": True, "ignored": True})
    if not verify_webhook_signature(
        signature_header=request.headers.get("x-signature"),
        request_id=request.headers.get("x-request-id"),
        data_id=data_id,
    ):
        return jsonify({"ok": False, "error": "invalid signature"}), 401
    topic = payload.get("type") or payload.get("topic")
    if topic and "payment" not in str(topic):
        return jsonify({"ok": True, "ignored": topic})
    if not settings.mercadopago_access_token:
        return jsonify({"ok": False, "error": "MERCADOPAGO_ACCESS_TOKEN not set"}), 503
    try:
        payment = fetch_payment(data_id)
        process_mercadopago_payment(payment)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify({"ok": True})


@https_fn.on_request(secrets=FUNCTION_SECRETS)
def admin(req: https_fn.Request) -> https_fn.Response:
    ensure_bootstrap()
    with admin_app.request_context(req.environ):
        return admin_app.full_dispatch_request()


@https_fn.on_request(secrets=FUNCTION_SECRETS)
def webhooks(req: https_fn.Request) -> https_fn.Response:
    ensure_bootstrap()
    with webhooks_app.request_context(req.environ):
        return webhooks_app.full_dispatch_request()


@https_fn.on_request()
def health(req: https_fn.Request) -> https_fn.Response:
    return https_fn.Response(json.dumps({"status": "ok"}), status=200, mimetype="application/json")


@scheduler_fn.on_schedule(schedule="every day 03:00", timezone=ZoneInfo("America/Sao_Paulo"), secrets=JOB_SECRETS)
def expire_subscriptions_job(event: scheduler_fn.ScheduledEvent) -> None:
    ensure_bootstrap()
    expired = expire_subscriptions()
    print(f"expired_subscriptions={expired}")


@scheduler_fn.on_schedule(schedule="every day 04:00", timezone=ZoneInfo("America/Sao_Paulo"), secrets=JOB_SECRETS)
def retention_job(event: scheduler_fn.ScheduledEvent) -> None:
    ensure_bootstrap()
    purged = purge_expired_raw()
    print(f"purged_query_results={purged}")
