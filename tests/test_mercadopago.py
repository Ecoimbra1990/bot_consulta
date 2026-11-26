import hashlib
import hmac

from app.services.mercadopago import verify_webhook_signature


def _signature(secret: str, data_id: str, request_id: str, ts: str) -> str:
    manifest = f"id:{data_id};request-id:{request_id};ts:{ts};"
    return hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()


def test_mercadopago_signature_valid():
    secret = "webhook-secret"
    data_id = "12345"
    request_id = "req-1"
    ts = "1700000000"
    header = f"ts={ts},v1={_signature(secret, data_id, request_id, ts)}"
    assert verify_webhook_signature(signature_header=header, request_id=request_id, data_id=data_id, secret=secret)


def test_mercadopago_signature_invalid():
    secret = "webhook-secret"
    header = f"ts=1700000000,v1={'0' * 64}"
    assert not verify_webhook_signature(signature_header=header, request_id="req-1", data_id="12345", secret=secret)
    assert not verify_webhook_signature(signature_header=None, request_id=None, data_id="12345", secret=secret)
