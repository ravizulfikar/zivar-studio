import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { GROUPS } from './docs/content'
import { sectionText, type Block } from './docs/blocks'
import { IconSearch } from './Icons'

// Screenshots live in docs/img and are bundled with the app (see `npm run docs:shots`).
const IMAGES = import.meta.glob('./docs/img/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const imageUrl = (file: string): string | undefined => IMAGES[`./docs/img/${file}.png`]

/** **bold** and `code` inside a line of text. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>
  )
}

function BlockView({ b, onZoom }: { b: Block; onZoom: (src: string, caption: string) => void }): JSX.Element {
  switch (b.t) {
    case 'p':
      return <p>{inline(b.text)}</p>
    case 'ul':
      return (
        <ul>
          {b.items.map((x, i) => (
            <li key={i}>{inline(x)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol>
          {b.items.map((x, i) => (
            <li key={i}>{inline(x)}</li>
          ))}
        </ol>
      )
    case 'tip':
      return <div className="doc-note tip">{inline(b.text)}</div>
    case 'warn':
      return <div className="doc-note warn">{inline(b.text)}</div>
    case 'table':
      return (
        <table className="doc-table">
          <thead>
            <tr>
              {b.head.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, k) => (
                  <td key={k}>{inline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'img': {
      const src = imageUrl(b.file)
      return (
        <figure className="doc-fig">
          {src ? <img src={src} alt={b.caption} loading="lazy" onClick={() => onZoom(src, b.caption)} title="Klik untuk memperbesar" /> : <div className="doc-missing">(gambar “{b.file}” belum tersedia)</div>}
          <figcaption>{b.caption}</figcaption>
        </figure>
      )
    }
  }
}

/** The built-in manual: contents on the left, searchable, with screenshots that open full size on click. */
export function DocsTab(): JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(GROUPS[0].sections[0].id)
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, sections: g.sections.filter((s) => words.every((w) => sectionText(s).includes(w))) })).filter((g) => g.sections.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query]
  )
  const count = groups.reduce((n, g) => n + g.sections.length, 0)

  useEffect(() => {
    if (!zoom) return
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZoom(null)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [zoom])

  const go = (id: string): void => {
    setActive(id)
    document.getElementById(`doc-${id}`)?.scrollIntoView({ block: 'start' })
  }

  // The contents list follows the section currently at the top of the page.
  const onScroll = (): void => {
    const top = (scroller.current?.getBoundingClientRect().top ?? 0) + 24
    let current: string | null = null
    for (const g of groups) {
      for (const s of g.sections) {
        const el = document.getElementById(`doc-${s.id}`)
        if (el && el.getBoundingClientRect().top <= top) current = s.id
      }
    }
    if (current) setActive(current)
  }

  return (
    <div className="docs">
      <nav className="docs-toc">
        <div className="search docs-search">
          <IconSearch size={13} />
          <input placeholder="Cari di dokumentasi" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="docs-toc-list">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="docs-toc-group">{g.title}</div>
              {g.sections.map((s) => (
                <a key={s.id} className={s.id === active ? 'on' : ''} onClick={() => go(s.id)}>
                  {s.title}
                </a>
              ))}
            </div>
          ))}
          {count === 0 && <div className="muted pad">Tidak ada bagian yang cocok dengan “{query}”.</div>}
        </div>
      </nav>
      <div className="docs-body" ref={scroller} onScroll={onScroll}>
        <article>
          {query && <div className="muted docs-count">{count} bagian cocok dengan “{query}”</div>}
          {groups.map((g) => (
            <Fragment key={g.title}>
              {g.sections.map((s) => (
                <section key={s.id} id={`doc-${s.id}`}>
                  <h2>{s.title}</h2>
                  <p className="docs-summary">{s.summary}</p>
                  {s.blocks.map((b, i) => (
                    <BlockView key={i} b={b} onZoom={(src, caption) => setZoom({ src, caption })} />
                  ))}
                </section>
              ))}
            </Fragment>
          ))}
        </article>
      </div>
      {zoom && (
        <div className="docs-zoom" onClick={() => setZoom(null)}>
          <img src={zoom.src} alt={zoom.caption} />
          <div>{zoom.caption} — klik atau tekan Esc untuk menutup</div>
        </div>
      )}
    </div>
  )
}
