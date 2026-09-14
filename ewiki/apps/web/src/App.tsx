import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { ProjectLayout } from './components/layout/ProjectLayout';
import { tokenStore } from './lib/api/client';

// 路由级 code-split（首屏只加载登录/跳转逻辑，页面按需拉取 chunk）
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const ReadPage = lazy(() => import('./pages/ReadPage').then((m) => ({ default: m.ReadPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const BrowsePage = lazy(() => import('./pages/BrowsePage').then((m) => ({ default: m.BrowsePage })));
const GraphPage = lazy(() => import('./pages/GraphPage').then((m) => ({ default: m.GraphPage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const PublishPage = lazy(() => import('./pages/PublishPage').then((m) => ({ default: m.PublishPage })));
const MembersPage = lazy(() => import('./pages/MembersPage').then((m) => ({ default: m.MembersPage })));
const ProjectSettingsPage = lazy(() => import('./pages/ProjectSettingsPage').then((m) => ({ default: m.ProjectSettingsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ThemesPage = lazy(() => import('./pages/ThemesPage').then((m) => ({ default: m.ThemesPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })));
const TeamDetailPage = lazy(() => import('./pages/TeamDetailPage').then((m) => ({ default: m.TeamDetailPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const StorageConnectionsPage = lazy(() => import('./pages/StorageConnectionsPage').then((m) => ({ default: m.StorageConnectionsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const NewProjectPage = lazy(() => import('./pages/NewProjectPage').then((m) => ({ default: m.NewProjectPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  return tokenStore.access ? children : <Navigate to="/login" replace />;
}

function PageFallback(): React.ReactElement {
  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
      {/* 加载条用 500 级：亮/暗模式下都足够鲜明（600 在暗底偏暗） */}
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-primary-500" />
    </div>
  );
}

/** 路由表（FRONTEND.md 7.1）：React.lazy 懒加载 + Suspense 骨架 */
export default function App(): React.ReactElement {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={tokenStore.access ? <RequireAuth><HomePage /></RequireAuth> : <Navigate to="/login" replace />} />
        <Route path="/search" element={tokenStore.access ? <RequireAuth><SearchPage /></RequireAuth> : <Navigate to="/login" replace />} />
        <Route path="/read/:id" element={tokenStore.access ? <RequireAuth><ReadPage /></RequireAuth> : <Navigate to="/login" replace />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/themes" element={<ThemesPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/teams/:id" element={<TeamDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/connections" element={<StorageConnectionsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/projects/:id" element={<RequireAuth><ProjectLayout /></RequireAuth>}>
          {/* 项目空间首页：跳转 browse（非聚焦态即文档列表首页，对齐原型 App.jsx:35 index→browse）。
              管理员自定义首页展示内容为后续功能，当前先落地「首页=文档列表」 */}
          <Route index element={<Navigate to="browse" replace />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="publish" element={<PublishPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="settings" element={<ProjectSettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
