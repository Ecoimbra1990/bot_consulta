import { sha256Hex } from './crypto.ts';
import { config } from './env.ts';
import {
  normalizeCompany,
  normalizeCompanyOnline,
  normalizeFleet,
  normalizePf,
  normalizePfOnline,
  normalizePhoneOperator,
  normalizePhoneResult,
  normalizeVehicle,
  normalizeVehicleOnline,
} from './normalize.ts';
import type { ProviderResult, Row } from './types.ts';

type Normalizer = (provider: string, raw: Row, key: string) => Row;

export interface ServiceOptions {
  serviceName?: string;
  path?: string;
}

export interface QueryProvider {
  readonly name: string;
  queryPfCpf(cpf: string, options?: ServiceOptions): Promise<ProviderResult>;
  queryCompanyCnpj(cnpj: string, options?: ServiceOptions): Promise<ProviderResult>;
  queryVehiclePlate(plate: string, full?: boolean, options?: ServiceOptions): Promise<ProviderResult>;
  queryVehicleByCpf(cpf: string, options?: ServiceOptions): Promise<ProviderResult>;
  queryPhone(phone: string, options?: ServiceOptions): Promise<ProviderResult>;
}

const retryable = new Set([429, 500, 502, 503, 504]);
const verificaRetryable = new Set([429, 500, 502, 503, 504]);

const VERIFICA_DATASETS: Record<string, string> = {
  pf: 'cpf_dados_completos',
  company: 'cnpj_dados_basicos',
  vehicle: 'consulta_placa',
  'full-vehicle': 'veicular_completa',
};

const VERIFICA_INPUTS: Record<string, string> = {
  pf: 'cpf',
  company: 'cnpj',
  vehicle: 'plate',
  'full-vehicle': 'plate',
};

function unavailable(message: string): ProviderResult {
  return { provider: 'apibrasil', ok: false, normalized: {}, raw: {}, error: message, cost_cents: 0 };
}

export class APIBrasilAdapter implements QueryProvider {
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

  async queryPfCpf(cpf: string, options: ServiceOptions = {}): Promise<ProviderResult> {
    const serviceName = options.serviceName || 'dados-cadastrais';
    return this.query('pf', cpf, options.path || config.apiBrasil.pfPath, { tipo: serviceName, cpf }, (provider, raw, key) =>
      normalizePf(provider, raw, key),
    );
  }

  async queryVehiclePlate(plate: string, full = false, options: ServiceOptions = {}): Promise<ProviderResult> {
    const defaultPath = full && config.apiBrasil.vehicleFullPath
      ? config.apiBrasil.vehicleFullPath
      : config.apiBrasil.vehiclePlatePath;
    const serviceName = options.serviceName || 'roubo-furto-v2';
    return this.query('vehicle', plate, options.path || defaultPath, { tipo: serviceName, placa: plate }, (provider, raw, key) =>
      normalizeVehicle(provider, raw, 'placa', key),
    );
  }

  async queryVehicleByCpf(cpf: string, options: ServiceOptions = {}): Promise<ProviderResult> {
    const serviceName = options.serviceName || 'frota-pf';
    return this.query('fleet', cpf, options.path || config.apiBrasil.vehicleFleetPath, { tipo: serviceName, cpf }, (provider, raw, key) =>
      normalizeFleet(provider, raw, key),
    );
  }

