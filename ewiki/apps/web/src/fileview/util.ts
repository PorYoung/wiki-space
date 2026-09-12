// fileview 模块内部小工具（不进 @ewiki/shared：仅前端查看器消费）

import { basenameOf } from '@ewiki/shared';

/** 字节数人类可读（1024 进制，中文名） */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** path 末段完整文件名（含扩展名） */
export function fileBaseName(path: string): string {
  return basenameOf(path);
}

/** ISO 时间 → 本地展示（YYYY-MM-DD HH:mm） */
export function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * UTF-8 严格解码：非法字节序列抛错（§4.4 编码仅支持 UTF-8）。
 * FileMeta.content 已是 string 时由调用方跳过本函数。
 */
export function decodeUtf8Strict(bytes: Blob): Promise<string> {
  return bytes.arrayBuffer().then((buf) => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buf);
  });
}
