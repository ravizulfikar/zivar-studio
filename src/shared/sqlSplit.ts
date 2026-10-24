import type { DbKind } from './types'

export interface SqlStatement {
  text: string
  /** 1-based line where the statement starts, to point users at the right place in a big file. */
  line: number
}

/**
 * Split a SQL script into statements the way each engine's own client would: semicolons end a
 * statement except inside quotes, comments, PostgreSQL dollar quotes and MySQL `DELIMITER` blocks;
 * SQL Server batches are separated by `GO` lines.
 */
export function splitSql(script: string, kind: DbKind): SqlStatement[] {
  const out: SqlStatement[] = []
  const n = script.length
  let i = script.charCodeAt(0) === 0xfeff ? 1 : 0
  let delimiter = ';'
  let buf = ''
  let codeLine = 1 // line of the first real token of the current statement
  let line = 1
  let hasCode = false // anything besides whitespace/comments in the current statement?

  const flush = (): void => {
    const text = buf.trim()
    if (hasCode && text) out.push({ text, line: codeLine })
    buf = ''
    hasCode = false
  }
  const take = (len: number, code: boolean): void => {
    const chunk = script.slice(i, i + len)
    if (code && !hasCode) codeLine = line
    for (const ch of chunk) if (ch === '\n') line++
    buf += chunk
    if (code) hasCode = true
    i += len
  }
  const atLineStart = (): boolean => i === 0 || script[i - 1] === '\n'
  const restOfLine = (): string => {
    const e = script.indexOf('\n', i)
    return script.slice(i, e === -1 ? n : e)
  }

  while (i < n) {
    const ch = script[i]
    const two = script.slice(i, i + 2)

    // Client-side directives that must sit on their own line.
    if (atLineStart() && buf.trim() === '') {
      const rest = restOfLine()
      if (kind === 'mysql') {
        const m = /^\s*delimiter\s+(\S+)\s*$/i.exec(rest)
        if (m) {
          delimiter = m[1]
          i += rest.length
          continue
        }
      }
      if (kind === 'mssql' && /^\s*go(\s+\d+)?\s*$/i.test(rest)) {
        i += rest.length
        flush()
        continue
      }
    }
    if (kind === 'mssql' && atLineStart() && /^\s*go(\s+\d+)?\s*$/i.test(restOfLine())) {
      i += restOfLine().length
      flush()
      continue
    }

    // Comments
    if (two === '--' || (kind === 'mysql' && ch === '#')) {
      const e = script.indexOf('\n', i)
      take((e === -1 ? n : e) - i, false)
      continue
    }
    if (two === '/*') {
      // MySQL's /*! ... */ and /*+ ... */ carry executable content, so they count as code.
      const executable = kind === 'mysql' && script[i + 2] === '!'
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (script.startsWith('/*', j) && kind === 'postgres') {
          depth++
          j += 2
        } else if (script.startsWith('*/', j)) {
          depth--
          j += 2
        } else j++
      }
      take(j - i, executable)
      continue
    }

    // Quoted things
    if (ch === "'" || ch === '"' || ch === '`' || (kind === 'mssql' && ch === '[')) {
      const close = ch === '[' ? ']' : ch
      const backslash = kind === 'mysql' && (ch === "'" || ch === '"') || (kind === 'postgres' && ch === "'" && /[eE]$/.test(buf) && !/[\w$]/.test(buf.slice(-2, -1)))
      let j = i + 1
      while (j < n) {
        if (backslash && script[j] === '\\') j += 2
        else if (script[j] === close) {
          if (script[j + 1] === close) j += 2 // doubled quote is an escaped quote
          else break
        } else j++
      }
      take(Math.min(j + 1, n) - i, true)
      continue
    }

    // PostgreSQL dollar quoting: $$ ... $$ or $tag$ ... $tag$
    if (kind === 'postgres' && ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(i, i + 64))
      if (m && !/[\w$]/.test(script[i - 1] ?? ' ')) {
        const end = script.indexOf(m[0], i + m[0].length)
        take((end === -1 ? n : end + m[0].length) - i, true)
        continue
      }
    }

    if (script.startsWith(delimiter, i)) {
      i += delimiter.length
      flush()
      continue
    }

    take(1, !/\s/.test(ch))
  }
  flush()
  return out
}

/** Collapse a statement to one line without touching strings or identifiers; comments are removed. */
export function minifySql(sql: string, kind: DbKind): string {
  let out = ''
  const n = sql.length
  let i = 0
  const pushSpace = (): void => {
    if (out && !out.endsWith(' ')) out += ' '
  }
  while (i < n) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    if (two === '--' || (kind === 'mysql' && ch === '#')) {
      const e = sql.indexOf('\n', i)
      i = e === -1 ? n : e
      pushSpace()
    } else if (two === '/*') {
      const e = sql.indexOf('*/', i + 2)
      i = e === -1 ? n : e + 2
      pushSpace()
    } else if (ch === "'" || ch === '"' || ch === '`' || (kind === 'mssql' && ch === '[')) {
      const close = ch === '[' ? ']' : ch
      const backslash = kind === 'mysql' && (ch === "'" || ch === '"')
      let j = i + 1
      while (j < n) {
        if (backslash && sql[j] === '\\') j += 2
        else if (sql[j] === close) {
          if (sql[j + 1] === close) j += 2
          else break
        } else j++
      }
      out += sql.slice(i, Math.min(j + 1, n))
      i = Math.min(j + 1, n)
    } else if (kind === 'postgres' && ch === '$' && /^\$([A-Za-z_]\w*)?\$/.test(sql.slice(i, i + 64))) {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64)) as RegExpExecArray
      const end = sql.indexOf(tag[0], i + tag[0].length)
      const stop = end === -1 ? n : end + tag[0].length
      out += sql.slice(i, stop)
      i = stop
    } else if (/\s/.test(ch)) {
      pushSpace()
      i++
    } else {
      out += ch
      i++
    }
  }
  return out.trim()
}
