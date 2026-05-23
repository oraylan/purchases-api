// src/routes/notifications/apple.js
//
// POST /purchaseNotification — webhook ASN V2 da Apple. Apple manda
// eventos do ciclo de vida das subs em formato JWS. Aqui validamos
// assinatura, decodificamos e roteamos pro handler de domínio.
//
// SEM auth de user — esse endpoint é PÚBLICO (a Apple chama do
// servidor dela). A segurança vem da validação JWS contra os root
// CAs Apple.
import {handleAppleNotification} from '../../handlers/handleAppleNotification.js'

const appleNotificationSchema = {
  type: 'object',
  required: ['signedPayload'],
  properties: {
    signedPayload: {type: 'string', minLength: 50},
  },
  additionalProperties: true,
}

export async function appleNotificationRoutes(app) {
  app.post(
    '/purchaseNotification',
    {
      schema: {body: appleNotificationSchema},
    },
    handleAppleNotification,
  )
}
