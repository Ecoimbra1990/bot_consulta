from app.core.config import settings
from app.db.repositories import app_settings_repo

DOC_ID = "main"


def get_runtime_settings() -> dict:
    doc = app_settings_repo.get(DOC_ID)
    data = doc.data if doc else {}
    return {
        "query_cache_ttl_seconds": _positive_int(data.get("query_cache_ttl_seconds"), settings.query_cache_ttl_seconds),
        "raw_retention_days": _positive_int(data.get("raw_retention_days"), settings.raw_retention_days),
        "queries_per_minute": _positive_int(data.get("queries_per_minute"), settings.queries_per_minute),
        "consent_version": str(data.get("consent_version") or settings.consent_version),
    }


def update_runtime_settings(values: dict) -> dict:
    current = get_runtime_settings()
    for key in ("query_cache_ttl_seconds", "raw_retention_days", "queries_per_minute"):
        raw = values.get(key)
        if raw not in (None, ""):
            current[key] = _positive_int(raw, current[key])
    if values.get("consent_version"):
        current["consent_version"] = str(values["consent_version"]).strip()
    app_settings_repo.set(DOC_ID, current, merge=True)
    return current


def _positive_int(value, default: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default
