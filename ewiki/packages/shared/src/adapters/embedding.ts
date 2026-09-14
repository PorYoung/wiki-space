// openai-compatible 嵌入适配器（SEARCH-VECTOR-DESIGN ADR-S5）：
//   POST {baseUrl}/embeddings {model, input: string[]} → {data: [{index, embedding}]}
//   兼容 OpenAI / 智谱 / 通义 / Ollama（/v1）/ vLLM —— 差异全部收敛在 base_url + key + model。
//   纯 fetch、零依赖；server（查询侧嵌入 query）与 worker（索引侧嵌入 chunk）共用。

import type { EmbeddingProvider, EmbeddingSettings } from '../ports/index.js';

interface EmbeddingsResponse {
  data?: Array<{ index?: number; embedding: number[] }>;
  error?: { message?: string } | string;
}

export function createOpenAICompatibleEmbedding(settings: EmbeddingSettings): EmbeddingProvider {
  if (!settings.baseUrl) {
    throw new Error('EMBEDDING_BASE_URL 未配置（openai-compatible Provider 需要）');
  }
  return {
    id: 'openai-compatible',
    dim: settings.dim,
    async embed(texts) {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += settings.batchSize) {
        const batch = texts.slice(i, i + settings.batchSize);
        const res = await fetch(`${settings.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: settings.model, input: batch }),
          signal: AbortSignal.timeout(settings.timeoutMs),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`embedding request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
        }
        const json = (await res.json()) as EmbeddingsResponse;
        if (json.error) {
          const msg = typeof json.error === 'string' ? json.error : json.error.message ?? 'unknown';
          throw new Error(`embedding provider error: ${msg.slice(0, 200)}`);
        }
        const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (data.length !== batch.length) {
          throw new Error(`embedding batch size mismatch: expect ${batch.length}, got ${data.length}`);
        }
        for (const d of data) {
          if (!Array.isArray(d.embedding) || d.embedding.length !== settings.dim) {
            throw new Error(
              `embedding dim mismatch: expect ${settings.dim}, got ${d.embedding?.length ?? 'null'}（检查 EMBEDDING_DIM 与模型是否一致）`,
            );
          }
          out.push(d.embedding);
        }
      }
      return out;
    },
  };
}

export type EmbeddingFactory = () => EmbeddingProvider | null;

/** Provider 注册表（env → 实现）。none/未知 = null（向量能力整体下线）。 */
export function createEmbeddingProvider(settings: EmbeddingSettings): EmbeddingProvider | null {
  switch (settings.provider) {
    case 'openai-compatible':
      return createOpenAICompatibleEmbedding(settings);
    default:
      return null;
  }
}
