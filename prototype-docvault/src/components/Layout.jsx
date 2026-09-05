import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'

export default function Layout() {
  return (
    <div className="flex h-screen bg-surface-subtle">
      <Sidebar />
      <div className="flex-1 ml-[248px] flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
