// src/db/queries/reconcile.js
//
// Queries usadas pelo cron de reconciliação. Lista users marcados como
// Plus localmente, junto com identificadores externos (original_transaction_id
// pro iOS, stripe_customer_id pro Stripe) — pra o cron consultar a
// plataforma real e detectar zumbis.
//
// Android NÃO entra aqui — plus-manager (worker Pub/Sub) já é a fonte
// de verdade pro Android.
import {pool} from '../mysql.js'
import {PREMIUM_MASK} from '../lib/permissions.js'

/**
 * Retorna users iOS Plus localmente, com originalTransactionId mais
 * recente vinculado a ele. Limitado pra cron não explodir em prod
 * (paginate em batches no caller se precisar).
 *
 * @param {number} limit
 * @returns {Promise<Array<{userId: number, hash: string, originalTransactionId: string, productId: string}>>}
 */
export async function listIosPlusUsers(limit = 1000) {
  const [rows] = await pool.query(
    `SELECT u.id AS userId, u.hash AS hash,
            pis.original_transaction_id AS originalTransactionId,
            pis.product_id AS productId
       FROM user u
       JOIN plus_ios_subscriptions pis ON pis.user_id = u.id
      WHERE (COALESCE(u.permission, 0) & ?) > 0
      ORDER BY pis.created_at DESC
      LIMIT ?`,
    [PREMIUM_MASK, limit],
  )
  return rows
}

/**
 * Retorna users Stripe Plus localmente, com stripe_customer_id mais recente.
 *
 * @param {number} limit
 * @returns {Promise<Array<{userId: number, hash: string, stripeCustomerId: string, purchaseToken: string}>>}
 */
export async function listStripePlusUsers(limit = 1000) {
  // Trazemos o customer mais recente por user (subquery). Some users
  // têm múltiplas linhas em user_plus (renovações) — só nos importa
  // o customer atual.
  const [rows] = await pool.query(
    `SELECT u.id AS userId, u.hash AS hash,
            up.stripe_customer_id AS stripeCustomerId,
            up.purchase_token AS purchaseToken
       FROM user u
       JOIN user_plus up ON up.user_id = u.id
      WHERE (COALESCE(u.permission, 0) & ?) > 0
        AND up.stripe_customer_id IS NOT NULL
        AND up.platform = 'web'
        AND up.date_create = (
          SELECT MAX(up2.date_create)
            FROM user_plus up2
           WHERE up2.user_id = u.id
             AND up2.stripe_customer_id IS NOT NULL
        )
      LIMIT ?`,
    [PREMIUM_MASK, limit],
  )
  return rows
}
