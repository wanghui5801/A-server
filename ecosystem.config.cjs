module.exports = {
  apps: [
    {
      name: 'a-server-frontend',
      script: 'dist/server/entry.mjs',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4321'
      },
      watch: false,
      max_memory_restart: '1G',
      error_file: 'logs/frontend-error.log',
      out_file: 'logs/frontend-output.log'
    },
    {
      name: 'a-server-backend',
      script: 'tsx',
      args: 'server/index.ts',
      interpreter: 'node_modules/.bin/tsx',  // Use locally installed tsx
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      watch: false,
      max_memory_restart: '1G',
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-output.log'
    }
  ]
}; 