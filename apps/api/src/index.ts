import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig, projectRoot } from './runtime.js';
import { Repository } from './repository.js';
import { OpenAIModel } from './models.js';

const config = loadConfig();
const repo = new Repository(resolve(projectRoot, config.DATABASE_PATH));
const model =
  config.MODEL_MODE === 'openai'
    ? new OpenAIModel(config.OPENAI_API_KEY!, config.OPENAI_MODEL, config.MODEL_TIMEOUT_MS)
    : null;
const app = createApp(undefined, {
  repository: repo,
  model,
  seedHistory: config.HISTORY_SEED,
  maxInputChars: config.MODEL_MAX_INPUT_CHARS,
});
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, () => {
  console.info(
    'My Bupa Agent API: http://' +
      config.HOST +
      ':' +
      config.PORT +
      ' (fictional business; model=' +
      config.MODEL_MODE +
      '; SQLite)',
  );
});
server.on('error', (error) => {
  console.error(error.message);
  void app.shutdown().finally(() => {
    process.exitCode = 1;
  });
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close();
    void app.shutdown().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
