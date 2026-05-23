// src/comms/discord.js
//
// Cliente Discord — envia alertas no canal de purchases. Login é
// disparado no boot do módulo (top-level). As funções publish aguardam
// uma promise interna que resolve quando o evento `ready` chega.
//
// Padrão lazy-singleton: import do módulo NÃO bloqueia, mas a primeira
// chamada de `notifyDiscord` (ou similar) espera até o bot estar pronto.
//
// Tipos de envio:
//   - alert(text): envia no canal de alertas (configurado em env).
//
// Outros padrões (botões interativos, comandos, etc) ficam pra quem
// precisar — não é o foco da purchases-api.
import {Client, GatewayIntentBits} from 'discord.js'
import {env} from '../config/env.js'
import {logger} from '../config/logger.js'

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
})

let readyResolve
const readyPromise = new Promise(resolve => {
  readyResolve = resolve
})

// `clientReady` é o novo nome do evento (discord.js v15+). O v14 ainda
// emite `ready` em paralelo, mas registrar o listener de `ready` dispara
// DeprecationWarning. Só `clientReady` é suficiente no v14.
client.once('clientReady', () => {
  logger.info({tag: client.user?.tag}, 'discord ready')
  readyResolve()
})

client.on('error', err => {
  logger.error({err}, 'discord client error')
})

// Login em background. Se DISCORD_TOKEN for inválido, loga e segue
// — o resto do app não para por causa disso.
client.login(env.discord.token).catch(err => {
  logger.error({err}, 'falha ao logar no discord (alerts vão pra void)')
})

/**
 * Envia mensagem de alerta no canal configurado em DISCORD_PURCHASE_CHANNEL_ID.
 * Erros são logados mas não propagam — comms não devem quebrar fluxo.
 *
 * @param {string} message
 */
export async function discordAlert(message) {
  try {
    // Timeout pra não pendurar pra sempre se o ready nunca vier
    const ready = await Promise.race([
      readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('discord ready timeout')), 10_000)),
    ])
    void ready

    const channel = client.channels.cache.get(env.discord.purchaseChannelId)
    if (!channel) {
      logger.warn({channelId: env.discord.purchaseChannelId}, 'canal Discord não encontrado')
      return
    }
    await channel.send(message)
  } catch (err) {
    logger.warn({err: err?.message}, 'falha ao mandar alerta Discord')
  }
}
