import { z } from 'zod';

const EnvSchema = z.object({
  PORT_SERVER: z.coerce.number().default(3000),
  PORT_REALTIME: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  REFRESH_TTL_DAYS: z.coerce.number().default(7),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  FS_ROOT: z.string().default('./data'),
  FS_NAS_ROOT: z.string().default('./data-nas'),
  NAS_FALLBACK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_BUCKET: z.string().default('ewiki'),
  S3_ACCESS_KEY: z.string().default('ewiki'),
  S3_SECRET_KEY: z.string().default('ewiki-secret'),
  EWIKI_BASE_DOMAIN: z.string().default('ewiki.yfzx.cn'),
  SITE_ADDRESS_MODE: z.enum(['subdomain', 'subpath']).default('subdomain'),
  ENCRYPTION_KEY: z.string().min(16),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
