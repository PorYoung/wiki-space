import { Link } from 'react-router-dom';
import { ArrowLeft, Home, Search } from 'lucide-react';

/** 404 页面 — 已独立自 placeholders.tsx */
export function NotFoundPage(): React.ReactElement {
  return (
    <div className="h-full overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center p-10 text-center">
        {/* Decorative number */}
        <div className="relative select-none">
          <span className="text-[120px] leading-none font-black text-transparent bg-clip-text"
            style={{
              /* fallback 与 --color-primary-600 兜底色一致（fresh-emerald #059669），旧值 #4f46e5 为 indigo 残留 */
              backgroundImage: 'linear-gradient(135deg, var(--color-primary-500), var(--color-primary-600, #059669))',
            }}>
            404
          </span>
          <span className="absolute -top-2 -right-6 text-4xl rotate-12 text-neutral-300">?</span>
        </div>

        {/* font-display：对齐审计 3.13，页面主标题走展示字体（Plus Jakarta Sans） */}
        <h1 className="mt-4 text-xl font-bold font-display text-neutral-900">页面不存在</h1>
        <p className="mt-2 text-sm text-neutral-500 max-w-sm">
          你访问的地址可能已被移动或删除。可以尝试返回仪表盘或搜索其他内容。
        </p>

        <div className="mt-6 flex items-center gap-2">
          <Link to="/dashboard" className="btn-primary !h-9 !text-sm !px-4 inline-flex items-center gap-1.5">
            <Home size={14} /> 返回仪表盘
          </Link>
          <Link to="/library" className="btn-secondary !h-9 !text-sm !px-4 inline-flex items-center gap-1.5">
            <Search size={14} /> 去文档库
          </Link>
        </div>

        <div className="mt-8 text-[11px] text-neutral-400 flex items-center gap-1">
          <ArrowLeft size={10} className="rotate-180" />
          如果认为这是一个 Bug，请反馈给团队
        </div>
      </div>
    </div>
  );
}
