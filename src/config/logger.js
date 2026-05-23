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

/**
 * Config base que vai pro logger standalone E pro Fastify. Sempre
 * pretty-printed (mesmo em produção) — fica legível direto no
 * `pm2 log` sem precisar pipe externo. Trade-off conhecido: perde
 * estrutura JSON pra ferramentas tipo Datadog/Loki, mas pra esse
 * serviço (sem stack de observabilidade externa) o ganho de
 * legibilidade compensa.
 *
 * `colorize: false` em produção porque pm2 escreve em arquivo (sem
 * TTY) — códigos ANSI viram lixo no arquivo. Em dev (com TTY) liga.
 */
const isDev = env.nodeEnv !== 'production'

export const loggerConfig = {
  level: env.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: isDev,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  },
  base: undefined,
}

export const logger = pino(loggerConfig)

/** Cria um child logger com contexto fixo (ex: rota, userId, sessão). */
export function childLogger(bindings) {
  return logger.child(bindings)
}
