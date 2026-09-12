// ---------------------------------------------------------------------------
// mermaid 流程图异步渲染 hook：
// markdown.ts 把 ```mermaid 围栏输出为 <div class="mermaid-block"
// data-mermaid-code="<encodeURIComponent 后的源码>"> 占位容器；本 hook 在预览
// 挂载后动态 import mermaid（懒加载，独立 chunk，仅含流程图的文档才付出体积），
// 逐块渲染为 SVG 注回容器。跟随 app 明暗外观切换主题（isDark 依赖触发重渲染）。
// 语法错误降级为容器内错误提示（原源码保留在 data 属性中，不丢内容）。
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import type { Mermaid } from 'mermaid';
import { mdEscapeHtml } from './markdown';

export function useMermaidRender(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  isDark: boolean,
  html: string,
): void {
  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    const container = containerRef.current;
    const blocks = Array.from(container.querySelectorAll<HTMLElement>('.mermaid-block[data-mermaid-code]'));
    if (blocks.length === 0) return;

    let cancelled = false;
    void (async () => {
      let mermaid: Mermaid;
      try {
        mermaid = (await import('mermaid')).default;
      } catch {
        return; // 动态加载失败（构建/网络异常）：占位容器保持空态
      }
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
      });
      for (const el of blocks) {
        const code = decodeURIComponent(el.dataset.mermaidCode ?? '');
        if (!code.trim()) continue;
        try {
          const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2, 10)}`, code);
          if (cancelled) return;
          el.innerHTML = svg;
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          el.innerHTML = `<div class="mermaid-error">流程图语法错误：${mdEscapeHtml(msg)}</div>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [containerRef, enabled, isDark, html]);
}
