// src/providers/google/verifySubscription.js
//
// Valida uma compra de subscription Android (Google Play Billing) via
// Android Publisher API. Confirma que o purchase_token recebido do app
// realmente corresponde a uma sub válida pro produto informado.
//
// Retorna os dados brutos da API (startTimeMillis, expiryTimeMillis,
// autoRenewing, paymentState, etc) — o caller decide o que fazer
// (ativar Plus, gravar expiry, etc).
//
// NÃO faz side effects (sem setUserPlus, sem addPremiumPg, sem
// commAlert). A apiv2 fazia tudo aqui dentro — separamos.
import {playDeveloperApi, packageName} from './client.js'

export class GoogleSubscriptionVerificationError extends Error {
  constructor(message, status, cause) {
    super(message)
    this.name = 'GoogleSubscriptionVerificationError'
    this.status = status
    if (cause) this.cause = cause
  }
}

/**
 * @param {object} args
 * @param {string} args.purchaseToken
 * @param {string} args.productId  — subscription id (mesmo do SKU)
 * @returns {Promise<{
 *   startTimeMillis: string,
 *   expiryTimeMillis: string,
 *   autoRenewing: boolean,
 *   paymentState: number,
 *   raw: object
 * }>}
 */
export async function verifyAndroidSubscription({purchaseToken, productId}) {
  try {
    const response = await playDeveloperApi.purchases.subscriptions.get({
      packageName,
      subscriptionId: productId,
      token: purchaseToken,
    })

    if (response.status !== 200) {
      throw new GoogleSubscriptionVerificationError(
        `HTTP ${response.status} ao validar subscription`,
        response.status,
      )
    }

    return {
      startTimeMillis: response.data?.startTimeMillis,
      expiryTimeMillis: response.data?.expiryTimeMillis,
      autoRenewing: Boolean(response.data?.autoRenewing),
      paymentState: response.data?.paymentState,
      raw: response.data,
    }
  } catch (err) {
    if (err instanceof GoogleSubscriptionVerificationError) throw err
    throw new GoogleSubscriptionVerificationError(
      err?.message || 'Erro ao consultar Google Play',
      err?.response?.status,
      err,
    )
  }
}
