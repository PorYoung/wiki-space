import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { fuseRRF, highlightTerms } from '@ewiki/shared';
import type { EmbeddingProvider, SearchHit, SearchRequest, SearchResponse, SearchService } from '@ewiki/shared';
import { schema } from '@ewiki/db';

/**
 * PG 检索实现（SEARCH-VECTOR-DESIGN §7.2 / ADR-S1、ADR-S2、ADR-S4）：
 *   keyword  = documents.search_vector（zhparser 中文分词生成列）+ ts_rank_cd + pg_trgm 兜底
 *   semantic = document_chunks.embedding（pgvector HNSW）+ 权限 SQL 预过滤 + 按文档聚合
 *   hybrid   = 关键词 ∪ 语义两路 RRF 融合（k=60）
 * 权限口径：projectIds 由路由层从 readableProjectIdsSql 物化后传入（permissions.ts 单一口径）；
 *   文档软删（deleted_at）在所有分支强制过滤。
 * documents 表是唯一事实源，索引（生成列/chunks）可随时重建 —— 替换实现不影响数据。
 */

/** ts_headline 高亮哨兵：先转义 HTML 再还原为 <em>，防正文注入标记（shared highlightTerms 同口径） */
const HL_START = '\u0001';
const HL_END = '\u0002';

interface KwRow {
  document_id: string;
  project_id: string;
  path: string;
  title: string | null;
  rank: number;
  headline: string | null;
}

interface SemRow {
  document_id: string;
  project_id: string;
  path: string;
  title: string | null;
  chunk_no: number;
  content: string;
  heading_path: string | null;
  score: number;
}

function decodeHeadline(headline: string | null): string {
  if (!headline) return '';
  // 先整段 HTML 转义，再把哨兵还原为 <em>/</em>（正文里的尖括号不逃逸）
  return headline
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .split(HL_START)
    .join('<em>')
    .split(HL_END)
    .join('</em>');
}

type EffectiveMode = 'keyword' | 'hybrid' | 'semantic';

