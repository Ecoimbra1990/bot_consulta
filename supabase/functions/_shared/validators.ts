export function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function checkDigit(digits: string, weights: number[]): number {
  let total = 0;
  for (let index = 0; index < weights.length; index += 1) {
    total += Number(digits[index] ?? 0) * weights[index]!;
  }
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: unknown): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || cpf === cpf[0]!.repeat(11)) {
    return false;
  }
  const weights1 = Array.from({ length: 9 }, (_, index) => 10 - index);
  const weights2 = Array.from({ length: 10 }, (_, index) => 11 - index);
  return checkDigit(cpf.slice(0, 9), weights1) === Number(cpf[9]) && checkDigit(cpf.slice(0, 10), weights2) === Number(cpf[10]);
}

export function isValidCnpj(value: unknown): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || cnpj === cnpj[0]!.repeat(14)) {
    return false;
  }
  return (
    checkDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cnpj[12]) &&
    checkDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cnpj[13])
  );
}

export function normalizePhone(value: unknown): string {
  let digits = onlyDigits(value);
  if ([12, 13].includes(digits.length) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  return digits;
}

export function isValidPhone(value: unknown): boolean {
  const phone = normalizePhone(value);
  if (![10, 11].includes(phone.length)) {
    return false;
  }
  const ddd = Number(phone.slice(0, 2));
  if (ddd < 11 || ddd > 99) {
    return false;
  }
  return phone.length === 10 ? phone[2] !== '0' && phone[6] !== '0' : phone[2] !== '0';
}

export function normalizePlate(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isValidPlate(value: unknown): boolean {
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizePlate(value));
}

export function isValidRenavam(value: unknown): boolean {
  return [9, 11].includes(onlyDigits(value).length);
}
