import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Network, ExternalLink, AlertTriangle, Sparkles, ZoomIn, ZoomOut,
  Maximize2, RefreshCw, XCircle, Tag,
} from 'lucide-react'
import { fetchProject, fetchProjectGraph } from '../api/stubs.js'

// ---------------------------------------------------------------------------
// 简易力导向布局（不依赖第三方库，原型级别足够）
// ---------------------------------------------------------------------------
function layoutForce(nodes, edges, width, height, iterations = 120) {
  // 初始位置：环形分布
  const positions = {}
  const cx = width / 2
  const cy = height / 2
  const r0 = Math.min(width, height) / 3
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    positions[n.id] = {
      x: cx + r0 * Math.cos(angle) + (Math.random() - 0.5) * 30,
      y: cy + r0 * Math.sin(angle) + (Math.random() - 0.5) * 30,
      vx: 0,
      vy: 0,
    }
  })

  const kRepulse = 6000
  const kSpring = 0.015
  const idealLen = 140
  const damping = 0.82

  for (let iter = 0; iter < iterations; iter++) {
    // 斥力：每对节点
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions[nodes[i].id]
        const b = positions[nodes[j].id]
        const dx = b.x - a.x
        const dy = b.y - a.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1) dist2 = 1
        const dist = Math.sqrt(dist2)
        const force = kRepulse / dist2
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }
    // 弹簧力：边上的节点
    edges.forEach((e) => {
      const a = positions[e.from]
      const b = positions[e.to]
      if (!a || !b) return
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const targetDiff = dist - idealLen
      const fx = (dx / dist) * targetDiff * kSpring
      const fy = (dy / dist) * targetDiff * kSpring
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    })
    // 更新位置 + 阻尼 + 边界
    nodes.forEach((n) => {
      const p = positions[n.id]
      p.vx *= damping
      p.vy *= damping
      p.x += p.vx
      p.y += p.vy
      const pad = 40
      if (p.x < pad) { p.x = pad; p.vx *= -0.3 }
      if (p.x > width - pad) { p.x = width - pad; p.vx *= -0.3 }
      if (p.y < pad) { p.y = pad; p.vy *= -0.3 }
      if (p.y > height - pad) { p.y = height - pad; p.vy *= -0.3 }
    })
  }

  return positions
}

