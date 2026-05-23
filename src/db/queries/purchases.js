// src/db/queries/purchases.js
//
// Tabela `purchases` — log de eventos de compras (webhooks Apple ASN +
// eventos Stripe + qualquer outro). NÃO confundir com `user_plus`
// (essa é o "state" da assinatura; `purchases` é o "log" de eventos).
//
// Usado por:
//  - webhook ASN V2 (notification handlers gravam todos os eventos
//    que chegam, mesmo que o app ainda não processe — auditoria).
//  - webhook Stripe.
//  - reconciliation cron (consulta histórico).
import {pool} from '../mysql.js'
import {describeNotificationType} from '../lib/permissions.js'

/**
 * Loga uma notificação Apple ASN no banco. `eventTime` e `expiresDate`
 * são timestamps em ms (epoch). A coluna `date_event` é DATETIME e
 * `expiresDate` é INT (ms) — herança do schema legado.
 *
 * Idempotência: se a transactionId já tiver sido logada antes, o caller
 * deve pular (ver `isNotificationLogged`). Aqui SÓ insere.
 */
export async function logApplePurchaseEvent({
  transactionId,
  originalTransactionId,
  notificationType,
  productId,
  eventTimeMs,
  expiresDateMs,
}) {
  const description = describeNotificationType(notificationType)
  const dateEvent = new Date(Number(eventTimeMs))
  const expiresHuman = expiresDateMs ? new Date(Number(expiresDateMs)) : null

  await pool.query(
    `INSERT INTO purchases (
       transactionId, purchase_token, originalTransactionId,
       notification_type, description, product_id,
       date_event, expiresDate, date_expire
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionId,
      // schema antigo guarda originalTransactionId em duas colunas
      // (purchase_token e originalTransactionId). Mantemos pra não quebrar
      // queries downstream que ainda usam purchase_token.
      originalTransactionId,
      originalTransactionId,
      notificationType,
      description,
      productId,
      dateEvent,
      expiresDateMs ?? null,
      expiresHuman,
    ],
  )
}

/**
 * Loga um evento de Stripe (purchase_token = subscription id ou
 * invoice id, dependendo do evento).
 */
export async function logStripePurchaseEvent({
  purchaseToken,
  notificationType,
  productId,
  eventTimeMs,
}) {
  const description = describeNotificationType(notificationType)
  const dateEvent = new Date(Number(eventTimeMs))

  await pool.query(
    'INSERT INTO purchases (purchase_token, notification_type, description, product_id, date_event) VALUES (?, ?, ?, ?, ?)',
    [purchaseToken, notificationType, description, productId, dateEvent],
  )
}

/**
 * Confere se a assinatura representada por `originalTransactionId` JÁ
 * teve um evento EXPIRED gravado no log (qualquer transactionId da
 * mesma sub). Usado pelo cron de reconciliação pra ignorar subs já
 * expiradas. NÃO usar pra bloquear reassinaturas (a Apple reusa o
 * originalTransactionId em re-subs do mesmo produto).
 */
export async function hasExpiredEventByOriginalTransaction(originalTransactionId) {
  const [results] = await pool.query(
    `SELECT 1 FROM purchases
       WHERE originalTransactionId = ? AND notification_type = 'EXPIRED'
       LIMIT 1`,
    [originalTransactionId],
  )
  return results.length > 0
}

/**
 * Confere se uma notification específica (por transactionId + type) já
 * foi logada. Usado pra idempotência no webhook ASN — a Apple retenta
 * até 5 vezes em ~1h se não receber 200; sem dedup, executaríamos o
 * mesmo efeito várias vezes.
 */
export async function isNotificationLogged(transactionId, notificationType) {
  const [results] = await pool.query(
    `SELECT 1 FROM purchases
       WHERE transactionId = ? AND notification_type = ?
       LIMIT 1`,
    [transactionId, notificationType],
  )
  return results.length > 0
}
