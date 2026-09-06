import { Routes, Route, Navigate } from 'react-router-dom'
import GlobalLayout from './components/Layout.jsx'      // 全局管理视图壳
import ProjectLayout from './components/ProjectLayout.jsx' // 项目聚焦视图壳

// ===== 全局管理视图 =====
import Dashboard from './pages/Dashboard.jsx'
import Library from './pages/Library.jsx'
import Sources from './pages/Sources.jsx'
import Themes from './pages/Themes.jsx'
import Settings from './pages/Settings.jsx'

// ===== 项目聚焦视图 =====
import ProjectBrowse from './pages/ProjectBrowse.jsx'
import ProjectActivity from './pages/ProjectActivity.jsx'
import ProjectPublish from './pages/ProjectPublish.jsx'
import ProjectMembers from './pages/ProjectMembers.jsx'
import ProjectSettings from './pages/ProjectSettings.jsx'
import ProjectGraph from './pages/ProjectGraph.jsx'

export default function App() {
  return (
    <Routes>
      {/* ===== 全局管理视图 ===== */}
      <Route element={<GlobalLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/themes" element={<Themes />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* ===== 项目聚焦视图 ===== */}
      <Route path="/project/:id" element={<ProjectLayout />}>
        <Route index element={<Navigate to="browse" replace />} />
        <Route path="browse"   element={<ProjectBrowse />} />
        <Route path="graph"    element={<ProjectGraph />} />
        <Route path="activity" element={<ProjectActivity />} />
        <Route path="publish"  element={<ProjectPublish />} />
        <Route path="members"  element={<ProjectMembers />} />
        <Route path="settings" element={<ProjectSettings />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
