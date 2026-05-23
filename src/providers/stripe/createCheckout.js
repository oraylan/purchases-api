// src/providers/stripe/createCheckout.js
//
// Cria uma Stripe Checkout Session (mode subscription) — usado pelo
// site web pra iniciar pagamento. Retorna a URL pra redirecionar o
// usuário.
//
// Receive params do caller (rota) já validados.
import {stripe, priceIdForPlan} from './client.js'

export class CheckoutCreationError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'CheckoutCreationError'
    if (cause) this.cause = cause
  }
}

/**
 * @param {object} args
 * @param {string} args.plan       — 'mensal' | 'semestral' | 'anual'
 * @param {number} args.userId     — id interno do user
 * @param {string} args.userHash   — hash do user (pra metadata)
 * @param {string} args.successUrl
 * @param {string} args.cancelUrl
 * @param {object} [args.taxId]    — {country, type, taxId} opcional
 * @returns {Promise<{id: string, url: string}>}
 */
export async function createCheckoutSession({plan, userId, userHash, successUrl, cancelUrl, taxId}) {
  const price = priceIdForPlan(plan)
  if (!price) {
    throw new CheckoutCreationError(`Plano inválido: ${plan}`)
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{price, quantity: 1}],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: String(userId),
        userHash,
        plano: plan,
      },
      ...(taxId && {
        customer_creation: 'always',
        tax_id_collection: {enabled: true},
      }),
    })
    return {id: session.id, url: session.url}
  } catch (err) {
    throw new CheckoutCreationError(err?.message || 'Erro ao criar checkout', err)
  }
}
