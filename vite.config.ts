import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readDevelopmentEnvironment } from './src/server/Env.js';

// All browser requests are same-origin. No environment secrets enter the client bundle.
export default defineConfig(({ command }) => {
  const env = readDevelopmentEnvironment(command === 'serve' ? process.env : {});
  const webUrl = new URL(env.WEB_ORIGIN);
  return {
    plugins: [react()],
    envDir: false,
    envPrefix: [],
    server: {
      host: webUrl.hostname,
      port: Number(webUrl.port),
      strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${env.API_PORT}` },
    },
    build: { outDir: 'dist/web' },
  };
});
