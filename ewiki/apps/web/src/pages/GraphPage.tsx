import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ExternalLink,
  Maximize2,
  Network,
  RefreshCw,
  Sparkles,
  Tag,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api/client';

// ---------------------------------------------------------------------------
// Types — 后端 graph 端点的返回 shape
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  path: string;
  title: string | null;
}

interface GraphEdge {
  id: string;
  fromDocumentId: string;
  // 可空：外部链接/断链边没有内部目标文档（目标节点由前端合成）
  toDocumentId: string | null;
  externalUrl: string | null;
  broken: boolean;
}

interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// 前端增强后的节点/边，带 cluster/degree 等派生字段
// kind 分支（对齐原型 renderNodeShape）：
//   doc      —— 内部文档，圆角矩形 + 白色标签
//   external —— 外部链接悬空端点，紫色小方块（边 toDocumentId 为 null、externalUrl 有值时合成）
//   broken   —— 断链悬空端点，红色虚线圆（边 toDocumentId 为 null、externalUrl 为空时合成）
interface RenderNode {
  id: string;
  path?: string;
  title?: string | null;
  kind: 'doc' | 'external' | 'broken';
  cluster: string;
  degree: number;
  label: string;
  externalUrl?: string | null;
}

interface RenderEdge extends GraphEdge {
  // 布局/渲染统一使用 source/target（悬空边指向合成节点 id）
  source: string;
  target: string;
  label?: string;
}

type ViewMode = 'explore' | 'orphans' | 'hubs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLUSTER_PALETTE = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ef4444', // red
  '#06b6d4', // cyan
];

// 边语义色（与 defs 箭头 marker 保持一致）
const EDGE_NORMAL = '#cbd5e1';
const EDGE_BROKEN = '#ef4444';
const EDGE_EXTERNAL = '#a855f7';

function clusterOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '根目录';
  return parts[0]!;
}

// 外部 URL 提取主机名作为边标签/节点名
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function clusterColor(cluster: string): string {
  let h = 0;
  for (let i = 0; i < cluster.length; i++) h = (h * 31 + cluster.charCodeAt(i)) | 0;
  return CLUSTER_PALETTE[Math.abs(h) % CLUSTER_PALETTE.length]!;
}

// ---------------------------------------------------------------------------
// 力导向布局 — 纯 JS，无第三方依赖
// ---------------------------------------------------------------------------

