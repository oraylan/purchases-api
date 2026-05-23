// src/middlewares/stripeRawBody.js
//
// Plugin Fastify que substitui o parser JSON padrão por um que mantém
// o raw Buffer — necessário pra validar a assinatura HMAC do webhook
// Stripe (que assina o byte exato do corpo).
//
// Aplicado SÓ no scope do plugin Stripe — registrado em `routes/webhooks/stripe.js`
// via `app.register(stripeWebhookPlugin, { prefix: '/webhooks/stripe' })`.
// Fora desse scope, o resto da app usa o express.json() padrão.

export async function stripeRawBodyPlugin(app) {
  // Override do content type parser PARA ESTE PLUGIN ONLY.
  // Quando o body é JSON, ao invés de fazer JSON.parse, devolve o Buffer cru.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', {parseAs: 'buffer'}, (req, body, done) => {
    done(null, body)
  })
}
