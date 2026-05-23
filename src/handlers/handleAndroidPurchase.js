// src/handlers/handleAndroidPurchase.js
//
// Handler completo da rota POST /purchase/v3 quando platform=android.
// Recebe os campos do request e orquestra:
//   1) Bind orderId → user (com erro tipado se já é de outro user).
//   2) INSERT user_plus.
//   3) Valida no Google Play (subscription OU product PIX).
//   4) Pra subs: ativa Plus.
//   5) Pra PIX: state=completed → ativa Plus; pending → marca pending=1;
//      cancelled → marca expired + remove Plus se for esse user.
//
// Responde com CODES padronizado.
import {logger} from '../config/logger.js'
import {CODES, PIX_SKUS_MONTHS, addMonthsToTimestamp, ok, fail} from './shared.js'
import {insertAndroidPurchase} from '../db/queries/subscriptions.js'
import {ensureAndroidOrderMap, AndroidOrderConflict} from '../db/queries/android.js'
import {verifyAndroidSubscription} from '../providers/google/verifySubscription.js'
import {verifyAndroidProduct} from '../providers/google/verifyProduct.js'
import {setPurchaseStatus, fixGoogleOrderId, markOneTimeExpired} from '../db/queries/pending.js'
import {updateExpiryByPurchaseToken} from '../db/queries/subscriptions.js'
import {activatePlus} from './activatePlus.js'
import {deactivatePlus} from './deactivatePlus.js'

export async function handleAndroidPurchase(req, reply) {
  const {userId, userHash} = req
  const {purchase_token: purchaseToken, order_id: orderId, product_id: productId, purchase_time: purchaseTime, pagamento_unico: pagamentoUnico} = req.body

  const isOneTime = Boolean(pagamentoUnico)
  const monthsPlano = PIX_SKUS_MONTHS[productId] || 0
  const expiryTime = isOneTime && monthsPlano > 0
    ? addMonthsToTimestamp(purchaseTime, monthsPlano)
    : null

  // 1) Bind orderId → user
  try {
    await ensureAndroidOrderMap({userId, orderId, productId})
  } catch (err) {
    if (err instanceof AndroidOrderConflict) {
      logger.warn({userId, orderId, ownerUserId: err.ownerUserId}, 'order Android conflita com outro user')
      return fail(reply, {
        message: 'Esta assinatura já está vinculada a outra conta Hunter.FM.',
        code: CODES.ANDR_ERR_ORDER_USED_OTHER,
        status: 400,
      })
    }
    throw err
  }

  // 2) INSERT user_plus
  const inserted = await insertAndroidPurchase({
    userId,
    orderId,
    productId,
    purchaseToken,
    purchaseTime,
    expiryTime,
    isOneTime: isOneTime ? 1 : 0,
  })

  if (inserted === 0) {
    return ok(reply, {
      message: 'Nenhuma alteração realizada, verifique os dados enviados.',
      code: CODES.GEN_OK_NO_CHANGE,
    })
  }

  // 3) Valida no Google Play
  if (isOneTime) {
    // PIX
    const result = await verifyAndroidProduct({purchaseToken, productId})

    if (result.orderId) {
      await fixGoogleOrderId(purchaseToken, result.orderId)
    }

    if (result.state === 'completed') {
      await setPurchaseStatus(purchaseToken, 0)
      await activatePlus({userId, userHash, source: 'android', productId})
      return ok(reply, {
        message: 'Compra única registrada com sucesso.',
        code: CODES.ANDR_OK_ONE_TIME,
      })
    }

    if (result.state === 'pending') {
      await setPurchaseStatus(purchaseToken, 1)
      return ok(reply, {
        message: 'Compra única pendente — aguardando confirmação do Google.',
        code: CODES.ANDR_PENDING_ONE_TIME,
      })
    }

    // cancelled
    await setPurchaseStatus(purchaseToken, 0)
    await markOneTimeExpired(purchaseToken)
    await deactivatePlus({purchaseToken, source: 'pix_cancelled', notifyUser: false})
    return ok(reply, {
      message: 'Compra cancelada pelo Google Play.',
      code: CODES.ANDR_CANCELLED_ONE_TIME,
    })
  }

  // Subscription Android
  const sub = await verifyAndroidSubscription({purchaseToken, productId})
  if (sub.expiryTimeMillis) {
    await updateExpiryByPurchaseToken(purchaseToken, Number(sub.expiryTimeMillis))
  }
  await activatePlus({userId, userHash, source: 'android', productId})

  return ok(reply, {
    message: 'Assinatura registrada com sucesso.',
    code: CODES.ANDR_OK_SUBSCRIPTION,
  })
}
