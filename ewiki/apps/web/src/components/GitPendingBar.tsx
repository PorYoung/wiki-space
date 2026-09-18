import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCommitHorizontal, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api/client';
import { useShowToast } from './Toast';

export interface GitPendingInfo {
  pendingCount: number;
  oldestPendingAt: string | null;
  etaSeconds: number;
  mode: 'coalesced' | 'inline';
}

/**
 * Git 提交聚合状态条（GIT-COMMIT-COALESCING-DESIGN §10）：
 * 窗口内有待提交操作时提示「N 处变更待提交」+ eta + 「立即提交」（checkpoint）。
 * 提交完成的感知有三重兜底：本条 5s 轮询、git.flushed 实时事件、保存后的版本刷新。
 */
export function GitPendingBar({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const showToast = useShowToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<GitPendingInfo>({
    queryKey: ['git-pending', projectId],
    queryFn: () => apiFetch<GitPendingInfo>(`/api/v1/projects/${projectId}/git-pending`),
    enabled: !!projectId,
    // 窗口打开期间轮询收敛；其余时候靠事件/保存动作触发刷新
    refetchInterval: (query) => ((query.state.data?.pendingCount ?? 0) > 0 ? 5000 : false),
  });

  const checkpoint = useMutation({
    mutationFn: (message?: string) =>
      apiFetch<{ ok: boolean; skipped?: string }>(`/api/v1/projects/${projectId}/git-flush`, {
        method: 'POST',
        body: JSON.stringify({ message: message || undefined }),
      }),
    onSuccess: (r) => {
      if (r.skipped) {
        showToast('当前文档库未启用 Git 自动提交');
        return;
      }
      showToast('已触发 Git 提交，正在推送…');
      void queryClient.invalidateQueries({ queryKey: ['git-pending', projectId] });
    },
    onError: (err) => showToast(err instanceof Error ? err.message : '触发提交失败'),
  });

  if (!data || data.mode !== 'coalesced' || data.pendingCount <= 0) return null;
  const minutes = Math.max(1, Math.round((data.etaSeconds || 0) / 60));

  return (
    <div
      className="h-9 inline-flex items-center gap-2 px-3 rounded-md border text-xs"
      style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}
      title="同一时间窗内的多次保存会合并为一个 Git 提交"
    >
      <GitCommitHorizontal size={14} className="text-neutral-500" />
      <span className="text-neutral-600">
        {data.pendingCount} 处变更待提交（约 {minutes} 分钟后自动提交）
      </span>
      {canWrite && (
        <button
          type="button"
          className="btn-secondary !h-6 !px-2 !text-[11px] inline-flex items-center gap-1"
          disabled={checkpoint.isPending}
          onClick={() => {
            const note = window.prompt('提交备注（将写入 Git 提交说明，可留空）') ?? '';
            checkpoint.mutate(note.trim() || undefined);
          }}
        >
          {checkpoint.isPending ? <Loader2 size={11} className="animate-spin" /> : <GitCommitHorizontal size={11} />}
          立即提交
        </button>
      )}
    </div>
  );
}
