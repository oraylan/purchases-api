// src/db/pgQueries.js
//
// Queries Postgres no `ht_advert`. Réplica passiva — usada pelo serviço
// de ads pra decidir quem é Plus. Não bloqueia o fluxo de compra se
// falhar (caller usa try/catch e segue).
import {pool} from './pg.js'

export async function addPremiumPg(hashUser) {
  await pool.query(
    'INSERT INTO user_plus(user_hash) VALUES($1) ON CONFLICT (user_hash) DO NOTHING RETURNING *',
    [hashUser],
  )
}

export async function removePremiumPg(hashUser) {
  await pool.query('DELETE FROM user_plus WHERE user_hash = $1 RETURNING *', [hashUser])
}
