import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme/ThemeProvider';

// 迁移自 prototype ProjectLayout.jsx:16-38 —— 与 TopBar 共享设计的精简版单图标切换

const META = {
  light: { Icon: Sun, label: '亮色模式', next: '暗色' },
  dark: { Icon: Moon, label: '暗色模式', next: '跟随系统' },
  system: { Icon: Monitor, label: '跟随系统', next: '亮色' },
} as const;

export function AppearanceToggle(): React.ReactElement {
  const { appearance, toggleAppearance } = useTheme();
  const meta = META[appearance] ?? META.light;
  const Icon = meta.Icon;

  return (
    <button
      type="button"
      onClick={toggleAppearance}
      title={`${meta.label} · 点击切换到${meta.next}`}
      aria-label={`切换外观模式（当前：${meta.label}）`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-all duration-200 hover:bg-neutral-100 hover:text-neutral-800"
    >
      <Icon size={16} className="transition-transform duration-300" />
    </button>
  );
}
