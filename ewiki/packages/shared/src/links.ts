// 文档链接抽取（PRD F32 知识图谱断链检测）：纯函数、零依赖（不碰 node 内置模块）

export interface DocLinkInput {
  id: string;
  path: string;
  content: string | null;
}

export interface DocLinkOutput {
  fromDocumentId: string;
  toDocumentId: string | null;
  externalUrl: string | null;
  broken: boolean;
  /** true = 图片语法 ![](...) 产生的边（删除被引用图片时的活动流提示用） */
  image?: boolean;
}

export interface ExtractLinksOptions {
  /** 是否抽取图片引用边，默认 false（保持历史行为：图片不算文档链接） */
  includeImages?: boolean;
}

/** POSIX 语义的相对路径 resolve（处理 ./ ../ 与绝对 target），返回无尾斜杠的规范化路径 */
function resolvePosix(fromDir: string, rel: string): string {
  const combined = rel.startsWith('/') ? rel : `${fromDir}/${rel}`;
  const segments: string[] = [];
  for (const seg of combined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

const toPosix = (p: string): string => p.replace(/\\/g, '/');

const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

export function extractDocLinks(docs: DocLinkInput[], opts: ExtractLinksOptions = {}): DocLinkOutput[] {
  // path（统一 posix 分隔）→ 文档 id，用于 O(1) 精确匹配
  const byPath = new Map<string, string>();
  for (const d of docs) byPath.set(toPosix(d.path), d.id);

  const out: DocLinkOutput[] = [];
  const seen = new Set<string>();

  for (const doc of docs) {
    if (!doc.content) continue;
    const fromPosix = toPosix(doc.path);
    const fromDirParts = fromPosix.split('/');
    fromDirParts.pop();
    const fromDir = fromDirParts.join('/');

    MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_LINK_RE.exec(doc.content)) !== null) {
      // 图片 ![alt](target)：默认跳过；includeImages 时作为图片边产出
      const isImage = doc.content[m.index - 1] === '!';
      if (isImage && !opts.includeImages) continue;

      // [text](<target> "title") 形式：取首个空白段并去掉 < >
      const raw = m[2].trim().split(/\s+/)[0] ?? '';
      const target = raw.replace(/^<(.*)>$/, '$1');

      // 页内锚点 / 空目标 → 忽略不产出
      if (!target || target.startsWith('#')) continue;

      // 外链：http(s) / mailto:
      if (/^(https?:|mailto:)/i.test(target)) {
        const key = `${doc.id}|external|${target}|${isImage ? 'img' : 'lnk'}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ fromDocumentId: doc.id, toDocumentId: null, externalUrl: target, broken: false, image: isImage || undefined });
        }
        continue;
      }

      // 相对路径：去掉 #fragment 后按 POSIX 相对 from 文档目录 resolve
      const hashIdx = target.indexOf('#');
      const pure = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
      if (!pure) continue;
      const resolved = resolvePosix(fromDir, toPosix(pure));

      // 三级候选：精确路径优先 → 补 .md（存量无后缀链接）→ 去 .md
      const candidates = [resolved, `${resolved}.md`, resolved.replace(/\.md$/i, '')];
      let toId: string | null = null;
      for (const c of candidates) {
        const hit = byPath.get(c);
        if (hit) {
          toId = hit;
          break;
        }
      }

      const key = toId
        ? `${doc.id}|${toId}|${isImage ? 'img' : 'lnk'}`
        : `${doc.id}|broken|${resolved}|${isImage ? 'img' : 'lnk'}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          fromDocumentId: doc.id,
          toDocumentId: toId,
          externalUrl: null,
          broken: toId === null,
          image: isImage || undefined,
        });
      }
    }
  }

  return out;
}