interface Position {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function layoutForce(
  nodes: RenderNode[],
  edges: RenderEdge[],
  width: number,
  height: number,
  iterations = 140,
): Record<string, Position> {
  const positions: Record<string, Position> = {};
  const cx = width / 2;
  const cy = height / 2;
  const r0 = Math.min(width, height) / 3;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[n.id] = {
      x: cx + r0 * Math.cos(angle) + (Math.random() - 0.5) * 30,
      y: cy + r0 * Math.sin(angle) + (Math.random() - 0.5) * 30,
      vx: 0,
      vy: 0,
    };
  });

  const kRepulse = 6000;
  const kSpring = 0.015;
  const idealLen = 140;
  const damping = 0.82;

  for (let iter = 0; iter < iterations; iter++) {
    // 斥力：每对节点
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions[nodes[i]!.id]!;
        const b = positions[nodes[j]!.id]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) dist2 = 1;
        const dist = Math.sqrt(dist2);
        const force = kRepulse / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // 弹簧力：边上的节点
    edges.forEach((e) => {
      const a = positions[e.source];
      const b = positions[e.target];
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDiff = dist - idealLen;
      const fx = (dx / dist) * targetDiff * kSpring;
      const fy = (dy / dist) * targetDiff * kSpring;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });
    // 更新位置 + 阻尼 + 边界
    nodes.forEach((n) => {
      const p = positions[n.id]!;
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx;
      p.y += p.vy;
      const pad = 40;
      if (p.x < pad) { p.x = pad; p.vx *= -0.3; }
      if (p.x > width - pad) { p.x = width - pad; p.vx *= -0.3; }
      if (p.y < pad) { p.y = pad; p.vy *= -0.3; }
      if (p.y > height - pad) { p.y = height - pad; p.vy *= -0.3; }
    });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function GraphPage(): React.ReactElement {
  const { id: projectId } = useParams();
  const navigate = useNavigate();

  const [view, setView] = useState<ViewMode>('explore');
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [layoutSeed, setLayoutSeed] = useState(0); // 触发重新布局

  const [size, setSize] = useState({ w: 960, h: 560 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 项目名（工具栏「· 项目名」后缀，原型 Graph.jsx；PLAN 5.3.2）
  const { data: overview } = useQuery<{ id: string; name: string }>({
    queryKey: ['project-overview', projectId],
    queryFn: () => apiFetch<{ id: string; name: string }>(`/api/v1/projects/${projectId}/overview`),
    enabled: !!projectId,
  });

  // 监听容器尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 960, h: el.clientHeight || 560 });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth || 960, h: el.clientHeight || 560 });
    return () => ro.disconnect();
  }, []);

  // ---- Query ----
  const { data: graph, isLoading, error, refetch } = useQuery<ProjectGraph>({
    queryKey: ['project-graph', projectId],
    queryFn: () => apiFetch<ProjectGraph>(`/api/v1/projects/${projectId}/graph`),
    enabled: !!projectId,
  });

  // ---- 派生：RenderNode / RenderEdge / degree / clusters ----
  // 后端 nodes 仅含内部文档；external/broken 边的 toDocumentId 为 null，
  // 这里为每条悬空边合成一个端点节点（external=外部链接，broken=断链），
  // 否则这些边既无布局目标也无法渲染（旧逻辑直接过滤丢弃，断链计数恒为 0）。
  const { renderNodes, renderEdges } = useMemo(() => {
    if (!graph?.nodes) return { renderNodes: [] as RenderNode[], renderEdges: [] as RenderEdge[] };
    const degreeMap: Record<string, number> = {};
    graph.nodes.forEach((n) => { degreeMap[n.id] = 0; });

    const nodes: RenderNode[] = graph.nodes.map((n) => ({
      ...n,
      kind: 'doc' as const,
      cluster: clusterOf(n.path),
      degree: 0,
      label: n.title ?? n.path.split('/').pop() ?? n.id,
    }));

    const edges: RenderEdge[] = [];
    for (const e of graph.edges ?? []) {
      if (e.toDocumentId) {
        // 内部边（含指向已删除文档的断链：toDocumentId 可能不在当前 nodes 集合）
        if (degreeMap[e.fromDocumentId] != null) degreeMap[e.fromDocumentId]++;
        if (degreeMap[e.toDocumentId] != null) degreeMap[e.toDocumentId]++;
        edges.push({ ...e, source: e.fromDocumentId, target: e.toDocumentId });
      } else if (e.externalUrl) {
        // 外部链接：合成 external 端点（同一 URL 聚合为一个节点）
        const extId = `ext:${e.externalUrl}`;
        if (!degreeMap[extId]) {
          degreeMap[extId] = 1;
          nodes.push({
            id: extId,
            kind: 'external',
            cluster: '外部链接',
            degree: 1,
            label: hostOf(e.externalUrl),
            externalUrl: e.externalUrl,
          });
        } else {
          degreeMap[extId]++;
        }
        if (degreeMap[e.fromDocumentId] != null) degreeMap[e.fromDocumentId]++;
        edges.push({ ...e, source: e.fromDocumentId, target: extId, label: hostOf(e.externalUrl) });
      } else if (e.broken) {
        // 断链（无目标、无 URL）：每条边合成一个 broken 端点
        const brokenId = `broken:${e.id}`;
        degreeMap[brokenId] = 1;
        nodes.push({
          id: brokenId,
          kind: 'broken',
          cluster: '断链',
          degree: 1,
          label: '断链',
        });
        if (degreeMap[e.fromDocumentId] != null) degreeMap[e.fromDocumentId]++;
        edges.push({ ...e, source: e.fromDocumentId, target: brokenId, label: '缺失文档' });
      }
    }

    nodes.forEach((n) => { n.degree = degreeMap[n.id] ?? 0; });
    return { renderNodes: nodes, renderEdges: edges };
  }, [graph]);

  const nodeById = useMemo(() => {
    const m = new Map<string, RenderNode>();
    renderNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [renderNodes]);

  // 过滤 edges：两端都在 nodes 里
  const validEdges = useMemo(() => {
    return renderEdges.filter(
      (e) => nodeById.has(e.source) && nodeById.has(e.target),
    );
  }, [renderEdges, nodeById]);

  // 三视图过滤（合成节点只在 explore 视图出现；orphans/hubs 只看真实文档）
  const viewNodes = useMemo<RenderNode[]>(() => {
    if (view === 'orphans') return renderNodes.filter((n) => n.kind === 'doc' && n.degree === 0);
    if (view === 'hubs') return renderNodes.filter((n) => n.kind === 'doc' && n.degree >= 2);
    return renderNodes; // explore
  }, [renderNodes, view]);

  const viewNodeIds = useMemo(() => new Set(viewNodes.map((n) => n.id)), [viewNodes]);

  const viewEdges = useMemo<RenderEdge[]>(() => {
    if (view === 'explore') return validEdges;
    // orphans / hubs 只保留真实文档之间的边
    return validEdges.filter(
      (e) => viewNodeIds.has(e.source) && viewNodeIds.has(e.target),
    );
  }, [validEdges, view, viewNodeIds]);

  // 重新布局触发
  const positions = useMemo<Record<string, Position>>(() => {
    if (!viewNodes.length || !size.w || !size.h) return {};
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    layoutSeed; // 引入依赖
    return layoutForce(viewNodes, viewEdges, size.w, size.h, 140);
  }, [viewNodes, viewEdges, size.w, size.h, layoutSeed]);

  const brokenEdges = useMemo(() => viewEdges.filter((e) => e.broken), [viewEdges]);

  const clusters = useMemo(() => {
    const seen = new Map<string, number>();
    // 目录分组图例仅统计内部文档；external/broken 合成节点不属于目录
    for (const n of renderNodes) {
      if (n.kind !== 'doc') continue;
      seen.set(n.cluster, (seen.get(n.cluster) ?? 0) + 1);
    }
    return Array.from(seen.entries()).map(([key, count]) => ({
      key,
      count,
      color: clusterColor(key),
    }));
  }, [renderNodes]);

  const handleReset = () => {
    setZoom(1);
    setSelectedNodeId(null);
    setHoverNodeId(null);
  };

  const handleRelayout = () => {
    setLayoutSeed((s) => s + 1);
    handleReset();
  };

  const handleNodeClick = (node: RenderNode) => {
    setSelectedNodeId(node.id === selectedNodeId ? null : node.id);
  };

  const handleOpenNode = (node: RenderNode) => {
    if (node.kind === 'external' && node.externalUrl) {
      window.open(node.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (node.kind !== 'doc') return; // broken 节点无跳转目标
    navigate(`/projects/${projectId}/browse?doc=${node.id}`);
  };

  const nodes = viewNodes;
  const edges = viewEdges;
  const hasData = nodes.length > 0;
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const hoverNode = hoverNodeId ? nodeById.get(hoverNodeId) ?? null : null;

  // ---- Loading ----
  if (isLoading) {
    return (
      <div className="h-full p-6 animate-fade-up">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="skeleton h-full w-full rounded-lg" />
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-400" />
          <div className="text-sm font-semibold text-neutral-700">图谱加载失败</div>
          <div className="text-xs text-neutral-500 mt-1">
            {(error as Error).message}
          </div>
          <button type="button" onClick={() => void refetch()}
            className="mt-4 btn-secondary !h-8 !text-xs inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> 重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-up">
      {/* ===== 工具栏（毛玻璃，对齐原型 ProjectGraph.jsx:258 bg-white/60 backdrop-blur） ===== */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b backdrop-blur"
        style={{
          borderColor: 'var(--border-soft)',
          // 半透明表面 + 背景模糊（亮暗双色随 --bg-surface 自动翻转）
          background: 'color-mix(in srgb, var(--bg-surface) 60%, transparent)',
        }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Network size={16} className="text-primary-600" />
            <span className="text-sm font-semibold text-neutral-900">知识图谱</span>
            {overview?.name && (
              <span className="text-xs text-neutral-400">· {overview.name}</span>
            )}
          </div>

          {/* 视图切换 pill */}
          <div className="inline-flex items-center rounded-full p-0.5"
            style={{ background: 'var(--bg-page)' }}>
            {([
              { k: 'explore', t: '探索', icon: Network },
              { k: 'orphans', t: '孤立节点', icon: XCircle },
              { k: 'hubs', t: '中心节点', icon: Sparkles },
            ] as const).map((o) => {
              const Icon = o.icon;
              const active = view === o.k;
              const count = o.k === 'orphans'
                ? renderNodes.filter((n) => n.degree === 0).length
                : 0;
              return (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => { setView(o.k); handleReset(); }}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    active
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <Icon size={12} />
                  {o.t}
                  {o.k === 'orphans' && count > 0 && (
                    <span className="text-[10px] text-red-500">({count})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* 统计 chip */}
          {hasData && (
            <div className="flex items-center gap-3 text-xs text-neutral-500 mr-2">
              <span className="flex items-center gap-1">
                <Network size={12} /> {nodes.length} 节点
              </span>
              <span className="flex items-center gap-1">
                <ExternalLink size={12} /> {edges.length} 边
              </span>
              {brokenEdges.length > 0 && (
                <span className="flex items-center gap-1 text-red-500">
                  <AlertTriangle size={12} /> {brokenEdges.length} 断链
                </span>
              )}
            </div>
          )}

          {/* 标签开关 */}
          <button
            type="button"
            onClick={() => setShowLabels((v) => !v)}
            className={`h-8 px-2 text-xs inline-flex items-center gap-1 rounded-md transition-colors ${
              showLabels
                ? 'bg-primary-50 text-primary-600'
                : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100'
            }`}
            title="切换标签显示"
          >
            <Tag size={12} /> 标签
          </button>

          {/* 缩放 */}
          <button type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
            title="缩小">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-neutral-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
            title="放大">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={handleReset}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
            title="重置视图">
            <Maximize2 size={14} />
          </button>
          <button type="button" onClick={handleRelayout}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
            title="重新布局">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ===== 图谱画布 ===== */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden"
        style={{ background: 'var(--bg-page)' }}>
        {!hasData ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                style={{ background: 'var(--bg-surface)' }}>
                <Network size={28} className="text-neutral-400" />
              </div>
              <div className="text-sm font-semibold text-neutral-700">暂无图谱数据</div>
              <div className="text-xs text-neutral-500 mt-1 max-w-sm">
                {view === 'orphans'
                  ? '当前项目没有孤立节点，所有文档都通过 [[链接]] 相互关联'
                  : '在文档中使用 [[链接]] 语法后，图谱会自动生成'}
              </div>
            </div>
          </div>
        ) : (
          <>
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${size.w} ${size.h}`}
              className="block"
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#9da3ae" />
                </marker>
                <marker
                  id="arrow-broken"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker
                  id="arrow-external"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7" />
                </marker>
              </defs>

              {/* 整组缩放：边 + 边标签 + 节点统一随 zoom 变换，
                  不再对每个节点单独 scale（旧实现边不缩放导致缩放后错位） */}
              <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${zoom}) translate(${-size.w / 2} ${-size.h / 2})`}>
                {/* 连线 */}
                {edges.map((e) => {
                  const a = positions[e.source];
                  const b = positions[e.target];
                  if (!a || !b) return null;
                  const isBroken = e.broken;
                  const isExternal = !!e.externalUrl;
                  const color = isBroken ? EDGE_BROKEN : isExternal ? EDGE_EXTERNAL : EDGE_NORMAL;
                  const marker = isBroken ? 'url(#arrow-broken)' : isExternal ? 'url(#arrow-external)' : 'url(#arrow)';
                  return (
                    <g key={e.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={color}
                        strokeWidth={isBroken ? 1.5 : 1}
                        strokeDasharray={isBroken ? '4 3' : 'none'}
                        markerEnd={marker}
                        opacity={isBroken ? 0.85 : 0.7}
                      />
                      {/* 边标签：external 显示主机名，broken 显示「缺失文档」 */}
                      {showLabels && e.label && (
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2 - 4}
                          textAnchor="middle"
                          fontSize={9}
                          fill={isBroken ? EDGE_BROKEN : isExternal ? EDGE_EXTERNAL : '#94a3b8'}
                          className="select-none pointer-events-none"
                        >
                          {e.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* 节点 */}
                <g>
                  {nodes.map((n) => {
                    const p = positions[n.id];
                    if (!p) return null;
                    const isHover = hoverNodeId === n.id;
                    const isSelected = selectedNodeId === n.id;
                    const isHub = view === 'hubs';
                    const isExternal = n.kind === 'external';
                    const isBroken = n.kind === 'broken';
                    const color = isExternal
                      ? EDGE_EXTERNAL
                      : isBroken
                        ? EDGE_BROKEN
                        : clusterColor(n.cluster);
                    const labelLen = Math.min(16, n.label.length);
                    const w = labelLen * 7 + 16;
                    const h = 22;
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${p.x}, ${p.y})`}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoverNodeId(n.id)}
                        onMouseLeave={() => setHoverNodeId(null)}
                        onClick={() => handleNodeClick(n)}
                        style={{
                          filter: isSelected || isHover
                            ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))'
                            : 'none',
                        }}
                      >
                        {/* hubs 视图加光环 */}
                        {(isHub || (n.kind === 'doc' && n.degree >= 3)) && (
                          <circle r={22} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
                        )}
                        {/* 节点形状按 kind 分支（对齐原型 renderNodeShape）：
                            external=紫色小方块；broken=红色虚线空心圆；doc=簇色标签圆角矩形 */}
                        {isExternal ? (
                          <rect
                            x={-12}
                            y={-12}
                            width={24}
                            height={24}
                            rx={4}
                            fill={color}
                            stroke="#ffffff"
                            strokeWidth={2}
                            opacity={0.9}
                          />
                        ) : isBroken ? (
                          <circle
                            r={10}
                            fill="none"
                            stroke={color}
                            strokeWidth={2}
                            strokeDasharray="3 2"
                            opacity={0.9}
                          />
                        ) : (
                          <rect
                            x={-w / 2}
                            y={-h / 2}
                            width={w}
                            height={h}
                            rx={4}
                            fill={color}
                            stroke="#ffffff"
                            strokeWidth={2}
                            opacity={0.92}
                          />
                        )}
                        {showLabels && (
                          <text
                            textAnchor="middle"
                            y={isExternal ? 24 : isBroken ? 22 : 4}
                            fontSize={10}
                            fontWeight={500}
                            // doc 节点标签深色 #374151 + 14 字符截断（对齐原型 ProjectGraph.jsx:460-471）
                            fill="#374151"
                            className="select-none pointer-events-none"
                          >
                            {n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>

            {/* ===== 图例（左下，毛玻璃，对齐原型 ProjectGraph.jsx:480 bg-white/95 backdrop-blur）===== */}
            <div className="absolute bottom-4 left-4 rounded-lg border shadow-sm p-3 min-w-[180px] backdrop-blur"
              style={{
                borderColor: 'var(--border-soft)',
                background: 'color-mix(in srgb, var(--bg-surface) 95%, transparent)',
              }}>
              <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                目录分组
              </div>
              <div className="space-y-1.5">
                {clusters.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 text-xs">
                    <span
                      className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-neutral-700 truncate flex-1">{c.key}</span>
                    <span className="text-neutral-400 text-[10px]">{c.count}</span>
                  </div>
                ))}
                {clusters.length === 0 && (
                  <div className="text-xs text-neutral-400">—</div>
                )}
              </div>
              {brokenEdges.length > 0 && (
                <div className="mt-2 pt-2 border-t flex items-center gap-1.5 text-xs text-red-500"
                  style={{ borderColor: 'var(--border-soft)' }}>
                  <AlertTriangle size={12} />
                  {brokenEdges.length} 条断链
                </div>
              )}
            </div>

            {/* ===== 节点详情（右下）===== */}
            {selectedNode && (
              <div className="absolute bottom-4 right-4 rounded-lg border shadow-lg w-[280px] p-3"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-900 line-clamp-2">
                    {selectedNode.label}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(null)}
                    className="p-1 h-6 w-6 inline-flex items-center justify-center rounded text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
                  >
                    <X size={12} />
                  </button>
                </div>
                {/* 类型行（对齐原型 :518-531）：文档显示聚类，external/broken 显示类型 */}
                <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                  {selectedNode.kind === 'doc' ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: clusterColor(selectedNode.cluster) }}
                        />
                        {selectedNode.cluster}
                      </span>
                      <span>·</span>
                      <span>文档</span>
                    </>
                  ) : selectedNode.kind === 'external' ? (
                    <span className="inline-flex items-center gap-1 text-purple-600">
                      <ExternalLink size={11} />
                      外部链接
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-500">
                      <AlertTriangle size={11} />
                      断链
                    </span>
                  )}
                </div>
                {/* 副信息：文档显示路径，外部链接显示 URL，断链显示说明 */}
                {selectedNode.kind === 'doc' && selectedNode.path && (
                  <div className="mt-1 text-[11px] font-mono text-neutral-400 truncate">
                    {selectedNode.path}
                  </div>
                )}
                {selectedNode.kind === 'external' && selectedNode.externalUrl && (
                  <div className="mt-1 text-[11px] font-mono text-neutral-400 break-all line-clamp-2">
                    {selectedNode.externalUrl}
                  </div>
                )}
                {selectedNode.kind === 'broken' && (
                  <div className="mt-1 text-[11px] text-neutral-400">
                    链接目标文档不存在或尚未同步
                  </div>
                )}
                <div className="mt-2 text-[11px] text-neutral-500">
                  关联数：
                  <span className="font-semibold text-neutral-700">{selectedNode.degree}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  {selectedNode.kind === 'doc' && (
                    <button
                      type="button"
                      onClick={() => handleOpenNode(selectedNode)}
                      className="flex-1 inline-flex items-center justify-center gap-1 h-7 px-3 rounded-md text-xs font-medium text-white transition-colors"
                      style={{ background: 'var(--color-primary-600)' }}
                    >
                      打开文档
                    </button>
                  )}
                  {selectedNode.kind === 'external' && (
                    <button
                      type="button"
                      onClick={() => handleOpenNode(selectedNode)}
                      className="flex-1 inline-flex items-center justify-center gap-1 h-7 px-3 rounded-md text-xs font-medium text-white transition-colors"
                      style={{ background: 'var(--color-primary-600)' }}
                    >
                      <ExternalLink size={12} />
                      在新窗口打开
                    </button>
                  )}
                  {/* 裁剪维度：断链修复/重新关联后端尚无接口，按钮置灰占位 */}
                  {selectedNode.kind === 'broken' && (
                    <button
                      type="button"
                      disabled
                      className="flex-1 inline-flex items-center justify-center gap-1 h-7 px-3 rounded-md text-xs font-medium text-neutral-400 cursor-not-allowed"
                      style={{ background: 'var(--bg-hover)' }}
                    >
                      <XCircle size={12} />
                      目标缺失
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ===== Hover tooltip（顶部中）===== */}
            {hoverNode && !selectedNode && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border shadow-md px-3 py-1.5 text-xs text-neutral-700 whitespace-nowrap pointer-events-none"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: clusterColor(hoverNode.cluster) }}
                />
                {hoverNode.label}
                <span className="text-neutral-400 ml-2">
                  关联 {hoverNode.degree}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
