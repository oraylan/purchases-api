// src/handlers/handleIosPurchase.js
//
// Handler completo da rota POST /purchase/v3 quando platform=ios.
// Recebe JWS no campo purchase_token e:
//   1) Valida + decodifica JWS (Apple, fallback prod↔sandbox).
//   2) Checa se já é Plus → ALREADY_PLUS_ACK (sem dupliar).
//   3) Checa se a TRANSACTION está expirada (expiresDate < now) →
//      EXPIRED_BUT_CONFIRMED (ack only — não ativa Plus).
//   4) Bind originalTransactionId → user (lança IosSubscriptionConflict
//      se outro user já é dono).
//   5) INSERT user_plus.
//   6) Ativa Plus.
import {logger} from '../config/logger.js'
import {CODES, ok, fail} from './shared.js'
import {verifyTransactionJws, InvalidJwsError} from '../providers/apple/verifyTransaction.js'
import {isUserPremium} from '../db/queries/users.js'
import {insertIosPurchase} from '../db/queries/subscriptions.js'
import {ensureIosSubscriptionMap, IosSubscriptionConflict} from '../db/queries/ios.js'
import {activatePlus} from './activatePlus.js'

export async function handleIosPurchase(req, reply) {
  const {userId, userHash} = req
  const {purchase_token: jws} = req.body

  // 1) Valida JWS
  let tx
  try {
    tx = await verifyTransactionJws(jws)
  } catch (err) {
    if (err instanceof InvalidJwsError) {
      logger.warn({userId, msg: err.message}, 'JWS iOS inválido')
      return fail(reply, {
        message: 'Recibo inválido.',
        code: CODES.IOS_ERR_INVALID_JWS,
        status: 400,
      })
    }
    throw err
  }

  const productId = tx.productId
  const transactionId = String(tx.transactionId)
  const originalTransactionId = String(tx.originalTransactionId)
  const purchaseDateMs = tx.purchaseDate
  const expiresDateMs = tx.expiresDate || null

  // 2) Já é Plus → ack only (não ativa de novo, evita dupla notificação)
  if (await isUserPremium(userId)) {
    return ok(reply, {
      message: 'Usuário já é Plus. Recibo confirmado.',
      code: CODES.IOS_OK_ALREADY_PLUS,
    })
  }

  // 3) Transaction expirada (caso clássico: DID_RENEW antiga vinda do
  //    Transaction.updates queue do StoreKit). Ack only — não ativa
  //    Plus, mas devolve 200 pro app finalizar a transaction.
  if (expiresDateMs && Number(expiresDateMs) < Date.now()) {
    logger.info(
      {userId, transactionId, expiresDate: new Date(Number(expiresDateMs)).toISOString()},
      'iOS transaction expirada — ack only',
    )
    return ok(reply, {
      message: 'Assinatura já expirada. Mas confirmo o seu recibo.',
      code: CODES.IOS_OK_EXPIRED_BUT_CONFIRMED,
    })
  }

  // 4) Bind original_transaction_id → user
  try {
    await ensureIosSubscriptionMap({userId, originalTransactionId, productId})
  } catch (err) {
    if (err instanceof IosSubscriptionConflict) {
      logger.warn({userId, originalTransactionId, ownerUserId: err.ownerUserId}, 'Apple ID conflita com outro user')
      return fail(reply, {
        message: 'Esta assinatura já está vinculada a outra conta Hunter.FM.',
        code: CODES.IOS_ERR_ORIGINAL_USED_OTHER,
        status: 400,
      })
    }
    throw err
  }

  // 5) INSERT user_plus
  const inserted = await insertIosPurchase({
    userId,
    orderId: transactionId,
    productId,
    purchaseToken: jws,
    purchaseTime: purchaseDateMs,
    expiryTime: expiresDateMs,
  })

  if (inserted === 0) {
    return ok(reply, {
      message: 'Nenhuma alteração realizada.',
      code: CODES.GEN_OK_NO_CHANGE,
    })
  }

  // 6) Ativa Plus
  await activatePlus({userId, userHash, source: 'ios', productId})

  return ok(reply, {
    message: 'Compra realizada com sucesso.',
    code: CODES.IOS_OK_PURCHASE,
    extra: {transactionId, originalTransactionId},
  })
}
