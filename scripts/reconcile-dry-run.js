// scripts/reconcile-dry-run.js
//
// Roda o cron de reconciliação em modo DRY-RUN — consulta Apple/Stripe
// normalmente, lista quem seria desligado, MAS não mexe no banco e não
// dispara alertas Discord por usuário (só o sumário final, prefixado).
//
// Uso: `yarn reconcile:dry` (ou `node scripts/reconcile-dry-run.js`)
//
// Pra executar PRA VALER (com efeito): `yarn reconcile:run` — só fazer
// depois de validar o dry-run várias vezes e ter confiança.
import {runReconciliation} from '../src/jobs/reconcileSubscriptions.js'
import {logger} from '../src/config/logger.js'
import {pool} from '../src/db/mysql.js'

const dryRun = !process.argv.includes('--for-real')

if (dryRun) {
  console.log('═══════════════════════════════════════════════════')
  console.log('  RECONCILIAÇÃO EM MODO DRY-RUN')
  console.log('  Nada será desativado. Pra rodar pra valer:')
  console.log('  yarn reconcile:run  (ou --for-real)')
  console.log('═══════════════════════════════════════════════════')
} else {
  console.log('═══════════════════════════════════════════════════')
  console.log('  RECONCILIAÇÃO PRA VALER — VAI DESATIVAR PLUS')
  console.log('═══════════════════════════════════════════════════')
}

try {
  const stats = await runReconciliation({dryRun})
  logger.info(stats, '[script] reconciliação finalizada')
  process.exitCode = 0
} catch (err) {
  logger.error({err: err.message}, '[script] reconciliação falhou')
  process.exitCode = 1
} finally {
  // Fecha conexões pra processo terminar limpinho
  await pool.end().catch(() => {})
  // Dá tempo do discord client desconectar (se foi inicializado)
  setTimeout(() => process.exit(process.exitCode), 2000).unref()
}
