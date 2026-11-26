import asyncio
from typing import Any, ClassVar

import httpx

from app.core.config import settings
from app.providers.base import ProviderResult
from app.providers.normalize import (
    normalize_company,
    normalize_fleet,
    normalize_pf,
    normalize_phone,
    normalize_phone_operator,
    normalize_vehicle,
)


class APIBrasilAdapter:
    name = "apibrasil"
    _retryable_statuses: ClassVar[set[int]] = {429, 500, 502, 503, 504}

    def __init__(self) -> None:
        self.base_url = settings.apibrasil_base_url.rstrip("/")
        self.token = settings.apibrasil_token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def _mock(self, kind: str, key: str) -> dict[str, Any]:
        if kind == "pf":
            return {
                "mock": True,
                "data": {
                    "credcadastral": {
                        "dados_receita_federal": {
                            "nome": "PESSOA EXEMPLO",
                            "situacao_cadastral": "REGULAR",
                            "data_nascimento": "01/01/1990",
                            "nome_mae": "MAE EXEMPLO",
                            "sexo": "NAO INFORMADO",
                            "email": "exemplo@teste.local",
                        },
                        "telefone_celular": {"telefones": [{"ddd": "11", "num_telefone": "999991234"}]},
                        "somente_endereco": [{"cidade": "CIDADE EXEMPLO", "uf": "UF"}],
                        "participacao_em_empresas": [],
                    }
                },
            }
        if kind == "fleet":
            return {
                "mock": True,
                "data": {
                    "quantidade_veiculos": 1,
                    "quantidade_veiculos_declarada": 1,
                    "lista_parcial": False,
                    "veiculos": [
                        {
                            "placa": "ABC1D23",
                            "renavam": "00000000001",
                            "chassi": "9BWZZZ377VT000001",
                            "modelo": "VEICULO EXEMPLO",
                            "cor": "BRANCA",
                            "ano_fabricacao": 2020,
                            "uf": "SP",
                        }
                    ],
                },
            }
        if kind == "phone":
            return {
                "mock": True,
                "data": {
                    "ddd": "11",
                    "telefone": key,
                    "operadora": "OPERADORA EXEMPLO",
                    "proprietarios": [
                        {
                            "nome": "TITULAR EXEMPLO",
                            "documento": "00000000000",
                            "enderecos": [{"cidade": "CIDADE EXEMPLO", "uf": "UF"}],
                        }
                    ],
                    "vinculos": [],
                },
            }
        if kind == "phone_operator":
            return {
                "mock": True,
                "response": {
                    "results": [
                        {
                            "telefone": key,
                            "historico": [
                                {"prestadora": "OPERADORA EXEMPLO", "data": "", "mensagem": "Prestadora Origem"},
                                {"prestadora": "OUTRA EXEMPLO", "data": "01/01/2024", "mensagem": "Portabilidade Numérica"},
                            ],
                        }
                    ]
                },
            }
        if kind == "company":
            return {
                "mock": True,
                "data": {
                    "dados": {
                        "razao_social": "EMPRESA EXEMPLO LTDA",
                        "nome_fantasia": "EXEMPLO",
                        "situacao_cadastral": {"descricao": "ATIVA"},
                        "atividade_principal": {"codigo": "6201501", "descricao": "DESENVOLVIMENTO DE SOFTWARE"},
                        "endereco": {
                            "logradouro": "RUA EXEMPLO",
                            "numero": "1",
                            "bairro": "CENTRO",
                            "municipio": "CIDADE EXEMPLO",
                            "uf": "UF",
                            "cep": "00000000",
                        },
                    }
                },
            }
        return {
            "mock": True,
            "data": {
                "placa": key,
                "renavam": "00000000001",
                "chassi": "9BWZZZ377VT000001",
                "marca": "FABRICANTE",
                "modelo": "MODELO",
                "cor": "BRANCA",
                "situacao": "EM CIRCULACAO",
                "proprietario": {"nome": "PROPRIETARIO EXEMPLO", "documento": "00000000000"},
            },
        }

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.post(url, json=payload, headers=self._headers())
                if response.status_code == 402:
                    raise RuntimeError("Saldo insuficiente na APIBrasil")
                if response.status_code in self._retryable_statuses and attempt < 2:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                response.raise_for_status()
                body = response.json()
                if isinstance(body, dict) and body.get("error") is True:
                    raise RuntimeError(str(body.get("message") or "Erro na APIBrasil"))
                return body
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in self._retryable_statuses and attempt < 2:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise
        raise last_error or RuntimeError("Falha ao consultar APIBrasil")

    def _unavailable(self, message: str) -> ProviderResult:
        return ProviderResult(self.name, False, {}, {}, message)

    def _use_mock(self) -> bool:
        return not self.token and settings.apibrasil_mode_mock and not settings.is_production

    async def _query(
        self,
        *,
        kind: str,
        key: str,
        path: str,
        payload: dict[str, Any],
        normalizer,
    ) -> ProviderResult:
        if not path:
            return self._unavailable(f"Endpoint APIBrasil para {kind} não configurado")
        if not self.token:
            if self._use_mock():
                raw = self._mock(kind, key)
                return ProviderResult(self.name, True, normalizer(self.name, raw, key=key), raw, cost_cents=0)
            return self._unavailable("APIBRASIL_TOKEN não configurado")
        try:
            raw = await self._post(path, payload)
            return ProviderResult(self.name, True, normalizer(self.name, raw, key=key), raw)
        except RuntimeError as exc:
            return self._unavailable(str(exc))
        except Exception as exc:
            return self._unavailable(str(exc))

    async def query_pf_cpf(self, cpf: str) -> ProviderResult:
        return await self._query(
            kind="pf",
            key=cpf,
            path=settings.apibrasil_pf_path,
            payload={"tipo": "cpf-cadastral", "cpf": cpf},
            normalizer=lambda provider, raw, key: normalize_pf(provider, raw, cpf=key),
        )

    async def query_vehicle_plate(self, plate: str) -> ProviderResult:
        return await self._query(
            kind="vehicle",
            key=plate,
            path=settings.apibrasil_vehicle_plate_path,
            payload={"tipo": "nacional", "placa": plate},
            normalizer=lambda provider, raw, key: normalize_vehicle(provider, raw, key_type="placa", key_value=key),
        )

    async def query_vehicle_by_cpf(self, cpf: str) -> ProviderResult:
        return await self._query(
            kind="fleet",
            key=cpf,
            path=settings.apibrasil_vehicle_fleet_path,
            payload={"tipo": "frota-pf", "cpf": cpf},
            normalizer=lambda provider, raw, key: normalize_fleet(provider, raw, cpf=key),
        )

    async def query_phone(self, phone: str) -> ProviderResult:
        result = await self._query(
            kind="phone",
            key=phone,
            path=settings.apibrasil_phone_path,
            payload={"tipo": "cpf-cnpj-pelo-telefone", "telefone": phone},
            normalizer=lambda provider, raw, key: normalize_phone(provider, raw, phone=key),
        )
        if not result.ok:
            return result
        operator_raw: dict[str, Any] | None = None
        if self._use_mock():
            operator_raw = self._mock("phone_operator", phone)
        elif settings.apibrasil_phone_operator_path:
            try:
                operator_raw = await self._post(
                    settings.apibrasil_phone_operator_path,
                    {
                        "tipo": "telefone-operadora",
                        "homolog": False,
                        "numbers": [phone],
                        "options": {"webhook": False, "retries": 0, "retry_delay": 1},
                    },
                )
            except Exception:
                operator_raw = None
        if operator_raw:
            operator = normalize_phone_operator(operator_raw)
            result.normalized.update(operator)
            result.raw = {"cadastral": result.raw, "operadora": operator_raw}
        return result

    async def query_company_cnpj(self, cnpj: str) -> ProviderResult:
        return await self._query(
            kind="company",
            key=cnpj,
            path=settings.apibrasil_company_path,
            payload={"tipo": "cnpj-receita", "cnpj": cnpj},
            normalizer=lambda provider, raw, key: normalize_company(provider, raw, cnpj=key),
        )
