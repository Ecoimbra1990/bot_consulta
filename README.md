# Bot Consulta (Supabase + Cloudflare Workers)

MVP de consultas via Telegram usando **APIBrasil para Pessoa Física (CPF)** — incluindo parentes, contatos e vínculos —, **Verifica Online para CNPJ e Veículos por placa**, além de **APIBrasil** para Telefone, Renavam e frota por CPF, painel admin web, assinaturas via Mercado Pago e retenção de dados conforme LGPD.

## Arquitetura

- **Supabase Edge Functions (Deno/TypeScript)**: webhooks Telegram/Mercado Pago, API admin, `health`, expiração de assinaturas e expurgo de dados.
- **Postgres + RLS**: usuários, planos, assinaturas, pagamentos, consultas, resultados, cache, consentimento, DSR, auditoria, sessões do bot e limitadores. service role fica apenas no backend.
- **React + Vite + TypeScript + Tailwind**: painel administrativo servido como SPA estática via Cloudflare Workers Static Assets (`workers.dev`).
- **pg_cron**: expiração diária de assinaturas e retenção de dados.

## Estrutura

- `supabase/migrations/`: schema, funções, índices, RLS, cron e seed.
- `supabase/functions/`: Edge Functions em Deno/TypeScript.
- `supabase/functions/_shared/`: regras de negócio compartilhadas (crypto, billing, queries, DSR, provider, normalização).
- `web/`: SPA administrativa e `wrangler.jsonc` dos Workers Static Assets.
- `scripts/migrate/`: migração Firestore → Postgres com re-encriptação Fernet → AES-GCM.
- `tests/`: testes Vitest das regras portadas.

## Setup local

1. Instale Node 20+, npm, Docker e Supabase CLI.
2. `npm install` na raiz.
3. Copie `.env.example` para `.env` e `web/.env.example` para `web/.env`; preencha os valores locais.
4. `supabase start` e `supabase db reset`.
5. `supabase functions serve --env-file .env`.
6. `npm run dev` para abrir o painel em `http://localhost:5173`.
7. Crie o usuário admin no Supabase Auth com `app_metadata: { "role": "admin" }` e e-mail igual a `ADMIN_EMAIL`.

## Migração do Firestore

1. Preencha `FIREBASE_SERVICE_ACCOUNT_JSON` (ou use `GOOGLE_APPLICATION_CREDENTIALS`), `FERNET_KEY`, `FERNET_PREVIOUS_KEYS`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
2. Execute `npm run migrate --workspace bot-consulta-migrate`.
3. O script gera IDs determinísticos a partir dos IDs legados e imprime as contagens finais por tabela.

Senhas bcrypt não são importáveis: recrie o usuário admin pelo Auth Admin API.

## Deploy

### Supabase

1. `supabase link --project-ref SEU_PROJECT_REF` e `supabase db push`.
2. Configure os segredos com `supabase secrets set NOME=valor` para todas as variáveis de runtime do `.env.example`, incluindo `ALLOWED_ORIGINS` para o domínio do painel.
3. Registre `project_url` e `cron_secret_key` no Vault para o pg_cron.
4. Faça deploy das funções:
   - `supabase functions deploy health`
   - `supabase functions deploy telegram-webhook`
   - `supabase functions deploy mercadopago-webhook`
   - `supabase functions deploy admin-api`
   - `supabase functions deploy expire-subscriptions`
   - `supabase functions deploy retention-purge`
   - `supabase functions deploy sync-api-catalog`

### Cloudflare Workers (workers.dev)

- Root directory: `web`.
- Framework preset: Vite.
- Build command: `npm run build`.
- Deploy command: `npm run deploy` (nunca deixe vazio nem use `None`).
- Build output directory: `dist`.
- `web/wrangler.jsonc` aponta `assets.directory` para `./dist` e usa `not_found_handling: single-page-application`.
- Variáveis: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- URL esperada: `https://bot-consulta.ankecs.workers.dev`.

Se o projeto for Cloudflare Pages clássico, mantenha apenas build/output (`dist`) e use `true` como deploy command; não combine as duas configurações no mesmo projeto.

## Webhooks

- Telegram: aponte para a URL de `telegram-webhook` e configure o header `X-Telegram-Bot-Api-Secret-Token` com `TELEGRAM_WEBHOOK_SECRET`.
- Mercado Pago: aponte para a URL de `mercadopago-webhook` e configure `MERCADOPAGO_WEBHOOK_SECRET` para validar `x-signature`.

## Provedores

A Verifica Online é usada quando há dataset equivalente (docs em https://docs.verifica-online.com.br/docs/verifica-online-api/introducao):

- Empresa: `POST /datasets/cnpj_dados_basicos/queries`.
- Veículo por placa: `POST /datasets/consulta_placa/queries` (básica) ou `/datasets/veicular_completa/queries` (completa).

O CPF é sempre consultado na APIBrasil com `tipo=dados-cadastrais`, porque o dataset `cpf_dados_completos` da Verifica Online não contém parentesco. A resposta inclui a seção "Parentes" com nome, documento/CPF e vínculo (ou grau/campo) informados.

O `sync-api-catalog` lê `GET /datasets` da Verifica Online e substitui os módulos correspondentes no catálogo, preservando o preço real em `api_modules.cost_cents`. Requisições usam `Authorization: Bearer VERIFICA_ONLINE_API_KEY` e `Idempotency-Key` determinística por dia; respostas `processing` são consultadas em `GET /queries/{request_id}` e cobranças `402` viram "saldo insuficiente".

A APIBrasil permanece nos fluxos sem dataset equivalente (docs em https://doc.apibrasil.io/):

- Frota por CPF: `POST /consulta/veiculos/credits` com `tipo=frota-pf`.
- Renavam: a APIBrasil não expõe consulta direta; o bot pede o CPF do proprietário, consulta a frota e filtra o Renavam informado.
- Telefone: `POST /consulta/cpf-cnpj-pelo-telefone/credits`, enriquecido com `POST /consulta/telefone/credits`.

Sem token e com `APIBRASIL_MODE_MOCK=true` em dev, o adapter da APIBrasil retorna dados fictícios; isso é bloqueado em produção.

## LGPD

Consentimento versionado é exigido no `/start`; `/meusdados` exporta os dados do titular e `/excluirmeusdados` abre uma solicitação revisada no painel. O job de retenção remove resultados crus após `RAW_RETENTION_DAYS`, preservando auditoria e registros financeiros. Valide a base legal e a política de privacidade juridicamente antes de produção.

## Testes

- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `supabase test db` quando o Supabase CLI estiver disponível.
