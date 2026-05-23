// src/providers/apple/testNotification.js
//
// Pede pra Apple disparar uma notificação de teste no webhook
// configurado em App Store Connect. Usado pelo endpoint /admin/asn-test
// pra confirmar que a infra Apple → webhook está roteando direito.
//
// A Apple manda em segundos. O payload chega no /webhooks/apple
// com notificationType='TEST' e contém testNotificationToken — útil
// pra cruzar com o token devolvido aqui.
import {getAppStoreClient} from './client.js'

/**
 * @param {'production' | 'sandbox'} envName
 * @returns {Promise<{testNotificationToken: string}>}
 */
export async function requestTestNotification(envName = 'sandbox') {
  const client = await getAppStoreClient(envName)
  return client.requestTestNotification()
}
