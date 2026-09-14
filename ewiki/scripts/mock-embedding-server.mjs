// Mock openai-compatible embedding 服务（端到端验证用，非生产代码）：
//   POST {base}/embeddings {model, input: string[]} → {data: [{index, embedding}]}
//   向量 = 字符 2-gram 哈希袋 + L2 归一化（确定性：同文本同向量、语义近似的文本不保证相近），
//   维度 1024 —— 足以驱动 chunking/增量去重/构建/检索全链路的真实验证。
import http from 'node:http';

const DIM = 1024;
const PORT = Number(process.env.MOCK_EMBEDDING_PORT ?? 3090);

function embed(text) {
  const vec = new Float64Array(DIM);
  const t = text.toLowerCase();
  for (let i = 0; i < t.length - 1; i++) {
    const gram = t.slice(i, i + 2);
    let h = 2166136261;
    for (const ch of gram) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    vec[idx] += 1;
  }
  // 单字回退（中文单字也有区分度）
  for (const ch of t) {
    const idx = Math.abs(ch.codePointAt(0) * 2654435761) % DIM;
    vec[idx] += 0.5;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

const server = http.createServer((req, res) => {
  // 嵌入计数：供验收断言「内容未变的 chunk 不重复嵌入」（SEARCH-VECTOR-DESIGN §6.2-3）
  if (req.method === 'GET' && req.url?.endsWith('/stats')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ texts: textsEmbedded, requests: requestsServed }));
    return;
  }
  if (req.method === 'POST' && req.url?.endsWith('/embeddings')) {
    requestsServed++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { input } = JSON.parse(body);
        const texts = Array.isArray(input) ? input : [String(input)];
        textsEmbedded += texts.length;
        const data = texts.map((t, index) => ({ index, embedding: embed(String(t)) }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data, model: 'mock-bge', usage: { prompt_tokens: 0, total_tokens: 0 } }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: String(e) } }));
      }
    });
    return;
  }
  res.writeHead(404).end();
});

let textsEmbedded = 0;
let requestsServed = 0;

server.listen(PORT, () => console.log(`mock embedding server on :${PORT} (dim=${DIM})`));
