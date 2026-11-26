import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

from app.services.validators import (
    is_valid_cnpj,
    is_valid_cpf,
    is_valid_phone,
    is_valid_plate,
    is_valid_renavam,
    normalize_phone,
)


def test_cpf_validation():
    assert is_valid_cpf("52998224725")
    assert not is_valid_cpf("11111111111")
    assert not is_valid_cpf("123")


def test_cnpj_validation():
    assert is_valid_cnpj("11444777000161")
    assert not is_valid_cnpj("00000000000000")
    assert not is_valid_cnpj("11444777000160")


def test_phone_validation():
    assert is_valid_phone("(11) 99999-1234")
    assert is_valid_phone("5511999991234")
    assert normalize_phone("+55 11 99999-1234") == "11999991234"
    assert not is_valid_phone("123")
    assert not is_valid_phone("01999991234")


def test_plate_validation():
    assert is_valid_plate("ABC1234")
    assert is_valid_plate("ABC1D23")
    assert not is_valid_plate("ABCD123")


def test_renavam_validation():
    assert is_valid_renavam("123456789")
    assert is_valid_renavam("12345678901")
    assert not is_valid_renavam("123")
