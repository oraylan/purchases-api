// src/app.js
//
// Constrói a instância do Fastify. Separado do `index.js` (que faz
// listen) pra facilitar testes — pode-se importar `createApp` em um
// teste e usar `app.inject({method,url,...})` sem subir servidor.
//
// Decisões:
//   - Logger pino compartilhado com o resto da app (mesmo formato).
//   - `bodyLimit` 1MB (compras carregam JWS médios ~5-15KB; folga).
//   - `disableRequestLogging` false (queremos logs de entrada/saída).
//   - `trustProxy: true` — está atrás de nginx/cloudflare.
//   - `@fastify/sensible` — adiciona `reply.notFound()`, `httpErrors`,
//     etc. Reduz boilerplate em handlers.
//
// O webhook do Stripe (`/webhooks/stripe`) precisa de raw body pra
// validar a assinatura HMAC. Vamos registrar um contentTypeParser
// específico pra essa rota na Fase 4 — Fastify aceita parser por
// rota via `config: {rawBody: true}` + addContentTypeParser global,
// OU via plugin dedicado. Documentado na hora.
import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import {loggerConfig} from './config/logger.js'
import {healthcheckRoutes} from './routes/healthcheck.js'
import {purchaseRoutes} from './routes/purchase.js'
import {platformRoutes} from './routes/platform.js'
import {checkoutStatusRoutes} from './routes/checkoutStatus.js'
import {stripeCheckoutRoutes} from './routes/stripeCheckout.js'
import {appleWebhookRoutes} from './routes/webhooks/apple.js'
import {stripeWebhookPlugin} from './routes/webhooks/stripe.js'
import {adminRoutes} from './routes/admin.js'

export async function createApp() {
  const app = Fastify({
    logger: loggerConfig,
    bodyLimit: 1024 * 1024, // 1 MB
    trustProxy: true,
    // Desliga o log automático "incoming request" + "request completed"
    // do Fastify. Em vez disso, um hook onResponse compacto loga uma
    // ÚNICA linha por request: `METHOD PATH STATUS Xms`. Muito mais
    // legível, estilo nginx/morgan.
    disableRequestLogging: true,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
    ajv: {
      customOptions: {
        allowUnionTypes: true,
        coerceTypes: 'array',
        useDefaults: true,
        removeAdditional: false,
      },
    },
  })

  // Log compacto estilo nginx/morgan — uma linha por request.
  // Skipa /ping e /health pra não poluir (loadbalancer bate sempre).
  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/ping' || req.url === '/health') return
    const ms = Number(reply.elapsedTime).toFixed(0)
    const status = reply.statusCode
    const line = `${req.method} ${req.url} ${status} ${ms}ms`
    if (status >= 500) req.log.error(line)
    else if (status >= 400) req.log.warn(line)
    else req.log.info(line)
  })

  // Plugins utilitários — pequenos helpers (reply.notFound, httpErrors,
  // assert, etc). Não puxam dependência pesada.
  await app.register(sensible)

  // Stripe webhook precisa ser registrado COMO PLUGIN ISOLADO porque
  // troca o contentTypeParser de JSON pra buffer (raw body é exigido
  // pra validar HMAC). Fastify isola contentTypeParser por scope de
  // plugin — outras rotas continuam parseando JSON normal.
  await app.register(stripeWebhookPlugin)

  // Rotas com parser JSON padrão
  await app.register(healthcheckRoutes)
  await app.register(purchaseRoutes)
  await app.register(platformRoutes)
  await app.register(checkoutStatusRoutes)
  await app.register(stripeCheckoutRoutes)
  await app.register(appleWebhookRoutes)
  await app.register(adminRoutes)

  // Error handler global — qualquer throw em handler async cai aqui.
  // Fastify já loga internamente; aqui é só pra moldar a resposta.
  app.setErrorHandler((err, req, reply) => {
    // Erros do @fastify/sensible (httpErrors.*) já trazem statusCode.
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500

    if (statusCode >= 500) {
      req.log.error({err, path: req.url}, 'unhandled error')
    } else {
      req.log.warn({err: err.message, path: req.url}, 'client error')
    }

    reply.status(statusCode).send({
      success: false,
      message: statusCode >= 500 ? 'internal error' : err.message,
    })
  })

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({success: false, message: 'not found'})
  })

  return app
}
