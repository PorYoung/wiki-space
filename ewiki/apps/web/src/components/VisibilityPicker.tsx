import { CheckCircle2, Globe, Lock, Pencil, Users } from 'lucide-react';
import { VISIBILITY_META, VISIBILITY_ORDER, isTeamScope, type Visibility } from '../lib/visibility';

// 可见性五档选择器（NewProjectPage / ProjectSettingsPage 共用）
// 卡片式单选；文案取自 lib/visibility 单一事实源；个人库禁用团队档位并提示原因。
export function VisibilityPicker({ value, onChange, disableTeamScopes = false }: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disableTeamScopes?: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      {VISIBILITY_ORDER.map((key) => {
        const meta = VISIBILITY_META[key];
        const disabled = disableTeamScopes && isTeamScope(key);
        const selected = value === key;
        const Icon = meta.group === 'private' ? Lock : meta.group === 'team' ? Users : Globe;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(key)}
            className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${
              selected ? 'bg-primary-50/70 ring-1 ring-primary-400' : 'hover:bg-neutral-50/70 ring-1 ring-transparent'
            } ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}
          >
            <span
              className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                selected ? 'border-primary-500' : 'border-neutral-300'
              }`}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-primary-500" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                <Icon size={13} />
                {meta.label}
                {meta.write && <Pencil size={11} style={{ color: 'var(--text-muted)' }} />}
              </span>
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                {meta.desc}
                {disabled && '（需归属团队）'}
              </span>
            </span>
            {selected && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary-600" />}
          </button>
        );
      })}
    </div>
  );
}
