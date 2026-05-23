// src/handlers/handleAppleNotification.js
//
// Webhook handler do /webhooks/apple (App Store Server
// Notifications V2). Apple manda eventos do ciclo de vida das subs
// (DID_RENEW, EXPIRED, REFUND, GRACE_PERIOD_EXPIRED, REVOKE, etc).
//
// CRÍTICO vs apiv2:
//   - Valida JWS da notificação (assinatura Apple) — sem isso qualquer
//     ator pode forjar eventos. Substitui o `jwt.decode` cego antigo.
//   - Cobre mais notification types (REVOKE, DID_FAIL_TO_RENEW,
//     SUBSCRIBED com subtype=RESUBSCRIBE).
//   - Idempotência via `isNotificationLogged` — se a Apple retentar
//     a mesma notificação (5x em 1h se não receber 200), não duplica
//     efeito.
//
// IMPORTANTE: sempre responder 200 (mesmo quando ignoramos a
// notificação). Se respondermos 4xx/5xx, a Apple retenta e a gente
// vê o mesmo evento repetido. Erros internos devem ser logados +
// alerta Discord, mas resposta = 200.
import {logger} from '../config/logger.js'
import {verifyNotificationJws, decodeTransactionInfoFromNotification} from '../providers/apple/verifyNotification.js'
import {InvalidJwsError} from '../providers/apple/verifyTransaction.js'
import {logApplePurchaseEvent, isNotificationLogged} from '../db/queries/purchases.js'
import {updateExpiryByPurchaseToken} from '../db/queries/subscriptions.js'
import {findUserIdByPurchaseToken} from '../db/queries/users.js'
import {activatePlus} from './activatePlus.js'
import {deactivatePlus} from './deactivatePlus.js'
import {discordAlert} from '../comms/discord.js'

// Notification types que mexem em status Plus
const DEACTIVATING_TYPES = new Set([
  'EXPIRED',
  'GRACE_PERIOD_EXPIRED',
  'REFUND',
  'REVOKE',
])

const REACTIVATING_TYPES = new Set([
  'DID_RENEW',
  'SUBSCRIBED', // pode ser INITIAL_BUY ou RESUBSCRIBE
])

export async function handleAppleNotification(req, reply) {
  const signedPayload = req.body?.signedPayload

  logger.info(
    {ip: req.ip, hasPayload: !!signedPayload, payloadLen: signedPayload?.length || 0},
    '[ASN] /webhooks/apple HIT',
  )

  if (!signedPayload) {
    logger.warn('[ASN] body sem signedPayload — respondendo 200 mesmo assim')
    return reply.status(200).send('ok')
  }

  // 1) Valida JWS — substitui jwt.decode inseguro da apiv2
  let decoded, envUsed
  try {
    ({decoded, envUsed} = await verifyNotificationJws(signedPayload))
  } catch (err) {
    if (err instanceof InvalidJwsError) {
      // ATAQUE? Loga forte + alerta Discord. Resposta 200 (não dá
      // pra Apple retentar — não foi a Apple que mandou).
      logger.error({err: err.message, ip: req.ip}, '[ASN] JWS inválido — possível tentativa de forjar evento')
      discordAlert(
        `[HUNTER PLUS] 🚨 /webhooks/apple recebeu signedPayload INVÁLIDO. IP: \`${req.ip}\`. ` +
          `Possível tentativa de forjar evento.`,
      ).catch(() => {})
      return reply.status(200).send('ok')
    }
    throw err
  }

  const notificationType = decoded.notificationType
  const subtype = decoded.subtype
  const notificationUUID = decoded.notificationUUID

  logger.info(
    {notificationType, subtype, envUsed, notificationUUID},
    '[ASN] notificação validada',
  )

  // 2) TEST notification — só pra debug do webhook, não tem payload de transação
  if (notificationType === 'TEST') {
    logger.info({notificationUUID}, '[ASN] TEST notification — infra OK')
    return reply.status(200).send('ok')
  }

  // 3) Decodifica transactionInfo embutida
  let tx
  try {
    tx = await decodeTransactionInfoFromNotification(decoded, envUsed)
  } catch (err) {
    logger.warn({err: err.message, notificationType}, '[ASN] falha ao decodar signedTransactionInfo')
    return reply.status(200).send('ok')
  }
  if (!tx) {
    logger.warn({notificationType}, '[ASN] notificação sem signedTransactionInfo — ignorando')
    return reply.status(200).send('ok')
  }

  const transactionId = String(tx.transactionId)
  const originalTransactionId = String(tx.originalTransactionId)
  const productId = tx.productId
  const expiresDateMs = tx.expiresDate || null
  const signedDateMs = decoded.signedDate || Date.now()

  // 4) Idempotência — se a Apple retentar o mesmo evento, pula
  if (await isNotificationLogged(transactionId, notificationType)) {
    logger.info(
      {transactionId, notificationType, notificationUUID},
      '[ASN] notificação já processada anteriormente — skip (idempotência)',
    )
    return reply.status(200).send('ok')
  }

  // 5) Log no banco (tabela purchases)
  try {
    await logApplePurchaseEvent({
      transactionId,
      originalTransactionId,
      notificationType,
      productId,
      eventTimeMs: signedDateMs,
      expiresDateMs,
    })
  } catch (err) {
    logger.error({err: err.message, transactionId}, '[ASN] falha ao gravar log no banco')
    // Mesmo se falhar o log, segue pra agir no Plus — log é auditoria, não bloqueia ação.
  }

  // 6) Age conforme o tipo
  try {
    if (REACTIVATING_TYPES.has(notificationType)) {
      // DID_RENEW ou SUBSCRIBED — encontra user pelo originalTransactionId
      // (o purchase_token gravado em user_plus é o JWS original que o app
      // mandou no /purchase/v3 — não dá pra resolver direto). Usamos
      // findUserIdByPurchaseToken passando originalTransactionId, mas isso
      // só funciona se a apiv2 OU essa api gravaram orderId/originalTx
      // como purchase_token. Pra robustez, tentamos por orderId.
      const userId = await findUserIdByPurchaseToken(originalTransactionId)
        ?? await findUserIdByPurchaseToken(transactionId)

      if (!userId) {
        logger.warn(
          {transactionId, originalTransactionId, notificationType},
          '[ASN] não foi possível resolver user — DID_RENEW de sub não registrada',
        )
        return reply.status(200).send('ok')
      }

      // Atualiza expiry
      if (expiresDateMs) {
        await updateExpiryByPurchaseToken(originalTransactionId, expiresDateMs)
      }

      await activatePlus({
        userId,
        source: `apple_${notificationType.toLowerCase()}`,
        productId,
      })
    } else if (DEACTIVATING_TYPES.has(notificationType)) {
      await deactivatePlus({
        purchaseToken: originalTransactionId,
        source: `apple_${notificationType.toLowerCase()}`,
      })
    } else {
      // DID_CHANGE_RENEWAL_PREF, DID_CHANGE_RENEWAL_STATUS, PRICE_INCREASE,
      // OFFER_REDEEMED, etc — só log, sem mexer em Plus.
      logger.info({notificationType, subtype}, '[ASN] tipo informacional — log only')
    }
  } catch (err) {
    logger.error({err: err.message, notificationType}, '[ASN] erro processando notification')
    discordAlert(
      `[HUNTER PLUS] ⚠️ Erro processando ASN ${notificationType} ` +
        `(tx \`${transactionId}\`): ${err.message}`,
    ).catch(() => {})
  }

  return reply.status(200).send('ok')
}
