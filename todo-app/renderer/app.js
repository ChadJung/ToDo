'use strict';

// ----- State -----
const state = {
  data: { jobs: [] },
  filterStatuses: new Set(['대기', '진행', '완료']),
  filterPriority: '',
  sortBy: 'priority',
  sortAsc: false,
  lastActiveJobNo: null,
  viewMode: 'board', // 'board' | 'list' | 'calendar'
  calendarMode: 'month', // 'month' | 'week'
  calendarFocus: null    // anchor date {y, m, d}
};

const DEFAULT_SETTINGS = {
  zoomLevel: 1,
  completeBehavior: 'ask',          // 'ask' | 'auto' | 'manual'
  notificationEnabled: true,
  notificationMinutesBefore: 5,
  autoStart: null                   // null = never asked, true/false once user has decided
};

let settings = Object.assign({}, DEFAULT_SETTINGS);

const VIEW_MODE_KEY = 'todoApp.viewMode';
const CAL_MODE_KEY = 'todoApp.calendarMode';
const TOUR_COMPLETED_KEY = 'todoApp.tourCompleted';
const UI_STATE_KEY = 'todoApp.uiState';

function saveUiState() {
  try {
    const data = {
      filterStatuses: Array.from(state.filterStatuses),
      filterPriority: state.filterPriority,
      sortBy: state.sortBy,
      sortAsc: state.sortAsc
    };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(data));
  } catch (err) { console.warn('saveUiState skipped:', err); }
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.filterStatuses)) {
      const filtered = data.filterStatuses.filter(s => STATUSES.includes(s));
      state.filterStatuses = new Set(filtered);
    }
    if (typeof data.filterPriority === 'string') state.filterPriority = data.filterPriority;
    if (typeof data.sortBy === 'string') state.sortBy = data.sortBy;
    if (typeof data.sortAsc === 'boolean') state.sortAsc = data.sortAsc;
  } catch (err) { console.warn('loadUiState skipped:', err); }
}

function applyUiStateToControls() {
  if (els.filterPriority) els.filterPriority.value = state.filterPriority || '';
  if (els.sortBy) els.sortBy.value = state.sortBy || 'priority';
  if (els.sortDirection) els.sortDirection.textContent = state.sortAsc ? '↑' : '↓';
}
const ZOOM_FACTORS = { 1: 1.0, 2: 1.15, 3: 1.3 };
let zoomLevel = 1;
let zoomToastTimer = null;
let notifyIntervalId = null;
const notifiedTaskIds = new Set();

// Month calendar dynamic layout state (populated each renderCalendarMonth call,
// re-applied on resize via ResizeObserver so visible lanes adapt to row height).
let monthBarsState = [];
let monthLaneH = 20;
let monthResizeObserver = null;

const STATUSES = ['대기', '진행', '완료'];
const PRIORITIES = ['높음', '보통', '낮음'];
// Preset JOB color palette (mid-tone, readable with white text on dark theme)
const JOB_COLORS = [
  '#4f8cff', '#22b8a6', '#34c759', '#e6b800', '#ff9f43',
  '#ff6b6b', '#e056a8', '#9b6bff', '#5a96c8', '#6b7280'
];

// ----- DOM -----
const $ = (sel) => document.querySelector(sel);

// ----- Custom time picker (popup with HH/MM columns) -----
const TimePicker = (function () {
  let popup = null;
  let activeInput = null;
  let pendingHour = '';
  let pendingMin = '';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function buildPopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'tp-popup hidden';
    popup.innerHTML = [
      '<div class="tp-col" data-tp-col="hour">',
      '  <div class="tp-col-label">시</div>',
      '</div>',
      '<div class="tp-sep"></div>',
      '<div class="tp-col" data-tp-col="min">',
      '  <div class="tp-col-label">분</div>',
      '</div>',
      '<div class="tp-actions">',
      '  <button type="button" class="tp-btn" data-tp-act="now">현재</button>',
      '  <button type="button" class="tp-btn primary" data-tp-act="ok">확인</button>',
      '</div>'
    ].join('');
    const hourCol = popup.querySelector('[data-tp-col="hour"]');
    const minCol = popup.querySelector('[data-tp-col="min"]');
    for (let h = 0; h < 24; h++) {
      const item = document.createElement('div');
      item.className = 'tp-item';
      item.dataset.tpVal = pad(h);
      item.textContent = pad(h);
      hourCol.appendChild(item);
    }
    for (let m = 0; m < 60; m++) {
      const item = document.createElement('div');
      item.className = 'tp-item';
      item.dataset.tpVal = pad(m);
      item.textContent = pad(m);
      minCol.appendChild(item);
    }
    popup.addEventListener('click', onPopupClick);
    document.body.appendChild(popup);
    return popup;
  }

  function highlightSelected() {
    if (!popup) return;
    popup.querySelectorAll('[data-tp-col="hour"] .tp-item').forEach((el) => {
      el.classList.toggle('selected', el.dataset.tpVal === pendingHour);
    });
    popup.querySelectorAll('[data-tp-col="min"] .tp-item').forEach((el) => {
      el.classList.toggle('selected', el.dataset.tpVal === pendingMin);
    });
  }

  function scrollToSelected() {
    if (!popup) return;
    const sels = popup.querySelectorAll('.tp-item.selected');
    sels.forEach((el) => {
      const col = el.parentElement;
      col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.clientHeight / 2;
    });
  }

  function commit() {
    if (!activeInput) return;
    if (pendingHour && pendingMin) {
      activeInput.value = pendingHour + ':' + pendingMin;
    } else {
      activeInput.value = '';
    }
    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onPopupClick(e) {
    const item = e.target.closest('.tp-item');
    if (item) {
      const col = item.closest('[data-tp-col]');
      const which = col && col.dataset.tpCol;
      if (which === 'hour') pendingHour = item.dataset.tpVal;
      else if (which === 'min') pendingMin = item.dataset.tpVal;
      highlightSelected();
      return;
    }
    const act = e.target.dataset && e.target.dataset.tpAct;
    if (act === 'now') {
      const d = new Date();
      pendingHour = pad(d.getHours());
      pendingMin = pad(d.getMinutes());
      highlightSelected();
      scrollToSelected();
      return;
    }
    if (act === 'ok') {
      commit();
      close();
    }
  }

  function position() {
    if (!popup || !activeInput) return;
    const r = activeInput.getBoundingClientRect();
    const top = r.bottom + window.scrollY + 4;
    let left = r.left + window.scrollX;
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.classList.remove('hidden');
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      left = window.innerWidth - pr.width - 8 + window.scrollX;
      popup.style.left = left + 'px';
    }
    if (pr.bottom > window.innerHeight - 8) {
      popup.style.top = (r.top + window.scrollY - pr.height - 4) + 'px';
    }
  }

  function open(input) {
    buildPopup();
    activeInput = input;
    const v = (input.value || '').match(/^(\d{1,2}):(\d{2})/);
    pendingHour = v ? pad(parseInt(v[1], 10)) : '';
    pendingMin = v ? v[2] : '';
    highlightSelected();
    position();
    scrollToSelected();
  }

  function close() {
    if (popup) popup.classList.add('hidden');
    activeInput = null;
  }

  function onDocClick(e) {
    if (!popup || popup.classList.contains('hidden')) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest('.tp-display')) return;
    close();
  }

  document.addEventListener('click', (e) => {
    const display = e.target.closest('.tp-display[data-tp]');
    if (display) {
      e.stopPropagation();
      if (activeInput === display) { close(); return; }
      open(display);
      return;
    }
    const clear = e.target.closest('.tp-wrap .tp-clear');
    if (clear) {
      const wrap = clear.closest('.tp-wrap');
      const input = wrap && wrap.querySelector('.tp-display');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
      return;
    }
    onDocClick(e);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('resize', close);
  window.addEventListener('scroll', (e) => {
    if (!popup || popup.classList.contains('hidden')) return;
    if (e.target && popup.contains(e.target)) return;
    close();
  }, true);

  return { open, close };
})();

const els = {
  board: $('#board'),
  boardEmpty: $('#board-empty'),
  boardCount: $('#board-count'),
  listView: $('#list-view'),
  taskTable: $('#task-table'),
  taskTableBody: $('#task-table-body'),
  listEmpty: $('#list-empty'),
  calendarView: $('#calendar-view'),
  calendarBody: $('#calendar-body'),
  calTitle: $('#cal-title'),
  calPrev: $('#cal-prev'),
  calNext: $('#cal-next'),
  calToday: $('#cal-today'),
  calModeMonth: $('#cal-mode-month'),
  calModeWeek: $('#cal-mode-week'),
  viewBoardBtn: $('#view-board'),
  viewListBtn: $('#view-list'),
  viewCalendarBtn: $('#view-calendar'),
  boardTitleText: $('#board-title-text'),
  filterStatusBtn: $('#filter-status-btn'),
  filterStatusMenu: $('#filter-status-menu'),
  filterStatusLabel: $('#filter-status-label'),
  filterPriority: $('#filter-priority'),
  sortBy: $('#sort-by'),
  sortDirection: $('#sort-direction'),
  btnAddJob: $('#btn-add-job'),
  btnAddTaskToolbar: $('#btn-add-task-toolbar'),
  // Job modal
  modalJob: $('#modal-job'),
  modalJobTitle: $('#modal-job-title'),
  formJob: $('#form-job'),
  jobNoInput: $('#job-no-input'),
  jobTitleInput: $('#job-title-input'),
  jobColorPicker: $('#job-color-picker'),
  jobColorInput: $('#job-color-input'),
  // Task modal
  modalTask: $('#modal-task'),
  formTask: $('#form-task'),
  modalTaskTitle: $('#modal-task-title'),
  taskIdInput: $('#task-id-input'),
  taskJobNoInput: $('#task-jobno-input'),
  taskJobNoSelect: $('#task-jobno-select'),
  taskTitleInput: $('#task-title-input'),
  taskLabelInput: $('#task-label-input'),
  taskLabelToggle: $('#task-label-toggle'),
  taskStatusInput: $('#task-status-input'),
  taskPriorityInput: $('#task-priority-input'),
  taskStartInput: $('#task-start-input'),
  taskStartTimeInput: $('#task-start-time-input'),
  taskDueInput: $('#task-due-input'),
  taskEndInput: $('#task-end-input'),
  taskEndTimeInput: $('#task-end-time-input'),
  taskMemoInput: $('#task-memo-input'),
  btnDeleteTask: $('#btn-delete-task'),
  btnHelp: $('#btn-help'),
  btnSettings: $('#btn-settings'),
  // Settings modal
  modalSettings: $('#modal-settings'),
  formSettings: $('#form-settings'),
  settingsZoom: $('#settings-zoom'),
  settingsCompleteBehavior: $('#settings-complete-behavior'),
  settingsNotifyEnabled: $('#settings-notify-enabled'),
  settingsNotifyMinutes: $('#settings-notify-minutes'),
  settingsAutoStart: $('#settings-autostart'),
  // First-run auto-start prompt
  modalAutoStartConfirm: $('#modal-autostart-confirm'),
  autoStartConfirmYes: $('#autostart-confirm-yes'),
  autoStartConfirmNo: $('#autostart-confirm-no'),
  // Complete confirm modal
  modalCompleteConfirm: $('#modal-complete-confirm'),
  completeConfirmRemember: $('#complete-confirm-remember'),
  completeConfirmYes: $('#complete-confirm-yes'),
  completeConfirmNo: $('#complete-confirm-no')
};

// ----- Persistence -----
// Accept only #RRGGBB / #RGB hex colors. Anything else (including
// arbitrary CSS like "red; background-image: url(...)") is rejected so it
// cannot escape into style.background or --job-color CSS custom property.
function sanitizeColor(c) {
  if (typeof c !== 'string') return '';
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : '';
}

async function loadData() {
  const data = await window.todoAPI.loadData();
  state.data = data || { jobs: [] };
  if (!Array.isArray(state.data.jobs)) state.data.jobs = [];
  for (const job of state.data.jobs) {
    // Reject malformed colors loaded from disk (e.g. hand-edited todos.json)
    job.color = sanitizeColor(job.color);
    if (!Array.isArray(job.tasks)) continue;
    for (const t of job.tasks) {
      // Migrate any legacy HH:MM:SS time strings to HH:MM
      if (t.startTime) t.startTime = normTime(t.startTime);
      if (t.endTime) t.endTime = normTime(t.endTime);
    }
  }
}
async function saveData() {
  const res = await window.todoAPI.saveData(state.data);
  if (!res || !res.ok) {
    console.error('Save failed', res);
    showAlert('저장 실패: ' + (res && res.error ? res.error : '알 수 없는 오류'), '오류');
  }
}

