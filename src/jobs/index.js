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

const TIMEZONE = 'America/Sao_Paulo'

export function registerJobs() {
  // Reconciliação diária: 04:00 BRT (madrugada, menos carga)
  cron.schedule(
    '0 4 * * *',
    () => {
      runReconciliation().catch(err => {
        logger.error({err: err?.message}, 'runReconciliation falhou')
      })
    },
    {timezone: TIMEZONE},
  )
  logger.info({tz: TIMEZONE}, 'cron de reconciliação registrado (04:00 BRT diário)')
}
