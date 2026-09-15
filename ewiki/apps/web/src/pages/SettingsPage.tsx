import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronRight,
  Circle,
  Eye,
  Globe,
  HardDrive,
  KeyRound,
  Keyboard,
  LogOut,
  Moon,
  Palette,
  Save,
  Settings2,
  Shield,
  Sun,
  Monitor,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { apiFetch, tokenStore } from '../lib/api/client';
import { TokenSettings } from '../components/TokenSettings';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES } from '@ewiki/theme';
import { HeaderToast } from '../components/Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MeUser {
  id: string;
  email: string;
  name: string;
  globalRole: string;
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// localStorage 缓存 — 云端 user_prefs（PUT /api/v1/me/prefs 的 prefs 字段）为准
// ---------------------------------------------------------------------------

const PREFS_KEY = 'ewiki-user-prefs';

interface UserPrefs {
  theme: 'light' | 'dark' | 'system';
  accent: 'indigo' | 'emerald' | 'sky' | 'rose' | 'amber' | 'violet';
  fontSize: 'sm' | 'md' | 'lg';
  compactMode: boolean;
  notifyEmail: boolean;
  notifyInApp: boolean;
  notifyWeekly: boolean;
  defaultBackend: 'git' | 'local';
  kbdSearch: string;
  kbdCommand: string;
}

const DEFAULT_PREFS: UserPrefs = {
  theme: 'system',
  accent: 'indigo',
  fontSize: 'md',
  compactMode: false,
  notifyEmail: false,
  notifyInApp: true,
  notifyWeekly: false,
  defaultBackend: 'git',
  kbdSearch: '⌘K',
  kbdCommand: '⌘⇧P',
};

function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) } as UserPrefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: UserPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCENT_PALETTE: Record<UserPrefs['accent'], { label: string; color: string }> = {
  indigo: { label: '靛蓝', color: '#6366f1' },
  emerald: { label: '翠绿', color: '#10b981' },
  sky: { label: '天蓝', color: '#0ea5e9' },
  rose: { label: '玫瑰', color: '#f43f5e' },
  amber: { label: '琥珀', color: '#f59e0b' },
  violet: { label: '紫罗兰', color: '#8b5cf6' },
};

// 强调色圆点映射到 @ewiki/theme 真主题 id —— 点击即切全站主题（对齐原型行为）
const ACCENT_THEME_MAP: Record<UserPrefs['accent'], string> = {
  indigo: 'deep-indigo',
  emerald: 'fresh-emerald',
  sky: 'bi-luo',
  rose: 'minimal-rose',
  amber: 'warm-amber',
  violet: 'mu-shan-zi',
};

function avatarColor(name: string | null | undefined): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
  let h = 0;
  for (let i = 0; i < (name ?? '').length; i++) h = (h * 31 + name!.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, desc, icon, children }: {
  title: string; desc: string; icon: React.ReactElement; children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="card p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function ProfileSection({ user }: {
  user: MeUser | undefined;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [email] = useState(user?.email ?? '');
  const [bio] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name ?? '');
      setDirty(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setDirty(name !== (user?.name ?? ''));
  }, [name, user?.name]);

  return (
    <Section title="个人资料" desc="你的显示名、头像与简介" icon={<User size={15} />}>
      <div className="flex items-center gap-4 mb-5">
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div
            className="h-16 w-16 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
            style={{ background: avatarColor(user?.name ?? user?.email) }}
          >
            {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-sm font-medium text-neutral-900">{name || '未命名'}</div>
          <div className="text-[11px] text-neutral-500">{email}</div>
          <button
            type="button"
            disabled
            title="TODO: 后端补充 PATCH /api/v1/me 后启用"
            className="text-[11px] text-primary-600 hover:underline mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            更换头像
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">显示名</label>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">邮箱</label>
          <input type="text" className="input font-mono text-xs text-neutral-500 bg-neutral-50" disabled value={email} />
        </div>
        {/* 角色 / 个人主页只读字段（原型 Settings.jsx:133-147，盘点「可补」项） */}
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">角色</label>
          <div className="input flex items-center justify-between cursor-not-allowed bg-neutral-50 text-neutral-600">
            <span className="flex items-center gap-2">
              <Shield size={14} className="text-primary-500" />
              {user?.globalRole === 'admin' ? '管理员 · Owner' : '成员 · Editor'}
            </span>
            <span className="text-[11px] text-neutral-400">由 Owner 分配</span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1.5">个人主页</label>
          {/* TODO: 个人主页（公开档案页）功能未实现，先展示占位说明 */}
          <div className="input flex items-center gap-2 bg-neutral-50 text-neutral-400 cursor-not-allowed">
            <Globe size={14} />
            <span className="text-xs">公开主页功能即将上线</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-medium text-neutral-700 mb-1.5">个人简介</label>
        <input type="text" className="input" disabled value={bio} placeholder="TODO: 后端补充 bio 字段" />
      </div>

      <div className="mt-5 flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="text-[11px] text-neutral-400">变更将在保存后生效</div>
        <button
          type="button"
          disabled={!dirty}
          title="TODO: 后端补充 PATCH /api/v1/me 后启用"
          className="btn-primary !h-8 !text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save size={12} /> 保存
        </button>
      </div>
    </Section>
  );
}

