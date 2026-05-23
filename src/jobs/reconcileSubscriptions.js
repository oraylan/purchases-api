// src/jobs/reconcileSubscriptions.js
//
// Cron de reconciliação anti-zumbi. Diariamente percorre users
// marcados como Plus localmente e confere com a fonte de verdade
// externa (Apple App Store Server API + Stripe API). Quando detecta
// "Plus local + sub inativa na plataforma", chama `deactivatePlus`
// com source='reconcile_*' + alerta Discord.
//
// Android fica fora — plus-manager (worker Pub/Sub) já reconcilia
// continuamente via notifications do Google. Mexer aqui só duplicaria.
//
// Frequência: diário às 04:00 BRT (madrugada, menos carga). Single
// run por execução, sem retries. Se algo falhar pra um user, loga
// e segue — não pode parar o cron inteiro.
import {logger} from '../config/logger.js'
import {listIosPlusUsers, listStripePlusUsers} from '../db/queries/reconcile.js'
import {getSubscriptionStatuses} from '../providers/apple/subscriptionStatus.js'
import {stripe} from '../providers/stripe/client.js'
import {deactivatePlus} from '../handlers/deactivatePlus.js'
import {discordAlert} from '../comms/discord.js'
import {formatUserLabel} from '../utils/userLabel.js'

/**
 * Apple subscription status codes (App Store Server API):
 *   1 = active
 *   2 = expired
 *   3 = in billing retry period
 *   4 = grace period
 *   5 = revoked
 *
 * Consideramos "ativa" (mantém Plus): 1, 3, 4.
 * Consideramos "inativa" (desliga Plus): 2, 5.
 */
const APPLE_ACTIVE_STATUSES = new Set([1, 3, 4])

async function reconcileIosUser({userId, hash, originalTransactionId, productId}, {dryRun = false} = {}) {
  try {
    const result = await getSubscriptionStatuses(originalTransactionId)
    if (!result?.data) {
      logger.warn({userId, originalTransactionId}, 'reconcile iOS: sem resposta da Apple')
      return {status: 'skip', reason: 'no_response'}
    }

    // Procura status do produto. Apple agrupa por subscription group,
    // cada grupo tem lastTransactions[]. Pegamos a mais recente.
    const allTransactions = (result.data.data || []).flatMap(g => g.lastTransactions || [])
    if (allTransactions.length === 0) {
      logger.warn({userId, originalTransactionId}, 'reconcile iOS: nenhuma transaction')
      return {status: 'skip', reason: 'no_transactions'}
    }

    const allActive = allTransactions.some(t => APPLE_ACTIVE_STATUSES.has(t.status))
    if (allActive) {
      return {status: 'ok', reason: 'still_active'}
    }

    const statuses = allTransactions.map(t => t.status).join(',')

    if (dryRun) {
      logger.warn(
        {userId, originalTransactionId, productId, statuses},
        '[DRY-RUN] reconcile iOS: zumbi detectado — Plus SERIA desligado',
      )
      return {status: 'would_deactivate'}
    }

    logger.warn(
      {userId, originalTransactionId, productId, statuses},
      'reconcile iOS: zumbi detectado — desligando Plus',
    )
    await deactivatePlus({
      userId,
      purchaseToken: originalTransactionId,
      source: 'reconcile_apple',
      notifyUser: false, // user já deveria saber (sub expirou semanas atrás)
    })
    const userLabel = await formatUserLabel(userId)
    discordAlert(
      `[HUNTER PLUS] 🧟 Zumbi iOS detectado (**${userLabel}**, original tx \`${originalTransactionId}\`). ` +
        `Statuses Apple: ${statuses}. Plus desligado.`,
    ).catch(() => {})
    return {status: 'deactivated'}
  } catch (err) {
    logger.error({err: err.message, userId, originalTransactionId}, 'reconcile iOS: erro')
    return {status: 'error', error: err.message}
  }
}

