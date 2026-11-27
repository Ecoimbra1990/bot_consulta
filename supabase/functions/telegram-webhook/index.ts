import { Bot, InlineKeyboard, InputFile, webhookCallback } from 'npm:grammy@^1.38.0';
import type { Context } from 'npm:grammy@^1.38.0';
import { logAction } from '../_shared/audit.ts';
import { bootstrap, createCheckout } from '../_shared/billing.ts';
import { config, validateRuntime } from '../_shared/env.ts';
import { decryptText } from '../_shared/crypto.ts';
import { acceptConsent, exportUserData, hasConsent, requestDeletion } from '../_shared/dsr.ts';
import { isEntitled } from '../_shared/entitlement.ts';
import { maskCnpj, maskCpf, maskPhone } from '../_shared/masking.ts';
import { normalizeVehicle } from '../_shared/normalize.ts';
import { PermissionError, runQuery } from '../_shared/queries.ts';
import { createStore } from '../_shared/store.ts';
import type { Row, Store } from '../_shared/types.ts';
import { isValidCnpj, isValidCpf, isValidPhone, isValidPlate, isValidRenavam, normalizePhone, normalizePlate, onlyDigits } from '../_shared/validators.ts';

validateRuntime();

const store = createStore();
const bot = new Bot(config.telegram.token || 'invalid-token');

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
    .text('Assinar / Renovar', 'billing:checkout')
    .row()
    .text('Minha conta', 'account');
}

function kbConsent(): InlineKeyboard {
  return new InlineKeyboard().text('Aceitar termos', 'consent:accept');
}

function kbQuery(queryId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Detalhes completos', `detail:${queryId}:0`)
    .row()
    .text('Exportar JSON', `export:${queryId}`)
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
  const telegramId = String(tgUser.id);
  let user = await store.selectOne('users', { eq: { telegram_id: telegramId } });
  if (user) {
    if (tgUser.username && user.username !== tgUser.username) {
      user = (await store.update('users', user.id, { username: tgUser.username })) ?? user;
    }
    return user;
  }
  user = await store.insert('users', {
    telegram_id: telegramId,
    username: tgUser.username ?? null,
    name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '),
    role: 'user',
    status: 'pending',
    created_at: new Date().toISOString(),
  });
  await logAction(store, {
    actorUserId: user.id,
    action: 'telegram.user.created',
    targetType: 'user',
    targetId: user.id,
  });
  return user;
}