// ----- Settings persistence -----
async function loadSettings() {
  try {
    if (window.settingsAPI && typeof window.settingsAPI.load === 'function') {
      const loaded = await window.settingsAPI.load();
      settings = Object.assign({}, DEFAULT_SETTINGS, loaded || {});
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
    settings = Object.assign({}, DEFAULT_SETTINGS);
  }
  // Clamp/normalize values
  if (![1, 2, 3].includes(Number(settings.zoomLevel))) settings.zoomLevel = 1;
  settings.zoomLevel = Number(settings.zoomLevel);
  if (!['ask', 'auto', 'manual'].includes(settings.completeBehavior)) settings.completeBehavior = 'ask';
  settings.notificationEnabled = !!settings.notificationEnabled;
  const m = parseInt(settings.notificationMinutesBefore, 10);
  settings.notificationMinutesBefore = Number.isFinite(m) && m >= 0 ? m : 5;
  // autoStart is tri-state: null (never asked) | true | false. Anything else → null.
  settings.autoStart = (settings.autoStart === true || settings.autoStart === false)
    ? settings.autoStart
    : null;
}

// ----- Windows auto-start (login item) -----
// On first run (settings.autoStart === null) shows a modal asking the user.
// On subsequent runs reconciles the stored value with the actual OS state in
// case the user disabled it via Windows Settings / Task Manager.
async function initAutoStart() {
  if (!window.autoStartAPI) return;
  if (settings.autoStart === null) {
    const enabled = await showAutoStartPrompt();
    settings.autoStart = enabled;
    try { await window.autoStartAPI.set(enabled); } catch (err) { console.error(err); }
    await persistSettings();
  } else {
    try {
      const osState = await window.autoStartAPI.get();
      if (osState !== settings.autoStart) {
        settings.autoStart = osState;
        await persistSettings();
      }
    } catch (err) { console.error(err); }
  }
}

function showAutoStartPrompt() {
  return new Promise(resolve => {
    const modal = els.modalAutoStartConfirm;
    const yes = els.autoStartConfirmYes;
    const no = els.autoStartConfirmNo;
    if (!modal || !yes || !no) { resolve(false); return; }
    const cleanup = () => {
      modal.classList.add('hidden');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
    };
    const onYes = () => { cleanup(); resolve(true); };
    const onNo = () => { cleanup(); resolve(false); };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    modal.classList.remove('hidden');
  });
}

async function persistSettings() {
  try {
    if (window.settingsAPI && typeof window.settingsAPI.save === 'function') {
      const res = await window.settingsAPI.save(settings);
      if (!res || !res.ok) console.error('Settings save failed', res);
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

// ----- Helpers -----
function nowIso() { return new Date().toISOString(); }
function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatTaskTitle(task) {
  const lbl = task && task.label ? String(task.label).trim() : '';
  return lbl ? '[' + lbl + '] ' + (task.title || '') : (task && task.title ? task.title : '');
}
function findJob(jobNo) {
  return state.data.jobs.find(j => j.jobNo === jobNo) || null;
}
function findTask(jobNo, taskId) {
  const job = findJob(jobNo);
  if (!job || !Array.isArray(job.tasks)) return null;
  return job.tasks.find(t => t.id === taskId) || null;
}
function priorityWeight(p) {
  return p === '높음' ? 3 : p === '보통' ? 2 : p === '낮음' ? 1 : 0;
}
function isOverdue(dueDate, status) {
  if (!dueDate || status === '완료') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  return due < today;
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function nowDateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function nowTimeStr() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// Normalize any time string to HH:MM (strip seconds / invalid)
function normTime(v) {
  if (!v || typeof v !== 'string') return '';
  const m = v.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return pad2(hh) + ':' + pad2(mm);
}
function formatDateTime(date, time) {
  if (!date && !time) return '';
  if (date && time) return date + ' ' + time;
  return date || time;
}
function combineDateTime(date, time) {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
  const dt = new Date(date + 'T' + t + ':00');
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function applyFiltersSort(tasks) {
  let result = tasks.slice();
  // Status: multi-select via checkboxes
  if (state.filterStatuses.size < STATUSES.length) {
    result = result.filter(t => state.filterStatuses.has(t.status));
  }
  if (state.filterPriority) result = result.filter(t => t.priority === state.filterPriority);
  result.sort((a, b) => {
    // Completed tasks always sink to the bottom, regardless of sort direction
    const aDone = a.status === '완료' ? 1 : 0;
    const bDone = b.status === '완료' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    let cmp = 0;
    if (state.sortBy === 'dueDate') {
      const aVal = a.dueDate || '';
      const bVal = b.dueDate || '';
      if (!aVal && !bVal) cmp = 0;
      else if (!aVal) cmp = 1;
      else if (!bVal) cmp = -1;
      else cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    } else if (state.sortBy === 'priority') {
      cmp = priorityWeight(b.priority) - priorityWeight(a.priority);
    }
    return state.sortAsc ? cmp : -cmp;
  });
  return result;
}

// ----- View Mode -----
function setViewMode(mode) {
  if (mode !== 'board' && mode !== 'list' && mode !== 'calendar') mode = 'board';
  state.viewMode = mode;
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch (err) { console.warn('viewMode persist skipped:', err); }
  els.viewBoardBtn.classList.toggle('active', mode === 'board');
  els.viewListBtn.classList.toggle('active', mode === 'list');
  if (els.viewCalendarBtn) els.viewCalendarBtn.classList.toggle('active', mode === 'calendar');
  if (els.boardTitleText) {
    const titles = { board: 'Todo Board', list: 'Todo List', calendar: 'Todo Calendar' };
    els.boardTitleText.textContent = titles[mode] || 'Todo Board';
  }
  els.board.classList.toggle('hidden', mode !== 'board');
  els.listView.classList.toggle('hidden', mode !== 'list');
  if (els.calendarView) els.calendarView.classList.toggle('hidden', mode !== 'calendar');
  if (mode === 'calendar' && !state.calendarFocus) {
    const t = new Date();
    state.calendarFocus = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  }
  renderAll();
}

function loadViewMode() {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === 'board' || saved === 'list' || saved === 'calendar') return saved;
  } catch (err) { console.warn('loadViewMode skipped:', err); }
  return 'board';
}

function loadCalendarMode() {
  try {
    const saved = localStorage.getItem(CAL_MODE_KEY);
    if (saved === 'month' || saved === 'week') return saved;
  } catch (err) { console.warn('loadCalendarMode skipped:', err); }
  return 'month';
}

function setCalendarMode(mode) {
  if (mode !== 'month' && mode !== 'week') mode = 'month';
  state.calendarMode = mode;
  try { localStorage.setItem(CAL_MODE_KEY, mode); } catch (err) { console.warn('calMode persist skipped:', err); }
  if (els.calModeMonth) els.calModeMonth.classList.toggle('active', mode === 'month');
  if (els.calModeWeek) els.calModeWeek.classList.toggle('active', mode === 'week');
  renderCalendar();
}

// ----- Zoom (content area only) -----
function showZoomToast(percent) {
  let toast = document.getElementById('zoom-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'zoom-toast';
    toast.className = 'zoom-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = `확대 ${percent}%`;
  toast.classList.add('show');
  if (zoomToastTimer) clearTimeout(zoomToastTimer);
  zoomToastTimer = setTimeout(() => toast.classList.remove('show'), 1000);
}

function applyZoomImmediate(level) {
  const clamped = Math.max(1, Math.min(3, level));
  zoomLevel = clamped;
  const factor = ZOOM_FACTORS[zoomLevel];
  document.documentElement.style.setProperty('--zoom', String(factor));
}

function setZoomLevel(level) {
  const clamped = Math.max(1, Math.min(3, level));
  if (clamped === zoomLevel) return;
  applyZoomImmediate(clamped);
  settings.zoomLevel = clamped;
  persistSettings();
  showZoomToast(Math.round(ZOOM_FACTORS[zoomLevel] * 100));
  // Calendar bar/event positions are JS-computed from LANE_H/HOUR_PX,
  // which now depend on zoom — re-render so layout matches the new scale.
  if (state.viewMode === 'calendar') renderCalendar();
}

function attachZoomHandler() {
  const handler = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) setZoomLevel(zoomLevel + 1);
    else setZoomLevel(zoomLevel - 1);
  };
  els.board.addEventListener('wheel', handler, { passive: false });
  els.listView.addEventListener('wheel', handler, { passive: false });
  if (els.calendarView) els.calendarView.addEventListener('wheel', handler, { passive: false });
}

function renderAll() {
  // Always update board count regardless of mode
  if (state.viewMode === 'board') {
    renderBoard();
  } else if (state.viewMode === 'list') {
    renderList();
  } else if (state.viewMode === 'calendar') {
    renderCalendar();
  }
}

// ----- Render: Calendar -----
function parseYMD(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return { y, m: m - 1, d };
}
function ymdKey(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
function dateFromYmd(o) { return new Date(o.y, o.m, o.d); }
function ymdFromDate(dt) { return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() }; }
function addDaysYmd(o, n) {
  const dt = new Date(o.y, o.m, o.d + n);
  return ymdFromDate(dt);
}
function startOfWeekYmd(o) {
  const dt = new Date(o.y, o.m, o.d);
  const day = dt.getDay(); // 0=Sun
  dt.setDate(dt.getDate() - day);
  return ymdFromDate(dt);
}

// Returns flat list of {jobNo, task, primaryDate} after applying status/priority filters
function getCalendarTasks() {
  const out = [];
  for (const job of state.data.jobs) {
    if (!Array.isArray(job.tasks)) continue;
    for (const task of job.tasks) {
      if (state.filterStatuses.size < STATUSES.length && !state.filterStatuses.has(task.status)) continue;
      if (state.filterPriority && task.priority !== state.filterPriority) continue;
      // A task appears on a date if any of these match: startDate, dueDate, or any day in startDate-endDate
      out.push({ jobNo: job.jobNo, task });
    }
  }
  return out;
}

// Determine which days a task spans (returns array of YMD strings)
function taskOccupiedDays(task) {
  const days = new Set();
  const sd = parseYMD(task.startDate);
  const ed = parseYMD(task.endDate);
  const due = parseYMD(task.dueDate);
  if (sd && ed) {
    let cur = sd;
    let safety = 0;
    while (safety < 400) {
      days.add(ymdKey(cur.y, cur.m, cur.d));
      if (cur.y === ed.y && cur.m === ed.m && cur.d === ed.d) break;
      cur = addDaysYmd(cur, 1);
      safety++;
    }
  } else if (sd) {
    days.add(ymdKey(sd.y, sd.m, sd.d));
  }
  if (due) days.add(ymdKey(due.y, due.m, due.d));
  return Array.from(days);
}

function renderCalendar() {
  if (!els.calendarBody) return;
  if (!state.calendarFocus) {
    const t = new Date();
    state.calendarFocus = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  }
  // Update title
  const f = state.calendarFocus;
  if (state.calendarMode === 'month') {
    els.calTitle.textContent = `${f.y}년 ${f.m + 1}월`;
    renderCalendarMonth();
  } else {
    const sw = startOfWeekYmd(f);
    const ew = addDaysYmd(sw, 6);
    const start = `${sw.y}년 ${sw.m + 1}월 ${sw.d}일`;
    let end;
    if (sw.y !== ew.y) {
      end = `${ew.y}년 ${ew.m + 1}월 ${ew.d}일`;
    } else if (sw.m !== ew.m) {
      end = `${ew.m + 1}월 ${ew.d}일`;
    } else {
      end = `${ew.d}일`;
    }
    els.calTitle.textContent = `${start} ~ ${end}`;
    renderCalendarWeek();
  }
  // Total task count
  let total = 0;
  for (const job of state.data.jobs) total += (job.tasks || []).length;
  els.boardCount.textContent = `${state.data.jobs.length} JOBs · ${total} Tasks`;
}

// Returns the inclusive [startYmd, endYmd] span of a task for calendar drawing.
// Calendar shows *planned* dates (startDate / dueDate). A bare endDate is a
// completion timestamp and must NOT pull the task into the calendar on its own.
function taskSpan(task) {
  const sd = parseYMD(task.startDate);
  const due = parseYMD(task.dueDate);
  const ed = parseYMD(task.endDate);
  if (!sd && !due) return null;            // endDate-only tasks don't render
  const start = sd || due;
  const end = ed || due || sd;
  if (!start || !end) return null;
  const ds = dateFromYmd(start);
  const de = dateFromYmd(end);
  if (de < ds) return { start: end, end: start };
  return { start, end };
}

function diffDaysYmd(a, b) {
  const d1 = Date.UTC(a.y, a.m, a.d);
  const d2 = Date.UTC(b.y, b.m, b.d);
  return Math.round((d2 - d1) / 86400000);
}

function renderCalendarMonth() {
  const body = els.calendarBody;
  body.innerHTML = '';
  body.className = 'calendar-body cal-month';
  // Reset dynamic layout state — each render rebuilds week rows from scratch.
  monthBarsState = [];

  const f = state.calendarFocus;
  const firstOfMonth = new Date(f.y, f.m, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(f.y, f.m + 1, 0).getDate();
  const daysInPrev = new Date(f.y, f.m, 0).getDate();
  const today = ymdFromDate(new Date());

  // Build cells (6 rows × 7 cols)
  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const pm = f.m === 0 ? 11 : f.m - 1;
    const py = f.m === 0 ? f.y - 1 : f.y;
    cells.push({ y: py, m: pm, d, outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ y: f.y, m: f.m, d, outside: false });
  }
  let nx = 1;
  while (cells.length < 42) {
    const nm = f.m === 11 ? 0 : f.m + 1;
    const ny = f.m === 11 ? f.y + 1 : f.y;
    cells.push({ y: ny, m: nm, d: nx++, outside: true });
  }

  // Weekday header
  const head = document.createElement('div');
  head.className = 'cal-month-weekdays';
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  wd.forEach((w, i) => {
    const c = document.createElement('div');
    c.className = 'cal-month-weekday';
    if (i === 0) c.classList.add('sun');
    if (i === 6) c.classList.add('sat');
    c.textContent = w;
    head.appendChild(c);
  });
  body.appendChild(head);

  // Build all task spans (clipped to grid)
  const gridStart = cells[0];
  const gridEnd = cells[cells.length - 1];
  const all = getCalendarTasks();
  const spans = [];
  for (const it of all) {
    const sp = taskSpan(it.task);
    if (!sp) continue;
    // clip to grid
    let s = sp.start, e = sp.end;
    if (diffDaysYmd(gridStart, s) < 0) s = gridStart;
    if (diffDaysYmd(gridEnd, e) > 0) e = gridEnd;
    if (diffDaysYmd(s, e) < 0) continue;
    spans.push({ jobNo: it.jobNo, task: it.task, start: s, end: e, originalStart: sp.start, originalEnd: sp.end });
  }

  // Grid container
  const grid = document.createElement('div');
  grid.className = 'cal-month-grid';
  grid.dataset.gridStart = ymdKey(gridStart.y, gridStart.m, gridStart.d);

  // Render 6 week rows
  for (let w = 0; w < 6; w++) {
    const weekRow = document.createElement('div');
    weekRow.className = 'cal-month-week-row';
    const weekStart = cells[w * 7];
    const weekEnd = cells[w * 7 + 6];

    // Day cells
    for (let i = 0; i < 7; i++) {
      const c = cells[w * 7 + i];
      const cell = document.createElement('div');
      cell.className = 'cal-month-cell';
      if (i === 0) cell.classList.add('sun');
      if (i === 6) cell.classList.add('sat');
      if (c.outside) cell.classList.add('outside');
      if (c.y === today.y && c.m === today.m && c.d === today.d) cell.classList.add('today');
      const headRow = document.createElement('div');
      headRow.className = 'cal-month-cell-head';
      const dnum = document.createElement('span');
      dnum.className = 'cal-month-day-num';
      dnum.textContent = String(c.d);
      headRow.appendChild(dnum);
      cell.appendChild(headRow);
      cell.addEventListener('dblclick', () => {
        if (state.data.jobs.length === 0) { showAlert('먼저 JOB을 추가하세요.'); return; }
        const targetJobNo = state.lastActiveJobNo && findJob(state.lastActiveJobNo)
          ? state.lastActiveJobNo
          : state.data.jobs[0].jobNo;
        openTaskModal(targetJobNo, null);
        els.taskStartInput.value = ymdKey(c.y, c.m, c.d);
        els.taskDueInput.value = ymdKey(c.y, c.m, c.d);
      });
      weekRow.appendChild(cell);
    }

    // Bars overlay for this week
    const bars = document.createElement('div');
    bars.className = 'cal-week-bars';

    // Determine segments that intersect this week, assign lanes
    const segs = [];
    for (const sp of spans) {
      const startIdx = Math.max(0, diffDaysYmd(weekStart, sp.start));
      const endIdx = Math.min(6, diffDaysYmd(weekStart, sp.end));
      if (endIdx < 0 || startIdx > 6) continue;
      segs.push({
        sp,
        startIdx, endIdx,
        contLeft: diffDaysYmd(weekStart, sp.start) < 0,
        contRight: diffDaysYmd(weekStart, sp.end) > 6
      });
    }
    // Sort: longer spans first, then earlier start
    segs.sort((a, b) => (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx) || a.startIdx - b.startIdx);
    // Lane assignment
    const lanes = []; // each lane is array of occupied [s,e]
    for (const seg of segs) {
      let lane = 0;
      while (true) {
        const occ = lanes[lane] || [];
        const conflict = occ.some(r => !(seg.endIdx < r[0] || seg.startIdx > r[1]));
        if (!conflict) {
          if (!lanes[lane]) lanes[lane] = [];
          lanes[lane].push([seg.startIdx, seg.endIdx]);
          seg.lane = lane;
          break;
        }
        lane++;
      }
    }

    // Bars are rendered later (after the grid is in the DOM) so we can measure
    // each week row's actual height and adapt the visible lane count.
    monthBarsState.push({
      weekRow, bars, segs, weekStart,
      cellsInWeek: cells.slice(w * 7, w * 7 + 7)
    });

    weekRow.appendChild(bars);
    grid.appendChild(weekRow);
  }
  body.appendChild(grid);

  monthLaneH = Math.round(20 * (ZOOM_FACTORS[zoomLevel] || 1));
  // Initial dynamic layout pass — runs after the browser has computed week row heights.
  requestAnimationFrame(relayoutMonthBars);

  // Re-run layout whenever the calendar wrap resizes so the "+더보기" count
  // and visible lanes track the available row height in real time.
  if (typeof ResizeObserver !== 'undefined') {
    if (monthResizeObserver) monthResizeObserver.disconnect();
    else monthResizeObserver = new ResizeObserver(() => relayoutMonthBars());
    monthResizeObserver.observe(grid);
  }
}

// Render bars + "+N 더보기" labels for every week row, sized to the row's height.
function relayoutMonthBars() {
  if (state.viewMode !== 'calendar' || state.calendarMode !== 'month') return;
  for (const data of monthBarsState) relayoutMonthWeek(data);
}

function relayoutMonthWeek(data) {
  const { weekRow, bars, segs, weekStart, cellsInWeek } = data;
  bars.innerHTML = '';
  // .cal-week-bars CSS positions itself below the date number and above the
  // row bottom, so its own clientHeight is the usable area for bars.
  const available = bars.clientHeight;
  if (available <= 0) return; // not laid out yet
  let maxLanes = Math.max(1, Math.floor(available / monthLaneH));
  const highestLane = segs.reduce((m, s) => Math.max(m, s.lane), -1);
  const overflowExists = highestLane >= maxLanes;
  if (overflowExists) {
    // Reserve one lane height for the "+N 더보기" row
    maxLanes = Math.max(1, Math.floor((available - monthLaneH) / monthLaneH));
  }
  const overflowByDay = [0, 0, 0, 0, 0, 0, 0];
  for (const seg of segs) {
    if (seg.lane < maxLanes) {
      renderBar(bars, seg, weekStart, monthLaneH);
    } else {
      for (let d = seg.startIdx; d <= seg.endIdx; d++) overflowByDay[d]++;
    }
  }
  overflowByDay.forEach((cnt, d) => {
    if (cnt <= 0) return;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'cal-bar-more';
    more.textContent = `+ ${cnt} 더보기`;
    more.style.left = `calc(${(d / 7) * 100}% + 4px)`;
    more.style.width = `calc(${(1 / 7) * 100}% - 8px)`;
    more.style.top = (maxLanes * monthLaneH) + 'px';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = cellsInWeek[d];
      state.calendarFocus = { y: c.y, m: c.m, d: c.d };
      setCalendarMode('week');
    });
    bars.appendChild(more);
  });
}

function renderBar(container, seg, weekStart, LANE_H) {
  const { sp, startIdx, endIdx, lane, contLeft, contRight } = seg;
  const bar = document.createElement('div');
  bar.className = `cal-bar status-${sp.task.status} prio-${sp.task.priority}`;
  if (contLeft) bar.classList.add('cont-left');
  if (contRight) bar.classList.add('cont-right');
  const leftPct = (startIdx / 7) * 100;
  const widthPct = ((endIdx - startIdx + 1) / 7) * 100;
  bar.style.left = `calc(${leftPct}% + 2px)`;
  bar.style.width = `calc(${widthPct}% - 4px)`;
  bar.style.top = (lane * LANE_H) + 'px';
  const barJobColor = getJobColor(sp.jobNo);
  if (barJobColor) {
    bar.style.background = barJobColor;
    bar.style.borderLeftColor = barJobColor;
  }
  const showTime = !contLeft && sp.task.startTime ? `<span class="cal-bar-time">${escapeHtml(sp.task.startTime)}</span>` : '';
  bar.innerHTML = `
    <div class="cal-bar-handle left"></div>
    ${showTime}
    <span class="cal-bar-title">${escapeHtml(formatTaskTitle(sp.task))}</span>
    <div class="cal-bar-handle right"></div>
  `;
  bar.title = `[${sp.jobNo}] ${formatTaskTitle(sp.task)}`;
  bar.dataset.taskId = sp.task.id;
  bar.dataset.jobNo = sp.jobNo;
  attachMonthBarDrag(bar, sp, weekStart);
  container.appendChild(bar);
}

// ----- Drag/Resize: Month spanning bars -----
function attachMonthBarDrag(bar, sp, weekStart) {
  let mode = null; // 'move' | 'resize-l' | 'resize-r'
  let startX = 0, startY = 0;
  let dayPx = 0, weekPx = 0;
  let didDrag = false;
  let siblings = [];
  let grid = null;
  let origTaskFields = null;     // snapshot for resize cancel/restore
  let lastDCol = 0, lastDRow = 0;

  function onDown(e, m) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    mode = m;
    didDrag = false;
    startX = e.clientX;
    startY = e.clientY;
    grid = bar.closest('.cal-month-grid');
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    dayPx = gridRect.width / 7;
    const firstWeek = grid.querySelector('.cal-month-week-row');
    weekPx = firstWeek ? firstWeek.getBoundingClientRect().height : (gridRect.height / 6);
    siblings = Array.from(grid.querySelectorAll(`.cal-bar[data-task-id="${cssEscape(sp.task.id)}"]`));
    siblings.forEach(s => s.classList.add('dragging'));
    lastDCol = 0; lastDRow = 0;
    if (mode === 'resize-l' || mode === 'resize-r') {
      const t = findTask(sp.jobNo, sp.task.id);
      origTaskFields = t ? {
        startDate: t.startDate || '',
        endDate: t.endDate || '',
        dueDate: t.dueDate || ''
      } : null;
    } else {
      origTaskFields = null;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    if (mode === 'move') {
      const tf = `translate(${dx}px, ${dy}px)`;
      siblings.forEach(s => { s.style.transform = tf; });
      return;
    }
    // Resize modes: live preview by mutating task dates + full re-render per snap step
    const dCol = Math.round(dx / dayPx);
    const dRow = Math.round(dy / weekPx);
    if (dCol === lastDCol && dRow === lastDRow) return;
    lastDCol = dCol; lastDRow = dRow;
    const dDays = dRow * 7 + dCol;
    const task = findTask(sp.jobNo, sp.task.id);
    if (!task) return;
    let ns = sp.originalStart, ne = sp.originalEnd;
    if (mode === 'resize-l') {
      ns = addDaysYmd(sp.originalStart, dDays);
      if (diffDaysYmd(ns, sp.originalEnd) < 0) ns = sp.originalEnd;
    } else if (mode === 'resize-r') {
      ne = addDaysYmd(sp.originalEnd, dDays);
      if (diffDaysYmd(sp.originalStart, ne) < 0) ne = sp.originalStart;
    }
    applyTaskDateChange(task, ns, ne);
    renderCalendar();
    // Keep dragging visual on the freshly rendered segments
    document.querySelectorAll(`.cal-bar[data-task-id="${cssEscape(sp.task.id)}"]`)
      .forEach(s => s.classList.add('dragging'));
  }

  async function onUp(e) {
    // try/finally guarantees document listeners detach even if saveData / render throws.
    try {
      if (mode === 'move') {
        siblings.forEach(s => {
          s.classList.remove('dragging');
          s.style.transform = '';
        });
        if (!didDrag) {
          openTaskModal(sp.jobNo, sp.task.id);
          mode = null;
          return;
        }
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dCol = Math.round(dx / dayPx);
        const dRow = Math.round(dy / weekPx);
        const dDays = dRow * 7 + dCol;
        if (dDays === 0) { renderCalendar(); mode = null; return; }
        const task = findTask(sp.jobNo, sp.task.id);
        if (!task) { mode = null; return; }
        const newStart = addDaysYmd(sp.originalStart, dDays);
        const newEnd = addDaysYmd(sp.originalEnd, dDays);
        applyTaskDateChange(task, newStart, newEnd);
        await saveData();
        renderCalendar();
        mode = null;
        return;
      }

      // Resize modes — task has already been mutated live in onMove
      const noChange = lastDCol === 0 && lastDRow === 0;
      if (!didDrag || noChange) {
        // Restore original fields and re-render clean
        if (origTaskFields) {
          const t = findTask(sp.jobNo, sp.task.id);
          if (t) {
            t.startDate = origTaskFields.startDate;
            t.endDate = origTaskFields.endDate;
            t.dueDate = origTaskFields.dueDate;
          }
        }
        const wasClick = !didDrag;
        renderCalendar();
        if (wasClick) openTaskModal(sp.jobNo, sp.task.id);
        mode = null;
        return;
      }
      await saveData();
      renderCalendar();
      mode = null;
    } finally {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  bar.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('cal-bar-handle')) {
      onDown(e, t.classList.contains('left') ? 'resize-l' : 'resize-r');
    } else {
      onDown(e, 'move');
    }
  });
}


