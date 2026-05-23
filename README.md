# purchases-api

API dedicada a compras da Hunter.FM. Substitui a parte de purchases que vivia na **apiv2** — a partir da versão do app que estamos lançando, é essa API que os clientes batem.

## Escopo

| O que faz                                                  | Onde                                  |
| ---------------------------------------------------------- | ------------------------------------- |
| Validação de compra iOS (StoreKit 2 / JWS)                 | `POST /purchase/v3`                   |
| Validação de compra Android (Google Play Billing inicial)  | `POST /purchase/v3`                   |
| Checkout Stripe (web)                                      | `POST /checkout`, `/checkout/portal`  |
| Webhook Apple ASN V2 (sandbox + produção)                  | `POST /purchaseNotification`          |
| Webhook Stripe                                             | `POST /stripeNotification`            |
| Consulta de plataforma e status Plus                       | `GET /plus/platform/:hashUser`        |
| Consulta de status Plus                                    | `GET /checkout/:hashUser`             |
| Admin: solicitar ASN de teste à Apple                      | `POST /admin/asn-test`                |
| Cron de reconciliação diária (anti-zumbi)                  | interno, 04:00 BRT                    |

## O que NÃO faz

- **Pub/Sub Google Play** — fica no projeto `plus-manager`, que já cobre tudo (renovação, cancelamento, expiração). A purchases-api só atende o app na compra inicial e validação síncrona via Google Play Developer API.
- **`/purchase/v2` (verifyReceipt legacy)** — apps antigos publicados antes da v14 continuam batendo na **apiv2**, que fica viva no ar. Aqui só tem v3.

## Stack

- Node 20.x, ES modules (`"type": "module"`)
- Express 4
- MySQL (`adawong`) + PostgreSQL (`ht_advert`)
- `@apple/app-store-server-library` 3
- `googleapis` 134 (Android Publisher v3)
- `stripe` 18
- `discord.js` 14 (alertas)
- `pino` (logger estruturado)
- `pm2` (processo)

## Estrutura

```
src/
├── index.js               # entry: bootstrap + start
├── app.js                 # cria Express app (sem listen)
├── config/
│   ├── env.js             # carrega + valida env (fail-fast)
│   └── logger.js          # pino
├── db/
│   ├── mysql.js           # pool MySQL
│   ├── pg.js              # pool Postgres
│   └── queries/           # queries por domínio (purchases, users, ios, android, stripe, pending, ...)
├── providers/             # integrações externas
│   ├── apple/             # client, verifier, verifyTransaction, verifyNotification, testNotification
│   ├── google/            # client, verifySubscription, verifyProduct
│   └── stripe/            # client, createCheckout, billingPortal
├── comms/                 # discord, push, email, notify (orquestrador)
├── middlewares/           # auth, validação, raw body do Stripe
├── handlers/              # lógica de negócio (compartilhada entre rotas)
├── routes/                # rotas HTTP
└── jobs/                  # crons (reconciliação)
.secrets/                  # .p8 Apple + .json Google (NÃO versionado)
```

## Subir local

```
yarn install
cp .env.example .env       # preenche os valores
# coloca a .p8 e o .json em .secrets/
yarn dev                   # com nodemon
```

## Produção (pm2)

```
yarn pm2:start
yarn pm2:logs
```

## Banco de dados

**Mesmo banco da apiv2** — não duplica tabelas. As principais:

| Tabela                       | Uso                                                                |
| ---------------------------- | ------------------------------------------------------------------ |
| `user_plus`                  | Histórico de compras (Android, iOS, Stripe)                        |
| `purchases`                  | Log de notificações (Apple ASN, Stripe webhook)                    |
| `plus_ios_subscriptions`     | Map originalTransactionId → user (evita reuso entre contas)        |
| `plus_android_subscriptions` | Map orderId → user (idem Android)                                  |
| `user`                       | Permission bitfield (flag `premium`)                               |
| `user_stream_cfg`            | Configs de stream Plus (Hunter News, Interads)                     |

Postgres `ht_advert.user_plus` é uma **réplica passiva** usada pelo serviço de ads pra desligar anúncios pra Plus.

## Cron de reconciliação

Diariamente às 04:00 BRT, o job `reconcileSubscriptions` percorre os users marcados como Plus e confere o estado real:

- **Apple**: consulta `subscriptionsStatus` via App Store Server API.
- **Stripe**: consulta `customer.subscriptions.list` na Stripe API.
- **Android**: pula — o `plus-manager` (worker Pub/Sub) já é a fonte de verdade.

Se acha um user Plus localmente que **não está ativo na plataforma**, dispara `removePremium` + alerta Discord. Esse é o muro de contenção contra "assinaturas zumbi".
