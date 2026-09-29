// main.js — 唯一状态、播放契约、相机模式、北京锁定与 DOM 更新
//
// 状态核心：state.ms（UTC 毫秒瞬时）。模式/速度/锁定/轨道为交互状态。
// 任何时刻只有一个播放任务；真实帧间 delta × 速度驱动，UI 显示北京时间。

import './style.css';
import {
  parseDateStr, beijingToUtcMs, utcMsToBeijing,
  sunEvents, formatMinutes, formatDuration, checkRange
} from './solar.js';
import { moonPhase, moonAltitude, phaseName, SYNODIC_MONTH } from './moon.js';
import { moonPhaseSvgPath } from './moonphase-svg.js';
import { createPlayback, stopsOnEnter } from './playback.js';
import { createObservatory } from './scene.js';

// 欢迎页最少展示时长：加载再快也等满 2 秒，保证首页内容可见
const BOOT_MIN_MS = 2000;
const bootStart = performance.now();

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  container: $('scene-container'),
  labelLayer: $('label-layer'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  loadingProgress: $('loading-progress'),
  loadingProgressFill: $('loading-progress-fill'),
  loadingStage: $('loading-stage'),
  loadingPercent: $('loading-percent'),
  webglError: $('webgl-error'),
  viewName: $('view-name'),
  lessonTitle: $('lesson-title'),
  lessonStatus: $('lesson-status'),
  panel: $('panel'),
  panelToggle: $('panel-toggle'),
  panelClose: $('panel-close'),
  panelMain: $('panel-main'),
  panelMoon: $('panel-moon'),
  panelSeason: $('panel-season'),
  dateInput: $('date-input'),
  dateError: $('date-error'),
  timeClock: $('time-clock'),
  timeSlider: $('time-slider'),
  playDayBtn: $('play-day-btn'),
  speedSelect: $('speed-select'),
  dayDurationHint: $('day-duration-hint'),
  sunrise: $('sunrise-time'),
  solarNoon: $('solarnoon-time'),
  sunset: $('sunset-time'),
  daylight: $('daylight-time'),
  focusEarthBtn: $('focus-earth-btn'),
  lockBeijingBtn: $('lock-beijing-btn'),
  zoomInBtn: $('zoom-in-btn'),
  zoomOutBtn: $('zoom-out-btn'),
  resetViewBtn: $('reset-view-btn'),
  backOverviewBtn: $('back-overview-btn'),
  moonPhasePath: $('moon-phase-path'),
  moonPhaseName: $('moon-phase-name'),
  moonIllum: $('moon-illum'),
  moonDistance: $('moon-distance'),
  moonAltitude: $('moon-altitude'),
  focusMoonBtn: $('focus-moon-btn'),
  playMoonBtn: $('play-moon-btn'),
  orbitToggle: $('orbit-toggle'),
  playYearBtn: $('play-year-btn')
};

// ---------- 状态 ----------
const state = {
  ms: beijingToUtcMs(2026, 6, 21, 19 * 60 + 30),
  mode: 'overview',     // overview | earth | moon
  locked: false,
  speed: 1,
  playback: null        // 'day' | 'year' | 'moon'
};

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 启动进度：percent 0-100，stage 为当前阶段，message 为详细说明
let lastBootPct = -1;
function setBootProgress({ percent, stage, message }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  if (p >= lastBootPct) {
    lastBootPct = p;
    els.loadingProgressFill.style.width = `${p}%`;
    els.loadingProgress.setAttribute('aria-valuenow', String(p));
    els.loadingPercent.textContent = `${p}%`;
  }
  if (stage) els.loadingStage.textContent = stage;
  if (message) els.loadingText.textContent = message;
}

// ---------- 场景 ----------
const scene = await createObservatory(els.container, {
  labelLayer: els.labelLayer,
  reducedMotion: prefersReducedMotion,
  onBootProgress: setBootProgress,
  onTextureError: (name) => {
    showToast(`${name}加载失败，已使用基础材质继续演示`);
  },
  onWebglError: (err) => {
    els.loading.hidden = true;
    $('webgl-error-detail').textContent =
      `WebGL 初始化失败：${err?.message || '不支持的浏览器环境'}。`;
    els.webglError.hidden = false;
  }
});

if (!scene) {
  throw new Error('WebGL unavailable');
}
window.__scene = scene; // 诊断/验收用
window.__state = state;

// ---------- 播放状态机（纯逻辑模块 + DOM 钩子） ----------

