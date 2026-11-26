from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class ProviderResult:
    provider: str
    ok: bool
    normalized: dict[str, Any]
    raw: dict[str, Any]
    error: str | None = None
    cost_cents: int = 0


class ProviderAdapter(Protocol):
    name: str

    async def query_pf_cpf(self, cpf: str) -> ProviderResult: ...
    async def query_vehicle_plate(self, plate: str) -> ProviderResult: ...
    async def query_vehicle_by_cpf(self, cpf: str) -> ProviderResult: ...
    async def query_phone(self, phone: str) -> ProviderResult: ...
    async def query_company_cnpj(self, cnpj: str) -> ProviderResult: ...
