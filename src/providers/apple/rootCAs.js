// src/providers/apple/rootCAs.js
//
// Certificados raiz da Apple usados pra validar a cadeia de assinatura
// dos JWS (transações + notificações). A lib `@apple/app-store-server-library`
// recebe esses certs no construtor do SignedDataVerifier.
//
// Fonte oficial: https://www.apple.com/certificateauthority/
//
// Os 4 root CAs cobrem todas as variantes que aparecem em produção e
// sandbox. Baixados em runtime na 1ª chamada e cacheados em memória —
// pequenos (~1KB cada), sem custo perceptível.
//
// DÍVIDA TÉCNICA: idealmente esses certs deveriam estar versionados em
// `certs/` no repo pra não depender de network/disponibilidade da Apple
// no boot. Pra MVP fica em runtime. Quando subir pra prod, considerar
// download offline + commit.
import {logger} from '../../config/logger.js'

const APPLE_ROOT_CA_URLS = [
  'https://www.apple.com/appleca/AppleIncRootCertificate.cer',
  'https://www.apple.com/certificateauthority/AppleRootCA-G2.cer',
  'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer',
  'https://www.apple.com/certificateauthority/AppleComputerRootCertificate.cer',
]

let cachedRootCAs = null

export async function loadAppleRootCAs() {
  if (cachedRootCAs) return cachedRootCAs

  logger.info({count: APPLE_ROOT_CA_URLS.length}, 'baixando Apple root CAs')

  const buffers = await Promise.all(
    APPLE_ROOT_CA_URLS.map(async url => {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Falha baixando root CA Apple ${url}: HTTP ${res.status}`)
      }
      const arr = await res.arrayBuffer()
      return Buffer.from(arr)
    }),
  )

  cachedRootCAs = buffers
  logger.info('Apple root CAs carregados e cacheados')
  return buffers
}
