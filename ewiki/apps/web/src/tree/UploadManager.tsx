// ---------------------------------------------------------------------------
// UploadManager —— 项目文档库文件上传受控弹窗（设计 §4.2 F2 / §4.3 F3）：
//   选择文件/文件夹 → 批量预检（accept / conflict / reject）
//   → 同名冲突批量三策略（替换 / 自动共存 / 跳过），支持逐行覆盖
//   → XHR 逐项串行上传（进度条、零字节、失败可重试且复用幂等键）
//   → 汇总 Toast → 完成回调（父组件负责 invalidate）
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useShowToast } from '../components/Toast';
import { humanSize } from '../fileview/util';
import {
  createUploadSession,
  explainUploadError,
  uploadFileXhr,
  type UploadSessionItem,
} from './upload-api';

/** 逐行冲突决策：undefined = 跟随批量默认 */
export type RowPolicy = 'replace' | 'rename' | 'skip';
export type BatchPolicy = Exclude<RowPolicy, undefined>;
type RowStatus = 'waiting' | 'uploading' | 'success' | 'failed' | 'skipped' | 'rejected';
type Phase = 'checking' | 'confirm' | 'running' | 'done';

interface UploadRow {
  id: number;
  file: File;
  path: string;
  size: number;
  idemKey: string;
  decision: UploadSessionItem['decision'];
  reason: string;
  policy: RowPolicy | undefined;
  status: RowStatus;
  percent: number;
  error: string | null;
  finalPath: string | null;
}

export interface UploadManagerProps {
  open: boolean;
  projectId: string;
  /** 目标文件夹（库内相对前缀，无尾斜杠）；null = 项目根 */
  targetFolder: string | null;
  /** 待传文件：普通多选或文件夹选择（后者携带 webkitRelativePath），也可是拖拽展开的 path+File */
  initialFiles?: FileList | File[] | { path: string; file: File }[] | null;
  onClose: () => void;
  /** 全部流程结束并点「完成」时回调（无论是否有失败项）；父组件负责刷新列表 */
  onUploaded: () => void;
}

const BATCH_OPTIONS: Array<{ value: BatchPolicy; label: string; hint: string }> = [
  { value: 'replace', label: '替换全部', hint: '覆盖同名文档并生成新版本' },
  { value: 'rename', label: '自动共存', hint: '自动加 -1 / -2 后缀保留两者' },
  { value: 'skip', label: '跳过冲突', hint: '不上传同名文件' },
];

