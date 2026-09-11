import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** 全局管理视图布局（迁移自 prototype Layout.jsx） */
export function Layout(): React.ReactElement {
  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-page)' }}>
      <Sidebar />
      <div className="ml-[248px] flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