function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// Apply a date change to a task respecting which fields originally existed.
function applyTaskDateChange(task, newStart, newEnd) {
  const sd = parseYMD(task.startDate);
  const ed = parseYMD(task.endDate);
  const due = parseYMD(task.dueDate);
  const sKey = ymdKey(newStart.y, newStart.m, newStart.d);
  const eKey = ymdKey(newEnd.y, newEnd.m, newEnd.d);
  if (sd && ed) {
    task.startDate = sKey;
    task.endDate = eKey;
  } else if (sd && !ed) {
    task.startDate = sKey;
    if (sKey !== eKey) task.endDate = eKey;
    if (due) task.dueDate = eKey;
  } else if (!sd && due) {
    task.dueDate = eKey;
    if (sKey !== eKey) task.startDate = sKey;
  } else if (sd) {
    task.startDate = sKey;
  } else {
    // Only endDate existed
    task.endDate = eKey;
  }
  task.updatedAt = nowIso();
}

function renderCalendarWeek() {
  const body = els.calendarBody;
  // Preserve scroll position from previous week-grid (if re-rendering same view)
  const prevWrap = body.querySelector('.cal-week-grid-wrap');
  const savedScrollTop = prevWrap ? prevWrap.scrollTop : null;
  body.innerHTML = '';
  body.className = 'calendar-body cal-week';

  const f = state.calendarFocus;
  const sw = startOfWeekYmd(f);
  const today = ymdFromDate(new Date());

  // Header: time-col placeholder + 7 day columns
  const headWrap = document.createElement('div');
  headWrap.className = 'cal-week-head';
  const corner = document.createElement('div');
  corner.className = 'cal-week-corner';
  headWrap.appendChild(corner);
  const wdNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayCols = [];
  for (let i = 0; i < 7; i++) {
    const dy = addDaysYmd(sw, i);
    dayCols.push(dy);
    const dh = document.createElement('div');
    dh.className = 'cal-week-day-head';
    if (i === 0) dh.classList.add('sun');
    if (i === 6) dh.classList.add('sat');
    if (dy.y === today.y && dy.m === today.m && dy.d === today.d) dh.classList.add('today');
    dh.innerHTML = `<span class="cal-week-day-name">${wdNames[i]}</span><span class="cal-week-day-num">${dy.d}</span>`;
    headWrap.appendChild(dh);
  }
  body.appendChild(headWrap);

  // All-day band (tasks without startTime that fall in week)
  const all = getCalendarTasks();
  const allDayBand = document.createElement('div');
  allDayBand.className = 'cal-week-allday';
  const adLabel = document.createElement('div');
  adLabel.className = 'cal-week-allday-label';
  adLabel.textContent = '종일';
  allDayBand.appendChild(adLabel);
  // For each day col, list all-day items
  const adCols = [];
  for (let i = 0; i < 7; i++) {
    const col = document.createElement('div');
    col.className = 'cal-week-allday-col';
    if (i === 0) col.classList.add('sun');
    if (i === 6) col.classList.add('sat');
    if (dayCols[i].y === today.y && dayCols[i].m === today.m && dayCols[i].d === today.d) col.classList.add('today');
    allDayBand.appendChild(col);
    adCols.push(col);
  }
  body.appendChild(allDayBand);

  // Grid wrap (scrollable)
  const gridWrap = document.createElement('div');
  gridWrap.className = 'cal-week-grid-wrap';
  const grid = document.createElement('div');
  grid.className = 'cal-week-grid';

  // Time column
  const timeCol = document.createElement('div');
  timeCol.className = 'cal-week-time-col';
  for (let h = 0; h < 24; h++) {
    const hr = document.createElement('div');
    hr.className = 'cal-week-time-slot';
    hr.textContent = pad2(h) + ':00';
    timeCol.appendChild(hr);
  }
  grid.appendChild(timeCol);

  // Day columns
  const HOUR_PX = Math.round(44 * (ZOOM_FACTORS[zoomLevel] || 1));
  const colEls = [];
  for (let i = 0; i < 7; i++) {
    const col = document.createElement('div');
    col.className = 'cal-week-day-col';
    if (i === 0) col.classList.add('sun');
    if (i === 6) col.classList.add('sat');
    if (dayCols[i].y === today.y && dayCols[i].m === today.m && dayCols[i].d === today.d) col.classList.add('today');
    for (let h = 0; h < 24; h++) {
      const slot = document.createElement('div');
      slot.className = 'cal-week-slot';
      const dy = dayCols[i];
      slot.addEventListener('dblclick', () => {
        if (state.data.jobs.length === 0) { showAlert('먼저 JOB을 추가하세요.'); return; }
        const targetJobNo = state.lastActiveJobNo && findJob(state.lastActiveJobNo)
          ? state.lastActiveJobNo
          : state.data.jobs[0].jobNo;
        openTaskModal(targetJobNo, null);
        els.taskStartInput.value = ymdKey(dy.y, dy.m, dy.d);
        els.taskStartTimeInput.value = pad2(h) + ':00';
      });
      col.appendChild(slot);
    }
    grid.appendChild(col);
    colEls.push(col);
  }
  gridWrap.appendChild(grid);
  body.appendChild(gridWrap);

  // Place tasks
  for (const it of all) {
    const days = taskOccupiedDays(it.task);
    // Multi-day spans always render as all-day bands (time grid is for single-day events only)
    const isMultiDay = days.length > 1;
    for (const k of days) {
      const idx = dayCols.findIndex(d => ymdKey(d.y, d.m, d.d) === k);
      if (idx === -1) continue;
      const hasStartTime = !!it.task.startTime;
      const isMatchingStart = !isMultiDay && it.task.startDate === k && hasStartTime;
      if (isMatchingStart) {
        // Place in time grid
        const [sh, sm] = it.task.startTime.split(':').map(Number);
        let endH = sh + 1, endM = sm;
        if (it.task.endTime && it.task.endDate === k) {
          const [eh, em] = it.task.endTime.split(':').map(Number);
          endH = eh; endM = em;
        }
        const startMin = sh * 60 + sm;
        let endMin = endH * 60 + endM;
        if (endMin <= startMin) endMin = startMin + 30;
        const top = (startMin / 60) * HOUR_PX;
        const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_PX - 2);
        const ev = document.createElement('div');
        ev.className = `cal-week-event status-${it.task.status} prio-${it.task.priority}`;
        ev.style.top = top + 'px';
        ev.style.height = height + 'px';
        const weekJobColor = getJobColor(it.jobNo);
        if (weekJobColor) {
          ev.style.background = weekJobColor;
          ev.style.borderLeftColor = weekJobColor;
        }
        ev.innerHTML = `
          <div class="cal-week-event-handle top"></div>
          <div class="cal-week-event-time">${escapeHtml(it.task.startTime)}${it.task.endTime ? ' - ' + escapeHtml(it.task.endTime) : ''}</div>
          <div class="cal-week-event-title">${escapeHtml(formatTaskTitle(it.task))}</div>
          <div class="cal-week-event-jobno">${escapeHtml(it.jobNo)}</div>
          <div class="cal-week-event-handle bottom"></div>
        `;
        ev.title = `[${it.jobNo}] ${formatTaskTitle(it.task)}`;
        attachWeekEventDrag(ev, it.jobNo, it.task.id, HOUR_PX);
        colEls[idx].appendChild(ev);
      } else {
        // All-day item
        const ev = document.createElement('div');
        ev.className = `cal-allday-event status-${it.task.status} prio-${it.task.priority}`;
        const alldayJobColor = getJobColor(it.jobNo);
        if (alldayJobColor) {
          ev.style.background = alldayJobColor;
          ev.style.borderLeftColor = alldayJobColor;
        }
        ev.textContent = formatTaskTitle(it.task);
        ev.title = `[${it.jobNo}] ${formatTaskTitle(it.task)}`;
        ev.addEventListener('click', (e) => {
          e.stopPropagation();
          openTaskModal(it.jobNo, it.task.id);
        });
        adCols[idx].appendChild(ev);
      }
    }
  }

  // Restore scroll if same view re-rendered; else default to ~7:00
  setTimeout(() => {
    if (!gridWrap) return;
    gridWrap.scrollTop = savedScrollTop != null ? savedScrollTop : HOUR_PX * 7;
  }, 0);
}

