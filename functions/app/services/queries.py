import hashlib
import json
from datetime import UTC, datetime, timedelta

from app.core.runtime_settings import get_runtime_settings
from app.core.security import encrypt_text, mask_cnpj, mask_cpf, mask_phone, mask_plate, utcnow
from app.db.repositories import queries_repo, query_cache_repo, query_results_repo
from app.models.types import QueryStatus
from app.providers.registry import get_provider
from app.services.rate_limit import check_rate_limit
from app.services.validators import (
    is_valid_cnpj,
    is_valid_cpf,
    is_valid_phone,
    is_valid_plate,
    is_valid_renavam,
    normalize_phone,
    normalize_plate,
    only_digits,
)


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _mask(key_type: str, value: str) -> str:
    if key_type == "cpf":
        return mask_cpf(value)
    if key_type == "cnpj":
        return mask_cnpj(value)
    if key_type == "placa":
        return mask_plate(value)
    if key_type == "telefone":
        return mask_phone(value)
    digits = only_digits(value)
    return f"***{digits[-4:]}" if len(digits) >= 4 else "***"


def _as_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    return None


def _validate(entity: str, key_type: str, key_value: str) -> str:
    entity = entity.upper()
    key_type = key_type.lower()
    key_value = key_value.strip()
    if entity == "PF":
        if key_type != "cpf" or not is_valid_cpf(key_value):
            raise ValueError("CPF inválido")
        return only_digits(key_value)
    if entity == "EMPRESA":
        if key_type != "cnpj" or not is_valid_cnpj(key_value):
            raise ValueError("CNPJ inválido")
        return only_digits(key_value)
    if entity == "TELEFONE":
        if key_type != "telefone" or not is_valid_phone(key_value):
            raise ValueError("Telefone inválido")
        return normalize_phone(key_value)
    if entity == "VEICULO":
        if key_type == "placa":
            key_value = normalize_plate(key_value)
            if not is_valid_plate(key_value):
                raise ValueError("Placa inválida")
        elif key_type == "renavam":
            key_value = only_digits(key_value)
            if not is_valid_renavam(key_value):
                raise ValueError("Renavam inválido")
        elif key_type == "cpf":
            key_value = only_digits(key_value)
            if not is_valid_cpf(key_value):
                raise ValueError("CPF inválido")
        else:
            raise ValueError("Tipo de consulta veicular inválido")
        return key_value
    raise ValueError("Entidade inválida")


async def _call_provider(provider, entity: str, key_type: str, key_value: str):
    if entity == "PF":
        return await provider.query_pf_cpf(key_value)
    if entity == "EMPRESA":
        return await provider.query_company_cnpj(key_value)
    if entity == "TELEFONE":
        return await provider.query_phone(key_value)
    if key_type == "placa":
        return await provider.query_vehicle_plate(key_value)
    if key_type == "renavam":
        raise ValueError("Consulta por Renavam exige o CPF do proprietário")
    return await provider.query_vehicle_by_cpf(key_value)


async def run_query(*, user_id: str | int, entity: str, key_type: str, key_value: str):
    entity = entity.upper()
    key_type = key_type.lower()
    key_value = _validate(entity, key_type, key_value)

    if not check_rate_limit("query", str(user_id)):
        raise PermissionError("Limite de consultas por minuto excedido")

    key_hash = _hash_key(f"{entity}:{key_type}:{key_value}")
    cached = query_cache_repo.get(key_hash)
    if cached and not cached.get("mock"):
        expires_at = _as_datetime(cached.expires_at)
        if expires_at and expires_at > utcnow():
            query = queries_repo.create(
                {
                    "user_id": str(user_id),
                    "entity": entity,
                    "key_type": key_type,
                    "key_hash": key_hash,
                    "key_masked": _mask(key_type, key_value),
                    "provider": "cache",
                    "status": QueryStatus.completed.value,
                    "cost_cents": 0,
                    "error": None,
                    "created_at": utcnow(),
                }
            )
            query_results_repo.set(
                query.id,
                {
                    "query_id": query.id,
                    "raw_encrypted_json": cached.get("raw_encrypted_json"),
                    "normalized_json": cached.get("normalized_json"),
                    "fetched_at": utcnow(),
                },
            )
            return queries_repo.get(query.id)

    query = queries_repo.create(
        {
            "user_id": str(user_id),
            "entity": entity,
            "key_type": key_type,
            "key_hash": key_hash,
            "key_masked": _mask(key_type, key_value),
            "provider": None,
            "status": QueryStatus.pending.value,
            "cost_cents": 0,
            "error": None,
            "created_at": utcnow(),
        }
    )

    result = await _call_provider(get_provider("apibrasil"), entity, key_type, key_value)
    update = {"provider": result.provider, "cost_cents": result.cost_cents}
    if result.ok:
        update.update({"status": QueryStatus.completed.value, "error": None})
        queries_repo.update(query.id, update)
        raw_encrypted = encrypt_text(json.dumps(result.raw, ensure_ascii=False))
        query_results_repo.set(
            query.id,
            {
                "query_id": query.id,
                "raw_encrypted_json": raw_encrypted,
                "normalized_json": result.normalized,
                "fetched_at": utcnow(),
            },
        )
        if not result.raw.get("mock"):
            ttl = get_runtime_settings()["query_cache_ttl_seconds"]
            query_cache_repo.set(
                key_hash,
                {
                    "key_hash": key_hash,
                    "entity": entity,
                    "key_type": key_type,
                    "raw_encrypted_json": raw_encrypted,
                    "normalized_json": result.normalized,
                    "expires_at": utcnow().replace(tzinfo=None) + timedelta(seconds=ttl),
                    "created_at": utcnow(),
                },
            )
        return queries_repo.get(query.id)

    update.update({"status": QueryStatus.failed.value, "error": result.error or "Erro na APIBrasil"})
    queries_repo.update(query.id, update)
    return queries_repo.get(query.id)
