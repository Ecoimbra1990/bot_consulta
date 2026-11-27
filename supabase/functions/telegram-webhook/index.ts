import { Bot, InlineKeyboard, InputFile, Keyboard, webhookCallback } from 'npm:grammy@^1.38.0';
import type { Context } from 'npm:grammy@^1.38.0';
import { logAction } from '../_shared/audit.ts';
import { bootstrap, createPixTopup } from '../_shared/billing.ts';
import { config, validateRuntime } from '../_shared/env.ts';
import { acceptConsent, exportUserData, hasConsent, requestDeletion } from '../_shared/dsr.ts';
import { maskCnpj, maskCpf, maskPhone } from '../_shared/masking.ts';
import { normalizeVehicle } from '../_shared/normalize.ts';
import { formatMoney, priceTable, resolvePrice, WELCOME_BONUS_CENTS } from '../_shared/pricing.ts';
import { PermissionError, runQuery } from '../_shared/queries.ts';
import { createStore } from '../_shared/store.ts';
import { findWalletUserByTelegram, resolveOrCreateWalletUser } from '../_shared/telegram-users.ts';
import type { Row } from '../_shared/types.ts';
import { getWalletBalance, grantWelcomeBonus, InsufficientBalanceError, walletHistory } from '../_shared/wallet.ts';
import { isValidCnpj, isValidCpf, isValidPhone, isValidPlate, isValidRenavam, normalizePhone, normalizePlate, onlyDigits } from '../_shared/validators.ts';

validateRuntime();

const store = createStore();
const bot = new Bot(config.telegram.token || 'invalid-token');

function kbHomeReply(): Keyboard {
  return new Keyboard()
    .text('Meu Saldo')
    .text('Adicionar PIX')
    .row()
    .text('Tabela de Preços')
    .text('Histórico')
    .row()
    .text('Nova consulta')
    .resized(false)
    .persistent(true);
}

function kbMain(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Pessoa Física (CPF)', 'pf:cpf')
    .row()
    .text('Veículo (Placa)', 'veh:placa')
    .row()
    .text('Veículo (Renavam + CPF)', 'veh:renavam')
    .row()
    .text('Veículo (CPF atrelado)', 'veh:cpf')
    .row()
    .text('Telefone', 'phone:start')
    .row()
    .text('Empresa (CNPJ)', 'company:cnpj')
    .row()
    .text('Adicionar PIX', 'wallet:add')
    .row()
    .text('Minha conta', 'account');
}

async function kbPackages(): Promise<InlineKeyboard> {
  const plans = await store.select('plans', { eq: { active: true }, order: { column: 'price_cents', ascending: true }, limit: 10 });
  const keyboard = new InlineKeyboard();
  for (const plan of plans.filter((item) => String(item.kind ?? 'package') !== 'legacy')) {
    keyboard.text(
      `${plan.name ?? 'Pacote'} — ${formatMoney(Number(plan.price_cents ?? 0))} → ${formatMoney(Number(plan.credit_cents ?? plan.price_cents ?? 0))}`,
      `package:${plan.id}`,
    ).row();
  }
  return keyboard.text('Voltar', 'home');
}

function kbVehicleMode(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Básica', 'vehmode:basic')
    .text('Completa + furto/roubo', 'vehmode:full')
    .row()
    .text('Voltar', 'home');
}

function kbConsent(): InlineKeyboard {
  return new InlineKeyboard().text('Aceitar termos', 'consent:accept');
}

function kbQuery(queryId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Detalhes completos', `detail:${queryId}:0`)
    .row()
    .text('Nova consulta', 'home');
}

function sessionKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

async function readState(key: string): Promise<{ state: string; data: Row }> {
  const row = await store.selectById('bot_sessions', key);
  return { state: String(row?.state ?? ''), data: (row?.data as Row) ?? {} };
}

async function writeState(key: string, telegramId: number, state: string, data: Row): Promise<void> {
  await store.upsert('bot_sessions', {
    id: key,
    telegram_id: telegramId,
    state,
    data,
    updated_at: new Date().toISOString(),
  });
}

async function clearState(key: string): Promise<void> {
  await store.remove('bot_sessions', key);
}

async function getOrCreateUser(tgUser: { id: number; username?: string; first_name: string; last_name?: string }): Promise<Row> {
  return resolveOrCreateWalletUser(store, tgUser);
}

