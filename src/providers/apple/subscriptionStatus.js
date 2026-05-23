// src/providers/apple/subscriptionStatus.js
//
// Consulta status real de uma sub na Apple — usado pelo cron de
// reconciliação (anti-zumbi). Dado um originalTransactionId, retorna
// o estado atual da assinatura:
//
//   - status: 1 (active) | 2 (expired) | 3 (in billing retry) |
//             4 (grace period) | 5 (revoked)
//   - signedTransactionInfo / signedRenewalInfo (JWS — decodificar via
//     verifier)
//
// O cron usa isso pra detectar "users marcados como Plus localmente
// mas a sub real na Apple já caiu" → remover Plus + alertar.
import {getAppStoreClient} from './client.js'
import {primaryEnv, fallbackEnv} from './verifier.js'

/**
 * Busca status de uma sub. Faz fallback prod↔sandbox se o ambiente
 * primário rejeitar (status 4 — INVALID_ENVIRONMENT).
 *
 * @param {string} originalTransactionId
 * @returns {Promise<{data: object, envUsed: 'production'|'sandbox'} | null>}
 */
export async function getSubscriptionStatuses(originalTransactionId) {
  const primary = primaryEnv()
  const fallback = fallbackEnv()

  try {
    const client = await getAppStoreClient(primary)
    const data = await client.getAllSubscriptionStatuses(originalTransactionId)
    return {data, envUsed: primary}
  } catch (err) {
    if (err?.status === 4 /* INVALID_ENVIRONMENT */) {
      const client = await getAppStoreClient(fallback)
      const data = await client.getAllSubscriptionStatuses(originalTransactionId)
      return {data, envUsed: fallback}
    }
    throw err
  }
}
