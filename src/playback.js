// playback.js — 播放状态机（纯逻辑，无 DOM，可在 Node 中直接测试）
//
// 三种播放互斥：
//   day  —— 播放一天：60 模拟分钟 / 真实秒，满 24h 停在次日同一时刻
//   year —— 演示地球公转：12 模拟天 / 真实秒，仅全景视角可用
//   moon —— 演示月球公转：1.4 模拟天 / 真实秒，仅地月系统视图可用，
//           满一个朔望月（29.53059 天）自动停止
// 日期范围 2024-01-01 00:00 ~ 2036-12-31 23:59（北京时间），越界即停。

import { beijingToUtcMs, DATE_MIN_YMD, DATE_MAX_YMD } from './solar.js';
import { SYNODIC_MONTH } from './moon.js';

export const DAY_MS = 86400000;
export const DAY_RATE = 60 * 60000;            // 60 模拟分钟/秒
export const YEAR_RATE = 12 * DAY_MS;          // 12 模拟天/秒
export const MOON_RATE = 1.4 * DAY_MS;         // 1.4 模拟天/秒

export const MIN_MS =
  beijingToUtcMs(DATE_MIN_YMD.y, DATE_MIN_YMD.m, DATE_MIN_YMD.d, 0);
export const MAX_MS =
  beijingToUtcMs(DATE_MAX_YMD.y, DATE_MAX_YMD.m, DATE_MAX_YMD.d, 23 * 60 + 59);

export const KINDS = ['day', 'year', 'moon'];

// 视角对播放的许可：年公转仅全景；月球公转仅地月系统视图；一天任意视图
export function canStart(kind, mode) {
  if (kind === 'year') return mode === 'overview';
  if (kind === 'moon') return mode === 'moon';
  if (kind === 'day') return true;
  return false;
}

// 切换视角时需要停止哪些播放
export function stopsOnEnter(mode, kind) {
  if (mode === 'earth') return kind === 'year' || kind === 'moon';
  if (mode === 'moon') return kind === 'year';
  if (mode === 'overview') return kind === 'moon' || kind === 'year';
  return false;
}

export function createPlayback(state, hooks = {}) {
  let kind = null;
  let startMs = 0;

  function start(k) {
    if (!canStart(k, state.mode)) return false;
    kind = k;
    startMs = state.ms;
    return true;
  }

  function stop() {
    kind = null;
  }

  function getKind() {
    return kind;
  }

  function tick(dt) {
    if (!kind) return { advanced: false };
    const rate =
      kind === 'day' ? DAY_RATE :
      kind === 'year' ? YEAR_RATE : MOON_RATE;
    let next = state.ms + rate * state.speed * dt;

    // 完整循环停止
    if (kind === 'day' && next - startMs >= DAY_MS) {
      state.ms = startMs + DAY_MS;
      kind = null;
      hooks.onComplete?.('day');
      return { advanced: true, stopped: 'day' };
    }
    if (kind === 'moon' && next - startMs >= SYNODIC_MONTH * DAY_MS) {
      state.ms = startMs + SYNODIC_MONTH * DAY_MS;
      kind = null;
      hooks.onComplete?.('moon');
      return { advanced: true, stopped: 'moon' };
    }
    // 日期上限
    if (next >= MAX_MS) {
      state.ms = MAX_MS;
      kind = null;
      hooks.onLimit?.();
      return { advanced: true, stopped: 'limit' };
    }
    if (next < MIN_MS) next = MIN_MS;
    state.ms = next;
    return { advanced: true };
  }

  return { start, stop, tick, getKind };
}
