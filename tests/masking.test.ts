import { describe, expect, it } from 'vitest';
import { maskCnpj, maskCpf, maskField, maskPhone, maskPlate, maskValue, sanitize } from '../supabase/functions/_shared/masking.ts';

describe('mascaras', () => {
  it('mascara documentos, telefone e placa', () => {
    expect(maskCpf('529.982.247-25')).toBe('***.982.247-**');
    expect(maskCnpj('11.444.777/0001-61')).toBe('**.***.***/0001-**');
    expect(maskPhone('(11) 99999-1234')).toBe('(11) ****-1234');
    expect(maskPlate('abc-1d23')).toBe('ABC***3');
    expect(maskValue('cpf', '52998224725')).toBe('***4725');
  });

  it('mascara campos sensíveis recursivamente', () => {
    const result = sanitize({ cpf: '52998224725', nome: 'Joao', nested: { email: 'joao@example.com' } });
    expect(result).toEqual({ cpf: '***4725', nome: 'Joao', nested: { email: '***' } });
    expect(maskField('renavam', '123456789')).toBe('***6789');
  });
});
