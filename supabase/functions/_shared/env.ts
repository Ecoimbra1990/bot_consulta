interface EnvLike {
  get(name: string): string | undefined;
}

const host = globalThis as typeof globalThis & { Deno?: { env: EnvLike }; process?: { env?: Record<string, string | undefined> } };

export function env(name: string, fallback = ''): string {
  const fromDeno = host.Deno?.env?.get(name);
  if (fromDeno !== undefined && fromDeno !== null) {
    return fromDeno;
  }
  return host.process?.env?.[name] ?? fallback;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} não configurado`);
  }
  return value;
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  appEnv: env('APP_ENV', 'dev'),
  isProduction: ['prod', 'production'].includes(env('APP_ENV', 'dev').trim().toLowerCase()),
  baseUrl: env('BASE_URL', ''),
  supabaseUrl: env('SUPABASE_URL', ''),
  secretKey: env('SECRET_KEY', 'change-me'),
  encryptionKeys: env('ENCRYPTION_KEYS', ''),
  fernetKey: env('FERNET_KEY', ''),
  consentVersion: env('CONSENT_VERSION', 'v1'),
  adminTelegramId: env('ADMIN_TELEGRAM_ID', ''),
  pricingMultiplier: Number.parseFloat(env('PRICING_MARGIN_MULTIPLIER', '2')) || 2,
  queriesPerMinute: positiveInt(env('QUERIES_PER_MINUTE', '10'), 10),
  queryCacheTtlSeconds: positiveInt(env('QUERY_CACHE_TTL_SECONDS', '86400'), 86400),
  rawRetentionDays: positiveInt(env('RAW_RETENTION_DAYS', '90'), 90),
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN'),
    webhookSecret: env('TELEGRAM_WEBHOOK_SECRET', 'change-me'),
  },
  mercadoPago: {
    accessToken: env('MERCADOPAGO_ACCESS_TOKEN'),
    webhookSecret: env('MERCADOPAGO_WEBHOOK_SECRET'),
    apiBase: env('MERCADOPAGO_API_BASE', 'https://api.mercadopago.com').replace(/\/$/, ''),
    payerEmail: env('MERCADOPAGO_PAYER_EMAIL', ''),
    notificationUrl: env('MERCADOPAGO_NOTIFICATION_URL', ''),
  },
  apiBrasil: {
    token: env('APIBRASIL_TOKEN'),
    baseUrl: env('APIBRASIL_BASE_URL', 'https://gateway.apibrasil.io/api/v2').replace(/\/$/, ''),
    pfPath: env('APIBRASIL_PF_PATH', '/consulta/cpf/credits'),
    vehiclePlatePath: env('APIBRASIL_VEHICLE_PLATE_PATH', '/consulta/veiculos/credits'),
    vehicleFleetPath: env('APIBRASIL_VEHICLE_FLEET_PATH', '/consulta/veiculos/credits'),
    vehicleFullPath: env('APIBRASIL_VEHICLE_FULL_PATH', '/consulta/veiculos/credits'),
    phonePath: env('APIBRASIL_PHONE_PATH', '/consulta/cpf-cnpj-pelo-telefone/credits'),
    phoneOperatorPath: env('APIBRASIL_PHONE_OPERATOR_PATH', '/consulta/telefone/credits'),
    companyPath: env('APIBRASIL_COMPANY_PATH', '/consulta/cnpj/credits'),
    catalogUrl: env('APIBRASIL_CATALOG_URL', ''),
    accountUrl: env('APIBRASIL_ACCOUNT_URL', ''),
    mock: env('APIBRASIL_MODE_MOCK', 'false').toLowerCase() === 'true',
  },
};

export function validateRuntime(): void {
  if (!config.isProduction) {
    return;
  }
  const insecure = [
    config.secretKey === 'change-me' ? 'SECRET_KEY' : '',
    config.telegram.webhookSecret === 'change-me' ? 'TELEGRAM_WEBHOOK_SECRET' : '',
  ].filter(Boolean);
  if (insecure.length > 0) {
    throw new Error(`Segredos obrigatórios não configurados: ${insecure.join(', ')}`);
  }
  if (!config.encryptionKeys && !config.fernetKey) {
    throw new Error('ENCRYPTION_KEYS é obrigatório em produção');
  }
  if (!config.apiBrasil.token) {
    throw new Error('APIBRASIL_TOKEN é obrigatório em produção');
  }
  if (config.apiBrasil.mock) {
    throw new Error('APIBRASIL_MODE_MOCK não pode ser usado em produção');
  }
}
