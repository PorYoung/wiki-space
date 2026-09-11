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

export function extractDocLinks(docs: DocLinkInput[]): DocLinkOutput[] {
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
      // 跳过图片 ![alt](target)：负向判断 target 的 `[` 前一个字符
      if (doc.content[m.index - 1] === '!') continue;

      // [text](<target> "title") 形式：取首个空白段并去掉 < >
      const raw = m[2].trim().split(/\s+/)[0] ?? '';
      const target = raw.replace(/^<(.*)>$/, '$1');

      // 页内锚点 / 空目标 → 忽略不产出
      if (!target || target.startsWith('#')) continue;

      // 外链：http(s) / mailto:
      if (/^(https?:|mailto:)/i.test(target)) {
        const key = `${doc.id}|external|${target}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ fromDocumentId: doc.id, toDocumentId: null, externalUrl: target, broken: false });
        }
        continue;
      }

      // 相对路径：去掉 #fragment 后按 POSIX 相对 from 文档目录 resolve
      const hashIdx = target.indexOf('#');
      const pure = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
      if (!pure) continue;
      const resolved = resolvePosix(fromDir, toPosix(pure));

      // 三级候选：补 .md → 原样 → 去 .md（path 精确相等）
      const candidates = [`${resolved}.md`, resolved, resolved.replace(/\.md$/i, '')];
      let toId: string | null = null;
      for (const c of candidates) {
        const hit = byPath.get(c);
        if (hit) {
          toId = hit;
          break;
        }
      }

      const key = toId ? `${doc.id}|${toId}` : `${doc.id}|broken`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          fromDocumentId: doc.id,
          toDocumentId: toId,
          externalUrl: null,
          broken: toId === null,
        });
      }
    }
  }

  return out;
}
