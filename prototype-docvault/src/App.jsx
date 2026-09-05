import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'

// Pages (lazy-declared for readability — import works at top in Vite)
import Dashboard from './pages/Dashboard.jsx'
import Library from './pages/Library.jsx'
import Editor from './pages/Editor.jsx'
import Versions from './pages/Versions.jsx'
import Templates from './pages/Templates.jsx'
import Sources from './pages/Sources.jsx'
import Team from './pages/Team.jsx'
import Settings from './pages/Settings.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/versions" element={<Versions />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/team" element={<Team />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