  async queryPhone(phone: string, options: ServiceOptions = {}): Promise<ProviderResult> {
    const serviceName = options.serviceName || 'cpf-cnpj-pelo-telefone';
    const result = await this.query(
      'phone',
      phone,
      options.path || config.apiBrasil.phonePath,
      { tipo: serviceName, telefone: phone },
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

  async queryCompanyCnpj(cnpj: string, options: ServiceOptions = {}): Promise<ProviderResult> {
    const serviceName = options.serviceName || 'cnpj';
    return this.query('company', cnpj, options.path || config.apiBrasil.companyPath, { tipo: serviceName, cnpj }, (provider, raw, key) =>
      normalizeCompany(provider, raw, key),
    );
  }
}

export class VerificaOnlineAdapter implements QueryProvider {
  readonly name = 'verifica-online';

  private unavailable(message: string): ProviderResult {
    return { provider: this.name, ok: false, normalized: {}, raw: {}, error: message, cost_cents: 0 };
  }

  private headers(idempotencyKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${config.verificaOnline.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    };
  }

  private async idempotencyKey(dataset: string, key: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10);
    const hash = await sha256Hex(`voa:${dataset}:${key}:${day}`);
    return `voa-${hash.slice(0, 40)}`;
  }

  private async errorMessage(response: Response): Promise<string> {
    try {
      const body = await response.json() as Row;
      const error = body && typeof body.error === 'object' ? body.error as Row : {};
      return String(error.message ?? '') || `Verifica Online HTTP ${response.status}`;
    } catch {
      return `Verifica Online HTTP ${response.status}`;
    }
  }

  private async poll(requestId: string, headers: Record<string, string>): Promise<Row> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const response = await fetch(`${config.verificaOnline.baseUrl}/queries/${encodeURIComponent(requestId)}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const envelope = await response.json() as Row;
        if (String(envelope?.status ?? '') !== 'processing') {
          return envelope;
        }
        continue;
      }
      if (!verificaRetryable.has(response.status)) {
        throw new Error(await this.errorMessage(response));
      }
    }
    throw new Error('Consulta ainda em processamento na Verifica Online');
  }

  private async post(dataset: string, inputField: string, key: string, idempotencyKey: string): Promise<Row> {
    const headers = this.headers(idempotencyKey);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${config.verificaOnline.baseUrl}/datasets/${dataset}/queries`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ [inputField]: key }),
          signal: AbortSignal.timeout(60_000),
        });
        if (response.status === 402) {
          throw new Error('Saldo insuficiente na Verifica Online');
        }
        if (verificaRetryable.has(response.status) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        if (!response.ok) {
          throw new Error(await this.errorMessage(response));
        }
        const envelope = await response.json() as Row;
        if (String(envelope?.status ?? '') === 'processing') {
          return await this.poll(String(envelope?.request_id ?? ''), headers);
        }
        return envelope;
      } catch (error) {
        lastError = error;
        const status = error instanceof Error && 'status' in error ? Number((error as Row).status) : 0;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Saldo insuficiente') || message.includes('ainda em processamento') || message.startsWith('Verifica Online HTTP 4')) {
          throw error;
        }
        if ((verificaRetryable.has(status) || /timeout|network|fetch failed/i.test(message)) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Falha ao consultar Verifica Online');
  }

  private async query(kind: string, key: string, options: ServiceOptions, normalizer: Normalizer): Promise<ProviderResult> {
    if (!config.verificaOnline.apiKey) {
      return this.unavailable('VERIFICA_ONLINE_API_KEY não configurado');
    }
    const dataset = VERIFICA_DATASETS[kind] ?? '';
    const inputField = VERIFICA_INPUTS[kind] ?? '';
    if (!dataset || !inputField) {
      return this.unavailable(`Consulta ${kind} não disponível na Verifica Online`);
    }
    try {
      const idempotencyKey = await this.idempotencyKey(dataset, key);
      const raw = await this.post(dataset, inputField, key, idempotencyKey);
      const status = String(raw?.status ?? '');
      if (status === 'no_data') {
        return this.unavailable('Nenhum dado encontrado na Verifica Online');
      }
      if (status === 'failed') {
        return this.unavailable('Consulta falhou na Verifica Online');
      }
      if (status !== 'succeeded' && status !== 'partial') {
        return this.unavailable(`Estado inesperado da Verifica Online: ${status || 'desconhecido'}`);
      }
      return {
        provider: this.name,
        ok: true,
        normalized: normalizer(this.name, raw, key),
        raw,
        error: '',
        cost_cents: Math.max(0, Number(raw?.billing?.amount_cents ?? 0) || 0),
      };
    } catch (error) {
      return this.unavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async queryPfCpf(cpf: string, options: ServiceOptions = {}): Promise<ProviderResult> {
    return this.query('pf', cpf, options, normalizePfOnline);
  }

  async queryCompanyCnpj(cnpj: string, options: ServiceOptions = {}): Promise<ProviderResult> {
    return this.query('company', cnpj, options, normalizeCompanyOnline);
  }

  async queryVehiclePlate(plate: string, full = false, options: ServiceOptions = {}): Promise<ProviderResult> {
    return this.query(full ? 'full-vehicle' : 'vehicle', plate, options, (provider, raw, key) =>
      normalizeVehicleOnline(provider, raw, 'placa', key),
    );
  }

  async queryVehicleByCpf(): Promise<ProviderResult> {
    return this.unavailable('Frota por CPF não disponível na Verifica Online');
  }

  async queryPhone(): Promise<ProviderResult> {
    return this.unavailable('Consulta por telefone não disponível na Verifica Online');
  }
}
