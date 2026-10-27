import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { splashHtml } from './splashContent'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface Splash {
  /** Resolves with the time the splash became visible (ms since epoch); resolves anyway if it cannot be shown. */
  shown: Promise<number>
  /** Plays the short fade-out and closes the splash. */
  dismiss: () => Promise<void>
}

/** A small frameless window with the animated start-up page. It never takes part in anything else the app does. */
export function openSplash(): Splash {
  const win = new BrowserWindow({
    width: 480,
    height: 340,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    center: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false }
  })
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml(__APP_VERSION__)))

  const shown = new Promise<number>((resolve) => {
    win.once('ready-to-show', () => {
      win.show()
      resolve(Date.now())
    })
    // If the page cannot be drawn (no compositor, a broken driver) the app must not wait for it.
    setTimeout(() => resolve(Date.now()), 3000)
  })

  const dismiss = async (): Promise<void> => {
    if (win.isDestroyed()) return
    await win.webContents.executeJavaScript("document.body.classList.add('leave')").catch(() => undefined)
    await sleep(280)
    if (!win.isDestroyed()) win.close()
  }
  return { shown, dismiss }
}
