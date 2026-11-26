# Bot Consulta (Firebase + Telegram + Admin Web)

MVP de consultas via Telegram usando **APIBrasil como único provedor** para Pessoa Física (CPF), Veículos (placa/Renavam/CPF atrelado), Telefone e Empresas (CNPJ), com painel admin web, assinaturas via Mercado Pago e retenção de dados conforme LGPD, hospedado no **Firebase**.

## Arquitetura Firebase
- **Firebase Functions (Python 2nd gen)**: webhooks Telegram/Mercado Pago, painel admin, jobs agendados de expiração e expurgo.
- **Firestore**: usuários, planos, assinaturas, pagamentos, consultas, resultados, cache, consentimento, DSR, auditoria, sessões do bot e limitadores.
- **Firebase Hosting**: página inicial e rewrites para Functions (`/admin/**`, `/webhooks/**`, `/health`).
- **Cloud Scheduler**: expiração diária de assinaturas e expurgo de dados sensíveis.

## Estrutura
- `functions/main.py`: entrypoints Firebase Functions.
- `functions/app/bot/`: handlers Telegram e storage de FSM no Firestore.
- `functions/app/admin/`: painel admin Flask/Jinja2 com CSRF.
- `functions/app/providers/`: adapter único da APIBrasil e normalização tipada.
- `functions/app/services/`: regras de negócio, billing, entitlement, consultas, LGPD e rate limit.
- `functions/app/db/repositories.py`: acesso Firestore.
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`: config Firebase.

## Setup local (Firebase Emulator)
1. Instale Firebase CLI e Python 3.11+.
2. `cd functions && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt`
3. Copie `functions/.env.example` para `functions/.env` e preencha os valores.
4. Na raiz: `firebase emulators:start`
5. Admin: URL do Hosting/Function emulator em `/admin/login`.

## Deploy
1. `firebase login`
2. Ajuste `.firebaserc` com seu project id.
3. Configure segredos (recomendado):
   - `firebase functions:secrets:set SECRET_KEY`
   - `firebase functions:secrets:set FERNET_KEY`
   - `firebase functions:secrets:set ADMIN_EMAIL`
   - `firebase functions:secrets:set ADMIN_PASSWORD`
   - `firebase functions:secrets:set TELEGRAM_BOT_TOKEN`
   - `firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET`
   - `firebase functions:secrets:set MERCADOPAGO_ACCESS_TOKEN`
   - `firebase functions:secrets:set MERCADOPAGO_WEBHOOK_SECRET`
   - `firebase functions:secrets:set APIBRASIL_TOKEN`
4. Opcionalmente defina `FERNET_PREVIOUS_KEYS` no ambiente para rotação de chaves.
5. `firebase deploy`

Em produção, `SECRET_KEY`, `ADMIN_PASSWORD`, `TELEGRAM_WEBHOOK_SECRET`, `FERNET_KEY` e `APIBRASIL_TOKEN` são obrigatórios; valores `change-me` e modo mock são rejeitados.

## Webhooks
- Telegram: aponte para `https://us-central1-consulta-fc363.cloudfunctions.net/webhooks/webhooks/telegram` (ou rewrite Hosting `/webhooks/telegram`). Configure secret token.
- Mercado Pago: aponte para `https://us-central1-consulta-fc363.cloudfunctions.net/webhooks/webhooks/mercadopago`. Configure `MERCADOPAGO_WEBHOOK_SECRET` para validar a assinatura do webhook.

## Provedor APIBrasil
Os caminhos e `tipo` seguem a documentação oficial em https://doc.apibrasil.io/:
- CPF: `POST /consulta/cpf/credits` com `tipo=cpf-cadastral`.
- Veículo por placa: `POST /consulta/veiculos/credits` com `tipo=nacional`.
- Frota por CPF: `POST /consulta/veiculos/credits` com `tipo=frota-pf`.
- Renavam: a APIBrasil não expõe consulta direta por Renavam; o bot pede o CPF do proprietário, consulta a frota e filtra o Renavam informado.
- Telefone: `POST /consulta/cpf-cnpj-pelo-telefone/credits` com `tipo=cpf-cnpj-pelo-telefone`, enriquecido com `POST /consulta/telefone/credits` (`tipo=telefone-operadora`).
- Empresa: `POST /consulta/cnpj/credits` com `tipo=cnpj-receita`.

Sem token e com `APIBRASIL_MODE_MOCK=true` em dev, o adapter retorna dados fictícios no mesmo formato da API; em produção isso é bloqueado. Antes de usar em produção, valide a resposta com `homolog: true`, sem cobrança, usando os documentos de teste da documentação.

## LGPD
Consentimento versionado é exigido no `/start`; `/meusdados` exporta os dados do titular e `/excluirmeusdados` abre uma solicitação revisada no painel admin. O job diário de retenção remove resultados crus após `RAW_RETENTION_DAYS`, preservando trilha de auditoria e registros financeiros. A base legal e a política de privacidade devem ser validadas juridicamente antes de produção.

## Testes
- `python -m pytest -q` na raiz.
- Para integração local: `firebase emulators:exec --only functions,firestore "python -m pytest -q"`.
