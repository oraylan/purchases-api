// src/jobs/reconcileSubscriptions.js
//
// Cron de AUDITORIA anti-zumbi. Diariamente percorre users marcados como
// Plus localmente e confere com a fonte de verdade externa (Apple App
// Store Server API + Stripe API).
//
// IMPORTANTE: NÃO toma ação automática. Apenas produz um relatório
// detalhado no Discord listando os candidatos a zumbi pra o operador
// conferir manualmente e decidir desligar (ou não) caso-a-caso.
//
// Filtros aplicados ANTES da consulta à plataforma externa:
//   - User precisa ter flag premium ativa (filtro na query inicial).
//   - User NÃO pode ter outra assinatura mais nova + vigente (filtro
//     via hasNewerSubscription) — pra evitar consulta API + entrada no
//     relatório de quem migrou de plataforma (ex.: cancelou Stripe e
//     comprou iOS depois).
//
// Android NÃO entra aqui — plus-manager (worker Pub/Sub) já reconcilia
// continuamente via notifications do Google.
import {logger} from '../config/logger.js'
import {listIosPlusUsers, listStripePlusUsers} from '../db/queries/reconcile.js'
import {getSubscriptionStatuses} from '../providers/apple/subscriptionStatus.js'
import {stripe} from '../providers/stripe/client.js'
import {discordAlert} from '../comms/discord.js'
import {hasNewerSubscription} from '../db/queries/users.js'

/**
 * Apple subscription status codes (App Store Server API):
 *   1 = active
 *   2 = expired
 *   3 = in billing retry period
 *   4 = grace period
 *   5 = revoked
 *
 * Consideramos "ativa" (mantém Plus): 1, 3, 4.
 * Consideramos "inativa" (candidato a zumbi): 2, 5.
 */
const APPLE_ACTIVE_STATUSES = new Set([1, 3, 4])

const STRIPE_ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

// Quantas API calls Apple/Stripe processamos em paralelo. Ambas
// plataformas suportam folgadamente (Apple ~3.6k req/min em produção,
// Stripe ~100 read/s). Aumentar ganha tempo total mas começa a apertar
// rate limit; 10 dá ~10x speedup mantendo margem larga.
const BATCH_SIZE = 10

async function processInBatches(items, worker) {
  const results = []
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(worker))
    results.push(...batchResults)
  }
  return results
}

async function auditIosUser(row) {
  const {userId, originalTransactionId} = row

  // Atalho: se já tem sub mais nova vigente, nem consulta a Apple — não
  // é candidato. Equivale ao que `deactivatePlus` faz internamente, só
  // que aplicado antes pra economizar API call.
  if (await hasNewerSubscription(userId, originalTransactionId)) {
    return {status: 'protected_by_newer'}
  }

  let result
  try {
    result = await getSubscriptionStatuses(originalTransactionId)
  } catch (err) {
    logger.error(
      {
        err: err?.message || err?.errorMessage || String(err),
        httpStatusCode: err?.httpStatusCode,
        apiError: err?.apiError,
        errorMessage: err?.errorMessage,
        userId,
        originalTransactionId,
      },
      'reconcile iOS: erro',
    )
    return {status: 'error', error: err?.message || err?.errorMessage || 'unknown'}
  }

  if (!result?.data) {
    logger.warn({userId, originalTransactionId}, 'reconcile iOS: sem resposta da Apple')
    return {status: 'skip', reason: 'no_response'}
  }

  // Apple agrupa por subscription group, cada grupo tem lastTransactions[].
  const allTransactions = (result.data.data || []).flatMap(g => g.lastTransactions || [])
  if (allTransactions.length === 0) {
    logger.warn({userId, originalTransactionId}, 'reconcile iOS: nenhuma transaction')
    return {status: 'skip', reason: 'no_transactions'}
  }

  const allActive = allTransactions.some(t => APPLE_ACTIVE_STATUSES.has(t.status))
  if (allActive) {
    return {status: 'ok'}
  }

  const statuses = allTransactions.map(t => t.status).join(',')
  return {
    status: 'zumbi',
    detail: {
      ...row,
      platform: 'iOS',
      statuses,
      envUsed: result.envUsed,
    },
  }
}

async function auditStripeUser(row) {
  const {userId, stripeCustomerId, purchaseToken} = row

  if (purchaseToken && (await hasNewerSubscription(userId, purchaseToken))) {
    return {status: 'protected_by_newer'}
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 5,
    })
    const stillEligible = subs.data.some(s => STRIPE_ACTIVE_STATUSES.has(s.status))
    if (stillEligible) {
      return {status: 'ok'}
    }

    const lastSubStatus = subs.data[0]?.status ?? 'none'
    return {
      status: 'zumbi',
      detail: {
        ...row,
        platform: 'Stripe',
        lastSubStatus,
      },
    }
  } catch (err) {
    logger.error({err: err.message, userId, stripeCustomerId}, 'reconcile Stripe: erro')
    return {status: 'error', error: err.message}
  }
}

