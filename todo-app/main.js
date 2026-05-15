const { app, BrowserWindow, ipcMain, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;

// Some environments (VMs, RDP sessions, older/unusual GPU drivers) fail to
// composite GPU-accelerated windows, leaving the process alive but no visible
// window. Disabling hardware acceleration trades negligible perf for reliable
// rendering across machines.
app.disableHardwareAcceleration();

// Ensure only one instance runs; a second launch focuses the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
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
  notificationMinutesBefore: 5
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
const DEFAULT_WINDOW_STATE = {
  width: 1200,
  height: 800,
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
    paintWhenInitiallyHidden: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  return splash;
}

let mainWindow = null;

function createWindow(splash, splashShownAt) {
  const savedState = loadWindowState();
  const useSavedPosition = ensureBoundsVisible(savedState);

  const winOptions = {
    width: savedState.width || 1200,
    height: savedState.height || 800,
    // 4 JOB columns (4 × 320) + 3 gaps (3 × 14) + .board padding (2 × 16) = 1354px
    // — minimum window width keeps the top toolbar from wrapping on the board view.
    minWidth: 1360,
    // Month calendar at max zoom (1.3): topbar (~70) + cal nav (~50) + weekday header (~30)
    // + 6 week rows of ≥85px each (24*1.3 chrome + 1 bar lane + "+더보기" lane) ≈ 660 + margin.
    minHeight: 720,
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

  if (savedState.isMaximized) win.maximize();

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
  win.on('close', () => {
    if (stateSaveTimer) clearTimeout(stateSaveTimer);
    persistState();
  });

  const MIN_SPLASH_DURATION = 1200;
  const MAX_SPLASH_DURATION = 8000;
  let shown = false;

  const revealWindow = () => {
    if (shown) return;
    shown = true;
    if (splash && !splash.isDestroyed()) splash.close();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
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
    revealWindow();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer process gone:', details && details.reason);
    revealWindow();
  });
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
    return { ok: true };
  } catch (err) {
    console.error('Failed to save settings:', err);
    return { ok: false, error: String(err) };
  }
});

// IPC: native notification
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