async function ensureAccess(tgUser: { id: number }): Promise<{ ok: boolean; message: string; user: Row | null }> {
  const user = await findWalletUserByTelegram(store, tgUser.id);
  if (!user) {
    return { ok: false, message: 'Usuário não cadastrado. Use /start.', user: null };
  }
  if (!(await hasConsent(store, user))) {
    return { ok: false, message: 'É necessário aceitar os termos de privacidade. Use /start.', user };
  }
  if (user.status === 'blocked') {
    return { ok: false, message: 'Acesso bloqueado. Procure o administrador.', user };
  }
  return { ok: true, message: '', user };
}

function homeText(balanceCents: number): string {
  return [
    `Saldo: ${formatMoney(balanceCents)}`,
    '',
    'Escolha uma consulta ou use o menu inferior.',
  ].join('\n');
}

function signedCents(cents: number): string {
  return `${cents >= 0 ? '+' : '-'} ${formatMoney(Math.abs(cents))}`;
}

interface Detection {
  state: string;
  data: Row;
  keyboard?: InlineKeyboard;
  message: string;
}

async function detectInput(text: string): Promise<Detection | null> {
  const plate = normalizePlate(text);
  if (isValidPlate(plate)) {
    return {
      state: 'detected_plate',
      data: { value: plate },
      keyboard: kbVehicleMode(),
      message: `Placa detectada: ${plate}. Escolha o tipo de consulta:`,
    };
  }
  const digits = onlyDigits(text);
  if (digits.length === 14 && isValidCnpj(digits)) {
    return { state: 'detected_cnpj', data: { value: digits }, message: 'CNPJ detectado. Executando consulta...' };
  }
  if (digits.length === 11 && isValidCpf(digits)) {
    return {
      state: 'detected_11_digits',
      data: { value: digits },
      keyboard: new InlineKeyboard()
        .text('Consultar como CPF', 'auto:cpf')
        .text('Consultar como Telefone', 'auto:phone'),
      message: 'Número de 11 dígitos detectado. Como deseja consultar?',
    };
  }
  return null;
}

function maskedDisplay(value: unknown, masker: (value: unknown) => string): string {
  const text = value === null || value === undefined || value === '' ? '-' : String(value);
  return text.includes('*') ? text : masker(text);
}

function summary(normalized: Row): string {
  const entity = normalized.entity;
  if (entity === 'PF') {
    return [
      'PF encontrada',
      `Nome: ${normalized.nome ?? '-'}`,
      `CPF: ${maskedDisplay(normalized.cpf, maskCpf)}`,
      `Situação: ${normalized.situacao_cadastral ?? '-'}`,
      `Nascimento: ${normalized.nascimento ?? '-'}`,
      `Mãe: ${normalized.nome_mae ?? '-'}`,
    ].join('\n');
  }
  if (entity === 'EMPRESA') {
    return [
      'Empresa encontrada',
      `Razão social: ${normalized.razao_social ?? '-'}`,
      `Nome fantasia: ${normalized.nome_fantasia ?? '-'}`,
      `CNPJ: ${maskedDisplay(normalized.cnpj, maskCnpj)}`,
      `Situação: ${normalized.situacao_cadastral ?? '-'}`,
      `CNAE: ${normalized.cnae ?? '-'}`,
      `Endereço: ${normalized.endereco ?? '-'}`,
    ].join('\n');
  }
  if (entity === 'TELEFONE') {
    return [
      'Telefone encontrado',
      `Número: ${maskedDisplay(normalized.telefone, maskPhone)}`,
      `Titular: ${normalized.titular ?? '-'}`,
      `Operadora: ${normalized.operadora ?? '-'}`,
      `Portabilidade: ${normalized.portabilidade ?? '-'}`,
      `Localização: ${normalized.localizacao ?? '-'}`,
    ].join('\n');
  }
  if (entity === 'VEICULO_FROTA') {
    const vehicles = Array.isArray(normalized.veiculos) ? normalized.veiculos : [];
    return `Frota encontrada\nCPF: ${maskCpf(normalized.cpf ?? '')}\nVeículos: ${vehicles.length}`;
  }
  return [
    'Veículo encontrado',
    `Placa: ${normalized.placa ?? '-'}`,
    `Renavam: ${normalized.renavam ?? '-'}`,
    `Modelo: ${normalized.marca_modelo ?? '-'}`,
    `Situação: ${normalized.situacao ?? '-'}`,
  ].join('\n');
}

