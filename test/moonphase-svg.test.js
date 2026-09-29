// moonphase-svg.test.js — 八相示意图关键相位路径
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { moonPhaseSvgPath } from '../src/moonphase-svg.js';

test('新月 p=0：亮面面积为零（外弧原路返回）', () => {
  const d = moonPhaseSvgPath(0);
  assert.ok(d.startsWith('M32 2 A30 30 0 0 1 32 62')); // 右侧外半圆
  assert.ok(d.includes('A30.00 30 0 0 0 32 2'));        // 同侧返回
});

test('上弦 p=0.25：右半边亮（晨昏线近直线）', () => {
  const d = moonPhaseSvgPath(0.25);
  assert.ok(d.startsWith('M32 2 A30 30 0 0 1 32 62'));
  assert.ok(d.includes('A0.02 30 0 0 0 32 2'));
});

test('满月 p=0.5：整个圆盘亮（两个半圆合成整圆）', () => {
  const d = moonPhaseSvgPath(0.5);
  assert.equal(d, 'M32 2 A30 30 0 0 0 32 62 A30.00 30 0 0 0 32 2');
});

test('下弦 p=0.75：左半边亮', () => {
  const d = moonPhaseSvgPath(0.75);
  assert.ok(d.startsWith('M32 2 A30 30 0 0 0 32 62'));
  assert.ok(d.includes('A0.02 30 0 0 1 32 2'));
});

test('盈月外弧在右侧、亏月外弧在左侧', () => {
  for (const p of [0.1, 0.3, 0.49]) {
    assert.ok(moonPhaseSvgPath(p).includes('A30 30 0 0 1 32 62'), `p=${p}`);
  }
  for (const p of [0.51, 0.7, 0.9]) {
    assert.ok(moonPhaseSvgPath(p).includes('A30 30 0 0 0 32 62'), `p=${p}`);
  }
});
