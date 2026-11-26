import asyncio
from datetime import timedelta

import pytest
from app.core.security import utcnow
from app.db.repositories import Doc
from app.providers.base import ProviderResult
from app.services import queries as query_service


class FakeRepo:
    def __init__(self):
        self.items: dict[str, Doc] = {}

    def create(self, data, doc_id=None):
        doc_id = str(doc_id or len(self.items) + 1)
        payload = dict(data)
        payload["id"] = doc_id
        self.items[doc_id] = Doc(doc_id, payload)
        return self.items[doc_id]

    def set(self, doc_id, data, merge=True):
        doc_id = str(doc_id)
        if merge and doc_id in self.items:
            return self.update(doc_id, data)
        return self.create(data, doc_id=doc_id)

    def update(self, doc_id, data):
        doc = self.items.get(str(doc_id))
        if not doc:
            return None
        doc.data.update(data)
        return doc

    def get(self, doc_id):
        return self.items.get(str(doc_id))


class FakeProvider:
    def __init__(self, normalized, raw):
        self.normalized = normalized
        self.raw = raw
        self.calls = []

    async def _result(self, name, value):
        self.calls.append((name, value))
        return ProviderResult("apibrasil", True, self.normalized, self.raw)

    async def query_pf_cpf(self, value):
        return await self._result("pf", value)

    async def query_vehicle_plate(self, value):
        return await self._result("plate", value)

    async def query_vehicle_renavam(self, value):
        return await self._result("renavam", value)

    async def query_vehicle_by_cpf(self, value):
        return await self._result("fleet", value)

    async def query_phone(self, value):
        return await self._result("phone", value)

    async def query_company_cnpj(self, value):
        return await self._result("company", value)


def _setup(monkeypatch, normalized=None, raw=None):
    provider = FakeProvider(normalized or {"entity": "EMPRESA"}, raw or {"razaoSocial": "EMPRESA TESTE"})
    query_service.queries_repo = FakeRepo()
    query_service.query_results_repo = FakeRepo()
    query_service.query_cache_repo = FakeRepo()
    monkeypatch.setattr(query_service, "check_rate_limit", lambda *args, **kwargs: True)
    monkeypatch.setattr(query_service, "get_provider", lambda name: provider)
    monkeypatch.setattr(query_service, "get_runtime_settings", lambda: {"query_cache_ttl_seconds": 300})
    return provider


def test_company_query_uses_provider(monkeypatch):
    provider = _setup(monkeypatch)
    result = asyncio.run(
        query_service.run_query(user_id="u1", entity="EMPRESA", key_type="cnpj", key_value="11.444.777/0001-61")
    )
    assert result.status == "completed"
    assert provider.calls == [("company", "11444777000161")]
    assert query_service.query_results_repo.get(result.id).normalized_json["entity"] == "EMPRESA"


def test_phone_query_uses_provider(monkeypatch):
    provider = _setup(monkeypatch, {"entity": "TELEFONE"}, {"operadora": "TESTE"})
    result = asyncio.run(
        query_service.run_query(user_id="u1", entity="TELEFONE", key_type="telefone", key_value="(11) 99999-1234")
    )
    assert provider.calls == [("phone", "11999991234")]
    assert result.key_masked == "(11) ****-1234"


def test_cache_avoids_second_provider_call(monkeypatch):
    provider = _setup(monkeypatch)
    asyncio.run(query_service.run_query(user_id="u1", entity="EMPRESA", key_type="cnpj", key_value="11444777000161"))
    provider.calls.clear()
    result = asyncio.run(query_service.run_query(user_id="u2", entity="EMPRESA", key_type="cnpj", key_value="11444777000161"))
    assert provider.calls == []
    assert result.provider == "cache"


def test_expired_cache_is_ignored(monkeypatch):
    provider = _setup(monkeypatch)
    asyncio.run(query_service.run_query(user_id="u1", entity="EMPRESA", key_type="cnpj", key_value="11444777000161"))
    cached = next(iter(query_service.query_cache_repo.items.values()))
    cached.data["expires_at"] = utcnow().replace(tzinfo=None) - timedelta(seconds=1)
    provider.calls.clear()
    result = asyncio.run(query_service.run_query(user_id="u1", entity="EMPRESA", key_type="cnpj", key_value="11444777000161"))
    assert provider.calls
    assert result.provider == "apibrasil"


def test_apibrasil_uses_official_paths_and_types(monkeypatch):
    from app.providers.apibrasil import APIBrasilAdapter

    adapter = APIBrasilAdapter()
    monkeypatch.setattr(adapter, "token", "test-token")
    monkeypatch.setattr(adapter, "_use_mock", lambda: False)
    calls = []

    async def fake_post(path, payload):
        calls.append((path, payload))
        if path.endswith("/consulta/telefone/credits"):
            return {"response": {"results": [{"historico": [{"prestadora": "VIVO", "mensagem": "Portabilidade Numérica"}]}]}}
        return {"data": {}}

    monkeypatch.setattr(adapter, "_post", fake_post)
    asyncio.run(adapter.query_pf_cpf("12345678909"))
    asyncio.run(adapter.query_vehicle_plate("ABC1D23"))
    asyncio.run(adapter.query_vehicle_by_cpf("12345678909"))
    asyncio.run(adapter.query_company_cnpj("11222333000181"))
    phone = asyncio.run(adapter.query_phone("11999998888"))

    assert calls[0] == ("/consulta/cpf/credits", {"tipo": "cpf-cadastral", "cpf": "12345678909"})
    assert calls[1] == ("/consulta/veiculos/credits", {"tipo": "nacional", "placa": "ABC1D23"})
    assert calls[2] == ("/consulta/veiculos/credits", {"tipo": "frota-pf", "cpf": "12345678909"})
    assert calls[3] == ("/consulta/cnpj/credits", {"tipo": "cnpj-receita", "cnpj": "11222333000181"})
    assert calls[4] == ("/consulta/cpf-cnpj-pelo-telefone/credits", {"tipo": "cpf-cnpj-pelo-telefone", "telefone": "11999998888"})
    assert calls[5][0] == "/consulta/telefone/credits"
    assert phone.normalized["operadora"] == "VIVO"
    assert phone.normalized["portabilidade"] == "sim"


def test_apibrasil_rejects_error_in_success_body(monkeypatch):
    from app.providers.apibrasil import APIBrasilAdapter

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"error": True, "message": "Falha no provedor"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    adapter = APIBrasilAdapter()
    monkeypatch.setattr("app.providers.apibrasil.httpx.AsyncClient", FakeClient)
    with pytest.raises(RuntimeError, match="Falha no provedor"):
        asyncio.run(adapter._post("/qualquer", {}))
