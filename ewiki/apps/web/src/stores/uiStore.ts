import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  navLayout: 'top' | 'side';
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setNavLayout: (layout: 'top' | 'side') => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  rightPanelOpen: true,
  navLayout: 'top',
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setNavLayout: (layout) => set({ navLayout: layout }),
}));
