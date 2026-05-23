// src/middlewares/auth.js
//
// Pre-handler do Fastify que combina verifyHashUser + verifyUserToken
// num único passe — equivalente aos middlewares Express da apiv2,
// mas usando o ciclo de vida do Fastify (preHandler).
//
// Decora `req.userId` e `req.userHash` quando passa. Falha com 400/401
// quando hash inválido ou token inválido.
import {findUserIdByHash, verifyToken} from '../db/queries/users.js'

/**
 * preHandler — usar como `{preHandler: requireUserAuth}` nas rotas.
 * Espera o hash em body.hashUser OU params.hashUser.
 * Espera o token em header Authorization.
 */
export async function requireUserAuth(req, reply) {
  const hashUser = req.body?.hashUser || req.params?.hashUser
  if (!hashUser) {
    return reply.status(400).send({success: false, message: 'hashUser obrigatório'})
  }

  const userId = await findUserIdByHash(hashUser)
  if (!userId) {
    return reply.status(400).send({success: false, message: 'Usuário inválido'})
  }

  const token = req.headers.authorization
  if (!token) {
    return reply.status(400).send({success: false, message: 'token obrigatório'})
  }

  const isValid = await verifyToken(userId, token)
  if (!isValid) {
    return reply.status(401).send({success: false, message: 'Token inválido'})
  }

  req.userId = userId
  req.userHash = hashUser
}