function fmtTs(ms) {
  if (!ms) return '—'
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const d = new Date(n)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

function fmtDateCreate(dc) {
  if (!dc) return '—'
  // mysql2 devolve Date object; pode vir string também
  const d = dc instanceof Date ? dc : new Date(dc)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

function fmtUserHeader(z) {
  const name = z.fullname?.trim() || 'sem nome'
  const mail = z.mail?.trim() || 'sem email'
  return `🧟 **${z.platform}** — #${z.userId} — ${name}\n` + `   📧 ${mail} | 🔗 hash: \`${z.hash}\``
}

function fmtIosZumbi(z) {
  return (
    fmtUserHeader(z) +
    '\n' +
    `   📲 origTx: \`${z.originalTransactionId}\`\n` +
    `   🎫 produto: \`${z.productId || '—'}\`\n` +
    `   📅 compra: ${fmtTs(z.purchaseTime)} | expiry: ${fmtTs(z.expiryTime)} | criado: ${fmtDateCreate(z.dateCreate)}\n` +
    `   🔍 statuses Apple: \`${z.statuses}\` (env: ${z.envUsed})`
  )
}

function fmtStripeZumbi(z) {
  return (
    fmtUserHeader(z) +
    '\n' +
    `   💳 customer: \`${z.stripeCustomerId}\`\n` +
    `   🔗 sub: \`${z.purchaseToken}\`\n` +
    `   🎫 produto: \`${z.productId || '—'}\`\n` +
    `   📅 compra: ${fmtTs(z.purchaseTime)} | expiry: ${fmtTs(z.expiryTime)} | criado: ${fmtDateCreate(z.dateCreate)}\n` +
    `   🔍 último status Stripe: \`${z.lastSubStatus}\``
  )
}

const DISCORD_MSG_LIMIT = 1900 // margem do limite de 2000

/**
 * Envia o relatório no Discord em pedaços que cabem no limite de 2000
 * chars por mensagem. Cada zumbi nunca é quebrado entre mensagens.
 */
async function sendReport({stats, iosZumbis, stripeZumbis, durationMs}) {
  const header =
    `[HUNTER PLUS] 📊 Relatório anti-zumbi (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)\n` +
    '```\n' +
    `iOS:    ${String(stats.iosTotal).padStart(4)} verificados | ${String(stats.iosProtected).padStart(4)} protegidos | ${String(stats.iosErrors).padStart(2)} erros | ${stats.iosZumbis} zumbis\n` +
    `Stripe: ${String(stats.stripeTotal).padStart(4)} verificados | ${String(stats.stripeProtected).padStart(4)} protegidos | ${String(stats.stripeErrors).padStart(2)} erros | ${stats.stripeZumbis} zumbis\n` +
    `Duração: ${(durationMs / 1000).toFixed(1)}s\n` +
    '```'

  await discordAlert(header).catch(() => {})

  const totalZumbis = iosZumbis.length + stripeZumbis.length
  if (totalZumbis === 0) {
    await discordAlert('✅ Nenhum zumbi detectado.').catch(() => {})
    return
  }

  await discordAlert(`═══ ${totalZumbis} candidato(s) a zumbi — conferir manualmente ═══`).catch(() => {})

  const blocks = [
    ...iosZumbis.map(fmtIosZumbi),
    ...stripeZumbis.map(fmtStripeZumbi),
  ]

  // Pagina mensagens
  let buf = ''
  for (const block of blocks) {
    const next = buf ? buf + '\n\n' + block : block
    if (next.length > DISCORD_MSG_LIMIT) {
      if (buf) await discordAlert(buf).catch(() => {})
      buf = block
    } else {
      buf = next
    }
  }
  if (buf) await discordAlert(buf).catch(() => {})
}

/**
 * Roda 1 ciclo de auditoria. Idempotente — não mexe em banco, então
 * pode chamar várias vezes sem efeito colateral.
 */
export async function runReconciliation() {
  const startedAt = Date.now()
  logger.info('[reconcile] iniciando auditoria diária')

  const stats = {
    iosTotal: 0,
    iosProtected: 0,
    iosErrors: 0,
    iosZumbis: 0,
    stripeTotal: 0,
    stripeProtected: 0,
    stripeErrors: 0,
    stripeZumbis: 0,
  }

  const iosZumbis = []
  const stripeZumbis = []

  // iOS — processado em paralelo em batches (Apple aguenta)
  try {
    const iosUsers = await listIosPlusUsers(5000)
    stats.iosTotal = iosUsers.length
    const iosResults = await processInBatches(iosUsers, auditIosUser)
    for (const res of iosResults) {
      if (res.status === 'protected_by_newer') stats.iosProtected++
      else if (res.status === 'error') stats.iosErrors++
      else if (res.status === 'zumbi') {
        stats.iosZumbis++
        iosZumbis.push(res.detail)
      }
    }
  } catch (err) {
    logger.error({err: err.message}, '[reconcile] erro geral no batch iOS')
  }

  // Stripe — idem
  try {
    const stripeUsers = await listStripePlusUsers(5000)
    stats.stripeTotal = stripeUsers.length
    const stripeResults = await processInBatches(stripeUsers, auditStripeUser)
    for (const res of stripeResults) {
      if (res.status === 'protected_by_newer') stats.stripeProtected++
      else if (res.status === 'error') stats.stripeErrors++
      else if (res.status === 'zumbi') {
        stats.stripeZumbis++
        stripeZumbis.push(res.detail)
      }
    }
  } catch (err) {
    logger.error({err: err.message}, '[reconcile] erro geral no batch Stripe')
  }

  const durationMs = Date.now() - startedAt
  logger.info({...stats, durationMs}, '[reconcile] concluído')

  await sendReport({stats, iosZumbis, stripeZumbis, durationMs})

  return {stats, iosZumbis, stripeZumbis}
}
