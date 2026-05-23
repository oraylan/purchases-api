// src/routes/purchase.js
//
// POST /purchase/v3 — endpoint principal da api. App manda compras
// iOS (JWS) e Android (token + orderId). v2 NÃO existe aqui (legacy
// fica na apiv2).
//
// Schema de body valida estrutura mínima — Fastify rejeita 400 antes
// de chegar no handler. Campos opcionais ficam soltos (não estoura).
import {requireUserAuth} from '../middlewares/auth.js'
import {CODES, fail} from '../handlers/shared.js'
import {handleAndroidPurchase} from '../handlers/handleAndroidPurchase.js'
import {handleIosPurchase} from '../handlers/handleIosPurchase.js'

const purchaseBodySchema = {
  type: 'object',
  required: ['hashUser', 'platform', 'purchase_token', 'product_id'],
  properties: {
    hashUser: {type: 'string', minLength: 1},
    platform: {type: 'string', enum: ['android', 'ios']},
    purchase_token: {type: 'string', minLength: 1},
    order_id: {type: ['string', 'null']},
    product_id: {type: 'string', minLength: 1},
    purchase_time: {type: ['number', 'string', 'null']},
    pagamento_unico: {type: ['boolean', 'number'], default: false},
  },
}

export async function purchaseRoutes(app) {
  app.post(
    '/purchase/v3',
    {
      preHandler: requireUserAuth,
      schema: {body: purchaseBodySchema},
    },
    async (req, reply) => {
      const {platform} = req.body
      req.log.info(
        {userId: req.userId, platform, orderId: req.body.order_id, oneTime: Boolean(req.body.pagamento_unico)},
        'recebendo compra',
      )

      if (platform === 'android') return handleAndroidPurchase(req, reply)
      if (platform === 'ios') return handleIosPurchase(req, reply)

      return fail(reply, {
        message: 'Plataforma inválida.',
        code: CODES.GEN_ERR_INVALID_PLATFORM,
        status: 400,
      })
    },
  )
}
