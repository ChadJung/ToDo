const { app, BrowserWindow, ipcMain, Notification, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ----- Crash-safety fallback log (must run first) -----
// %TEMP%/TodoApp-startup.log is always writable, always findable, and runs
// before we depend on Electron paths or app.whenReady(). When a user reports
// "the app doesn't open and there's no log anywhere", this is the file to
// ask for. Capped at 64KB with tail-trim rotation so it never grows.
const FALLBACK_LOG = path.join(os.tmpdir(), 'TodoApp-startup.log');
const FALLBACK_MAX_BYTES = 64 * 1024;
const FALLBACK_TRIM_BYTES = 32 * 1024;
function rotateFallbackIfNeeded() {
  try {
    const st = fs.statSync(FALLBACK_LOG);
    if (st.size <= FALLBACK_MAX_BYTES) return;
    const fd = fs.openSync(FALLBACK_LOG, 'r');
    const buf = Buffer.alloc(FALLBACK_TRIM_BYTES);
    fs.readSync(fd, buf, 0, FALLBACK_TRIM_BYTES, st.size - FALLBACK_TRIM_BYTES);
    fs.closeSync(fd);
    const nl = buf.indexOf(0x0a);
    const trimmed = nl >= 0 ? buf.slice(nl + 1) : buf;
    fs.writeFileSync(FALLBACK_LOG, `--- log rotated ${new Date().toISOString()} ---\n`, 'utf-8');
    fs.appendFileSync(FALLBACK_LOG, trimmed);
  } catch (_e) {}
}
function fallbackLog(msg) {
  try {
    if (fs.existsSync(FALLBACK_LOG)) rotateFallbackIfNeeded();
    fs.appendFileSync(FALLBACK_LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
  } catch (_e) {}
}
fallbackLog('---- process start ----');
fallbackLog(`pid=${process.pid} platform=${process.platform} arch=${process.arch} node=${process.versions.node} electron=${process.versions.electron}`);
fallbackLog(`exe=${process.execPath}`);
fallbackLog(`argv=${JSON.stringify(process.argv)}`);

const isDev = !app.isPackaged;

// ----- Persistent app log -----
// Writes to %APPDATA%/TodoApp/app.log so we can diagnose user reports
// ("doesn't open on my PC"). Disk usage is bounded by tail-trim rotation;
// verbose (INFO) entries are only emitted in debug mode to keep the file
// tiny on normal user machines.
//
// Debug mode opt-in (any of):
//   • CLI flag:  --debug
//   • env var:   TODOAPP_DEBUG=1
//   • flag file: %APPDATA%/TodoApp/debug.flag
function isDebugMode() {
  const argv = (process.argv || []).map(String);
  if (argv.includes('--debug')) return true;
  if (process.env.TODOAPP_DEBUG === '1' || process.env.TODOAPP_DEBUG === 'true') return true;
  try {
    if (fs.existsSync(path.join(app.getPath('userData'), 'debug.flag'))) return true;
  } catch (_e) { /* userData not ready yet */ }
  return false;
}
const DEBUG = isDebugMode();
const LOG_MAX_BYTES = DEBUG ? 1024 * 1024 : 64 * 1024;       // 1MB debug / 64KB normal
const LOG_TRIM_TO_BYTES = DEBUG ? 512 * 1024 : 32 * 1024;    // trim to half cap on overflow

function getLogPath() {
  try { return path.join(app.getPath('userData'), 'app.log'); } catch (_e) { return null; }
}
function rotateLogIfNeeded(fp) {
  try {
    const st = fs.statSync(fp);
    if (st.size <= LOG_MAX_BYTES) return;
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(LOG_TRIM_TO_BYTES);
    fs.readSync(fd, buf, 0, LOG_TRIM_TO_BYTES, st.size - LOG_TRIM_TO_BYTES);
    fs.closeSync(fd);
    // Align to next newline so we don't keep a half-truncated line at the head.
    const nl = buf.indexOf(0x0a);
    const trimmed = nl >= 0 ? buf.slice(nl + 1) : buf;
    fs.writeFileSync(fp, `--- log rotated ${new Date().toISOString()} ---\n`, 'utf-8');
    fs.appendFileSync(fp, trimmed);
  } catch (_e) { /* leave the file as-is rather than crashing */ }
}
function writeLog(level, msg) {
  try {
    const fp = getLogPath();
    if (!fp) return;
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(fp)) rotateLogIfNeeded(fp);
    fs.appendFileSync(fp, `[${new Date().toISOString()}] [${level}] ${msg}\n`, 'utf-8');
  } catch (_e) { /* logging must never crash the app */ }
}
// info() is silent unless DEBUG is on, so normal users only accumulate
// boot/warn/error lines (the few that matter for support).
// boot/warn/error are also mirrored to the %TEMP% fallback log so users
// always have one canonical place to find diagnostic info, even if the
// userData directory is inaccessible (permission denied, AV blocked, etc).
const log = {
  info:  (m) => { if (DEBUG) writeLog('INFO', m); },
  warn:  (m) => { writeLog('WARN', m); fallbackLog(`[WARN] ${m}`); },
  error: (m) => { writeLog('ERROR', m); fallbackLog(`[ERROR] ${m}`); },
  boot:  (m) => { writeLog('BOOT', m); fallbackLog(`[BOOT] ${m}`); }
};
// Backward-compat alias for the previous helper name.
const startupLog = log.boot;

// Catch otherwise-silent crashes so they show up in app.log instead of vanishing.
process.on('uncaughtException', (err) => {
  log.error(`uncaughtException: ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (reason) => {
  log.error(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});

// Mirror console.error/warn into the log file without per-callsite changes.
// Stdout/stderr behavior is untouched — we just add a file sink on top.
function __fmtArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object') {
    try { return JSON.stringify(a); } catch (_e) { return String(a); }
  }
  return String(a);
}
const __origConsoleError = console.error.bind(console);
const __origConsoleWarn = console.warn.bind(console);
console.error = (...args) => {
  __origConsoleError(...args);
  try { log.error(args.map(__fmtArg).join(' ')); } catch (_e) {}
};
console.warn = (...args) => {
  __origConsoleWarn(...args);
  try { log.warn(args.map(__fmtArg).join(' ')); } catch (_e) {}
};

// Hardware acceleration: default ON. A previous build force-disabled GPU for
// every user, which broke compositing on a subset of Windows machines (frame
// drawn, contents never painted). We now keep GPU on, but allow opt-out for
// the small VM/RDP minority via any of:
//   • CLI flag:  --disable-gpu  or  --no-hwaccel
//   • env var:   TODOAPP_DISABLE_GPU=1
//   • flag file: %APPDATA%/TodoApp/disable-gpu.flag
function shouldDisableGpu() {
  const argv = (process.argv || []).map(String);
  if (argv.includes('--disable-gpu') || argv.includes('--no-hwaccel')) return true;
  if (process.env && (process.env.TODOAPP_DISABLE_GPU === '1' ||
                      process.env.TODOAPP_DISABLE_GPU === 'true')) return true;
  try {
    const flag = path.join(app.getPath('userData'), 'disable-gpu.flag');
    if (fs.existsSync(flag)) return true;
  } catch (_e) { /* userData not ready yet in rare cases */ }
  return false;
}
if (shouldDisableGpu()) {
  app.disableHardwareAcceleration();
  log.boot('GPU acceleration disabled by user override');
}
log.boot(`App start — version ${app.getVersion()}, packaged=${app.isPackaged}, platform=${process.platform}, debug=${DEBUG}`);
try {
  // Surface the real userData path so users don't waste time looking in the
  // wrong %APPDATA% subdirectory. (electron-builder's productName affects the
  // .exe name but not app.getName(), so userData is %APPDATA%/<package.json name>.)
  log.boot(`userData=${app.getPath('userData')}`);
} catch (_e) { /* path resolution can fail in extreme cases; the fallback log already captured process start */ }

// Ensure only one instance runs; a second launch focuses the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Without this log, "I double-clicked the exe but nothing happened" reports
  // (caused by a previous instance still holding the lock or a zombie process)
  // are indistinguishable from real crashes.
  fallbackLog('single-instance lock NOT acquired — another instance is running; quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const DEFAULT_SETTINGS = {
  zoomLevel: 1,
  completeBehavior: 'ask',
  notificationEnabled: true,
  notificationMinutesBefore: 5,
  // null = never asked (triggers first-run prompt). true/false once the user has decided.
  autoStart: null,
  // Tri-state: null = never asked (prompt on first close), true = hide to tray
  // on close, false = quit on close. Default null so the user is asked once.
  minimizeToTray: null
};

// Resolve data file path
function getDataFilePath() {
  if (isDev) {
    return path.join(__dirname, 'data', 'todos.json');
  }
  return path.join(app.getPath('userData'), 'todos.json');
}

function getSettingsFilePath() {
  if (isDev) {
    return path.join(__dirname, 'data', 'settings.json');
  }
  return path.join(app.getPath('userData'), 'settings.json');
}

// ----- Window state persistence -----
// Keep these in sync with the BrowserWindow minWidth/minHeight below. The
// default width must be >= MIN_WIN_WIDTH or the first launch opens too narrow.
const MIN_WIN_WIDTH = 1360;
const MIN_WIN_HEIGHT = 720;

const DEFAULT_WINDOW_STATE = {
  width: 1400,
  height: 860,
  x: null,
  y: null,
  isMaximized: false
};

function getWindowStateFilePath() {
  if (isDev) {
    return path.join(__dirname, 'data', 'window-state.json');
  }
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const fp = getWindowStateFilePath();
    if (!fs.existsSync(fp)) return Object.assign({}, DEFAULT_WINDOW_STATE);
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_WINDOW_STATE, parsed && typeof parsed === 'object' ? parsed : {});
  } catch (err) {
    console.error('Failed to load window state:', err);
    return Object.assign({}, DEFAULT_WINDOW_STATE);
  }
}

function saveWindowState(stateObj) {
  try {
    const fp = getWindowStateFilePath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(stateObj, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

// Validate that the saved bounds are within any current display
function ensureBoundsVisible(bounds) {
  if (!bounds || bounds.x == null || bounds.y == null) return false;
  const displays = screen.getAllDisplays();
  // The window is considered visible if its top-left corner (with some slack)
  // intersects any display's work area.
  return displays.some(d => {
    const a = d.workArea;
    return bounds.x + 100 >= a.x &&
           bounds.y + 30 >= a.y &&
           bounds.x + bounds.width - 100 <= a.x + a.width &&
           bounds.y <= a.y + a.height - 50;
  });
}

function ensureSettingsFile() {
  const filePath = getSettingsFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
  }
}

// Ensure data file exists (copy seed in production if necessary)
function ensureDataFile() {
  const dataFilePath = getDataFilePath();
  const dataDir = path.dirname(dataFilePath);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFilePath)) {
    if (!isDev) {
      // Try to copy seed from extraResources
      const seedPath = path.join(process.resourcesPath, 'data', 'todos.json');
      if (fs.existsSync(seedPath)) {
        fs.copyFileSync(seedPath, dataFilePath);
        return;
      }
    }
    // Fallback: write default empty structure
    fs.writeFileSync(dataFilePath, JSON.stringify({ jobs: [] }, null, 2), 'utf-8');
  }
}

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    transparent: false,
    backgroundColor: '#1e1e1e',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    center: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  splash.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`splash did-fail-load ${code} ${desc} ${url}`);
  });
  splash.webContents.on('render-process-gone', (_e, details) => {
    log.error(`splash render-process-gone: ${details && details.reason}`);
  });
  // Normal-flow event — only log when debugging, otherwise it just adds noise.
  splash.webContents.once('did-finish-load', () => log.info('splash did-finish-load'));
  return splash;
}

let mainWindow = null;

// ----- System tray (minimize-to-tray) -----
// `minimizeToTray` is the in-memory mirror of the settings flag (tri-state:
// null = never asked, true = hide on close, false = quit on close). The window
// 'close' handler reads it to decide between hiding, quitting, or prompting, and
// it's refreshed whenever settings are saved (see settings:save below).
// `isQuitting` lets the tray "Quit" item bypass the hide-on-close interception.
let tray = null;
let minimizeToTray = null;
let trayPromptShown = false;   // guards against re-sending the first-close prompt
app.isQuitting = false;

// Read the persisted minimizeToTray flag at startup without going through the
// renderer (which isn't loaded yet when we first need this value). Returns the
// raw tri-state (null when never set).
function loadMinimizeToTraySetting() {
  try {
    const raw = fs.readFileSync(getSettingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.minimizeToTray === true || parsed.minimizeToTray === false)) {
      return parsed.minimizeToTray;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
    tray.setToolTip('TodoApp');
    const menu = Menu.buildFromTemplate([
      { label: '열기', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(menu);
    // Double-click (and single-click on Windows) restores the window.
    tray.on('double-click', () => showMainWindow());
    tray.on('click', () => showMainWindow());
    log.boot('tray created');
  } catch (err) {
    console.error('Failed to create tray:', err);
    tray = null;
  }
}

function destroyTray() {
  if (tray) {
    try { tray.destroy(); } catch (_e) {}
    tray = null;
  }
}

// Create or tear down the tray icon so it only exists while the feature is on.
function syncTray() {
  if (minimizeToTray === true) createTray();
  else destroyTray();
}

function createWindow(splash, splashShownAt) {
  const savedState = loadWindowState();
  const useSavedPosition = ensureBoundsVisible(savedState);

  const winOptions = {
    // Clamp to the minimums so a stale saved state (older builds saved a
    // 1200px default, below the 1360 minimum) can't open the window too narrow.
    width: Math.max(savedState.width || DEFAULT_WINDOW_STATE.width, MIN_WIN_WIDTH),
    height: Math.max(savedState.height || DEFAULT_WINDOW_STATE.height, MIN_WIN_HEIGHT),
    // 4 JOB columns (4 × 320) + 3 gaps (3 × 14) + .board padding (2 × 16) = 1354px
    // — minimum window width keeps the top toolbar from wrapping on the board view.
    minWidth: MIN_WIN_WIDTH,
    // Month calendar at max zoom (1.3): topbar (~70) + cal nav (~50) + weekday header (~30)
    // + 6 week rows of ≥85px each (24*1.3 chrome + 1 bar lane + "+더보기" lane) ≈ 660 + margin.
    minHeight: MIN_WIN_HEIGHT,
    backgroundColor: '#1e1e1e',
    title: 'TodoApp',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };
  if (useSavedPosition) {
    winOptions.x = savedState.x;
    winOptions.y = savedState.y;
  } else {
    winOptions.center = true;
  }

  const win = new BrowserWindow(winOptions);

  // NOTE: don't call win.maximize() here. On Windows, maximizing a show:false
  // window makes it visible immediately, so the main window would pop up before
  // the splash closes. Maximize is deferred to revealWindow() instead.

  mainWindow = win;
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));

  // Persist window state with debounce
  let stateSaveTimer = null;
  const persistState = () => {
    if (!win || win.isDestroyed()) return;
    const isMax = win.isMaximized();
    const bounds = isMax ? win.getNormalBounds() : win.getBounds();
    saveWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: isMax
    });
  };
  const queuePersist = () => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer);
    stateSaveTimer = setTimeout(persistState, 250);
  };
  win.on('resize', queuePersist);
  win.on('move', queuePersist);
  win.on('maximize', queuePersist);
  win.on('unmaximize', queuePersist);
  win.on('close', (e) => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer);
    persistState();
    // A real quit (tray menu, OS shutdown, app.quit) always proceeds.
    if (app.isQuitting) return;
    // First close ever (never asked): hold the window open and ask the user
    // whether to quit or minimize to tray. The renderer saves the choice and
    // sends back tray:firstCloseDecision, which performs the hide-or-quit.
    if (minimizeToTray === null) {
      e.preventDefault();
      if (!trayPromptShown && win.webContents) {
        trayPromptShown = true;
        win.webContents.send('tray:promptOnClose');
      }
      return;
    }
    // User opted in: hide to tray instead of quitting. Require an actual tray
    // icon — if tray creation failed, hiding would strand the window, so let the
    // close proceed instead.
    if (minimizeToTray === true && tray) {
      e.preventDefault();
      win.hide();
    }
    // minimizeToTray === false → fall through and quit normally.
  });

  const MIN_SPLASH_DURATION = 1200;
  const MAX_SPLASH_DURATION = 8000;
  let shown = false;

  const revealWindow = () => {
    if (shown) return;
    shown = true;
    let mainShown = false;
    const showMain = () => {
      if (mainShown) return;
      mainShown = true;
      if (win && !win.isDestroyed()) {
        // Maximize here (not at creation) so a show:false window isn't forced
        // visible early. show() right after keeps the maximized-state seamless.
        if (savedState.isMaximized) win.maximize();
        win.show();
        win.focus();
      }
    };
    if (splash && !splash.isDestroyed()) {
      // Reveal the main window only after the splash has actually closed so the
      // two never overlap on screen. Both use #1e1e1e bg, so the handoff is seamless.
      splash.once('closed', showMain);
      // Fallback so a delayed/missing 'closed' event can't strand the user.
      setTimeout(showMain, 400);
      splash.close();
    } else {
      showMain();
    }
  };

  win.once('ready-to-show', () => {
    const elapsed = Date.now() - (splashShownAt || Date.now());
    const remaining = Math.max(0, MIN_SPLASH_DURATION - elapsed);
    setTimeout(revealWindow, remaining);
  });

  // Safety net: if 'ready-to-show' never fires (renderer load failure, GPU
  // compositing issue, etc.), force the window visible so the app is usable.
  setTimeout(revealWindow, MAX_SPLASH_DURATION);

  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, url) => {
    console.error(`Renderer failed to load (${errorCode} ${errorDesc}): ${url}`);
    log.error(`main did-fail-load ${errorCode} ${errorDesc} ${url}`);
    revealWindow();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer process gone:', details && details.reason);
    log.error(`main render-process-gone: ${details && details.reason}`);
    revealWindow();
  });

  win.webContents.once('did-finish-load', () => log.info('main did-finish-load'));
  // ready-to-show is the single most useful "did the UI come up?" boot event,
  // so keep it at BOOT level (always written).
  win.once('ready-to-show', () => log.boot('main ready-to-show'));
}

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('window:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// Resolve the first-close prompt. The renderer has already persisted the user's
// choice via settings:save (so minimizeToTray + tray are up to date); here we
// just carry out the requested action.
ipcMain.on('tray:firstCloseDecision', (_event, minimize) => {
  if (minimize) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  } else {
    app.isQuitting = true;
    app.quit();
  }
});

// IPC: load full data
ipcMain.handle('todo:load', async () => {
  try {
    ensureDataFile();
    const filePath = getDataFilePath();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.jobs)) {
      return { jobs: [] };
    }
    return parsed;
  } catch (err) {
    console.error('Failed to load data:', err);
    return { jobs: [] };
  }
});

// IPC: save full data
ipcMain.handle('todo:save', async (_event, data) => {
  try {
    ensureDataFile();
    const filePath = getDataFilePath();
    if (!data || typeof data !== 'object' || !Array.isArray(data.jobs)) {
      throw new Error('Invalid data structure');
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    console.error('Failed to save data:', err);
    return { ok: false, error: String(err) };
  }
});

// IPC: settings load
ipcMain.handle('settings:load', async () => {
  try {
    ensureSettingsFile();
    const raw = fs.readFileSync(getSettingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_SETTINGS, parsed && typeof parsed === 'object' ? parsed : {});
  } catch (err) {
    console.error('Failed to load settings:', err);
    return Object.assign({}, DEFAULT_SETTINGS);
  }
});

// IPC: settings save
ipcMain.handle('settings:save', async (_event, settings) => {
  try {
    ensureSettingsFile();
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid settings');
    }
    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
    fs.writeFileSync(getSettingsFilePath(), JSON.stringify(merged, null, 2), 'utf-8');
    // Keep the in-memory flag and tray icon in sync with the saved value
    // (preserve the tri-state: null / true / false).
    minimizeToTray = (merged.minimizeToTray === true || merged.minimizeToTray === false)
      ? merged.minimizeToTray
      : null;
    syncTray();
    return { ok: true };
  } catch (err) {
    console.error('Failed to save settings:', err);
    return { ok: false, error: String(err) };
  }
});

// IPC: native notification
// ----- Windows login-item / auto-start at OS startup -----
// In dev mode we don't actually touch the registry — `process.execPath` points
// to the local electron.exe and would create a stale Run entry.
function readAutoStartOS() {
  if (isDev) return false;
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch (err) {
    console.error('getLoginItemSettings failed:', err);
    return false;
  }
}
function writeAutoStartOS(enabled) {
  if (isDev) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
  } catch (err) {
    console.error('setLoginItemSettings failed:', err);
  }
}
ipcMain.handle('autoStart:get', async () => readAutoStartOS());
ipcMain.handle('autoStart:set', async (_event, enabled) => {
  writeAutoStartOS(enabled);
  return { ok: true, state: readAutoStartOS() };
});

ipcMain.handle('notify:show', async (_event, payload) => {
  try {
    if (!Notification.isSupported()) return { ok: false, error: 'unsupported' };
    const n = new Notification({
      title: (payload && payload.title) || 'TodoApp',
      body: (payload && payload.body) || '',
      silent: false
    });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    n.show();
    return { ok: true };
  } catch (err) {
    console.error('Failed to show notification:', err);
    return { ok: false, error: String(err) };
  }
});

function startApp() {
  try {
    ensureDataFile();
  } catch (err) {
    console.error('Failed to ensure data file:', err);
  }
  // Load the tray preference and create the tray up-front so the icon is present
  // even before the first window is shown.
  minimizeToTray = loadMinimizeToTraySetting();
  syncTray();
  const splash = createSplashWindow();
  const splashShownAt = Date.now();

  // Wait until splash actually paints its first frame, then create main window.
  // 'show' fires when the OS has displayed the window; this is faster than
  // 'ready-to-show' for non-transparent windows and avoids the white flash.
  let started = false;
  const startMain = () => {
    if (started) return;
    started = true;
    setImmediate(() => createWindow(splash, splashShownAt));
  };
  splash.webContents.once('did-finish-load', startMain);
  // Safety net in case did-finish-load is delayed
  setTimeout(startMain, 400);
}

app.whenReady().then(() => {
  startApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      startApp();
    }
  });
});

// Any real quit path (tray Quit, OS shutdown, app.quit()) must be able to close
// the window — flip the flag so the hide-on-close interception is bypassed.
app.on('before-quit', () => { app.isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
