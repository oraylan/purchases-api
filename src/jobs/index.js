// src/jobs/index.js
//
// Registro central de jobs/crons. Chamado uma vez no boot (em
// src/index.js, após o app subir).
//
// Crons usam node-cron com expressão padrão (5 fields: min hora dia mês dia-semana).
// Timezone setado pra America/Sao_Paulo — todos os horários nesse arquivo
// são em BRT.
import cron from 'node-cron'
import {logger} from '../config/logger.js'
import {runReconciliation} from './reconcileSubscriptions.js'
import {reprocessPendingPurchases} from './reprocessPendingPurchases.js'

const TIMEZONE = 'America/Sao_Paulo'

export function registerJobs() {
  // Reconciliação diária: DESATIVADA temporariamente até validar em dry-run.
  // Rodar à mão com `yarn reconcile:dry` (não mexe em banco) — quando
  // tiver confiança, reativar o cron abaixo.
  //
  // cron.schedule(
  //   '0 4 * * *',
  //   () => {
  //     runReconciliation().catch(err => {
  //       logger.error({err: err?.message}, 'runReconciliation falhou')
  //     })
  //   },
  //   {timezone: TIMEZONE},
  // )
  logger.warn('cron de reconciliação DESATIVADO — usar `yarn reconcile:dry` à mão')

  // PIX pending reprocess: cada minuto. Re-valida compras one-time
  // Android que ficaram em pending=1 no banco. Portado da apiv2 em
  // 2026-05-23 (apiv2 não tem mais esse cron).
  cron.schedule(
    '* * * * *',
    () => {
      reprocessPendingPurchases().catch(err => {
        logger.error({err: err?.message}, 'reprocessPendingPurchases falhou')
      })
    },
    {timezone: TIMEZONE},
  )
  logger.info({tz: TIMEZONE}, 'cron de PIX pending registrado (1x/min)')
}
