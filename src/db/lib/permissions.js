// src/db/lib/permissions.js
//
// Permissions são guardadas como bitfield (INT) na coluna `user.permission`.
// Cada permission é um bit numa posição fixa — mesmo mapa da apiv2, NÃO
// alterar (compatibilidade com sistema existente). Usado por outros
// projetos (plus-manager, dashboards, etc).
//
// Pra evitar o bug de read-modify-write (race condition entre dois
// updates concorrentes — comum em webhook + compra direta no mesmo
// instante), as queries usam `UPDATE ... SET permission = permission |
// (1 << N)` direto no SQL. Atômico, sem janela de corrida.
//
// As funções `getPermissions`/`setPermissions` continuam aqui pra casos
// onde precisamos manipular múltiplas permissions de uma vez (não é o
// caso de Plus, mas mantemos compatibilidade).

export const PERMISSIONS = Object.freeze({
  disconnect: -1,
  user: 0,
  top5: 1,
  chat: 2,
  voicemail: 3,
  premium: 4,
  'send-news': 6,
  'chat-mod': 7,
  'voicemail-mod': 8,
  'accept-news': 10,
  'accept-lyric': 11,
  'accept-subtitles': 12,
  'edit-badwords': 13,
  'edit-music': 16,
  'edit-singer': 17,
  'edit-label': 18,
  'edit-genre': 19,
  'edit-news': 20,
  'edit-station': 21,
  'edit-bot-msg': 22,
  'edit-bot-cmd': 23,
  'edit-users-1': 24,
  'newsletter-push': 25,
  'edit-users-2': 28,
  logged: 50,
  'my-hash': 51,
})

/** Bit position da permission `premium`. Usado em UPDATE atômico. */
export const PREMIUM_BIT = PERMISSIONS.premium
/** Mascara como BigInt — bits acima de 30 precisam BigInt no JS pra não estourar int32. */
export const PREMIUM_MASK = 1 << PREMIUM_BIT // 16 — cabe em int32

/**
 * Decodifica um bitfield (string/number) em array de nomes ativos.
 * Mantido pra compatibilidade — não usar pra checar Plus específico
 * (use `(permission & PREMIUM_MASK) !== 0` direto na query).
 */
export function getPermissions(stringPermission) {
  if (stringPermission === null || stringPermission === undefined) return []
  const userPerm = parseInt(stringPermission, 10)
  if (userPerm === -1) return []
  const active = []
  for (const [name, bit] of Object.entries(PERMISSIONS)) {
    if (bit >= 0 && userPerm & (1 << bit)) {
      active.push(name)
    }
  }
  return active
}

/** Empacota lista de permission names em bitfield. */
export function setPermissions(permissions) {
  let value = 0
  for (const name of permissions) {
    const bit = PERMISSIONS[name]
    if (bit >= 0) value |= 1 << bit
  }
  return value
}

/** Descrições humanas de notification types Apple/Stripe (usado em logBd). */
const DESCRIPTIONS = {
  CONSUMPTION_REQUEST: 'Requisição de consumo',
  DID_CHANGE_RENEWAL_PREF: 'Preferência de renovação alterada',
  DID_CHANGE_RENEWAL_STATUS: 'Status de renovação alterado',
  DID_FAIL_TO_RENEW: 'Falha na renovação',
  DID_RENEW: 'Assinatura renovada',
  EXPIRED: 'Assinatura expirada',
  EXTERNAL_PURCHASE_TOKEN: 'Token de compra externa',
  GRACE_PERIOD_EXPIRED: 'Período de carência expirado',
  OFFER_REDEEMED: 'Oferta resgatada',
  PRICE_INCREASE: 'Aumento de preço',
  REFUND: 'Reembolso',
  REFUND_DECLINED: 'Reembolso recusado',
  REFUND_REVERSED: 'Reembolso revertido',
  RENEWAL_EXTENDED: 'Renovação estendida',
  RENEWAL_EXTENSION: 'Extensão de renovação',
  REVOKE: 'Revogação',
  SUBSCRIBED: 'Inscrição efetuada',
  TEST: 'Teste',
  CANCELLED: 'Assinatura cancelada',
  ONE_TIME_CHARGE: 'Cobrança única',
}

export function describeNotificationType(notificationType) {
  return DESCRIPTIONS[notificationType] || 'Desconhecida'
}
