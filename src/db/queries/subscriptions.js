// src/db/queries/subscriptions.js
//
// Tabela `user_plus` — registro de cada compra (Android, iOS, Stripe).
// Cada linha é uma compra "concreta" (com order_id/purchase_token).
// O state global do Plus (flag `premium` no user) é gerenciado em
// `queries/users.js`.
//
// Aqui só insere e atualiza expiry. NÃO mexe em permission do user —
// quem faz isso é o caller (handlers/jobs) chamando `activatePremium`.
import {pool} from '../mysql.js'

/**
 * Insere compra Android (do app via Google Play Billing) na user_plus.
 * Se `orderId` vier null/undefined (caso PIX pendente), gera um GPA
 * temporário com timestamp pra ter primary key. O GPA real chega
 * depois via cron de reprocess.
 *
 * Trata `ER_DUP_ENTRY` como sucesso silencioso (compra já registrada
 * por webhook ou cron — não é erro).
 */
export async function insertAndroidPurchase({
  userId,
  orderId,
  productId,
  purchaseToken,
  purchaseTime,
  expiryTime = null,
  isOneTime = 0,
  platform = 'android',
}) {
  const finalOrderId = orderId ?? `GPA-UNDEF-${Date.now()}`
  try {
    const [result] = await pool.query(
      `INSERT INTO user_plus (
         user_id, order_id, product_id, purchase_token, purchase_time,
         expiry_time, platform, isOneTime
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, finalOrderId, productId, purchaseToken, purchaseTime, expiryTime, platform, isOneTime],
    )
    return result.affectedRows
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return 1
    throw err
  }
}

/**
 * Insere compra iOS (do app via StoreKit 2 / JWS) na user_plus.
 * `purchaseToken` aqui é o JWS recebido do app, `orderId` é o
 * transactionId do JWS decodificado.
 */
export async function insertIosPurchase({
  userId,
  orderId,
  productId,
  purchaseToken,
  purchaseTime,
  expiryTime,
  platform = 'ios',
}) {
  try {
    const [result] = await pool.query(
      `INSERT INTO user_plus (
         user_id, order_id, product_id, purchase_token, purchase_time,
         expiry_time, date_create, platform
       ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [userId, orderId, productId, purchaseToken, purchaseTime, expiryTime, platform],
    )
    return result.affectedRows
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return 1
    throw err
  }
}

/**
 * Insere compra Stripe (do site via checkout). `purchaseToken` aqui é o
 * subscription id (sub_...), `orderId` idem.
 *
 * `expiryTime` é setado com `billing_cycle_anchor * 1000` da sub no
 * momento do checkout pra fechar a janela onde `hasNewerSubscription`
 * (que filtra `AND expiry_time > nowMs`) ignoraria essa compra recém-
 * feita antes do primeiro `invoice.paid` chegar. O valor é sobrescrito
 * com `period_end` quando o invoice.paid chega — esse aqui é só
 * provisório pra não deixar NULL na janela inicial.
 */
export async function insertStripePurchase({
  userId,
  orderId,
  productId,
  purchaseToken,
  purchaseTime,
  expiryTime = null,
  platform = 'web',
  stripeCustomerId = null,
}) {
  try {
    const [result] = await pool.query(
      `INSERT INTO user_plus (
         user_id, order_id, product_id, purchase_token, purchase_time,
         expiry_time, platform, stripe_customer_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, orderId, productId, purchaseToken, purchaseTime, expiryTime, platform, stripeCustomerId],
    )
    return result.affectedRows
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return 1
    throw err
  }
}

/**
 * Atualiza `expiry_time` de uma compra (usado em DID_RENEW e
 * invoice.paid). Identifica a compra por purchase_token.
 */
export async function updateExpiryByPurchaseToken(purchaseToken, expiryTime) {
  const [result] = await pool.query(
    'UPDATE user_plus SET expiry_time = ? WHERE purchase_token = ?',
    [expiryTime, purchaseToken],
  )
  return result.affectedRows
}

/**
 * Atualiza `expiry_time` por (userId + purchaseToken + purchaseTime) —
 * usado quando o caller já tem todos esses contextos (compra recém
 * processada pelo handler iOS/Android).
 */
export async function updateExpiryByCompositeKey({userId, purchaseToken, purchaseTime, expiryTime}) {
  const [result] = await pool.query(
    'UPDATE user_plus SET expiry_time = ? WHERE user_id = ? AND purchase_token = ? AND purchase_time = ?',
    [expiryTime, userId, purchaseToken, purchaseTime],
  )
  return result.affectedRows
}
