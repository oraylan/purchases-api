// pm2 ecosystem — gerencia o processo da purchases-api.
//
// Como o package.json é ES modules ("type": "module"), o pm2 prefere o
// arquivo de config em .cjs (CommonJS) — pm2 carrega esse arquivo via
// require() interno, e ES modules quebram esse fluxo.
module.exports = {
  apps: [
    {
      name: 'papi',
      namespace: 'papi',
      script: './src/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
