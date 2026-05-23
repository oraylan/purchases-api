// src/providers/apple/verifyNotification.js
//
// Valida + decodifica um JWS de App Store Server Notification V2 (webhook
// `/purchaseNotification`). Substitui o `jwt.decode(...)` inseguro da apiv2
// — sem validação de assinatura qualquer ator que descubra a URL poderia
// forjar eventos (sabotagem, fraude).
//
// A lib oficial:
//   - Valida assinatura JWS contra os root CAs da Apple.
//   - Confere bundleId.
//   - Confere environment (sandbox vs production) — rejeita mismatch.
//   - Retorna ResponseBodyV2DecodedPayload com:
//       notificationType, subtype, notificationUUID,
//       data: { signedTransactionInfo (JWS), signedRenewalInfo (JWS), ... },
//       summary (pra alguns tipos),
//       version
//
// Pra extrair transactionInfo / renewalInfo de DENTRO da notification,
// o caller chama `verifier.verifyAndDecodeTransaction(signedTransactionInfo)`
// — disponibilizamos via `decodeTransactionInfoFromNotification`.
import {getVerifier, primaryEnv, fallbackEnv, INVALID_ENVIRONMENT_STATUS} from './verifier.js'
import {InvalidJwsError} from './verifyTransaction.js'

/**
 * Valida a notificação raw (campo `signedPayload` do body do webhook).
 * Faz fallback prod↔sandbox.
 *
 * @param {string} signedPayload
 * @returns {Promise<{decoded: object, envUsed: 'production'|'sandbox'}>}
 */
export async function verifyNotificationJws(signedPayload) {
  if (!signedPayload || typeof signedPayload !== 'string') {
    throw new InvalidJwsError('signedPayload ausente ou inválido')
  }

  const primary = primaryEnv()
  const fallback = fallbackEnv()

  try {
    const verifier = await getVerifier(primary)
    const decoded = await verifier.verifyAndDecodeNotification(signedPayload)
    return {decoded, envUsed: primary}
  } catch (err) {
    if (err?.status === INVALID_ENVIRONMENT_STATUS) {
      const verifier = await getVerifier(fallback)
      try {
        const decoded = await verifier.verifyAndDecodeNotification(signedPayload)
        return {decoded, envUsed: fallback}
      } catch (err2) {
        throw new InvalidJwsError(
          `Notification inválida nos dois ambientes (${primary}+${fallback})`,
          err2,
        )
      }
    }
    throw new InvalidJwsError(err?.message || 'Notification inválida', err)
  }
}

/**
 * Decodifica o JWS de transactionInfo embutido na notificação. Usa o
 * verifier do mesmo ambiente que validou o envelope (otimização — não
 * tem porque tentar outro ambiente já que o envelope já bateu).
 */
export async function decodeTransactionInfoFromNotification(notificationDecoded, envUsed) {
  const signedTx = notificationDecoded?.data?.signedTransactionInfo
  if (!signedTx) return null
  const verifier = await getVerifier(envUsed)
  return verifier.verifyAndDecodeTransaction(signedTx)
}

/**
 * Decodifica o JWS de renewalInfo embutido na notificação (DID_RENEW,
 * DID_CHANGE_RENEWAL_PREF, etc — contém autoRenewStatus, expirationIntent).
 */
export async function decodeRenewalInfoFromNotification(notificationDecoded, envUsed) {
  const signedRenewal = notificationDecoded?.data?.signedRenewalInfo
  if (!signedRenewal) return null
  const verifier = await getVerifier(envUsed)
  return verifier.verifyAndDecodeRenewalInfo(signedRenewal)
}
