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
  UPLOAD_MAX_BYTES: z.coerce.number().default(104857600),
  BLOB_DRIVER: z.enum(['local']).default('local'),
  BLOB_LOCAL_ROOT: z.string().optional(),
  RAW_URL_TTL_SECONDS: z.coerce.number().default(1800),
  EWIKI_BASE_DOMAIN: z.string().default('ewiki.yfzx.cn'),
  SITE_ADDRESS_MODE: z.enum(['subdomain', 'subpath']).default('subdomain'),
  ENCRYPTION_KEY: z.string().min(16),
  // ---- 检索（SEARCH-VECTOR-DESIGN §9.1）----
  SEARCH_FTS_CONFIG: z.enum(['chinese_zh', 'simple']).default('chinese_zh'),
  SEARCH_SEMANTIC_MIN_SCORE: z.coerce.number().min(0).max(0.95).default(0.3),
  SEARCH_INDEX_DEBOUNCE_SECONDS: z.coerce.number().min(0).max(600).default(30),
  EMBEDDING_PROVIDER: z.enum(['none', 'openai-compatible']).default('none'),
  EMBEDDING_BASE_URL: z.string().default(''),
  EMBEDDING_API_KEY: z.string().default(''),
  EMBEDDING_MODEL: z.string().default('bge-m3'),
  EMBEDDING_DIM: z.coerce.number().int().min(1).default(1024),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).default(32),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().default(10000),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