// ----- Drag/Resize: Week time-grid events -----
function attachWeekEventDrag(ev, jobNo, taskId, HOUR_PX) {
  const SNAP_MIN = 15;
  let mode = null;       // 'move' | 'resize-t' | 'resize-b'
  let startX = 0, startY = 0;
  let colPx = 0;
  let didDrag = false;
  let origTopPx = 0, origHeightPx = 0;

  function onDown(e, m) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    mode = m;
    didDrag = false;
    startX = e.clientX;
    startY = e.clientY;
    const col = ev.parentElement; // .cal-week-day-col
    colPx = col ? col.getBoundingClientRect().width : 0;
    origTopPx = parseFloat(ev.style.top) || 0;
    origHeightPx = parseFloat(ev.style.height) || ev.getBoundingClientRect().height;
    ev.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function onMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    if (mode === 'move') {
      ev.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (mode === 'resize-t') {
      const newTop = origTopPx + dy;
      const newHeight = Math.max(20, origHeightPx - dy);
      ev.style.top = newTop + 'px';
      ev.style.height = newHeight + 'px';
    } else if (mode === 'resize-b') {
      const newHeight = Math.max(20, origHeightPx + dy);
      ev.style.height = newHeight + 'px';
    }
  }
  async function onUp(e) {
    try {
      ev.classList.remove('dragging');
      ev.style.transform = '';
      ev.style.marginBottom = '';
      if (!didDrag) {
        openTaskModal(jobNo, taskId);
        mode = null;
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Snap delta minutes (vertical) and column delta (horizontal)
      const deltaMin = Math.round((dy / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
      const dCol = colPx > 0 ? Math.round(dx / colPx) : 0;
      if (deltaMin === 0 && dCol === 0) {
        // Resize preview may have nudged top/height; restore originals
        ev.style.top = origTopPx + 'px';
        ev.style.height = origHeightPx + 'px';
        mode = null;
        return;
      }

      const task = findTask(jobNo, taskId);
      if (!task || !task.startTime) { mode = null; return; }
      const [sh, sm] = task.startTime.split(':').map(Number);
      let startMin = sh * 60 + sm;
      let endMin;
      if (task.endTime && task.endDate === task.startDate) {
        const [eh, em] = task.endTime.split(':').map(Number);
        endMin = eh * 60 + em;
      } else {
        endMin = startMin + 60;
      }
      if (mode === 'move') {
        startMin += deltaMin;
        endMin += deltaMin;
      } else if (mode === 'resize-t') {
        startMin += deltaMin;
        if (startMin >= endMin) startMin = endMin - SNAP_MIN;
      } else if (mode === 'resize-b') {
        endMin += deltaMin;
        if (endMin <= startMin) endMin = startMin + SNAP_MIN;
      }
      startMin = Math.max(0, Math.min(24 * 60 - SNAP_MIN, startMin));
      endMin = Math.max(SNAP_MIN, Math.min(24 * 60, endMin));
      task.startTime = pad2(Math.floor(startMin / 60)) + ':' + pad2(startMin % 60);
      task.endTime = pad2(Math.floor(endMin / 60)) + ':' + pad2(endMin % 60);
      // Horizontal date shift (move mode only)
      if (mode === 'move' && dCol !== 0) {
        const sd = parseYMD(task.startDate);
        if (sd) {
          const ns = addDaysYmd(sd, dCol);
          task.startDate = ymdKey(ns.y, ns.m, ns.d);
        }
        const ed = parseYMD(task.endDate);
        if (ed) {
          const ne = addDaysYmd(ed, dCol);
          task.endDate = ymdKey(ne.y, ne.m, ne.d);
        } else {
          task.endDate = task.startDate;
        }
      } else {
        if (!task.endDate) task.endDate = task.startDate;
      }
      task.updatedAt = nowIso();
      await saveData();
      renderCalendar();
      mode = null;
    } finally {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  ev.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('cal-week-event-handle')) {
      onDown(e, t.classList.contains('top') ? 'resize-t' : 'resize-b');
    } else {
      onDown(e, 'move');
    }
  });
}

function calendarNavigate(delta) {
  const f = state.calendarFocus || ymdFromDate(new Date());
  if (state.calendarMode === 'month') {
    const nm = f.m + delta;
    const dt = new Date(f.y, nm, 1);
    state.calendarFocus = { y: dt.getFullYear(), m: dt.getMonth(), d: 1 };
  } else {
    state.calendarFocus = addDaysYmd(f, delta * 7);
  }
  renderCalendar();
}

function calendarGoToday() {
  state.calendarFocus = ymdFromDate(new Date());
  renderCalendar();
}

// ----- Render: List -----
function renderList() {
  const tbody = els.taskTableBody;
  tbody.innerHTML = '';

  if (state.data.jobs.length === 0) {
    els.taskTable.classList.add('hidden');
    els.listEmpty.classList.remove('hidden');
    els.boardCount.textContent = '';
    return;
  }
  els.taskTable.classList.remove('hidden');
  els.listEmpty.classList.add('hidden');

  let totalTasks = 0;
  let visibleTotal = 0;

  for (const job of state.data.jobs) {
    const allTasks = Array.isArray(job.tasks) ? job.tasks : [];
    totalTasks += allTasks.length;
    const tasks = applyFiltersSort(allTasks);
    visibleTotal += tasks.length;

    // Group header row
    const groupRow = document.createElement('tr');
    groupRow.className = 'group-row';
    groupRow.innerHTML = `<td colspan="8">${escapeHtml(job.jobNo)} · ${escapeHtml(job.title)} <span style="color:#888;font-weight:500;">(${tasks.length}/${allTasks.length})</span></td>`;
    tbody.appendChild(groupRow);

    if (tasks.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'list-empty-row';
      emptyRow.innerHTML = `<td colspan="8">${allTasks.length === 0 ? 'Task가 없습니다' : '필터에 일치하는 Task 없음'}</td>`;
      tbody.appendChild(emptyRow);
      continue;
    }

    for (const task of tasks) {
      tbody.appendChild(renderListRow(job.jobNo, task));
    }
  }

  els.boardCount.textContent = `${state.data.jobs.length} JOBs · ${totalTasks} Tasks`;
}

function renderListRow(jobNo, task) {
  const tr = document.createElement('tr');
  if (task.status === '완료') tr.classList.add('row-completed');
  tr.dataset.id = task.id;
  tr.dataset.jobNo = jobNo;
  const overdue = isOverdue(task.dueDate, task.status);

  const startCell = formatDateTime(task.startDate, task.startTime);
  const endCell = formatDateTime(task.endDate, task.endTime);
  tr.innerHTML = `
    <td class="cell-jobno">${escapeHtml(jobNo)}</td>
    <td class="cell-title">${escapeHtml(formatTaskTitle(task))}</td>
    <td><span class="status-badge s-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span></td>
    <td><span class="badge badge-priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span></td>
    <td class="cell-date">${startCell ? escapeHtml(startCell) : '-'}</td>
    <td class="cell-date${overdue ? ' overdue' : ''}">${task.dueDate ? escapeHtml(task.dueDate) + (overdue ? ' (지남)' : '') : '-'}</td>
    <td class="cell-date">${endCell ? escapeHtml(endCell) : '-'}</td>
    <td class="cell-memo">${task.memo ? escapeHtml(task.memo) : ''}</td>
  `;

  tr.addEventListener('click', () => openTaskModal(jobNo, task.id));
  return tr;
}

// ----- Render: Board -----
function renderBoard() {
  const board = els.board;
  // Install the single delegated click listener once (idempotent)
  setupBoardDelegation();
  // FLIP First: capture pre-rebuild rects for both columns and cards so we can
  // animate JOB column reorder and card sort/move/status changes.
  const prevColRects = captureColumnPositions(board);
  const prevCardRects = captureCardPositions(board);
  // Clear board but keep empty placeholder reference
  board.innerHTML = '';

  if (state.data.jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'board-empty';
    empty.innerHTML = '<p>등록된 JOB이 없습니다.</p><p>상단의 <strong>+ JOB 추가</strong> 버튼으로 시작하세요.</p>';
    board.appendChild(empty);
    els.boardCount.textContent = '';
    return;
  }

  let totalTasks = 0;
  for (const job of state.data.jobs) {
    const allTasks = Array.isArray(job.tasks) ? job.tasks : [];
    totalTasks += allTasks.length;
    const tasks = applyFiltersSort(allTasks);
    const col = renderColumn(job, tasks, allTasks.length);
    board.appendChild(col);
  }

  els.boardCount.textContent = `${state.data.jobs.length} JOBs · ${totalTasks} Tasks`;
  // FLIP Last/Invert/Play: animate moved columns first, then cards — skipping
  // cards inside a moved column (the column transform already carries them).
  const movedColumns = playColumnFlipAnimation(board, prevColRects);
  playCardFlipAnimation(board, prevCardRects, movedColumns);
}

function renderColumn(job, visibleTasks, totalCount) {
  const col = document.createElement('section');
  col.className = 'column';
  col.dataset.jobNo = job.jobNo;
  if (job.color) {
    col.classList.add('has-color');
    col.style.setProperty('--job-color', job.color);
  }

  // Header
  const header = document.createElement('div');
  header.className = 'column-header';
  header.innerHTML = `
    <div class="column-header-top">
      <span class="column-jobno">${escapeHtml(job.jobNo)}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="column-count">${visibleTasks.length}/${totalCount}</span>
        <button class="column-edit" title="JOB 수정" data-action="edit-job">✎</button>
        <button class="column-delete" title="JOB 삭제" data-action="delete-job">×</button>
      </div>
    </div>
    <div class="column-title">${escapeHtml(job.title)}</div>
  `;
  // edit-job / delete-job click handlers live in setupBoardDelegation()
  col.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'column-body';
  if (visibleTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'column-empty';
    empty.textContent = totalCount === 0 ? 'Task가 없습니다' : '필터에 일치하는 Task 없음';
    body.appendChild(empty);
  } else {
    for (const task of visibleTasks) {
      body.appendChild(renderCard(job.jobNo, task));
    }
  }
  col.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'column-footer';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-ghost';
  addBtn.textContent = '+ Task 추가';
  addBtn.addEventListener('click', () => openTaskModal(job.jobNo, null));
  footer.appendChild(addBtn);
  col.appendChild(footer);

  // ----- JOB column drag & drop reorder -----
  // Drag is initiated only from the header (not its buttons) to avoid
  // interfering with card interactions inside the column body.
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    col.draggable = true;
  });
  const clearDraggable = () => { col.draggable = false; };
  header.addEventListener('mouseup', clearDraggable);
  col.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', job.jobNo);
    e.dataTransfer.effectAllowed = 'move';
    col.classList.add('dragging');
    draggingJobNo = job.jobNo;
  });
  col.addEventListener('dragend', () => {
    col.classList.remove('dragging');
    clearDraggable();
    hideDropIndicator();
    draggingJobNo = null;
  });
  // dragover/drop are handled at the board level (see setupBoardDelegation) so
  // that drops landing in the gaps between columns or the board's padding —
  // including the far-right edge — are still resolved to an insertion point.

  return col;
}