function humanize(key: string): string {
  const labels: Record<string, string> = {
    cpf: 'CPF',
    cnpj: 'CNPJ',
    rg: 'RG',
    email: 'E-mail',
    emails: 'E-mails',
    telefone: 'Telefone',
    telefones: 'Telefones',
    situacao_cadastral: 'Situação cadastral',
    data_nascimento: 'Nascimento',
    nascimento: 'Nascimento',
    nome_mae: 'Mãe',
    razao_social: 'Razão social',
    nome_fantasia: 'Nome fantasia',
    endereco: 'Endereço',
    enderecos: 'Endereços',
    participacao_em_empresas: 'Participação em empresas',
    marca_modelo: 'Marca/modelo',
    ano_fabricacao: 'Ano de fabricação',
    ano_modelo: 'Ano/modelo',
    titular: 'Titular',
    documento: 'Documento',
    ddd: 'DDD',
    operadora: 'Operadora',
    portabilidade: 'Portabilidade',
    localizacao: 'Localização',
    proprietarios: 'Proprietários',
    proprietario: 'Proprietário',
    nome_proprietario: 'Nome do proprietário',
    veiculos: 'Veículos',
    placa: 'Placa',
    renavam: 'Renavam',
    chassi: 'Chassi',
    situacao: 'Situação',
    cor: 'Cor',
    quantidade_veiculos: 'Quantidade de veículos',
    quantidade_declarada: 'Quantidade declarada',
    lista_parcial: 'Lista parcial',
    historico: 'Histórico',
  };
  return labels[key] ?? key.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}

function formatBool(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', 'sim', 's', '1', 'yes'].includes(text)) {
    return 'sim';
  }
  if (['false', 'nao', 'não', 'n', '0', 'no'].includes(text)) {
    return 'não';
  }
  return displayValue(value);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(displayValue).filter((item) => item !== '-');
    return items.length > 0 ? items.join(', ') : '-';
  }
  if (typeof value === 'object') {
    const items = Object.entries(value as Row)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== '')
      .map(([key, entryValue]) => `${humanize(key)}: ${displayValue(entryValue)}`);
    return items.length > 0 ? items.join(' | ') : '-';
  }
  return String(value);
}

function pushSection(lines: string[], title: string, value: unknown, skip?: Set<string>): void {
  const source = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const items = source
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return displayValue(entry);
      }
      return Object.entries(entry as Row)
        .filter(([key, entryValue]) => !skip?.has(key) && entryValue !== null && entryValue !== undefined && entryValue !== '')
        .map(([key, entryValue]) => `${humanize(key)}: ${displayValue(entryValue)}`)
        .join(' | ');
    })
    .filter((item) => item !== '' && item !== '-');

  if (items.length === 0) {
    return;
  }
  lines.push('', title);
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

function formatPfDetails(row: Row): string {
  const lines = [
    'Detalhes PF',
    `Nome: ${displayValue(row.nome)}`,
    `CPF: ${displayValue(row.cpf)}`,
    `Situação cadastral: ${displayValue(row.situacao_cadastral)}`,
    `Nascimento: ${displayValue(row.nascimento)}`,
    `Mãe: ${displayValue(row.nome_mae)}`,
    `Sexo: ${displayValue(row.sexo)}`,
  ];
  const shown = new Set([
    'cpf',
    'nome',
    'situacao_cadastral',
    'nascimento',
    'data_nascimento',
    'nome_mae',
    'sexo',
    'telefones',
    'emails',
    'enderecos',
    'participacao_em_empresas',
  ]);

  pushSection(lines, 'Telefones', row.telefones);
  pushSection(lines, 'E-mails', row.emails);
  pushSection(lines, 'Endereços', row.enderecos);
  pushSection(lines, 'Participação em empresas', row.participacao_em_empresas);
  pushSection(lines, 'Outros atributos', row.atributos, shown);
  return lines.join('\n');
}

function formatCompanyDetails(row: Row): string {
  const lines = [
    'Detalhes da empresa',
    `Razão social: ${displayValue(row.razao_social)}`,
    `Nome fantasia: ${displayValue(row.nome_fantasia)}`,
    `CNPJ: ${displayValue(row.cnpj)}`,
    `Situação: ${displayValue(row.situacao_cadastral)}`,
    `CNAE: ${displayValue(row.cnae)}`,
    `Endereço: ${displayValue(row.endereco)}`,
  ];
  pushSection(lines, 'Outros dados', row.atributos, new Set([
    'cnpj',
    'razao_social',
    'nome_fantasia',
    'situacao_cadastral',
    'cnae',
    'endereco',
  ]));
  return lines.join('\n');
}

