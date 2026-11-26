from app.providers.apibrasil import APIBrasilAdapter


def get_provider(name: str) -> APIBrasilAdapter:
    if (name or "").lower() != "apibrasil":
        raise ValueError(f"Provedor não suportado: {name}")
    return APIBrasilAdapter()