// ----- JOB drag drop indicator (vertical line between columns) -----
function getDropIndicator() {
  if (!els.board) return null;
  let el = els.board.querySelector('.board-drop-indicator');
  if (!el) {
    el = document.createElement('div');
    el.className = 'board-drop-indicator';
    els.board.appendChild(el);
  }
  return el;
}
function showDropIndicator(col, after) {
  const ind = getDropIndicator();
  if (!ind) return;
  const boardRect = els.board.getBoundingClientRect();
  const colRect = col.getBoundingClientRect();
  // Half of board's column gap (14px) — center the line within the gap
  const halfGap = 7;
  const edge = after ? colRect.right : colRect.left;
  const x = edge - boardRect.left + els.board.scrollLeft + (after ? halfGap - 1.5 : -halfGap - 1.5);
  ind.style.left = x + 'px';
  ind.classList.add('visible');
}
function hideDropIndicator() {
  if (!els.board) return;
  const ind = els.board.querySelector('.board-drop-indicator');
  if (ind) ind.classList.remove('visible');
}

// ----- FLIP animation for sort/reorder transitions -----
// Captures DOM rects of all cards keyed by task id BEFORE rebuild,
// then animates each surviving card from its old to new position.
function captureCardPositions(board) {
  const map = new Map();
  if (!board) return map;
  board.querySelectorAll('.card').forEach(card => {
    if (card.dataset.id) map.set(card.dataset.id, card.getBoundingClientRect());
  });
  return map;
}
// Same idea for whole JOB columns, keyed by jobNo, so column reorder animates too.
function captureColumnPositions(board) {
  const map = new Map();
  if (!board) return map;
  board.querySelectorAll('.column').forEach(col => {
    if (col.dataset.jobNo) map.set(col.dataset.jobNo, col.getBoundingClientRect());
  });
  return map;
}
const FLIP_OPTS = { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
// Animate columns from their previous to new position. Returns the set of
// jobNos that actually moved, so the caller can skip per-card FLIP inside them
// (the column's transform already carries its cards — animating both would
// double the motion).
function playColumnFlipAnimation(board, prevRects) {
  const moved = new Set();
  if (!board || !prevRects || !prevRects.size) return moved;
  board.querySelectorAll('.column').forEach(col => {
    const jobNo = col.dataset.jobNo;
    if (!jobNo) return;
    const prev = prevRects.get(jobNo);
    if (!prev) return;
    const curr = col.getBoundingClientRect();
    const dx = prev.left - curr.left;
    const dy = prev.top - curr.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    moved.add(jobNo);
    col.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      FLIP_OPTS
    );
  });
  return moved;
}
// movedColumns: jobNos whose column is being animated — their cards ride along
// via the column transform, so we skip animating those cards individually.
function playCardFlipAnimation(board, prevRects, movedColumns) {
  if (!board || !prevRects || !prevRects.size) return;
  board.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    if (!id) return;
    if (movedColumns && movedColumns.has(card.dataset.jobNo)) return;
    const prev = prevRects.get(id);
    if (!prev) return;
    const curr = card.getBoundingClientRect();
    const dx = prev.left - curr.left;
    const dy = prev.top - curr.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    // Web Animations API runs alongside CSS — auto-cleans up so :hover transforms work afterwards.
    card.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      FLIP_OPTS
    );
  });
}

// Move a JOB column before/after another and persist the new order.
async function reorderJobs(fromJobNo, toJobNo, insertAfter) {
  if (!fromJobNo || fromJobNo === toJobNo) return;
  const jobs = state.data.jobs;
  const fromIdx = jobs.findIndex(j => j.jobNo === fromJobNo);
  if (fromIdx < 0) return;
  const [moved] = jobs.splice(fromIdx, 1);
  let toIdx = jobs.findIndex(j => j.jobNo === toJobNo);
  if (toIdx < 0) { jobs.splice(fromIdx, 0, moved); return; }
  if (insertAfter) toIdx++;
  jobs.splice(toIdx, 0, moved);
  await saveData();
  renderBoard();
}

function renderCard(jobNo, task) {
  const card = document.createElement('div');
  card.className = `card status-${task.status}`;
  card.dataset.id = task.id;
  card.dataset.jobNo = jobNo;
  const cardJobColor = getJobColor(jobNo);
  if (cardJobColor) card.style.borderLeft = `3px solid ${cardJobColor}`;

  const overdue = isOverdue(task.dueDate, task.status);
  const dueText = task.dueDate ? task.dueDate : '';
  const startText = formatDateTime(task.startDate, task.startTime);
  const endText = formatDateTime(task.endDate, task.endTime);
  const timeBits = [];
  if (startText) timeBits.push(`<span><span class="time-label">시작</span>${escapeHtml(startText)}</span>`);
  if (endText) timeBits.push(`<span><span class="time-label">종료</span>${escapeHtml(endText)}</span>`);

  card.innerHTML = `
    <button type="button" class="card-delete" data-no-edit data-action="delete" title="삭제" aria-label="Task 삭제">×</button>
    <div class="card-title">${escapeHtml(formatTaskTitle(task))}</div>
    <div class="card-meta">
      <button type="button" class="badge badge-priority-${escapeHtml(task.priority)} priority-btn" data-no-edit data-action="edit-priority" title="우선순위 변경">${escapeHtml(task.priority)}</button>
      ${dueText ? `<span class="card-due${overdue ? ' overdue' : ''}">📅 ${escapeHtml(dueText)}${overdue ? ' (지남)' : ''}</span>` : ''}
    </div>
    ${timeBits.length ? `<div class="card-times">${timeBits.join('')}</div>` : ''}
    ${task.memo ? `<div class="card-memo">${escapeHtml(task.memo)}</div>` : ''}
    <div class="status-control" data-no-edit>
      ${STATUSES.map(s => `
        <button type="button" data-status="${s}" class="${task.status === s ? 'active s-' + s : ''}">${s}</button>
      `).join('')}
    </div>
  `;
  // Per-card listeners removed — see setupBoardDelegation() for the single
  // delegated click handler on els.board that dispatches all card actions.
  return card;
}

// One-time delegated click handler for the board view. Replaces ~4 listeners
// per card (status × N, priority, delete, card-click) that were re-attached
// on every renderAll. Idempotent — guard with a flag so multiple init calls
// don't accumulate listeners.
let boardDelegationInstalled = false;
// jobNo of the column currently being dragged (null when no drag in progress).
// Used by the board-level drag handlers to ignore unrelated drags.
let draggingJobNo = null;

// Given a cursor X, find the insertion point among the non-dragging columns.
// Returns { refCol, after }. When the cursor is past every column's midpoint
// (e.g. over the board's right padding), this returns the last column with
// after=true — which is what makes "drop to the far right" work even though
// there is no column element under the cursor there.
function getDragInsertionPoint(clientX) {
  const cols = Array.from(els.board.querySelectorAll('.column:not(.dragging)'));
  if (cols.length === 0) return { refCol: null, after: true };
  for (const col of cols) {
    const rect = col.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { refCol: col, after: false };
    }
  }
  return { refCol: cols[cols.length - 1], after: true };
}
function setupBoardDelegation() {
  if (boardDelegationInstalled || !els.board) return;
  boardDelegationInstalled = true;
  els.board.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Column header actions
    const editJobBtn = target.closest('[data-action="edit-job"]');
    if (editJobBtn) {
      e.stopPropagation();
      const col = editJobBtn.closest('.column');
      if (col && col.dataset.jobNo) openJobModal(col.dataset.jobNo);
      return;
    }
    const delJobBtn = target.closest('[data-action="delete-job"]');
    if (delJobBtn) {
      e.stopPropagation();
      const col = delJobBtn.closest('.column');
      if (col && col.dataset.jobNo) deleteJob(col.dataset.jobNo);
      return;
    }

    // Card-scoped actions: resolve jobNo + task id from the card element
    const card = target.closest('.card');
    if (!card) return;
    const jobNo = card.dataset.jobNo;
    const taskId = card.dataset.id;
    if (!jobNo || !taskId) return;

    // Status button
    const statusBtn = target.closest('[data-status]');
    if (statusBtn && card.contains(statusBtn)) {
      e.stopPropagation();
      const newStatus = statusBtn.getAttribute('data-status');
      fireAndForget(changeTaskStatus(jobNo, taskId, newStatus), '상태 변경 저장 실패');
      return;
    }

    // Priority badge
    const prBtn = target.closest('[data-action="edit-priority"]');
    if (prBtn && card.contains(prBtn)) {
      e.stopPropagation();
      const task = findTask(jobNo, taskId);
      if (!task) return;
      PriorityPicker.open(prBtn, task.priority, (next) => {
        fireAndForget(changeTaskPriority(jobNo, taskId, next), '우선순위 저장 실패');
      });
      return;
    }

    // Delete button
    const delBtn = target.closest('[data-action="delete"]');
    if (delBtn && card.contains(delBtn)) {
      e.stopPropagation();
      deleteTask(jobNo, taskId);
      return;
    }

    // Otherwise: card body click → open edit modal
    if (target.closest('[data-no-edit]')) return;
    openTaskModal(jobNo, taskId);
  });

  // ----- JOB column reorder: board-level drag handling -----
  // Delegated to the board (not each column) so the cursor can be anywhere over
  // the board — including gaps between columns and the right-edge padding past
  // the last column — and still resolve to a valid insertion point.
  els.board.addEventListener('dragover', (e) => {
    if (!draggingJobNo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const { refCol, after } = getDragInsertionPoint(e.clientX);
    if (refCol) showDropIndicator(refCol, after);
  });
  els.board.addEventListener('drop', (e) => {
    if (!draggingJobNo) return;
    e.preventDefault();
    hideDropIndicator();
    const fromJobNo = e.dataTransfer.getData('text/plain') || draggingJobNo;
    const { refCol, after } = getDragInsertionPoint(e.clientX);
    if (refCol && refCol.dataset.jobNo) {
      fireAndForget(reorderJobs(fromJobNo, refCol.dataset.jobNo, after), 'JOB 순서 변경 실패');
    }
  });
}

// ----- Job actions -----
function getJobColor(jobNo) {
  const job = findJob(jobNo);
  return (job && job.color) ? job.color : '';
}

function buildJobColorPicker(selected) {
  const wrap = els.jobColorPicker;
  wrap.innerHTML = '';
  els.jobColorInput.value = selected || '';
  const mkSwatch = (color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'color-swatch' + (color ? '' : ' color-swatch-none');
    if (color) b.style.background = color;
    b.dataset.color = color;
    b.title = color || '색상 없음';
    if ((selected || '') === color) b.classList.add('selected');
    b.addEventListener('click', () => {
      els.jobColorInput.value = color;
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      b.classList.add('selected');
    });
    return b;
  };
  wrap.appendChild(mkSwatch(''));
  JOB_COLORS.forEach(c => wrap.appendChild(mkSwatch(c)));
}

function openJobModal(jobNo) {
  const editing = !!jobNo;
  const job = editing ? findJob(jobNo) : null;
  if (editing && !job) return;
  els.modalJobTitle.textContent = editing ? 'JOB 수정' : 'JOB 추가';
  els.jobNoInput.value = editing ? job.jobNo : '';
  els.jobNoInput.readOnly = editing;
  els.jobTitleInput.value = editing ? job.title : '';
  buildJobColorPicker(editing ? (job.color || '') : '');
  els.modalJob.classList.remove('hidden');
  setTimeout(() => (editing ? els.jobTitleInput : els.jobNoInput).focus(), 50);
}
function closeJobModal() { els.modalJob.classList.add('hidden'); }

async function submitJobForm(e) {
  e.preventDefault();
  const jobNo = els.jobNoInput.value.trim();
  const title = els.jobTitleInput.value.trim();
  const color = sanitizeColor(els.jobColorInput.value);
  if (!jobNo || !title) return;
  const editing = els.jobNoInput.readOnly;
  if (editing) {
    const job = findJob(jobNo);
    if (!job) return;
    job.title = title;
    job.color = color;
  } else {
    if (findJob(jobNo)) {
      showAlert('이미 존재하는 JOB 번호입니다.');
      return;
    }
    state.data.jobs.push({ jobNo, title, color, tasks: [] });
    state.lastActiveJobNo = jobNo;
  }
  await saveData();
  closeJobModal();
  renderAll();
}

async function deleteJob(jobNo) {
  const job = findJob(jobNo);
  if (!job) return;
  if (!(await showConfirm(`JOB "${jobNo} - ${job.title}" 및 모든 Task를 삭제하시겠습니까?`, 'JOB 삭제'))) return;
  state.data.jobs = state.data.jobs.filter(j => j.jobNo !== jobNo);
  if (state.lastActiveJobNo === jobNo) state.lastActiveJobNo = null;
  await saveData();
  renderAll();
}

// ----- Task actions -----
function populateJobSelect(currentJobNo) {
  const sel = els.taskJobNoSelect;
  sel.innerHTML = '';
  for (const job of state.data.jobs) {
    const opt = document.createElement('option');
    opt.value = job.jobNo;
    opt.textContent = `${job.jobNo} - ${job.title}`;
    if (job.jobNo === currentJobNo) opt.selected = true;
    sel.appendChild(opt);
  }
}

function openTaskModal(jobNo, taskId) {
  if (state.data.jobs.length === 0) {
    showAlert('먼저 JOB을 추가하세요.');
    return;
  }
  populateJobSelect(jobNo);
  state.lastActiveJobNo = jobNo;

  if (taskId) {
    const task = findTask(jobNo, taskId);
    if (!task) return;
    els.modalTaskTitle.textContent = 'Task 수정';
    els.taskIdInput.value = task.id;
    els.taskJobNoInput.value = jobNo;
    els.taskTitleInput.value = task.title || '';
    els.taskLabelInput.value = task.label || '';
    els.taskStatusInput.value = task.status || '대기';
    els.taskPriorityInput.value = task.priority || '보통';
    els.taskStartInput.value = task.startDate || '';
    els.taskStartTimeInput.value = normTime(task.startTime);
    els.taskDueInput.value = task.dueDate || '';
    els.taskEndInput.value = task.endDate || '';
    els.taskEndTimeInput.value = normTime(task.endTime);
    els.taskMemoInput.value = task.memo || '';
    els.btnDeleteTask.classList.remove('hidden');
  } else {
    els.modalTaskTitle.textContent = 'Task 추가';
    els.taskIdInput.value = '';
    els.taskJobNoInput.value = jobNo || '';
    els.taskTitleInput.value = '';
    els.taskLabelInput.value = '';
    els.taskStatusInput.value = '대기';
    els.taskPriorityInput.value = '보통';
    els.taskStartInput.value = '';
    els.taskStartTimeInput.value = '';
    els.taskDueInput.value = '';
    els.taskEndInput.value = '';
    els.taskEndTimeInput.value = '';
    els.taskMemoInput.value = '';
    els.btnDeleteTask.classList.add('hidden');
  }

  els.modalTask.classList.remove('hidden');
  setTimeout(() => els.taskTitleInput.focus(), 50);
}
function closeTaskModal() {
  if (typeof Datepicker !== 'undefined') Datepicker.close();
  if (typeof LabelPicker !== 'undefined') LabelPicker.close();
  els.modalTask.classList.add('hidden');
}