/** 库内路径统一为 posix：反斜杠转正斜杠、去掉前导 ./、拼上目标文件夹前缀 */
function resolveRelativePath(file: File, explicit: string | undefined, targetFolder: string | null): string {
  const rel = (explicit ?? (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  const name = rel || file.name;
  return targetFolder ? `${targetFolder}/${name}` : name;
}

export function UploadManager({ open, projectId, targetFolder, initialFiles, onClose, onUploaded }: UploadManagerProps): React.ReactElement | null {
  const showToast = useShowToast();
  const [phase, setPhase] = useState<Phase>('checking');
  const [rows, setRows] = useState<UploadRow[]>([]);
  const rowsRef = useRef<UploadRow[]>([]);
  const runningRef = useRef(false);
  const [batchPolicy, setBatchPolicy] = useState<BatchPolicy>('replace');
  const [checkError, setCheckError] = useState<string | null>(null);
  const toastShownRef = useRef(false);

  const patchRow = (id: number, patch: Partial<UploadRow>): void => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      rowsRef.current = next;
      return next;
    });
  };

  // open 时（每次重新传入文件）重建路径并发起预检
  useEffect(() => {
    if (!open) return;
    const list = initialFiles;
    const picked: Array<{ path: string; file: File }> = [];
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i] as File | { path: string; file: File };
        if ('file' in item && item.file instanceof File) {
          picked.push({ path: resolveRelativePath(item.file, item.path, targetFolder), file: item.file });
        } else {
          const f = item as File;
          picked.push({ path: resolveRelativePath(f, undefined, targetFolder), file: f });
        }
      }
    }
    if (picked.length === 0) {
      setRows([]);
      setPhase('confirm');
      setCheckError(null);
      return;
    }
    setPhase('checking');
    setCheckError(null);
    toastShownRef.current = false;
    void (async () => {
      try {
        const resp = await createUploadSession(
          projectId,
          picked.map((p) => ({ path: p.path, size: p.file.size, mime: p.file.type || null })),
        );
        const items = resp.items.length === picked.length ? resp.items : picked.map((p) => ({
          path: p.path,
          size: p.file.size,
          mime: p.file.type || null,
          decision: 'accept' as const,
          reason: 'OK',
        }));
        const next: UploadRow[] = picked.map((p, idx) => {
          const item = items[idx];
          return {
            id: idx,
            file: p.file,
            path: item.decision === 'reject' ? p.path : item.path,
            size: item.size,
            idemKey: crypto.randomUUID(),
            decision: item.decision,
            reason: item.reason,
            policy: undefined,
            status: item.decision === 'reject' ? 'rejected' : 'waiting',
            percent: 0,
            error: null,
            finalPath: null,
          };
        });
        rowsRef.current = next;
        setRows(next);
        setPhase('confirm');
      } catch (err) {
        setCheckError(explainUploadError(err));
        setPhase('confirm');
      }
    })();
  }, [open, initialFiles, projectId, targetFolder]);

  const stats = useMemo(() => {
    let conflicts = 0;
    let rejects = 0;
    let uploadable = 0;
    for (const r of rows) {
      if (r.decision === 'conflict') conflicts += 1;
      if (r.decision === 'reject') rejects += 1;
      else uploadable += 1;
    }
    return { conflicts, rejects, uploadable };
  }, [rows]);

  const effectivePolicy = (r: UploadRow): BatchPolicy => r.policy ?? batchPolicy;

  const runQueue = async (ids: number[]): Promise<void> => {
    runningRef.current = true;
    setPhase('running');
    for (const id of ids) {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row) continue;
      if (row.decision === 'conflict' && effectivePolicy(row) === 'skip') {
        patchRow(id, { status: 'skipped' });
        continue;
      }
      patchRow(id, { status: 'uploading', percent: 0, error: null });
      try {
        const res = await uploadFileXhr(
          projectId,
          row.path,
          row.file,
          effectivePolicy(row) === 'replace' ? 'replace' : 'rename',
          row.idemKey,
          (percent) => patchRow(id, { percent }),
        );
        patchRow(id, { status: 'success', percent: 1, finalPath: res.path });
      } catch (err) {
        patchRow(id, { status: 'failed', error: explainUploadError(err) });
      }
    }
    runningRef.current = false;
    setPhase('done');
  };

  const startableRows = (): UploadRow[] =>
    rowsRef.current.filter((r) => r.status === 'waiting');

  const handleStart = (): void => {
    void runQueue(startableRows().map((r) => r.id));
  };

  const handleRetry = (id: number): void => {
    void runQueue([id]);
  };

  const handleRetryFailed = (): void => {
    const failed = rowsRef.current.filter((r) => r.status === 'failed');
    if (failed.length) void runQueue(failed.map((r) => r.id));
  };

  // 进入 done 阶段时弹一次汇总 Toast
  useEffect(() => {
    if (phase !== 'done' || toastShownRef.current) return;
    toastShownRef.current = true;
    const ok = rows.filter((r) => r.status === 'success').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    const skipped = rows.filter((r) => r.status === 'skipped').length;
    const rejected = rows.filter((r) => r.status === 'rejected').length;
    const parts = [`成功 ${ok} 个`];
    if (failed) parts.push(`失败 ${failed} 个`);
    if (skipped) parts.push(`跳过 ${skipped} 个`);
    if (rejected) parts.push(`预检拒绝 ${rejected} 个`);
    showToast(failed ? `上传完成（部分失败）：${parts.join('，')}` : `上传完成：${parts.join('，')}`);
  }, [phase, rows, showToast]);

  if (!open) return null;

  const successCount = rows.filter((r) => r.status === 'success').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const skippedCount = rows.filter((r) => r.status === 'skipped').length;
  const canClose = phase !== 'running';

  const statusCell = (r: UploadRow): React.ReactNode => {
    if (r.status === 'rejected') {
      const i = r.reason.indexOf(':');
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-rose-600">
          <XCircle size={12} className="shrink-0" />
          <span className="truncate">已拒绝：{i >= 0 ? r.reason.slice(i + 1).trim() : r.reason}</span>
        </span>
      );
    }
    switch (r.status) {
      case 'waiting':
        return <span className="text-[11px] text-neutral-400">等待上传</span>;
      case 'uploading':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-primary-600">
            <Loader2 size={12} className="animate-spin shrink-0" />
            上传中 {Math.round(r.percent * 100)}%
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
            <CheckCircle2 size={12} className="shrink-0" />
            成功{r.finalPath && r.finalPath !== r.path ? `（共存为 ${r.finalPath}）` : ''}
          </span>
        );
      case 'skipped':
        return <span className="text-[11px] text-neutral-400">已跳过</span>;
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-rose-600">
            <AlertTriangle size={12} className="shrink-0" />
            <span className="truncate">{r.error ?? '上传失败'}</span>
            <button
              type="button"
              onClick={() => handleRetry(r.id)}
              className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-px text-[10px] text-rose-600 hover:bg-rose-50"
              style={{ borderColor: 'var(--border-soft)' }}
            >
              <RefreshCw size={10} /> 重试
            </button>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={(e) => { if (e.target === e.currentTarget && canClose) onClose(); }}
    >
      <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col p-5 shadow-xl animate-fade-up">
        <div className="flex items-center gap-2">
          <FileUp size={16} className="text-primary-500" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            上传文件到{targetFolder ? `「${targetFolder}」` : '项目根目录'}
          </h3>
        </div>

        {phase === 'checking' ? (
          <div className="flex items-center gap-2 py-10 text-xs text-neutral-500">
            <Loader2 size={14} className="animate-spin" />
            正在预检 {rows.length || ''} 个文件…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-xs text-neutral-400">没有可上传的文件</div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span>共 {rows.length} 个文件</span>
              {stats.conflicts > 0 && <span className="text-amber-600">{stats.conflicts} 个同名冲突</span>}
              {stats.rejects > 0 && <span className="text-rose-600">{stats.rejects} 个被预检拒绝</span>}
              <span className="text-neutral-400">目标：{targetFolder || '根目录'}</span>
            </div>

            {stats.conflicts > 0 && (phase === 'confirm' || phase === 'running' || phase === 'done') && (
              <div className="mt-3 rounded-md border p-2.5" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-subtle, transparent)' }}>
                <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {stats.conflicts} 个文件与库内同名，统一处理方式（可逐行覆盖）：
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {BATCH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={phase === 'running'}
                      title={opt.hint}
                      onClick={() => setBatchPolicy(opt.value)}
                      className={`rounded border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        batchPolicy === opt.value
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'text-neutral-500 hover:bg-neutral-50'
                      }`}
                      style={batchPolicy === opt.value ? undefined : { borderColor: 'var(--border-soft)' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {checkError && (
              <p className="mt-2 text-xs text-rose-600">预检失败：{checkError}（仍可尝试上传，冲突以实际上传结果为准）</p>
            )}

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto scrollbar-thin rounded-md border" style={{ borderColor: 'var(--border-soft)' }}>
              {rows.map((r) => {
                const conflict = r.decision === 'conflict';
                return (
                  <div key={r.id} className="border-b px-3 py-2 last:border-b-0" style={{ borderColor: 'var(--border-soft)' }}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }} title={r.path}>
                        {r.path}
                      </span>
                      <span className="shrink-0 text-[11px] text-neutral-400">{humanSize(r.size)}</span>
                      {conflict && phase === 'confirm' && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-px text-[10px] text-amber-600">
                          <AlertTriangle size={10} /> 同名
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="min-w-0 flex-1">{statusCell(r)}</div>
                      {conflict && phase === 'confirm' && (
                        <div className="flex shrink-0 gap-1">
                          {BATCH_OPTIONS.map((opt) => {
                            const active = (r.policy ?? batchPolicy) === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                title={opt.hint}
                                onClick={() => patchRow(r.id, { policy: active ? undefined : opt.value })}
                                className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
                                  active
                                    ? 'border-primary-400 bg-primary-50 text-primary-700'
                                    : 'text-neutral-500 hover:bg-neutral-50'
                                }`}
                                style={active ? undefined : { borderColor: 'var(--border-soft)' }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {r.status === 'uploading' && (
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${Math.round(r.percent * 100)}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {phase === 'done' && (
                  <>
                    <span className="text-emerald-600">成功 {successCount}</span>
                    {failedCount > 0 && <span className="ml-2 text-rose-600">失败 {failedCount}</span>}
                    {skippedCount > 0 && <span className="ml-2 text-neutral-400">跳过 {skippedCount}</span>}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                {phase === 'confirm' && (
                  <>
                    <button type="button" className="btn-secondary !h-8 !text-xs" onClick={onClose}>取消</button>
                    <button type="button" className="btn-primary !h-8 !text-xs" onClick={handleStart}>
                      开始上传（{stats.uploadable} 个）
                    </button>
                  </>
                )}
                {phase === 'running' && (
                  <button type="button" className="btn-secondary !h-8 !text-xs" disabled>
                    <Loader2 size={12} className="animate-spin" /> 上传中…
                  </button>
                )}
                {phase === 'done' && (
                  <>
                    {failedCount > 0 && (
                      <button type="button" className="btn-secondary !h-8 !text-xs" onClick={handleRetryFailed}>
                        <RefreshCw size={12} /> 重试全部失败
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-primary !h-8 !text-xs"
                      onClick={() => { onUploaded(); onClose(); }}
                    >
                      完成
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
