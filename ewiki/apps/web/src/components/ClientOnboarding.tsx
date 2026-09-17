// ---------------------------------------------------------------------------
// AI 客户端接入向导（AI-FIRST-CLIENT-INTEGRATION-DESIGN §5）：
//   签发 PAT 后一键产出各客户端配置片段——edith（企业自研，首位）/ Claude Desktop /
//   Cursor（stdio 桥）/ 通用 Streamable HTTP。纯前端生成，服务端零新端点。
//   token 明文仅在签发弹窗链路中传入；常驻入口以占位符渲染。
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { BookOpenCheck, Copy } from 'lucide-react';
import {
  buildEdithMcpConfig,
  buildGenericHttpExample,
  buildStdioBridgeConfig,
} from '@ewiki/shared';

const TOKEN_PLACEHOLDER = '<你的令牌 ewk_…>';

type TargetKey = 'edith' | 'claude' | 'cursor' | 'http';

const TARGETS: Array<{ key: TargetKey; label: string; hint: string }> = [
  { key: 'edith', label: '企业助手（edith）', hint: '用户级 mcp.json，Streamable HTTP 直连' },
  { key: 'claude', label: 'Claude Desktop', hint: 'stdio 桥（ewiki-mcp）' },
  { key: 'cursor', label: 'Cursor', hint: 'stdio 桥（ewiki-mcp）' },
  { key: 'http', label: '通用 HTTP', hint: '云端 Agent / 服务端集成' },
];

function CodeBlock({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert('复制失败，请手动选中文本复制');
    }
  };
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--bg-hover)] p-3 font-mono text-[11px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>{text}</pre>
      <button type="button" className="btn-secondary absolute right-2 top-2 !h-7 !px-2 !text-[11px]" onClick={() => void copy()}>
        <Copy size={12} /> {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

export function ClientOnboardingWizard({ token, onClose }: { token: string; onClose: () => void }): React.ReactElement {
  const [target, setTarget] = useState<TargetKey>('edith');
  const [repoPath, setRepoPath] = useState('D:/works/wiki-space/ewiki');
  const baseUrl = window.location.origin;
  const realToken = token || TOKEN_PLACEHOLDER;
  const isPlaceholder = !token;

  const snippet = useMemo(() => {
    const input = { baseUrl, token: realToken };
    switch (target) {
      case 'edith':
        return { title: '写入 ~/.edith/mcp.json（JSON 数组格式，勿改成 mcpServers map）', code: buildEdithMcpConfig(input) };
      case 'claude':
        return { title: '写入 claude_desktop_config.json（「设置 → 开发者 → 编辑配置」打开的文件）', code: buildStdioBridgeConfig(input, repoPath.trim() || '<ewiki 仓库根目录>') };
      case 'cursor':
        return { title: '写入 ~/.cursor/mcp.json（MCP 配置文件）', code: buildStdioBridgeConfig(input, repoPath.trim() || '<ewiki 仓库根目录>') };
      case 'http':
        return { title: '端点与直连示例（SDK 客户端把 url 指向该端点即可）', code: buildGenericHttpExample(input) };
    }
  }, [target, baseUrl, realToken, repoPath]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-full max-w-2xl flex-col p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <BookOpenCheck size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI 客户端接入</h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--text-muted, #94a3b8)' }}>
          把本知识库接入你的 AI 客户端：检索/读写走开放 API（<code>/api/open/v1</code>），令牌权限即下方签发的 scope，不产生任何额外权限。
          {isPlaceholder && <> 当前为<strong>占位预览</strong>，签发令牌后可拿到带真实令牌的配置。</>}
        </p>

        {/* 目标客户端 tabs（edith 企业优先） */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TARGETS.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.hint}
              onClick={() => setTarget(t.key)}
              className={`rounded-full border px-3 py-1 text-[11px] transition ${
                target === t.key ? 'border-primary-400 bg-primary-50 font-semibold text-primary-700' : 'border-[var(--border-soft)] hover:bg-[var(--bg-hover)]'
              }`}
              style={target === t.key ? undefined : { color: 'var(--text-secondary)' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(target === 'claude' || target === 'cursor') && (
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>ewiki 仓库检出路径（stdio 桥从仓库源码启动）</label>
            <input className="input !h-8 !text-xs" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="<ewiki 仓库根目录>" />
          </div>
        )}

        <div className="mb-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{snippet.title}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <CodeBlock text={snippet.code} />
        </div>

        {/* 启用/风险提示（按目标客户端分场景，锁定两个高频踩坑点） */}
        <div className="mt-3 rounded-md border p-2.5 text-[11px] leading-relaxed" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}>
          {target === 'edith' ? (
            <>
              · Windows 路径 <code>%USERPROFILE%\.edith\mcp.json</code>；多用户部署在 <code>~\.edith\users\&lt;用户名&gt;\.edith\mcp.json</code>。已有其它 server 时，把本条目<strong>并入数组</strong>。<br />
              · 配置已含 <code>&quot;enabled&quot;: true</code>；保存后重启或在「MCP 服务」面板确认 <code>ewiki</code> 已启用，可用面板的「测试」验证连通。<br />
              · <span className="text-amber-700">令牌明文落盘</span>：建议 scope 只给「检索/只读」；泄露请回到本页吊销（立即生效）。
            </>
          ) : target === 'http' ? (
            <>· 401=令牌无效/吊销；403 <code>insufficient_scope</code>=权限不足；429=限流（看 <code>Retry-After</code>）；404=服务端 <code>OPENAPI_ENABLED</code> 关闭。</>
          ) : (
            <>· 需本机可访问 ewiki 仓库（stdio 桥从 <code>packages/mcp/src/stdio.ts</code> 启动）；改路径后重启客户端生效。</>
          )}
        </div>

        <button type="button" className="btn-primary mt-3 !h-8 w-full !text-xs" onClick={onClose}>完成</button>
      </div>
    </div>
  );
}
