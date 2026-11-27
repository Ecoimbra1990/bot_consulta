# Bot Consulta - Admin

Painel administrativo em React + Vite + TypeScript + Tailwind CSS v4.

## Variáveis de ambiente

Crie `web/.env` com:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel
```

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Cloudflare Workers (workers.dev)

- Framework preset: Vite
- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Root directory: `web`
- `wrangler.jsonc` aponta `assets.directory` para `./dist` e usa `not_found_handling: single-page-application`
- Variáveis de ambiente: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`

Para Pages clássico, use apenas build command/output `dist` e deploy command `true`.
