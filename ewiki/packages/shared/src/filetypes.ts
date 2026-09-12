// ---- 文件类型注册表（文件管理重构 §3.2） ----
// 前后端共享的唯一权威：扩展名 → 类型元数据 / 查看器分发 / 是否可全文检索。
// 前端图标不进共享包（lucide 是前端依赖），由 web 侧按 typeId 自行映射。

export type FileKind = 'text' | 'binary';

export interface FileTypeDef {
  /** 类型标识，前端按此分发查看器与图标 */
  id: 'markdown' | 'code' | 'image' | 'pdf' | 'binary';
  /** 小写、不带点的扩展名集合 */
  extensions: string[];
  /** 该类型规范 MIME（具体扩展名的 MIME 差异由 mimeOf 覆盖） */
  mime: string;
  kind: FileKind;
  /** 宿主查看器插件 id（P1+ 插件化，P0 仅前端按 id 内联分发） */
  viewerId: 'md' | 'code' | 'image' | 'pdf' | 'fallback';
  /** 是否进入全文检索 / 文本编辑 */
  searchable: boolean;
}

export const FILE_TYPES: readonly FileTypeDef[] = [
  {
    id: 'markdown',
    extensions: ['md', 'markdown'],
    mime: 'text/markdown',
    kind: 'text',
    viewerId: 'md',
    searchable: true,
  },
  {
    id: 'code',
    extensions: [
      'txt', 'log', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf',
      'xml', 'mdx', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'kt',
      'go', 'rs', 'rb', 'php', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'swift',
      'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql',
      'css', 'scss', 'less', 'html', 'htm', 'vue', 'svelte',
      'gradle', 'proto', 'graphql', 'gql', 'env', 'gitignore', 'editorconfig',
      'keep',
    ],
    mime: 'text/plain',
    kind: 'text',
    viewerId: 'code',
    searchable: true,
  },
  {
    id: 'image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'],
    mime: 'image/png',
    kind: 'binary',
    viewerId: 'image',
    searchable: false,
  },
  {
    id: 'pdf',
    extensions: ['pdf'],
    mime: 'application/pdf',
    kind: 'binary',
    viewerId: 'pdf',
    searchable: false,
  },
];

const BINARY_FALLBACK: FileTypeDef = {
  id: 'binary',
  extensions: [],
  mime: 'application/octet-stream',
  kind: 'binary',
  viewerId: 'fallback',
  searchable: false,
};

const EXT_INDEX: ReadonlyMap<string, FileTypeDef> = new Map(
  FILE_TYPES.flatMap((t) => t.extensions.map((e) => [e, t] as const)),
);

/** 特殊扩展名的精确 MIME 覆盖（其余走类型规范 MIME） */
const EXT_MIME_OVERRIDES: Record<string, string> = {
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
  jsonld: 'application/ld+json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  sh: 'application/x-sh',
  bash: 'application/x-sh',
  py: 'text/x-python',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  png: 'image/png',
  pdf: 'application/pdf',
};

/**
 * 取小写、不带点的扩展名；无扩展名返回 ''。
 * 点开头文件（.gitignore/.keep）把整段视为扩展名，可被注册表命中。
 */
export function extOf(nameOrPath: string): string {
  const base = nameOrPath.split(/[\\/]/).pop() ?? nameOrPath;
  const dot = base.startsWith('.') ? 0 : base.lastIndexOf('.');
  if (dot < 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function basenameOf(nameOrPath: string): string {
  return nameOrPath.split(/[\\/]/).pop() ?? nameOrPath;
}

export interface ResolvedFileType {
  typeId: FileTypeDef['id'];
  kind: FileKind;
  ext: string;
  mime: string;
  viewerId: FileTypeDef['viewerId'];
  searchable: boolean;
}

/**
 * 解析文件类型：扩展名精确匹配优先；扩展名未知但 mimeHint 是文本类时按 code 处理；
 * 其余一律 binary 兜底（任何文件都可入库，查看器显示信息卡）。
 */
export function resolveFileType(nameOrPath: string, mimeHint?: string | null): ResolvedFileType {
  const ext = extOf(nameOrPath);
  const def = (ext && EXT_INDEX.get(ext)) || BINARY_FALLBACK;

  if (def === BINARY_FALLBACK && mimeHint && /^text\//i.test(mimeHint)) {
    const code = FILE_TYPES.find((t) => t.id === 'code')!;
    return {
      typeId: 'code',
      kind: 'text',
      ext,
      mime: mimeHint,
      viewerId: code.viewerId,
      searchable: true,
    };
  }

  return {
    typeId: def.id,
    kind: def.kind,
    ext,
    mime: (ext && EXT_MIME_OVERRIDES[ext]) || def.mime,
    viewerId: def.viewerId,
    searchable: def.searchable,
  };
}

/** 一期查看器支持的类型（其余落 fallback 信息卡） */
export function isViewable(nameOrPath: string, mimeHint?: string | null): boolean {
  return resolveFileType(nameOrPath, mimeHint).viewerId !== 'fallback';
}
