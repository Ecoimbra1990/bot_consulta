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

function scalar(value: unknown): unknown {
  const object = asObject(value);
  return firstDefined(object.descricao, object.description, object.valor, object.value, object.codigo, object.code, value);
}

function contentOf(value: unknown): any {
  const object = asObject(value);
  return firstDefined(object.conteudo, object.content, object);
}

function itemsOf(value: unknown): unknown[] {
  return asArray(firstDefined(contentOf(value), value));
}

function relatedOf(value: unknown): Row[] {
  return itemsOf(value)
    .filter((item): item is Row => item !== null && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const cpf = firstDefined(item.cpf, item.nu_cpf, item.numero_cpf);
      const documento = firstDefined(item.documento, item.nu_documento, item.num_documento);
      const documentDigits = String(documento ?? '').replace(/\D/g, '');
      return {
        nome: scalar(firstDefined(item.nome, item.nm_completo, item.nome_completo, item.nomeCompleto)),
        documento: documento ?? null,
        cpf: cpf ?? (documentDigits.length === 11 ? documento : null),
        vinculo: scalar(firstDefined(item.vinculo, item.ds_vinculo, item.parentesco, item.grau, item.campo, item.tipo, item.relacao)),
        detalhes: item,
      };
    });
}

function payload(raw: Row): Row {
  const data = asObject(firstDefined(raw?.data, raw?.response?.content, raw));
  const content = asObject(data.content);
  const nested = firstDefined(
    content.nome?.conteudo,
    content.conteudo,
    content,
    data.dados,
    data.results,
    data.data,
    data.response?.content,
  );
  return asObject(nested ?? data);
}

function readPhones(...blocks: unknown[]): string[] {
  const phones = new Set<string>();
  for (const block of blocks) {
    const entries = Array.isArray(block)
      ? block
      : itemsOf(firstDefined(asObject(block).conteudo, asObject(block).telefones, asObject(block).content));
    for (const item of entries) {
      const entry = asObject(item);
      const number = firstDefined(entry.num_telefone, entry.numero, entry.telefone);
      if (!number) {
        continue;
      }
      const ddd = String(firstDefined(entry.ddd, entry.uf_ddd, '') || '');
      const text = String(number);
      phones.add(ddd && !text.startsWith(ddd) ? `${ddd}${text}` : text);
    }
  }
  return [...phones];
}

export function normalizePf(provider: string, raw: Row, cpf: string): Row {
  const data = payload(raw);
  const cadastral = asObject(firstDefined(data.credcadastral, data.cadastro, data.dados, data));
  const identityBlock = contentOf(firstDefined(data.nome, cadastral.nome));
  const federalCandidate = firstDefined(cadastral.dados_receita_federal, cadastral.dadosReceitaFederal, cadastral.conteudo, data.conteudo);
  const federal = asObject(federalCandidate ?? identityBlock ?? (cadastral.nome || cadastral.name ? cadastral : null));
  const identity = asObject(firstDefined(identityBlock, federal));
  const phones = readPhones(
    cadastral.telefone_fixo,
    cadastral.telefone_celular,
    cadastral.telefones,
    data.telefones,
    data.pesquisa_telefones,
    cadastral.pesquisa_telefones,
  );
  let emails = itemsOf(firstDefined(data.emails, cadastral.emails));
  if (emails.length === 0 && federal.email) {
    emails = [federal.email];
  }
  return {
    entity: 'PF',
    provider,
    cpf,
    nome: scalar(firstDefined(identity.nome, federal.nome, cadastral.nome, cadastral.name)),
    situacao_cadastral: scalar(firstDefined(
      identity.situacao_receita,
      identity.situacao_cadastral,
      federal.situacao_cadastral,
      federal.situacao_receita,
      federal.situacao,
      cadastral.situacao_cadastral,
      cadastral.situacao_receita,
      cadastral.situacaoCadastral,
      cadastral.situacao,
    )),
    nascimento: firstDefined(identity.data_nascimento, federal.data_nascimento, federal.nascimento, cadastral.data_nascimento, cadastral.dataNascimento),
    nome_mae: firstDefined(identity.mae, identity.nome_mae, federal.nome_mae, federal.mae, federal.nomeMae, cadastral.nome_mae, cadastral.nomeMae),
    sexo: scalar(firstDefined(identity.sexo, federal.sexo, federal.genero, cadastral.sexo)),
    telefones: phones,
    enderecos: firstDefined(itemsOf(data.pesquisa_enderecos), cadastral.somente_endereco, cadastral.enderecos, data.enderecos, []),
    emails: emails.map((email) => String(email)),
    parentes: relatedOf(firstDefined(data.dados_parentes, cadastral.dados_parentes, data.parentescos, cadastral.parentescos)),
    pessoas_contato: relatedOf(firstDefined(data.pessoas_contato, cadastral.pessoas_contato)),
    moradores_mesmo_domicilio: relatedOf(firstDefined(data.residentes_mesmo_domicilio, cadastral.residentes_mesmo_domicilio)),
    vinculos_trabalho: relatedOf(firstDefined(data.trabalha_trabalhou, cadastral.trabalha_trabalhou)),
    participacao_em_empresas: firstDefined(itemsOf(data.alerta_participacoes), cadastral.participacao_em_empresas, []),
    atributos: cadastral,
  };
}