async function submitTaskForm(e) {
  e.preventDefault();
  const id = els.taskIdInput.value || uid();
  const isNew = !els.taskIdInput.value;
  const originalJobNo = els.taskJobNoInput.value;
  const targetJobNo = els.taskJobNoSelect.value || originalJobNo;
  const targetJob = findJob(targetJobNo);
  if (!targetJob) return;
  if (!Array.isArray(targetJob.tasks)) targetJob.tasks = [];

  const now = nowIso();
  let newStatus = els.taskStatusInput.value;
  let endDate = els.taskEndInput.value || '';
  let endTime = normTime(els.taskEndTimeInput.value);

  // If status was changed to 완료 in the modal and end date/time is empty, apply behavior
  const prevTask = !isNew ? findTask(originalJobNo, id) : null;
  // Reverting out of 완료 clears the completion time so re-completing asks again
  if (prevTask && prevTask.status === '완료' && newStatus !== '완료') {
    endDate = '';
    endTime = '';
  }
  const becomingComplete = newStatus === '완료' && (!prevTask || prevTask.status !== '완료');
  if (becomingComplete && !endDate && !endTime) {
    const decision = await resolveCompleteEndTime();
    if (decision === 'auto') {
      endDate = nowDateStr();
      endTime = nowTimeStr();
    }
  }

  const taskData = {
    id,
    title: els.taskTitleInput.value.trim(),
    label: (els.taskLabelInput.value || '').trim().slice(0, 10),
    status: newStatus,
    priority: els.taskPriorityInput.value,
    startDate: els.taskStartInput.value || '',
    startTime: normTime(els.taskStartTimeInput.value),
    dueDate: els.taskDueInput.value || '',
    endDate,
    endTime,
    memo: els.taskMemoInput.value || '',
    updatedAt: now
  };
  if (!taskData.title) return;

  if (isNew) {
    taskData.createdAt = now;
    targetJob.tasks.push(taskData);
  } else {
    // If JOB changed, remove from original and add to target
    if (originalJobNo && originalJobNo !== targetJobNo) {
      const origJob = findJob(originalJobNo);
      if (origJob && Array.isArray(origJob.tasks)) {
        const orig = origJob.tasks.find(t => t.id === id);
        if (orig) taskData.createdAt = orig.createdAt || now;
        origJob.tasks = origJob.tasks.filter(t => t.id !== id);
      }
      targetJob.tasks.push(taskData);
    } else {
      const idx = targetJob.tasks.findIndex(t => t.id === id);
      if (idx >= 0) {
        taskData.createdAt = targetJob.tasks[idx].createdAt || now;
        targetJob.tasks[idx] = taskData;
      } else {
        taskData.createdAt = now;
        targetJob.tasks.push(taskData);
      }
    }
  }

  state.lastActiveJobNo = targetJobNo;
  await saveData();
  closeTaskModal();
  renderAll();
}

async function deleteTask(jobNo, id) {
  const task = findTask(jobNo, id);
  if (!task) return false;
  if (!(await showConfirm(`Task "${task.title}"를 삭제하시겠습니까?`, 'Task 삭제'))) return false;
  const job = findJob(jobNo);
  if (job && Array.isArray(job.tasks)) {
    job.tasks = job.tasks.filter(t => t.id !== id);
  }
  await saveData();
  renderAll();
  return true;
}

async function deleteTaskFromModal() {
  const id = els.taskIdInput.value;
  const jobNo = els.taskJobNoInput.value;
  if (!id || !jobNo) return;
  if (await deleteTask(jobNo, id)) closeTaskModal();
}

async function changeTaskPriority(jobNo, taskId, newPriority) {
  if (!PRIORITIES.includes(newPriority)) return;
  const task = findTask(jobNo, taskId);
  if (!task || task.priority === newPriority) return;
  task.priority = newPriority;
  task.updatedAt = nowIso();
  state.lastActiveJobNo = jobNo;
  await saveData();
  renderAll();
}

async function changeTaskStatus(jobNo, taskId, newStatus) {
  const task = findTask(jobNo, taskId);
  if (!task || task.status === newStatus) return;
  const wasComplete = task.status === '완료';
  task.status = newStatus;
  task.updatedAt = nowIso();

  // Reverting out of 완료 clears the completion time so re-completing asks again
  if (wasComplete && newStatus !== '완료') {
    task.endDate = '';
    task.endTime = '';
  }

  if (newStatus === '완료' && !wasComplete && !task.endDate && !task.endTime) {
    const decision = await resolveCompleteEndTime();
    if (decision === 'auto') {
      task.endDate = nowDateStr();
      task.endTime = nowTimeStr();
    }
  }

  state.lastActiveJobNo = jobNo;
  await saveData();
  renderAll();
}

// ----- Complete confirm modal -----
// Returns 'auto' or 'manual'
async function resolveCompleteEndTime() {
  // Settings shortcut
  if (settings.completeBehavior === 'auto') return 'auto';
  if (settings.completeBehavior === 'manual') return 'manual';

  // 'ask' → show modal
  return new Promise(resolve => {
    const modal = els.modalCompleteConfirm;
    const remember = els.completeConfirmRemember;
    const yesBtn = els.completeConfirmYes;
    const noBtn = els.completeConfirmNo;
    remember.checked = false;
    modal.classList.remove('hidden');

    const cleanup = async (decision) => {
      modal.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      if (remember.checked) {
        settings.completeBehavior = decision;
        await persistSettings();
      }
      resolve(decision);
    };
    const onYes = () => cleanup('auto');
    const onNo = () => cleanup('manual');
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    setTimeout(() => yesBtn.focus(), 50);
  });
}

// ----- Settings modal -----
function openSettingsModal() {
  els.settingsZoom.value = String(settings.zoomLevel);
  els.settingsCompleteBehavior.value = settings.completeBehavior;
  els.settingsNotifyEnabled.checked = !!settings.notificationEnabled;
  els.settingsNotifyMinutes.value = String(settings.notificationMinutesBefore);
  if (els.settingsAutoStart) els.settingsAutoStart.checked = settings.autoStart === true;
  els.modalSettings.classList.remove('hidden');
}
function closeSettingsModal() { els.modalSettings.classList.add('hidden'); }

async function submitSettingsForm(e) {
  e.preventDefault();
  const zoom = parseInt(els.settingsZoom.value, 10);
  const behavior = els.settingsCompleteBehavior.value;
  const notifyEnabled = els.settingsNotifyEnabled.checked;
  const minutesRaw = parseInt(els.settingsNotifyMinutes.value, 10);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw >= 0 ? minutesRaw : 0;
  const autoStart = els.settingsAutoStart ? els.settingsAutoStart.checked : (settings.autoStart === true);

  settings.zoomLevel = [1, 2, 3].includes(zoom) ? zoom : 1;
  settings.completeBehavior = ['ask', 'auto', 'manual'].includes(behavior) ? behavior : 'ask';
  settings.notificationEnabled = notifyEnabled;
  settings.notificationMinutesBefore = minutes;

  // Push the auto-start change to the OS only if it actually changed
  if (autoStart !== (settings.autoStart === true)) {
    settings.autoStart = autoStart;
    if (window.autoStartAPI) {
      try { await window.autoStartAPI.set(autoStart); } catch (err) { console.error(err); }
    }
  }

  applyZoomImmediate(settings.zoomLevel);
  await persistSettings();
  closeSettingsModal();
  // Re-evaluate notifications immediately
  scanForDueNotifications();
}

// ----- Notifications -----
function scanForDueNotifications() {
  if (!settings.notificationEnabled) return;
  const now = new Date();
  const leadMs = (settings.notificationMinutesBefore || 0) * 60 * 1000;

  for (const job of state.data.jobs) {
    if (!Array.isArray(job.tasks)) continue;
    for (const task of job.tasks) {
      if (task.status === '완료') continue;
      // Require both startDate AND startTime; skip if either is missing
      if (!task.startDate || !task.startTime) continue;
      const dt = combineDateTime(task.startDate, task.startTime);
      if (!dt) continue;
      const triggerAt = dt.getTime() - leadMs;
      const key = task.id + '|' + dt.getTime() + '|' + leadMs;
      if (notifiedTaskIds.has(key)) continue;
      // Window: trigger fires once between [triggerAt, dt + 60s]
      if (now.getTime() >= triggerAt && now.getTime() <= dt.getTime() + 60000) {
        notifiedTaskIds.add(key);
        const minsAhead = Math.max(0, Math.round((dt.getTime() - now.getTime()) / 60000));
        const title = `[${job.jobNo}] ${task.title}`;
        const body = minsAhead > 0
          ? `시작까지 약 ${minsAhead}분 남았습니다 (${task.startDate} ${task.startTime})`
          : `작업 시작 시간입니다 (${task.startDate} ${task.startTime})`;
        if (window.notifyAPI && typeof window.notifyAPI.show === 'function') {
          // Notifications are best-effort — never alert the user if delivery fails.
          Promise.resolve(window.notifyAPI.show(title, body))
            .catch(err => console.error('notify error', err));
        }
      }
    }
  }
}

function startNotificationScheduler() {
  if (notifyIntervalId) clearInterval(notifyIntervalId);
  notifyIntervalId = setInterval(scanForDueNotifications, 30000);
  // Run once shortly after init
  setTimeout(scanForDueNotifications, 1500);
}

