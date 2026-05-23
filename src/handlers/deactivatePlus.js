// src/handlers/deactivatePlus.js
//
// Service que desativa Plus pro user. Espelha `activatePlus` em
// formato inverso, mas com uma checagem CRÍTICA: se o user tem uma
// assinatura mais nova vigente, NÃO desliga. Esse muro previne o caso
// onde o EXPIRED de uma renovação anterior chega DEPOIS do DID_RENEW
// da próxima (Apple não garante ordem de notifications) — sem isso,
// o user perderia Plus mesmo com sub válida.
//
// Side effects:
//   1) Checa hasNewerSubscription — se TRUE, no-op + log + alerta.
//   2) UPDATE bitwise atômico em user.permission.
//   3) DELETE em plus_ios_subscriptions (libera o Apple ID pra reuso
//      futuro entre family sharing, etc).
//   4) DELETE em user_plus do PG (réplica).
//   5) notifyPlusDeactivated (push + email) — opcional.
//   6) Alerta Discord.
import {deactivatePremium, hasNewerSubscription, findUserIdByPurchaseToken, getUserInfoById} from '../db/queries/users.js'
import {deleteIosSubscriptionsByUser} from '../db/queries/ios.js'
import {removePremiumPg} from '../db/pgQueries.js'
import {notifyPlusDeactivated} from '../comms/notify.js'
import {discordAlert} from '../comms/discord.js'
import {logger} from '../config/logger.js'

/**
 * Desativa Plus de um user. Aceita 2 modos:
 *   - por userId direto: passa { userId }
 *   - por purchase_token: passa { purchaseToken } — resolve userId
 *
 * @param {object} args
 * @param {number} [args.userId]
 * @param {string} [args.purchaseToken]
 * @param {string} args.source  — 'apple_expired' | 'apple_revoke' | 'stripe_cancel' | 'reconcile' | 'pix_cancelled'
 * @param {boolean} [args.notifyUser] — default true
 * @param {boolean} [args.cleanupIosMap] — default true (passar false em refund parcial)
 * @returns {Promise<{deactivated: boolean, reason?: string}>}
 */
export async function deactivatePlus({
  userId,
  purchaseToken,
  source,
  notifyUser = true,
  cleanupIosMap = true,
}) {
  // Resolve userId via purchase_token se necessário.
  if (!userId && purchaseToken) {
    userId = await findUserIdByPurchaseToken(purchaseToken)
  }
  if (!userId) {
    logger.warn({source, purchaseToken}, 'deactivatePlus: userId não encontrado, no-op')
    return {deactivated: false, reason: 'user_not_found'}
  }

  // Muro crítico: se tem sub mais nova, NÃO mexe em Plus.
  if (purchaseToken) {
    const hasNewer = await hasNewerSubscription(userId, purchaseToken)
    if (hasNewer) {
      logger.info({userId, source}, 'deactivatePlus: user tem sub mais nova, mantendo Plus')
      discordAlert(
        `[HUNTER PLUS] ⚠️ Tentativa de remoção do Plus (userId **${userId}**, source **${source}**), ` +
          `mas há assinatura mais nova vigente — mantido.`,
      ).catch(() => {})
      return {deactivated: false, reason: 'has_newer_subscription'}
    }
  }

  await deactivatePremium(userId)

  if (cleanupIosMap) {
    await deleteIosSubscriptionsByUser(userId).catch(err =>
      logger.warn({err: err?.message, userId}, 'deleteIosSubscriptionsByUser falhou (continuando)'),
    )
  }

  // Resolve hash pra comms + PG.
  const user = await getUserInfoById(userId)
  if (user?.hash) {
    try {
      await removePremiumPg(user.hash)
    } catch (err) {
      logger.warn({err: err?.message, userId}, 'removePremiumPg falhou (continuando)')
    }

    if (notifyUser) {
      notifyPlusDeactivated(user.hash).catch(err =>
        logger.warn({err: err?.message, userId, source}, 'notifyPlusDeactivated falhou'),
      )
    }
  }

  discordAlert(
    `[HUNTER PLUS] ❌ Plus desativado para userId **${userId}** via **${source}**`,
  ).catch(() => {})

  return {deactivated: true}
}
