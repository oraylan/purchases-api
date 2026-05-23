// src/providers/google/verifyProduct.js
//
// Valida uma compra de produto único Android (Google Play Billing) —
// usado pelos SKUs PIX (hunter_plus_*_pix). Diferente da subscription,
// um produto único tem `purchaseState`:
//
//   0 = concluída  ✅
//   1 = cancelada  ❌
//   2 = pendente   ⏳ (espera confirmação posterior)
//
// Retorna o estado bruto + um discriminador friendly. O caller
// (handler/cron) decide:
//   - state=0 → liberar Plus, ackar token (setPurchaseStatus(0))
//   - state=2 → marcar pending=1 (cron reprocessa)
//   - state=1 → cancelar, marcar expired, remover Plus se aplicável
//
// Sem side effects (sem setUserPlusUnique, sem commAlert) — diferente
// da apiv2 que orquestrava tudo aqui.
import {playDeveloperApi, packageName} from './client.js'

export class GoogleProductVerificationError extends Error {
  constructor(message, status, cause) {
    super(message)
    this.name = 'GoogleProductVerificationError'
    this.status = status
    if (cause) this.cause = cause
  }
}

/**
 * @param {object} args
 * @param {string} args.purchaseToken
 * @param {string} args.productId  — SKU do produto (ex: hunter_plus_mensal_pix)
 * @returns {Promise<{
 *   state: 'completed' | 'pending' | 'cancelled',
 *   purchaseState: number,
 *   orderId: string | null,
 *   raw: object
 * }>}
 */
export async function verifyAndroidProduct({purchaseToken, productId}) {
  try {
    const response = await playDeveloperApi.purchases.products.get({
      packageName,
      productId,
      token: purchaseToken,
    })

    if (response.status !== 200) {
      throw new GoogleProductVerificationError(
        `HTTP ${response.status} ao validar product`,
        response.status,
      )
    }

    const purchaseState = response.data?.purchaseState
    let state
    if (purchaseState === 0) state = 'completed'
    else if (purchaseState === 2) state = 'pending'
    else state = 'cancelled' // 1 ou qualquer outro fallback

    return {
      state,
      purchaseState,
      orderId: response.data?.orderId ?? null,
      raw: response.data,
    }
  } catch (err) {
    if (err instanceof GoogleProductVerificationError) throw err
    throw new GoogleProductVerificationError(
      err?.message || 'Erro ao consultar Google Play',
      err?.response?.status,
      err,
    )
  }
}
