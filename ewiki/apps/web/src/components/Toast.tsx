import { useOutletContext } from 'react-router-dom';

// 迁移自 prototype ProjectLayout.jsx:458-467（HeaderToast）——深浅色自适应走 CSS 变量

export interface ProjectOutletContext {
  showToast: (msg: string) => void;
}

/** 项目内子页面通过 useOutletContext 拿到的 toast 通道 */
export function useShowToast(): (msg: string) => void {
  return useOutletContext<ProjectOutletContext>().showToast;
}

export function HeaderToast({ message }: { message: string }): React.ReactElement {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-up">
      <div
        className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-lg"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}
      >
        <span className="text-emerald-500">✓</span>
        {message}
      </div>
    </div>
  );
}
