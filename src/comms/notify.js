// src/comms/notify.js
//
// Orquestradores de comunicação ao usuário — push + email combinados.
// Equivalente ao `comNewPlus` / `comCanceledPlus` da apiv2.
//
// Padrão de uso: chamado pelos handlers/jobs DEPOIS de confirmar
// uma mudança no banco. Não bloqueia o fluxo: cada comm individual
// já loga falhas sem propagar. `Promise.all` aqui dispara em paralelo.
import {sendPush} from './push.js'
import {sendEmail} from './email.js'

const COPY_NEW_PLUS = {
  title: 'Bem-vindo ao Hunter Plus, {{name}}! 👑',
  body: 'Agora você tem áudio em alta qualidade e uma experiência sem anúncios visuais. Aproveite sua música favorita na Hunter.FM! 🎶',
}

const COPY_CANCELED_PLUS = {
  title: '{{name}}, sua assinatura Hunter Plus expirou.',
  body: 'O Hunter Plus deixou sua experiência ainda melhor. Renove agora e continue curtindo áudio em alta qualidade e sem anúncios visuais! 🎶✨',
}

/** Avisa o user que o Plus foi ativado. */
export async function notifyPlusActivated(hashUser) {
  if (!hashUser) return
  await Promise.all([
    sendPush({hash: hashUser, ...COPY_NEW_PLUS}),
    sendEmail({hash: hashUser, type: 'new'}),
  ])
}

/** Avisa o user que o Plus expirou/cancelou. */
export async function notifyPlusDeactivated(hashUser) {
  if (!hashUser) return
  await Promise.all([
    sendPush({hash: hashUser, ...COPY_CANCELED_PLUS}),
    sendEmail({hash: hashUser, type: 'canceled'}),
  ])
}

/** Push genérico — pra avisos específicos (ex: pagamento PIX cancelado). */
export async function notifyCustom(hashUser, {title, body}) {
  if (!hashUser) return
  await sendPush({hash: hashUser, title, body})
}