async function reconcileStripeUser({userId, hash, stripeCustomerId, purchaseToken}, {dryRun = false} = {}) {
  try {
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'active',
      limit: 5,
    })

    if (subs.data.length > 0) {
      return {status: 'ok', reason: 'still_active'}
    }

    // Sem subs ativas — confere se tem em trial ou past_due (também é Plus)
    const subsExtended = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 5,
    })
    const stillEligible = subsExtended.data.some(s =>
      ['trialing', 'past_due'].includes(s.status),
    )
    if (stillEligible) {
      return {status: 'ok', reason: 'trialing_or_past_due'}
    }

    if (dryRun) {
      logger.warn(
        {userId, stripeCustomerId},
        '[DRY-RUN] reconcile Stripe: zumbi detectado — Plus SERIA desligado',
      )
      return {status: 'would_deactivate'}
    }

    logger.warn(
      {userId, stripeCustomerId},
      'reconcile Stripe: zumbi detectado — desligando Plus',
    )
    await deactivatePlus({
      userId,
      purchaseToken,
      source: 'reconcile_stripe',
      notifyUser: false,
    })
    const userLabel = await formatUserLabel(userId)
    discordAlert(
      `[HUNTER PLUS] 🧟 Zumbi Stripe detectado (**${userLabel}**, customer \`${stripeCustomerId}\`). ` +
        `Sem subs ativas. Plus desligado.`,
    ).catch(() => {})
    return {status: 'deactivated'}
  } catch (err) {
    logger.error({err: err.message, userId, stripeCustomerId}, 'reconcile Stripe: erro')
    return {status: 'error', error: err.message}
  }
}

/**
 * Roda 1 ciclo de reconciliação. Idempotente (chamar 2x não dobra
 * efeito porque deactivatePlus é idempotente).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] — se true, consulta Apple/Stripe normalmente
 *   mas NÃO chama deactivatePlus. Útil pra rodar à mão e ver quantos zumbis
 *   seriam detectados sem efeito colateral. Skipa alertas individuais no
 *   Discord (manda só o sumário final, prefixado).
 */
export async function runReconciliation({dryRun = false} = {}) {
  const startedAt = Date.now()
  logger.info({dryRun}, dryRun ? '[reconcile] iniciando DRY-RUN' : '[reconcile] iniciando reconciliação diária')

  const stats = {
    iosTotal: 0,
    iosDeactivated: 0,
    iosWouldDeactivate: 0,
    iosErrors: 0,
    stripeTotal: 0,
    stripeDeactivated: 0,
    stripeWouldDeactivate: 0,
    stripeErrors: 0,
  }

  // iOS
  try {
    const iosUsers = await listIosPlusUsers(5000)
    stats.iosTotal = iosUsers.length
    for (const user of iosUsers) {
      const res = await reconcileIosUser(user, {dryRun})
      if (res.status === 'deactivated') stats.iosDeactivated++
      else if (res.status === 'would_deactivate') stats.iosWouldDeactivate++
      else if (res.status === 'error') stats.iosErrors++
    }
  } catch (err) {
    logger.error({err: err.message}, '[reconcile] erro geral no batch iOS')
  }

  // Stripe
  try {
    const stripeUsers = await listStripePlusUsers(5000)
    stats.stripeTotal = stripeUsers.length
    for (const user of stripeUsers) {
      const res = await reconcileStripeUser(user, {dryRun})
      if (res.status === 'deactivated') stats.stripeDeactivated++
      else if (res.status === 'would_deactivate') stats.stripeWouldDeactivate++
      else if (res.status === 'error') stats.stripeErrors++
    }
  } catch (err) {
    logger.error({err: err.message}, '[reconcile] erro geral no batch Stripe')
  }

  const durationMs = Date.now() - startedAt
  logger.info({...stats, durationMs, dryRun}, '[reconcile] concluído')

  // Sumário no Discord se houve mexida (ou simulação de mexida) ou erros.
  // Em dry-run não dispara alertas individuais — só o sumário com prefixo.
  const totalToReport = dryRun
    ? stats.iosWouldDeactivate + stats.stripeWouldDeactivate + stats.iosErrors + stats.stripeErrors
    : stats.iosDeactivated + stats.stripeDeactivated + stats.iosErrors + stats.stripeErrors

  if (totalToReport > 0) {
    const prefix = dryRun ? '🧪 DRY-RUN — ' : ''
    const verb = dryRun ? 'SERIAM desligados' : 'desligados'
    const iosCount = dryRun ? stats.iosWouldDeactivate : stats.iosDeactivated
    const stripeCount = dryRun ? stats.stripeWouldDeactivate : stats.stripeDeactivated
    discordAlert(
      `[HUNTER PLUS] ${prefix}📊 Reconciliação diária:\n` +
        `iOS: ${stats.iosTotal} verificados, **${iosCount}** zumbis ${verb}, ${stats.iosErrors} erros.\n` +
        `Stripe: ${stats.stripeTotal} verificados, **${stripeCount}** zumbis ${verb}, ${stats.stripeErrors} erros.\n` +
        `Duração: ${(durationMs / 1000).toFixed(1)}s`,
    ).catch(() => {})
  }

  return stats
}
