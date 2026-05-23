// src/routes/checkoutStatus.js
//
// GET /checkout/:hashUser — confere se o user é Plus atualmente.
// Endpoint legacy usado pelo app pra reconciliar status com o backend
// (caso o app esteja com isOwo true mas o backend já tirou o Plus).
//
// Mantemos a resposta no formato antigo (`{ success: true|false }`)
// pra compatibilidade com o app — não dá pra mudar sem quebrar.
import {requireUserAuth} from '../middlewares/auth.js'
import {isUserPremium} from '../db/queries/users.js'

export async function checkoutStatusRoutes(app) {
  app.get(
    '/checkout/:hashUser',
    {
      preHandler: requireUserAuth,
      schema: {
        params: {
          type: 'object',
          required: ['hashUser'],
          properties: {hashUser: {type: 'string', minLength: 1}},
        },
      },
    },
    async req => {
      const isPlus = await isUserPremium(req.userId)
      return {success: isPlus}
    },
  )
}