const playback = createPlayback(state, {
  onComplete: (kind) => {
    setInstant(state.ms);
    state.playback = null;
    updatePlayButtons();
    updateStatus();
    if (kind === 'moon') {
      showToast('完成一个朔望月（29.53 天）：月相回到起始形状');
    }
  },
  onLimit: () => {
    setInstant(state.ms);
    state.playback = null;
    updatePlayButtons();
    updateStatus();
    showToast('已到支持日期上限 2036-12-31');
  }
});

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

// ---------- 时间设置 ----------

function setInstant(ms, { manual = false } = {}) {
  if (!Number.isFinite(ms)) return;
  state.ms = ms;
  syncTimeUI();
  refreshSunCard();
  refreshMoonUI();
}

function manualSetInstant(ms) {
  stopPlayback();
  setInstant(ms);
}

function syncTimeUI() {
  const bj = utcMsToBeijing(state.ms);
  els.dateInput.value = bj.dateStr;
  const sliderMin = Math.floor(bj.minuteOfDay / 5) * 5;
  els.timeSlider.value = String(Math.min(1435, sliderMin));
  els.timeClock.textContent = bj.timeStr;
}

function refreshSunCard() {
  const ev = sunEvents(state.ms);
  if (ev.polarDay) {
    els.sunrise.textContent = '极昼';
    els.sunset.textContent = '极昼';
    els.solarNoon.textContent = formatMinutes(ev.solarNoon);
    els.daylight.textContent = '24 小时';
    return;
  }
  if (ev.polarNight) {
    els.sunrise.textContent = '极夜';
    els.sunset.textContent = '极夜';
    els.solarNoon.textContent = formatMinutes(ev.solarNoon);
    els.daylight.textContent = '0 小时';
    return;
  }
  els.sunrise.textContent = formatMinutes(ev.sunrise);
  els.sunset.textContent = formatMinutes(ev.sunset);
  els.solarNoon.textContent = formatMinutes(ev.solarNoon);
  els.daylight.textContent = formatDuration(ev.daylight);
}

// ---------- 月相 SVG（从地球看·北向上示意） ----------

function refreshMoonUI() {
  const ph = moonPhase(state.ms);
  const name = phaseName(ph.phase, ph.illumination);
  els.moonPhaseName.textContent = name;
  els.moonPhasePath.setAttribute('d', moonPhaseSvgPath(ph.phase));
  els.moonIllum.textContent = `${(ph.illumination * 100).toFixed(0)}%`;
  els.moonDistance.textContent = `${(ph.distanceKm / 10000).toFixed(1)} 万 km`;
  const alt = moonAltitude(state.ms);
  const up = alt.elevationDeg >= 0;
  els.moonAltitude.textContent =
    `${up ? '↑' : '↓'} ${Math.abs(alt.elevationDeg).toFixed(1)}° · 地平线${up ? '上方' : '下方'}`;
}

// ---------- 播放（互斥状态机） ----------

function startPlayback(kind) {
  playback.stop();
  if (!playback.start(kind)) return;
  state.playback = playback.getKind();
  updatePlayButtons();
  updateStatus();
}

function stopPlayback() {
  if (!playback.getKind()) return;
  playback.stop();
  state.playback = null;
  updatePlayButtons();
  updateStatus();
}

function updatePlayButtons() {
  const pb = playback.getKind();
  // 一天
  els.playDayBtn.setAttribute('aria-pressed', String(pb === 'day'));
  els.playDayBtn.querySelector('.btn-icon').textContent = pb === 'day' ? '⏸' : '▶';
  els.playDayBtn.querySelector('.btn-label').textContent = pb === 'day' ? '暂停播放' : '播放一天';
  // 公转
  els.playYearBtn.setAttribute('aria-pressed', String(pb === 'year'));
  els.playYearBtn.textContent = pb === 'year' ? '暂停公转' : '演示地球公转';
  // 月球
  els.playMoonBtn.setAttribute('aria-pressed', String(pb === 'moon'));
  els.playMoonBtn.textContent = pb === 'moon' ? '暂停月球公转' : '演示月球公转';
}

function tickPlayback(dt) {
  const res = playback.tick(dt);
  if (res.advanced) {
    setInstant(state.ms);
    if (res.stopped) state.playback = null;
  }
  return res;
}

// ---------- 相机模式 ----------

const VIEW_META = {
  overview: {
    name: '全景视角',
    title: '太阳没有落下。<br />是北京转进了夜晚。'
  },
  earth: {
    name: '地球近景',
    title: '太阳没有落下。<br />是北京转进了夜晚。'
  },
  moon: {
    name: '地月系统',
    title: '月球不自己发光。<br />它把阳光反射给我们。'
  }
};

