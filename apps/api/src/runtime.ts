import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readConfig } from './config.js';
export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export function loadConfig() {
  try {
    process.loadEnvFile(resolve(projectRoot, '.env'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return readConfig();
}
