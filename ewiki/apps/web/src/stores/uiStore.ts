import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  navLayout: 'top' | 'side';
  // 外部（树菜单/卡片/查看器 host.openHistory）请求打开右栏历史 tab 的信号：
  // 自增 id，ProjectRightSidebar 监听后切到 history 并展开右栏
  historyRequestId: number;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setNavLayout: (layout: 'top' | 'side') => void;
  requestHistoryTab: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  rightPanelOpen: true,
  navLayout: 'top',
  historyRequestId: 0,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setNavLayout: (layout) => set({ navLayout: layout }),
  requestHistoryTab: () => set((s) => ({ historyRequestId: s.historyRequestId + 1, rightPanelOpen: true })),
}));
