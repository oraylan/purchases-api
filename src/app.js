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
// O webhook do Stripe (`/stripeNotification`) precisa de raw body pra
// validar a assinatura HMAC. Vamos registrar um contentTypeParser
// específico pra essa rota na Fase 4 — Fastify aceita parser por
// rota via `config: {rawBody: true}` + addContentTypeParser global,
// OU via plugin dedicado. Documentado na hora.
import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import {loggerConfig} from './config/logger.js'
import {healthcheckRoutes} from './routes/healthcheck.js'

export async function createApp() {
  const app = Fastify({
    logger: loggerConfig,
    bodyLimit: 1024 * 1024, // 1 MB
    trustProxy: true,
    disableRequestLogging: false,
    // Fastify v5 moveu opções de roteador pra routerOptions
    routerOptions: {
      ignoreTrailingSlash: true,
    },
  })

  // Plugins utilitários — pequenos helpers (reply.notFound, httpErrors,
  // assert, etc). Não puxam dependência pesada.
  await app.register(sensible)

  // TODO Fase 4: registrar plugin de raw body só pra rota Stripe
  // (vamos adicionar `app.addContentTypeParser('application/json', {parseAs: 'buffer'}, ...)`
  // com escopo de plugin via `app.register(stripeWebhookPlugin, {prefix: '/stripeNotification'})`).

  // Rotas
  await app.register(healthcheckRoutes)

  // TODO Fase 4: outras rotas (purchase, platform, checkout, admin).

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