function setMode(mode) {
  if (!VIEW_META[mode]) return;
  if (mode === state.mode && !(state.locked && mode !== 'earth')) {
    // 同模式下仅处理解锁清理
  }

  // 播放限制：按视角规则停止不兼容的播放（见 playback.js）
  const currentKind = playback.getKind();
  if (currentKind && stopsOnEnter(mode, currentKind)) stopPlayback();

  // 离开地球近景 → 解除北京锁定
  if (mode !== 'earth' && state.locked) toggleLock(false);

  state.mode = mode;
  scene.setMode(mode, state.ms);

  // UI
  els.viewName.textContent = VIEW_META[mode].name;
  els.lessonTitle.innerHTML = VIEW_META[mode].title;
  els.lockBeijingBtn.hidden = mode !== 'earth';
  els.backOverviewBtn.hidden = mode === 'overview';
  els.focusEarthBtn.setAttribute('aria-pressed', String(mode === 'earth'));
  els.focusMoonBtn.setAttribute('aria-pressed', String(mode === 'moon'));
  applyHudReserve();
  updateStatus();
}

function toggleLock(force) {
  const on = typeof force === 'boolean' ? force : !state.locked;
  if (on && state.mode !== 'earth') return;
  state.locked = on;
  scene.setLock(on, state.ms);
  els.lockBeijingBtn.setAttribute('aria-pressed', String(on));
  els.lockBeijingBtn.textContent = on ? '解锁北京' : '锁定北京';
  applyHudReserve();
  updateStatus();
}

// HUD 投影避让：桌面且面板展开时，全景/地月留出空间
function applyHudReserve() {
  const desktop = window.innerWidth > 900 && window.innerHeight > 520;
  const panelOpen = els.panel.classList.contains('panel-open');
  const reserve = desktop && panelOpen && els.panelMain.open && state.mode !== 'earth' && !state.locked
    ? 92 : 0;
  scene.setHudReserve(reserve);
}

// 面板抽屉
function openPanel() {
  els.panel.classList.add('panel-open');
  els.panelToggle.hidden = true;
  els.panelToggle.setAttribute('aria-expanded', 'true');
  applyHudReserve();
}
function closePanel() {
  els.panel.classList.remove('panel-open');
  els.panelToggle.hidden = false;
  els.panelToggle.setAttribute('aria-expanded', 'false');
  applyHudReserve();
}

// ---------- 状态行 ----------

function updateStatus() {
  const bj = utcMsToBeijing(state.ms);
  const pbText = {
    day: '播放一天中',
    year: '演示地球公转中',
    moon: '演示月球公转中'
  }[state.playback] || '暂停';
  const lockText = state.locked ? ' · 锁定北京' : '';
  els.lessonStatus.textContent =
    `${pbText} · ${state.speed}×${lockText} · ${bj.dateStr} ${bj.timeStr}（北京时间）`;
}

// ---------- 事件绑定 ----------

// 日期
els.dateInput.addEventListener('change', () => {
  const parsed = parseDateStr(els.dateInput.value);
  if (!parsed.ok) {
    els.dateError.textContent = parsed.error;
    els.dateError.hidden = false;
    syncTimeUI();
    return;
  }
  const range = checkRange(parsed.y, parsed.m, parsed.d,
    utcMsToBeijing(state.ms).minuteOfDay);
  if (!range.ok) {
    els.dateError.textContent = range.error;
    els.dateError.hidden = false;
    syncTimeUI();
    return;
  }
  els.dateError.hidden = true;
  const bj = utcMsToBeijing(state.ms);
  manualSetInstant(beijingToUtcMs(parsed.y, parsed.m, parsed.d, bj.minuteOfDay));
  updateStatus();
});

// 时间滑块
els.timeSlider.addEventListener('input', () => {
  const bj = utcMsToBeijing(state.ms);
  const min = Number(els.timeSlider.value);
  manualSetInstant(beijingToUtcMs(bj.y, bj.m, bj.d, min));
  updateStatus();
});

// 速度
els.speedSelect.addEventListener('change', () => {
  state.speed = Number(els.speedSelect.value);
  const daySec = Math.round(24 / state.speed);
  const moonSec = Math.round(SYNODIC_MONTH / 1.4 / state.speed);
  els.dayDurationHint.textContent =
    `一天约 ${daySec} 秒；一轮月相约 ${moonSec} 秒（当前速度）`;
  updateStatus();
});