function formatPhoneDetails(row: Row): string {
  const lines = [
    'Detalhes do telefone',
    `Número: ${displayValue(row.telefone)}`,
    `Titular: ${displayValue(row.titular)}`,
    `Documento: ${displayValue(row.documento)}`,
    `DDD: ${displayValue(row.ddd)}`,
    `Operadora: ${displayValue(row.operadora)}`,
    `Portabilidade: ${displayValue(row.portabilidade)}`,
    `Localização: ${displayValue(row.localizacao)}`,
  ];
  pushSection(lines, 'Proprietários', row.proprietarios);
  pushSection(lines, 'Histórico da operadora', asRow(row.atributos).historico);
  pushSection(lines, 'Outros dados', row.atributos, new Set([
    'ddd',
    'telefone',
    'titular',
    'documento',
    'operadora',
    'portabilidade',
    'localizacao',
    'proprietarios',
    'historico',
  ]));
  return lines.join('\n');
}

function formatVehicleDetails(row: Row): string {
  const lines = [
    'Detalhes do veículo',
    `Placa: ${displayValue(row.placa)}`,
    `Renavam: ${displayValue(row.renavam)}`,
    `Chassi: ${displayValue(row.chassi)}`,
    `Marca/modelo: ${displayValue(row.marca_modelo)}`,
    `Ano de fabricação: ${displayValue(row.ano_fabricacao)}`,
    `Ano/modelo: ${displayValue(row.ano_modelo)}`,
    `Cor: ${displayValue(row.cor)}`,
    `Situação: ${displayValue(row.situacao)}`,
    `Proprietário: ${displayValue(row.proprietario)}`,
  ];
  pushSection(lines, 'Outros dados', row.atributos, new Set([
    'placa',
    'renavam',
    'chassi',
    'marca_modelo',
    'ano_fabricacao',
    'ano_modelo',
    'cor',
    'situacao',
    'proprietario',
  ]));
  return lines.join('\n');
}

function formatFleetDetails(row: Row): string {
  const lines = [
    'Detalhes da frota',
    `CPF: ${displayValue(row.cpf)}`,
    `Nome do proprietário: ${displayValue(row.nome_proprietario)}`,
    `Quantidade de veículos: ${displayValue(row.quantidade_veiculos)}`,
    `Quantidade declarada: ${displayValue(row.quantidade_declarada)}`,
    `Lista parcial: ${formatBool(row.lista_parcial)}`,
  ];
  pushSection(lines, 'Veículos', row.veiculos);
  pushSection(lines, 'Outros dados', row.atributos, new Set([
    'cpf',
    'nome_proprietario',
    'quantidade_veiculos',
    'quantidade_declarada',
    'lista_parcial',
    'veiculos',
  ]));
  return lines.join('\n');
}

function formatGenericDetails(row: Row): string {
  const lines = ['Detalhes da consulta'];
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value) || typeof value === 'object') {
      pushSection(lines, humanize(key), value);
      continue;
    }
    lines.push(`${humanize(key)}: ${displayValue(value)}`);
  }
  return lines.join('\n');
}

function formatDetails(payload: unknown): string {
  const row = asRow(payload);
  switch (row.entity) {
    case 'PF':
      return formatPfDetails(row);
    case 'EMPRESA':
      return formatCompanyDetails(row);
    case 'TELEFONE':
      return formatPhoneDetails(row);
    case 'VEICULO':
      return formatVehicleDetails(row);
    case 'VEICULO_FROTA':
      return formatFleetDetails(row);
    default:
      return formatGenericDetails(row);
  }
}

function paginateText(text: string, pageSize = 3200): string[] {
  const safe = text.trim() || 'Sem dados para exibir.';
  const chunks: string[] = [];
  for (let index = 0; index < safe.length; index += pageSize) {
    chunks.push(safe.slice(index, index + pageSize));
  }
  return chunks.length > 0 ? chunks : ['Sem dados para exibir.'];
}

async function canAccessQuery(tgUserId: number, query: Row): Promise<boolean> {
  const user = await findWalletUserByTelegram(store, tgUserId);
  return Boolean(user && (String(query.user_id) === String(user.id) || user.role === 'admin'));
}

type ReplyContext = Context;

async function replyInsufficient(
  ctx: ReplyContext,
  user: Row,
  input: { entity: string; keyType: string; keyValue: string; mode?: 'basic' | 'full' },
): Promise<void> {
  try {
    const price = await resolvePrice(store, input.entity, input.keyType, input.mode ?? 'basic');
    const balance = await getWalletBalance(store, String(user.id));
    const missing = Math.max(0, price.priceCents - balance);
    await ctx.reply(
      `Saldo insuficiente. Faltam ${formatMoney(missing)} para esta consulta. Escolha um pacote para adicionar créditos:`,
      { reply_markup: await kbPackages() },
    );
  } catch {
    await ctx.reply('Saldo insuficiente. Use Adicionar PIX para recarregar.', { reply_markup: kbMain() });
  }
}

