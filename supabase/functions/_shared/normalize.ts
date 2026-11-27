import { maskField, maskValue, sanitize } from './masking.ts';
import type { Row } from './types.ts';

function asObject(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstDefined(...values: unknown[]): any {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      if (!(typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Row).length === 0)) {
        return value;
      }
    }
  }
  return null;
}

function payload(raw: Row): Row {
  const data = asObject(raw?.data && typeof raw.data === 'object' ? raw.data : raw);
  const nested = data.data;
  return asObject(nested && typeof nested === 'object' ? nested : data);
}

export function normalizePf(provider: string, raw: Row, cpf: string): Row {
  const data = payload(raw);
  const cadastral = asObject(firstDefined(data.credcadastral, data.cadastro, data));
  const federal = asObject(firstDefined(cadastral.dados_receita_federal, cadastral.dadosReceitaFederal));
  const phones: string[] = [];
  for (const block of [cadastral.telefone_fixo, cadastral.telefone_celular]) {
    for (const item of asArray(asObject(block).telefones)) {
      const entry = asObject(item);
      const number = entry.num_telefone || entry.numero || entry.telefone;
      if (!number) {
        continue;
      }
      const ddd = String(entry.ddd || '');
      const text = String(number);
      phones.push(ddd && !text.startsWith(ddd) ? `${ddd}${text}` : text);
    }
  }
  let emails = asArray(cadastral.emails);
  if (emails.length === 0 && federal.email) {
    emails = [federal.email];
  }
  return {
    entity: 'PF',
    provider,
    cpf: maskValue('cpf', cpf),
    nome: firstDefined(federal.nome, cadastral.nome, cadastral.name),
    situacao_cadastral: firstDefined(
      federal.situacao_cadastral,
      federal.situacao,
      cadastral.situacaoCadastral,
      cadastral.situacao,
    ),
    nascimento: firstDefined(federal.data_nascimento, federal.nascimento, cadastral.dataNascimento),
    nome_mae: firstDefined(federal.nome_mae, federal.nomeMae, cadastral.nomeMae),
    sexo: firstDefined(federal.sexo, federal.genero, cadastral.sexo),
    telefones: phones.map((phone) => maskValue('telefone', phone)),
    enderecos: sanitize(firstDefined(cadastral.somente_endereco, cadastral.enderecos, [])),
    emails: emails.map((email) => String(email)),
    participacao_em_empresas: sanitize(firstDefined(cadastral.participacao_em_empresas, [])),
    atributos: sanitize(cadastral),
  };
}

export function normalizeVehicle(provider: string, raw: Row, keyType: string, keyValue: string): Row {
  const data = payload(raw);
  const candidate = firstDefined(data.dados, data.veiculo);
  const vehicle = candidate && typeof candidate === 'object' ? asObject(candidate) : data;
  const owner = asObject(firstDefined(vehicle.proprietario, data.cliente, data.proprietario));
  let brandModel = firstDefined(
    vehicle.marca_modelo,
    vehicle.marcaModelo,
    vehicle.modelo_marca,
    data.marca_modelo,
    data.marcaModelo,
  );
  if (!brandModel) {
    const brand = firstDefined(vehicle.marca, data.marca);
    const model = firstDefined(vehicle.modelo, data.modelo);
    if (brand || model) {
      brandModel = [brand, model].filter(Boolean).map((part) => String(part)).join('/');
    }
  }
  const renavam = firstDefined(vehicle.renavam, data.renavam);
  const chassis = firstDefined(vehicle.chassi, data.chassi);
  return {
    entity: 'VEICULO',
    provider,
    consulta: { tipo: keyType, valor: maskValue(keyType, keyValue) },
    placa: firstDefined(vehicle.placa, data.placa),
    renavam: renavam ? maskValue('renavam', String(renavam)) : null,
    chassi: chassis ? maskValue('chassi', String(chassis)) : null,
    marca_modelo: brandModel,
    ano_fabricacao: firstDefined(vehicle.ano_fabricacao, vehicle.anoFabricacao, data.anoFabricacao),
    ano_modelo: firstDefined(vehicle.ano_modelo, vehicle.anoModelo, data.anoModelo),
    cor: firstDefined(vehicle.cor, vehicle.corVeiculo, data.cor),
    situacao: firstDefined(vehicle.situacao, vehicle.status, data.situacao),
    proprietario: {
      nome: firstDefined(owner.nome, owner.razao_social),
      documento: owner.documento ? maskField('documento', owner.documento) : null,
    },
    atributos: sanitize(data),
  };
}

