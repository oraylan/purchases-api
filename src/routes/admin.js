// src/routes/admin.js
//
// POST /admin/asn-test — pede pra Apple disparar uma notificação de
// teste pra confirmar que o webhook /purchaseNotification está
// acessível. Apple posta em ~5s. Cruzar o `testNotificationToken`
// devolvido aqui com o que aparece nos logs do webhook.
import {requireAdminToken} from '../middlewares/requireAdminToken.js'
import {requestTestNotification} from '../providers/apple/testNotification.js'

const asnTestBodySchema = {
  type: 'object',
  properties: {
    env: {type: 'string', enum: ['production', 'sandbox'], default: 'sandbox'},
  },
}

export async function adminRoutes(app) {
  app.post(
    '/admin/asn-test',
    {
      preHandler: requireAdminToken,
      schema: {body: asnTestBodySchema},
    },
    async (req, reply) => {
      const env = req.body?.env === 'production' ? 'production' : 'sandbox'
      req.log.info({env}, '[admin] solicitando ASN de teste à Apple')
      try {
        const result = await requestTestNotification(env)
        return {
          success: true,
          env,
          testNotificationToken: result.testNotificationToken,
          message: 'Apple vai postar em /purchaseNotification em ~5s.',
        }
      } catch (err) {
        req.log.error({err: err.message}, '[admin] falha ao pedir ASN de teste')
        return reply.status(500).send({success: false, message: err.message})
      }
    },
  )
}
