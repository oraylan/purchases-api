// src/db/pg.js
//
// Pool Postgres pra `ht_advert` — réplica passiva de Plus consumida
// pelo serviço de ads (decide se entrega anúncio ou não). Só temos
// duas operações: inserir e deletar `user_plus(user_hash)`.
//
// É réplica passiva: se cair, não bloqueia o fluxo de compra. Os
// callers devem usar try/catch e seguir (logger no warn level).
import pg from 'pg'
import {env} from '../config/env.js'

export const pool = new pg.Pool({
  host: env.pg.host,
  port: env.pg.port,
  user: env.pg.user,
  password: env.pg.password,
  database: env.pg.database,
  max: 10,
})