export function normalizeVehicle(provider: string, raw: Row, keyType: string, keyValue: string): Row {
  const data = payload(raw);
  const alertBlock = asObject(data.rouboFurto);
  const history = asArray(alertBlock.historico);
  const alertVehicle = asObject(history[0]);
  const candidate = firstDefined(data.dados, data.veiculo, alertVehicle.placa ? alertVehicle : null, alertBlock);
  const vehicle = candidate && typeof candidate === 'object' ? asObject(candidate) : data;
  const owner = asObject(firstDefined(vehicle.proprietario, data.cliente, data.proprietario));
  let brandModel = firstDefined(
    vehicle.marca_modelo,
    vehicle.marcaModelo,
    vehicle.modelo_marca,
    alertVehicle.marcaModelo,
    data.marca_modelo,
    data.marcaModelo,
  );
  if (!brandModel) {
    const brand = firstDefined(vehicle.marca, data.marca, alertVehicle.marca);
    const model = firstDefined(vehicle.modelo, data.modelo, alertVehicle.modelo);
    if (brand || model) {
      brandModel = [brand, model].filter(Boolean).map((part) => String(part)).join('/');
    }
  }
  const renavam = firstDefined(vehicle.renavam, data.renavam);
  const chassis = firstDefined(vehicle.chassi, alertVehicle.chassi, data.chassi);
  return {
    entity: 'VEICULO',
    provider,
    consulta: { tipo: keyType, valor: keyValue },
    placa: firstDefined(vehicle.placa, alertVehicle.placa, data.placa),
    renavam: renavam ?? null,
    chassi: chassis ?? null,
    marca_modelo: brandModel,
    ano_fabricacao: firstDefined(vehicle.ano_fabricacao, vehicle.anoFabricacao, data.anoFabricacao),
    ano_modelo: firstDefined(vehicle.ano_modelo, vehicle.anoModelo, data.anoModelo),
    cor: firstDefined(vehicle.cor, vehicle.corVeiculo, alertVehicle.cor, data.cor),
    situacao: scalar(firstDefined(vehicle.situacao, vehicle.status, alertBlock.indicadorProcedencia, data.situacao)),
    proprietario: {
      nome: firstDefined(owner.nome, owner.razao_social),
      documento: owner.documento ?? null,
    },
    alertas: {
      consta_ocorrencia: alertBlock.constaOcorrencia ?? null,
      consta_ocorrencia_ativa: alertBlock.constaOcorrenciaAtiva ?? null,
      municipio_emplacamento: alertBlock.municipioEmplacamento ?? null,
      procedencia: alertBlock.indicadorProcedencia ?? null,
      historico: history,
    },
    atributos: data,
  };
}

