// src/providers/stripe/verifyWebhook.js
//
// Valida a assinatura HMAC do webhook Stripe. CRÍTICO: sem isso, qualquer
// um que descubra a URL pode forjar eventos.
//
// Usado pelo handler de /stripeNotification — precisa do raw body (não
// JSON-parsed) pra calcular o HMAC. Por isso o Fastify registra a rota
// com contentTypeParser próprio que preserva o buffer.
import {stripe} from './client.js'
import {env} from '../../config/env.js'

export class StripeWebhookSignatureError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'StripeWebhookSignatureError'
    if (cause) this.cause = cause
  }
}

/**
 * @param {Buffer} rawBody
 * @param {string} signatureHeader  — valor de req.headers['stripe-signature']
 * @returns {object} Stripe.Event decodificado
 */
export function verifyAndDecodeStripeEvent(rawBody, signatureHeader) {
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      env.stripe.webhookSecret,
    )
  } catch (err) {
    throw new StripeWebhookSignatureError(
      `Assinatura Stripe inválida: ${err?.message}`,
      err,
    )
  }
}
