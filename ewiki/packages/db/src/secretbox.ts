import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM 凭据加密盒（SDD 6.3）：configEncrypted = iv.authTag.ciphertext（各段 base64）
// 仅供 Node 侧（server/worker）使用；web 不导入 @ewiki/db。

function keyFromEnv(): Buffer {
  return createHash('sha256').update(process.env.ENCRYPTION_KEY ?? 'ewiki-dev-key').digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnv(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptJson<T = Record<string, unknown>>(blob: string): T {
  const [ivB64, tagB64, dataB64] = blob.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('SECRETBOX_FORMAT');
  const decipher = createDecipheriv('aes-256-gcm', keyFromEnv(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
