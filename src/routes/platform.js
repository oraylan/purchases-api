// src/routes/platform.js
//
// GET /plus/platform/:hashUser — informa em qual plataforma o user
// comprou Plus pela última vez. Usado pelo app pra decidir pra onde
// mandar o user gerenciar a assinatura (App Store, Play Store, ou
// Stripe Billing Portal).
import {requireUserAuth} from '../middlewares/auth.js'
import {getLatestPlatform} from '../db/queries/platform.js'

export async function platformRoutes(app) {
  app.get(
    '/plus/platform/:hashUser',
    {
      preHandler: requireUserAuth,
      schema: {
        params: {
          type: 'object',
          required: ['hashUser'],
          properties: {hashUser: {type: 'string', minLength: 1}},
        },
      },
    },
    async (req, reply) => {
      const info = await getLatestPlatform(req.userId)
      if (!info) {
        return reply.status(404).send({error: 'Sem histórico de compra.'})
      }
      if (!['android', 'ios', 'web'].includes(info.platform)) {
        return reply.status(404).send({error: 'Plataforma não reconhecida.'})
      }
      return info
    },
  )
}