// ----- Onboarding Tour -----
const Tour = (() => {
  const steps = [
    {
      targetSelector: '#btn-add-job',
      title: 'JOB 추가',
      body: '프로젝트 단위로 JOB을 먼저 만드세요. 단축키: <strong>Ctrl+Q</strong>'
    },
    {
      targetSelector: '#btn-add-task-toolbar',
      title: 'Task 추가',
      body: '선택된 JOB에 할 일을 추가합니다. 단축키: <strong>Ctrl+E</strong>'
    },
    {
      targetSelector: '.form-row-label-title',
      modalStep: true,
      title: '라벨 & 제목',
      body: '제목 앞에 <strong>라벨</strong>을 붙이면 카드와 캘린더에 <strong>[라벨] 제목</strong> 형태로 표시됩니다. 최대 10자이며, <strong>▾</strong> 버튼으로 기존 라벨을 골라 넣거나 항목별 <strong>×</strong>로 삭제할 수 있습니다.'
    },
    {
      targetSelector: '__task_status_row__',
      modalStep: true,
      title: '우선순위 & 상태',
      body: '우선순위와 상태(대기/진행/완료)를 지정합니다. 보드 뷰의 칸 위치와 카드 색상이 이 값에 따라 바뀝니다.'
    },
    {
      targetSelector: '__task_date_rows__',
      modalStep: true,
      title: '일정 입력',
      body: '시작일·마감일·종료일과 시간을 넣으면 캘린더에 일정 bar로 표시됩니다. 시간까지 지정하면 주간 캘린더의 해당 시간대에 배치됩니다.'
    },
    {
      targetSelector: '.view-toggle',
      title: '보드 / 캘린더 / 목록',
      body: '보드는 JOB별 칸반, 캘린더는 월/주 일정표, 목록은 전체 Task 테이블입니다. 단축키: <strong>1</strong>=보드, <strong>2</strong>=캘린더, <strong>3</strong>=목록 (또는 <strong>Ctrl+Tab</strong>으로 순환)'
    },
    {
      targetSelector: '#view-calendar',
      title: '캘린더 보기',
      body: '월/주 단위로 일정을 한눈에 볼 수 있어요. 일정 bar를 잡고 끌면 날짜·시간이 바뀌고, 양 끝을 잡으면 기간 조절이 가능합니다. 빈 날짜를 더블클릭하면 그 날짜로 Task 추가가 열립니다. 단축키: <strong>A / D</strong> 또는 <strong>← / →</strong>로 이전·다음 이동, <strong>Q</strong>=월, <strong>E</strong>=주.'
    },
    {
      targetSelector: '__filter_group__',
      title: '필터 & 정렬',
      body: '상태·우선순위로 필터링하고 마감일 또는 우선순위 기준으로 정렬할 수 있습니다.'
    },
    {
      targetSelector: '__main_view__',
      title: '확대 / 축소',
      body: '본문 위에서 <strong>Ctrl + 마우스휠</strong>로 글자 크기를 3단계로 조절할 수 있습니다.'
    },
    {
      targetSelector: null,
      title: '준비 완료!',
      body: 'JOB을 만들고 Task를 추가해 보세요. 카드 클릭 시 수정 모달이 열리고, 카드 하단 버튼으로 상태(대기/진행/완료)를 바꿀 수 있습니다.'
    }
  ];

  let currentIdx = 0;
  let active = false;
  let overlayEl = null;
  let spotlightEl = null;
  let tooltipEl = null;
  let resizeHandler = null;
  let keyHandler = null;

  function getTargetRect(selector) {
    if (!selector) return null;
    if (selector === '__filter_group__') {
      const first = document.querySelector('#filter-status');
      const last = document.querySelector('#sort-direction');
      if (!first || !last) return null;
      const r1 = first.getBoundingClientRect();
      const r2 = last.getBoundingClientRect();
      const left = Math.min(r1.left, r2.left);
      const top = Math.min(r1.top, r2.top);
      const right = Math.max(r1.right, r2.right);
      const bottom = Math.max(r1.bottom, r2.bottom);
      return { left, top, width: right - left, height: bottom - top, right, bottom };
    }
    if (selector === '__main_view__') {
      const visible = !els.board.classList.contains('hidden') ? els.board : els.listView;
      return visible.getBoundingClientRect();
    }
    if (selector === '__task_status_row__') {
      const sEl = document.querySelector('#task-status-input');
      const row = sEl && sEl.closest('.form-row');
      return row ? row.getBoundingClientRect() : null;
    }
    if (selector === '__task_date_rows__') {
      const sEl = document.querySelector('#task-start-input');
      const eEl = document.querySelector('#task-end-input');
      const r1 = sEl && sEl.closest('.form-row');
      const r2 = eEl && eEl.closest('.form-row');
      if (!r1 || !r2) return null;
      const a = r1.getBoundingClientRect();
      const b = r2.getBoundingClientRect();
      const left = Math.min(a.left, b.left);
      const top = Math.min(a.top, b.top);
      const right = Math.max(a.right, b.right);
      const bottom = Math.max(a.bottom, b.bottom);
      return { left, top, width: right - left, height: bottom - top, right, bottom };
    }
    const el = document.querySelector(selector);
    return el ? el.getBoundingClientRect() : null;
  }

  function openTaskModalForTour() {
    els.modalTaskTitle.textContent = 'Task 추가';
    els.taskIdInput.value = '';
    els.taskJobNoInput.value = '';
    els.taskTitleInput.value = '';
    els.taskLabelInput.value = '';
    els.taskStatusInput.value = '대기';
    els.taskPriorityInput.value = '보통';
    els.taskStartInput.value = '';
    els.taskStartTimeInput.value = '';
    els.taskDueInput.value = '';
    els.taskEndInput.value = '';
    els.taskEndTimeInput.value = '';
    els.taskMemoInput.value = '';
    els.btnDeleteTask.classList.add('hidden');
    populateJobSelect();
    els.modalTask.classList.remove('hidden');
  }

  function syncModalForStep() {
    const step = steps[currentIdx];
    const wantModal = !!(step && step.modalStep);
    const modalOpen = !els.modalTask.classList.contains('hidden');
    if (wantModal && !modalOpen) {
      openTaskModalForTour();
    } else if (!wantModal && modalOpen) {
      els.modalTask.classList.add('hidden');
    }
    document.body.classList.toggle('tour-modal-step', wantModal);
  }

  function buildDOM() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'tour-overlay';

    spotlightEl = document.createElement('div');
    spotlightEl.className = 'tour-spotlight';

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tour-tooltip';
    tooltipEl.innerHTML = `
      <button type="button" class="tour-tooltip-close" aria-label="닫기">×</button>
      <h3 class="tour-title"></h3>
      <p class="tour-body"></p>
      <div class="tour-tooltip-footer">
        <span class="tour-step-indicator"></span>
        <div class="tour-buttons">
          <button type="button" class="tour-btn tour-btn-skip">건너뛰기</button>
          <button type="button" class="tour-btn tour-btn-prev">이전</button>
          <button type="button" class="tour-btn tour-btn-primary tour-btn-next">다음</button>
        </div>
      </div>
    `;

    document.body.appendChild(spotlightEl);
    document.body.appendChild(tooltipEl);

    tooltipEl.querySelector('.tour-tooltip-close').addEventListener('click', skip);
    tooltipEl.querySelector('.tour-btn-skip').addEventListener('click', skip);
    tooltipEl.querySelector('.tour-btn-prev').addEventListener('click', prev);
    tooltipEl.querySelector('.tour-btn-next').addEventListener('click', next);
  }

  function teardownDOM() {
    if (spotlightEl && spotlightEl.parentNode) spotlightEl.parentNode.removeChild(spotlightEl);
    if (tooltipEl && tooltipEl.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
    spotlightEl = null;
    tooltipEl = null;
    overlayEl = null;
  }

  function render() {
    if (!active) return;
    const step = steps[currentIdx];
    const rect = getTargetRect(step.targetSelector);
    const padding = 6;

    if (rect) {
      const top = Math.max(0, rect.top - padding);
      const left = Math.max(0, rect.left - padding);
      const width = rect.width + padding * 2;
      const height = rect.height + padding * 2;
      spotlightEl.style.top = top + 'px';
      spotlightEl.style.left = left + 'px';
      spotlightEl.style.width = width + 'px';
      spotlightEl.style.height = height + 'px';
      spotlightEl.style.display = 'block';
    } else {
      // No target: cover full viewport invisibly so the dim still shows
      spotlightEl.style.top = '50%';
      spotlightEl.style.left = '50%';
      spotlightEl.style.width = '0px';
      spotlightEl.style.height = '0px';
      spotlightEl.style.display = 'block';
    }

    // Update tooltip content
    tooltipEl.querySelector('.tour-title').textContent = step.title;
    tooltipEl.querySelector('.tour-body').innerHTML = step.body;
    tooltipEl.querySelector('.tour-step-indicator').textContent = `${currentIdx + 1} / ${steps.length}`;

    const prevBtn = tooltipEl.querySelector('.tour-btn-prev');
    const nextBtn = tooltipEl.querySelector('.tour-btn-next');
    prevBtn.disabled = currentIdx === 0;
    const isLast = currentIdx === steps.length - 1;
    nextBtn.textContent = isLast ? '시작하기' : '다음';

    // Position tooltip
    positionTooltip(rect);
  }

  function positionTooltip(rect) {
    const tipRect = tooltipEl.getBoundingClientRect();
    const tipW = tipRect.width || 320;
    const tipH = tipRect.height || 160;
    const margin = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top, left;
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      // Center
      top = (vh - tipH) / 2;
      left = (vw - tipW) / 2;
    } else {
      // Try below first
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow >= tipH + margin || spaceBelow >= spaceAbove) {
        top = rect.bottom + margin;
      } else {
        top = rect.top - tipH - margin;
      }
      // Horizontal: align center to target, clamp to viewport
      left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(margin, Math.min(left, vw - tipW - margin));
      top = Math.max(margin, Math.min(top, vh - tipH - margin));
    }

    tooltipEl.style.top = top + 'px';
    tooltipEl.style.left = left + 'px';
  }

  function onResize() { render(); }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    }
  }

  function start() {
    if (active) return;
    active = true;
    currentIdx = 0;
    document.body.classList.add('tour-active');
    buildDOM();
    resizeHandler = onResize;
    keyHandler = onKey;
    window.addEventListener('resize', resizeHandler);
    document.addEventListener('keydown', keyHandler, true);
    syncModalForStep();
    render();
    // Move focus to the Next button so Enter/Space immediately advances
    setTimeout(() => {
      const nextBtn = tooltipEl && tooltipEl.querySelector('.tour-btn-next');
      if (nextBtn) nextBtn.focus();
    }, 0);
  }

  function next() {
    if (!active) return;
    if (currentIdx >= steps.length - 1) {
      end();
      return;
    }
    currentIdx += 1;
    syncModalForStep();
    render();
  }

  function prev() {
    if (!active) return;
    if (currentIdx <= 0) return;
    currentIdx -= 1;
    syncModalForStep();
    render();
  }

  function goTo(idx) {
    if (!active) return;
    if (idx < 0 || idx >= steps.length) return;
    currentIdx = idx;
    syncModalForStep();
    render();
  }

  function skip() {
    end();
  }

  function end() {
    if (!active) return;
    active = false;
    document.body.classList.remove('tour-active');
    document.body.classList.remove('tour-modal-step');
    els.modalTask.classList.add('hidden');
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    resizeHandler = null;
    keyHandler = null;
    teardownDOM();
    try { localStorage.setItem(TOUR_COMPLETED_KEY, '1'); } catch (err) { console.warn('tour completion persist skipped:', err); }
  }

  function restart() {
    try { localStorage.removeItem(TOUR_COMPLETED_KEY); } catch (err) { console.warn('tour reset skipped:', err); }
    if (active) end();
    start();
  }

  return { start, next, prev, skip, end, goTo, restart };
})();

// ----- Priority Picker (popup for card badge) -----
const PriorityPicker = (() => {
  let popupEl = null;
  let outsideHandler = null;
  let keyHandler = null;
  let scrollHandler = null;
  let anchorEl = null;

  function position() {
    if (!popupEl || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const pr = popupEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 6;
    let top = r.bottom + 4;
    let left = r.left;
    if (top + pr.height > vh - margin) {
      const above = r.top - pr.height - 4;
      if (above >= margin) top = above;
    }
    if (left + pr.width > vw - margin) {
      left = Math.max(margin, vw - pr.width - margin);
    }
    popupEl.style.top = top + 'px';
    popupEl.style.left = left + 'px';
  }

  function close() {
    if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    popupEl = null;
    anchorEl = null;
    if (outsideHandler) document.removeEventListener('mousedown', outsideHandler, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    if (scrollHandler) {
      window.removeEventListener('resize', scrollHandler);
      window.removeEventListener('scroll', scrollHandler, true);
    }
    outsideHandler = null;
    keyHandler = null;
    scrollHandler = null;
  }

  function open(anchor, current, onPick) {
    close();
    anchorEl = anchor;
    popupEl = document.createElement('div');
    popupEl.className = 'priority-popup';
    popupEl.innerHTML = PRIORITIES.map(p => `
      <button type="button" class="priority-popup-item badge badge-priority-${p}${p === current ? ' active' : ''}" data-p="${p}">${p}</button>
    `).join('');
    popupEl.addEventListener('mousedown', (e) => e.preventDefault());
    popupEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-p]');
      if (!btn) return;
      const next = btn.getAttribute('data-p');
      close();
      if (typeof onPick === 'function') onPick(next);
    });
    document.body.appendChild(popupEl);

    popupEl.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      position();
      popupEl.style.visibility = '';
    });

    outsideHandler = (e) => {
      if (!popupEl) return;
      if (popupEl.contains(e.target)) return;
      if (anchorEl && anchorEl.contains(e.target)) return;
      close();
    };
    keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    scrollHandler = () => position();
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('resize', scrollHandler);
    window.addEventListener('scroll', scrollHandler, true);
  }

  return { open, close };
})();

// ----- Label Picker (dropdown of existing labels for Task modal) -----
const LabelPicker = (() => {
  let popup = null;
  let activeInput = null;
  let outsideHandler = null;
  let keyHandler = null;

  function gatherLabels() {
    const set = new Set();
    for (const job of state.data.jobs) {
      if (!Array.isArray(job.tasks)) continue;
      for (const t of job.tasks) {
        const v = t && t.label ? String(t.label).trim() : '';
        if (v) set.add(v);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }

  function position(anchor) {
    if (!popup || !anchor) return;
    const r = anchor.getBoundingClientRect();
    popup.style.minWidth = r.width + 'px';
    popup.style.left = r.left + 'px';
    popup.style.top = (r.bottom + 4) + 'px';
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popup.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
    }
    if (pr.bottom > window.innerHeight - 8) {
      popup.style.top = (r.top - pr.height - 4) + 'px';
    }
  }

  function open(anchor, inputEl) {
    close();
    activeInput = inputEl;
    const labels = gatherLabels();
    const cur = (inputEl.value || '').trim();
    popup = document.createElement('div');
    popup.className = 'label-popup';
    if (labels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'label-popup-empty';
      empty.textContent = '저장된 라벨이 없습니다. 직접 입력하세요.';
      popup.appendChild(empty);
    } else {
      labels.forEach(l => {
        const item = document.createElement('div');
        item.className = 'label-popup-item' + (l === cur ? ' active' : '');

        const text = document.createElement('button');
        text.type = 'button';
        text.className = 'label-popup-item-text';
        text.textContent = l;
        text.addEventListener('mousedown', (e) => e.preventDefault());
        text.addEventListener('click', () => {
          const inp = activeInput;
          if (!inp) return;
          inp.value = l;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          close();
          inp.focus();
        });
        item.appendChild(text);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'label-popup-item-del';
        del.textContent = '×';
        del.title = `'${l}' 라벨 삭제 (모든 task에서 제거)`;
        del.addEventListener('mousedown', (e) => e.preventDefault());
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          const inp = activeInput;
          const ok = await showConfirm(`라벨 "${l}"을(를) 모든 task에서 제거하시겠습니까?`, '라벨 삭제');
          if (!ok) {
            if (inp && document.body.contains(inp)) open(inp, inp);
            return;
          }
          for (const job of state.data.jobs) {
            if (!Array.isArray(job.tasks)) continue;
            for (const t of job.tasks) {
              if (t.label && String(t.label).trim() === l) {
                t.label = '';
                t.updatedAt = nowIso();
              }
            }
          }
          if (inp && (inp.value || '').trim() === l) inp.value = '';
          await saveData();
          renderAll();
          if (inp && document.body.contains(inp)) open(inp, inp);
        });
        item.appendChild(del);

        popup.appendChild(item);
      });
    }
    document.body.appendChild(popup);
    popup.style.visibility = 'hidden';
    requestAnimationFrame(() => { position(anchor); popup.style.visibility = ''; });

    outsideHandler = (e) => {
      if (!popup) return;
      if (popup.contains(e.target)) return;
      if (e.target === anchor || e.target === activeInput) return;
      close();
    };
    keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler, true);
  }

  function close() {
    if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
    popup = null;
    activeInput = null;
    if (outsideHandler) document.removeEventListener('mousedown', outsideHandler, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    outsideHandler = null;
    keyHandler = null;
  }

  function isOpen() { return !!popup; }
  return { open, close, isOpen };
})();

// ----- Status Filter (checkbox dropdown) -----
const StatusFilter = (() => {
  let outsideHandler = null;
  let keyHandler = null;

  function updateLabel() {
    const sel = Array.from(state.filterStatuses);
    if (sel.length === STATUSES.length) {
      els.filterStatusLabel.textContent = '상태 전체';
    } else if (sel.length === 0) {
      els.filterStatusLabel.textContent = '상태 (없음)';
    } else {
      // Preserve canonical order
      const ordered = STATUSES.filter(s => state.filterStatuses.has(s));
      els.filterStatusLabel.textContent = '상태: ' + ordered.join(', ');
    }
  }

  function syncCheckboxes() {
    els.filterStatusMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = state.filterStatuses.has(cb.value);
    });
  }

  function onChange() {
    state.filterStatuses = new Set(
      Array.from(els.filterStatusMenu.querySelectorAll('input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => cb.value)
    );
    updateLabel();
    saveUiState();
    renderAll();
  }

  function open() {
    if (!els.filterStatusMenu.classList.contains('hidden')) return;
    els.filterStatusMenu.classList.remove('hidden');
    els.filterStatusBtn.setAttribute('aria-expanded', 'true');
    els.filterStatusBtn.classList.add('open');
    outsideHandler = (e) => {
      if (els.filterStatusMenu.contains(e.target)) return;
      if (els.filterStatusBtn.contains(e.target)) return;
      close();
    };
    keyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler, true);
  }

  function close() {
    if (els.filterStatusMenu.classList.contains('hidden')) return;
    els.filterStatusMenu.classList.add('hidden');
    els.filterStatusBtn.setAttribute('aria-expanded', 'false');
    els.filterStatusBtn.classList.remove('open');
    if (outsideHandler) document.removeEventListener('mousedown', outsideHandler, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    outsideHandler = null;
    keyHandler = null;
  }

  function init() {
    syncCheckboxes();
    updateLabel();
    els.filterStatusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (els.filterStatusMenu.classList.contains('hidden')) open();
      else close();
    });
    els.filterStatusMenu.addEventListener('change', (e) => {
      if (e.target && e.target.matches('input[type="checkbox"]')) onChange();
    });
    els.filterStatusMenu.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        if (act === 'all') state.filterStatuses = new Set(STATUSES);
        else if (act === 'none') state.filterStatuses = new Set();
        syncCheckboxes();
        updateLabel();
        saveUiState();
        renderAll();
      });
    });
  }

  return { init, close };
})();

