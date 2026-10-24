import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DbKind, DbObject, TableDesign } from '@shared/types'
import { boundsOf, buildGraph, HEADER_H, layoutGraph, ROW_H, routeEdge, type ErNode, type Placed } from '@shared/erLayout'
import { errMsg, unwrap } from './api'
import { download } from './exportData'
import { ThemeContext } from './theme'

const MAX_TABLES = 250
const LOAD_PARALLEL = 8
const MIN_SCALE = 0.1
const MAX_SCALE = 2.5

const PALETTES = {
  light: { bg: '#f6f7f9', body: '#ffffff', head: '#e3e8ee', border: '#aab3c0', text: '#1f2530', muted: '#6b7482', edge: '#7b8a9e', hot: '#0f9d8a', pk: '#c98a1b', fk: '#2f6fdb', hit: '#e0a800' },
  dark: { bg: '#15171c', body: '#1d2027', head: '#2a303b', border: '#4a5262', text: '#dde1e8', muted: '#8d96a6', edge: '#7e8aa0', hot: '#2bb5a0', pk: '#e0aa3e', fk: '#6ea0ff', hit: '#f0c040' }
}

type Positions = Record<string, Placed>
interface View {
  tx: number
  ty: number
  scale: number
}

const storageKey = (connId: string, container: string): string => `zivar-er:${connId}:${container}`

function loadPositions(key: string): Positions {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Positions) : {}
  } catch {
    return {}
  }
}
function savePositions(key: string, p: Positions): void {
  try {
    localStorage.setItem(key, JSON.stringify(p))
  } catch {
    /* positions just won't be remembered */
  }
}

interface Props {
  connId: string
  container: string
  kind: DbKind
  refreshKey: number
  onOpenTable: (obj: DbObject) => void
}

