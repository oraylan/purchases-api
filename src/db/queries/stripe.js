// src/db/queries/stripe.js
//
// Queries específicas do Stripe — busca de stripe_customer_id pra
// abrir billing portal e detectar plataforma de origem.
import {pool} from '../mysql.js'
import {findUserIdByHash} from './users.js'

/**
 * Resolve um hashUser → stripe_customer_id (web).
 *
 * Retorno padronizado:
 *   { status: 'not_found' }                            — user inexistente OU sem compras
 *   { status: 'other_platform', platform: 'ios' }      — user tem Plus mas via outra plataforma
 *   { status: 'ok', customerId: 'cus_...' }            — pode abrir portal Stripe
 *
 * Usado por `/checkout/portal` pra abrir o billing portal Stripe.
 */
export async function findStripeCustomerIdByHash(hashUser) {
  const userId = await findUserIdByHash(hashUser)
  if (!userId) return {status: 'not_found'}

  const [results] = await pool.query(
    `SELECT stripe_customer_id, platform
       FROM user_plus
       WHERE user_id = ? AND stripe_customer_id IS NOT NULL
       ORDER BY date_create DESC
       LIMIT 1`,
    [userId],
  )

  if (results.length === 0) return {status: 'not_found'}

  const row = results[0]
  if (row.platform !== 'web') {
    return {status: 'other_platform', platform: row.platform}
  }
  return {status: 'ok', customerId: row.stripe_customer_id}
}

/**
 * Upsert de tax_id (CPF/CNPJ) — usado no checkout Stripe pra emitir
 * nota fiscal automática. Faz INSERT...ON DUPLICATE KEY UPDATE.
 */
export async function upsertUserTaxId({userId, country, type, taxId}) {
  await pool.query(
    `INSERT INTO user_tax_id (user_id, country, type, tax_id, date_last_update)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       country = VALUES(country),
       type = VALUES(type),
       tax_id = VALUES(tax_id),
       date_last_update = CURRENT_TIMESTAMP`,
    [userId, country, type, taxId],
  )
}
