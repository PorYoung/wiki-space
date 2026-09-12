// ---------------------------------------------------------------------------
// §4.1-F16 Markdown 引用图片 —— 插入图片弹层：
//   Tab 1「库内选择」—— 拉项目内 binary 图片/PDF，生成相对路径 Markdown 语法
//   Tab 2「本地上传」  —— 单文件上传到当前 Markdown 同级 assets/ 目录，生成语法
// 调用方：MarkdownViewer.tsx。
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileImage,
  FileText,
  FileUp,
  ImageIcon,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api/client';
import { uploadFileXhr, explainUploadError, type UploadResult } from '../../tree/upload-api';
import { useShowToast } from '../../components/Toast';
import { humanSize, fileBaseName } from '../util';

/** 弹层对外契约 */
export interface ImagePickerModalProps {
  open: boolean;
  /** 项目 ID（优先 prop；否则从 pathname 兜底） */
  projectId?: string;
  /** 当前 Markdown 文档 path（用来算相对引用 / 上传目录） */
  currentDocPath: string;
  /** 选定 Markdown 语法字符串后回调（由宿主负责插入 MDEditor 光标） */
  onPick: (markdown: string) => void;
  onClose: () => void;
}

/** 后端 binary 列表项最小子集（与 FileMeta 对齐） */
interface BinaryDocItem {
  id: string;
  path: string;
  title: string;
  kind: 'binary';
  ext: string;
  mime: string;
  size: number;
  rawUrl?: string | null;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const DOC_EXTS = new Set(['pdf']);
const ALLOWED_EXTS = new Set([...IMAGE_EXTS, ...DOC_EXTS]);

/** 从 pathname 兜底解析 /projects/:id/... 里的 projectId */
function parseProjectIdFromPathname(): string | null {
  const m = window.location.pathname.match(/\/projects\/([^/]+)/);
  return m?.[1] ?? null;
}

/** 取 Markdown 文档父目录（含尾斜杠，用于拼 assets/filename） */
function parentDirOf(docPath: string): string {
  const idx = docPath.lastIndexOf('/');
  return idx >= 0 ? docPath.slice(0, idx + 1) : '';
}

/** 对 FileMeta.path 做"相对于当前 Markdown 文档"的路径解析：
 *  - 同目录 → 直接用文件名
 *  - 子目录 → 子目录/filename
 *  - 父目录或其他 → 完整相对路径（posix 形式）
 *  这里简化：库内选择直接返回原始 path（库内路径天然以项目根为基准），
 *  渲染时 Markdown 渲染器会按同目录解析。
 */
function markdownImageSyntax(displayName: string, relativePath: string, isPdf: boolean): string {
  // §4.1-F16：PDF 也允许嵌入语法（浏览器能 inline render）
  return `![${displayName}](${relativePath})`;
}

/** Lucide 图标选择：图片 vs PDF vs 其他 */
function KindIcon({ ext }: { ext: string }): React.ReactElement {
  if (IMAGE_EXTS.has(ext)) return <ImageIcon size={20} />;
  if (ext === 'pdf') return <FileText size={20} />;
  return <FileImage size={20} />;
}

type Tab = 'library' | 'upload';

export function ImagePickerModal({
  open,
  projectId: propProjectId,
  currentDocPath,
  onPick,
  onClose,
}: ImagePickerModalProps): React.ReactElement | null {
  const showToast = useShowToast();
  const [tab, setTab] = useState<Tab>('library');
  const [libraryItems, setLibraryItems] = useState<BinaryDocItem[]>([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [libError, setLibError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // §4.1-F16 兜底 projectId：prop 优先，否则从路由取
  const projectId = propProjectId ?? parseProjectIdFromPathname();

  // 目标上传目录：当前 Markdown 的父目录 + assets/
  const uploadTargetDir = useMemo(() => {
    const parent = parentDirOf(currentDocPath);
    return `${parent}assets`.replace(/^\//, ''); // 去掉前导 /，保持库内路径风格
  }, [currentDocPath]);

  // ---- Tab 1：拉库内 binary ----
  useEffect(() => {
    if (!open || tab !== 'library') return;
    if (!projectId) {
      setLibError('无法定位项目，请从项目内页面打开');
      setLibraryItems([]);
      return;
    }
    let cancelled = false;
    setLoadingLib(true);
    setLibError(null);
    void (async () => {
      try {
        // §4.1-F16：GET /api/v1/projects/:id/documents?kind=binary
        // 后端 routes.ts L1044-1058 支持 kind facet 过滤；返回 items[] 带 path/ext/mime/size/rawUrl
        const resp = await apiFetch<{ items: BinaryDocItem[]; total?: number }>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/documents?kind=binary&pageSize=500`,
        );
        if (cancelled) return;
        const filtered = (resp.items ?? []).filter((it) => ALLOWED_EXTS.has(it.ext.toLowerCase()));
        // 按 path 字母序
        filtered.sort((a, b) => a.path.localeCompare(b.path));
        setLibraryItems(filtered);
      } catch (err) {
        if (cancelled) return;
        setLibError(err instanceof Error ? err.message : '加载失败');
        setLibraryItems([]);
      } finally {
        if (!cancelled) setLoadingLib(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, projectId]);

  // ---- Tab 1：选中库内文件 ----
  const handlePickLibrary = (item: BinaryDocItem): void => {
    const displayName = fileBaseName(item.path);
    // 库内 path 直接用：MarkdownViewer Markdown 渲染器按库内相对路径解析
    const relPath = item.path;
    const md = markdownImageSyntax(displayName, relPath, item.ext.toLowerCase() === 'pdf');
    onPick(md);
  };

  // ---- Tab 2：选择本地文件并上传 ----
  const handleLocalFile = async (file: File | null): Promise<void> => {
    if (!file) return;
    if (!projectId) {
      showToast('无法定位项目，请从项目内页面打开');
      return;
    }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      showToast(`不支持的文件类型：${ext || '(无扩展名)'}`);
      return;
    }
    setUploading(true);
    try {
      // §4.1-F16：上传到父目录/assets/filename.ext，避免同名冲突用 replace 策略
      const uploadPath = `${uploadTargetDir}/${file.name}`.replace(/\/+/g, '/');
      const idemKey = crypto.randomUUID();
      const res: UploadResult = await uploadFileXhr(
        projectId,
        uploadPath,
        file,
        'replace',
        idemKey,
      );
      // 上传后真实 path（若 rename 策略可能被改名；replace 策略则与请求一致）
      const finalPath = res.path;
      const displayName = fileBaseName(finalPath);
      // 相对引用：从当前 Markdown 文档出发，去掉当前 Markdown 父目录前缀得到相对路径
      const parent = parentDirOf(currentDocPath);
      let relPath = finalPath;
      if (parent && finalPath.startsWith(parent)) {
        relPath = finalPath.slice(parent.length);
      } else if (!parent) {
        relPath = finalPath; // Markdown 在根目录：直接用 assets/xxx.ext
      }
      const md = markdownImageSyntax(displayName, relPath, ext === 'pdf');
      showToast('上传成功');
      onPick(md);
    } catch (err) {
      showToast(`上传失败：${explainUploadError(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card flex max-h-[80vh] w-full max-w-3xl flex-col p-5 shadow-xl animate-fade-up"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon size={16} className="text-primary-500" />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              插入图片 / 文件
            </h3>
          </div>
          <button
            type="button"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-3 inline-flex rounded-md border p-0.5" style={{ borderColor: 'var(--border-soft)' }}>
          {(
            [
              { key: 'library', label: '库内选择', Icon: FileImage },
              { key: 'upload', label: '本地上传', Icon: FileUp },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as Tab)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition ${
                tab === key
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {tab === 'library' && (
            <div>
              {loadingLib && (
                <div className="flex items-center gap-2 py-10 text-center text-xs text-neutral-500">
                  <Loader2 size={14} className="animate-spin" />
                  加载中…
                </div>
              )}
              {!loadingLib && libError && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  {libError}
                </div>
              )}
              {!loadingLib && !libError && libraryItems.length === 0 && (
                <div className="py-10 text-center text-xs text-neutral-400">
                  项目内暂无图片或 PDF 文件
                </div>
              )}
              {!loadingLib && !libError && libraryItems.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {libraryItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handlePickLibrary(item)}
                      title={`${item.path} · ${humanSize(item.size)}`}
                      className="group flex flex-col items-center gap-1.5 rounded-md border p-2 text-center transition hover:border-primary-400 hover:bg-primary-50"
                      style={{ borderColor: 'var(--border-soft)' }}
                    >
                      {/* 缩略图：图片用 rawUrl 预览，PDF/其他用图标 */}
                      {IMAGE_EXTS.has(item.ext.toLowerCase()) && item.rawUrl ? (
                        <div className="h-16 w-full overflow-hidden rounded bg-neutral-100">
                          <img
                            src={item.rawUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="flex h-16 w-full items-center justify-center rounded bg-neutral-100 text-neutral-400">
                          <KindIcon ext={item.ext.toLowerCase()} />
                        </div>
                      )}
                      <span
                        className="w-full truncate text-[11px] font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {fileBaseName(item.path)}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {humanSize(item.size)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'upload' && (
            <div>
              {/* 上传路径提示 */}
              <p className="mb-3 text-[11px] text-neutral-500">
                将上传到：<code className="rounded bg-neutral-100 px-1 py-0.5 font-mono">{uploadTargetDir}/</code>
              </p>

              <div className="rounded-md border-2 border-dashed p-6 text-center" style={{ borderColor: 'var(--border-soft)' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void handleLocalFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex flex-col items-center gap-2">
                  {uploading ? (
                    <>
                      <Loader2 size={24} className="animate-spin text-primary-500" />
                      <span className="text-xs text-neutral-500">上传中…</span>
                    </>
                  ) : (
                    <>
                      <Upload size={24} className="text-neutral-400" />
                      <span className="text-xs text-neutral-500">
                        点击选择图片或 PDF 文件
                      </span>
                      <button
                        type="button"
                        className="btn-primary !h-7 !px-3 !text-xs"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        选择文件
                      </button>
                      <span className="mt-1 text-[10px] text-neutral-400">
                        支持 png / jpg / gif / webp / svg / pdf
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="mt-3 flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>选定后自动插入 Markdown 语法到当前光标位置</span>
          <button
            type="button"
            className="btn-secondary !h-7 !px-3 !text-xs"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
