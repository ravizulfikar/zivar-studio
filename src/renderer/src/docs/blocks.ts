// The documentation is data, so the page can be searched and rendered the same way everywhere.
// Inline text supports **bold** and `code`.

export type Block =
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'tip'; text: string }
  | { t: 'warn'; text: string }
  | { t: 'img'; file: string; caption: string }
  | { t: 'table'; head: string[]; rows: string[][] }

export interface Section {
  id: string
  title: string
  /** A short line under the title and in the contents list's search. */
  summary: string
  blocks: Block[]
}

export interface Group {
  title: string
  sections: Section[]
}

/** Plain text of a block, for searching. */
export function blockText(b: Block): string {
  switch (b.t) {
    case 'p':
    case 'tip':
    case 'warn':
      return b.text
    case 'ul':
    case 'ol':
      return b.items.join(' ')
    case 'img':
      return b.caption
    case 'table':
      return [...b.head, ...b.rows.flat()].join(' ')
  }
}

export function sectionText(s: Section): string {
  return [s.title, s.summary, ...s.blocks.map(blockText)].join(' ').toLowerCase()
}
