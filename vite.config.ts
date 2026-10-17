import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readDevelopmentEnvironment } from './src/server/Env.js';

// All browser requests are same-origin. No environment secrets enter the client bundle.
const env = readDevelopmentEnvironment(process.env);
const webUrl = new URL(env.WEB_ORIGIN);
export default defineConfig({
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
});
