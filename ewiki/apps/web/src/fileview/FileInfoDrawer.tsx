import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clock,
  FileCog,
  HardDrive,
  History,
  Pencil,
  Tag as TagIcon,
  User,
  X,
} from 'lucide-react';
import { basenameOf, extOf, resolveFileType } from '@ewiki/shared';
import { apiFetch } from '../lib/api/client';
import { useShowToast } from '../components/Toast';
import { fileIconOf } from '../tree/fileIcons';
import { formatTime, humanSize } from './util';

// 文件信息抽屉（文件管理重构 §5.2）：右侧滑入，展示文档元数据；
// Markdown 文档可在此重命名标题（PATCH title，与 path 解耦 §4.5）。
// 数据自取（与 BrowsePage 共享 ['document',id] / ['document-versions',id] 缓存）。

interface InfoDocument {
  id: string;
  projectId: string;
  path: string;
  title: string | null;
  status: 'untracked' | 'synced' | 'modified' | 'conflict';
  wordCount: number;
  contentHash: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
  kind?: 'text' | 'binary';
  ext?: string | null;
  mime?: string | null;
  size?: number;
  tags?: string[] | null;
  storageRef?: string | null;
}

interface InfoVersion {
  id: string;
  versionNo: number;
}

const STATUS_LABEL: Record<InfoDocument['status'], string> = {
  synced: '已同步',
  modified: '本地修改',
  conflict: '冲突',
  untracked: '未跟踪',
};

const TYPE_LABEL: Record<string, string> = {
  markdown: 'Markdown 文档',
  code: '代码 / 文本',
  image: '图片',
  pdf: 'PDF',
  binary: '其他文件',
};

export interface FileInfoDrawerProps {
  documentId: string | null;
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
  onOpenHistory?: (documentId: string) => void;
}

function shortRef(ref: string): string {
  if (ref.length <= 28) return ref;
  return `${ref.slice(0, 14)}…${ref.slice(-10)}`;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="min-w-0 text-right text-xs break-all" style={{ color: 'var(--text-primary)' }}>{children}</dd>
    </div>
  );
}

