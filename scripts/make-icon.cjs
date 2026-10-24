// Renders resources/icon.svg into build/icon.ico (Windows installer + exe), build/icon.png and resources/icon.png
// (the window icon). Needs Electron to rasterise, so run it with:   npm run icon
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'resources', 'icon.svg'), 'utf8')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(win, size) {
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><div style="width:${size}px;height:${size}px">${svg.replace('width="256" height="256"', `width="${size}" height="${size}"`)}</div></body></html>`
  win.setContentSize(size, size)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 250))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return img.toPNG()
}

/** An .ico that holds PNG images (supported since Windows Vista). */
function ico(images) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const dir = images.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([head, ...dir, ...images.map((i) => i.png)])
}

// Software rendering: capturing a hidden window through the GPU process is flaky (UnknownVizError).
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, transparent: true, frame: false, width: 256, height: 256, useContentSize: true, webPreferences: { offscreen: false } })
  const images = []
  for (const size of SIZES) images.push({ size, png: await render(win, size) })
  const big = await render(win, 512)
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(images))
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), big)
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), big)
  console.log('icons written:', SIZES.join(', '), '+ 512')
  app.quit()
}).catch((e) => {
  console.error('icon generation failed:', e)
  app.exit(1)
})