async function ensureAccess(tgUser: { id: number }): Promise<{ ok: boolean; message: string; user: Row | null }> {
  const user = await store.selectOne('users', { eq: { telegram_id: String(tgUser.id) } });
  if (!user) {
    return { ok: false, message: 'Usuário não cadastrado. Use /start.', user: null };
  }
  if (!(await hasConsent(store, user))) {
    return { ok: false, message: 'É necessário aceitar os termos de privacidade. Use /start.', user };
  }
  if (!(await isEntitled(store, user))) {
    return {
      ok: false,
      message: "Acesso bloqueado: assinatura inativa/inadimplente. Use 'Assinar / Renovar' ou procure o admin.",
      user,
    };
  }
  return { ok: true, message: '', user };
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

function paginateJson(payload: unknown, pageSize = 3000): string[] {
  const pretty = JSON.stringify(payload, null, 2);
  const chunks: string[] = [];
  for (let index = 0; index < pretty.length; index += pageSize) {
    chunks.push(pretty.slice(index, index + pageSize));
  }
  return chunks.length > 0 ? chunks : ['{}'];
}

async function canAccessQuery(tgUserId: number, query: Row): Promise<boolean> {
  const user = await store.selectOne('users', { eq: { telegram_id: String(tgUserId) } });
  return Boolean(user && (String(query.user_id) === String(user.id) || user.role === 'admin'));
}

type ReplyContext = Context;

async function runAndReply(
  ctx: ReplyContext,
  input: { entity: string; keyType: string; keyValue: string; renavamFilter?: string },
): Promise<void> {
  const tgUser = ctx.from!;
  const user = await store.selectOne('users', { eq: { telegram_id: String(tgUser.id) } });
  if (!user) {
    await ctx.reply('Usuário não encontrado.');
    return;
  }
  let query: Row;
  try {
    query = await runQuery(store, {
      userId: String(user.id),
      entity: input.entity,
      keyType: input.keyType,
      keyValue: input.keyValue,
    });
  } catch (error) {
    await ctx.reply(error instanceof PermissionError || error instanceof Error ? error.message : 'Erro interno ao processar a consulta.');
    return;
  }
  await logAction(store, {
    actorUserId: user.id,
    action: 'query.executed',
    targetType: 'query',
    targetId: query.id,
    metadata: { entity: input.entity, key_type: input.keyType, status: query.status, provider: query.provider },
  });
  if (query.status !== 'completed') {
    await ctx.reply(`Consulta falhou: ${query.error || 'erro desconhecido'}`);
    return;
  }
  const result = await store.selectById('query_results', query.id, 'query_id');
  let normalized: Row = (result?.normalized_json as Row) ?? {};
  if (input.renavamFilter) {
    const vehicles = Array.isArray(normalized.veiculos) ? normalized.veiculos : [];
    const match = vehicles.find((vehicle) => onlyDigits((vehicle as Row)?.renavam) === input.renavamFilter);
    if (!match) {
      await ctx.reply('Renavam não encontrado na frota do CPF informado.');
      return;
    }
    normalized = normalizeVehicle('apibrasil', { data: match }, 'renavam', input.renavamFilter);
  }
  await ctx.reply(summary(normalized), { reply_markup: kbQuery(query.id) });
}

bot.command('start', async (ctx) => {
  const key = sessionKey(ctx.chat!.id, ctx.from!.id);
  await clearState(key);
  const user = await getOrCreateUser(ctx.from!);
  if (await hasConsent(store, user)) {
    await ctx.reply('Bot de consultas: PF, veículos, telefone e empresas. Selecione o tipo.', { reply_markup: kbMain() });
    return;
  }
  await ctx.reply(
    'Para usar o bot é necessário consentir com o tratamento de dados para execução das consultas e cobrança. ' +
      'Você pode solicitar exportação com /meusdados e exclusão com /excluirmeusdados.',
    { reply_markup: kbConsent() },
  );
});

bot.command('meusdados', async (ctx) => {
  const user = await store.selectOne('users', { eq: { telegram_id: String(ctx.from!.id) } });
  if (!user) {
    await ctx.reply('Usuário não encontrado. Use /start.');
    return;
  }
  const data = await exportUserData(store, String(user.id));
  const content = JSON.stringify(data, null, 2);
  await ctx.replyWithDocument(new InputFile(new Blob([content], { type: 'application/json' }), 'meus_dados.json'));
});

bot.command('excluirmeusdados', async (ctx) => {
  const user = await store.selectOne('users', { eq: { telegram_id: String(ctx.from!.id) } });
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
      await ctx.reply('Consentimento registrado. Selecione o tipo de consulta.', { reply_markup: kbMain() });
      return;
    }
    if (data === 'home') {
      await clearState(key);
      await ctx.reply('Selecione o tipo de consulta:', { reply_markup: kbMain() });
      return;
    }
    if (data === 'account') {
      const user = await store.selectOne('users', { eq: { telegram_id: String(tgUser.id) } });
      if (!user) {
        await ctx.reply('Usuário não encontrado.');
        return;
      }
      await ctx.reply(
        `Conta: ${user.name || user.username}\nStatus: ${user.status}\n` +
          `Consentimento: ${(await hasConsent(store, user)) ? 'sim' : 'não'}\n` +
          `Adimplente: ${(await isEntitled(store, user)) ? 'sim' : 'não'}`,
      );
      return;
    }
    if (data === 'billing:checkout') {
      const user = await store.selectOne('users', { eq: { telegram_id: String(tgUser.id) } });
      if (!user || !(await hasConsent(store, user))) {
        await ctx.reply('Aceite os termos com /start antes de assinar.');
        return;
      }
      const plans = await store.select('plans', { eq: { active: true }, limit: 10 });
      if (plans.length === 0) {
        await ctx.reply('Nenhum plano ativo disponível.');
        return;
      }
      try {
        const checkout = await createCheckout(store, { userId: String(user.id), planId: String(plans[0]!.id) });
        await ctx.reply(`Link de pagamento (válido por 30 min):\n${checkout.checkout_url}`);
      } catch (error) {
        await ctx.reply(`Não foi possível gerar o pagamento: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      const decrypted = await decryptText(String(result.raw_encrypted ?? ''));
      let payload: unknown = result.normalized_json;
      try {
        payload = decrypted ? JSON.parse(decrypted) : result.normalized_json;
      } catch {
        void 0;
      }
      const chunks = paginateJson(payload);
      const page = Math.max(0, Math.min(Number.parseInt(pageRaw ?? '0', 10) || 0, chunks.length - 1));
      const keyboard = new InlineKeyboard();
      if (page > 0) {
        keyboard.text('Voltar', `detail:${queryId}:${page - 1}`);
      }
      if (page < chunks.length - 1) {
        keyboard.text('Avançar', `detail:${queryId}:${page + 1}`);
      }
      keyboard.row().text('Exportar JSON', `export:${queryId}`);
      await ctx.reply(`Detalhes ${page + 1}/${chunks.length}\n\`\`\`json\n${chunks[page]}\n\`\`\``, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }
    if (data.startsWith('export:')) {
      const queryId = data.split(':', 2)[1] ?? '';
      const query = await store.selectById('queries', queryId);
      const result = await store.selectById('query_results', queryId, 'query_id');
      if (!query || !result || !(await canAccessQuery(tgUser.id, query))) {
        await ctx.reply('Consulta não encontrada.');
        return;
      }
      const decrypted = await decryptText(String(result.raw_encrypted ?? ''));
      const content = decrypted || JSON.stringify(result.normalized_json ?? {}, null, 2);
      await ctx.replyWithDocument(new InputFile(new Blob([content], { type: 'application/json' }), `consulta_${queryId}.json`));
      return;
    }
  } finally {
    await ctx.answerCallbackQuery();
  }
});

bot.on('message:text', async (ctx) => {
  const key = sessionKey(ctx.chat!.id, ctx.from!.id);
  const { state, data } = await readState(key);
  if (!state) {
    return;
  }
  const text = ctx.message.text;
  const tgUser = ctx.from!;

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
    } else if (keyType === 'cpf') {
      value = onlyDigits(value);
      if (!isValidCpf(value)) {
        await ctx.reply('CPF inválido.');
        return;
      }
    }
    await runAndReply(ctx, { entity: 'VEICULO', keyType, keyValue: value });
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