function AppearanceSection({ prefs, setPrefs }: {
  prefs: UserPrefs; setPrefs: React.Dispatch<React.SetStateAction<UserPrefs>>;
}): React.ReactElement {
  // 选中态读主题引擎的 appearance（与 TopBar 外观切换同源），prefs.theme 仅作云端偏好镜像；
  // 否则 TopBar 切深色后此处不回显（PLAN 2.5 残留半缺口 / 5.1.6）
  const { activeTheme, applyTheme, appearance, applyAppearance } = useTheme();
  const ThemeIcon = appearance === 'dark' ? Moon : appearance === 'light' ? Sun : Monitor;

  return (
    <Section title="外观" desc="主题模式、强调色与字体" icon={<Palette size={15} />}>
      {/* Theme */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-neutral-700 mb-2">主题模式</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: 'light' as const, label: '浅色', icon: Sun },
            { key: 'dark' as const, label: '深色', icon: Moon },
            { key: 'system' as const, label: '跟随系统', icon: Monitor },
          ].map(({ key, label, icon: Icon }) => {
            const active = appearance === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  applyAppearance(key);
                  setPrefs((p) => ({ ...p, theme: key }));
                }}
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border text-xs font-medium transition ${
                  active
                    ? 'border-primary-300 bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-neutral-400 mt-1.5">
          当前：{ThemeIcon === Monitor ? '跟随系统' : ThemeIcon === Sun ? '浅色' : '深色'} · 设置已保存到本地
        </div>
      </div>

      {/* Accent color */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-neutral-700 mb-2">
          强调色 <span className="font-normal text-neutral-400">（点击切换全站主题）</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ACCENT_PALETTE).map(([key, meta]) => {
            const themeId = ACCENT_THEME_MAP[key as UserPrefs['accent']];
            const themeColor = THEMES.find((t) => t.id === themeId)?.palette[500] ?? meta.color;
            const active = activeTheme.id === themeId;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  applyTheme(themeId);
                  setPrefs((p) => ({ ...p, accent: key as UserPrefs['accent'] }));
                }}
                className={`relative w-8 h-8 rounded-full flex items-center justify-center transition ${
                  active ? 'ring-2 ring-offset-2 ring-neutral-900' : 'hover:scale-110'
                }`}
                style={{ background: themeColor }}
                title={meta.label}
              >
                {active && <Circle size={10} className="text-white fill-white" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Font size */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-neutral-700 mb-2">字体大小</label>
        <div className="grid grid-cols-3 gap-2">
          {(['sm', 'md', 'lg'] as const).map((sz) => {
            const label = sz === 'sm' ? '小' : sz === 'md' ? '中' : '大';
            const active = prefs.fontSize === sz;
            return (
              <button
                key={sz}
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, fontSize: sz }))}
                className={`p-2 rounded-lg border text-xs font-medium transition ${
                  active
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                <span className={sz === 'sm' ? 'text-[10px]' : sz === 'md' ? 'text-xs' : 'text-sm'}>
                  A
                </span>
                <span className="ml-1">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Compact mode */}
      <div className="flex items-center justify-between py-2">
        <div>
          <div className="text-xs font-medium text-neutral-800">紧凑模式</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">减少间距，在高密度视图下显示更多内容</div>
        </div>
        <Toggle
          checked={prefs.compactMode}
          onChange={(v) => setPrefs((p) => ({ ...p, compactMode: v }))}
        />
      </div>
    </Section>
  );
}

function NotificationsSection({ prefs, setPrefs }: {
  prefs: UserPrefs; setPrefs: React.Dispatch<React.SetStateAction<UserPrefs>>;
}): React.ReactElement {
  // 事件级通知行对齐原型 Settings.jsx:283-288（评论/合并/发布/同步失败）
  const eventRows = [
    { title: '协作者评论我时', hint: '当有人 @你 或评论你参与的文档' },
    { title: '文档被合并时', hint: '你的草稿或分支被合并入主文档' },
    { title: '版本发布时', hint: '有人从版本历史发布一个稳定快照' },
    { title: 'Git 同步失败时', hint: 'Git 存储源的拉取或推送同步出错' },
  ];
  return (
    <Section title="通知" desc="站内与邮件通知偏好" icon={<Bell size={15} />}>
      <div className="space-y-4">
        <NotificationToggle
          label="站内通知"
          desc="成员加入、文档更新等事件"
          checked={prefs.notifyInApp}
          onChange={(v) => setPrefs((p) => ({ ...p, notifyInApp: v }))}
        />
        <NotificationToggle
          label="邮件通知"
          desc="重要变更通过邮件提醒"
          checked={prefs.notifyEmail}
          onChange={(v) => setPrefs((p) => ({ ...p, notifyEmail: v }))}
        />
        <NotificationToggle
          label="每周摘要"
          desc="每周一早上发送上一周项目动态汇总"
          checked={prefs.notifyWeekly}
          onChange={(v) => setPrefs((p) => ({ ...p, notifyWeekly: v }))}
        />
      </div>

      {/* TODO: 通知体系（notifications 表事件类型 + 邮件投递）后端未实现，事件级矩阵与摘要频率先占位禁用 */}
      <div className="mt-5 rounded-lg border border-dashed p-4 opacity-70" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="text-xs font-semibold text-neutral-800 mb-1">事件级通知</div>
        <div className="text-[11px] text-neutral-400 mb-3">按事件类型分别设置站内 / 邮件渠道（即将上线）</div>
        <div className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
          {eventRows.map((r) => (
            <div key={r.title} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-xs text-neutral-800">{r.title}</div>
                <div className="text-[11px] text-neutral-500">{r.hint}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-neutral-400">站内</span>
                <Toggle checked={false} onChange={() => undefined} disabled />
                <span className="text-[10px] text-neutral-400">邮件</span>
                <Toggle checked={false} onChange={() => undefined} disabled />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-dashed p-4 opacity-70" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="text-xs font-semibold text-neutral-800 mb-1">摘要频率</div>
        <div className="text-[11px] text-neutral-400 mb-3">将错过的事件打包成一封邮件（即将上线）</div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '每日', sub: '工作日早 9 点' },
            { label: '每周', sub: '周一早上' },
            { label: '从不', sub: '完全关闭' },
          ].map((o) => (
            <button key={o.label} type="button" disabled title="TODO: 通知摘要后端未实现"
              className="p-2.5 rounded-lg border border-neutral-200 text-left disabled:opacity-60 disabled:cursor-not-allowed">
              <div className="text-xs font-medium text-neutral-700">{o.label}</div>
              <div className="text-[10px] text-neutral-400 mt-0.5">{o.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function StorageDefaultsSection({ prefs, setPrefs }: {
  prefs: UserPrefs; setPrefs: React.Dispatch<React.SetStateAction<UserPrefs>>;
}): React.ReactElement {
  // 已配置的用户级存储源连接（GET /api/v1/connections；管理操作在「存储源」页）
  const { data: connectionsData } = useQuery<{ items: Array<{
    id: string; name: string; kind: 'gitlab' | 'gitea'; status: string; lastCheckAt: string | null;
  }> }>({
    queryKey: ['connections'],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; kind: 'gitlab' | 'gitea'; status: string; lastCheckAt: string | null }> }>('/api/v1/connections'),
  });
  const connections = connectionsData?.items ?? [];

  return (
    <Section title="存储默认" desc="新建文档库时默认使用的存储后端" icon={<HardDrive size={15} />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          { key: 'git' as const, label: 'Git 仓库', desc: '关联 GitLab / Gitea，可拉取与推送同步' },
          { key: 'local' as const, label: '服务器存储', desc: '平台服务器分配目录落盘，无需同步' },
        ].map(({ key, label, desc }) => {
          const active = prefs.defaultBackend === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, defaultBackend: key }))}
              className={`flex items-start gap-3 p-3 rounded-lg border text-left transition ${
                active
                  ? 'border-primary-300 bg-primary-50 ring-1 ring-primary-200'
                  : 'border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                active ? 'border-primary-600' : 'border-neutral-300'
              }`}>
                {active && <span className="w-2.5 h-2.5 rounded-full bg-primary-600" />}
              </div>
              <div>
                <div className="text-xs font-medium text-neutral-800">{label}</div>
                <div className="text-[11px] text-neutral-500 mt-0.5">{desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 已配置的存储源连接预览（管理操作在「存储源」页） */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold text-neutral-700">已配置的存储源</div>
        {connections.length === 0 ? (
          <p className="text-xs text-neutral-400">暂无存储源连接，可在侧边栏「存储源」页添加 GitLab / Gitea 连接。</p>
        ) : (
          <div className="divide-y rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
            {connections.slice(0, 6).map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <span className="tag tag-neutral !text-[10px] uppercase">{c.kind}</span>
                <span className="text-xs font-medium text-neutral-800 truncate">{c.name}</span>
                <span className={`ml-auto shrink-0 ${c.status === 'error' ? 'tag tag-danger' : c.status === 'ok' ? 'tag tag-success' : 'tag tag-warning'}`}>
                  {c.status === 'error' ? '异常' : c.status === 'ok' ? '已校验' : '未校验'}
                </span>
                <span className="shrink-0 text-[11px] text-neutral-400 hidden sm:inline">
                  {c.lastCheckAt ? `校验于 ${new Date(c.lastCheckAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '从未校验'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function KeyboardSection({ prefs, setPrefs }: {
  prefs: UserPrefs; setPrefs: React.Dispatch<React.SetStateAction<UserPrefs>>;
}): React.ReactElement {
  return (
    <Section title="快捷键" desc="快速操作与搜索" icon={<Keyboard size={15} />}>
      <div className="divide-y rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
        {[
          { key: 'search', label: '全局搜索', value: prefs.kbdSearch, setter: (v: string) => setPrefs((p) => ({ ...p, kbdSearch: v })) },
          { key: 'command', label: '命令面板', value: prefs.kbdCommand, setter: (v: string) => setPrefs((p) => ({ ...p, kbdCommand: v })) },
        ].map((item) => (
          <div key={item.key} className="flex items-center justify-between px-4 py-3">
            <div className="text-sm text-neutral-800">{item.label}</div>
            <input
              type="text"
              className="input !w-28 !h-7 !text-xs font-mono text-center"
              value={item.value}
              onChange={(e) => item.setter(e.target.value)}
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-neutral-400 mt-2">以上两项快捷键配置已保存到本地</p>

      {/* 只读快捷键一览（对齐原型 Settings.jsx:463-507；自定义绑定后端/快捷键体系未接入，先只读展示） */}
      <div className="mt-5">
        <div className="text-xs font-semibold text-neutral-800 mb-2">全部快捷键</div>
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
          <table className="w-full text-sm">
            <tbody className="divide-y" style={{ borderColor: 'var(--border-soft)' }}>
              {[
                { action: '新建文档', keys: ['⌘', 'N'] },
                { action: '保存', keys: ['⌘', 'S'] },
                { action: '全局搜索', keys: [prefs.kbdSearch || '⌘K'] },
                { action: '命令面板', keys: [prefs.kbdCommand || '⌘⇧P'] },
                { action: '切换预览模式', keys: ['⌘', 'P'] },
                { action: '切换侧边栏', keys: ['⌘', 'B'] },
                { action: '撤销', keys: ['⌘', 'Z'] },
                { action: '重做', keys: ['⌘', '⇧', 'Z'] },
              ].map((s) => (
                <tr key={s.action} className="hover:bg-neutral-50/60">
                  <td className="px-4 py-2.5 text-xs text-neutral-800">{s.action}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      {s.keys.map((k, ki) => (
                        <span key={ki} className="inline-flex items-center">
                          <kbd className="px-1.5 py-0.5 rounded border font-mono text-[11px] text-neutral-700 shadow-sm"
                            style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}>
                            {k}
                          </kbd>
                          {ki < s.keys.length - 1 && <span className="text-neutral-400 mx-0.5">+</span>}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* TODO: 全局快捷键体系尚未接入（上表为规划规格），自定义绑定待后续版本开放 */}
        <p className="text-[11px] text-neutral-400 mt-2">快捷键自定义将于后续版本开放</p>
      </div>
    </Section>
  );
}

function AboutSection(): React.ReactElement {
  return (
    <Section title="关于 / 帮助" desc="版本信息、数据导出与危险操作" icon={<Settings2 size={15} />}>
      <div className="flex items-center gap-4 p-4 rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-sm">
          EW
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-900">Ewiki 文档空间</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            协作式 Markdown 项目 · v0.1.0 · 早期预览
          </div>
        </div>
        <Sparkles size={18} className="text-neutral-300 shrink-0" />
      </div>
      <div className="mt-4 flex gap-3">
        <button type="button" disabled className="btn-secondary !h-8 !text-xs disabled:opacity-50">
          检查更新
        </button>
        <button type="button" disabled className="btn-secondary !h-8 !text-xs disabled:opacity-50">
          开源许可
        </button>
      </div>

      {/* 帮助链接（对齐原型 Settings.jsx:539-556；站点页面未建，先禁用占位） */}
      {/* TODO: 帮助中心 / 更新日志等外部站点上线后补 href */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {['帮助中心', '联系支持', '更新日志', '隐私与条款'].map((label) => (
          <button key={label} type="button" disabled
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 text-xs text-neutral-500 disabled:opacity-60 disabled:cursor-not-allowed text-left">
            <Globe size={13} className="text-neutral-400" />
            <span>{label}</span>
            <ChevronRight size={13} className="ml-auto text-neutral-300" />
          </button>
        ))}
      </div>

      {/* 导出数据（对齐原型 :559-567；导出端点未实现，禁用占位） */}
      {/* TODO: 后端导出 ZIP 备份端点未实现 */}
      <div className="mt-4 flex items-center justify-between p-4 rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
        <div>
          <div className="text-xs font-semibold text-neutral-800">导出你的数据</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">生成包含所有文档与设置的备份（即将上线）</div>
        </div>
        <button type="button" disabled className="btn-secondary !h-8 !text-xs disabled:opacity-50">
          导出数据
        </button>
      </div>

      {/* 危险区：注销账号（对齐原型 :570-583；账号删除端点未实现，禁用占位；退出登录在下方账号区可用） */}
      {/* TODO: 后端账号注销端点未实现 */}
      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/50 p-4">
        <div className="flex items-start gap-3 mb-3">
          <Trash2 size={16} className="text-rose-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-rose-800">危险操作</div>
            <div className="text-[11px] text-rose-700/80 mt-1">
              注销账号将移除你的个人数据，此操作不可撤销（即将上线）
            </div>
          </div>
        </div>
        <button type="button" disabled className="btn-danger !h-8 !text-xs disabled:opacity-50">
          <LogOut size={12} /> 注销账号
        </button>
      </div>
    </Section>
  );
}

function AccountActionsSection(): React.ReactElement {
  const logout = useMutation({
    mutationFn: async () => {
      tokenStore.clear();
      window.location.href = '/login';
    },
  });

  return (
    <Section title="账户" desc="注销与账户数据" icon={<User size={15} />}>
      <div className="flex items-center justify-between py-2">
        <div>
          <div className="text-xs font-medium text-neutral-800">注销登录</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">清除本地会话并返回登录页</div>
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="btn-secondary !h-8 !text-xs !bg-white !text-neutral-700 !border-neutral-200 hover:!bg-neutral-100"
        >
          <LogOut size={12} /> 注销
        </button>
      </div>
      <div className="flex items-center justify-between py-2 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <div>
          <div className="text-xs font-medium text-rose-600">清除本地偏好</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">清除本地缓存偏好（下次进入将自动从云端恢复）</div>
        </div>
        <button
          type="button"
          onClick={() => localStorage.removeItem(PREFS_KEY)}
          className="btn-danger !h-8 !text-xs"
        >
          <Trash2 size={12} /> 清除
        </button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${checked ? 'bg-primary-600' : 'bg-neutral-200'}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function NotificationToggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs font-medium text-neutral-800">{label}</div>
        <div className="text-[11px] text-neutral-500 mt-0.5">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// 左侧分区导航（对齐原型 Settings.jsx:622-629；账户危险操作并入「关于」；
// 「API 令牌」为开放 API 机器身份管理，OPEN-API-MCP-DESIGN §6.1）
const SETTINGS_TABS = [
  { key: 'profile', label: '个人资料', Icon: User },
  { key: 'appearance', label: '外观与主题', Icon: Palette },
  { key: 'notifications', label: '通知', Icon: Bell },
  { key: 'storage', label: '存储默认', Icon: HardDrive },
  { key: 'tokens', label: 'API 令牌', Icon: KeyRound },
  { key: 'shortcuts', label: '快捷键', Icon: Keyboard },
  { key: 'about', label: '关于 / 帮助', Icon: Settings2 },
] as const;
type SettingsTabKey = (typeof SETTINGS_TABS)[number]['key'];

export function SettingsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('profile');
  const { data: user, isLoading } = useQuery<MeUser>({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeUser>('/api/v1/me'),
  });

  const { applyAppearance } = useTheme();

  const [prefs, setPrefs] = useState<UserPrefs>(() => loadPrefs());

  // 云端偏好：首载拉取，与本地缓存合并（服务端为准）
  const { data: cloudPrefs } = useQuery<{ prefs: Record<string, unknown> | null }>({
    queryKey: ['me-prefs'],
    queryFn: () => apiFetch<{ prefs: Record<string, unknown> | null }>('/api/v1/me/prefs'),
  });
  useEffect(() => {
    const remote = cloudPrefs?.prefs;
    if (!remote || typeof remote !== 'object') return;
    setPrefs((prev) => {
      const merged = { ...prev, ...(remote as Partial<UserPrefs>) };
      return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged;
    });
  }, [cloudPrefs]);

  // 双写：本地即时缓存 + 云端持久化（不 invalidate，避免 refetch 回环）
  // 保存成功 toast（对齐原型 Settings.jsx:634-639「已保存更改」，2s 自动消失）；
  // 首跑守卫：挂载/云端合并触发的自动 PUT 不弹 toast，仅用户改动后提示
  // （守卫按次捕获：mutate 与 onSuccess 异步错峰，不能用共享 ref 判断）
  const [toast, setToast] = useState<string | null>(null);
  const firstSaveRef = useRef(true);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);
  const saveCloud = useMutation({
    mutationFn: (p: UserPrefs) =>
      apiFetch('/api/v1/me/prefs', { method: 'PUT', body: JSON.stringify({ prefs: p }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  useEffect(() => {
    applyAppearance(prefs.theme);
    savePrefs(prefs);
    const isFirstSave = firstSaveRef.current;
    firstSaveRef.current = false;
    saveCloud.mutate(prefs, {
      onSuccess: () => { if (!isFirstSave) setToast('设置已保存'); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      {/* 左侧 240px 分区导航 + 右侧单屏切换（对齐原型 Settings.jsx:640-688） */}
      <div className="flex h-full">
        <aside
          className="hidden w-60 shrink-0 overflow-y-auto scrollbar-thin border-r p-5 md:block"
          style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-surface)' }}
        >
          <div className="mb-6 flex items-center gap-2">
            <div className="rounded-lg bg-primary-50 p-1.5 text-primary-600">
              <Settings2 size={16} />
            </div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h1>
          </div>
          <nav className="space-y-0.5">
            {SETTINGS_TABS.map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <Icon size={16} className={active ? 'text-primary-600' : 'text-[var(--text-muted,#94a3b8)]'} />
                  <span className="flex-1 text-left">{label}</span>
                  {active && <ChevronRight size={15} className="text-primary-600" />}
                </button>
              );
            })}
          </nav>
          <div className="mt-8 rounded-md border p-3" style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-hover)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Sparkles size={13} />
              Ewiki v0.1.0 · 早期预览
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-2xl px-6 py-6">
            {/* 移动端无侧栏时提供 tab 横向切换 */}
            <div className="mb-5 flex gap-1 overflow-x-auto scrollbar-thin md:hidden">
              {SETTINGS_TABS.map(({ key, label, Icon }) => {
                const active = activeTab === key;
                return (
                  <button key={key} type="button" onClick={() => setActiveTab(key)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md py-1.5 text-xs font-medium ${
                      active
                        ? 'bg-primary-50 text-primary-700'
                        : 'border border-[var(--border-soft)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                    } px-3`}>
                    <Icon size={13} /> {label}
                  </button>
                );
              })}
            </div>

            <div className="mb-6">
              <div className="mb-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                <Settings2 size={13} />
                <span>个人设置</span>
              </div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {SETTINGS_TABS.find((t) => t.key === activeTab)?.label ?? '设置'}
              </h1>
            </div>

            {isLoading ? (
              <div className="card space-y-3 p-6">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-5 animate-fade-up" key={activeTab}>
                {activeTab === 'profile' && (
                  <ProfileSection user={user} />
                )}
                {activeTab === 'appearance' && (
                  <AppearanceSection prefs={prefs} setPrefs={setPrefs} />
                )}
                {activeTab === 'notifications' && (
                  <NotificationsSection prefs={prefs} setPrefs={setPrefs} />
                )}
                {activeTab === 'storage' && (
                  <StorageDefaultsSection prefs={prefs} setPrefs={setPrefs} />
                )}
                {activeTab === 'tokens' && <TokenSettings />}
                {activeTab === 'shortcuts' && (
                  <KeyboardSection prefs={prefs} setPrefs={setPrefs} />
                )}
                {activeTab === 'about' && (
                  <>
                    <AboutSection />
                    {/* 注销/清缓存属账户危险操作，原型归入「关于 / 帮助」（Settings.jsx:576-581） */}
                    <AccountActionsSection />
                  </>
                )}
              </div>
            )}

            <p className="mt-6 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>
              <Eye size={11} /> 个人偏好（主题/外观/快捷键）已同步至云端账号，localStorage 仅作离线缓存
            </p>
          </div>
        </main>
      </div>
      {toast && <HeaderToast message={toast} />}
    </div>
  );
}
