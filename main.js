const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut } = require('electron')
const path = require('path')

let uIOhook = null
try {
  ;({ uIOhook } = require('uiohook-napi'))
} catch (e) {
  console.error('[mousedance] uiohook-napi 로드 실패 — 전역 키 감지 비활성화:', e.message)
}

let win = null
let tray = null

const WIN_W = 360
const WIN_H = 360

function createWindow () {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.workAreaSize

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(width / 2 - WIN_W / 2),
    y: Math.round(height / 2 - WIN_H / 2),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 항상 최상단 + 모든 데스크톱/전체화면 위에 표시
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 시작은 클릭 통과(투명 영역) 상태. 렌더러가 쥐 위로 커서가 오면 해제 요청.
  win.setIgnoreMouseEvents(true, { forward: true })

  win.loadFile('index.html')
}

// ── 클릭 통과 토글 (불투명 픽셀 위 = 상호작용, 투명 = 통과) ──
ipcMain.on('set-ignore', (_e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true })
})

// ── 드래그: 전역 커서 좌표 기준으로 창 이동 (부드럽고 끊김 없음) ──
let dragTimer = null
let dragOffset = null
ipcMain.on('drag-start', () => {
  if (!win) return
  const c = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  dragOffset = { x: c.x - x, y: c.y - y }
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    win.setPosition(p.x - dragOffset.x, p.y - dragOffset.y)
  }, 16)
})
ipcMain.on('drag-end', () => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
})

ipcMain.on('quit', () => app.quit())

function startKeyboardHook () {
  if (!uIOhook) return
  uIOhook.on('keydown', () => {
    if (win && !win.isDestroyed()) win.webContents.send('keystroke')
  })
  try {
    uIOhook.start()
  } catch (e) {
    console.error('[mousedance] 키보드 훅 시작 실패:', e.message)
  }
}

function createTray () {
  tray = new Tray(nativeImage.createEmpty())
  tray.setTitle('🐭')
  tray.setToolTip('쥐 춤 (Mousedance)')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '가운데로 데려오기', click: () => {
      if (!win) return
      const d = screen.getPrimaryDisplay().workAreaSize
      win.setPosition(Math.round(d.width / 2 - WIN_W / 2), Math.round(d.height / 2 - WIN_H / 2))
    } },
    { type: 'separator' },
    { label: '쥐 춤 종료 (⌘⇧M)', click: () => app.quit() }
  ]))
}

app.whenReady().then(() => {
  // Dock 아이콘 숨김 — 배경 데스크톱 펫
  if (app.dock) app.dock.hide()
  createWindow()
  createTray()
  startKeyboardHook()
  globalShortcut.register('CommandOrControl+Shift+M', () => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  try { if (uIOhook) uIOhook.stop() } catch (_) {}
})

app.on('window-all-closed', () => app.quit())
