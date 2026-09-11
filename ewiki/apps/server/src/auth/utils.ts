import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const ACCESS_TTL_SECONDS = 15 * 60;

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ---- 密码（scrypt，无原生依赖） ----
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
}

// ---- 访问令牌（HS256；EdDSA 升级见 SDD 8-9 待确认） ----
export async function signAccessToken(
  secret: string,
  payload: { sub: string; globalRole: string },
): Promise<string> {
  return await new SignJWT({ globalRole: payload.globalRole })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<{ sub: string; globalRole: string }> {
  const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
  return { sub: String(payload.sub), globalRole: String(payload['globalRole'] ?? 'user') };
}

// ---- 刷新令牌（明文一次性返回，SHA-256 落库，SDD 4.1） ----
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
