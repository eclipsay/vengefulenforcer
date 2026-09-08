const path = require('node:path');

module.exports = {
  apps: [{
    name: 'vengeful-enforcer',
    cwd: __dirname,
    script: path.join(__dirname, 'dist', 'index.js'),
    interpreter: process.env.VE_NODE_BINARY || 'node',
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 30000,
    time: true,
    env: { NODE_ENV: 'production' },
  }],
};
