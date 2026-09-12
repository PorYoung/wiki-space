// ---------------------------------------------------------------------------
// 文件上传 API 封装（docs/file-management-redesign §4.3 / §5.2 / §6.3）：
//   createUploadSession —— 上传前批量预检（大小 / 路径合法性 / 同名冲突）
//   uploadFileXhr       —— XMLHttpRequest multipart 单文件上传（progress 进度）
// 注意：服务端 Hono 错误信封为 { code:'HTTP_ERROR', message:'语义码: 文案' }，
//       真正的语义码（DOCUMENT_EXISTS / FILE_TOO_LARGE 等）在 message 前缀里。
// ---------------------------------------------------------------------------

import { apiFetch, EwikiApiError, tokenStore } from '../lib/api/client';

export type UploadDecision = 'accept' | 'conflict' | 'reject';

export type UploadPolicy = 'error' | 'replace' | 'rename';

export interface UploadSessionItem {
  path: string;
  size: number;
  mime: string | null;
  decision: UploadDecision;
  reason: string;
}

export interface UploadSessionResponse {
  uploadMaxBytes: number;
  items: UploadSessionItem[];
}

export interface UploadCandidate {
  path: string;
  size: number;
  mime?: string | null;
}

export interface UploadResult {
  document: unknown;
  version: number;
  replaced: boolean;
  path: string;
  requestedPath: string;
  idempotencyKey: string | null;
  rawUrl: string | null;
}

/** 单次预检服务端上限 100 项 */
const SESSION_CHUNK = 100;

/**
 * 上传预检：超过 100 项时分批请求并按顺序合并结果，
 * 返回项与入参 files 顺序一一对应（服务端逐项原样回传 path）。
 */
export async function createUploadSession(
  projectId: string,
  files: UploadCandidate[],
): Promise<UploadSessionResponse> {
  let uploadMaxBytes = 0;
  const items: UploadSessionItem[] = [];
  for (let i = 0; i < files.length; i += SESSION_CHUNK) {
    const chunk = files.slice(i, i + SESSION_CHUNK);
    const resp = await apiFetch<UploadSessionResponse>(
      `/api/v1/projects/${projectId}/files/upload-session`,
      {
        method: 'POST',
        body: JSON.stringify({
          files: chunk.map((f) => ({ path: f.path, size: f.size, mime: f.mime ?? null })),
        }),
      },
    );
    uploadMaxBytes = resp.uploadMaxBytes;
    items.push(...resp.items);
  }
  return { uploadMaxBytes, items };
}

/**
 * XHR 单文件上传：
 *   - 必须用 XHR（不能 fetch）以获得 upload.onprogress 进度事件
 *   - 不手动设 Content-Type，由浏览器自动补 multipart boundary
 *   - Authorization 直接取 localStorage 令牌（XHR 不走 apiFetch 的 401 刷新重放）
 *   - 非 2xx 解析 { code, message } 抛 EwikiApiError（语义码在 message）
 */
export function uploadFileXhr(
  projectId: string,
  path: string,
  file: File,
  policy: UploadPolicy,
  idemKey: string,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/projects/${projectId}/files/upload`);
    const token = tokenStore.access;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (ev: ProgressEvent) => {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText || '{}') as UploadResult);
        return;
      }
      type ErrorBody = { code?: string; message?: string; details?: unknown; requestId?: string };
      let body: ErrorBody | null = null;
      try {
        body = JSON.parse(xhr.responseText) as ErrorBody;
      } catch {
        body = null;
      }
      reject(
        new EwikiApiError(
          body?.code ?? 'HTTP_ERROR',
          body?.message ?? `HTTP ${xhr.status}`,
          xhr.status,
          body?.details,
          body?.requestId,
        ),
      );
    };
    xhr.onerror = () => {
      reject(new EwikiApiError('NETWORK_ERROR', '网络错误，上传失败', 0));
    };
    xhr.ontimeout = () => {
      reject(new EwikiApiError('NETWORK_TIMEOUT', '上传超时，请重试', 0));
    };

    const form = new FormData();
    form.append('path', path);
    form.append('file', file);
    form.append('policy', policy);
    form.append('idempotencyKey', idemKey);
    xhr.send(form);
  });
}

/** 从上传错误中提取可展示文案：服务端语义码形如 'DOCUMENT_EXISTS' 或 'CODE: 中文说明' */
export function explainUploadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const colon = raw.indexOf(':');
  if (colon >= 0) {
    const detail = raw.slice(colon + 1).trim();
    if (detail) return detail;
  }
  switch (raw) {
    case 'DOCUMENT_EXISTS':
      return '同名文档已存在';
    case 'PATH_OCCUPIED_SOFT_DELETED':
      return '该路径被软删文档占用，请改用自动共存';
    case 'FILE_TOO_LARGE':
      return '文件超过上传上限';
    case 'FORBIDDEN':
      return '没有该项目的编辑权限';
    case 'NETWORK_ERROR':
      return '网络错误，上传失败';
    case 'NETWORK_TIMEOUT':
      return '上传超时，请重试';
    default:
      return raw || '上传失败';
  }
}
