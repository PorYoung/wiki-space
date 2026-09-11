import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Database, Eye, EyeOff, FolderOpen, GitBranch, Globe,
  KeyRound, Link2, Plus, RefreshCw, Save, Settings, Trash2, X, XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api/client';

// ---------------------------------------------------------------------------
// Types —— 与后端 /api/v1/sources 的 {items} 结构对齐
//   后端类型枚举：git | local | web | database（packages/shared/schemas）
//   URL/路径存于 configPublic（git→{url}、local→{path}），
//   凭据在 configEncrypted（GET 不下发，前端只能知道「是否已配置」）。
// ---------------------------------------------------------------------------

type SourceType = 'git' | 'local' | 'web' | 'database';
type SourceStatus = 'connected' | 'synced' | 'syncing' | 'error';

interface Source {
  id: string;
  projectId: string;
  type: SourceType;
  name: string;
  configPublic: Record<string, unknown>;
  defaultBranch: string | null;
  autoSync: boolean;
  intervalSeconds: number;
  status: SourceStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  projectName?: string;
}

interface ItemsResp<T> {
  items: T[];
}

interface ProjectOption {
  id: string;
  name: string;
}

interface SourceForm {
  projectId: string;
  name: string;
  type: SourceType;
  url: string;
  branch: string;
  token: string;
  autoSync: boolean;
  syncInterval: SyncIntervalKey;
  // Git 认证三选（PLAN 5.2 前端占位，原型 Sources.jsx:63-68/1240-1320）
  authMethod: GitAuthMethod;
  sshKey: string;
  // database 完整表单（原型 Sources.jsx:1324-1420）
  dbType: string;
  host: string;
  port: string;
  database: string;
  table: string;
  dbUsername: string;
  dbPassword: string;
}

// Git 认证方式（原型 Sources.jsx:63-68）；oauth 依赖 GitHub App/GitLab App 集成，暂不提供表单
const GIT_AUTH_METHODS: Array<{ key: GitAuthMethod; label: string; desc: string }> = [
  { key: 'token', label: 'Access Token', desc: '个人访问令牌，最常用' },
  { key: 'ssh', label: 'SSH Key', desc: '密钥对认证，免密' },
  { key: 'oauth', label: 'OAuth / App', desc: 'GitHub App / GitLab App' },
];
type GitAuthMethod = 'token' | 'ssh' | 'oauth';

// 数据库类型（原型 Sources.jsx:72-85）；同步 worker 暂未支持 database 类型（SDD 5.1 TODO），
// 表单字段存入 configPublic/configSecret（自由 record），能力落地后直接消费
const DATABASE_TYPES: Array<{ key: string; label: string; defaultPort: number | null; category: 'relational' | 'document'; icon: string }> = [
  { key: 'mysql', label: 'MySQL', defaultPort: 3306, category: 'relational', icon: '🐬' },
  { key: 'postgresql', label: 'PostgreSQL', defaultPort: 5432, category: 'relational', icon: '🐘' },
  { key: 'sqlite', label: 'SQLite', defaultPort: null, category: 'relational', icon: '🗄️' },
  { key: 'mariadb', label: 'MariaDB', defaultPort: 3306, category: 'relational', icon: '🐬' },
  { key: 'sqlserver', label: 'SQL Server', defaultPort: 1433, category: 'relational', icon: '🟦' },
  { key: 'mongodb', label: 'MongoDB', defaultPort: 27017, category: 'document', icon: '🍃' },
  { key: 'couchdb', label: 'CouchDB', defaultPort: 5984, category: 'document', icon: '🛋️' },
  { key: 'cosmosdb', label: 'Cosmos DB', defaultPort: null, category: 'document', icon: '🌌' },
  { key: 'ravendb', label: 'RavenDB', defaultPort: 8080, category: 'document', icon: '🦅' },
  { key: 'elasticsearch', label: 'Elasticsearch', defaultPort: 9200, category: 'document', icon: '🔎' },
];
const DB_CATEGORY_LABEL: Record<string, string> = {
  relational: '关系型数据库',
  document: '文档 / 对象数据库',
};

