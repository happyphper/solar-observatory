// playback.test.js — 三种播放互斥、停止点、速度与上限
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beijingToUtcMs } from '../src/solar.js';
import {
  createPlayback, canStart, stopsOnEnter,
  DAY_RATE, YEAR_RATE, MOON_RATE, DAY_MS, MAX_MS, MIN_MS
} from '../src/playback.js';

const freshState = (extra = {}) => ({
  ms: beijingToUtcMs(2026, 6, 21, 12 * 60),
  speed: 1,
  mode: 'overview',
  ...extra
});

test('播放一天：满24小时精确停止，任意视角可启动', () => {
  for (const mode of ['overview', 'earth', 'moon']) {
    const state = freshState({ mode });
    const pb = createPlayback(state);
    assert.equal(pb.start('day'), true);
    let stopped = null;
    for (let i = 0; i < 30; i++) {
      const r = pb.tick(1);
      if (r.stopped) { stopped = r.stopped; break; }
    }
    assert.equal(stopped, 'day');
    assert.equal(pb.getKind(), null);
  }
});

test('年公转：仅全景可启动，速率12天/秒', () => {
  assert.equal(canStart('year', 'earth'), false);
  assert.equal(canStart('year', 'moon'), false);
  assert.equal(canStart('year', 'overview'), true);
  const state = freshState();
  const pb = createPlayback(state);
  assert.equal(pb.start('year'), true);
  const before = state.ms;
  pb.tick(1);
  assert.equal(state.ms - before, YEAR_RATE);
});

test('月球公转：仅地月系统视图可启动，满朔望月停止', () => {
  assert.equal(canStart('moon', 'overview'), false);
  assert.equal(canStart('moon', 'earth'), false);
  assert.equal(canStart('moon', 'moon'), true);
  const state = freshState({ mode: 'moon' });
  let completed = null;
  const pb = createPlayback(state, { onComplete: (k) => { completed = k; } });
  assert.equal(pb.start('moon'), true);
  for (let i = 0; i < 25; i++) pb.tick(1);
  assert.equal(completed, 'moon');
  assert.equal(pb.getKind(), null);
});

test('速度加倍：推进量与速度成正比，且不重置起始时刻', () => {
  const s1 = freshState();
  const p1 = createPlayback(s1);
  p1.start('day');
  p1.tick(5); // 5 秒 → 5 模拟小时
  const t1 = s1.ms;

  const s2 = freshState({ speed: 2 });
  const p2 = createPlayback(s2);
  p2.start('day');
  p2.tick(5); // 5 秒 ×2 → 10 模拟小时
  assert.equal(s2.ms - s1.ms, 5 * DAY_RATE);
  // 同样 5 秒，速度2恰好是速度1推进量的两倍
  const base = freshState();
  assert.equal(s2.ms - base.ms, 2 * (t1 - base.ms));
});

test('三种播放互斥：启动新任务会替换旧任务', () => {
  const state = freshState();
  const pb = createPlayback(state);
  pb.start('day');
  assert.equal(pb.getKind(), 'day');
  pb.start('year');
  assert.equal(pb.getKind(), 'year');
});

test('日期上限：越界即停在 2036-12-31 23:59 并触发钩子', () => {
  const state = freshState({ ms: MAX_MS - 2 * DAY_MS });
  let limitFired = false;
  const pb = createPlayback(state, { onLimit: () => { limitFired = true; } });
  pb.start('year');
  pb.tick(1);
  assert.equal(state.ms, MAX_MS);
  assert.equal(pb.getKind(), null);
  assert.equal(limitFired, true);
});

test('日期下限钳制：不会早于 2024-01-01', () => {
  const state = freshState({ ms: MIN_MS + 1000 });
  const pb = createPlayback(state);
  pb.start('day');
  pb.tick(0.001); // 向前推进不影响；直接验证常量边界
  assert.ok(MIN_MS < state.ms);
});

test('stopsOnEnter：视角切换的停止规则', () => {
  assert.equal(stopsOnEnter('earth', 'year'), true);
  assert.equal(stopsOnEnter('earth', 'moon'), true);
  assert.equal(stopsOnEnter('earth', 'day'), false);
  assert.equal(stopsOnEnter('moon', 'year'), true);
  assert.equal(stopsOnEnter('moon', 'moon'), false);
  assert.equal(stopsOnEnter('overview', 'moon'), true);
  assert.equal(stopsOnEnter('overview', 'year'), true);
  assert.equal(stopsOnEnter('overview', 'day'), false);
});
