// src/middlewares/requireAdminToken.js
//
// preHandler pra rotas /admin/* — confere header `x-admin-token`
// contra env.adminToken. Não é auth enterprise — é gating simples
// pra evitar exposição pública. Pra prod real, considerar IP allowlist
// + IAM.
import {env} from '../config/env.js'

export async function requireAdminToken(req, reply) {
  const got = req.headers['x-admin-token']
  if (got !== env.adminToken) {
    return reply.status(401).send({success: false, message: 'unauthorized'})
  }
}
