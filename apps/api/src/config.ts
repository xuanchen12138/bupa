import { z } from 'zod';

const ConfigSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Fail clearly rather than pretend a real model integration exists.
  DEMO_MODE: z.literal('true').default('true'),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error('Invalid config. PORT must be 1–65535; only DEMO_MODE=true is supported.');
  }
  return result.data;
}
