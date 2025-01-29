// @ts-check
import { defineConfig } from 'astro/config';
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'server',
  server: {
    host: true,
    port: 4321
  },
  vite: {
    server: {
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Request',
        'Access-Control-Allow-Credentials': 'true'
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, '/api')
        }
      }
    },
    optimizeDeps: {
      include: ['xterm', 'xterm-addon-fit', 'xterm-addon-web-links'],
      esbuildOptions: {
        define: {
          global: 'globalThis'
        }
      }
    },
    resolve: {
      alias: {
        './lib/xterm': './lib/xterm.js',
      }
    },
    build: {
      commonjsOptions: {
        transformMixedEsModules: true
      }
    }
  }
});
