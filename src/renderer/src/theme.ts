import { createContext } from 'react'

export type Theme = 'light' | 'dark'

/** The active theme, for the few things CSS variables cannot reach (the code editor's own palette). */
export const ThemeContext = createContext<Theme>('light')

const KEY = 'zivar-theme'

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage can be unavailable; fall through */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* not persisted; the choice still applies for this session */
  }
}