export class PgSearchService implements SearchService {
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly embeddings: EmbeddingProvider | null = null,
    /** 与迁移 0008 生成列的分词配置保持一致；chinese_zh 由迁移保证存在（zhparser 缺席时为 simple 拷贝） */
    private readonly ftsConfig: string = 'chinese_zh',
  ) {}

  async search(req: SearchRequest): Promise<SearchResponse> {
    const started = Date.now();
    const limit = Math.min(50, Math.max(1, Math.floor(req.limit ?? 20)));
    const offset = Math.max(0, Math.floor(req.offset ?? 0));
    const q = (req.q ?? '').trim();
    if (!q) return { items: [], hasMore: false, tookMs: Date.now() - started };

    const mode = req.mode ?? 'auto';
    const minScore = Math.max(
      0,
      Math.min(0.95, Number(process.env.SEARCH_SEMANTIC_MIN_SCORE ?? '0.3') || 0.3),
    );

    // ---- 向量分支可用性：Provider 已配置 且 目标范围内至少一个库开启 vector ----
    let semanticAvailable = this.embeddings !== null;
    let degraded: SearchResponse['degraded'];
    if (semanticAvailable) {
      semanticAvailable = await this.anyProjectVectorEnabled(req);
      if (!semanticAvailable) degraded = 'vector-disabled';
    } else {
      degraded = 'provider-not-configured';
    }

    let effectiveMode: EffectiveMode =
      mode === 'keyword' ? 'keyword' : semanticAvailable ? (mode === 'semantic' ? 'semantic' : 'hybrid') : 'keyword';

    const fetchN = offset + limit + 1; // 多取 1 判 hasMore；offset/limit 在融合后统一截取

    // ---- 语义路（失败自动降级关键词：Provider 网络异常不应 500 检索） ----
    let semDocs: string[] = [];
    const semByDoc = new Map<string, SemRow>();
    if (effectiveMode !== 'keyword') {
      try {
        const rows = (await this.semanticSearch(q, req, minScore)).filter((r) => r.score >= minScore);
        for (const r of rows) {
          const best = semByDoc.get(r.document_id);
          if (!best || r.score > best.score) semByDoc.set(r.document_id, r);
        }
        semDocs = [...semByDoc.keys()];
      } catch (err) {
        console.error(JSON.stringify({ level: 'warn', msg: 'semantic search failed, degrade to keyword', err: String(err) }));
        effectiveMode = 'keyword';
        degraded = 'provider-not-configured';
      }
    }

    // ---- 关键词路（始终执行；semantic 模式降级/无结果时由它兜底返回） ----
    const kwRows =
      effectiveMode === 'semantic' && semDocs.length > 0 ? [] : await this.keywordSearch(q, req, fetchN);
    const kwDocs = [...new Set(kwRows.map((r) => r.document_id))];

    // ---- 融合与排序 ----
    let ordered: Array<{ docId: string; score: number; reason: SearchHit['reason'] }>;
    if (effectiveMode === 'hybrid') {
      ordered = fuseRRF([kwDocs, semDocs], 60, fetchN).map((f) => ({
        docId: f.key,
        score: f.score,
        reason: f.ranks.length === 2 ? ('hybrid' as const) : semByDoc.has(f.key) ? ('semantic' as const) : ('keyword' as const),
      }));
    } else if (effectiveMode === 'semantic') {
      ordered = semDocs.map((docId) => ({
        docId,
        score: semByDoc.get(docId)?.score ?? 0,
        reason: 'semantic' as const,
      }));
    } else {
      const rankById = new Map(kwRows.map((r) => [r.document_id, r.rank]));
      ordered = kwDocs.map((docId) => ({ docId, score: rankById.get(docId) ?? 0, reason: 'keyword' as const }));
    }

    const page = ordered.slice(offset, offset + limit);
    const hasMore = ordered.length > offset + limit;

    const items: SearchHit[] = page.map(({ docId, score, reason }) => {
      const kw = kwRows.find((r) => r.document_id === docId);
      const sem = semByDoc.get(docId);
      const title = kw?.title ?? sem?.title ?? null;
      const path = kw?.path ?? sem?.path ?? '';
      return {
        documentId: docId,
        projectId: kw?.project_id ?? sem?.project_id ?? '',
        path,
        title: title ?? path.split('/').pop() ?? '(无标题)',
        snippet: kw ? decodeHeadline(kw.headline) : highlightTerms(sem?.content ?? '', q),
        score: Math.round(score * 1000) / 1000,
        reason,
        heading: sem?.heading_path ?? null,
      };
    });

    const wantedVector = mode !== 'keyword';
    return {
      items,
      hasMore,
      tookMs: Date.now() - started,
      ...(wantedVector && effectiveMode === 'keyword' && degraded ? { degraded } : {}),
    };
  }

  // ---- SQL 分支 ------------------------------------------------------------

  /** 权限/范围条件：单库精确 + 可读集合白名单（readableProjectIdsSql 物化产物）。
   *  alias 指向主过滤表（keyword=documents 别名 d；semantic=document_chunks 别名 c，
   *  项目过滤必须落在 chunk 表才能参与 HNSW 预过滤）。 */
  private scopeConditions(req: SearchRequest, alias: 'd' | 'c' = 'd'): SQL[] {
    const conds: SQL[] = [];
    if (req.projectId) conds.push(sql`${sql.raw(alias)}.project_id = ${req.projectId}`);
    if (req.projectIds && req.projectIds.length > 0) {
      // drizzle sql 模板会把 JS 数组展开为多参数/postgres.js 不透传数组类型，
      // IN 列表（每 id 一参数）是最稳的绑定形态
      conds.push(sql`${sql.raw(alias)}.project_id IN (${sql.join(req.projectIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (req.tags && req.tags.length > 0) {
      conds.push(sql`d.tags @> ${req.tags}`);
    }
    return conds;
  }

  private async keywordSearch(q: string, req: SearchRequest, fetchN: number): Promise<KwRow[]> {
    const scope = this.scopeConditions(req);
    const scopeSql = scope.length ? sql` AND ${sql.join(scope, sql` AND `)}` : sql``;
    const rows = (await this.db.execute(sql`
      WITH q AS (SELECT plainto_tsquery(${sql.raw(`'${this.ftsConfig}'`)}, ${q}) AS tsq)
      SELECT d.id AS document_id, d.project_id, d.path, d.title,
             ts_rank_cd(d.search_vector, q.tsq) AS rank,
             ts_headline(${sql.raw(`'${this.ftsConfig}'`)}, d.content, q.tsq,
               'StartSel=${sql.raw(HL_START)},StopSel=${sql.raw(HL_END)},MaxFragments=2,MaxWords=35,MinWords=15,FragmentDelimiter= … ') AS headline
      FROM documents d, q
      WHERE d.search_vector @@ q.tsq
        AND d.deleted_at IS NULL
        AND d.kind = 'text'
        ${scopeSql}
      ORDER BY rank DESC
      LIMIT ${fetchN}
    `)) as unknown as KwRow[];

    if (rows.length >= fetchN / 2 || req.offset) return rows;

    // pg_trgm 兜底（错字/子串/分词遗漏）：标题+路径相似度 或 正文子串，排除 FTS 已命中
    const like = `%${q}%`;
    const hitIds = rows.map((r) => r.document_id);
    const fallback = (await this.db.execute(sql`
      SELECT d.id AS document_id, d.project_id, d.path, d.title,
             similarity(coalesce(d.title, '') || ' ' || d.path, ${q}) AS rank,
             NULL AS headline
      FROM documents d
      WHERE d.deleted_at IS NULL
        AND d.kind = 'text'
        AND (similarity(coalesce(d.title, '') || ' ' || d.path, ${q}) > 0.12 OR d.content ILIKE ${like})
        ${hitIds.length ? sql`AND d.id NOT IN (${sql.join(hitIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
        ${scopeSql}
      ORDER BY rank DESC
      LIMIT ${fetchN - rows.length}
    `)) as unknown as KwRow[];

    return [...rows, ...fallback];
  }

  private async semanticSearch(q: string, req: SearchRequest, minScore: number): Promise<SemRow[]> {
    if (!this.embeddings) return [];
    const [vec] = await this.embeddings.embed([q]);
    if (!vec) return [];
    const vecText = `[${vec.join(',')}]`;
    const fetchN = 96; // chunk 级候选池，文档聚合后约 30~60 个文档
    // 项目过滤落 chunk 表（c）以参与 HNSW 预过滤；标签仅在 documents（d）上过滤
    const scope = this.scopeConditions(req, 'c');
    const scopeSql = scope.length ? sql` AND ${sql.join(scope, sql` AND `)}` : sql``;

    // SET LOCAL 需同事务：iterative_scan 提升高选择性权限预过滤下的 HNSW 召回（pgvector >= 0.8）
    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
      return (await tx.execute(sql`
        SELECT c.document_id, c.project_id, c.chunk_no, c.content, c.heading_path,
               1 - (c.embedding <=> ${vecText}::vector) AS score,
               d.path, d.title
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NOT NULL
          AND d.deleted_at IS NULL
          ${scopeSql}
        ORDER BY c.embedding <=> ${vecText}::vector
        LIMIT ${fetchN}
      `)) as unknown as SemRow[];
    });
    return rows;
  }

  /** 目标范围内是否有库开启向量（范围 = 单库 或 可读集合 或 全部） */
  private async anyProjectVectorEnabled(req: SearchRequest): Promise<boolean> {
    const conds: SQL[] = [sql`p.deleted_at IS NULL`, sql`p.search_config->>'vector' = 'true'`];
    if (req.projectId) conds.push(sql`p.id = ${req.projectId}`);
    else if (req.projectIds && req.projectIds.length > 0)
      conds.push(sql`p.id IN (${sql.join(req.projectIds.map((id) => sql`${id}`), sql`, `)})`);
    const rows = (await this.db.execute(
      sql`SELECT EXISTS(SELECT 1 FROM projects p WHERE ${sql.join(conds, sql` AND `)}) AS ok`,
    )) as unknown as Array<{ ok: boolean }>;
    return rows[0]?.ok === true;
  }
}
