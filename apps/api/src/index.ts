import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { readConfig } from './config.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

const config = readConfig();
const app = createApp();
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, () => {
  console.info(`My Bupa Agent API: http://${config.HOST}:${config.PORT} (demo backend)`);
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