async function runAndReply(
  ctx: ReplyContext,
  input: { entity: string; keyType: string; keyValue: string; mode?: 'basic' | 'full'; renavamFilter?: string },
): Promise<void> {
  const tgUser = ctx.from!;
  const user = await findWalletUserByTelegram(store, tgUser.id);
  if (!user) {
    await ctx.reply('Usuário não encontrado. Use /start.');
    return;
  }
  let query: Row;
  try {
    query = await runQuery(store, {
      userId: String(user.id),
      entity: input.entity,
      keyType: input.keyType,
      keyValue: input.keyValue,
      mode: input.mode ?? 'basic',
    });
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      await replyInsufficient(ctx, user, input);
      return;
    }
    await ctx.reply(error instanceof PermissionError || error instanceof Error ? error.message : 'Erro interno ao processar a consulta.');
    return;
  }
  await logAction(store, {
    actorUserId: user.id,
    action: 'query.executed',
    targetType: 'query',
    targetId: query.id,
    metadata: {
      entity: input.entity,
      key_type: input.keyType,
      mode: input.mode ?? 'basic',
      status: query.status,
      provider: query.provider,
      charged_cents: query.charged_cents ?? 0,
    },
  });
  if (query.status !== 'completed') {
    await ctx.reply(`Consulta falhou: ${query.error || 'erro desconhecido'}. O valor reservado foi estornado.`, { reply_markup: kbMain() });
    return;
  }
  const result = await store.selectById('query_results', query.id, 'query_id');
  let normalized: Row = (result?.normalized_json as Row) ?? {};
  if (input.renavamFilter) {
    const vehicles = Array.isArray(normalized.veiculos) ? normalized.veiculos : [];
    const match = vehicles.find((vehicle) => onlyDigits((vehicle as Row)?.renavam) === input.renavamFilter);
    if (!match) {
      await ctx.reply('Renavam não encontrado na frota do CPF informado.', { reply_markup: kbMain() });
      return;
    }
    normalized = normalizeVehicle('apibrasil', { data: match }, 'renavam', input.renavamFilter);
  }
  const balance = await getWalletBalance(store, String(user.id));
  await ctx.reply(
    `${summary(normalized)}\n\nCobrança: ${formatMoney(Number(query.charged_cents ?? 0))}. Saldo: ${formatMoney(balance)}.`,
    { reply_markup: kbQuery(query.id) },
  );
}

bot.command('start', async (ctx) => {
  const key = sessionKey(ctx.chat!.id, ctx.from!.id);
  await clearState(key);
  const user = await getOrCreateUser(ctx.from!);
  if (await hasConsent(store, user)) {
    const balance = await getWalletBalance(store, String(user.id));
    await ctx.reply(homeText(balance), { reply_markup: kbMain() });
    await ctx.reply('Use o menu inferior para saldo, PIX, tabela e histórico.', { reply_markup: kbHomeReply() });
    return;
  }
  await ctx.reply(
    'Para usar o bot é necessário consentir com o tratamento de dados para execução das consultas e cobrança. ' +
      'Você pode solicitar exportação com /meusdados e exclusão com /excluirmeusdados.',
    { reply_markup: kbConsent() },
  );
});

bot.command('meusdados', async (ctx) => {
  const user = await findWalletUserByTelegram(store, ctx.from!.id);
  if (!user) {
    await ctx.reply('Usuário não encontrado. Use /start.');
    return;
  }
  const data = await exportUserData(store, String(user.id));
  const content = JSON.stringify(data, null, 2);
  await ctx.replyWithDocument(new InputFile(content, 'meus_dados.json'));
});

