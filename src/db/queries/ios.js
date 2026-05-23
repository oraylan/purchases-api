// src/db/queries/ios.js
//
// Tabela `plus_ios_subscriptions` — mapeamento entre Apple ID
// (`original_transaction_id`) e user da Hunter.FM. Cada Apple ID só
// pode estar vinculado a UM user — previne user A "transferir" sub
// pra conta de user B.
//
// IMPORTANTE: a Apple REUSA o originalTransactionId quando o mesmo
// Apple ID reassina o mesmo produto/sub group (vide bug que pegamos no
// app). Isso é OK aqui — se o mesmo user reassina, encontramos o map
// existente com o mesmo user_id e tudo segue. Só dispara erro se for
// OUTRO user_id.
import {pool} from '../mysql.js'

/**
 * Retorna o user_id dono daquele originalTransactionId, ou null se
 * ainda não tem map. Usar antes de aceitar nova compra iOS.
 */
export async function findUserByOriginalTransactionId(originalTransactionId) {
  const [results] = await pool.query(
    'SELECT user_id FROM plus_ios_subscriptions WHERE original_transaction_id = ? LIMIT 1',
    [originalTransactionId],
  )
  return results[0]?.user_id ?? null
}

/**
 * Garante o map originalTransactionId → user.
 *
 *  - Se o map já existe pro MESMO user_id: no-op (return 0).
 *  - Se existe pra OUTRO user: lança IosSubscriptionConflict — o
 *    handler precisa rejeitar a compra com IOS_ERR_ORIGINAL_USED_OTHER.
 *  - Se não existe: insere.
 *
 * Sem transactional lock entre check e insert. Em produção a janela
 * de corrida é desprezível (mesmo user precisaria fazer 2 compras
 * paralelas em ms diferentes), e a coluna `original_transaction_id`
 * tem UNIQUE constraint — o segundo INSERT estoura ER_DUP_ENTRY e
 * tratamos como sucesso silencioso.
 */
export class IosSubscriptionConflict extends Error {
  constructor(originalTransactionId, ownerUserId) {
    super(`Apple ID ${originalTransactionId} já vinculado a user ${ownerUserId}`)
    this.name = 'IosSubscriptionConflict'
    this.originalTransactionId = originalTransactionId
    this.ownerUserId = ownerUserId
  }
}

export async function ensureIosSubscriptionMap({userId, originalTransactionId, productId}) {
  const owner = await findUserByOriginalTransactionId(originalTransactionId)
  if (owner !== null) {
    if (owner === userId) return 0
    throw new IosSubscriptionConflict(originalTransactionId, owner)
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO plus_ios_subscriptions (original_transaction_id, user_id, product_id, created_at)
       VALUES (?, ?, ?, NOW())`,
      [originalTransactionId, userId, productId],
    )
    return result.affectedRows
  } catch (err) {
    // race do segundo INSERT — a única forma é se outro request inseriu
    // entre o SELECT e o INSERT. Re-confere quem é o dono agora.
    if (err.code === 'ER_DUP_ENTRY') {
      const owner = await findUserByOriginalTransactionId(originalTransactionId)
      if (owner === userId) return 0
      throw new IosSubscriptionConflict(originalTransactionId, owner)
    }
    throw err
  }
}

/**
 * Remove o map quando o user explicitamente perde Plus (sub cancelada
 * + sem renovação mais nova). Chamado por `removePremium` no caller.
 * Permite que o mesmo Apple ID seja reusado por outro user no futuro
 * (ex: family sharing transfer).
 */
export async function deleteIosSubscriptionsByUser(userId) {
  const [result] = await pool.query(
    'DELETE FROM plus_ios_subscriptions WHERE user_id = ?',
    [userId],
  )
  return result.affectedRows > 0
}
