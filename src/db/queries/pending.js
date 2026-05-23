// src/db/queries/pending.js
//
// Queries pro fluxo de compra única (PIX) — quando o Google Play
// retorna purchaseState=pending, gravamos com `pending=1` na user_plus
// e o cron de reprocess revalida periodicamente até concluir/cancelar.
//
// Na apiv2 esse fluxo é hot — usuários PIX são comuns no Brasil.
// Aqui o ciclo continua: rota `/purchase/v3` cria pending, cron
// reprocess confirma ou cancela.
import {pool} from '../mysql.js'

/** Marca/desmarca uma compra como pendente. status = 0 (validada) ou 1 (pending). */
export async function setPurchaseStatus(purchaseToken, status) {
  const [result] = await pool.query(
    'UPDATE user_plus SET pending = ? WHERE purchase_token = ?',
    [status, purchaseToken],
  )
  return result.affectedRows > 0
}

/**
 * Lista compras pending pro cron reprocessar. Inclui hash do user pra
 * dar trigger no addPremiumPg / comNewPlus quando confirmar.
 */
export async function fetchPendingPurchases() {
  const [rows] = await pool.query(
    `SELECT
       up.purchase_token AS token,
       up.product_id     AS productId,
       up.user_id        AS userId,
       u.hash            AS userHash
     FROM user_plus up
     JOIN user u ON u.id = up.user_id
     WHERE up.pending = 1`,
  )
  return rows
}

/**
 * Corrige order_id quando o GPA real chega depois (caso PIX). O Google
 * Play emite a compra inicial com orderId temporário que fica indefinido
 * até o pagamento confirmar — aí o cron resolve.
 */
export async function fixGoogleOrderId(purchaseToken, orderId) {
  const [result] = await pool.query(
    'UPDATE user_plus SET order_id = ? WHERE purchase_token = ?',
    [orderId, purchaseToken],
  )
  return result.affectedRows > 0
}

/** Marca uma compra única como expirada (PIX cujo período acabou). */
export async function markOneTimeExpired(purchaseToken) {
  const [result] = await pool.query(
    'UPDATE user_plus SET oneTime_expired = 1 WHERE purchase_token = ?',
    [purchaseToken],
  )
  return result.affectedRows > 0
}