export function ErDiagramTab({ connId, container, kind, refreshKey, onOpenTable }: Props): JSX.Element {
  const theme = useContext(ThemeContext)
  const pal = PALETTES[theme]
  const key = storageKey(connId, container)

  const [designs, setDesigns] = useState<TableDesign[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [compact, setCompact] = useState(false)
  const [positions, setPositions] = useState<Positions>({})
  const [view, setView] = useState<View>({ tx: 20, ty: 20, scale: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fitted = useRef(false)

  /* ── load every table's design, a few at a time ── */
  useEffect(() => {
    let stale = false
    setError(null)
    void (async () => {
      try {
        const all = (await unwrap(window.api.objects(connId, container))).filter((o) => o.type === 'table')
        const list = all.slice(0, MAX_TABLES)
        if (stale) return
        setTruncated(all.length > MAX_TABLES)
        const out: TableDesign[] = new Array(list.length)
        let next = 0
        let done = 0
        setProgress({ done: 0, total: list.length })
        const worker = async (): Promise<void> => {
          while (!stale) {
            const i = next++
            if (i >= list.length) return
            out[i] = await unwrap(window.api.designInfo(connId, container, list[i]))
            setProgress({ done: ++done, total: list.length })
          }
        }
        await Promise.all(Array.from({ length: Math.min(LOAD_PARALLEL, list.length) }, worker))
        if (stale) return
        fitted.current = false
        setDesigns(out)
        setProgress(null)
      } catch (e) {
        if (!stale) {
          setError(errMsg(e))
          setProgress(null)
        }
      }
    })()
    return () => {
      stale = true
    }
  }, [connId, container, refreshKey])

  const graph = useMemo(() => buildGraph(designs ?? [], compact), [designs, compact])
  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.name, n])), [graph])

  // Saved positions win; tables without one (new, or never moved) come from the automatic layout.
  useEffect(() => {
    if (!designs) return
    const saved = loadPositions(key)
    const auto = layoutGraph(graph)
    const merged: Positions = {}
    for (const n of graph.nodes) merged[n.name] = saved[n.name] ?? auto.get(n.name) ?? { x: 0, y: 0 }
    setPositions(merged)
  }, [designs, graph, key])

  const posMap = useMemo(() => new Map(Object.entries(positions)), [positions])

  const autoLayout = (): void => {
    const auto = layoutGraph(graph)
    const next: Positions = {}
    for (const n of graph.nodes) next[n.name] = auto.get(n.name) ?? { x: 0, y: 0 }
    setPositions(next)
    savePositions(key, next)
    fitted.current = false
  }

  const fit = useCallback((): void => {
    const el = wrapRef.current
    if (!el || graph.nodes.length === 0 || posMap.size === 0) return
    const b = boundsOf(graph.nodes, posMap)
    const w = el.clientWidth
    const h = el.clientHeight
    const scale = Math.max(MIN_SCALE, Math.min(1.2, w / b.w, h / b.h))
    setView({ scale, tx: (w - b.w * scale) / 2 - b.x * scale, ty: (h - b.h * scale) / 2 - b.y * scale })
  }, [graph.nodes, posMap])

  // Fit once the first layout exists (and again after Auto layout / reload).
  useEffect(() => {
    if (!fitted.current && posMap.size > 0) {
      fitted.current = true
      fit()
    }
  }, [posMap, fit])

  /* ── interaction ── */
  const zoomAt = (factor: number, cx?: number, cy?: number): void => {
    setView((v) => {
      const el = wrapRef.current
      const px = cx ?? (el ? el.clientWidth / 2 : 0)
      const py = cy ?? (el ? el.clientHeight / 2 : 0)
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
      const k = scale / v.scale
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }
    })
  }

  const onWheel = (e: React.WheelEvent): void => {
    const rect = wrapRef.current?.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0))
  }

  const startPan = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    setSelected(null)
    const sx = e.clientX
    const sy = e.clientY
    const origin = view
    const move = (ev: MouseEvent): void => setView({ ...origin, tx: origin.tx + ev.clientX - sx, ty: origin.ty + ev.clientY - sy })
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const startDrag = (e: React.MouseEvent, name: string): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelected(name)
    const sx = e.clientX
    const sy = e.clientY
    const origin = positions[name]
    const scale = view.scale
    let latest = positions
    const move = (ev: MouseEvent): void => {
      latest = { ...positions, [name]: { x: origin.x + (ev.clientX - sx) / scale, y: origin.y + (ev.clientY - sy) / scale } }
      setPositions(latest)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      savePositions(key, latest)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Search: highlight matches and bring the first one to the centre.
  const needle = search.trim().toLowerCase()
  const hits = useMemo(() => (needle ? graph.nodes.filter((n) => n.name.toLowerCase().includes(needle)).map((n) => n.name) : []), [needle, graph.nodes])
  useEffect(() => {
    const el = wrapRef.current
    const first = hits[0]
    if (!el || !first) return
    const n = nodeMap.get(first)
    const p = positions[first]
    if (!n || !p) return
    setView((v) => ({ ...v, tx: el.clientWidth / 2 - (p.x + n.w / 2) * v.scale, ty: el.clientHeight / 2 - (p.y + n.h / 2) * v.scale }))
    // Only a new search should recentre; dragging a table must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle])

  /* ── export ── */
  const standaloneSvg = (): { svg: string; w: number; h: number } | null => {
    const el = svgRef.current
    if (!el || graph.nodes.length === 0) return null
    const b = boundsOf(graph.nodes, posMap)
    const clone = el.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`)
    clone.setAttribute('width', String(Math.round(b.w)))
    clone.setAttribute('height', String(Math.round(b.h)))
    clone.querySelector('g.er-root')?.removeAttribute('transform') // export the whole diagram, not the current pan/zoom
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    for (const [k, v] of Object.entries({ x: String(b.x), y: String(b.y), width: String(b.w), height: String(b.h), fill: pal.bg })) bg.setAttribute(k, v)
    clone.insertBefore(bg, clone.firstChild)
    return { svg: new XMLSerializer().serializeToString(clone), w: b.w, h: b.h }
  }

  const exportSvg = (): void => {
    const s = standaloneSvg()
    if (s) download(new Blob([s.svg], { type: 'image/svg+xml;charset=utf-8' }), `${container}-diagram.svg`)
  }

  const exportPng = (): void => {
    const s = standaloneSvg()
    if (!s) return
    const scale = Math.min(3, 8000 / Math.max(s.w, s.h)) // sharp, but never an unreasonably huge bitmap
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(s.w * scale)
      canvas.height = Math.round(s.h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return setError('Could not create an image for the diagram.')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => blob && download(blob, `${container}-diagram.png`), 'image/png')
    }
    img.onerror = () => setError('Could not render the diagram to PNG.')
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`
  }

  /* ── drawing ── */
  const related = useMemo(() => {
    if (!selected) return null
    const set = new Set([selected])
    for (const e of graph.edges) if (e.from === selected || e.to === selected) (set.add(e.from), set.add(e.to))
    return set
  }, [selected, graph.edges])

  const routes = useMemo(
    () => graph.edges.map((e) => ({ e, r: routeEdge(e, nodeMap, posMap) })).filter((x): x is { e: (typeof graph.edges)[number]; r: NonNullable<ReturnType<typeof routeEdge>> } => x.r !== null),
    [graph.edges, nodeMap, posMap]
  )

  const renderNode = (n: ErNode): JSX.Element | null => {
    const p = positions[n.name]
    if (!p) return null
    const dim = related ? !related.has(n.name) : false
    const isSel = selected === n.name
    const isHit = hits.includes(n.name)
    return (
      <g key={n.name} className="er-table" data-name={n.name} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.35 : 1}>
        <rect width={n.w} height={n.h} rx={6} fill={pal.body} stroke={isSel ? pal.hot : isHit ? pal.hit : pal.border} strokeWidth={isSel || isHit ? 2 : 1} />
        <path d={`M0 ${HEADER_H} V6 a6 6 0 0 1 6 -6 H${n.w - 6} a6 6 0 0 1 6 6 V${HEADER_H} Z`} fill={pal.head} />
        <g className="er-head" style={{ cursor: 'grab' }} onMouseDown={(e) => startDrag(e, n.name)} onDoubleClick={() => onOpenTable({ name: n.name, type: 'table', schema: kind === 'postgres' ? container : kind === 'mssql' ? 'dbo' : undefined })}>
          <rect width={n.w} height={HEADER_H} fill="transparent" />
          <text x={10} y={HEADER_H / 2 + 4.5} fontSize={13} fontWeight={700} fill={pal.text} fontFamily="Segoe UI, system-ui, sans-serif">
            {n.name}
          </text>
        </g>
        <line x1={0} x2={n.w} y1={HEADER_H} y2={HEADER_H} stroke={pal.border} />
        {n.rows.map((c, i) => {
          const y = HEADER_H + i * ROW_H + ROW_H / 2 + 4
          return (
            <g key={c.name}>
              <text x={8} y={y} fontSize={9} fontWeight={700} fill={c.pk ? pal.pk : pal.fk} fontFamily="Segoe UI, system-ui, sans-serif">
                {c.pk && c.fk ? 'PK·FK' : c.pk ? 'PK' : c.fk ? 'FK' : ''}
              </text>
              <text x={compact || n.rows.some((r) => r.pk && r.fk) ? 40 : 28} y={y} fontSize={12} fill={pal.text} fontWeight={c.pk ? 700 : 400} fontFamily="Segoe UI, system-ui, sans-serif">
                {c.name}
              </text>
              <text x={n.w - 8} y={y} fontSize={11} textAnchor="end" fill={pal.muted} fontFamily="Segoe UI, system-ui, sans-serif">
                {c.type.length > 24 ? `${c.type.slice(0, 23)}…` : c.type}
              </text>
            </g>
          )
        })}
        {n.rows.length === 0 && (
          <text x={10} y={HEADER_H + 15} fontSize={11} fill={pal.muted} fontFamily="Segoe UI, system-ui, sans-serif">
            (no key columns)
          </text>
        )}
      </g>
    )
  }

  if (error) return <div className="msg error">{error}</div>
  if (progress || !designs) {
    return (
      <div className="msg">
        Reading tables… {progress ? `${progress.done} / ${progress.total}` : ''}
      </div>
    )
  }

  return (
    <div className="pane-col">
      <div className="subtoolbar">
        <button onClick={autoLayout} title="Arrange the tables again, discarding your own positions">
          Auto layout
        </button>
        <button onClick={fit}>Fit</button>
        <button onClick={() => zoomAt(1 / 1.2)} title="Zoom out">
          −
        </button>
        <span className="muted zoom-label">{Math.round(view.scale * 100)}%</span>
        <button onClick={() => zoomAt(1.2)} title="Zoom in">
          ＋
        </button>
        <label className="check" title="Show only primary and foreign key columns">
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
          Keys only
        </label>
        <div className="grow" />
        <input className="lib-filter" placeholder="Find table" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={exportSvg} disabled={graph.nodes.length === 0}>
          SVG
        </button>
        <button onClick={exportPng} disabled={graph.nodes.length === 0}>
          PNG
        </button>
      </div>
      {truncated && <div className="banner warn">Only the first {MAX_TABLES} tables are drawn.</div>}
      <div className="er-wrap" ref={wrapRef} onWheel={onWheel} onMouseDown={startPan} style={{ background: pal.bg }}>
        {graph.nodes.length === 0 ? (
          <div className="msg muted">This database has no tables.</div>
        ) : (
          <svg ref={svgRef} className="er-svg" width="100%" height="100%">
            <g className="er-root" transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
              {routes.map(({ e, r }) => {
                const hot = selected !== null && (e.from === selected || e.to === selected)
                const dim = selected !== null && !hot
                const end = (pt: { x: number; y: number; side: 'left' | 'right' }, label: string): JSX.Element => (
                  <text x={pt.x + (pt.side === 'right' ? 5 : -5)} y={pt.y - 4} fontSize={10} fontWeight={700} textAnchor={pt.side === 'right' ? 'start' : 'end'} fill={hot ? pal.hot : pal.muted} fontFamily="Segoe UI, system-ui, sans-serif">
                    {label}
                  </text>
                )
                return (
                  <g key={e.id} className="er-edge" data-from={e.from} data-to={e.to} opacity={dim ? 0.2 : 1}>
                    <path d={r.d} fill="none" stroke={hot ? pal.hot : pal.edge} strokeWidth={hot ? 2 : 1.3} />
                    <circle cx={r.from.x} cy={r.from.y} r={2.5} fill={hot ? pal.hot : pal.edge} />
                    {end(r.from, 'N')}
                    {end(r.to, '1')}
                    <title>{`${e.from}.${e.fromColumn} → ${e.to}.${e.toColumn} (${e.name})`}</title>
                  </g>
                )
              })}
              {graph.nodes.map(renderNode)}
            </g>
          </svg>
        )}
      </div>
      <div className="statusline">
        <span>
          {graph.nodes.length} table(s), {graph.edges.length} relation(s){hits.length ? ` · ${hits.length} match(es)` : ''}
        </span>
        <span className="muted">Drag a table to move it · drag the background to pan · scroll to zoom · double-click a title to open the data</span>
      </div>
    </div>
  )
}
