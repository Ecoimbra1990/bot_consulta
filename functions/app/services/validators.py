import re


def only_digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _check_digit(digits: str, weights: list[int]) -> int:
    total = sum(int(d) * w for d, w in zip(digits, weights))
    remainder = total % 11
    return 0 if remainder < 2 else 11 - remainder


def is_valid_cpf(cpf: str) -> bool:
    cpf = only_digits(cpf)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    return (
        _check_digit(cpf[:9], list(range(10, 1, -1))) == int(cpf[9])
        and _check_digit(cpf[:10], list(range(11, 1, -1))) == int(cpf[10])
    )


def is_valid_cnpj(cnpj: str) -> bool:
    cnpj = only_digits(cnpj)
    if len(cnpj) != 14 or cnpj == cnpj[0] * 14:
        return False
    weights_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    weights_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    return (
        _check_digit(cnpj[:12], weights_1) == int(cnpj[12])
        and _check_digit(cnpj[:13], weights_2) == int(cnpj[13])
    )


def normalize_phone(value: str) -> str:
    digits = only_digits(value)
    if len(digits) in {12, 13} and digits.startswith("55"):
        digits = digits[2:]
    return digits


def is_valid_phone(value: str) -> bool:
    phone = normalize_phone(value)
    if len(phone) not in {10, 11}:
        return False
    ddd = int(phone[:2])
    if ddd < 11 or ddd > 99:
        return False
    return phone[2] != "0" and phone[6] != "0" if len(phone) == 10 else phone[2] != "0"


def normalize_plate(plate: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", plate or "").upper()


def is_valid_plate(plate: str) -> bool:
    p = normalize_plate(plate)
    return bool(re.fullmatch(r"[A-Z]{3}\d[A-Z0-9]\d{2}", p))


def is_valid_renavam(renavam: str) -> bool:
    r = only_digits(renavam)
    return len(r) in {9, 11}
