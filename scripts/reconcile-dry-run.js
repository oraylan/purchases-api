// scripts/reconcile-dry-run.js
//
// Roda a auditoria anti-zumbi à mão. NÃO toma ação — só lista
// candidatos a zumbi no Discord e nos logs pra o operador conferir e
// decidir caso-a-caso.
//
// Uso: `yarn reconcile:dry` (ou `node scripts/reconcile-dry-run.js`)
//
// Mesmo comportamento do cron automático das 04:00 BRT — chama
// runReconciliation() que é puramente leitura + relatório.
import {runReconciliation} from '../src/jobs/reconcileSubscriptions.js'
import {logger} from '../src/config/logger.js'
import {pool} from '../src/db/mysql.js'

console.log('═══════════════════════════════════════════════════')
console.log('  AUDITORIA ANTI-ZUMBI')
console.log('  Nada será desativado — só gera relatório.')
console.log('═══════════════════════════════════════════════════')

try {
  const {stats} = await runReconciliation()
  logger.info(stats, '[script] auditoria finalizada')
  process.exitCode = 0
} catch (err) {
  logger.error({err: err.message}, '[script] auditoria falhou')
  process.exitCode = 1
} finally {
  // Fecha conexões pra processo terminar limpinho
  await pool.end().catch(() => {})
  // Dá tempo do discord client desconectar (se foi inicializado)
  setTimeout(() => process.exit(process.exitCode), 2000).unref()
}
