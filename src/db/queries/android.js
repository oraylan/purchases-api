// src/db/queries/android.js
//
// Tabela `plus_android_subscriptions` — mapeamento Google Play
// `order_id` → user. Mesmo papel que `plus_ios_subscriptions` no iOS,
// mas pra Android. Previne reuso de orderId entre contas.
//
// NOTA: o ciclo de renovação Android é tratado pelo `plus-manager`
// (worker Pub/Sub) — aqui só registramos a compra inicial vinda do
// app, que estabelece o vínculo orderId↔user.
import {pool} from '../mysql.js'

export async function findUserByAndroidOrderId(orderId) {
  const [results] = await pool.query(
    'SELECT user_id FROM plus_android_subscriptions WHERE order_id = ? LIMIT 1',
    [orderId],
  )
  return results[0]?.user_id ?? null
}

export class AndroidOrderConflict extends Error {
  constructor(orderId, ownerUserId) {
    super(`Google order ${orderId} já vinculado a user ${ownerUserId}`)
    this.name = 'AndroidOrderConflict'
    this.orderId = orderId
    this.ownerUserId = ownerUserId
  }
}

export async function ensureAndroidOrderMap({userId, orderId, productId}) {
  const owner = await findUserByAndroidOrderId(orderId)
  if (owner !== null) {
    if (owner === userId) return 0
    throw new AndroidOrderConflict(orderId, owner)
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO plus_android_subscriptions (order_id, user_id, product_id, created_at)
       VALUES (?, ?, ?, NOW())`,
      [orderId, userId, productId],
    )
    return result.affectedRows
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const owner = await findUserByAndroidOrderId(orderId)
      if (owner === userId) return 0
      throw new AndroidOrderConflict(orderId, owner)
    }
    throw err
  }
}
