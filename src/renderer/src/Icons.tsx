import type { JSX, ReactNode } from 'react'
import type { DbKind } from '@shared/types'

interface IconProps {
  size?: number
  className?: string
}

function make(children: ReactNode, filled = false) {
  return function Icon({ size = 16, className }: IconProps): JSX.Element {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    )
  }
}

/** The product mark: a Z drawn through two nodes, on a teal tile. Same artwork as resources/icon.svg. */
export function ZivarLogo({ size = 44 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <linearGradient id="zv-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22c9b2" />
          <stop offset="1" stopColor="#0a6f62" />
        </linearGradient>
        <linearGradient id="zv-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="zv-clip">
          <rect x="8" y="8" width="240" height="240" rx="58" />
        </clipPath>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="58" fill="url(#zv-bg)" />
      <rect x="8" y="8" width="240" height="130" fill="url(#zv-shine)" clipPath="url(#zv-clip)" />
      <g stroke="#fff" strokeOpacity="0.13" strokeWidth="4" strokeLinecap="round">
        <path d="M40 62H216M40 128H216M40 194H216" />
        <path d="M100 40V216M156 40V216" />
      </g>
      <path d="M78 86H178L78 170H178" fill="none" stroke="#fff" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="78" cy="86" r="17" fill="#ffb547" stroke="#0a6f62" strokeWidth="6" />
      <circle cx="178" cy="170" r="17" fill="#ffb547" stroke="#0a6f62" strokeWidth="6" />
    </svg>
  )
}

export const IconPlug = make(<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" />)
export const IconQuery = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 10l3 2-3 2M13 15h4" />
  </>
)
export const IconTable = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M9 4v16" />
  </>
)
export const IconView = make(
  <>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
)
export const IconDatabase = make(
  <>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </>
)
export const IconSchema = make(<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />)
export const IconRefresh = make(<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />)
export const IconExport = make(<path d="M12 4v11M7 11l5 5 5-5M4 20h16" />)
export const IconImport = make(<path d="M12 16V5M7 9l5-5 5 5M4 20h16" />)
export const IconMoon = make(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />)
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>
)
export const IconDiagram = make(
  <>
    <rect x="3" y="3" width="7" height="6" rx="1" />
    <rect x="14" y="3" width="7" height="6" rx="1" />
    <rect x="8.5" y="15" width="7" height="6" rx="1" />
    <path d="M6.5 9v3h11V9M12 12v3" />
  </>
)
export const IconJson = make(<path d="M8 4C6 4 6 6 6 8s0 3-2 4c2 1 2 2 2 4s0 4 2 4M16 4c2 0 2 2 2 4s0 3 2 4c-2 1-2 2-2 4s0 4-2 4" />)
export const IconFilter = make(<path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />)
export const IconPanel = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 14h18" />
  </>
)
export const IconPlay = make(<path d="M7 4l13 8-13 8V4z" />, true)
export const IconPlus = make(<path d="M12 5v14M5 12h14" />)
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.5-4.5" />
  </>
)
export const IconFolder = make(
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
)
export const IconKey = make(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3" />
  </>
)
export const IconCode = make(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />)
export const IconDesign = make(
  <>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13 7l4 4" />
  </>
)
export const IconList = make(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />)
export const IconDisconnect = make(<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM4 4l16 16" />)

const KIND_LABEL: Record<DbKind, string> = { postgres: 'PG', mysql: 'My', sqlite: 'Sq', mssql: 'MS' }

/** Small coloured tag identifying the database engine of a connection. */
export function KindBadge({ kind }: { kind: DbKind }): JSX.Element {
  return <span className={`kind kind-${kind}`}>{KIND_LABEL[kind]}</span>
}

export const IconFunction = make(
  <>
    <path d="M14 4h-1a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H6M7 11h6" />
    <path d="M14 14l6 6M20 14l-6 6" />
  </>
)
export const IconMatView = make(
  <>
    <rect x="3" y="8" width="14" height="12" rx="2" />
    <path d="M7 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M3 13h14M9 8v12" />
  </>
)
