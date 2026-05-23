// src/db/queries/streamCfg.js
//
// Cria a config de stream pro user quando ele vira Plus. Default:
// `cfg_hunternews=1` (escuta Hunter News), `cfg_interads=0` (não
// escuta interads). User pode mudar nas configs do app.
//
// Idempotente — chamar 2x não duplica nada (skip se já existe).
import {pool} from '../mysql.js'

export async function initUserStreamConfig(userId) {
  if (!userId) return 0

  const [existing] = await pool.query(
    'SELECT 1 FROM user_stream_cfg WHERE user_id = ? LIMIT 1',
    [userId],
  )
  if (existing.length > 0) return 0

  const [insertResult] = await pool.query(
    `INSERT INTO user_stream_cfg (user_id, cfg_hunternews, cfg_interads, updated_at)
     VALUES (?, 1, 0, NOW())`,
    [userId],
  )

  await pool.query('UPDATE user SET date_last_update = NOW() WHERE id = ?', [userId])

  return insertResult.affectedRows
}
