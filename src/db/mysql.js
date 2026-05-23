// src/db/mysql.js
//
// Pool MySQL2 promise-based. Compartilhado entre todas as queries —
// importa uma única vez, reusa em qualquer módulo de query.
//
// connectionLimit=10 acompanha o padrão da apiv2 / plus-manager (não
// estouramos quotas do MySQL em dev nem em prod). Pra observabilidade
// futura: o pool emite eventos `acquire`/`release` se precisar
// instrumentar.
import mysql from 'mysql2/promise'
import {env} from '../config/env.js'

export const pool = mysql.createPool({
  host: env.db.host,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  port: env.db.port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // datas vem como Date object (não string) — facilita comparações
  dateStrings: false,
})

/**
 * Helper pra transactions. Garante commit/rollback + release mesmo
 * em caso de exceção. Uso:
 *
 *   await withTx(async (conn) => {
 *     await conn.query(...)
 *     await conn.query(...)
 *   })
 */
export async function withTx(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
