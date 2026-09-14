import { useCallback, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { HeaderToast, type ProjectOutletContext } from '../Toast';

/** 全局管理视图布局（迁移自 prototype Layout.jsx） */
export function Layout(): React.ReactElement {
  // 全局 outlet toast：Layout 下的页面（团队、文档库等）与 ProjectLayout 下的项目页共用同一通道
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const context: ProjectOutletContext = { showToast };

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-page)' }}>
      <Sidebar />
      <div className="ml-[248px] flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto scrollbar-thin">
          <Outlet context={context} />
        </main>
      </div>
      {toast && <HeaderToast message={toast} />}
    </div>
  );
}
