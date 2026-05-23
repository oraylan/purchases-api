// src/comms/push.js
//
// Envia push notifications via o serviço interno `push.hunterbr.com`.
// Endpoint POST recebe { hash, title, body } e usa Authorization fixo.
//
// Erros são logados mas NÃO propagam — push é best-effort, não bloqueia
// fluxo de compra.
import axios from 'axios'
import {env} from '../config/env.js'
import {logger} from '../config/logger.js'

const http = axios.create({
  baseURL: env.push.url,
  timeout: 5000,
  headers: {
    Authorization: env.push.auth,
  },
})

/**
 * @param {object} args
 * @param {string} args.hash   — hash do user
 * @param {string} args.title
 * @param {string} args.body
 */
export async function sendPush({hash, title, body}) {
  try {
    await http.post('', {hash, title, body})
    logger.debug({hash}, 'push enviado')
  } catch (err) {
    logger.warn({err: err?.message, hash}, 'falha ao mandar push')
  }
}