// 播放
els.playDayBtn.addEventListener('click', () => {
  if (state.playback === 'day') stopPlayback();
  else startPlayback('day');
});
els.playYearBtn.addEventListener('click', () => {
  if (state.playback === 'year') { stopPlayback(); return; }
  if (state.mode !== 'overview') setMode('overview');
  startPlayback('year');
});
els.playMoonBtn.addEventListener('click', () => {
  if (state.playback === 'moon') { stopPlayback(); return; }
  if (state.mode !== 'moon') setMode('moon');
  startPlayback('moon');
});

// 视角按钮
els.focusEarthBtn.addEventListener('click', () => setMode('earth'));
els.focusMoonBtn.addEventListener('click', () => setMode('moon'));
els.backOverviewBtn.addEventListener('click', () => setMode('overview'));
els.lockBeijingBtn.addEventListener('click', () => toggleLock());
els.zoomInBtn.addEventListener('click', () => scene.zoomIn());
els.zoomOutBtn.addEventListener('click', () => scene.zoomOut());
els.resetViewBtn.addEventListener('click', () => scene.resetCamera(state.ms));

// 季节快捷日期
document.querySelectorAll('[data-season]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const parsed = parseDateStr(btn.dataset.season);
    if (!parsed.ok) return;
    const bj = utcMsToBeijing(state.ms);
    manualSetInstant(beijingToUtcMs(parsed.y, parsed.m, parsed.d, bj.minuteOfDay));
    updateStatus();
  });
});

// 轨道开关
els.orbitToggle.addEventListener('change', () => {
  scene.setOrbitVisible(els.orbitToggle.checked);
});

// 面板开合 → 重新避让
els.panelMain.addEventListener('toggle', applyHudReserve);
els.panelToggle.addEventListener('click', openPanel);
els.panelClose.addEventListener('click', closePanel);

// Esc：先关面板，再返回全景
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (els.panel.classList.contains('panel-open')) closePanel();
  else if (state.mode !== 'overview') setMode('overview');
});

// 点击天体（区分拖动，阈值 7px）
let downX = 0, downY = 0;
scene.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX; downY = e.clientY;
});
scene.domElement.addEventListener('pointerup', (e) => {
  if (state.mode !== 'overview') return;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (moved > 7) return;
  const hit = scene.pick(e.clientX, e.clientY);
  if (hit === 'earth') setMode('earth');
  else if (hit === 'moon') setMode('moon');
});

// 尺寸
window.addEventListener('resize', () => scene.resize());

// 后台：RAF 自动停止；回到前台不补算（dt 已 clamp）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.playback) {
    // 保持播放任务状态但实际不推进；RAF 停止即暂停推进
  }
});

// ---------- 主循环 ----------

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  if (!document.hidden && state.playback) tickPlayback(dt);
  scene.update(state.ms, dt);
  // 状态行每秒刷新约即可；这里轻量刷新保证时间显示连续
  if (state.playback) updateStatus();
  requestAnimationFrame(frame);
}

// 验收钩子：页面被环境报告为 hidden 时（如移动端模拟），可用定时器手动推进
window.__manualTick = (dt) => {
  if (state.playback) tickPlayback(dt);
  scene.update(state.ms, dt);
};

// ---------- 启动 ----------

function boot() {
  // 面板默认状态：桌面展开，手机/低矮横屏收起
  const compact = window.innerWidth <= 900 || window.innerHeight <= 520;
  if (compact) els.panelMain.open = false;

  syncTimeUI();
  refreshSunCard();
  refreshMoonUI();
  updatePlayButtons();
  updateStatus();
  scene.setMode('overview', state.ms, { immediate: true });
  applyHudReserve();
  requestAnimationFrame(frame);

  scene.texturesReady.then((results) => {
    const failed = results.filter((r) => !r.ok).length;
    setBootProgress({
      percent: 100, stage: failed ? '完成（部分降级）' : '加载完成',
      message: failed ? '部分贴图加载失败，已使用基础材质。' : '宇宙布置完成，欢迎观察。'
    });
    // 不足 2 秒则继续展示欢迎页，等满再淡出
    const hold = Math.max(0, BOOT_MIN_MS - (performance.now() - bootStart));
    setTimeout(() => {
      els.loading.style.transition = 'opacity 0.4s';
      els.loading.style.opacity = '0';
      setTimeout(() => { els.loading.hidden = true; }, 420);
    }, hold);
  });
}

boot();
