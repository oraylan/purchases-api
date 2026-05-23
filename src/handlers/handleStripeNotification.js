// src/handlers/handleStripeNotification.js
//
// Webhook handler do /webhooks/stripe. Stripe manda eventos de:
//   - checkout.session.completed       → ativa Plus
//   - invoice.paid                     → renova expiry + reativa se preciso
//   - invoice.payment_failed           → desativa Plus
//   - customer.subscription.deleted    → desativa Plus
//
// CRÍTICO: signature HMAC já foi validada na rota antes desse handler
// ser chamado. Aqui só processamos o event já validado.
import {logger} from '../config/logger.js'
import {stripe} from '../providers/stripe/client.js'
import {insertStripePurchase, updateExpiryByPurchaseToken} from '../db/queries/subscriptions.js'
import {logStripePurchaseEvent} from '../db/queries/purchases.js'
import {activatePlus} from './activatePlus.js'
import {deactivatePlus} from './deactivatePlus.js'

export async function handleStripeNotification(event) {
  const data = event.data.object
  const eventTimeMs = event.created * 1000

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = Number(data.metadata?.userId)
      const userHash = data.metadata?.userHash
      const plano = data.metadata?.plano

      if (!userId) {
        logger.warn({sessionId: data.id}, '[stripe] checkout sem userId em metadata')
        return
      }

      // Expand subscription pra pegar dados de cobrança
      const session = await stripe.checkout.sessions.retrieve(data.id, {expand: ['subscription']})
      const sub = session.subscription
      if (!sub) {
        logger.warn({sessionId: data.id, userId}, '[stripe] session sem subscription')
        return
      }

      const purchaseToken = sub.id
      const orderId = sub.id
      // Stripe devolve timestamps em segundos; resto da api grava em ms.
      const purchaseTime = sub.start_date * 1000
      const stripeCustomerId = session.customer

      const inserted = await insertStripePurchase({
        userId,
        orderId,
        productId: plano || 'hunter_plus',
        purchaseToken,
        purchaseTime,
        stripeCustomerId,
      })

      if (inserted > 0) {
        await activatePlus({userId, userHash, source: 'stripe', productId: plano})
        await logStripePurchaseEvent({
          purchaseToken,
          notificationType: 'SUBSCRIBED',
          productId: plano || 'hunter_plus',
          eventTimeMs,
        })
        logger.info({userId, sessionId: data.id, sub: purchaseToken}, '[stripe] checkout completado')
      }
      return
    }

    case 'invoice.paid': {
      const purchaseToken = data.parent?.subscription_details?.subscription
      const expiryTime = data.period_end ? data.period_end * 1000 : null
      if (!purchaseToken) {
        logger.warn({invoiceId: data.id}, '[stripe] invoice.paid sem subscription id')
        return
      }
      if (expiryTime) {
        await updateExpiryByPurchaseToken(purchaseToken, expiryTime)
      }
      // Recupera userId pelo purchase_token e reativa Plus (caso tenha
      // caído em payment_failed antes).
      const {findUserIdByPurchaseToken, getUserInfoById} = await import('../db/queries/users.js')
      const userId = await findUserIdByPurchaseToken(purchaseToken)
      if (userId) {
        const user = await getUserInfoById(userId)
        await activatePlus({userId, userHash: user?.hash, source: 'stripe_renew', notifyUser: false})
      }
      await logStripePurchaseEvent({
        purchaseToken,
        notificationType: 'DID_RENEW',
        productId: 'hunter_plus',
        eventTimeMs,
      })
      logger.info({sub: purchaseToken}, '[stripe] invoice.paid processado')
      return
    }

    case 'invoice.payment_failed': {
      const purchaseToken = data.parent?.subscription_details?.subscription
      if (!purchaseToken) return
      await deactivatePlus({purchaseToken, source: 'stripe_payment_failed'})
      await logStripePurchaseEvent({
        purchaseToken,
        notificationType: 'DID_FAIL_TO_RENEW',
        productId: 'hunter_plus',
        eventTimeMs,
      })
      logger.info({sub: purchaseToken}, '[stripe] invoice.payment_failed processado')
      return
    }

    case 'customer.subscription.deleted': {
      const purchaseToken = data.id
      await deactivatePlus({purchaseToken, source: 'stripe_subscription_deleted'})
      await logStripePurchaseEvent({
        purchaseToken,
        notificationType: 'CANCELLED',
        productId: 'hunter_plus',
        eventTimeMs,
      })
      logger.info({sub: purchaseToken}, '[stripe] subscription.deleted processado')
      return
    }

    default:
      logger.debug({type: event.type}, '[stripe] evento não tratado')
  }
}