// 同步间隔档位（PLAN 5.1.3，对齐原型 Sources.jsx:1450-1477）：30m/1h/6h/手动
type SyncIntervalKey = '30m' | '1h' | '6h' | 'manual';
const SYNC_INTERVALS: Array<{ key: SyncIntervalKey; label: string; seconds: number }> = [
  { key: '30m', label: '30 分钟', seconds: 30 * 60 },
  { key: '1h', label: '1 小时', seconds: 60 * 60 },
  { key: '6h', label: '6 小时', seconds: 6 * 60 * 60 },
  { key: 'manual', label: '手动', seconds: 0 },
];

// intervalSeconds → 档位 key（设置弹窗回显用；非预设值归入最近档，保存时按档位规范化）
function presetFromSeconds(seconds: number): SyncIntervalKey {
  if (seconds <= 0) return 'manual';
  const hit = SYNC_INTERVALS.find((i) => i.seconds > 0 && i.seconds === seconds);
  if (hit) return hit.key;
  if (seconds < 45 * 60) return '30m';
  if (seconds < 3 * 60 * 60) return '1h';
  return '6h';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '从未同步';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// 从 configPublic 取展示用地址：git→url / local→path / 其余 url|host 兜底
function sourceUrl(s: Source): string {
  const pub = (s.configPublic ?? {}) as Record<string, string | undefined>;
  if (s.type === 'git') return pub.url ?? '—';
  if (s.type === 'local') return pub.path ?? '—';
  if (pub.url) return pub.url;
  if (pub.host) return `${pub.host}${pub.port ? ':' + pub.port : ''}`;
  return '—';
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SOURCE_TYPE_META: Record<SourceType, { Icon: typeof GitBranch; label: string; tagClass: string; boxCls: string }> = {
  git: { Icon: GitBranch, label: 'Git 仓库', tagClass: 'tag-primary', boxCls: 'bg-primary-50 text-primary-600' },
  local: { Icon: FolderOpen, label: '本地文件夹', tagClass: 'tag-neutral', boxCls: 'bg-neutral-100 text-neutral-600' },
  web: { Icon: Globe, label: '网页链接', tagClass: 'tag-neutral', boxCls: 'bg-neutral-100 text-neutral-600' },
  database: { Icon: Database, label: '数据库', tagClass: 'tag-success', boxCls: 'bg-emerald-50 text-emerald-600' },
};

// 分类卡片区（4 张横滚卡，点击直接打开对应类型的添加弹窗）
const SOURCE_TYPE_CATEGORIES: Array<{ type: SourceType; Icon: typeof GitBranch; label: string; desc: string }> = [
  { type: 'git', Icon: GitBranch, label: 'Git 仓库', desc: 'GitHub / GitLab / Gitee 等' },
  { type: 'database', Icon: Database, label: '数据库', desc: 'MySQL / PostgreSQL / MongoDB 等' },
  { type: 'local', Icon: FolderOpen, label: '本地文件夹', desc: '本地磁盘目录' },
  { type: 'web', Icon: Globe, label: '网页链接', desc: '抓取在线文档页面' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SourceTypeBadge({ type }: { type: SourceType }): React.ReactElement {
  const meta = SOURCE_TYPE_META[type] ?? SOURCE_TYPE_META.local;
  const Icon = meta.Icon;
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${meta.boxCls}`}>
      <Icon size={16} />
    </div>
  );
}

function StatusTag({ status, syncing }: { status: SourceStatus; syncing: boolean }): React.ReactElement {
  if (syncing || status === 'syncing') {
    return <span className="tag tag-primary inline-flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />同步中</span>;
  }
  switch (status) {
    case 'connected':
    case 'synced':
      return <span className="tag tag-success inline-flex items-center gap-1"><CheckCircle2 size={12} />已连接</span>;
    case 'error':
      return <span className="tag tag-danger inline-flex items-center gap-1"><AlertTriangle size={12} />连接错误</span>;
    default:
      return <span className="tag tag-neutral inline-flex items-center gap-1"><XCircle size={12} />未知</span>;
  }
}

function SourcesListSkeleton(): React.ReactElement {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.4fr_120px_1.4fr_120px_130px_150px] gap-4 border-b bg-neutral-50 px-5 py-3"
        style={{ borderColor: 'var(--border-soft)' }}>
        {[16, 10, 12, 10, 14].map((w, i) => (
          <div key={i} className="skeleton h-3" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i}
          className="grid grid-cols-[1.4fr_120px_1.4fr_120px_130px_150px] items-center gap-4 border-b px-5 py-4 last:border-0"
          style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center gap-2.5">
            <div className="skeleton h-8 w-8 rounded-md" />
            <div className="space-y-1.5">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-3 w-20" />
            </div>
          </div>
          <div className="skeleton h-5 w-16 rounded-md" />
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-5 w-14 rounded-md" />
          <div className="skeleton h-4 w-16" />
          <div className="flex justify-end gap-1.5">
            <div className="skeleton h-8 w-8 rounded-md" />
            <div className="skeleton h-8 w-8 rounded-md" />
            <div className="skeleton h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }): React.ReactElement {
  return (
    <div className="card flex flex-col items-center p-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary-500">
        <Database size={28} />
      </div>
      <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>还没有连接任何数据源</h3>
      <p className="mt-1 max-w-sm text-sm" style={{ color: 'var(--text-muted)' }}>
        从 Git 仓库、数据库、本地文件夹或网页链接连接一个源，系统会自动同步并纳入你的知识资产。
      </p>
      <button className="btn-primary mt-5" onClick={onAdd}>
        <Plus size={16} />
        添加第一个源
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddSourceModal —— 对齐后端 POST /api/v1/sources：
//   body: { projectId, type, name, configPublic:{url|path}, defaultBranch, configSecret:{token}, autoSync }
//   web/database 两类同步尚未实现（worker SDD 5.1 TODO），类型卡保留但提交时提示。
// ---------------------------------------------------------------------------

function AddSourceModal({ initialType, projects, onClose, onSubmit, submitting }: {
  initialType: SourceType;
  projects: ProjectOption[];
  onClose: () => void;
  onSubmit: (form: SourceForm) => void;
  submitting?: boolean;
}): React.ReactElement {
  const [type, setType] = useState<SourceType>(initialType);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [name, setName] = useState('');
  const [autoSync, setAutoSync] = useState(false);
  const [syncInterval, setSyncInterval] = useState<SyncIntervalKey>('1h');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  // Git 认证三选 + database 完整表单（PLAN 5.2 前端占位）
  const [authMethod, setAuthMethod] = useState<GitAuthMethod>('token');
  const [sshKey, setSshKey] = useState('');
  const [dbType, setDbType] = useState('mysql');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState('');
  const [table, setTable] = useState('');
  const [dbUsername, setDbUsername] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [showDbPassword, setShowDbPassword] = useState(false);

  function handleBackdropClick(e: React.MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function pickDbType(key: string): void {
    setDbType(key);
    // 切换数据库类型自动回填默认端口（对齐原型 defaultPort 行为）
    const def = DATABASE_TYPES.find((d) => d.key === key)?.defaultPort;
    if (def) setPort(String(def));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSubmit({
      projectId, name, type, url: url.trim(), branch: branch.trim() || 'main', token: token.trim(), autoSync, syncInterval,
      authMethod, sshKey: sshKey.trim(),
      dbType, host: host.trim(), port: port.trim(), database: database.trim(), table: table.trim(),
      dbUsername: dbUsername.trim(), dbPassword: dbPassword.trim(),
    });
  }

  const isGit = type === 'git';
  const isLocal = type === 'local';
  const isDb = type === 'database';
  const isPendingType = type === 'web' || type === 'database';
  const TypeIcon = SOURCE_TYPE_META[type].Icon;
  const urlLabel = isGit ? '仓库 URL' : isLocal ? '文件夹路径' : 'URL';
  const urlPlaceholder = isGit
    ? 'https://github.com/org/repo.git'
    : isLocal
      ? '/Users/you/Documents/wiki'
      : 'https://example.com/docs';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={handleBackdropClick}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto shadow-xl animate-fade-up">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <TypeIcon size={18} />
            </div>
            <div>
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>添加数据源</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>选择类型并填写连接信息</p>
            </div>
          </div>
          <button className="btn-ghost !p-2" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {/* Type selector */}
          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>数据源类型</label>
            <div className="grid grid-cols-4 gap-2">
              {SOURCE_TYPE_CATEGORIES.map((cat) => {
                const Icon = cat.Icon;
                const active = type === cat.type;
                // 选中态用 primary 类（暗色覆盖层可命中）；未选中用语义变量（随暗色自动翻转）
                return (
                  <button key={cat.type} type="button"
                    onClick={() => setType(cat.type)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition ${
                      active
                        ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200'
                        : 'border-[var(--border-soft)] hover:bg-neutral-50'
                    }`}>
                    <Icon size={18} className={active ? 'text-primary-600' : 'text-[var(--text-muted)]'} />
                    <span className={`text-[11px] font-medium ${active ? 'text-primary-700' : 'text-[var(--text-secondary)]'}`}>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 归属项目 + 名称 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>归属文档库 <span className="text-danger">*</span></label>
              <select className="input cursor-pointer appearance-none"
                value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>名称 <span className="text-danger">*</span></label>
              <input className="input" placeholder="给这个源起个名字…"
                value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>

          {/* 地址（database 类型由 host/port 连接信息替代，见下方数据库配置区） */}
          {!isDb && (
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{urlLabel} <span className="text-danger">*</span></label>
              <input className="input font-mono" placeholder={urlPlaceholder}
                value={url} onChange={(e) => setUrl(e.target.value)} required={!isDb} />
            </div>
          )}

          {/* Git 专属：分支 + 认证三选 + 凭据（PLAN 5.2 前端占位，原型 Sources.jsx:1236-1320） */}
          {isGit && (
            <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}>
                <GitBranch size={12} /> Git 仓库配置
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>分支</label>
                <input className="input font-mono" placeholder="main"
                  value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>认证方式</label>
                <div className="grid grid-cols-3 gap-2">
                  {GIT_AUTH_METHODS.map((m) => {
                    const active = authMethod === m.key;
                    return (
                      <button key={m.key} type="button" onClick={() => setAuthMethod(m.key)}
                        className={`rounded-lg border p-2.5 text-left transition ${
                          active
                            ? 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                            : 'border-[var(--border-soft)] hover:bg-neutral-50'
                        }`}
                        style={!active ? { color: 'var(--text-secondary)' } : undefined}>
                        <div className="flex items-center gap-1.5 text-xs font-semibold">{m.label}</div>
                        <div className="mt-0.5 text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {authMethod === 'token' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Access Token <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>（私有仓库必填，加密存储）</span>
                  </label>
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input type={showToken ? 'text' : 'password'} className="input pl-9 pr-10 font-mono"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      value={token} onChange={(e) => setToken(e.target.value)} />
                    <button type="button" onClick={() => setShowToken((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-muted)' }}>
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              )}
              {authMethod === 'ssh' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>私钥内容 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>（加密存储）</span></label>
                  <textarea rows={4} className="input resize-none font-mono text-xs"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={sshKey} onChange={(e) => setSshKey(e.target.value)} />
                </div>
              )}
              {authMethod === 'oauth' && (
                // TODO(5.2)：OAuth App 授权流依赖 GitHub App/GitLab App 集成，落地后接入
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  OAuth App 授权即将上线，当前可先用 Access Token 认证。
                </div>
              )}
            </div>
          )}

          {/* database 完整连接配置（PLAN 5.2 前端占位，原型 Sources.jsx:1324-1420；同步能力见下方声明） */}
          {isDb && (
            <div className="space-y-4 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <Database size={12} /> 数据库连接配置
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>数据库类型</label>
                <div className="space-y-2">
                  {(['relational', 'document'] as const).map((cat) => (
                    <div key={cat}>
                      <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{DB_CATEGORY_LABEL[cat]}</div>
                      <div className="grid grid-cols-4 gap-1.5 md:grid-cols-5">
                        {DATABASE_TYPES.filter((d) => d.category === cat).map((db) => {
                          const active = dbType === db.key;
                          return (
                            <button key={db.key} type="button" onClick={() => pickDbType(db.key)}
                              className={`rounded-md border px-1 py-1.5 text-center text-[11px] font-medium transition ${
                                active
                                  ? 'border-success bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                  : 'border-[var(--border-soft)] hover:bg-neutral-50'
                              }`}
                              style={!active ? { color: 'var(--text-secondary)' } : undefined}>
                              <span>{db.icon}</span> {db.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>主机 <span className="text-danger">*</span></label>
                  <input className="input font-mono" placeholder="localhost / 10.0.0.1"
                    value={host} onChange={(e) => setHost(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>端口</label>
                  <input className="input font-mono" placeholder="3306"
                    value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>数据库 <span className="text-danger">*</span></label>
                  <input className="input font-mono" placeholder="docvault"
                    value={database} onChange={(e) => setDatabase(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>表 / 集合</label>
                  <input className="input font-mono" placeholder="articles"
                    value={table} onChange={(e) => setTable(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>用户名</label>
                  <input className="input font-mono" placeholder="reader"
                    value={dbUsername} onChange={(e) => setDbUsername(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>密码 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>（加密存储）</span></label>
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input type={showDbPassword ? 'text' : 'password'} className="input pl-9 pr-10 font-mono"
                      placeholder="••••••••"
                      value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} autoComplete="new-password" />
                    <button type="button" onClick={() => setShowDbPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-muted)' }}>
                      {showDbPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* web/database 同步能力裁剪声明（worker 尚未实现，SDD 5.1 TODO） */}
          {isPendingType && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              该类型的自动同步尚未上线（网页抓取 / 数据库快照在路线图中），当前可先创建登记，同步能力落地后自动生效。
            </div>
          )}

          {/* 自动同步 + 间隔档位（PLAN 5.1.3，对齐原型 Sources.jsx:1450-1477） */}
          <div className="space-y-2.5">
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={autoSync} onChange={(e) => {
                setAutoSync(e.target.checked);
                if (e.target.checked && syncInterval === 'manual') setSyncInterval('1h');
              }}
                className="h-4 w-4 accent-primary-500" />
              自动同步
            </label>
            {autoSync && (
              <div className="grid grid-cols-4 gap-2">
                {SYNC_INTERVALS.map((o) => (
                  <button key={o.key} type="button"
                    onClick={() => setSyncInterval(o.key)}
                    className={`py-1.5 rounded-md text-xs font-medium border transition ${
                      syncInterval === o.key
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-[var(--border-soft)] text-[var(--text-secondary)] hover:bg-neutral-50'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting || !projectId}>
              <Plus size={16} />
              {submitting ? '添加中…' : '添加数据源'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceSettingsModal —— 只读展示 URL/分支/鉴权状态，可改名称/自动同步/更新 Token
//   后端 PATCH /api/v1/sources/:id 仅支持 name / autoSync / intervalSeconds /
//   defaultBranch / configSecret；configPublic 里的 URL 不可改（需删源重建），
//   因此地址区为只读展示 + 注释说明。
// ---------------------------------------------------------------------------

function SourceSettingsModal({ source, onClose, onSave, saving }: {
  source: Source;
  onClose: () => void;
  onSave: (patch: { name: string; autoSync: boolean; defaultBranch: string | null; token: string; intervalSeconds: number }) => void;
  saving?: boolean;
}): React.ReactElement {
  const [name, setName] = useState(source.name);
  const [autoSync, setAutoSync] = useState(source.autoSync);
  const [syncInterval, setSyncInterval] = useState<SyncIntervalKey>(presetFromSeconds(source.intervalSeconds));
  const [branch, setBranch] = useState(source.defaultBranch ?? 'main');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const meta = SOURCE_TYPE_META[source.type] ?? SOURCE_TYPE_META.local;
  const TypeIcon = meta.Icon;
  const isGit = source.type === 'git';
  const url = sourceUrl(source);
  // database 连接信息（configPublic 只读回显）
  const pub = (source.configPublic ?? {}) as Record<string, string | undefined>;
  // 鉴权状态：configEncrypted 是否存在后端未在列表下发；git 源统一提示「令牌加密存储」。
  const authHint = isGit
    ? '令牌经 AES-256-GCM 加密存储，接口不回显；如需更换请在下方填写新令牌。'
    : '该类型无需访问凭据。';

  function handleBackdropClick(e: React.MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSave({
      name: name.trim(),
      autoSync,
      defaultBranch: isGit ? (branch.trim() || null) : source.defaultBranch,
      token: token.trim(),
      intervalSeconds: autoSync ? (SYNC_INTERVALS.find((i) => i.key === syncInterval)?.seconds ?? 3600) : 0,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm animate-fade-up"
      onClick={handleBackdropClick}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto shadow-xl animate-fade-up">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <TypeIcon size={18} />
            </div>
            <div>
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>数据源设置</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{meta.label}{source.projectName ? ` · ${source.projectName}` : ''}</p>
            </div>
          </div>
          <button className="btn-ghost !p-2" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {/* 名称（可编辑） */}
          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>数据源名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          {/* 连接信息（只读展示） */}
          <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}>
              <Link2 size={12} /> 连接信息
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {isGit ? '仓库地址' : source.type === 'local' ? '文件夹路径' : 'URL'}
              </label>
              <code className="input block truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{url}</code>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                地址为连接配置的一部分，暂不支持修改；更换地址请删除后重新添加。
              </p>
            </div>
            {/* database 连接信息只读展示（PLAN 5.2 前端占位；修改需删源重建） */}
            {source.type === 'database' && (
              <div className="grid grid-cols-3 gap-3">
                {([
                  ['类型', pub.dbType],
                  ['数据库', pub.database],
                  ['表 / 集合', pub.table],
                  ['用户名', pub.username],
                ] as const).map(([label, value]) => (
                  (value !== undefined && value !== '') && (
                    <div key={label}>
                      <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
                      <code className="input block truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{String(value)}</code>
                    </div>
                  )
                ))}
              </div>
            )}
            {isGit && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>分支</label>
                  <input className="input font-mono" value={branch} onChange={(e) => setBranch(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>鉴权</label>
                  <div className="input flex items-center gap-2 bg-neutral-50 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <KeyRound size={13} className="shrink-0 text-neutral-400" />
                    <span className="truncate">{authHint}</span>
                  </div>
                </div>
              </div>
            )}
            {!isGit && (
              <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs"
                style={{ borderColor: 'var(--border-soft)', background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                <KeyRound size={13} className="mt-0.5 shrink-0" />
                {authHint}
              </div>
            )}
            {isGit && (
              <div>
                <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  更新 Access Token <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>（留空则保留当前值）</span>
                </label>
                <div className="relative">
                  <input type={showToken ? 'text' : 'password'} className="input pr-10 font-mono"
                    placeholder="输入新令牌以替换现有凭据"
                    value={token} onChange={(e) => setToken(e.target.value)} />
                  <button type="button" onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-muted)' }}>
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 同步状态（只读） */}
          <div className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}>
              <RefreshCw size={12} /> 同步状态
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>当前状态：<StatusTag status={source.status} syncing={false} /></span>
              <span>最后同步：{relativeTime(source.lastSyncedAt)}</span>
              <span>同步频率：{source.intervalSeconds > 0 ? `每 ${source.intervalSeconds / 3600} 小时` : '手动'}</span>
            </div>
            {source.lastError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span className="break-all">{source.lastError}</span>
              </div>
            )}
          </div>

          {/* 自动同步 + 间隔档位（PLAN 5.1.3）：选时间档即启用自动同步，「手动」= 关闭 */}
          <div className="space-y-2.5">
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={autoSync} onChange={(e) => {
                setAutoSync(e.target.checked);
                if (e.target.checked && syncInterval === 'manual') setSyncInterval('1h');
              }}
                className="h-4 w-4 accent-primary-500" />
              自动同步
            </label>
            {autoSync && (
              <div className="grid grid-cols-4 gap-2">
                {SYNC_INTERVALS.map((o) => (
                  <button key={o.key} type="button"
                    onClick={() => setSyncInterval(o.key)}
                    className={`py-1.5 rounded-md text-xs font-medium border transition ${
                      syncInterval === o.key
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-[var(--border-soft)] text-[var(--text-secondary)] hover:bg-neutral-50'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={saving}>
              <Save size={15} />
              {saving ? '保存中…' : '保存设置'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SourcesPage(): React.ReactElement {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ItemsResp<Source>>({
    queryKey: ['sources'],
    queryFn: () => apiFetch<ItemsResp<Source>>('/api/v1/sources'),
  });
  const { data: projectsData } = useQuery<ItemsResp<ProjectOption>>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ItemsResp<ProjectOption>>('/api/v1/projects'),
  });

  const sources = data?.items ?? [];
  const projects = projectsData?.items ?? [];

  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<SourceType>('git');
  const [settingsSource, setSettingsSource] = useState<Source | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const connectedCount = sources.filter((s) => s.status === 'connected' || s.status === 'synced').length;

  function showToast(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const sync = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/api/v1/sources/${id}/sync`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      showToast('同步已触发');
    },
    onError: () => showToast('同步触发失败，请重试'),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/api/v1/sources/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      showToast('数据源已删除');
    },
    onError: () => showToast('删除失败，请重试'),
  });

  // 创建：对齐后端 body（configPublic 按类型放 url/path/连接信息，凭据进 configSecret）
  //   git 认证三选：token/sshKey 进 configSecret（oauth 无凭据流，见弹窗声明）
  //   database：dbType/host/port/database/table/username 存 configPublic，密码进 configSecret
  const create = useMutation({
    mutationFn: (form: SourceForm) => {
      let configPublic: Record<string, unknown>;
      let configSecret: Record<string, unknown> | undefined;
      let defaultBranch: string | null = null;
      if (form.type === 'local') {
        configPublic = { path: form.url };
      } else if (form.type === 'database') {
        configPublic = { dbType: form.dbType, host: form.host, port: form.port, database: form.database, table: form.table, username: form.dbUsername };
        configSecret = form.dbPassword ? { password: form.dbPassword } : undefined;
      } else {
        configPublic = { url: form.url };
        defaultBranch = form.type === 'git' ? form.branch : null;
        if (form.type === 'git') {
          if (form.authMethod === 'token' && form.token) configSecret = { token: form.token };
          if (form.authMethod === 'ssh' && form.sshKey) configSecret = { sshKey: form.sshKey };
          configPublic = { ...configPublic, authMethod: form.authMethod };
        }
      }
      return apiFetch<Source>('/api/v1/sources', {
        method: 'POST',
        body: JSON.stringify({
          projectId: form.projectId,
          type: form.type,
          name: form.name,
          configPublic,
          defaultBranch,
          configSecret,
          autoSync: form.autoSync,
          intervalSeconds: form.autoSync ? (SYNC_INTERVALS.find((i) => i.key === form.syncInterval)?.seconds ?? 3600) : 0,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      setShowAddModal(false);
      showToast('数据源已添加');
    },
    onError: () => showToast('添加失败，请检查连接信息'),
  });

  // 更新设置：PATCH 仅支持 name/autoSync/intervalSeconds/defaultBranch/configSecret
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: { name: string; autoSync: boolean; defaultBranch: string | null; token: string } }) =>
      apiFetch<unknown>(`/api/v1/sources/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: vars.patch.name,
          autoSync: vars.patch.autoSync,
          intervalSeconds: vars.patch.autoSync ? 3600 : 0,
          defaultBranch: vars.patch.defaultBranch,
          ...(vars.patch.token ? { configSecret: { token: vars.patch.token } } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      setSettingsSource(null);
      showToast('数据源设置已更新');
    },
    onError: () => showToast('保存失败，请重试'),
  });

  async function handleSync(id: string): Promise<void> {
    if (syncingIds.has(id)) return;
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await sync.mutateAsync(id);
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function openAdd(type: SourceType): void {
    setAddType(type);
    setShowAddModal(true);
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      {/* Header */}
      <section className="animate-fade-up">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary-600">
              <Database size={14} />
              <span>Sources</span>
            </div>
            <h1 className="font-display text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>数据源管理</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              连接外部文档源，系统会自动同步并纳入你的知识资产
              <span className="mx-2" style={{ color: 'var(--border-soft)' }}>·</span>
              已连接 <span className="font-semibold text-primary-600">{connectedCount}</span> / {sources.length}
            </p>
          </div>
          <button className="btn-primary" onClick={() => openAdd('git')}>
            <Plus size={16} />
            添加数据源
          </button>
        </div>
      </section>

      {/* 分类卡片区（4 张横滚卡） */}
      <section className="animate-fade-up" style={{ animationDelay: '60ms' }}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Link2 size={14} className="text-primary-600" />
          支持的数据源类型
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
          {SOURCE_TYPE_CATEGORIES.map((cat) => {
            const Icon = cat.Icon;
            return (
              <button key={cat.type} type="button"
                onClick={() => openAdd(cat.type)}
                className="card card-hover group flex min-w-[200px] shrink-0 flex-col p-4 text-left">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <Icon size={20} />
                  </div>
                  <span className="btn-ghost !p-1.5 !text-xs opacity-0 transition-opacity group-hover:opacity-100">
                    连接 <Plus size={12} />
                  </span>
                </div>
                <div className="mt-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{cat.label}</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{cat.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Sources 列表 */}
      <section className="animate-fade-up" style={{ animationDelay: '120ms' }}>
        {isLoading ? (
          <SourcesListSkeleton />
        ) : sources.length === 0 ? (
          <EmptyState onAdd={() => openAdd('git')} />
        ) : (
          <div className="card overflow-hidden">
            {/* 表头：名称 / 类型 / URL / 状态 / 最后同步 / 操作 */}
            <div className="grid grid-cols-[1.4fr_110px_1.4fr_110px_130px_150px] gap-4 border-b bg-neutral-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)', borderColor: 'var(--border-soft)' }}>
              <span>名称</span>
              <span>类型</span>
              <span>URL / 路径</span>
              <span>状态</span>
              <span>最后同步</span>
              <span className="text-right">操作</span>
            </div>
            <ul>
              {sources.map((source) => (
                <li key={source.id}
                  className="grid grid-cols-[1.4fr_110px_1.4fr_110px_130px_150px] items-center gap-4 border-b px-5 py-4 transition-colors last:border-0 hover:bg-neutral-50/60"
                  style={{ borderColor: 'var(--border-soft)' }}>
                  {/* 名称 */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <SourceTypeBadge type={source.type} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{source.name}</div>
                      <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                        {source.projectName ?? '未归属'}
                        {source.type === 'git' && source.defaultBranch ? ` · 分支 ${source.defaultBranch}` : ''}
                      </div>
                    </div>
                  </div>

                  {/* 类型 */}
                  <div>
                    <span className={(SOURCE_TYPE_META[source.type] ?? SOURCE_TYPE_META.local).tagClass}>
                      {(SOURCE_TYPE_META[source.type] ?? SOURCE_TYPE_META.local).label}
                    </span>
                  </div>

                  {/* URL / 路径 */}
                  <div className="min-w-0">
                    <code className="block truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {sourceUrl(source)}
                    </code>
                  </div>

                  {/* 状态 */}
                  <div>
                    <StatusTag status={source.status} syncing={syncingIds.has(source.id)} />
                  </div>

                  {/* 最后同步 */}
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {relativeTime(source.lastSyncedAt)}
                  </div>

                  {/* 操作 */}
                  <div className="flex items-center justify-end gap-1.5">
                    <button className="btn-ghost !p-2" title="立即同步"
                      onClick={() => void handleSync(source.id)}
                      disabled={syncingIds.has(source.id) || sync.isPending}>
                      <RefreshCw size={15} className={syncingIds.has(source.id) ? 'animate-spin text-primary-500' : ''} />
                    </button>
                    <button className="btn-ghost !p-2" title="设置"
                      onClick={() => setSettingsSource(source)}>
                      <Settings size={15} />
                    </button>
                    <button className="btn-danger !p-2" title="删除"
                      onClick={() => { if (window.confirm(`确定删除数据源「${source.name}」吗？删除后需重新添加才能继续同步。`)) del.mutate(source.id); }}
                      disabled={del.isPending}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 添加弹窗 */}
      {showAddModal && (
        <AddSourceModal
          initialType={addType}
          projects={projects}
          onClose={() => setShowAddModal(false)}
          onSubmit={(form) => void create.mutateAsync(form)}
          submitting={create.isPending}
        />
      )}

      {/* 设置弹窗 */}
      {settingsSource && (
        <SourceSettingsModal
          source={settingsSource}
          onClose={() => setSettingsSource(null)}
          onSave={(patch) => void update.mutateAsync({ id: settingsSource.id, patch })}
          saving={update.isPending}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-fade-up">
          <div className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-lg"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)', color: 'var(--text-primary)' }}>
            <span className="text-emerald-500">✓</span>
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