export function normalizeFleet(provider: string, raw: Row, cpf: string): Row {
  const data = payload(raw);
  const details = data.dados && typeof data.dados === 'object' ? asObject(data.dados) : data;
  const vehicles = asArray(firstDefined(details.veiculos, data.veiculos));
  return {
    entity: 'VEICULO_FROTA',
    provider,
    cpf: maskValue('cpf', cpf),
    nome_proprietario: firstDefined(details.nome_proprietario, data.nome_proprietario),
    quantidade_veiculos: firstDefined(details.quantidade_veiculos, data.quantidade_veiculos),
    quantidade_declarada: firstDefined(details.quantidade_declarada, details.quantidade_veiculos_declarada),
    lista_parcial: details.lista_parcial,
    veiculos: sanitize(vehicles),
    atributos: sanitize(details),
  };
}

export function normalizePhoneResult(provider: string, raw: Row, phone: string): Row {
  const data = payload(raw);
  const owners = asArray(data.proprietarios);
  const links = asArray(data.vinculos);
  const entries = owners.length > 0 ? owners : links;
  const owner = asObject(entries[0]);
  const addresses = asArray(owner.enderecos);
  const address = asObject(addresses[0]);
  const location = [address.cidade, address.uf].filter(Boolean).map((part) => String(part)).join(', ') || data.localizacao;
  const document = owner.documento;
  return {
    entity: 'TELEFONE',
    provider,
    telefone: maskValue('telefone', phone),
    titular: firstDefined(owner.nome, data.titular, data.nome),
    documento: document ? maskField('documento', document) : null,
    ddd: data.ddd,
    operadora: firstDefined(data.operadora, data.carrier, data.operador),
    portabilidade: firstDefined(data.portabilidade, data.portability),
    localizacao: location,
    proprietarios: entries
      .filter((entry): entry is Row => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => ({ nome: entry.nome, documento: entry.documento ? maskField('documento', entry.documento) : null })),
    atributos: sanitize(data),
  };
}

export function normalizePhoneOperator(raw: Row): Row {
  const response = raw?.response && typeof raw.response === 'object' ? asObject(raw.response) : raw;
  const results = asArray(response.results);
  const history = asArray(asObject(results[0]).historico);
  const current = asObject(history[history.length - 1]);
  const portability = history.some((item) => String(asObject(item).mensagem || '').toLowerCase().includes('portabilidade'));
  return {
    operadora: firstDefined(current.prestadora, current.razao_social),
    portabilidade: portability ? 'sim' : 'nao',
    historico: sanitize(history),
  };
}

export function normalizeCompany(provider: string, raw: Row, cnpj: string): Row {
  const data = payload(raw);
  const details = asObject(firstDefined(data.dados, data.resultado, data));
  const document = asObject(details.documento);
  const cnae = asObject(details.atividade_principal);
  const address = asObject(details.endereco);
  const status = asObject(details.situacao_cadastral);
  const cnaeCode = firstDefined(cnae.codigo, details.codigoCnae);
  const cnaeDescription = firstDefined(cnae.descricao, details.descricaoCnae, details.atividadeEconomica);
  const cnaeValue = cnaeCode && cnaeDescription ? `${cnaeCode} - ${cnaeDescription}` : cnaeDescription || cnaeCode;
  const addressValue = [
    address.logradouro,
    address.numero,
    address.bairro,
    firstDefined(address.municipio, address.cidade),
    firstDefined(address.estado, address.uf),
    address.cep,
  ]
    .filter(Boolean)
    .map((part) => String(part))
    .join(', ');
  return {
    entity: 'EMPRESA',
    provider,
    cnpj: maskValue('cnpj', cnpj),
    razao_social: firstDefined(details.razao_social, details.razaoSocial, details.nome, document.numero),
    nome_fantasia: firstDefined(details.nome_fantasia, details.nomeFantasia),
    situacao_cadastral: firstDefined(status.descricao, details.situacao, document.status),
    cnae: cnaeValue,
    endereco: addressValue || null,
    atributos: sanitize(details),
  };
}
