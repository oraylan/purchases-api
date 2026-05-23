# Dívidas técnicas / pendências

## Antes de desativar a apiv2 (quando ela for ser desligada de vez)

### 1. Mover cron de reprocess de PIX pending

A apiv2 tem cron em `app.js`:
```js
cron.schedule('* * * * *', () => {
  reprocessPendingPurchases()
})
```

Que varre `user_plus.pending = 1` e re-valida via `purchases.products.get` do Google Play Developer API. Atualiza pra:
- `purchaseState=0` → `setPurchaseStatus(token, 0)` + `setUserPlusUnique` + ativa Plus
- `purchaseState=2` → mantém pending (re-roda no próximo ciclo)
- `purchaseState=1` ou outro → `setPurchaseStatus(token, 0)` + `expireUnique` + remove Plus

Como compartilhamos o MESMO banco, esse cron da apiv2 hoje cobre os PIX
gravados pela purchases-api (gravamos `pending=1` na user_plus, ele
reprocessa). Mas quando a apiv2 morrer, precisamos portar pra cá.

**Onde portar:** `src/jobs/reprocessPendingPurchases.js`