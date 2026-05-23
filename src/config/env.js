// src/config/env.js
//
// Carrega o .env e valida que todas as vars obrigatórias estão presentes
// no boot. Princípio: fail-fast — se faltar credencial crítica, o processo
// morre imediatamente com uma mensagem clara, em vez de quebrar mais tarde
// numa rota qualquer.
//
// Exporta um objeto `env` congelado pra ser importado em qualquer módulo.
import 'dotenv/config'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

const REQUIRED = [
  'PORT',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'PG_HOST',
  'PG_PORT',
  'PG_USER',
  'PG_PASSWORD',
  'PG_DATABASE',
  'APPLE_ISSUER_ID',
  'APPLE_KEY_ID',
  'APPLE_KEY_PATH',
  'APPLE_BUNDLE_ID',
  'APPLE_APP_ID',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_PACKAGE_NAME',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_MONTHLY',
  'STRIPE_PRICE_SEMESTRAL',
  'STRIPE_PRICE_ANNUAL',
  'DISCORD_TOKEN',
  'DISCORD_PURCHASE_CHANNEL_ID',
  'PUSH_URL',
  'PUSH_AUTH',
  'EMAIL_URL',
  'EMAIL_AUTH',
  'ADMIN_TOKEN',
]

const missing = REQUIRED.filter(k => !process.env[k] || process.env[k].trim() === '')

if (missing.length > 0) {
  console.error('[env] Variáveis de ambiente faltando:')
  missing.forEach(k => console.error(`  - ${k}`))
  console.error('Verifique o .env (use .env.example como base).')
  process.exit(1)
}

// Resolve caminhos relativos pra absolutos (lib do Apple e do Google
// esperam path absoluto pra ler os arquivos de credencial).
function resolveSecretPath(value) {
  return path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value)
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'production',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: Number(process.env.PORT),

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },

  pg: {
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
  },

  apple: {
    issuerId: process.env.APPLE_ISSUER_ID,
    keyId: process.env.APPLE_KEY_ID,
    keyPath: resolveSecretPath(process.env.APPLE_KEY_PATH),
    bundleId: process.env.APPLE_BUNDLE_ID,
    appId: process.env.APPLE_APP_ID,
    env: (process.env.APPLE_ENV || 'production').toLowerCase(),
  },

  google: {
    credentialsPath: resolveSecretPath(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    packageName: process.env.GOOGLE_PACKAGE_NAME,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      monthly: process.env.STRIPE_PRICE_MONTHLY,
      semestral: process.env.STRIPE_PRICE_SEMESTRAL,
      annual: process.env.STRIPE_PRICE_ANNUAL,
    },
  },

  discord: {
    token: process.env.DISCORD_TOKEN,
    purchaseChannelId: process.env.DISCORD_PURCHASE_CHANNEL_ID,
  },

  push: {
    url: process.env.PUSH_URL,
    auth: process.env.PUSH_AUTH,
  },

  email: {
    url: process.env.EMAIL_URL,
    auth: process.env.EMAIL_AUTH,
  },

  adminToken: process.env.ADMIN_TOKEN,

  // PIX_TEST_MODE=true encurta expiração de PIX pra minutos (3/5/10
  // em vez de 1/6/12 meses). NUNCA usar em prod. Default: false.
  pixTestMode: (process.env.PIX_TEST_MODE || '').toLowerCase() === 'true',

  paths: {
    root: PROJECT_ROOT,
  },
})
