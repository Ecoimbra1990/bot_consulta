import { describe, expect, it } from 'vitest';
import { normalizeCompany, normalizePf, normalizePhoneOperator, normalizeVehicle } from '../supabase/functions/_shared/normalize.ts';

describe('normalizadores da APIBrasil', () => {
  it('normaliza PF com dados da Receita e telefone', () => {
    const result = normalizePf(
      'apibrasil',
      {
        data: {
          credcadastral: {
            dados_receita_federal: { nome: 'PESSOA EXEMPLO', situacao_cadastral: 'REGULAR' },
            telefone_celular: { telefones: [{ ddd: '11', num_telefone: '999991234' }] },
          },
        },
      },
      '52998224725',
    );
    expect(result.entity).toBe('PF');
    expect(result.cpf).toBe('***4725');
    expect(result.nome).toBe('PESSOA EXEMPLO');
    expect(result.telefones).toEqual(['****1234']);
  });

  it('normaliza veículo e mascara proprietário', () => {
    const result = normalizeVehicle(
      'apibrasil',
      { dados: { placa: 'ABC1D23', marca: 'FABRICANTE', modelo: 'MODELO', proprietario: { nome: 'PROPRIETARIO', documento: '52998224725' } } },
      'placa',
      'ABC1D23',
    );
    expect(result.marca_modelo).toBe('FABRICANTE/MODELO');
    expect(result.consulta.valor).toBe('ABC***3');
    expect(result.proprietario.documento).toBe('***4725');
  });

  it('normaliza empresa com CNAE e endereço', () => {
    const result = normalizeCompany(
      'apibrasil',
      {
        data: {
          dados: {
            razao_social: 'EMPRESA EXEMPLO LTDA',
            atividade_principal: { codigo: '6201501', descricao: 'DESENVOLVIMENTO' },
            endereco: { logradouro: 'RUA', numero: '1', municipio: 'CIDADE', uf: 'SP' },
          },
        },
      },
      '11444777000161',
    );
    expect(result.cnae).toBe('6201501 - DESENVOLVIMENTO');
    expect(result.endereco).toBe('RUA, 1, CIDADE, SP');
    expect(result.cnpj).toBe('***0161');
  });

  it('detecta portabilidade no histórico da operadora', () => {
    const result = normalizePhoneOperator({
      response: {
        results: [{ historico: [{ prestadora: 'ORIGEM' }, { prestadora: 'DESTINO', mensagem: 'Portabilidade Numérica' }] }],
      },
    });
    expect(result.operadora).toBe('DESTINO');
    expect(result.portabilidade).toBe('sim');
  });
});
