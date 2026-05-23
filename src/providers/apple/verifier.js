// src/providers/apple/verifier.js
//
// SignedDataVerifier — valida JWS de transações E de notificações
// (App Store Server Notifications V2) usando a lib oficial Apple.
//
// Cacheado por ambiente (production + sandbox) porque na prática o
// mesmo backend lida com ambos: TestFlight usa sandbox, App Store
// real usa production, e sandbox accounts (mesmo após release) também
// usam sandbox. Quando o verifier do ambiente A rejeita com status 4
// (INVALID_ENVIRONMENT), tentamos o B silenciosamente.
import {SignedDataVerifier, Environment} from '@apple/app-store-server-library'
import {env} from '../../config/env.js'
import {loadAppleRootCAs} from './rootCAs.js'

const verifiers = {production: null, sandbox: null}
const verifierPromises = {production: null, sandbox: null}

export const INVALID_ENVIRONMENT_STATUS = 4

/**
 * @param {'production' | 'sandbox'} envName
 * @returns {Promise<SignedDataVerifier>}
 */
export async function getVerifier(envName) {
  if (verifiers[envName]) return verifiers[envName]
  if (verifierPromises[envName]) return verifierPromises[envName]

  verifierPromises[envName] = (async () => {
    const appleEnv = envName === 'sandbox' ? Environment.SANDBOX : Environment.PRODUCTION
    const rootCAs = await loadAppleRootCAs()

    verifiers[envName] = new SignedDataVerifier(
      rootCAs,
      true, // enableOnlineChecks — confere revogação no OCSP
      appleEnv,
      env.apple.bundleId,
      env.apple.appId ? Number(env.apple.appId) : undefined,
    )
    return verifiers[envName]
  })()

  return verifierPromises[envName]
}

/**
 * Retorna o env primário configurado em APPLE_ENV (default production).
 * Usado pra decidir qual verifier tentar primeiro.
 */
export function primaryEnv() {
  return env.apple.env === 'sandbox' ? 'sandbox' : 'production'
}

export function fallbackEnv() {
  return primaryEnv() === 'production' ? 'sandbox' : 'production'
}