// ----- Datepicker -----
const Datepicker = (() => {
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let popupEl = null;
  let currentInput = null;
  let viewYear = 0;
  let viewMonth = 0; // 0-11
  let outsideHandler = null;
  let keyHandler = null;
  let scrollHandler = null;

  function parseValue(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    return { y, m: m - 1, d };
  }

  function fmt(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function sameDay(a, b) {
    return a && b && a.y === b.y && a.m === b.m && a.d === b.d;
  }

  function buildPopup() {
    const root = document.createElement('div');
    root.className = 'datepicker-popup';
    root.innerHTML = `
      <div class="dp-header">
        <button type="button" class="dp-nav" data-act="prev-year" title="이전 년">«</button>
        <button type="button" class="dp-nav" data-act="prev-month" title="이전 달">‹</button>
        <div class="dp-title">
          <span class="dp-title-year"></span>년
          <span class="dp-title-month"></span>월
        </div>
        <button type="button" class="dp-nav" data-act="next-month" title="다음 달">›</button>
        <button type="button" class="dp-nav" data-act="next-year" title="다음 년">»</button>
      </div>
      <div class="dp-weekdays">
        ${WEEKDAYS.map((w, i) => `<span class="dp-weekday${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</span>`).join('')}
      </div>
      <div class="dp-grid"></div>
      <div class="dp-footer">
        <button type="button" class="dp-foot-btn" data-act="today">오늘</button>
        <button type="button" class="dp-foot-btn" data-act="clear">지우기</button>
        <button type="button" class="dp-foot-btn dp-close" data-act="close">닫기</button>
      </div>
    `;
    root.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus
    root.addEventListener('click', onPopupClick);
    document.body.appendChild(root);
    return root;
  }

  function onPopupClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'prev-month') { stepMonth(-1); return; }
    if (act === 'next-month') { stepMonth(1); return; }
    if (act === 'prev-year') { stepYear(-1); return; }
    if (act === 'next-year') { stepYear(1); return; }
    if (act === 'today') {
      const t = new Date();
      pick(t.getFullYear(), t.getMonth(), t.getDate());
      return;
    }
    if (act === 'clear') {
      if (currentInput) {
        currentInput.value = '';
        currentInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
      return;
    }
    if (act === 'close') { close(); return; }
    if (act === 'pick') {
      const y = parseInt(btn.dataset.y, 10);
      const m = parseInt(btn.dataset.m, 10);
      const d = parseInt(btn.dataset.d, 10);
      pick(y, m, d);
    }
  }

  function pick(y, m, d) {
    if (!currentInput) return;
    currentInput.value = fmt(y, m, d);
    currentInput.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  function stepMonth(delta) {
    viewMonth += delta;
    while (viewMonth < 0) { viewMonth += 12; viewYear -= 1; }
    while (viewMonth > 11) { viewMonth -= 12; viewYear += 1; }
    renderGrid();
  }

  function stepYear(delta) {
    viewYear += delta;
    renderGrid();
  }

  function renderGrid() {
    if (!popupEl) return;
    popupEl.querySelector('.dp-title-year').textContent = String(viewYear);
    popupEl.querySelector('.dp-title-month').textContent = String(viewMonth + 1);

    const grid = popupEl.querySelector('.dp-grid');
    grid.innerHTML = '';

    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

    const today = new Date();
    const todayInfo = { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
    const selected = currentInput ? parseValue(currentInput.value) : null;

    const cells = [];
    // Leading days from prev month
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      const pm = viewMonth === 0 ? 11 : viewMonth - 1;
      const py = viewMonth === 0 ? viewYear - 1 : viewYear;
      cells.push({ y: py, m: pm, d, outside: true });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ y: viewYear, m: viewMonth, d, outside: false });
    }
    // Trailing to fill 6 rows = 42 cells
    let next = 1;
    while (cells.length < 42) {
      const nm = viewMonth === 11 ? 0 : viewMonth + 1;
      const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
      cells.push({ y: ny, m: nm, d: next++, outside: true });
    }

    const frag = document.createDocumentFragment();
    cells.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dp-day';
      btn.dataset.act = 'pick';
      btn.dataset.y = c.y;
      btn.dataset.m = c.m;
      btn.dataset.d = c.d;
      btn.textContent = String(c.d);
      const weekday = idx % 7;
      if (weekday === 0) btn.classList.add('sun');
      if (weekday === 6) btn.classList.add('sat');
      if (c.outside) btn.classList.add('outside');
      if (sameDay(c, todayInfo)) btn.classList.add('today');
      if (sameDay(c, selected)) btn.classList.add('selected');
      frag.appendChild(btn);
    });
    grid.appendChild(frag);
  }

  function position() {
    if (!popupEl || !currentInput) return;
    const rect = currentInput.getBoundingClientRect();
    const popRect = popupEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 6;

    let top = rect.bottom + margin;
    let left = rect.left;
    if (top + popRect.height > vh - margin) {
      const above = rect.top - popRect.height - margin;
      if (above >= margin) top = above;
      else top = Math.max(margin, vh - popRect.height - margin);
    }
    if (left + popRect.width > vw - margin) {
      left = Math.max(margin, vw - popRect.width - margin);
    }
    popupEl.style.top = top + 'px';
    popupEl.style.left = left + 'px';
  }

  function open(input) {
    if (popupEl && currentInput === input) return;
    close();
    currentInput = input;

    const parsed = parseValue(input.value);
    const init = parsed || (() => {
      const t = new Date();
      return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
    })();
    viewYear = init.y;
    viewMonth = init.m;

    popupEl = buildPopup();
    renderGrid();
    // First position with measured size
    popupEl.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      position();
      popupEl.style.visibility = '';
    });

    outsideHandler = (e) => {
      if (!popupEl) return;
      if (popupEl.contains(e.target)) return;
      if (e.target === currentInput) return;
      close();
    };
    keyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    scrollHandler = () => position();
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('resize', scrollHandler);
    // Reposition if modal content scrolls
    document.querySelectorAll('.modal-content').forEach(el => el.addEventListener('scroll', scrollHandler, true));
  }

  function close() {
    if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    popupEl = null;
    currentInput = null;
    if (outsideHandler) document.removeEventListener('mousedown', outsideHandler, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    if (scrollHandler) {
      window.removeEventListener('resize', scrollHandler);
      document.querySelectorAll('.modal-content').forEach(el => el.removeEventListener('scroll', scrollHandler, true));
    }
    outsideHandler = null;
    keyHandler = null;
    scrollHandler = null;
  }

  function attach(input) {
    if (!input || input.dataset.dpAttached === '1') return;
    input.dataset.dpAttached = '1';
    input.addEventListener('click', () => open(input));
    input.addEventListener('focus', () => open(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(input);
      }
    });
  }

  function attachAll() {
    document.querySelectorAll('.datepicker-input').forEach(attach);
  }

  return { attach, attachAll, close };
})();

// ----- Event bindings -----
function bindEvents() {
  els.btnAddJob.addEventListener('click', () => openJobModal());

  els.formJob.addEventListener('submit', submitJobForm);
  els.formTask.addEventListener('submit', submitTaskForm);
  els.btnDeleteTask.addEventListener('click', deleteTaskFromModal);

  // Label picker toggle
  if (els.taskLabelToggle && els.taskLabelInput) {
    els.taskLabelToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (LabelPicker.isOpen()) LabelPicker.close();
      else LabelPicker.open(els.taskLabelInput, els.taskLabelInput);
    });
  }

  // Modal close handlers
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => {
      Datepicker.close();
      els.modalJob.classList.add('hidden');
      els.modalTask.classList.add('hidden');
    });
  });

  // Filters and sort
  StatusFilter.init();
  els.filterPriority.addEventListener('change', () => {
    state.filterPriority = els.filterPriority.value;
    saveUiState();
    renderAll();
  });
  els.sortBy.addEventListener('change', () => {
    state.sortBy = els.sortBy.value;
    saveUiState();
    renderAll();
  });
  els.sortDirection.addEventListener('click', () => {
    state.sortAsc = !state.sortAsc;
    els.sortDirection.textContent = state.sortAsc ? '↑' : '↓';
    saveUiState();
    renderAll();
  });

  // View mode toggle
  els.viewBoardBtn.addEventListener('click', () => setViewMode('board'));
  els.viewListBtn.addEventListener('click', () => setViewMode('list'));
  if (els.viewCalendarBtn) els.viewCalendarBtn.addEventListener('click', () => setViewMode('calendar'));

  // Calendar controls
  if (els.calPrev) els.calPrev.addEventListener('click', () => calendarNavigate(-1));
  if (els.calNext) els.calNext.addEventListener('click', () => calendarNavigate(1));
  if (els.calToday) els.calToday.addEventListener('click', calendarGoToday);
  if (els.calModeMonth) els.calModeMonth.addEventListener('click', () => setCalendarMode('month'));
  if (els.calModeWeek) els.calModeWeek.addEventListener('click', () => setCalendarMode('week'));

  // Toolbar Add Task
  els.btnAddTaskToolbar.addEventListener('click', () => triggerAddTask());

  // Help / Tour replay
  if (els.btnHelp) {
    els.btnHelp.addEventListener('click', () => Tour.restart());
  }

  // Settings
  if (els.btnSettings) {
    els.btnSettings.addEventListener('click', openSettingsModal);
  }
  if (els.formSettings) {
    els.formSettings.addEventListener('submit', submitSettingsForm);
  }
  document.querySelectorAll('[data-settings-close]').forEach(el => {
    el.addEventListener('click', closeSettingsModal);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      openJobModal();
      return;
    }
    if (isCtrl && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      triggerAddTask();
      return;
    }
    if (isCtrl && e.key === 'Tab') {
      e.preventDefault();
      const order = ['board', 'calendar', 'list'];
      const idx = order.indexOf(state.viewMode);
      setViewMode(order[(idx + 1) % order.length]);
      return;
    }
    if (e.key === 'Escape') {
      Datepicker.close();
      els.modalJob.classList.add('hidden');
      els.modalTask.classList.add('hidden');
      els.modalSettings.classList.add('hidden');
    }

    // View mode quick switch (1/2/3) — any mode, when not editing/modal
    if (!isCtrl) {
      const ae = document.activeElement;
      const inEditing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
      const anyModalOpen = !!document.querySelector('.modal:not(.hidden)');
      if (!inEditing && !anyModalOpen) {
        if (e.key === '1') { e.preventDefault(); setViewMode('board'); return; }
        if (e.key === '2') { e.preventDefault(); setViewMode('calendar'); return; }
        if (e.key === '3') { e.preventDefault(); setViewMode('list'); return; }
      }
    }

    // Calendar navigation (A/D or Left/Right) when in calendar mode and not editing
    if (state.viewMode === 'calendar' && !isCtrl) {
      const ae = document.activeElement;
      const inEditing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
      const anyModalOpen = !!document.querySelector('.modal:not(.hidden)');
      if (!inEditing && !anyModalOpen) {
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
          e.preventDefault();
          calendarNavigate(-1);
          return;
        }
        if (k === 'ArrowRight' || k === 'd' || k === 'D') {
          e.preventDefault();
          calendarNavigate(1);
          return;
        }
        if (k === 'q' || k === 'Q') {
          e.preventDefault();
          setCalendarMode('month');
          return;
        }
        if (k === 'e' || k === 'E') {
          e.preventDefault();
          setCalendarMode('week');
          return;
        }
      }
    }
  });
}

function triggerAddTask() {
  if (state.data.jobs.length === 0) {
    showAlert('먼저 JOB을 추가하세요.');
    return;
  }
  const targetJobNo = state.lastActiveJobNo && findJob(state.lastActiveJobNo)
    ? state.lastActiveJobNo
    : state.data.jobs[0].jobNo;
  openTaskModal(targetJobNo, null);
}

// ----- Init -----
// ----- Custom alert/confirm -----

// Run an async operation invoked from a synchronous click handler. Surfaces
// any rejection (disk write fail, AV lock, ENOSPC, IPC error) to the user
// instead of silently swallowing it — otherwise the UI flips but the change
// is lost on next launch.
function fireAndForget(promise, errorPrefix) {
  Promise.resolve(promise).catch(err => {
    console.error(errorPrefix || 'Operation failed:', err);
    const msg = (err && err.message) ? err.message : String(err);
    showAlert((errorPrefix || '작업 실패') + ': ' + msg, '오류');
  });
}

function showAlert(message, title) {
  const modal = document.getElementById('modal-alert');
  document.getElementById('alert-title').textContent = title || '알림';
  document.getElementById('alert-message').textContent = message;
  modal.classList.remove('hidden');
  return new Promise(resolve => {
    const okBtn = document.getElementById('alert-ok');
    const backdrop = modal.querySelector('[data-alert-close]');
    const close = () => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', close);
      backdrop.removeEventListener('click', close);
      resolve();
    };
    okBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    okBtn.focus();
  });
}

function showConfirm(message, title) {
  const modal = document.getElementById('modal-confirm');
  document.getElementById('confirm-title').textContent = title || '확인';
  document.getElementById('confirm-message').textContent = message;
  modal.classList.remove('hidden');
  return new Promise(resolve => {
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    const cleanup = (val) => {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    cancelBtn.focus();
  });
}

function bindTitlebar() {
  const min = document.getElementById('win-min');
  const max = document.getElementById('win-max');
  const close = document.getElementById('win-close');
  if (min) min.addEventListener('click', () => window.windowAPI && window.windowAPI.minimize());
  if (max) max.addEventListener('click', () => window.windowAPI && window.windowAPI.toggleMaximize());
  if (close) close.addEventListener('click', () => window.windowAPI && window.windowAPI.close());
}

async function init() {
  bindTitlebar();
  // Load persisted UI state (filter/sort/view) before binding so StatusFilter.init() syncs values
  loadUiState();
  bindEvents();
  // Apply loaded values to non-checkbox controls
  applyUiStateToControls();
  Datepicker.attachAll();
  attachZoomHandler();
  // Load settings (file-based JSON via main process)
  await loadSettings();
  // Apply zoom from settings (no toast)
  applyZoomImmediate(settings.zoomLevel);
  await loadData();
  if (state.data.jobs.length > 0) {
    state.lastActiveJobNo = state.data.jobs[0].jobNo;
  }
  // Apply persisted calendar mode (button state) before view mode triggers render
  setCalendarMode(loadCalendarMode());
  // Apply persisted view mode (also triggers initial render)
  setViewMode(loadViewMode());

  // Start notification scheduler
  startNotificationScheduler();

  // First-run auto-start prompt (or OS sync on later runs). Awaited so the
  // onboarding tour timer below doesn't fire while this modal is still open.
  await initAutoStart();

  // First-run onboarding tour. The catch only guards the localStorage read —
  // don't let it swallow downstream errors from Tour.start().
  let tourCompleted = '1';
  try { tourCompleted = localStorage.getItem(TOUR_COMPLETED_KEY); }
  catch (err) { console.warn('tour flag read skipped:', err); }
  if (tourCompleted !== '1') {
    setTimeout(() => Tour.start(), 250);
  }
}

init();
