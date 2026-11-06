// PM2: one instance in fork mode, so the in-process jobs run exactly once.
module.exports = {
  apps: [
    {
      name: 'audify-api',
      cwd: '/opt/audify/backend',
      script: 'src/server.js',
      node_args: '--env-file=/etc/audify/backend.env',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '180M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
