import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf, isValidPhone, isValidPlate, isValidRenavam, normalizePhone, normalizePlate, onlyDigits } from '../supabase/functions/_shared/validators.ts';

describe('validators', () => {
  it('valida CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });

  it('valida CNPJ', () => {
    expect(isValidCnpj('11.444.777/0001-61')).toBe(true);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('normaliza telefone e valida DDD', () => {
    expect(normalizePhone('(11) 99999-1234')).toBe('11999991234');
    expect(normalizePhone('55 11 99999 1234')).toBe('11999991234');
    expect(isValidPhone('11999991234')).toBe(true);
    expect(isValidPhone('1199991234')).toBe(true);
    expect(isValidPhone('10999991234')).toBe(false);
    expect(isValidPhone('123')).toBe(false);
  });

  it('valida placas Mercosul e antigas', () => {
    expect(normalizePlate('abc-1d23')).toBe('ABC1D23');
    expect(isValidPlate('ABC1D23')).toBe(true);
    expect(isValidPlate('ABC1234')).toBe(true);
    expect(isValidPlate('AB12345')).toBe(false);
  });

  it('valida Renavam e extrai dígitos', () => {
    expect(isValidRenavam('123456789')).toBe(true);
    expect(isValidRenavam('12345678901')).toBe(true);
    expect(isValidRenavam('12345')).toBe(false);
    expect(onlyDigits('abc123')).toBe('123');
  });
});
