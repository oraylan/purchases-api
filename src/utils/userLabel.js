// src/utils/userLabel.js
//
// Helper pra formatar identificação de user em logs e alertas Discord.
// Em vez de só "userId 123", vira "Fulano de Tal (#123)" — mais útil
// pra quem lê o alerta sem ter que ir no banco.
//
// Falha silenciosa: se o lookup quebrar ou o user não tiver fullname,
// devolve "#123" — nunca lança e nunca quebra o fluxo do caller.
import {getUserInfoById} from '../db/queries/users.js'
import {logger} from '../config/logger.js'

/**
 * @param {number|string} userId
 * @param {{id?: number, fullname?: string}} [user]  Objeto já carregado
 *   (resultado de getUserInfoById) pra pular o lookup. Se omitido, faz
 *   SELECT.
 * @returns {Promise<string>}
 */
export async function formatUserLabel(userId, user) {
  const id = userId ?? user?.id
  if (!id) return '#?'

  let u = user
  if (!u) {
    try {
      u = await getUserInfoById(id)
    } catch (err) {
      logger.warn({err: err?.message, userId: id}, 'formatUserLabel: lookup falhou')
    }
  }

  const name = u?.fullname?.trim()
  return name ? `${name} (#${id})` : `#${id}`
}
