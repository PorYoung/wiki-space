// 索引构建执行侧（SEARCH-VECTOR-DESIGN §6.2）：search-index / search-build / search-reconcile
// 三个队列共用的单文档重建逻辑。
//   latest-wins：job 只带 documentId，执行时读 DB 最新态决定「重建 chunk / 清除 chunk」；
//   增量：chunk 级 content_hash 对比，内容未变的 chunk 搬运已嵌入向量（零外呼，§6.2-3）；
//   失败隔离：单批 embedding 失败抛错交 pg-boss 退避重试；已写入的 chunk 保持哈希，
//   重试时哈希去重只补缺口（embedding IS NULL），不重复嵌入未变内容。
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { chunkMarkdown, type EmbeddingProvider } from '@ewiki/shared';
import { documentChunks, documents, projects } from '@ewiki/db';
import { schema as dbSchema } from '@ewiki/db';

export interface ReindexDeps {
  db: PostgresJsDatabase<typeof dbSchema>;
  /** null = Provider 未配置：向量分支整体跳过（仅维护 chunk 清除/结构对齐） */
  embeddings: EmbeddingProvider | null;
  embeddingModel: string;
  /** 每批 embedding 条数（对齐 EMBEDDING_BATCH_SIZE 语义，独立于 Provider 内部分批） */
  batchSize?: number;
}

/** pg 驱动返回 vector 列为 '[0.1,0.2]' 文本；重嵌/搬运统一转为 number[] */
function parseVector(v: unknown): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\[|\]$/g, '').trim();
    return trimmed ? trimmed.split(',').map(Number) : null;
  }
  return null;
}

export interface ReindexResult {
  action: 'rebuild' | 'clear';
  chunks: number;
  embedded: number;
}

/** 单文档索引重建（幂等；同文档并发由队列 singletonKey 防抖 + withLock 兜底串行化） */
export async function reindexDocument(deps: ReindexDeps, documentId: string): Promise<ReindexResult> {
  const { db, embeddings, embeddingModel } = deps;

  const [doc] = await db
    .select({
      id: documents.id,
      projectId: documents.projectId,
      kind: documents.kind,
      content: documents.content,
      deletedAt: documents.deletedAt,
      searchConfig: projects.searchConfig,
    })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(eq(documents.id, documentId))
    .limit(1);

  // 清除分支：文档不存在 / 软删 / 二进制 / 库未开向量（§6.2-2a）
  if (!doc || doc.deletedAt !== null || doc.kind === 'binary' || doc.searchConfig?.vector !== true) {
    const deleted = await db
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
      .returning({ id: documentChunks.id });
    return { action: 'clear', chunks: deleted.length, embedded: 0 };
  }

  // chunk 参数按项目配置（§15 构建配置）；缺省 512/50（与迁移默认一致）
  const chunks = chunkMarkdown(doc.content ?? '', {
    targetTokens: doc.searchConfig?.chunkTokens ?? 512,
    overlapTokens: doc.searchConfig?.overlapTokens ?? 50,
  });
  const existingRows = await db
    .select({
      chunkNo: documentChunks.chunkNo,
      contentHash: documentChunks.contentHash,
      embedding: documentChunks.embedding,
      embeddingModel: documentChunks.embeddingModel,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));
  const existingByNo = new Map(existingRows.map((c) => [c.chunkNo, c]));

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
    if (chunks.length === 0) return;
    const rows = chunks.map((c) => {
      const contentHash = createHash('sha256').update(c.content).digest('hex');
      const prev = existingByNo.get(c.chunkNo);
      const prevVec = parseVector(prev?.embedding);
      // 增量去重（§6.2-3）：同序同哈希且向量产自当前模型 → 直接搬运，不重新嵌入
      const reused = !!(prev && prev.contentHash === contentHash && prevVec && prev.embeddingModel === embeddingModel);
      return {
        documentId,
        projectId: doc.projectId,
        chunkNo: c.chunkNo,
        content: c.content,
        contentHash,
        headingPath: c.headingPath,
        embedding: reused ? prevVec : null,
        embeddingModel: reused ? prev!.embeddingModel! : null,
        tokenCount: c.tokenCount,
        createdAt: now,
        updatedAt: now,
      };
    });
    await tx.insert(documentChunks).values(rows);
  });

  if (!embeddings) return { action: 'rebuild', chunks: chunks.length, embedded: 0 };

  // 嵌入新增/变化的 chunk（embedding IS NULL）
  const pending = await db
    .select({ id: documentChunks.id, content: documentChunks.content })
    .from(documentChunks)
    .where(and(eq(documentChunks.documentId, documentId), isNull(documentChunks.embedding)));
  let embedded = 0;
  for (let i = 0; i < pending.length; i += deps.batchSize ?? 32) {
    const batch = pending.slice(i, i + (deps.batchSize ?? 32));
    const vectors = await embeddings.embed(batch.map((c) => c.content));
    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j] ?? null;
      await db
        .update(documentChunks)
        .set({ embedding: vec, embeddingModel: vec ? embeddingModel : null, updatedAt: new Date() })
        .where(eq(documentChunks.id, batch[j].id));
      if (vec) embedded++;
    }
  }
  return { action: 'rebuild', chunks: chunks.length, embedded };
}
