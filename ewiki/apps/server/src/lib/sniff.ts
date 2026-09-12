// ---------------------------------------------------------------------------
// 二进制文件头魔数探测：声明 MIME 不可信，与魔数冲突时以魔数为准；未知返回 null
// 覆盖：png / jpeg / gif / webp(RIFF....WEBP) / pdf
// ---------------------------------------------------------------------------

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function asciiAt(buf: Buffer, s: string, offset: number): boolean {
  if (buf.length < offset + s.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (buf[offset + i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

/** 返回规范 MIME；无法识别返回 null */
export function sniffMime(buf: Buffer): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (asciiAt(buf, 'GIF87a', 0) || asciiAt(buf, 'GIF89a', 0)) {
    return 'image/gif';
  }
  // RIFF????WEBP
  if (asciiAt(buf, 'RIFF', 0) && asciiAt(buf, 'WEBP', 8)) {
    return 'image/webp';
  }
  if (asciiAt(buf, '%PDF-', 0)) {
    return 'application/pdf';
  }
  return null;
}

/** 探测优先：魔数命中则覆盖声明 MIME；未命中保留声明（调用方决定是否 fallback） */
export function effectiveMime(buf: Buffer, declared: string | null | undefined): string | null {
  return sniffMime(buf) ?? (declared || null);
}