bot.command('excluirmeusdados', async (ctx) => {
  const user = await findWalletUserByTelegram(store, ctx.from!.id);
  if (!user) {
    await ctx.reply('Usuário não encontrado. Use /start.');
    return;
  }
  await requestDeletion(store, String(user.id));
  await ctx.reply('Solicitação de exclusão registrada. Ela será revisada pelo administrador.');
});

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const key = sessionKey(ctx.chat?.id ?? ctx.from!.id, ctx.from!.id);
  const tgUser = ctx.from!;
  try {
    if (data === 'consent:accept') {
      const user = await getOrCreateUser(tgUser);
      await acceptConsent(store, String(user.id));
      const balance = (await grantWelcomeBonus(store, String(user.id), WELCOME_BONUS_CENTS))
        ?? (await getWalletBalance(store, String(user.id)));
      await ctx.reply(`Termos aceitos. Você recebeu ${formatMoney(WELCOME_BONUS_CENTS)} de bônus.`, { reply_markup: kbHomeReply() });
      await ctx.reply(homeText(balance), { reply_markup: kbMain() });
      return;
    }
    if (data === 'home') {
      await clearState(key);
      const user = await findWalletUserByTelegram(store, tgUser.id);
      const balance = user ? await getWalletBalance(store, String(user.id)) : 0;
      await ctx.reply(homeText(balance), { reply_markup: kbMain() });
      return;
    }
    if (data === 'account') {
      const user = await findWalletUserByTelegram(store, tgUser.id);
      if (!user) {
        await ctx.reply('Usuário não encontrado.');
        return;
      }
      const links = await store.select('user_telegram_accounts', { eq: { user_id: String(user.id) } });
      await ctx.reply(
        `Conta: ${user.name || user.username}\nStatus: ${user.status}\n` +
          `Consentimento: ${(await hasConsent(store, user)) ? 'sim' : 'não'}\n` +
          `Saldo: ${formatMoney(await getWalletBalance(store, String(user.id)))}\n` +
          `Telegrams vinculados: ${links.length}`,
        { reply_markup: kbHomeReply() },
      );
      return;
    }
    if (data === 'wallet:balance') {
      const user = await findWalletUserByTelegram(store, tgUser.id);
      if (!user) {
        await ctx.reply('Use /start para criar sua conta.');
        return;
      }
      await ctx.reply(`Seu saldo: ${formatMoney(await getWalletBalance(store, String(user.id)))}`, { reply_markup: kbHomeReply() });
      return;
    }
    if (data === 'wallet:history') {
      const user = await findWalletUserByTelegram(store, tgUser.id);
      if (!user) {
        await ctx.reply('Use /start para criar sua conta.');
        return;
      }
      const movements = await walletHistory(store, String(user.id));
      const lines = movements.length === 0
        ? ['Nenhuma movimentação ainda.']
        : movements.map((item) => `${new Date(String(item.created_at)).toLocaleString('pt-BR')} — ${item.description || item.kind}: ${signedCents(Number(item.amount_cents ?? 0))}`);
      await ctx.reply(`Histórico da carteira:\n${lines.join('\n')}`, { reply_markup: kbHomeReply() });
      return;
    }
    if (data === 'wallet:prices') {
      await ctx.reply(await priceTable(store), { reply_markup: kbHomeReply() });
      return;
    }
    if (data === 'wallet:add' || data === 'billing:checkout') {
      const user = await findWalletUserByTelegram(store, tgUser.id);
      if (!user || !(await hasConsent(store, user))) {
        await ctx.reply('Aceite os termos com /start antes de adicionar créditos.');
        return;
      }
      await ctx.reply('Escolha um pacote de créditos:', { reply_markup: await kbPackages() });
      return;
    }
    if (data.startsWith('package:')) {
      const user = await findWalletUserByTelegram(store, tgUser.id);
      if (!user || !(await hasConsent(store, user))) {
        await ctx.reply('Aceite os termos com /start antes de adicionar créditos.');
        return;
      }
      try {
        const pix = await createPixTopup(store, {
          userId: String(user.id),
          planId: data.slice('package:'.length),
          chatId: tgUser.id,
          email: user.email ?? null,
        });
        const caption = [
          `PIX de ${formatMoney(Number(pix.amount_cents))} gerado.`,
          `${formatMoney(Number(pix.credit_cents))} serão creditados após confirmação.`,
          'Código copia e cola:',
          String(pix.qr_code || pix.checkout_url || 'Será enviado pelo Mercado Pago.'),
          'Válido por 30 minutos.',
        ].join('\n');
        if (pix.qr_code_base64) {
          const bytes = Uint8Array.from(atob(String(pix.qr_code_base64)), (char) => char.charCodeAt(0));
          await ctx.replyWithPhoto(new InputFile(bytes, 'pix.png'), { caption, reply_markup: kbHomeReply() });
        } else {
          await ctx.reply(caption, { reply_markup: kbHomeReply() });
        }
      } catch (error) {
        await ctx.reply(`Não foi possível gerar o PIX: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (data.startsWith('auto:')) {
      const state = await readState(key);
      const value = String(state.data.value ?? '');
      await clearState(key);
      if (data === 'auto:cpf') {
        await runAndReply(ctx, { entity: 'PF', keyType: 'cpf', keyValue: value });
      } else {
        await runAndReply(ctx, { entity: 'TELEFONE', keyType: 'telefone', keyValue: normalizePhone(value) });
      }
      return;
    }
    if (data.startsWith('vehmode:')) {
      const state = await readState(key);
      const value = String(state.data.value ?? '');
      await clearState(key);
      await runAndReply(ctx, {
        entity: 'VEICULO',
        keyType: 'placa',
        keyValue: value,
        mode: data === 'vehmode:full' ? 'full' : 'basic',
      });
      return;
    }
    if (['pf:cpf', 'phone:start', 'company:cnpj'].includes(data)) {
      const access = await ensureAccess(tgUser);
      if (!access.ok) {
        await ctx.reply(access.message);
        return;
      }
      const mapping: Record<string, { state: string; message: string }> = {
        'pf:cpf': { state: 'pf_cpf', message: 'Informe o CPF (somente números ou formatado):' },
        'phone:start': { state: 'phone', message: 'Informe o telefone com DDD:' },
        'company:cnpj': { state: 'company_cnpj', message: 'Informe o CNPJ (somente números ou formatado):' },
      };
      const selected = mapping[data]!;
      await writeState(key, tgUser.id, selected.state, {});
      await ctx.reply(selected.message);
      return;
    }
    if (data.startsWith('veh:')) {
      const access = await ensureAccess(tgUser);
      if (!access.ok) {
        await ctx.reply(access.message);
        return;
      }
      const keyType = data.split(':', 2)[1] ?? 'placa';
      const labels: Record<string, string> = {
        placa: 'a placa',
        renavam: 'o Renavam',
        cpf: 'o CPF atrelado ao veículo',
      };
      await writeState(key, tgUser.id, 'vehicle_key', { vehicle_key_type: keyType });
      await ctx.reply(`Informe ${labels[keyType] ?? keyType}:`);
      return;
    }
    if (data.startsWith('detail:')) {
      const [, queryId, pageRaw] = data.split(':');
      const query = await store.selectById('queries', queryId ?? '');
      if (!query || !(await canAccessQuery(tgUser.id, query))) {
        await ctx.reply('Consulta não encontrada.');
        return;
      }
      const result = await store.selectById('query_results', queryId ?? '', 'query_id');
      if (!result) {
        await ctx.reply('Consulta não encontrada.');
        return;
      }
      const chunks = paginateText(formatDetails(result.normalized_json));
      const page = Math.max(0, Math.min(Number.parseInt(pageRaw ?? '0', 10) || 0, chunks.length - 1));
      const keyboard = new InlineKeyboard();
      if (page > 0) {
        keyboard.text('Voltar', `detail:${queryId}:${page - 1}`);
      }
      if (page < chunks.length - 1) {
        keyboard.text('Avançar', `detail:${queryId}:${page + 1}`);
      }
      await ctx.reply(`Detalhes ${page + 1}/${chunks.length}\n\n${chunks[page]}`, {
        reply_markup: keyboard,
      });
      return;
    }
  } finally {
    await ctx.answerCallbackQuery();
  }
});

bot.on('message:text', async (ctx) => {
  const key = sessionKey(ctx.chat!.id, ctx.from!.id);
  const { state, data } = await readState(key);
  const text = ctx.message.text;
  const tgUser = ctx.from!;
  if (!state) {
    const user = await findWalletUserByTelegram(store, tgUser.id);
    if (!user) {
      await ctx.reply('Use /start para criar sua conta.', { reply_markup: kbHomeReply() });
      return;
    }
    if (!(await hasConsent(store, user))) {
      await ctx.reply('Aceite os termos com /start antes de consultar.', { reply_markup: kbConsent() });
      return;
    }
    const menu = text.trim();
    if (menu === 'Meu Saldo') {
      await ctx.reply(`Seu saldo: ${formatMoney(await getWalletBalance(store, String(user.id)))}`, { reply_markup: kbHomeReply() });
      return;
    }
    if (menu === 'Adicionar PIX') {
      await ctx.reply('Escolha um pacote de créditos:', { reply_markup: await kbPackages() });
      return;
    }
    if (menu === 'Tabela de Preços') {
      await ctx.reply(await priceTable(store), { reply_markup: kbHomeReply() });
      return;
    }
    if (menu === 'Histórico') {
      const movements = await walletHistory(store, String(user.id));
      const lines = movements.length === 0
        ? ['Nenhuma movimentação ainda.']
        : movements.map((item) => `${new Date(String(item.created_at)).toLocaleString('pt-BR')} — ${item.description || item.kind}: ${signedCents(Number(item.amount_cents ?? 0))}`);
      await ctx.reply(`Histórico da carteira:\n${lines.join('\n')}`, { reply_markup: kbHomeReply() });
      return;
    }
    if (menu === 'Nova consulta') {
      await ctx.reply(homeText(await getWalletBalance(store, String(user.id))), { reply_markup: kbMain() });
      return;
    }
    const detected = await detectInput(text);
    if (!detected) {
      await ctx.reply(homeText(await getWalletBalance(store, String(user.id))), { reply_markup: kbMain() });
      return;
    }
    if (detected.state === 'detected_cnpj') {
      await clearState(key);
      await runAndReply(ctx, { entity: 'EMPRESA', keyType: 'cnpj', keyValue: detected.data.value });
      return;
    }
    await writeState(key, tgUser.id, detected.state, detected.data);
    await ctx.reply(detected.message, detected.keyboard ? { reply_markup: detected.keyboard } : undefined);
    return;
  }

  if (state === 'pf_cpf') {
    await clearState(key);
    const access = await ensureAccess(tgUser);
    if (!access.ok) {
      await ctx.reply(access.message);
      return;
    }
    const cpf = onlyDigits(text);
    if (!isValidCpf(cpf)) {
      await ctx.reply('CPF inválido. Tente novamente.');
      return;
    }
    await runAndReply(ctx, { entity: 'PF', keyType: 'cpf', keyValue: cpf });
    return;
  }

  if (state === 'phone') {
    await clearState(key);
    const access = await ensureAccess(tgUser);
    if (!access.ok) {
      await ctx.reply(access.message);
      return;
    }
    const phone = normalizePhone(text);
    if (!isValidPhone(phone)) {
      await ctx.reply('Telefone inválido. Informe DDD + número.');
      return;
    }
    await runAndReply(ctx, { entity: 'TELEFONE', keyType: 'telefone', keyValue: phone });
    return;
  }

  if (state === 'company_cnpj') {
    await clearState(key);
    const access = await ensureAccess(tgUser);
    if (!access.ok) {
      await ctx.reply(access.message);
      return;
    }
    const cnpj = onlyDigits(text);
    if (!isValidCnpj(cnpj)) {
      await ctx.reply('CNPJ inválido. Tente novamente.');
      return;
    }
    await runAndReply(ctx, { entity: 'EMPRESA', keyType: 'cnpj', keyValue: cnpj });
    return;
  }

  if (state === 'vehicle_key') {
    const keyType = String(data.vehicle_key_type ?? 'placa');
    let value = text.trim();
    if (keyType === 'renavam') {
      const renavam = onlyDigits(value);
      if (!isValidRenavam(renavam)) {
        await ctx.reply('Renavam inválido.');
        return;
      }
      await writeState(key, tgUser.id, 'vehicle_renavam_cpf', { ...data, renavam_value: renavam });
      await ctx.reply('Renavam recebido. Informe o CPF do proprietário para localizar o veículo na frota:');
      return;
    }
    await clearState(key);
    const access = await ensureAccess(tgUser);
    if (!access.ok) {
      await ctx.reply(access.message);
      return;
    }
    if (keyType === 'placa') {
      value = normalizePlate(value);
      if (!isValidPlate(value)) {
        await ctx.reply('Placa inválida. Use formato ABC1234 ou ABC1D23.');
        return;
      }
      await writeState(key, tgUser.id, 'detected_plate', { value });
      await ctx.reply(`Placa detectada: ${value}. Escolha o tipo de consulta:`, { reply_markup: kbVehicleMode() });
      return;
    }
    if (keyType === 'cpf') {
      value = onlyDigits(value);
      if (!isValidCpf(value)) {
        await ctx.reply('CPF inválido.');
        return;
      }
    }
    await runAndReply(ctx, { entity: 'VEICULO', keyType, keyValue: value, mode: 'full' });
    return;
  }

  if (state === 'vehicle_renavam_cpf') {
    await clearState(key);
    const access = await ensureAccess(tgUser);
    if (!access.ok) {
      await ctx.reply(access.message);
      return;
    }
    const cpf = onlyDigits(text);
    if (!isValidCpf(cpf)) {
      await ctx.reply('CPF inválido. Tente novamente.');
      return;
    }
    await runAndReply(ctx, {
      entity: 'VEICULO',
      keyType: 'cpf',
      keyValue: cpf,
      mode: 'full',
      renavamFilter: String(data.renavam_value ?? ''),
    });
  }
});

const handleUpdate = webhookCallback(bot, 'std/http');

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
  }
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== config.telegram.webhookSecret) {
    return Response.json({ ok: false, error: 'invalid secret' }, { status: 401 });
  }
  try {
    await bootstrap(store);
    return await handleUpdate(request);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
});
