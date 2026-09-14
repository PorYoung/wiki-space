// 检索共享工具（SEARCH-VECTOR-DESIGN §5.2/§6.2/§7.2）：
//   markdown 感知切分、RRF 融合、防抖入队、语义命中高亮。
// 纯函数 + 结构化类型（不依赖 pg-boss/PG），server 与 worker 两侧共用。

// ---------------------------------------------------------------------------
// chunk 切分（ADR-S3）：markdown 感知 —— 标题链入 heading_path、代码围栏内不切、
//   目标 ~512 token / 50 token 重叠；token 为 bge 系词表的经验近似（CJK≈1/字，拉丁≈1/4字符）。
// ---------------------------------------------------------------------------

export interface SearchChunk {
  chunkNo: number;
  content: string;
  /** 所在标题链，如 "部署/回滚"；无标题为 null */
  headingPath: string | null;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  /** 单 chunk 硬上限（超长代码块等） */
  maxTokens?: number;
}

const CHUNK_DEFAULTS: Required<ChunkOptions> = {
  targetTokens: 512,
  overlapTokens: 50,
  maxTokens: 800,
};

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uac00-\ud7af\u3040-\u30ff\uff00-\uffef]/.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

export function chunkMarkdown(content: string, opts: ChunkOptions = {}): SearchChunk[] {
  const { targetTokens, overlapTokens, maxTokens } = { ...CHUNK_DEFAULTS, ...opts };
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const chunks: SearchChunk[] = [];
  const chain: Array<{ level: number; text: string }> = [];
  let buf: string[] = [];
  let inFence = false;

  const headingPath = (): string | null => (chain.length ? chain.map((c) => c.text).join('/') : null);

  /** 收尾当前缓冲为一个 chunk；返回按 overlapTokens 从尾部回带的行（作为下一 chunk 前缀） */
  const flush = (carry: boolean): string[] => {
    const text = buf.join('\n').trim();
    const src = buf;
    buf = [];
    if (!text) return [];
    chunks.push({
      chunkNo: chunks.length,
      content: text,
      headingPath: headingPath(),
      tokenCount: estimateTokens(text),
    });
    if (!carry || overlapTokens <= 0) return [];
    const carried: string[] = [];
    let t = 0;
    for (let i = src.length - 1; i >= 0; i--) {
      const lt = estimateTokens(src[i]);
      if (t + lt > overlapTokens && carried.length > 0) break;
      carried.unshift(src[i]);
      t += lt;
    }
    return carried;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const bufTokens = estimateTokens(buf.join('\n'));

    if (/^(```|~~~)/.test(trimmed)) {
      // 围栏边界是自然切分点
      if (!inFence && bufTokens >= targetTokens) buf = flush(true);
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (inFence) {
      buf.push(line);
      // 超长围栏硬切保护（未闭合代码块不至于把单个 chunk 撑爆）
      if (estimateTokens(buf.join('\n')) >= maxTokens * 1.5) buf = flush(true);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      // 新标题优先切分边界；回带行保留旧标题语义（flush 用旧 chain）
      if (bufTokens >= Math.min(targetTokens / 2, 200)) buf = flush(true);
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      while (chain.length && chain[chain.length - 1].level >= level) chain.pop();
      chain.push({ level, text });
    }

    buf.push(line);
    const bufNow = estimateTokens(buf.join('\n'));
    // 通用硬切：maxTokens 上限对任意内容生效（无空行的长文/超长段落不至于涨成单 chunk）
    if (bufNow >= maxTokens || (trimmed === '' && bufNow >= targetTokens)) buf = flush(true);
  }
  flush(false);

  return chunks;
}

// ---------------------------------------------------------------------------
// RRF 融合（ADR-S6/§7.2）：score = Σ 1/(k + rank)；k=60 为业界默认。
// ---------------------------------------------------------------------------

export interface FusedItem<K> {
  key: K;
  score: number;
  /** 在各输入列表中的排名（1-based），供 reason 判定 */
  ranks: number[];
}

export function fuseRRF<K>(lists: K[][], k = 60, limit = 20): Array<FusedItem<K>> {
  const acc = new Map<K, { score: number; ranks: number[] }>();
  for (const list of lists) {
    list.forEach((key, idx) => {
      const cur = acc.get(key) ?? { score: 0, ranks: [] };
      cur.score += 1 / (k + idx + 1);
      cur.ranks.push(idx + 1);
      acc.set(key, cur);
    });
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ key, score: v.score, ranks: v.ranks }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// 防抖入队（§6.1/§6.2）：写路径唯一挂钩形态。
//   singletonKey=文档Id + startAfter=防抖秒数：延迟执行期间同文档重复变更被去重合并，
//   job 执行时读 DB 最新态（latest-wins）；任务一旦完成，其后的新变更必然产生新任务
//   —— 不用 singletonSeconds（其窗口含已完成任务，会吞掉窗口内的后续变更，造成丢更新）。
//   入队失败不抛出：索引是旁路能力，由夜间对账兜底（§6.4）。
// ---------------------------------------------------------------------------

/** pg-boss 结构化最小面（避免 shared 依赖 pg-boss 类型） */
export interface PgBossSendLike {
  send(queue: string, data: unknown, options?: object): Promise<string | null>;
}

export function enqueueSearchIndex(
  send: PgBossSendLike,
  documentIds: string | string[],
  opts: { debounceSeconds?: number } = {},
): Promise<void> {
  const ids = [...new Set((Array.isArray(documentIds) ? documentIds : [documentIds]).filter(Boolean))];
  const envDebounce = Math.floor(Number(process.env.SEARCH_INDEX_DEBOUNCE_SECONDS ?? '30') || 30);
  const debounceSeconds = Math.max(0, Math.floor(opts.debounceSeconds ?? envDebounce));
  return (async () => {
    for (const documentId of ids) {
      try {
        await send.send(
          'search-index',
          { documentId },
          debounceSeconds > 0
            ? { singletonKey: documentId, startAfter: debounceSeconds }
            : { singletonKey: documentId },
        );
      } catch (err) {
        console.error(
          JSON.stringify({ level: 'warn', msg: 'search-index enqueue failed', documentId, err: String(err) }),
        );
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// 语义命中高亮（§7.2）：无 tsquery 可用时的手动 <em> 标记 + 截窗。
//   输出已做 HTML 转义，仅 <em></em> 为安全标签（与 ts_headline + 转义后处理同口径）。
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightTerms(text: string, query: string, radius = 80): string {
  // 仅剥 markdown 标记噪声；保留 > 与 -（HTML 标签/实体在随后的 HTML 转义中保持完整）
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`_[\]()!]/g, ' ').replace(/\s+/g, ' ').trim();
  const terms = [...new Set(query.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2))];
  let start = 0;
  if (terms.length > 0) {
    const re = new RegExp(terms.map(escapeRegExp).join('|'), 'gi');
    const m = re.exec(plain);
    if (m) start = Math.max(0, m.index - radius / 2);
  }
  const end = Math.min(plain.length, start + radius * 2 + terms.join('').length);
  const windowText = (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
  const escaped = escapeHtml(windowText);
  if (terms.length === 0) return escaped;
  const re = new RegExp(terms.map(escapeRegExp).join('|'), 'gi');
  return escaped.replace(re, (m) => `<em>${m}</em>`);
}
