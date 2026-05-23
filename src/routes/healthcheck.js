// src/routes/healthcheck.js
//
// Endpoints leves pra liveness/readiness. Não acessam banco — só
// confirmam que o processo está vivo. Útil pro nginx/cloudflare.
//
// Schemas de resposta servem 2 propósitos:
//   1) Fastify usa pra serializar resposta (mais rápido que JSON.stringify).
//   2) Documenta o contrato da rota.
//
// `logLevel: 'silent'` desliga o request log nessa rota — senão health
// polui muito o output (loadbalancer bate de 5 em 5s).
export async function healthcheckRoutes(app) {
  app.get(
    '/ping',
    {
      logLevel: 'silent',
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              ok: {type: 'boolean'},
              ts: {type: 'number'},
            },
          },
        },
      },
    },
    async () => ({ok: true, ts: Date.now()}),
  )

  app.get(
    '/health',
    {
      logLevel: 'silent',
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              ok: {type: 'boolean'},
              service: {type: 'string'},
              uptime: {type: 'number'},
              ts: {type: 'number'},
            },
          },
        },
      },
    },
    async () => ({
      ok: true,
      service: 'purchases-api',
      uptime: process.uptime(),
      ts: Date.now(),
    }),
  )
}
