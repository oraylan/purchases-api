// src/providers/google/client.js
//
// Cliente Google Play Developer API (androidpublisher v3). Usa o JSON
// de service account configurado em GOOGLE_APPLICATION_CREDENTIALS pra
// autenticar via Google Auth Library.
//
// Escopo usado: androidpublisher (suficiente pra read de subs e produtos).
//
// O cliente é singleton — sem custo em manter aberto, e a lib do Google
// gerencia o token JWT internamente.
import {google} from 'googleapis'
import {env} from '../../config/env.js'

const auth = new google.auth.GoogleAuth({
  keyFile: env.google.credentialsPath,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
})

export const playDeveloperApi = google.androidpublisher({
  version: 'v3',
  auth,
})

export const packageName = env.google.packageName
