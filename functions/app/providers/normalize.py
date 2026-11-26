from typing import Any, cast


def _dict(value: Any) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def _text(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _payload(raw: dict[str, Any]) -> dict[str, Any]:
    data = _dict(raw.get("data")) if isinstance(raw.get("data"), dict) else raw
    nested = data.get("data")
    return _dict(nested) if isinstance(nested, dict) else data


def _is_sensitive_key(key: str) -> bool:
    lowered = key.casefold()
    return any(part in lowered for part in ("cpf", "cnpj", "documento", "renavam", "chassi", "telefone", "celular", "phone", "email"))


def _mask_field(key: str, value: Any) -> str:
    text = str(value) if value is not None else ""
    lowered = key.lower()
    if "cnpj" in lowered:
        return mask_value("cnpj", text)
    if "cpf" in lowered or "documento" in lowered:
        return mask_value("cpf", text) if len(text.replace(".", "").replace("-", "")) <= 11 else mask_value("cnpj", text)
    if "renavam" in lowered:
        return mask_value("renavam", text)
    if "chassi" in lowered:
        return mask_value("chassi", text)
    if "telefone" in lowered or "phone" in lowered or "celular" in lowered:
        return mask_value("telefone", text)
    return "***"


def _sanitize(value: Any, *, key: str = "") -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for item_key, item_value in value.items():
            if isinstance(item_value, (dict, list)):
                result[item_key] = _sanitize(item_value, key=str(item_key))
            elif _is_sensitive_key(str(item_key)) and item_value is not None:
                result[item_key] = _mask_field(str(item_key), item_value)
            else:
                result[item_key] = item_value
        return result
    if isinstance(value, list):
        return [_sanitize(item, key=key) for item in value]
    return _mask_field(key, value) if key and _is_sensitive_key(key) and value is not None else value


def normalize_pf(provider: str, raw: dict[str, Any], *, cpf: str) -> dict[str, Any]:
    data = _payload(raw)
    cadastral = _dict(_text(data.get("credcadastral"), data.get("cadastro"), data))
    federal = _dict(_text(cadastral.get("dados_receita_federal"), cadastral.get("dadosReceitaFederal")))
    phones: list[str] = []
    for block in (cadastral.get("telefone_fixo"), cadastral.get("telefone_celular")):
        for item in _list(_dict(block).get("telefones")):
            entry = _dict(item)
            number = entry.get("num_telefone") or entry.get("numero") or entry.get("telefone")
            if not number:
                continue
            ddd = str(entry.get("ddd") or "")
            text = str(number)
            phones.append(text if ddd and text.startswith(ddd) else f"{ddd}{text}")
    emails = _list(cadastral.get("emails"))
    if not emails and federal.get("email"):
        emails = [federal["email"]]
    return {
        "entity": "PF",
        "provider": provider,
        "cpf": mask_value("cpf", cpf),
        "nome": _text(federal.get("nome"), cadastral.get("nome"), cadastral.get("name")),
        "situacao_cadastral": _text(
            federal.get("situacao_cadastral"),
            federal.get("situacao"),
            cadastral.get("situacaoCadastral"),
            cadastral.get("situacao"),
        ),
        "nascimento": _text(federal.get("data_nascimento"), federal.get("nascimento"), cadastral.get("dataNascimento")),
        "nome_mae": _text(federal.get("nome_mae"), federal.get("nomeMae"), cadastral.get("nomeMae")),
        "sexo": _text(federal.get("sexo"), federal.get("genero"), cadastral.get("sexo")),
        "telefones": [mask_value("telefone", str(phone)) for phone in phones],
        "enderecos": _sanitize(cadastral.get("somente_endereco") or cadastral.get("enderecos") or []),
        "emails": [str(email) for email in emails],
        "participacao_em_empresas": _sanitize(cadastral.get("participacao_em_empresas") or []),
        "atributos": _sanitize(cadastral),
    }


def normalize_vehicle(provider: str, raw: dict[str, Any], *, key_type: str, key_value: str) -> dict[str, Any]:
    data = _payload(raw)
    candidate = _text(data.get("dados"), data.get("veiculo"))
    vehicle = _dict(candidate) if isinstance(candidate, dict) else data
    owner = _dict(_text(vehicle.get("proprietario"), data.get("cliente"), data.get("proprietario")))
    marca_modelo = _text(
        vehicle.get("marca_modelo"),
        vehicle.get("marcaModelo"),
        vehicle.get("modelo_marca"),
        data.get("marca_modelo"),
        data.get("marcaModelo"),
    )
    if not marca_modelo:
        brand = _text(vehicle.get("marca"), data.get("marca"))
        model = _text(vehicle.get("modelo"), data.get("modelo"))
        if brand or model:
            marca_modelo = "/".join(str(part) for part in (brand, model) if part)
    renavam = _text(vehicle.get("renavam"), data.get("renavam"))
    return {
        "entity": "VEICULO",
        "provider": provider,
        "consulta": {"tipo": key_type, "valor": mask_value(key_type, key_value)},
        "placa": _text(vehicle.get("placa"), data.get("placa")),
        "renavam": mask_value("renavam", str(renavam)) if renavam else None,
        "chassi": mask_value("chassi", str(vehicle.get("chassi") or data.get("chassi"))) if vehicle.get("chassi") or data.get("chassi") else None,
        "marca_modelo": marca_modelo,
        "ano_fabricacao": _text(vehicle.get("ano_fabricacao"), vehicle.get("anoFabricacao"), data.get("anoFabricacao")),
        "ano_modelo": _text(vehicle.get("ano_modelo"), vehicle.get("anoModelo"), data.get("anoModelo")),
        "cor": _text(vehicle.get("cor"), vehicle.get("corVeiculo"), data.get("cor")),
        "situacao": _text(vehicle.get("situacao"), vehicle.get("status"), data.get("situacao")),
        "proprietario": {
            "nome": _text(owner.get("nome"), owner.get("razao_social")),
            "documento": _mask_field("documento", owner.get("documento")) if owner.get("documento") else None,
        },
        "atributos": _sanitize(data),
    }


def normalize_fleet(provider: str, raw: dict[str, Any], *, cpf: str) -> dict[str, Any]:
    data = _payload(raw)
    details = _dict(data.get("dados")) if isinstance(data.get("dados"), dict) else data
    vehicles = _list(_text(details.get("veiculos"), data.get("veiculos")))
    return {
        "entity": "VEICULO_FROTA",
        "provider": provider,
        "cpf": mask_value("cpf", cpf),
        "nome_proprietario": _text(details.get("nome_proprietario"), data.get("nome_proprietario")),
        "quantidade_veiculos": _text(details.get("quantidade_veiculos"), data.get("quantidade_veiculos")),
        "quantidade_declarada": _text(details.get("quantidade_declarada"), details.get("quantidade_veiculos_declarada")),
        "lista_parcial": details.get("lista_parcial"),
        "veiculos": _sanitize(vehicles),
        "atributos": _sanitize(details),
    }


def normalize_phone(provider: str, raw: dict[str, Any], *, phone: str) -> dict[str, Any]:
    data = _payload(raw)
    owners = _list(data.get("proprietarios"))
    links = _list(data.get("vinculos"))
    owner = _dict((owners or links)[0]) if (owners or links) else {}
    addresses = _list(owner.get("enderecos"))
    address = _dict(addresses[0]) if addresses else {}
    location = ", ".join(str(part) for part in (address.get("cidade"), address.get("uf")) if part) or data.get("localizacao")
    document = owner.get("documento")
    document_masked = _mask_field("documento", document) if document else None
    return {
        "entity": "TELEFONE",
        "provider": provider,
        "telefone": mask_value("telefone", phone),
        "titular": _text(owner.get("nome"), data.get("titular"), data.get("nome")),
        "documento": document_masked,
        "ddd": data.get("ddd"),
        "operadora": _text(data.get("operadora"), data.get("carrier"), data.get("operador")),
        "portabilidade": _text(data.get("portabilidade"), data.get("portability")),
        "localizacao": location,
        "proprietarios": [
            {"nome": entry.get("nome"), "documento": _mask_field("documento", entry.get("documento"))}
            for entry in (owners or links)
            if isinstance(entry, dict)
        ],
        "atributos": _sanitize(data),
    }


def normalize_phone_operator(raw: dict[str, Any]) -> dict[str, Any]:
    response = _dict(raw.get("response")) if isinstance(raw.get("response"), dict) else raw
    results = _list(response.get("results"))
    history = _list(_dict(results[0]).get("historico")) if results else []
    current = _dict(history[-1]) if history else {}
    portability = any("portabilidade" in str(_dict(item).get("mensagem") or "").casefold() for item in history)
    return {
        "operadora": _text(current.get("prestadora"), current.get("razao_social")),
        "portabilidade": "sim" if portability else "nao",
        "historico": _sanitize(history),
    }


def normalize_company(provider: str, raw: dict[str, Any], *, cnpj: str) -> dict[str, Any]:
    data = _payload(raw)
    details = _dict(_text(data.get("dados"), data.get("resultado"), data))
    document = _dict(details.get("documento"))
    cnae = _dict(details.get("atividade_principal"))
    address = _dict(details.get("endereco"))
    status = _dict(details.get("situacao_cadastral"))
    cnae_code = _text(cnae.get("codigo"), details.get("codigoCnae"))
    cnae_description = _text(cnae.get("descricao"), details.get("descricaoCnae"), details.get("atividadeEconomica"))
    cnae_value: Any = None
    if cnae_code and cnae_description:
        cnae_value = f"{cnae_code} - {cnae_description}"
    else:
        cnae_value = cnae_description or cnae_code
    address_value = ", ".join(
        str(part)
        for part in (
            address.get("logradouro"),
            address.get("numero"),
            address.get("bairro"),
            address.get("municipio") or address.get("cidade"),
            address.get("estado") or address.get("uf"),
            address.get("cep"),
        )
        if part
    )
    return {
        "entity": "EMPRESA",
        "provider": provider,
        "cnpj": mask_value("cnpj", cnpj),
        "razao_social": _text(details.get("razao_social"), details.get("razaoSocial"), details.get("nome"), document.get("numero")),
        "nome_fantasia": _text(details.get("nome_fantasia"), details.get("nomeFantasia")),
        "situacao_cadastral": _text(status.get("descricao"), details.get("situacao"), document.get("status")),
        "cnae": cnae_value,
        "endereco": address_value or None,
        "atributos": _sanitize(details),
    }


def mask_value(key_type: str, value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if key_type in {"cpf", "cnpj"} and len(digits) >= 4:
        return f"***{digits[-4:]}"
    if key_type == "placa" and len(value) >= 4:
        return f"{value[:3]}***{value[-1]}"
    if key_type == "telefone" and len(digits) >= 4:
        return f"****{digits[-4:]}"
    if key_type in {"renavam", "chassi"} and len(digits) >= 4:
        return f"***{digits[-4:]}"
    return "***"