export function FileInfoDrawer({ documentId, open, canWrite, onClose, onOpenHistory }: FileInfoDrawerProps) {
  const showToast = useShowToast();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const { data: doc, isLoading } = useQuery<InfoDocument>({
    queryKey: ['document', documentId],
    queryFn: () => apiFetch<InfoDocument>(`/api/v1/documents/${documentId}`),
    enabled: !!documentId && open,
  });

  const { data: versionsData } = useQuery<{ items: InfoVersion[] }>({
    queryKey: ['document-versions', documentId],
    queryFn: () => apiFetch<{ items: InfoVersion[] }>(`/api/v1/documents/${documentId}/versions`),
    enabled: !!documentId && open,
  });

  useEffect(() => {
    if (open) {
      const t = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(t);
    }
    setShown(false);
    setEditingTitle(false);
  }, [open, documentId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    setEditingTitle(false);
  }, [documentId]);

  const renameTitleMutation = useMutation({
    mutationFn: (title: string) => {
      if (!documentId) return Promise.reject(new Error('no doc'));
      return apiFetch<{ ok: boolean; document: InfoDocument }>(`/api/v1/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['document'] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      setEditingTitle(false);
      showToast('标题已更新');
    },
    onError: () => {
      showToast('标题更新失败，请重试');
    },
  });

  if (!open || !documentId) return null;

  const resolved = doc ? resolveFileType(doc.path, doc.mime) : null;
  const typeId = resolved?.typeId ?? 'binary';
  const isMarkdown = typeId === 'markdown';
  const isBinary = resolved?.kind === 'binary';
  const { Icon, className: iconClass } = fileIconOf(doc?.path ?? '', doc?.mime ?? null);
  const versionCount = versionsData?.items?.length ?? 0;

  const startEditTitle = () => {
    setTitleDraft(doc?.title ?? '');
    setEditingTitle(true);
  };
  const submitTitle = () => {
    const next = titleDraft.trim();
    if (!next) {
      showToast('标题不能为空');
      return;
    }
    if (next === (doc?.title ?? '')) {
      setEditingTitle(false);
      return;
    }
    renameTitleMutation.mutate(next);
  };
  const copyPath = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc.path);
      showToast('路径已复制');
    } catch {
      showToast('复制失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50" aria-hidden={!shown}>
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm transition-opacity duration-200"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={onClose}
      />
      <aside
        className="absolute right-0 top-0 h-full w-[380px] max-w-[92vw] border-l shadow-2xl flex flex-col transition-transform duration-200 ease-out"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-soft)',
          transform: shown ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex min-w-0 items-center gap-2">
            <FileCog size={16} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>文件信息</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 transition-colors hover:bg-neutral-500/10"
            title="关闭 (Esc)"
          >
            <X size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          {isLoading || !doc ? (
            <div className="py-16 text-center text-xs" style={{ color: 'var(--text-muted)' }}>加载中…</div>
          ) : (
            <>
              <div className="flex items-start gap-3 pb-4">
                <Icon size={28} className={`mt-0.5 shrink-0 ${iconClass}`} />
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                    {basenameOf(doc.path)}
                  </p>
                  <button
                    type="button"
                    onClick={copyPath}
                    className="mt-1 block max-w-full truncate text-left text-xs hover:underline"
                    style={{ color: 'var(--text-muted)' }}
                    title="点击复制完整路径"
                  >
                    {doc.path}
                  </button>
                </div>
              </div>

              <dl className="divide-y border-y" style={{ borderColor: 'var(--border-soft)' }}>
                <InfoRow label="类型">
                  {TYPE_LABEL[typeId] ?? TYPE_LABEL.binary}
                  <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                    ({doc.ext ?? extOf(doc.path) ?? '—'}{doc.mime ? ` · ${doc.mime}` : ''})
                  </span>
                </InfoRow>
                <InfoRow label="大小">
                  {typeof doc.size === 'number' && doc.size > 0 ? humanSize(doc.size) : '—'}
                </InfoRow>
                {!isBinary && (
                  <InfoRow label="字数">{doc.wordCount || 0}</InfoRow>
                )}
                <InfoRow label="状态">{STATUS_LABEL[doc.status] ?? doc.status}</InfoRow>
                <InfoRow label="版本数">
                  {versionCount > 0 ? `${versionCount} 个版本` : '—'}
                </InfoRow>
                {isBinary && (
                  <InfoRow label="存储">
                    {doc.storageRef ? (
                      <span className="inline-flex items-center gap-1.5">
                        <HardDrive size={12} className="text-emerald-500" />
                        <span className="align-middle" title={doc.storageRef}>已入库 · {shortRef(doc.storageRef)}</span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>未入库</span>
                    )}
                  </InfoRow>
                )}
                <InfoRow label="创建时间">{formatTime(doc.createdAt)}</InfoRow>
                <InfoRow label="更新时间">{formatTime(doc.updatedAt)}</InfoRow>
                <InfoRow label="更新者">
                  <span className="inline-flex items-center gap-1">
                    <User size={12} />
                    {doc.updatedBy || '—'}
                  </span>
                </InfoRow>
              </dl>

              {isMarkdown && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <Pencil size={12} />
                    <span>文档标题</span>
                  </div>
                  {editingTitle ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitTitle();
                          if (e.key === 'Escape') setEditingTitle(false);
                        }}
                        className="input h-8 flex-1 !text-xs"
                        placeholder="输入文档标题"
                      />
                      <button
                        type="button"
                        onClick={submitTitle}
                        disabled={renameTitleMutation.isPending}
                        className="btn-primary !h-8 !w-8 !p-0"
                        title="保存"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTitle(false)}
                        className="btn-secondary !h-8 !w-8 !p-0"
                        title="取消"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditTitle}
                      disabled={!canWrite}
                      className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-neutral-500/5 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
                      title={canWrite ? '重命名标题' : '只读权限'}
                    >
                      <span className="truncate">{doc.title || '（未设置标题）'}</span>
                      <Pencil size={12} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <TagIcon size={12} />
                  <span>标签</span>
                </div>
                {doc.tags && doc.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {doc.tags.map((tag) => (
                      <span key={tag} className="tag-neutral">{tag}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无标签</p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Clock size={12} />
                <span title={doc.contentHash ?? ''}>内容哈希：{doc.contentHash ? `${doc.contentHash.slice(0, 12)}…` : '—'}</span>
              </div>
            </>
          )}
        </div>

        {onOpenHistory && (
          <footer className="border-t p-4" style={{ borderColor: 'var(--border-soft)' }}>
            <button
              type="button"
              onClick={() => onOpenHistory(documentId)}
              className="btn-secondary h-9 w-full !text-xs"
            >
              <History size={14} />
              查看历史版本
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
