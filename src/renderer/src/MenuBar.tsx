import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

export interface MenuItem {
  label: string
  onClick?: () => void
  disabled?: boolean
  separator?: boolean
  hint?: string
}

export interface Menu {
  label: string
  items: MenuItem[]
}

export function MenuBar({ menus }: { menus: Menu[] }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="menubar" ref={ref}>
      {menus.map((m, i) => (
        <div key={m.label} className="menu-root">
          <button
            className={`menu-btn ${open === i ? 'open' : ''}`}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="popup">
              {m.items.map((it, k) =>
                it.separator ? (
                  <div key={k} className="sep" />
                ) : (
                  <button
                    key={k}
                    className="popup-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null)
                      it.onClick?.()
                    }}
                  >
                    <span>{it.label}</span>
                    {it.hint && <span className="hint">{it.hint}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export interface ContextMenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div
      className="popup context"
      style={{ left: Math.min(state.x, window.innerWidth - 220), top: Math.min(state.y, window.innerHeight - state.items.length * 28 - 12) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {state.items.map((it, k) =>
        it.separator ? (
          <div key={k} className="sep" />
        ) : (
          <button
            key={k}
            className="popup-item"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  )
}
