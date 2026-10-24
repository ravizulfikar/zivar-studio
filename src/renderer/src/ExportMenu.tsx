import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { ExportFormat } from './exportData'
import { IconExport } from './Icons'

interface Props {
  disabled?: boolean
  onExport: (format: ExportFormat) => void
  /** Toolbar style (icon above label) or the compact in-tab button. */
  variant: 'tool' | 'small'
}

/** A button that opens a small CSV / Excel chooser. */
export function ExportMenu({ disabled, onExport, variant }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const pick = (f: ExportFormat): void => {
    setOpen(false)
    onExport(f)
  }

  const label: ReactNode =
    variant === 'tool' ? (
      <>
        <span className="tool-icon">
          <IconExport size={22} />
        </span>
        <span>Export ▾</span>
      </>
    ) : (
      <>
        <IconExport size={14} /> Export ▾
      </>
    )

  return (
    <div className="export-menu" ref={ref}>
      <button className={variant === 'tool' ? 'tool green' : ''} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="popup export-popup">
          <button className="popup-item" onClick={() => pick('xlsx')}>
            Excel (.xlsx)
          </button>
          <button className="popup-item" onClick={() => pick('csv')}>
            CSV (.csv)
          </button>
          <button className="popup-item" onClick={() => pick('json')}>
            JSON (.json)
          </button>
          <button className="popup-item" onClick={() => pick('sql')}>
            SQL INSERT (.sql)
          </button>
        </div>
      )}
    </div>
  )
}
