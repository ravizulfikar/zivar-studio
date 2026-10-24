/** How a cell value is shown in grids and exports. */
export function fmt(v: unknown): string {
  if (v === null || v === undefined) return '(Null)'
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '')
  if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
