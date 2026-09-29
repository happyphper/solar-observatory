// moon.test.js — Schlyter 月球轨道、月相、距离与北京月心高度
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beijingToUtcMs } from '../src/solar.js';
import {
  moonPosition, moonPhase, moonAltitude, SYNODIC_MONTH
} from '../src/moon.js';

const DAY = 86400000;
const noon = (y, m, d) => beijingToUtcMs(y, m, d, 720);

test('2026年9月四个主要月相（容差0.02周）', () => {
  const cases = [
    [2026, 9, 4, 0.75],   // 下弦
    [2026, 9, 11, 0.0],   // 新月
    [2026, 9, 19, 0.25],  // 上弦
    [2026, 9, 27, 0.5]    // 满月
  ];
  for (const [y, m, d, expect] of cases) {
    const ph = moonPhase(noon(y, m, d));
    const err = Math.min(
      Math.abs(ph.phase - expect),
      Math.abs(ph.phase - expect + 1),
      Math.abs(ph.phase - expect - 1)
    );
    assert.ok(err <= 0.02, `${y}-${m}-${d} phase=${ph.phase} expect=${expect}`);
    if (expect === 0) assert.ok(ph.illumination < 0.03);
    if (expect === 0.5) assert.ok(ph.illumination > 0.97);
    if (expect === 0.25 || expect === 0.75) {
      assert.ok(Math.abs(ph.illumination - 0.5) < 0.06);
    }
  }
});

test('轨道跨年连续：年末与年初位置平滑衔接', () => {
  const a = moonPosition(beijingToUtcMs(2025, 12, 31, 23 * 60 + 59));
  const b = moonPosition(beijingToUtcMs(2026, 1, 1, 0));
  // 1 分钟内黄经变化应小于 0.02°
  let dlon = Math.abs(a.lon - b.lon);
  dlon = Math.min(dlon, Math.abs(dlon - 2 * Math.PI));
  assert.ok(dlon < 0.02 * Math.PI / 180, `dlon=${dlon}`);
  assert.ok(Math.abs(a.distanceKm - b.distanceKm) < 10);
});

test('地月距离落在近地点/远地点合理区间（一年采样）', () => {
  for (let i = 0; i <= 365; i += 5) {
    const p = moonPosition(noon(2026, 1, 1) + i * DAY);
    assert.ok(p.distanceKm > 350000 && p.distanceKm < 410000,
      `day ${i} dist=${p.distanceKm}`);
  }
});

test('一个朔望月后月相回到原值', () => {
  const t = noon(2026, 6, 21);
  const p0 = moonPhase(t);
  const p1 = moonPhase(t + SYNODIC_MONTH * DAY);
  let err = Math.abs(p0.phase - p1.phase);
  err = Math.min(err, Math.abs(err - 1));
  assert.ok(err < 0.002);
});

test('北京月心上中天高度（2026-09-26，约53°，含真实距离视差）', () => {
  let best = -90;
  for (let minute = 0; minute < 1440; minute += 2) {
    const alt = moonAltitude(beijingToUtcMs(2026, 9, 26, minute));
    if (alt.elevationDeg > best) best = alt.elevationDeg;
  }
  assert.ok(Math.abs(best - 53.4) < 1.5, `max alt=${best}`);
});

test('月球黄纬被轨道倾角约束在 ±5.3° 附近', () => {
  for (let i = 0; i <= 27; i += 3) {
    const p = moonPosition(noon(2026, 9, 1) + i * DAY);
    assert.ok(Math.abs(p.lat) < 6 * Math.PI / 180);
  }
});
