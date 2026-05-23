// src/index.js
//
// Entry point. Bootstrap em ordem:
//   1) Importa env.js (valida vars e mata o processo se falhar).
//   2) Cria app Fastify.
//   3) Sobe servidor HTTP.
//   4) Registra crons (TODO Fase 5).
//
// SIGTERM/SIGINT — pm2 manda esses sinais pra graceful restart. A gente
// fecha o app pra drenar requests pendentes antes de sair.
import {env} from './config/env.js'
import {logger} from './config/logger.js'
import {createApp} from './app.js'

const app = await createApp()

try {
  await app.listen({port: env.port, host: '0.0.0.0'})
  logger.info(
    {port: env.port, env: env.nodeEnv, appleEnv: env.apple.env},
    'purchases-api online',
  )
} catch (err) {
  logger.fatal({err}, 'falha ao subir servidor')
  process.exit(1)
}

async function shutdown(signal) {
  logger.info({signal}, 'shutdown iniciado')
  try {
    await app.close()
    logger.info('app fechado, saindo')
    process.exit(0)
  } catch (err) {
    logger.error({err}, 'erro ao fechar app')
    process.exit(1)
  }
}

// safety net — força saída em 10s se algo prendeu
function forceExitTimer() {
  setTimeout(() => {
    logger.warn('shutdown forçado após timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => {
  forceExitTimer()
  shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  forceExitTimer()
  shutdown('SIGINT')
})

process.on('uncaughtException', err => {
  logger.fatal({err}, 'uncaughtException')
  process.exit(1)
})
process.on('unhandledRejection', reason => {
  logger.fatal({err: reason}, 'unhandledRejection')
  process.exit(1)
})
