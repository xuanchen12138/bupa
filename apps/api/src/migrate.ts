import { resolve } from 'node:path';
import { Repository } from './repository.js';
import { loadConfig, projectRoot } from './runtime.js';
const config = loadConfig();
try {
  const repository = new Repository(resolve(projectRoot, config.DATABASE_PATH));
  console.info(
    'SQLite schema version:',
    repository.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,
  );
  repository.close();
} catch (error) {
  if (error instanceof Error && 'errcode' in error && error.errcode === 5) {
    console.error(
      'Database is in use. Stop the API process before running db:migrate. Normal startup also migrates automatically.',
    );
    process.exitCode = 1;
  } else throw error;
}
