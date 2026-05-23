// src/routes/notifications/stripe.js
//
// POST /stripeNotification — webhook Stripe. Recebe raw buffer
// (necessário pra validar assinatura HMAC), valida com a lib, e
// despacha pro handler de domínio.
//
// Registrado como plugin SEPARADO no Fastify pra ter o
// `stripeRawBodyPlugin` (removeContentTypeParser + reAddCom parseAs:
// buffer) sem afetar o resto da api.
import {stripeRawBodyPlugin} from '../../middlewares/stripeRawBody.js'
import {verifyAndDecodeStripeEvent, StripeWebhookSignatureError} from '../../providers/stripe/verifyWebhook.js'
import {handleStripeNotification} from '../../handlers/handleStripeNotification.js'

async function stripeWebhookHandler(req, reply) {
  const signature = req.headers['stripe-signature']
  if (!signature) {
    req.log.warn('[stripe] webhook sem stripe-signature header')
    return reply.status(400).send('missing signature')
  }

  let event
  try {
    event = verifyAndDecodeStripeEvent(req.body, signature)
  } catch (err) {
    if (err instanceof StripeWebhookSignatureError) {
      req.log.error({err: err.message, ip: req.ip}, '[stripe] assinatura inválida')
      return reply.status(400).send(`Webhook Error: ${err.message}`)
    }
    throw err
  }

  req.log.info({type: event.type, eventId: event.id}, '[stripe] evento recebido')

  try {
    await handleStripeNotification(event)
  } catch (err) {
    req.log.error({err: err.message, type: event.type}, '[stripe] erro processando evento')
    // Responde 200 mesmo assim — Stripe retenta em 4xx/5xx, e a gente
    // não quer ficar reprocessando algo que já falhou. Idealmente
    // gravar event.id pra retry manual depois.
  }

  return reply.status(200).send('ok')
}

export async function stripeNotificationPlugin(app) {
  await app.register(stripeRawBodyPlugin)
  app.post('/stripeNotification', stripeWebhookHandler)
}
