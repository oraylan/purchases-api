// src/providers/stripe/billingPortal.js
//
// Cria uma sessão do Stripe Billing Portal — onde o user gerencia
// método de pagamento, cancela sub, vê histórico de invoices.
import {stripe} from './client.js'

export class BillingPortalError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'BillingPortalError'
    if (cause) this.cause = cause
  }
}

/**
 * @param {object} args
 * @param {string} args.customerId  — stripe_customer_id (cus_...)
 * @param {string} args.returnUrl
 * @returns {Promise<{url: string}>}
 */
export async function createBillingPortalSession({customerId, returnUrl}) {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
    return {url: session.url}
  } catch (err) {
    throw new BillingPortalError(err?.message || 'Erro ao abrir portal Stripe', err)
  }
}
