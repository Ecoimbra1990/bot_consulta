import { config } from './env.ts';
import { normalizeCompany, normalizeFleet, normalizePf, normalizePhoneOperator, normalizePhoneResult, normalizeVehicle } from './normalize.ts';
import type { ProviderResult, Row } from './types.ts';

type Normalizer = (provider: string, raw: Row, key: string) => Row;

const retryable = new Set([429, 500, 502, 503, 504]);

function unavailable(message: string): ProviderResult {
  return { provider: 'apibrasil', ok: false, normalized: {}, raw: {}, error: message, cost_cents: 0 };
}

export class APIBrasilAdapter {
  readonly name = 'apibrasil';

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${config.apiBrasil.token}`, 'Content-Type': 'application/json' };
  }

  private mock(kind: string, key: string): Row {
    if (kind === 'pf') {
      return {
        mock: true,
        data: {
          credcadastral: {
            dados_receita_federal: {
              nome: 'PESSOA EXEMPLO',
              situacao_cadastral: 'REGULAR',
              data_nascimento: '01/01/1990',
              nome_mae: 'MAE EXEMPLO',
              sexo: 'NAO INFORMADO',
              email: 'exemplo@teste.local',
            },
            telefone_celular: { telefones: [{ ddd: '11', num_telefone: '999991234' }] },
            somente_endereco: [{ cidade: 'CIDADE EXEMPLO', uf: 'UF' }],
            participacao_em_empresas: [],
          },
        },
      };
    }
    if (kind === 'fleet') {
      return {
        mock: true,
        data: {
          quantidade_veiculos: 1,
          quantidade_veiculos_declarada: 1,
          lista_parcial: false,
          veiculos: [
            {
              placa: 'ABC1D23',
              renavam: '00000000001',
              chassi: '9BWZZZ377VT000001',
              modelo: 'VEICULO EXEMPLO',
              cor: 'BRANCA',
              ano_fabricacao: 2020,
              uf: 'SP',
            },
          ],
        },
      };
    }
    if (kind === 'phone') {
      return {
        mock: true,
        data: {
          ddd: '11',
          telefone: key,
          operadora: 'OPERADORA EXEMPLO',
          proprietarios: [
            {
              nome: 'TITULAR EXEMPLO',
              documento: '00000000000',
              enderecos: [{ cidade: 'CIDADE EXEMPLO', uf: 'UF' }],
            },
          ],
          vinculos: [],
        },
      };
    }
    if (kind === 'phone_operator') {
      return {
        mock: true,
        response: {
          results: [
            {
              telefone: key,
              historico: [
                { prestadora: 'OPERADORA EXEMPLO', data: '', mensagem: 'Prestadora Origem' },
                { prestadora: 'OUTRA EXEMPLO', data: '01/01/2024', mensagem: 'Portabilidade Numérica' },
              ],
            },
          ],
        },
      };
    }
    if (kind === 'company') {
      return {
        mock: true,
        data: {
          dados: {
            razao_social: 'EMPRESA EXEMPLO LTDA',
            nome_fantasia: 'EXEMPLO',
            situacao_cadastral: { descricao: 'ATIVA' },
            atividade_principal: { codigo: '6201501', descricao: 'DESENVOLVIMENTO DE SOFTWARE' },
            endereco: {
              logradouro: 'RUA EXEMPLO',
              numero: '1',
              bairro: 'CENTRO',
              municipio: 'CIDADE EXEMPLO',
              uf: 'UF',
              cep: '00000000',
            },
          },
        },
      };
    }
    return {
      mock: true,
      data: {
        placa: key,
        renavam: '00000000001',
        chassi: '9BWZZZ377VT000001',
        marca: 'FABRICANTE',
        modelo: 'MODELO',
        cor: 'BRANCA',
        situacao: 'EM CIRCULACAO',
        proprietario: { nome: 'PROPRIETARIO EXEMPLO', documento: '00000000000' },
      },
    };
  }

  private async post(path: string, payload: Row): Promise<Row> {
    const url = `${config.apiBrasil.baseUrl}${path}`;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.status === 402) {
          throw new Error('Saldo insuficiente na APIBrasil');
        }
        if (retryable.has(response.status) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        if (!response.ok) {
          throw new Error(`APIBrasil HTTP ${response.status}`);
        }
        const body = (await response.json()) as Row;
        if (body && body.error === true) {
          throw new Error(String(body.message || 'Erro na APIBrasil'));
        }
        return body;
      } catch (error) {
        lastError = error;
        const status = error instanceof Error && 'status' in error ? Number((error as Row).status) : 0;
        const message = error instanceof Error ? error.message : String(error);
        if ((retryable.has(status) || /timeout|network|fetch failed/i.test(message)) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        if (message.includes('Saldo insuficiente') || message.includes('Erro na APIBrasil')) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Falha ao consultar APIBrasil');
  }

  private useMock(): boolean {
    return !config.apiBrasil.token && config.apiBrasil.mock && !config.isProduction;
  }

  private async query(kind: string, key: string, path: string, payload: Row, normalizer: Normalizer): Promise<ProviderResult> {
    if (!path) {
      return unavailable(`Endpoint APIBrasil para ${kind} não configurado`);
    }
    if (!config.apiBrasil.token) {
      if (this.useMock()) {
        const raw = this.mock(kind, key);
        return {
          provider: this.name,
          ok: true,
          normalized: normalizer(this.name, raw, key),
          raw,
          error: '',
          cost_cents: 0,
        };
      }
      return unavailable('APIBRASIL_TOKEN não configurado');
    }
    try {
      const raw = await this.post(path, payload);
      return {
        provider: this.name,
        ok: true,
        normalized: normalizer(this.name, raw, key),
        raw,
        error: '',
        cost_cents: 0,
      };
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async queryPfCpf(cpf: string): Promise<ProviderResult> {
    return this.query('pf', cpf, config.apiBrasil.pfPath, { tipo: 'cpf-cadastral', cpf }, (provider, raw, key) =>
      normalizePf(provider, raw, key),
    );
  }

  async queryVehiclePlate(plate: string, full = false): Promise<ProviderResult> {
    const path = full && config.apiBrasil.vehicleFullPath
      ? config.apiBrasil.vehicleFullPath
      : config.apiBrasil.vehiclePlatePath;
    return this.query('vehicle', plate, path, { tipo: 'nacional', placa: plate }, (provider, raw, key) =>
      normalizeVehicle(provider, raw, 'placa', key),
    );
  }

  async queryVehicleByCpf(cpf: string): Promise<ProviderResult> {
    return this.query('fleet', cpf, config.apiBrasil.vehicleFleetPath, { tipo: 'frota-pf', cpf }, (provider, raw, key) =>
      normalizeFleet(provider, raw, key),
    );
  }

  async queryPhone(phone: string): Promise<ProviderResult> {
    const result = await this.query(
      'phone',
      phone,
      config.apiBrasil.phonePath,
      { tipo: 'cpf-cnpj-pelo-telefone', telefone: phone },
      (provider, raw, key) => normalizePhoneResult(provider, raw, key),
    );
    if (!result.ok) {
      return result;
    }
    let operatorRaw: Row | null = null;
    if (this.useMock()) {
      operatorRaw = this.mock('phone_operator', phone);
    } else if (config.apiBrasil.phoneOperatorPath) {
      try {
        operatorRaw = await this.post(config.apiBrasil.phoneOperatorPath, {
          tipo: 'telefone-operadora',
          homolog: false,
          numbers: [phone],
          options: { webhook: false, retries: 0, retry_delay: 1 },
        });
      } catch {
        operatorRaw = null;
      }
    }
    if (operatorRaw) {
      Object.assign(result.normalized, normalizePhoneOperator(operatorRaw));
      result.raw = { cadastral: result.raw, operadora: operatorRaw };
    }
    return result;
  }

  async queryCompanyCnpj(cnpj: string): Promise<ProviderResult> {
    return this.query('company', cnpj, config.apiBrasil.companyPath, { tipo: 'cnpj-receita', cnpj }, (provider, raw, key) =>
      normalizeCompany(provider, raw, key),
    );
  }
}
