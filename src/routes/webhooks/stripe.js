// src/routes/webhooks/stripe.js
//
// POST /webhooks/stripe — webhook Stripe. Recebe raw buffer
// (necessário pra validar assinatura HMAC), valida com a lib, e
// despacha pro handler de domínio.
//
// Registrado como plugin SEPARADO no Fastify pra que o
// removeContentTypeParser + addContentTypeParser (parseAs: buffer)
// fiquem encapsulados nesse scope e não afetem o resto da api.
//
// IMPORTANTE: o override do parser PRECISA acontecer no MESMO scope
// onde a rota é registrada. Registrar via `app.register(rawBodyPlugin)`
// aninhado cria um child scope — o parser fica nele, mas a rota
// continua no scope pai e acaba usando o JSON parser herdado. Por isso
// `removeContentTypeParser` + `addContentTypeParser` são chamados
// inline aqui, antes de `app.post`.
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

export async function stripeWebhookPlugin(app) {
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', {parseAs: 'buffer'}, (req, body, done) => {
    done(null, body)
  })
  app.post('/webhooks/stripe', stripeWebhookHandler)
}
