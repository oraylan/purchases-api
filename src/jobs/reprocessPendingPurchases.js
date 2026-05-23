// Cron PIX pending — re-valida compras Android one-time em `pending=1`.
// Portado da apiv2 (que não tem mais esse cron). Roda a cada minuto.
import {logger} from '../config/logger.js'
import {fetchPendingPurchases, setPurchaseStatus, fixGoogleOrderId, markOneTimeExpired} from '../db/queries/pending.js'
import {getUserInfoById} from '../db/queries/users.js'
import {verifyAndroidProduct, GoogleProductVerificationError} from '../providers/google/verifyProduct.js'
import {activatePlus} from '../handlers/activatePlus.js'
import {deactivatePlus} from '../handlers/deactivatePlus.js'
import {notifyCustom} from '../comms/notify.js'
import {discordAlert} from '../comms/discord.js'

export async function reprocessPendingPurchases() {
  let pendings
  try {
    pendings = await fetchPendingPurchases()
  } catch (err) {
    logger.error({err: err?.message}, '[pix-cron] falha ao listar pendings')
    return
  }
  if (pendings.length === 0) return
  logger.info({count: pendings.length}, '[pix-cron] reprocessando pendings')

  for (const p of pendings) {
    try {
      await reprocessOne(p)
    } catch (err) {
      logger.error({userId: p.userId, productId: p.productId, err: err?.message}, '[pix-cron] erro inesperado')
    }
  }
}

async function reprocessOne({token, productId, userId, userHash}) {
  let result
  try {
    result = await verifyAndroidProduct({purchaseToken: token, productId})
  } catch (err) {
    if (err instanceof GoogleProductVerificationError) {
      logger.warn({userId, productId, err: err.message}, '[pix-cron] erro validando — vai retentar')
      return
    }
    throw err
  }

  if (result.orderId) {
    await fixGoogleOrderId(token, result.orderId).catch(() => {})
  }

  if (result.state === 'completed') {
    await setPurchaseStatus(token, 0)
    await activatePlus({userId, userHash, source: 'pix_cron', productId})
    logger.info({userId, productId, orderId: result.orderId}, '[pix-cron] PIX confirmado — Plus ativado')
    const userLabel = await formatUserLabel(userId)
    discordAlert(`[HUNTER PLUS] ✅ PIX confirmado **${userLabel}** produto **${productId}**`).catch(() => {})
    return
  }

  if (result.state === 'pending') {
    logger.debug({userId, productId}, '[pix-cron] ainda pending')
    return
  }

  // cancelled (ou outro state inesperado)
  await setPurchaseStatus(token, 0)
  await markOneTimeExpired(token)
  await deactivatePlus({purchaseToken: token, source: 'pix_cancelled', notifyUser: false})

  const user = await getUserInfoById(userId).catch(() => null)
  if (user?.hash) {
    notifyCustom(user.hash, {
      title: '{{name}}, tivemos um problema com o seu pagamento.',
      body: 'Sua compra foi cancelada e o Hunter Plus não foi ativado. Confira no Google Play e tente novamente.',
    }).catch(() => {})
  }
  const userLabel = await formatUserLabel(userId, user)
  discordAlert(`[HUNTER PLUS] ❌ PIX cancelado **${userLabel}** produto **${productId}**`).catch(() => {})
  logger.warn({userId, productId}, '[pix-cron] PIX cancelado')
}
