// ---------------------------------------------------------------------------
// 目录树交互组件（右键/悬浮菜单 + 弹窗套件）：
//   TreeContextMenu —— fixed 定位、视口边界收敛、Esc/外点/滚动/失焦关闭
//   TreeDialog      —— 轻量遮罩弹窗（对齐 ProjectLayout 重命名弹窗样式）
//   RenameDialog    —— 单输入框重命名（文档标题 / 文件夹名）
//   ConfirmDialog   —— 危险操作确认（删除文档 / 删除文件夹）
//   MoveToDialog    —— 目标文件夹选择器（移动到…）
// 供 BrowsePage.TreeSidebar 复用；样式走主题令牌，深浅色自适应。
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Folder, FolderKanban, type LucideIcon } from 'lucide-react';

/** 新建文本/代码文件可选扩展名（均为 shared 类型注册表内的文本类型，§4.5） */
const TEXT_EXTENSIONS = ['txt', 'json', 'csv', 'js', 'ts', 'py', 'sh', 'yml', 'yaml', 'xml', 'html', 'css', 'log', 'ini'] as const;

/** 文件名非法字符（服务端 normalizeTreePath 同样拦截，前端先给即时反馈） */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/;

/** 按选定扩展名补全文件名：已带扩展名（含 .keep 等点文件）则原样保留 */
function withExtension(name: string, ext: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith('.')) return trimmed;
  return trimmed.includes('.') ? trimmed : `${trimmed}.${ext}`;
}

/** 文件夹名 → slug（小写字母/数字/中文，其余折叠为连字符） */
function slugifyFolder(name: string): string {
  return name.toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// 右键 / 悬浮菜单
// ---------------------------------------------------------------------------

export interface TreeMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** 在该项上方渲染分隔条（用于把不相关的菜单项分组） */
  dividerAbove?: boolean;
  onSelect: () => void;
}

