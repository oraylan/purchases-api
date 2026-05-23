// src/handlers/activatePlus.js
//
// Service que ativa Plus pro user — orquestra todas as side effects
// que antes estavam espalhadas em setUserPlus*/addPremium da apiv2:
//
//   1) UPDATE bitwise atômico em user.permission (idempotente).
//   2) INSERT user_plus se ainda não tinha config de stream.
//   3) INSERT em user_plus do ht_advert Postgres (réplica passiva).
//   4) Disparo push + email pro user (notifyPlusActivated).
//   5) Alerta Discord pra auditoria.
//
// É idempotente: chamar 2x não duplica nada (bitwise atômico + ON
// CONFLICT no PG + skip do streamCfg se já existe). Push/email vão
// 2x se chamarmos 2x, mas isso é responsabilidade do caller checar
// `isUserPremium` antes.
import {activatePremium, isUserPremium} from '../db/queries/users.js'
import {initUserStreamConfig} from '../db/queries/streamCfg.js'
import {addPremiumPg} from '../db/pgQueries.js'
import {notifyPlusActivated} from '../comms/notify.js'
import {discordAlert} from '../comms/discord.js'
import {logger} from '../config/logger.js'

/**
 * Ativa Plus pra um user. Idempotente.
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {string} args.userHash
 * @param {string} args.source  — 'ios' | 'android' | 'stripe' | 'admin' | 'reconcile' (pra log)
 * @param {string} [args.productId]
 * @param {boolean} [args.notifyUser] — default true. Pula push/email em retoma de reconciliation.
 * @returns {Promise<{wasAlreadyPlus: boolean}>}
 */
export async function activatePlus({userId, userHash, source, productId, notifyUser = true}) {
  const wasAlreadyPlus = await isUserPremium(userId)

  await activatePremium(userId)
  await initUserStreamConfig(userId)

  // Réplica PG — best-effort, não bloqueia se cair.
  try {
    if (userHash) await addPremiumPg(userHash)
  } catch (err) {
    logger.warn({err: err?.message, userId, source}, 'addPremiumPg falhou (continuando)')
  }

  if (!wasAlreadyPlus && notifyUser && userHash) {
    // Em background — sem await pra não atrasar resposta da rota.
    notifyPlusActivated(userHash).catch(err =>
      logger.warn({err: err?.message, userId, source}, 'notifyPlusActivated falhou'),
    )
  }

  // Alerta Discord sempre (mesmo em ativação repetida — auditoria).
  const verb = wasAlreadyPlus ? '🔁 Re-confirmado' : '✅ Ativado'
  discordAlert(
    `[HUNTER PLUS] ${verb} Plus para userId **${userId}** via **${source}**` +
      (productId ? ` (produto: ${productId})` : ''),
  ).catch(() => {})

  return {wasAlreadyPlus}
}