export function normalizeFleet(provider: string, raw: Row, cpf: string): Row {
  const data = payload(raw);
  const details = data.dados && typeof data.dados === 'object' ? asObject(data.dados) : data;
  const vehicles = asArray(firstDefined(details.veiculos, data.veiculos));
  return {
    entity: 'VEICULO_FROTA',
    provider,
    cpf,
    nome_proprietario: firstDefined(details.nome_proprietario, data.nome_proprietario),
    quantidade_veiculos: firstDefined(details.quantidade_veiculos, data.quantidade_veiculos),
    quantidade_declarada: firstDefined(details.quantidade_declarada, details.quantidade_veiculos_declarada),
    lista_parcial: details.lista_parcial,
    veiculos: vehicles,
    atributos: details,
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
    telefone: phone,
    titular: firstDefined(owner.nome, data.titular, data.nome),
    documento: document ?? null,
    ddd: data.ddd,
    operadora: firstDefined(data.operadora, data.carrier, data.operador),
    portabilidade: firstDefined(data.portabilidade, data.portability),
    localizacao: location,
    proprietarios: entries
      .filter((entry): entry is Row => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => ({ nome: entry.nome, documento: entry.documento ?? null })),
    atributos: data,
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
    portabilidade: portability ? 'sim' : 'não',
    historico: history,
  };
}

function verificaData(raw: Row): Row {
  return asObject(firstDefined(raw?.data, raw));
}

export function normalizePfOnline(provider: string, raw: Row, cpf: string): Row {
  const data = verificaData(raw);
  const basic = asObject(firstDefined(data.basic, data));
  const documents = asObject(basic.documents);
  const phones = asArray(data.phones)
    .map((item) => {
      const phone = asObject(item);
      const number = firstDefined(phone.e164, [phone.area_code, phone.number].filter(Boolean).join(''));
      return number ?? null;
    })
    .filter(Boolean);
  const emails = asArray(data.emails)
    .map((item) => firstDefined(asObject(item).email, item))
    .filter(Boolean)
    .map(String);
  return {
    entity: 'PF',
    provider,
    cpf,
    nome: firstDefined(basic.name, data.name),
    situacao_cadastral: firstDefined(basic.registration_status, data.registration_status),
    nascimento: firstDefined(basic.birth_date, data.birth_date),
    nome_mae: firstDefined(basic.mother_name, data.mother_name),
    sexo: firstDefined(basic.sex, data.sex),
    telefones: phones,
    emails,
    enderecos: asArray(data.addresses),
    parentes: [],
    pessoas_contato: [],
    moradores_mesmo_domicilio: [],
    vinculos_trabalho: [],
    participacao_em_empresas: [],
    atributos: { pai: basic.father_name, situacao_data: basic.registration_status_date, documentos: documents },
  };
}

export function normalizeCompanyOnline(provider: string, raw: Row, cnpj: string): Row {
  const data = verificaData(raw);
  const company = asObject(data.company);
  const establishment = asObject(data.establishment);
  const address = asObject(establishment.address);
  const city = asObject(address.city);
  const state = asObject(address.state);
  const activity = asObject(establishment.primary_activity);
  const addressValue = [
    address.street_type,
    address.street,
    address.number,
    address.complement,
    address.district,
    city.name,
    firstDefined(state.abbreviation, state.name),
    address.postal_code,
  ]
    .filter(Boolean)
    .map((part) => String(part))
    .join(', ');
  return {
    entity: 'EMPRESA',
    provider,
    cnpj,
    razao_social: firstDefined(company.legal_name, data.legal_name),
    nome_fantasia: firstDefined(establishment.trade_name, data.trade_name),
    situacao_cadastral: firstDefined(establishment.registration_status, data.registration_status),
    cnae: firstDefined(activity.description, data.cnae),
    endereco: addressValue || null,
    atributos: {
      socios: data.partners,
      tributacao: data.simplified_tax,
      atividades_secundarias: establishment.secondary_activities,
      inscricoes: establishment.state_registrations,
    },
  };
}

