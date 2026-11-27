import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VERIFICA_ONLINE_API_KEY', 'voa_test_key');
vi.stubEnv('VERIFICA_ONLINE_API_BASE', 'https://api.verifica-online.test');

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('adaptador Verifica Online', () => {
  it('envia CPF ao dataset correto e devolve o custo cobrado', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => json({
      status: 'succeeded',
      request_id: 'req-pf',
      billing: { amount_cents: 399 },
      data: {
        basic: { name: 'Maria Silva', registration_status: 'Regular', mother_name: 'Ana', birth_date: '1980-01-01' },
        documents: { rg: '12345678' },
        addresses: [{ street: 'Rua A', city: { name: 'São Paulo' }, state: { abbreviation: 'SP' } }],
        phones: [{ e164: '5511999999999' }],
        emails: [{ email: 'maria@example.com' }],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { VerificaOnlineAdapter } = await import('../supabase/functions/_shared/provider.ts');

    const result = await new VerificaOnlineAdapter().queryPfCpf('52998224725');

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('verifica-online');
    expect(result.cost_cents).toBe(399);
    expect(result.normalized.nome).toBe('Maria Silva');
    expect(result.normalized.cpf).toBe('***4725');
    expect(result.normalized.telefones).toEqual(['****9999']);
    expect(result.normalized.emails).toEqual(['maria@example.com']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.verifica-online.test/datasets/cpf_dados_completos/queries');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ cpf: '52998224725' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer voa_test_key');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^voa-[0-9a-f]{40}$/);
  });

  it('faz polling de respostas processing reutilizando a mesma chave de idempotência', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json({ status: 'processing', request_id: 'req-42' });
      }
      return json({
        status: 'succeeded',
        request_id: 'req-42',
        billing: { amount_cents: 250 },
        data: { basic: { name: 'João', registration_status: 'Regular' } },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { VerificaOnlineAdapter } = await import('../supabase/functions/_shared/provider.ts');

    const result = await new VerificaOnlineAdapter().queryPfCpf('52998224725');

    expect(result.ok).toBe(true);
    expect(result.normalized.nome).toBe('João');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [postUrl, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [pollUrl, pollInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postUrl).toContain('/datasets/cpf_dados_completos/queries');
    expect(pollUrl).toBe('https://api.verifica-online.test/queries/req-42');
    expect((pollInit.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (postInit.headers as Record<string, string>)['Idempotency-Key'],
    );
  });

  it('reporta saldo insuficiente sem tentar novamente', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => json({ error: { code: 'insufficient_funds', message: 'Saldo insuficiente' } }, 402));
    vi.stubGlobal('fetch', fetchMock);
    const { VerificaOnlineAdapter } = await import('../supabase/functions/_shared/provider.ts');

    const result = await new VerificaOnlineAdapter().queryCompanyCnpj('11444777000161');

    expect(result).toMatchObject({ ok: false, provider: 'verifica-online', cost_cents: 0 });
    expect(result.error).toContain('Saldo insuficiente');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('usa veicular_completa na consulta completa de placa', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => json({
      status: 'partial',
      billing: { amount_cents: 1290 },
      data: {
        vehicle: {
          plate: 'ABC1D23',
          renavam: '12345678901',
          brand: 'Fiat',
          model: 'Uno',
          manufacture_year: 2020,
          model_year: 2021,
          color: 'Branco',
          status: 'Regular',
        },
        fipe_candidates: [{ chassi: '9BD12345678901234', manufacture_year: 2020, model_year: 2021, color: 'Branco' }],
        owner: { name: 'João', document: '12345678909' },
        indicators: { theft: false, auction: false },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { VerificaOnlineAdapter } = await import('../supabase/functions/_shared/provider.ts');

    const result = await new VerificaOnlineAdapter().queryVehiclePlate('ABC1D23', true);

    expect(result.ok).toBe(true);
    expect(result.normalized.marca_modelo).toBe('Fiat/Uno');
    expect(result.normalized.renavam).toBe('***8901');
    expect(result.normalized.chassi).toBe('***1234');
    expect(result.normalized.proprietario.documento).toBe('***8909');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.verifica-online.test/datasets/veicular_completa/queries');
    expect(JSON.parse(String(init.body))).toEqual({ plate: 'ABC1D23' });
  });

  it('não chama a API para serviços sem dataset equivalente', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { VerificaOnlineAdapter } = await import('../supabase/functions/_shared/provider.ts');

    const adapter = new VerificaOnlineAdapter();
    expect((await adapter.queryPhone()).ok).toBe(false);
    expect((await adapter.queryVehicleByCpf()).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
