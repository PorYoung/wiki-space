// ---------------------------------------------------------------------------
// raw 读取短期签名（HMAC-SHA256）：绑定 documentId + userId + exp
// 用于 GET /api/v1/documents/:id/raw 在无 Authorization 头时的 query 鉴权
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedRawToken {
  token: string;
  exp: number;
}

function payload(documentId: string, userId: string, exp: number): string {
  return `${documentId}.${userId}.${exp}`;
}

function hmac(secret: string, message: string): Buffer {
  return createHmac('sha256', secret).update(message, 'utf8').digest();
}

export function signRawToken(
  secret: string,
  documentId: string,
  userId: string,
  ttlSeconds: number,
): SignedRawToken {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = hmac(secret, payload(documentId, userId, exp)).toString('hex');
  return { token, exp };
}

/** 校验失败抛 Error('RAW_TOKEN_INVALID' | 'RAW_TOKEN_EXPIRED') */
export function verifyRawToken(
  secret: string,
  token: string,
  claim: { documentId: string; userId: string; exp: number },
): void {
  const expected = hmac(secret, payload(claim.documentId, claim.userId, claim.exp));
  let given: Buffer;
  try {
    given = Buffer.from(token, 'hex');
  } catch {
    throw new Error('RAW_TOKEN_INVALID');
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('RAW_TOKEN_INVALID');
  }
  if (claim.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('RAW_TOKEN_EXPIRED');
  }
}

export function buildRawUrl(
  secret: string,
  basePath: string,
  doc: { id: string },
  userId: string,
  ttlSeconds: number,
): string {
  const { token, exp } = signRawToken(secret, doc.id, userId, ttlSeconds);
  return `${basePath}/documents/${doc.id}/raw?exp=${exp}&u=${encodeURIComponent(userId)}&token=${token}`;
}
