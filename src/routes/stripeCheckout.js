// src/routes/stripeCheckout.js
//
// POST /checkout                — cria checkout session Stripe pro site
// POST /checkout/portal         — abre billing portal pra gerenciar sub
//
// Mantém compatibilidade do contrato com o site atual.
import {requireUserAuth} from '../middlewares/auth.js'
import {createCheckoutSession, CheckoutCreationError} from '../providers/stripe/createCheckout.js'
import {createBillingPortalSession, BillingPortalError} from '../providers/stripe/billingPortal.js'
import {findStripeCustomerIdByHash, upsertUserTaxId} from '../db/queries/stripe.js'

const checkoutBodySchema = {
  type: 'object',
  required: ['hashUser', 'plano', 'email'],
  properties: {
    hashUser: {type: 'string', minLength: 1},
    plano: {type: 'string', enum: ['mensal', 'semestral', 'anual']},
    email: {type: 'string', format: 'email'},
    tax_id_type: {type: ['string', 'null']},
    tax_id: {type: ['string', 'null']},
  },
}

const portalBodySchema = {
  type: 'object',
  required: ['hashUser'],
  properties: {hashUser: {type: 'string', minLength: 1}},
}

export async function stripeCheckoutRoutes(app) {
  app.post(
    '/checkout',
    {preHandler: requireUserAuth, schema: {body: checkoutBodySchema}},
    async (req, reply) => {
      const {plano, email, hashUser, tax_id_type, tax_id} = req.body

      // Salva tax_id se vier (CPF/CNPJ)
      if (tax_id_type && tax_id) {
        const tipo = String(tax_id_type).toLowerCase().trim()
        const numero = String(tax_id).replace(/\D/g, '')
        const tamanhoOk = (tipo === 'cpf' && numero.length === 11) || (tipo === 'cnpj' && numero.length === 14)
        if (tamanhoOk) {
          try {
            await upsertUserTaxId({userId: req.userId, country: 'BR', type: tipo, taxId: numero})
          } catch (err) {
            req.log.warn({err: err?.message}, 'falha ao salvar tax_id (não-bloqueante)')
          }
        }
      }

      try {
        const session = await createCheckoutSession({
          plan: plano,
          userId: req.userId,
          userHash: hashUser,
          successUrl: `https://hunter.fm/?plusok=true&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: 'https://hunter.fm/plus/?cancel=true',
          taxId: tax_id ? {country: 'BR', type: tax_id_type, taxId: tax_id} : undefined,
          email,
        })
        return {url: session.url}
      } catch (err) {
        if (err instanceof CheckoutCreationError) {
          return reply.status(400).send({error: err.message})
        }
        throw err
      }
    },
  )

  app.post(
    '/checkout/portal',
    {preHandler: requireUserAuth, schema: {body: portalBodySchema}},
    async (req, reply) => {
      const result = await findStripeCustomerIdByHash(req.body.hashUser)

      if (result.status === 'not_found') {
        return reply.status(404).send({error: 'Assinatura não encontrada'})
      }
      if (result.status === 'other_platform') {
        return reply.status(200).send({
          warning: `Assinatura realizada no ${result.platform}`,
          code: 'PLATFORM_MISMATCH',
        })
      }

      try {
        const portal = await createBillingPortalSession({
          customerId: result.customerId,
          returnUrl: 'https://hunter.fm/',
        })
        return {url: portal.url}
      } catch (err) {
        if (err instanceof BillingPortalError) {
          return reply.status(400).send({error: err.message})
        }
        throw err
      }
    },
  )
}
