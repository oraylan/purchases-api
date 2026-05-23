// src/db/queries/users.js
//
// Queries sobre `user` (perfil + permission bitfield). Inclui o muro
// crítico de Plus: ativar/desativar usando bitwise atômico (em vez de
// read-modify-write), eliminando o race condition do padrão antigo.
//
// IMPORTANTE: essas funções NÃO disparam push, email, Discord ou Postgres
// replicação — só tocam banco. Side effects ficam em `src/comms/notify.js`
// (Fase 3), orquestrados pelos handlers/jobs. Isso facilita testar e
// evita imports circulares.
import {pool} from '../mysql.js'
import {PREMIUM_BIT, PREMIUM_MASK} from '../lib/permissions.js'

/** Resolve hash → user.id. Null se não existir. */
export async function findUserIdByHash(hash) {
  const [results] = await pool.query('SELECT id FROM user WHERE hash = ? LIMIT 1', [hash])
  return results[0]?.id ?? null
}

/** Resolve hash → user.id e user.hash em um único trip ao banco. */
export async function findUserByHash(hash) {
  const [results] = await pool.query(
    'SELECT id, hash, fullname, mail FROM user WHERE hash = ? LIMIT 1',
    [hash],
  )
  return results[0] ?? null
}

/** Resolve id → user info básico (pra alertas e emails). */
export async function getUserInfoById(userId) {
  const [results] = await pool.query(
    'SELECT id, hash, fullname, mail FROM user WHERE id = ? LIMIT 1',
    [userId],
  )
  return results[0] ?? null
}

/** Valida token JWT/sessão do user (igual apiv2 — tabela `token`). */
export async function verifyToken(userId, token) {
  if (!userId || !token) return false
  const [results] = await pool.query(
    'SELECT 1 FROM token WHERE user_id = ? AND token = ? LIMIT 1',
    [userId, token],
  )
  return results.length > 0
}

/** Retorna o bitfield bruto da coluna permission. Null se user inexistente. */
export async function getUserPermissionRaw(userId) {
  const [results] = await pool.query(
    'SELECT permission FROM user WHERE id = ? LIMIT 1',
    [userId],
  )
  if (results.length === 0) return null
  return results[0].permission
}

/**
 * Confere se o user tem a flag `premium` ativa. Usa bitwise no SQL —
 * sem trazer o bitfield todo pro JS pra parsear.
 */
export async function isUserPremium(userId) {
  const [results] = await pool.query(
    'SELECT (COALESCE(permission, 0) & ?) > 0 AS isPremium FROM user WHERE id = ? LIMIT 1',
    [PREMIUM_MASK, userId],
  )
  return results[0]?.isPremium === 1
}

/**
 * Liga a flag `premium` atômico. Idempotente — chamar 2x não duplica
 * nada porque é OR bitwise (já tinha ou não). Resolve a race entre
 * webhook + compra direta no mesmo instante (que no padrão antigo
 * podia perder outras permissions).
 *
 * @returns {Promise<boolean>} true se o user existia e foi tocado
 */
export async function activatePremium(userId) {
  const [result] = await pool.query(
    'UPDATE user SET permission = (COALESCE(permission, 0) | ?), date_last_update = NOW() WHERE id = ?',
    [PREMIUM_MASK, userId],
  )
  return result.affectedRows > 0
}

/**
 * Desliga a flag `premium` atômico. Idempotente.
 *
 * NOTA: aqui não checamos `hasNewerSubscription` — essa lógica fica no
 * caller (handler/job), porque exige conhecer o contexto da remoção
 * (webhook? cancelamento manual? reconciliação?).
 */
export async function deactivatePremium(userId) {
  const [result] = await pool.query(
    'UPDATE user SET permission = (COALESCE(permission, 0) & ~(?)), date_last_update = NOW() WHERE id = ?',
    [PREMIUM_MASK, userId],
  )
  return result.affectedRows > 0
}

/**
 * Verifica se o user tem uma assinatura mais recente que `currentToken`.
 * Usado pelo `deactivatePlus` pra NÃO desligar Plus quando há renovação
 * mais nova que apenas a antiga expirou (cenário comum: DID_RENEW
 * chega ANTES do EXPIRED da renovação anterior).
 *
 * Duas sutilezas herdadas de bug histórico da apiv2:
 *   1) ORDER BY purchase_time DESC — quando uma sub renova, surgem várias
 *      linhas com o mesmo purchase_token. Sem ORDER BY, o MySQL retorna
 *      ordem indefinida (geralmente a mais antiga, por ordem do clustered
 *      index), o que inflava a janela "mais novo que X" e deixava subs
 *      antigas/expiradas passarem.
 *   2) expiry_time > nowMs — exige que a sub mais nova esteja VIGENTE.
 *      Sem isso, uma sub mais nova já expirada continuava blindando o
 *      Plus contra remoção (assinatura zumbi imune ao reconcile).
 *
 * @returns {Promise<boolean>}
 */
export async function hasNewerSubscription(userId, currentToken) {
  const [current] = await pool.query(
    `SELECT purchase_time FROM user_plus
       WHERE user_id = ? AND purchase_token = ?
       ORDER BY purchase_time DESC
       LIMIT 1`,
    [userId, currentToken],
  )
  if (current.length === 0) return false

  const currentPurchaseTime = current[0].purchase_time
  const nowMs = Date.now()
  const [newer] = await pool.query(
    `SELECT 1 FROM user_plus
       WHERE user_id = ?
         AND purchase_token != ?
         AND purchase_time > ?
         AND expiry_time > ?
         AND (oneTime_expired IS NULL OR oneTime_expired != 1)
       LIMIT 1`,
    [userId, currentToken, currentPurchaseTime, nowMs],
  )
  return newer.length > 0
}

/** Resolve purchase_token → user_id (último registro encontrado). */
export async function findUserIdByPurchaseToken(token) {
  const [results] = await pool.query(
    'SELECT user_id FROM user_plus WHERE purchase_token = ? ORDER BY date_create DESC LIMIT 1',
    [token],
  )
  return results[0]?.user_id ?? null
}
