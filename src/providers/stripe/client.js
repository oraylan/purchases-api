// src/providers/stripe/client.js
//
// Cliente Stripe — singleton. A lib gerencia conexões internamente,
// só criamos uma vez no boot.
import Stripe from 'stripe'
import {env} from '../../config/env.js'

export const stripe = new Stripe(env.stripe.secretKey, {
  // Não fixamos apiVersion — usa a default da lib (sempre a mais nova
  // suportada). Stripe garante backward compat dentro da mesma major.
  typescript: false,
})

/**
 * Resolve um plano "amigável" (mensal/semestral/anual) pro price_id
 * configurado em env. Centraliza pra não espalhar IDs hardcoded.
 */
export function priceIdForPlan(plan) {
  const map = {
    mensal: env.stripe.prices.monthly,
    semestral: env.stripe.prices.semestral,
    anual: env.stripe.prices.annual,
  }
  return map[plan] ?? null
}
