from app.bot.handlers import _summary
from app.providers.normalize import (
    normalize_company,
    normalize_fleet,
    normalize_pf,
    normalize_phone,
    normalize_phone_operator,
    normalize_vehicle,
)


def test_summary_masks_pf_cpf():
    text = _summary({"entity": "PF", "cpf": "52998224725", "nome": "TESTE"})
    assert "52998224725" not in text
    assert "***.982.247-**" in text


def test_summary_has_company_and_phone_fields():
    company = _summary(
        {
            "entity": "EMPRESA",
            "cnpj": "11444777000161",
            "razao_social": "EMPRESA TESTE",
            "situacao_cadastral": "ATIVA",
            "cnae": "6201501",
        }
    )
    assert "EMPRESA TESTE" in company
    assert "11444777000161" not in company
    phone = _summary({"entity": "TELEFONE", "telefone": "11999991234", "operadora": "OPERADORA"})
    assert "(11) ****-1234" in phone
    assert "11999991234" not in phone


def test_summary_keeps_already_masked_values():
    text = _summary({"entity": "PF", "cpf": "***.982.247-**", "nome": "TESTE"})
    assert "***.982.247-**" in text


def test_normalizers_accept_official_apibrasil_shapes():
    pf = normalize_pf(
        "apibrasil",
        {
            "data": {
                "credcadastral": {
                    "dados_receita_federal": {"nome": "FULANO", "situacao_cadastral": "REGULAR"},
                    "telefone_celular": {"telefones": [{"ddd": "11", "num_telefone": "999991234"}]},
                }
            }
        },
        cpf="52998224725",
    )
    assert pf["nome"] == "FULANO"
    assert pf["situacao_cadastral"] == "REGULAR"
    assert "52998224725" not in str(pf)
    assert "999991234" not in str(pf)

    vehicle = normalize_vehicle(
        "apibrasil",
        {"data": {"placa": "ABC1D23", "renavam": "123456789", "marca": "VW", "modelo": "GOL", "situacao": "EM CIRCULACAO"}},
        key_type="placa",
        key_value="ABC1D23",
    )
    assert vehicle["marca_modelo"] == "VW/GOL"
    assert vehicle["renavam"] == "***6789"

    fleet = normalize_fleet(
        "apibrasil",
        {"data": {"veiculos": [{"placa": "ABC1D23", "renavam": "123456789", "chassi": "9BWZZZ377VT000001"}]}},
        cpf="52998224725",
    )
    assert len(fleet["veiculos"]) == 1
    assert "123456789" not in str(fleet)
    assert "9BWZZZ377VT000001" not in str(fleet)

    phone = normalize_phone(
        "apibrasil",
        {
            "data": {
                "ddd": "11",
                "operadora": "VIVO",
                "proprietarios": [
                    {"nome": "FULANO", "documento": "52998224725", "enderecos": [{"cidade": "SAO PAULO", "uf": "SP"}]}
                ],
            }
        },
        phone="11999998888",
    )
    assert phone["titular"] == "FULANO"
    assert phone["localizacao"] == "SAO PAULO, SP"
    assert "52998224725" not in str(phone)

    operator = normalize_phone_operator(
        {"response": {"results": [{"historico": [{"prestadora": "CLARO", "mensagem": "Prestadora Origem"}]}]}}
    )
    assert operator["operadora"] == "CLARO"
    assert operator["portabilidade"] == "nao"

    company = normalize_company(
        "apibrasil",
        {
            "data": {
                "dados": {
                    "razao_social": "EMPRESA TESTE LTDA",
                    "situacao_cadastral": {"descricao": "ATIVA"},
                    "atividade_principal": {"codigo": "6201501", "descricao": "SOFTWARE"},
                    "endereco": {"municipio": "SAO PAULO", "uf": "SP"},
                }
            }
        },
        cnpj="11222333000181",
    )
    assert company["razao_social"] == "EMPRESA TESTE LTDA"
    assert company["situacao_cadastral"] == "ATIVA"
    assert company["cnae"] == "6201501 - SOFTWARE"
    assert company["endereco"] == "SAO PAULO, SP"
    assert "11222333000181" not in str(company)
