// revai platform — Electron shell (packaged mode).
// Hosts the same Hono server (bundled to dist/server/server.cjs) on localhost
// and opens the SPA in a window. The app talks HTTP to the server — no IPC.
//
// Entry is defined in package.json → "main"; do not rename without updating it there.
const { app, BrowserWindow, shell } = require('electron')
const net = require('node:net')
const path = require('node:path')

const BASE_PORT = Number(process.env.REVAI_PORT ?? 8797)

// probe a test listener to discover a free port
function probe(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function pickPort(start, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await probe(start + i)) return start + i
  }
  throw new Error(`revai desktop: no free port from ${start} to ${start + tries - 1}`)
}

// wait for the Hono server to accept connections before creating the window
function waitServer(port, timeoutMs = 8000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error('revai desktop: server did not respond'))
        else setTimeout(tick, 120)
      })
    }
    tick()
  })
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Revai Platform',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  })
  // external links (new tabs/target=_blank) go to the system browser
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  void win.loadURL(url)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // focus the second instance instead of duplicating window/server (the port would already be taken)
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // quit for real on every platform: the server lives in this process,
  // keeping the window hidden on macOS would leave the server running without a visible owner
  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(async () => {
    const port = await pickPort(BASE_PORT)
    // the packaged server does not chdir: absolute paths are arranged here
    process.env.REVAI_APP_ROOT = app.getAppPath()
    process.env.REVAI_DIST = path.join(app.getAppPath(), 'dist', 'app')
    process.env.REVAI_PORT = String(port)
    // bundles are pure JS (hono/react with no native deps) — loads straight from asar;
    // a bind/port failure becomes a clear dialog, not a raw main-process crash stack
    try {
      require(path.join(app.getAppPath(), 'dist', 'server', 'server.cjs'))
    } catch (err) {
      const { dialog } = require('electron')
      dialog.showErrorBox(
        'Revai Platform',
        `Falha ao iniciar o servidor local.\n\n` +
          `Causa: ${err?.message ?? err}\n\n` +
          `Dica: outro revai/projeto pode estar na mesma porta (padrão 8797). ` +
          `Feche a outra instância e abra de novo.`,
      )
      app.exit(1)
      return
    }
    await waitServer(port)
    createWindow(`http://127.0.0.1:${port}`)
  })
}
