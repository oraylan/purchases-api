// src/config/logger.js
//
// Logger pino — estruturado JSON em produção, pretty-printed em dev.
// O Fastify usa o mesmo logger via `app.log` (a config é passada na
// criação do app). Esse módulo exporta uma instância "standalone" pra
// usar em código fora de rota: jobs, providers, comms, etc.
//
// Em prod, pm2 captura stdout e arquiva em ~/.pm2/logs/. Pra grep
// erros: `pm2 logs purchases-api | grep '"level":50'`.
import pino from 'pino'
import {env} from './env.js'

const isDev = env.nodeEnv !== 'production'

/**
 * Config base que vai pro logger standalone E pro Fastify. Manter um
 * único formato facilita correlacionar logs entre rotas e jobs.
 */
export const loggerConfig = {
  level: env.logLevel,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
  base: undefined,
}

export const logger = pino(loggerConfig)

/** Cria um child logger com contexto fixo (ex: rota, userId, sessão). */
export function childLogger(bindings) {
  return logger.child(bindings)
}
