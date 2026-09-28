import { z } from 'zod';
const ConfigSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DEMO_MODE: z.literal('true').default('true'),
  MODEL_MODE: z.enum(['scripted', 'openai']).default('scripted'),
  OPENAI_API_KEY: z.string().trim().optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  MODEL_MAX_INPUT_CHARS: z.coerce.number().int().min(4000).max(200000).default(60000),
  DATABASE_PATH: z.string().min(1).default('.data/bupa.sqlite'),
  HISTORY_SEED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) throw new Error('Invalid backend configuration. Check .env.example.');
  if (result.data.MODEL_MODE === 'openai' && !result.data.OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY is required when MODEL_MODE=openai.');
  return result.data;
}
