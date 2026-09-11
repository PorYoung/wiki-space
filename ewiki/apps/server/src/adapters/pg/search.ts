import { and, ilike, isNull, or, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SearchHit, SearchQueryOptions, SearchService } from '@ewiki/shared';
import * as schema from '../../db/schema.js';

/**
 * Phase 1 检索：PG ILIKE 兜底（中文全文迁移路径：tsvector+zhparser → Meilisearch，SDD 2.4）。
 * documents 表是唯一事实源，索引可随时重建 —— SearchService 替换不影响数据。
 */
export class PgSearchService implements SearchService {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async indexDocument(): Promise<void> {
    // Phase 1 无独立索引（documents.content 即索引源）；Meilisearch 适配器在此实现
  }

  async removeDocument(): Promise<void> {
    // 同上
  }

  async query(q: string, opts?: SearchQueryOptions): Promise<SearchHit[]> {
    const like = `%${q}%`;
    const conditions = [
      or(ilike(schema.documents.title, like), ilike(schema.documents.content, like)),
      isNull(schema.documents.deletedAt),
    ];
    if (opts?.projectId) conditions.push(eq(schema.documents.projectId, opts.projectId));

    const rows = await this.db
      .select({
        id: schema.documents.id,
        projectId: schema.documents.projectId,
        title: schema.documents.title,
        content: schema.documents.content,
      })
      .from(schema.documents)
      .where(and(...conditions))
      .limit(opts?.limit ?? 20);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      title: r.title ?? '(无标题)',
      snippet: (r.content ?? '').slice(0, 120),
    }));
  }
}
