// solar.test.js — 时间换算、日期校验与日出日落季节规律
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLeapYear, daysInMonth, isValidDate, parseDateStr,
  beijingToUtcMs, utcMsToBeijing, sunEvents, sunDirection
} from '../src/solar.js';

test('闰年判定：能被4整除且非整百年，或能被400整除', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
});

test('各月天数，闰年2月为29天', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m)),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  );
  assert.equal(daysInMonth(2024, 2), 29);
});

test('日期合法性：闰日与非法日期', () => {
  assert.equal(isValidDate(2024, 2, 29), true);
  assert.equal(isValidDate(2026, 2, 29), false);
  assert.equal(isValidDate(2026, 13, 1), false);
  assert.equal(isValidDate(2026, 0, 1), false);
  assert.equal(isValidDate(2026, 4, 0), false);
  assert.equal(isValidDate(2026, 4, 31), false);
});

test('parseDateStr：合法、格式错误、不存在的日期', () => {
  assert.equal(parseDateStr('2026-06-21').ok, true);
  assert.equal(parseDateStr('2026-6-21').ok, false);
  assert.equal(parseDateStr('2026/06/21').ok, false);
  assert.equal(parseDateStr('2026-02-29').ok, false);
  assert.equal(parseDateStr('abc').ok, false);
});

test('北京时间↔UTC 换算：固定偏移且与时区环境无关', () => {
  // 北京 2026-06-21 12:00 == UTC 04:00
  const ms = beijingToUtcMs(2026, 6, 21, 720);
  assert.equal(ms, Date.UTC(2026, 5, 21, 4, 0));
  const bj = utcMsToBeijing(ms);
  assert.equal(bj.dateStr, '2026-06-21');
  assert.equal(bj.timeStr, '12:00');
  assert.equal(bj.minuteOfDay, 720);
  // 跨日：北京 00:30 == 前一日 UTC 16:30
  const ms2 = beijingToUtcMs(2026, 1, 1, 30);
  assert.equal(ms2, Date.UTC(2025, 11, 31, 16, 30));
  assert.equal(utcMsToBeijing(ms2).dateStr, '2026-01-01');
});

test('北京日出日落：夏至昼最长、冬至昼最短、分点约12小时', () => {
  const summer = sunEvents(beijingToUtcMs(2026, 6, 21, 720));
  const winter = sunEvents(beijingToUtcMs(2026, 12, 21, 720));
  const equinox = sunEvents(beijingToUtcMs(2026, 3, 20, 720));
  assert.ok(summer.daylight > 14.5 * 60, `夏至白昼 ${summer.daylight}`);
  assert.ok(winter.daylight < 9.7 * 60, `冬至白昼 ${winter.daylight}`);
  assert.ok(Math.abs(equinox.daylight - 720) < 20, `分点白昼 ${equinox.daylight}`);
  // 与 USNO 数据对比（容差 3 分钟）
  assert.ok(Math.abs(summer.sunrise - 286) <= 3);   // 04:46
  assert.ok(Math.abs(summer.sunset - 1186) <= 3);   // 19:46
  assert.ok(Math.abs(winter.sunrise - 452) <= 3);   // 07:32
  assert.ok(Math.abs(winter.sunset - 1012) <= 3);   // 16:52
});

test('太阳方向连续，一年绕黄道一周', () => {
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const d0 = sunDirection(beijingToUtcMs(2026, 1, 1, 0));
  const d1 = sunDirection(beijingToUtcMs(2026, 7, 1, 0));
  const d2 = sunDirection(beijingToUtcMs(2027, 1, 1, 0));
  // 半年后方向近似相反
  assert.ok(dot(d0, d1) < -0.95);
  // 整年后近似回到原方向
  assert.ok(dot(d0, d2) > 0.99);
});