export function normalizeVehicleOnline(provider: string, raw: Row, keyType: string, keyValue: string): Row {
  const data = verificaData(raw);
  const vehicle = asObject(data.vehicle);
  const owner = asObject(data.owner);
  const candidate = asObject(asArray(data.fipe_candidates)[0]);
  const indicators = asObject(data.indicators);
  const brand = firstDefined(vehicle.brand, candidate.brand);
  const model = firstDefined(vehicle.model, candidate.model);
  const brandModel = firstDefined(vehicle.brand_model, brand && model ? `${brand}/${model}` : firstDefined(brand, model));
  const renavam = firstDefined(vehicle.renavam, candidate.renavam);
  const chassis = firstDefined(vehicle.chassis, vehicle.chassi, candidate.chassis, candidate.chassi);
  return {
    entity: 'VEICULO',
    provider,
    consulta: { tipo: keyType, valor: keyValue },
    placa: firstDefined(vehicle.plate, candidate.plate, keyValue),
    renavam: renavam ?? null,
    chassi: chassis ?? null,
    marca_modelo: brandModel,
    ano_fabricacao: firstDefined(vehicle.manufacture_year, candidate.manufacture_year),
    ano_modelo: firstDefined(vehicle.model_year, candidate.model_year),
    cor: firstDefined(vehicle.color, candidate.color),
    situacao: firstDefined(vehicle.status, candidate.status),
    proprietario: {
      nome: firstDefined(owner.name, data.owner_name),
      documento: owner.document ?? null,
    },
    alertas: {
      roubo_furto: firstDefined(indicators.theft, indicators.renainf),
      leilao: indicators.auction ?? null,
      renajud: indicators.renajud ?? null,
      recall: indicators.recall ?? null,
      comunicacao_venda: indicators.sale_communication ?? null,
    },
    atributos: {
      ...vehicle,
      fipe: data.fipe_candidates,
      registro: data.registration,
      indicadores: indicators,
    },
  };
}

export function normalizeCompany(provider: string, raw: Row, cnpj: string): Row {
  const data = payload(raw);
  const details = asObject(firstDefined(data.dados, data.resultado, data.cnpj, data));
  const document = asObject(details.documento);
  const company = asObject(firstDefined(details.empresa, data.empresa));
  const cnae = asObject(firstDefined(details.atividade_principal, asObject(asArray(details.cnae)[0])));
  const address = asObject(firstDefined(details.endereco, details));
  const municipality = asObject(address.municipio);
  const status = asObject(details.situacao_cadastral);
  const cnaeCode = firstDefined(cnae.codigo, details.codigoCnae, details.cnae_fiscal);
  const cnaeDescription = firstDefined(cnae.descricao, details.descricaoCnae, details.atividadeEconomica);
  const cnaeValue = cnaeCode && cnaeDescription ? `${cnaeCode} - ${cnaeDescription}` : cnaeDescription || cnaeCode;
  const addressValue = [
    address.logradouro,
    address.numero,
    address.complemento,
    address.bairro,
    firstDefined(municipality.descricao, address.municipio, address.cidade),
    firstDefined(address.estado, address.uf),
    address.cep,
  ]
    .filter(Boolean)
    .map((part) => String(part))
    .join(', ');
  return {
    entity: 'EMPRESA',
    provider,
    cnpj,
    razao_social: firstDefined(company.razao_social, details.razao_social, details.razaoSocial, details.nome, document.numero),
    nome_fantasia: firstDefined(details.nome_fantasia, details.nomeFantasia),
    situacao_cadastral: scalar(firstDefined(details.situacao_cadastral, status.descricao, details.situacao, document.status)),
    cnae: cnaeValue,
    endereco: addressValue || null,
    atributos: details,
  };
}
