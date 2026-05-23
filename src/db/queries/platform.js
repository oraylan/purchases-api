// src/db/queries/platform.js
//
// Resolve em qual plataforma o user comprou Plus pela última vez.
// Usado pelo endpoint `/plus/platform/:hash` pra decidir onde o app
// deve mandar o user gerenciar a sub (App Store, Play Store, ou
// Stripe Billing Portal).
import {pool} from '../mysql.js'

export async function getLatestPlatform(userId) {
  const [results] = await pool.query(
    `SELECT platform, isOneTime, expiry_time
       FROM user_plus
       WHERE user_id = ?
       ORDER BY date_create DESC
       LIMIT 1`,
    [userId],
  )
  if (results.length === 0) return null
  return {
    platform: results[0].platform,
    isOneTime: Boolean(results[0].isOneTime),
    expiryTime: results[0].expiry_time,
  }
}
