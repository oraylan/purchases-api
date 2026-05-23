// src/comms/email.js
//
// Envia emails via o serviço interno `nl.hunterbr.com/hunterplus`. O
// endpoint resolve o template pelo `type` (ex: 'new', 'canceled') e
// pega o conteúdo do user via hash.
//
// Erros são logados mas NÃO propagam — email é best-effort.
import axios from 'axios'
import {env} from '../config/env.js'
import {logger} from '../config/logger.js'

const http = axios.create({
  baseURL: env.email.url,
  timeout: 5000,
  headers: {
    Authorization: env.email.auth,
  },
})

/**
 * @param {object} args
 * @param {string} args.hash
 * @param {'new' | 'canceled'} args.type
 */
export async function sendEmail({hash, type}) {
  try {
    await http.post('', {hash, type})
    logger.debug({hash, type}, 'email enviado')
  } catch (err) {
    logger.warn({err: err?.message, hash, type}, 'falha ao mandar email')
  }
}
