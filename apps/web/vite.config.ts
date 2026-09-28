import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.WEB_PORT ?? 5173);
  const apiPort = Number(env.PORT ?? 3001);
  if (![port, apiPort].every((value) => Number.isInteger(value) && value > 0 && value < 65536)) {
    throw new Error('PORT and WEB_PORT must be integers from 1 to 65535.');
  }
  const proxy = {
    '/api': {
      target: `http://127.0.0.1:${apiPort}`,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  };
  return {
    plugins: [react(), tailwindcss()],
    envDir,
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: '127.0.0.1', port, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port, strictPort: true, proxy },
  };
});
