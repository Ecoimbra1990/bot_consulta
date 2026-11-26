import hashlib
import hmac

import httpx

from app.core.config import settings


def verify_webhook_signature(*, signature_header: str | None, request_id: str | None, data_id: str, secret: str | None = None) -> bool:
    secret = secret or settings.mercadopago_webhook_secret
    if not secret or not signature_header:
        return False
    parts: dict[str, str] = {}
    for chunk in signature_header.split(","):
        if "=" in chunk:
            key, value = chunk.strip().split("=", 1)
            parts[key] = value
    ts = parts.get("ts")
    version = parts.get("v1")
    if not ts or not version:
        return False
    manifest = f"id:{data_id};request-id:{request_id or ''};ts:{ts};"
    expected = hmac.new(secret.encode("utf-8"), manifest.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, version)


def fetch_payment(payment_id: str) -> dict:
    with httpx.Client(timeout=20) as client:
        response = client.get(
            f"{settings.mercadopago_api_base}/v1/payments/{payment_id}",
            headers={"Authorization": f"Bearer {settings.mercadopago_access_token}"},
        )
        response.raise_for_status()
        return response.json()


def create_preference(*, external_reference: str, title: str, amount_cents: int) -> dict:
    base_url = settings.base_url.rstrip("/") if settings.base_url else ""
    body = {
        "items": [
            {
                "title": title,
                "quantity": 1,
                "currency_id": "BRL",
                "unit_price": round(amount_cents / 100, 2),
            }
        ],
        "external_reference": external_reference,
        "binary_mode": True,
    }
    if base_url.startswith("http"):
        body["notification_url"] = f"{base_url}/webhooks/mercadopago"
        body["back_urls"] = {
            "success": f"{base_url}/admin/",
            "pending": f"{base_url}/admin/",
            "failure": f"{base_url}/admin/",
        }
    with httpx.Client(timeout=20) as client:
        response = client.post(
            f"{settings.mercadopago_api_base}/checkout/preferences",
            json=body,
            headers={"Authorization": f"Bearer {settings.mercadopago_access_token}"},
        )
        response.raise_for_status()
        return response.json()
