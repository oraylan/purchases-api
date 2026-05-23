// src/providers/apple/client.js
//
// AppStoreServerAPIClient — faz chamadas HTTP autenticadas pra Apple
// usando a .p8 (In-App Purchase Key). Diferente do SignedDataVerifier
// (offline), esse cliente fala com endpoints reais da Apple:
//   - requestTestNotification (debug do webhook)
//   - getTransactionHistory
//   - getSubscriptionStatuses (CRÍTICO pro cron de reconciliação)
//   - extendSubscriptionRenewalDate (raramente — extensão manual)
//
// Cacheado por ambiente. Lazy: só carrega a .p8 na 1ª chamada.
import fs from 'node:fs'
import {AppStoreServerAPIClient, Environment} from '@apple/app-store-server-library'
import {env} from '../../config/env.js'

const clients = {production: null, sandbox: null}
const clientPromises = {production: null, sandbox: null}

/**
 * @param {'production' | 'sandbox'} envName
 * @returns {Promise<AppStoreServerAPIClient>}
 */
export async function getAppStoreClient(envName) {
  if (clients[envName]) return clients[envName]
  if (clientPromises[envName]) return clientPromises[envName]

  clientPromises[envName] = (async () => {
    const signingKey = fs.readFileSync(env.apple.keyPath, 'utf8')
    const appleEnv = envName === 'sandbox' ? Environment.SANDBOX : Environment.PRODUCTION

    clients[envName] = new AppStoreServerAPIClient(
      signingKey,
      env.apple.keyId,
      env.apple.issuerId,
      env.apple.bundleId,
      appleEnv,
    )
    return clients[envName]
  })()

  return clientPromises[envName]
}