// ---------------------------------------------------------------------------
// 节点形状：doc 画圆角矩形，external 画小方块，broken 画虚线圆
// ---------------------------------------------------------------------------
function renderNodeShape(node, clusterColor) {
  const r = node.type === 'external' ? 6 : 4
  const fill = node.broken ? '#fecaca' : clusterColor
  if (node.type === 'external') {
    return (
      <>
        <rect
          width={24}
          height={24}
          x={-12}
          y={-12}
          rx={4}
          fill={fill}
          stroke="#fff"
          strokeWidth={2}
          opacity={0.9}
        />
      </>
    )
  }
  if (node.broken) {
    return (
      <circle
        r={10}
        fill="none"
        stroke="#ef4444"
        strokeWidth={2}
        strokeDasharray="3 2"
        opacity={0.9}
      />
    )
  }
  // 普通文档节点
  const labelLen = Math.min(16, (node.label || '').length)
  const w = labelLen * 7 + 16
  const h = 22
  return (
    <g>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={r}
        fill={fill}
        stroke="#ffffff"
        strokeWidth={2}
        opacity={0.92}
      />
    </g>
  )
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export default function ProjectGraph() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [data, setData] = useState(null)     // 当前视图下的 graph data
  const [fullData, setFullData] = useState(null)
  const [view, setView] = useState('explore') // 'explore' | 'orphans' | 'hubs'
  const [loading, setLoading] = useState(true)
  const [hoverNode, setHoverNode] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)

  const [size, setSize] = useState({ w: 960, h: 560 })
  const containerRef = useRef(null)

  // 监听容器尺寸
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 960, h: el.clientHeight || 560 })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth || 960, h: el.clientHeight || 560 })
    return () => ro.disconnect()
  }, [])

  // 加载数据
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [proj, gd] = await Promise.all([
        fetchProject(id),
        fetchProjectGraph(id, view),
      ])
      if (cancelled) return
      setProject(proj)
      setData(gd)
      if (!fullData) {
        const full = await fetchProjectGraph(id, 'explore')
        if (!cancelled) setFullData(full)
      }
      setTimeout(() => { if (!cancelled) setLoading(false) }, 400)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, view])

  // 布局计算（依赖 data + 尺寸）
  const positions = useMemo(() => {
    if (!data || !size.w || !data.nodes || data.nodes.length === 0) return {}
    return layoutForce(data.nodes, data.edges || [], size.w, size.h, 140)
  }, [data, size.w, size.h])

  // cluster 颜色映射
  const clusterColorMap = useMemo(() => {
    const map = {}
    ;(data?.clusters || []).forEach((c) => { map[c.key] = c.color })
    return map
  }, [data])

  // 断链标记的边
  const brokenEdges = useMemo(() => (data?.edges || []).filter((e) => e.broken), [data])

  // 节点出入度（给 hubs 视图高亮）
  const nodeDegree = useMemo(() => {
    const deg = {}
    ;(data?.nodes || []).forEach((n) => { deg[n.id] = 0 })
    ;(data?.edges || []).forEach((e) => {
      if (deg[e.from] != null) deg[e.from]++
      if (deg[e.to] != null) deg[e.to]++
    })
    return deg
  }, [data])

  const handleNodeClick = (node) => {
    setSelectedNode(node)
    if (node.url) {
      if (node.type === 'external') {
        // 外部链接：打开新窗口（原型用 alert 提示）
        // eslint-disable-next-line no-alert
        alert(`外部链接：${node.url}`)
      } else {
        navigate(node.url)
      }
    }
  }

  const handleReset = () => {
    setZoom(1)
    setSelectedNode(null)
    setHoverNode(null)
  }

  if (loading) {
    return (
      <div className="h-full p-6 animate-fade-up">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="skeleton h-full w-full rounded-lg" />
      </div>
    )
  }

  const nodes = data?.nodes || []
  const edges = data?.edges || []
  const hasData = nodes.length > 0

  return (
    <div className="h-full flex flex-col animate-fade-up">
      {/* ===== 工具栏 ===== */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-neutral-200 bg-white/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Network size={16} className="text-primary-600" />
            <span className="text-sm font-semibold text-neutral-900">知识图谱</span>
            {project && (
              <span className="text-xs text-neutral-400">· {project.name}</span>
            )}
          </div>

          {/* 视图切换 pill */}
          <div className="inline-flex items-center bg-neutral-100 rounded-full p-0.5 ml-2">
            {[
              { k: 'explore', t: '探索', icon: Network },
              { k: 'orphans', t: '孤立节点', icon: XCircle },
              { k: 'hubs', t: '中心节点', icon: Sparkles },
            ].map((o) => {
              const Icon = o.icon
              const active = view === o.k
              return (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => { setView(o.k); handleReset() }}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    active
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <Icon size={12} />
                  {o.t}
                  {o.k === 'orphans' && data?.orphans?.length > 0 && (
                    <span className="text-[10px] text-red-500">({data.orphans.length})</span>
                  )}
                </button>
              )
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
            className={`btn-ghost !h-8 !px-2 text-xs inline-flex items-center gap-1 ${
              showLabels ? 'text-primary-600 bg-primary-50' : ''
            }`}
            title="切换标签显示"
          >
            <Tag size={12} />
            标签
          </button>

          {/* 缩放 */}
          <button type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} className="btn-ghost !h-8 !w-8 !p-0" title="缩小">
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-neutral-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, z + 0.15))} className="btn-ghost !h-8 !w-8 !p-0" title="放大">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={handleReset} className="btn-ghost !h-8 !w-8 !p-0" title="重置视图">
            <Maximize2 size={14} />
          </button>
          <button type="button" onClick={() => handleReset()} className="btn-ghost !h-8 !w-8 !p-0" title="重新布局">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ===== 图谱画布 ===== */}
      <div ref={containerRef} className="flex-1 relative bg-surface-subtle overflow-hidden">
        {!hasData ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-100 flex items-center justify-center">
                <Network size={28} className="text-neutral-400" />
              </div>
              <div className="text-sm font-semibold text-neutral-700">暂无图谱数据</div>
              <div className="text-xs text-neutral-500 mt-1">
                在文档中使用 <code className="font-mono bg-neutral-100 rounded px-1">[[链接]]</code> 或导入外部网页后，图谱会自动生成
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
              </defs>

              {/* 连线 */}
              {edges.map((e, i) => {
                const a = positions[e.from]
                const b = positions[e.to]
                if (!a || !b) return null
                const isBroken = e.broken
                const color = isBroken ? '#ef4444' : '#cbd5e1'
                return (
                  <g key={`e-${i}`}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={color}
                      strokeWidth={isBroken ? 1.5 : 1}
                      strokeDasharray={isBroken ? '4 3' : 'none'}
                      markerEnd={isBroken ? 'url(#arrow-broken)' : 'url(#arrow)'}
                      opacity={isBroken ? 0.85 : 0.7}
                      style={{ transform: `scale(${zoom})`, transformOrigin: `${size.w / 2}px ${size.h / 2}px` }}
                    />
                    {showLabels && e.label && (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 4}
                        textAnchor="middle"
                        fontSize={9}
                        fill={isBroken ? '#ef4444' : '#94a3b8'}
                        className="select-none pointer-events-none"
                        style={{ transform: `scale(${zoom})`, transformOrigin: `${size.w / 2}px ${size.h / 2}px` }}
                      >
                        {e.label}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* 节点 */}
              <g style={{ transform: `scale(${zoom})`, transformOrigin: `${size.w / 2}px ${size.h / 2}px` }}>
                {nodes.map((n) => {
                  const p = positions[n.id]
                  if (!p) return null
                  const isHover = hoverNode?.id === n.id
                  const isSelected = selectedNode?.id === n.id
                  const isHub = view === 'hubs' && (nodeDegree[n.id] || 0) >= 2
                  const color = clusterColorMap[n.cluster] || '#6b7280'
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x}, ${p.y})`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoverNode(n)}
                      onMouseLeave={() => setHoverNode(null)}
                      onClick={() => handleNodeClick(n)}
                      style={{
                        filter: isSelected || isHover
                          ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))'
                          : 'none',
                      }}
                    >
                      {/* hubs 视图加光环 */}
                      {isHub && (
                        <circle r={22} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
                      )}
                      {renderNodeShape(n, color)}
                      {showLabels && (
                        <text
                          textAnchor="middle"
                          y={n.type === 'external' ? 22 : 0}
                          dy={n.type === 'external' ? 0 : 4}
                          fontSize={10}
                          fontWeight={500}
                          fill="#374151"
                          className="select-none pointer-events-none"
                        >
                          {n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>

            {/* ===== 图例（左下）===== */}
            <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-lg border border-neutral-200 shadow-sm p-3 min-w-[180px]">
              <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                Cluster 图例
              </div>
              <div className="space-y-1.5">
                {(data?.clusters || []).map((c) => (
                  <div key={c.key} className="flex items-center gap-2 text-xs">
                    <span
                      className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-neutral-700 truncate">{c.key}</span>
                  </div>
                ))}
              </div>
              {brokenEdges.length > 0 && (
                <div className="mt-2 pt-2 border-t border-neutral-100 flex items-center gap-1.5 text-xs text-red-500">
                  <AlertTriangle size={12} />
                  {brokenEdges.length} 条断链
                </div>
              )}
            </div>

            {/* ===== 节点详情（右下）===== */}
            {selectedNode && (
              <div className="absolute bottom-4 right-4 bg-white rounded-lg border border-neutral-200 shadow-lg w-[280px] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-900 line-clamp-2">
                    {selectedNode.label}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !p-1 !h-6 !w-6"
                    onClick={() => setSelectedNode(null)}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: clusterColorMap[selectedNode.cluster] || '#6b7280' }}
                    />
                    {selectedNode.cluster}
                  </span>
                  <span>·</span>
                  <span>{selectedNode.type === 'external' ? '外部链接' : '文档'}</span>
                  {selectedNode.broken && (
                    <span className="text-red-500">· 已损坏</span>
                  )}
                </div>
                <div className="mt-2 text-[11px] text-neutral-500">
                  度：<span className="font-semibold text-neutral-700">{nodeDegree[selectedNode.id] || 0}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedNode.url) navigate(selectedNode.url)
                    }}
                    className="btn-primary !py-1 !text-xs flex-1"
                    disabled={!selectedNode.url && selectedNode.type !== 'external'}
                  >
                    打开
                  </button>
                  {selectedNode.type === 'external' && (
                    <a
                      href={selectedNode.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary !py-1 !text-xs inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} /> 外部
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* ===== Hover tooltip（顶部中）===== */}
            {hoverNode && !selectedNode && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white border border-neutral-200 rounded-md shadow-md px-3 py-1.5 text-xs text-neutral-700 whitespace-nowrap pointer-events-none">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: clusterColorMap[hoverNode.cluster] || '#6b7280' }}
                />
                {hoverNode.label}
                <span className="text-neutral-400 ml-2">
                  度 {nodeDegree[hoverNode.id] || 0}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
