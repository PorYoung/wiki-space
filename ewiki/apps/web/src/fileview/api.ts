// ---------------------------------------------------------------------------
// fileview 自带的 raw 读取/下载工具（设计 §5.4、§6.3）：
//   - 优先使用详情接口下发的 rawUrl（短期 HMAC 签名地址，img/iframe 可直接用）
//   - 无签名地址时带 Authorization: Bearer 请求 /api/v1/documents/:id/raw
// token 读取口径与 src/lib/api/client.ts 保持一致（localStorage['ewiki-token']）。
// 本文件不改 client.ts；查看器需要的 blob/objectURL 能力都在模块内闭环。
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { FileMeta } from './types';
import { fileBaseName } from './util';

const TOKEN_KEY = 'ewiki-token';
const RAW_BASE = '/api/v1/documents';

/**
 * 带鉴权拉取文件原始内容为 Blob（签名地址免 Authorization）。
 * versionNo 显式传入时请求历史版本（契约：GET /api/v1/documents/:id/raw?versionNo=N）；
 * 历史版本无签名地址，签名地址只代表当前版本，故带 versionNo 时强制走 Bearer 分支。
 */
export async function fetchRawBlob(file: FileMeta, versionNo?: number): Promise<Blob> {
  if (file.rawUrl && versionNo === undefined) {
    const res = await fetch(file.rawUrl);
    if (!res.ok) throw new Error(`读取文件失败：HTTP ${res.status}`);
    return res.blob();
  }
  const headers = new Headers();
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const qs = versionNo !== undefined ? `?versionNo=${encodeURIComponent(versionNo)}` : '';
  const res = await fetch(`${RAW_BASE}/${encodeURIComponent(file.id)}/raw${qs}`, { headers });
  if (!res.ok) throw new Error(`读取文件失败：HTTP ${res.status}`);
  return res.blob();
}

/**
 * 触发浏览器「另存为」：fetch 取 blob 后用 a[download] 指定真实 basename，
 * 中文名可用（签名地址直接导航在部分浏览器上会丢 Content-Disposition 文件名）。
 */
export async function downloadFile(file: FileMeta, versionNo?: number): Promise<void> {
  const blob = await fetchRawBlob(file, versionNo);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileBaseName(file.path);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 给下载启动留一个 tick 再回收
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export interface ObjectUrlState {
  url: string | null;
  error: string | null;
  loading: boolean;
}

/**
 * 轻量鉴权图片 hook（预览相对路径/缩略图批量场景）：按文档 id 拉 /raw → objectURL，
 * id 切换或卸载时 revoke。优先用详情下发的短期签名 rawUrl（浏览器直接请求，省 blob 拷贝）。
 */
export function useAuthImageUrl(id: string, rawUrl?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(rawUrl ?? null);

  useEffect(() => {
    if (rawUrl) {
      setUrl(rawUrl);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    fetchRawBlob({ id } as FileMeta)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, rawUrl]);

  return url;
}

/**
 * 拉取 blob 并生成 ObjectURL；file 切换/卸载时自动 revoke。
 * 优先直接使用签名 rawUrl（浏览器自行请求，省一次 JS 侧 blob 拷贝），
 * 但 <img> 场景为统一起见仍走 fetch→objectURL，使无 rawUrl 的环境同样可用。
 */
export function useObjectUrl(file: FileMeta): ObjectUrlState {
  const [state, setState] = useState<ObjectUrlState>({ url: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, error: null, loading: true });

    fetchRawBlob(file)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          url: null,
          error: err instanceof Error ? err.message : '文件加载失败',
          loading: false,
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.rawUrl, file.storageRef, file.versionNo]);

  return state;
}
