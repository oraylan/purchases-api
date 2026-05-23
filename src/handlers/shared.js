// src/handlers/shared.js
//
// Constantes e helpers compartilhados entre os handlers de purchase.
// Tudo "puro" (sem side effects de banco/network) — facilita reuso.

/**
 * Códigos de resposta da API — usados pelo cliente (app) pra diferenciar
 * cenários sem parsear a mensagem. Importante manter ESTÁVEL: o app v14
 * já reage a `IOS_OK_EXPIRED_BUT_CONFIRMED`, `IOS_OK_ALREADY_PLUS`,
 * `ANDR_PENDING_ONE_TIME`, `ANDR_CANCELLED_ONE_TIME` etc — mudar quebra
 * o fluxo no cliente.
 */
export const CODES = Object.freeze({
  GEN_OK_NO_CHANGE: 'GEN_OK_NO_CHANGE',
  GEN_ERR_INVALID_PLATFORM: 'GEN_ERR_INVALID_PLATFORM',
  GEN_ERR_INTERNAL: 'GEN_ERR_INTERNAL',
  GEN_ERR_VALIDATION: 'GEN_ERR_VALIDATION',

  ANDR_OK_ONE_TIME: 'ANDR_OK_ONE_TIME',
  ANDR_OK_SUBSCRIPTION: 'ANDR_OK_SUBSCRIPTION',
  ANDR_PENDING_ONE_TIME: 'ANDR_PENDING_ONE_TIME',
  ANDR_CANCELLED_ONE_TIME: 'ANDR_CANCELLED_ONE_TIME',
  ANDR_ERR_ORDER_USED_OTHER: 'ANDR_ERR_ORDER_USED_OTHER',

  IOS_OK_PURCHASE: 'IOS_OK_PURCHASE',
  IOS_OK_ALREADY_PLUS: 'IOS_OK_ALREADY_PLUS',
  IOS_OK_EXPIRED_BUT_CONFIRMED: 'IOS_OK_EXPIRED_BUT_CONFIRMED',
  IOS_ERR_ORIGINAL_USED_OTHER: 'IOS_ERR_ORIGINAL_USED_OTHER',
  IOS_ERR_INVALID_JWS: 'IOS_ERR_INVALID_JWS',
})

/**
 * Duração em MESES de cada SKU PIX (compra única Android). Usado pra
 * calcular `expiry_time` no momento da compra (sem esperar webhook).
 *
 * Mantido em meses (não ms) porque calendário tem variação:
 * `addMonthsToTimestamp` lida com meses de 28/30/31 dias.
 */
export const PIX_SKUS_MONTHS = Object.freeze({
  hunter_plus_mensal_pix: 1,
  hunter_plus_semestral_pix: 6,
  hunter_plus_anual_pix: 12,
})

/**
 * Adiciona N meses calendário a um timestamp (em ms). Cuida do edge
 * case onde o dia original não existe no mês de destino (ex: 31 jan
 * + 1 mês = último dia de fev). Mantém hora/min/seg/ms originais.
 *
 * @param {number} timestampMs
 * @param {number} months
 * @returns {number}
 */
export function addMonthsToTimestamp(timestampMs, months) {
  const d = new Date(Number(timestampMs))
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  const hours = d.getUTCHours()
  const minutes = d.getUTCMinutes()
  const seconds = d.getUTCSeconds()
  const ms = d.getUTCMilliseconds()

  let newMonthIndex = month + months
  let newYear = year + Math.floor(newMonthIndex / 12)
  newMonthIndex = newMonthIndex % 12
  if (newMonthIndex < 0) {
    newMonthIndex += 12
    newYear -= 1
  }

  const lastDayOfNewMonth = new Date(Date.UTC(newYear, newMonthIndex + 1, 0)).getUTCDate()
  const newDay = Math.min(day, lastDayOfNewMonth)

  return new Date(Date.UTC(newYear, newMonthIndex, newDay, hours, minutes, seconds, ms)).getTime()
}

/** Helper de resposta padronizada. */
export function ok(reply, {message, code, extra = {}}) {
  return reply.send({success: true, message, code, ...extra})
}

export function fail(reply, {message, code, status = 400, extra = {}}) {
  return reply.status(status).send({success: false, message, code, ...extra})
}
