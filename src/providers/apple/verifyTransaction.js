// src/providers/apple/verifyTransaction.js
//
// Valida + decodifica um JWS de transação iOS (StoreKit 2). Esse é o
// "token" que o app v14 manda no campo `purchase_token` da rota
// `/purchase/v3`. Substitui o verifyReceipt legacy (base64 receipt).
//
// Fluxo:
//   1) Tenta validar com o verifier do ambiente primário (APPLE_ENV).
//   2) Se vier INVALID_ENVIRONMENT (status 4), tenta o outro.
//   3) Retorna o payload decodificado (JWSTransactionDecodedPayload).
//
// Estrutura relevante do payload:
//   - productId (string)
//   - transactionId (string ou number)
//   - originalTransactionId (idem)
//   - purchaseDate (ms epoch)
//   - expiresDate (ms epoch — só pra subs)
//   - type ('Auto-Renewable Subscription' | 'Consumable' | ...)
//   - bundleId (string — a lib já valida que bate com env.apple.bundleId)
import {getVerifier, primaryEnv, fallbackEnv, INVALID_ENVIRONMENT_STATUS} from './verifier.js'

export class InvalidJwsError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'InvalidJwsError'
    if (cause) this.cause = cause
  }
}

export async function verifyTransactionJws(jws) {
  if (!jws || typeof jws !== 'string') {
    throw new InvalidJwsError('JWS ausente ou inválido')
  }

  const primary = primaryEnv()
  const fallback = fallbackEnv()

  try {
    const verifier = await getVerifier(primary)
    return await verifier.verifyAndDecodeTransaction(jws)
  } catch (err) {
    if (err?.status === INVALID_ENVIRONMENT_STATUS) {
      const verifier = await getVerifier(fallback)
      try {
        return await verifier.verifyAndDecodeTransaction(jws)
      } catch (err2) {
        throw new InvalidJwsError(
          `JWS inválido nos dois ambientes (${primary}+${fallback})`,
          err2,
        )
      }
    }
    throw new InvalidJwsError(err?.message || 'JWS inválido', err)
  }
}