export function TreeContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: TreeMenuItem[];
  onClose: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 视口边界收敛：右/下溢出时回收，下方空间不足时向上翻转
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let nx = x;
    let ny = y;
    if (x + rect.width + pad > window.innerWidth) nx = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height + pad > window.innerHeight) ny = Math.max(pad, y - rect.height);
    setPos({ x: nx, y: ny });
  }, [x, y, items.length]);

  useEffect(() => {
    function handleDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    function handleScroll(e: Event): void {
      // 菜单自身内部滚动不关闭；外部任意滚动即关闭（锚点已失真）
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('keydown', handleKey);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-52 rounded-lg border py-1.5 shadow-lg animate-fade-up"
      style={{ left: pos.x, top: pos.y, background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.key}>
            {item.dividerAbove && <div className="my-1.5 border-t" style={{ borderColor: 'var(--border-soft)' }} />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { onClose(); item.onSelect(); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? 'hover:bg-rose-50' : 'hover:bg-neutral-50'
              }`}
              style={{ color: item.danger ? '#ef4444' : 'var(--text-secondary)' }}
            >
              {Icon && <Icon size={14} className="shrink-0" style={{ color: item.danger ? '#ef4444' : 'var(--text-muted)' }} />}
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 弹窗套件
// ---------------------------------------------------------------------------

function TreeDialog({ title, children, onClose, maxWidth = 'max-w-sm' }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`card w-full ${maxWidth} p-5 shadow-xl animate-fade-up`}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function RenameDialog({ title, label, initialValue, confirmText = '保存', busy, error, onCancel, onConfirm }: {
  title: string;
  label?: string;
  initialValue: string;
  confirmText?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);
  const trimmed = value.trim();
  const submit = (): void => { if (trimmed && !busy) onConfirm(trimmed); };
  return (
    <TreeDialog title={title} onClose={onCancel}>
      {label && <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>}
      <input
        className={`input ${label ? 'mt-1.5' : 'mt-3'}`}
        value={value}
        autoFocus
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      />
      {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary !h-8 !text-xs" onClick={onCancel}>取消</button>
        <button type="button" className="btn-primary !h-8 !text-xs disabled:opacity-50"
          disabled={!trimmed || busy} onClick={submit}>
          {busy ? '处理中…' : confirmText}
        </button>
      </div>
    </TreeDialog>
  );
}

export function ConfirmDialog({ title, message, confirmText = '删除', busy, onCancel, onConfirm }: {
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  return (
    <TreeDialog title={title} onClose={onCancel}>
      <div className="mt-2.5 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{message}</div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary !h-8 !text-xs" onClick={onCancel}>取消</button>
        <button type="button" className="btn-primary !h-8 !text-xs hover:opacity-90 disabled:opacity-50"
          style={{ background: '#ef4444' }} disabled={busy} onClick={onConfirm}>
          {busy ? '处理中…' : confirmText}
        </button>
      </div>
    </TreeDialog>
  );
}

export function MoveToDialog({ folders, currentFolder, busy, error, onCancel, onConfirm }: {
  /** 项目内全部文件夹路径（不含根），已排序 */
  folders: string[];
  /** 当前位置：'' = 根目录 */
  currentFolder: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (targetFolder: string) => void;
}): React.ReactElement {
  const [target, setTarget] = useState(currentFolder);
  const rowCls = (active: boolean): string =>
    `flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition ${
      active ? 'bg-primary-50 font-medium text-primary-700' : 'text-[var(--text-secondary)] hover:bg-neutral-50'
    }`;
  return (
    <TreeDialog title="移动到…" onClose={onCancel} maxWidth="max-w-md">
      <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        选择目标文件夹（当前位于{currentFolder ? `「${currentFolder}」` : '根目录'}）
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto scrollbar-thin rounded-md border p-1" style={{ borderColor: 'var(--border-soft)' }}>
        <button type="button" onClick={() => setTarget('')} className={rowCls(target === '')}>
          <FolderKanban size={13} className="shrink-0 text-primary-500" />
          <span className="truncate">根目录</span>
        </button>
        {folders.map((f) => (
          <button key={f} type="button" onClick={() => setTarget(f)} className={rowCls(target === f)}
            style={{ paddingLeft: `${8 + (f.split('/').length - 1) * 14}px` }}>
            <Folder size={13} className="shrink-0 text-primary-500" />
            <span className="truncate">{f}</span>
          </button>
        ))}
      </div>
      {folders.length === 0 && (
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>当前项目还没有文件夹，可先通过「新建文件夹」创建</div>
      )}
      {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary !h-8 !text-xs" onClick={onCancel}>取消</button>
        <button type="button" className="btn-primary !h-8 !text-xs disabled:opacity-50"
          disabled={busy || target === currentFolder} onClick={() => onConfirm(target)}>
          {busy ? '移动中…' : '移动到此处'}
        </button>
      </div>
    </TreeDialog>
  );
}

// ---------------------------------------------------------------------------
// 新建文件 / 新建文件夹
// ---------------------------------------------------------------------------

export function NewFileDialog({ mode, targetFolder, busy, error, onCancel, onConfirm }: {
  /** markdown = 新建 Markdown 文档（默认补 .md）；text = 新建文本/代码文件（选择扩展名） */
  mode: 'markdown' | 'text';
  /** 目标文件夹（'' = 根目录），仅用于提示展示 */
  targetFolder: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** 返回完整文件名（含扩展名），由父组件拼目标文件夹路径后提交 */
  onConfirm: (fileName: string) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [ext, setExt] = useState<string>(mode === 'markdown' ? 'md' : 'txt');
  const finalName = withExtension(name, ext);
  const invalid = !!name.trim() && ILLEGAL_NAME_CHARS.test(name);
  const canSubmit = !!finalName && !invalid;

  const submit = (): void => {
    if (canSubmit && !busy) onConfirm(finalName);
  };

  return (
    <TreeDialog title={mode === 'markdown' ? '新建 Markdown 文档' : '新建文本 / 代码文件'} onClose={onCancel}>
      <div className="mt-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        位置：{targetFolder ? `「${targetFolder}」` : '根目录'}
      </div>
      <input
        className="input mt-2"
        placeholder={mode === 'markdown' ? '文件名（可不带 .md 扩展名）' : '文件名（未带扩展名时按所选类型补齐）'}
        value={name}
        autoFocus
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      />
      {mode === 'text' && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {TEXT_EXTENSIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setExt(e)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition ${
                ext === e ? 'border-primary-400 bg-primary-50 text-primary-700' : 'text-neutral-500 hover:bg-neutral-50'
              }`}
              style={ext === e ? undefined : { borderColor: 'var(--border-soft)' }}
            >
              .{e}
            </button>
          ))}
        </div>
      )}
      {invalid ? (
        <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>文件名不能包含 \\ / : * ? " &lt; &gt; | 字符</p>
      ) : finalName ? (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          将创建：<span className="font-mono">{targetFolder ? `${targetFolder}/` : ''}{finalName}</span>
        </p>
      ) : null}
      {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary !h-8 !text-xs" onClick={onCancel}>取消</button>
        <button type="button" className="btn-primary !h-8 !text-xs disabled:opacity-50" disabled={!canSubmit || busy} onClick={submit}>
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </TreeDialog>
  );
}

export function NewFolderDialog({ busy, error, onCancel, onConfirm }: {
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** 返回原始文件夹名，slug 化由父组件完成（与重命名文件夹同规则） */
  onConfirm: (folderName: string) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const slug = slugifyFolder(name);
  const invalid = !!name.trim() && (ILLEGAL_NAME_CHARS.test(name) || !slug);

  const submit = (): void => {
    if (slug && !invalid && !busy) onConfirm(name.trim());
  };

  return (
    <TreeDialog title="新建文件夹" onClose={onCancel}>
      <input
        className="input mt-3"
        placeholder="文件夹名称"
        value={name}
        autoFocus
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
      />
      {invalid ? (
        <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>名称不合法：仅支持字母、数字、中文（连字符/空格会折叠为 -）</p>
      ) : slug ? (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          将创建 <span className="font-mono">{slug}/</span>，内含空占位文件 <span className="font-mono">.keep</span> 使目录在树中可见
        </p>
      ) : null}
      {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary !h-8 !text-xs" onClick={onCancel}>取消</button>
        <button type="button" className="btn-primary !h-8 !text-xs disabled:opacity-50" disabled={!slug || invalid || busy} onClick={submit}>
          {busy ? '创建中…' : '创建文件夹'}
        </button>
      </div>
    </TreeDialog>
  );
}
