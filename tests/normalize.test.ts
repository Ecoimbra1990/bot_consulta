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
    expect(result.cpf).toBe('52998224725');
    expect(result.nome).toBe('PESSOA EXEMPLO');
    expect(result.telefones).toEqual(['11999991234']);
  });

  it('normaliza parentes e ligações pessoais do CPF', () => {
    const result = normalizePf(
      'apibrasil',
      {
        response: {
          content: {
            nome: {
              conteudo: {
                nome: 'POLICIA TESTE',
                situacao_receita: 'REGULAR',
                data_nascimento: '01/01/1980',
                mae: 'MAE TESTE',
              },
            },
            pesquisa_telefones: { conteudo: [{ numero: '11999999999' }] },
            dados_parentes: { conteudo: [{ nome: 'PARENTE TESTE', vinculo: 'IRMA', cpf: '11144477735' }] },
            pessoas_contato: { conteudo: [{ nome: 'CONTATO TESTE' }] },
            trabalha_trabalhou: { conteudo: [{ nome: 'EMPRESA TESTE', vinculo: 'SOCIO' }] },
          },
        },
      },
      '52998224725',
    );
    expect(result.nome).toBe('POLICIA TESTE');
    expect(result.situacao_cadastral).toBe('REGULAR');
    expect(result.telefones).toEqual(['11999999999']);
    expect(result.parentes[0].nome).toBe('PARENTE TESTE');
    expect(result.parentes[0].vinculo).toBe('IRMA');
    expect(result.pessoas_contato).toHaveLength(1);
    expect(result.vinculos_trabalho).toHaveLength(1);
  });

  it('normaliza veículo e mantém documento do proprietário completo', () => {
    const result = normalizeVehicle(
      'apibrasil',
      { dados: { placa: 'ABC1D23', marca: 'FABRICANTE', modelo: 'MODELO', proprietario: { nome: 'PROPRIETARIO', documento: '52998224725' } } },
      'placa',
      'ABC1D23',
    );
    expect(result.marca_modelo).toBe('FABRICANTE/MODELO');
    expect(result.consulta.valor).toBe('ABC1D23');
    expect(result.proprietario.documento).toBe('52998224725');
  });

  it('normaliza alertas de roubo e furto da placa', () => {
    const result = normalizeVehicle(
      'apibrasil',
      {
        data: {
          rouboFurto: {
            constaOcorrencia: true,
            constaOcorrenciaAtiva: false,
            indicadorProcedencia: 'REGULAR',
            historico: [{ placa: 'ABC1D23', marcaModelo: 'FABRICANTE/MODELO', cor: 'PRATA' }],
          },
        },
      },
      'placa',
      'ABC1D23',
    );
    expect(result.marca_modelo).toBe('FABRICANTE/MODELO');
    expect(result.situacao).toBe('REGULAR');
    expect(result.alertas.consta_ocorrencia).toBe(true);
    expect(result.alertas.historico).toHaveLength(1);
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
    expect(result.cnpj).toBe('11444777000161');
  });

  it('normaliza empresa no formato do serviço cnpj', () => {
    const result = normalizeCompany(
      'apibrasil',
      {
        data: {
          dados: {
            empresa: { razao_social: 'APIBRASIL SITES E SOFTWARES LTDA' },
            logradouro: 'RUA ACUCENA',
            numero: '134',
            municipio: { descricao: 'CONTAGEM' },
            uf: 'MG',
            cep: '32187090',
            situacao_cadastral: '02',
            cnae: [{ codigo: '6311900', descricao: 'TRATAMENTO DE DADOS' }],
          },
        },
      },
      '44959669000180',
    );
    expect(result.razao_social).toBe('APIBRASIL SITES E SOFTWARES LTDA');
    expect(result.situacao_cadastral).toBe('02');
    expect(result.cnae).toBe('6311900 - TRATAMENTO DE DADOS');
    expect(result.endereco).toBe('RUA ACUCENA, 134, CONTAGEM, MG, 32187090');
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
