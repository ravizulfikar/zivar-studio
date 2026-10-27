// The start-up splash: what it looks like and when it is shown. Pure (no Electron), so it is unit-tested.

/** Title of the splash page; tests (and anyone attaching a debugger) can tell it from the real window. */
export const SPLASH_TITLE = 'Zivar Database Studio — starting'

/** The splash stays at least this long so the animation can be seen. */
export const SPLASH_MIN_MS = 2000

type Env = Record<string, string | undefined>

/**
 * Shown on a normal start. Not when something is driving the app through the DevTools protocol (tests, screenshots:
 * the splash would be mistaken for the window), unless ZIVAR_SPLASH=1 asks for it. ZIVAR_SPLASH=0 turns it off.
 */
export function shouldShowSplash(env: Env, automated: boolean): boolean {
  if (env['ZIVAR_SPLASH'] === '0') return false
  if (env['ZIVAR_SPLASH'] === '1') return true
  return !automated
}

/** ZIVAR_SPLASH_MIN_MS lengthens (or shortens) the minimum time; tests use it to have time to look. */
export function splashMinMs(env: Env): number {
  const raw = env['ZIVAR_SPLASH_MIN_MS']
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : SPLASH_MIN_MS
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * One self-contained page: no scripts, no files, no network. The logo draws itself (the Z is a single stroke), the two
 * nodes pop in and then pulse, the title rises, and a bar slides while the app loads. When the app is ready the main
 * process adds the class "leave" to <body> for a short fade-out. Reduced-motion users get the finished picture.
 */
export function splashHtml(version: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>${SPLASH_TITLE}</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; cursor: default; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  .card {
    position: absolute; inset: 20px; border-radius: 24px; overflow: hidden;
    background: linear-gradient(150deg, #0f2d2a 0%, #0a1d1c 55%, #0c2623 100%);
    border: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    animation: enter 0.45s ease-out both;
  }
  .glow {
    position: absolute; left: 50%; top: 36%; width: 380px; height: 380px; margin: -190px 0 0 -190px;
    background: radial-gradient(circle, rgba(34, 201, 178, 0.30), rgba(34, 201, 178, 0) 62%);
    animation: breathe 4.2s ease-in-out infinite;
  }
  .logo { position: relative; width: 116px; height: 116px; animation: logo-in 0.55s cubic-bezier(0.2, 0.9, 0.3, 1) both, float 3.4s ease-in-out 1.6s infinite; }
  .grid { opacity: 0; animation: fade 0.8s 0.5s ease-out forwards; }
  .z { stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0; animation: draw 0.95s 0.4s cubic-bezier(0.65, 0, 0.35, 1) forwards; }
  .node { transform-box: fill-box; transform-origin: center; transform: scale(0); animation: pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .n1 { animation-delay: 0.3s; }
  .n2 { animation-delay: 1.3s; }
  .ring { transform-box: fill-box; transform-origin: center; opacity: 0; fill: none; stroke: #ffb547; stroke-width: 5; animation: ring 1.9s ease-out infinite; }
  .r1 { animation-delay: 1.0s; }
  .r2 { animation-delay: 1.95s; }
  h1 { margin: 20px 0 0; font-size: 23px; font-weight: 650; letter-spacing: 0.02em; color: #eafaf7; animation: rise 0.6s 0.75s ease-out both; }
  .tag { margin: 7px 0 0; font-size: 11.5px; letter-spacing: 0.07em; color: #7fb3ab; animation: rise 0.6s 0.9s ease-out both; }
  .ver { margin: 5px 0 0; font-size: 11px; color: #5b8a83; animation: rise 0.6s 1.05s ease-out both; }
  .bar { width: 190px; height: 3px; margin-top: 20px; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.09); animation: rise 0.5s 1.1s ease-out both; }
  .bar i { display: block; width: 42%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, rgba(34, 201, 178, 0), #22c9b2 45%, #8af0df); animation: slide 1.35s ease-in-out infinite; }
  .state { margin-top: 9px; font-size: 11px; color: #5b8a83; animation: rise 0.5s 1.2s ease-out both; }
  .state::after { content: ''; animation: dots 1.4s steps(1, end) infinite; }
  body.leave .card { animation: leave 0.26s ease-in forwards; }

  @keyframes enter { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
  @keyframes leave { to { opacity: 0; transform: scale(0.965); } }
  @keyframes breathe { 0%, 100% { opacity: 0.65; transform: scale(1); } 50% { opacity: 1; transform: scale(1.09); } }
  @keyframes logo-in { from { opacity: 0; transform: scale(0.72) translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  @keyframes fade { to { opacity: 1; } }
  @keyframes draw { 0% { stroke-dashoffset: 1; opacity: 0; } 3% { opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 1; } }
  @keyframes pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  @keyframes ring { 0% { transform: scale(1); opacity: 0.85; } 100% { transform: scale(2.3); opacity: 0; } }
  @keyframes rise { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
  @keyframes slide { from { transform: translateX(-110%); } to { transform: translateX(260%); } }
  @keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="glow"></div>
    <svg class="logo" viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c9b2" /><stop offset="1" stop-color="#0a6f62" /></linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="58" fill="url(#bg)" />
      <g class="grid" stroke="#fff" stroke-opacity="0.13" stroke-width="4" stroke-linecap="round"><path d="M40 62H216M40 128H216M40 194H216" /><path d="M100 40V216M156 40V216" /></g>
      <path class="z" pathLength="1" d="M78 86H178L78 170H178" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" />
      <circle class="ring r1" cx="78" cy="86" r="17" />
      <circle class="ring r2" cx="178" cy="170" r="17" />
      <circle class="node n1" cx="78" cy="86" r="17" fill="#ffb547" stroke="#0a6f62" stroke-width="6" />
      <circle class="node n2" cx="178" cy="170" r="17" fill="#ffb547" stroke="#0a6f62" stroke-width="6" />
    </svg>
    <h1>Zivar Database Studio</h1>
    <div class="tag">PostgreSQL · MySQL · SQL Server · SQLite</div>
    <div class="ver">Version ${escapeHtml(version)}</div>
    <div class="bar"><i></i></div>
    <div class="state">Starting</div>
  </div>
</body>
</html>
`
}
