// moonphase-svg.js — “从地球看”月相图的亮面路径
// viewBox 64×64，圆心 (32,32)，半径 30；北向上，盈月亮右侧，亏月亮左侧。

export function moonPhaseSvgPath(p) {
  // 亮面边界：外半圆 + 晨昏线投影椭圆弧
  let a = 30 * Math.cos(p * 2 * Math.PI);
  // 浮点零归并（如 p=0.25/0.75），避免 sweep 标志被 1e-16 的符号翻转
  if (Math.abs(a) < 1e-9) a = 0;
  const rx = Math.max(0.02, Math.abs(a)).toFixed(2);
  if (p < 0.5) {
    // 外弧：右侧半圆（顶 → 底，顺时针 sweep=1）
    const sweep = a >= 0 ? 0 : 1;
    return `M32 2 A30 30 0 0 1 32 62 A${rx} 30 0 0 ${sweep} 32 2`;
  }
  // 外弧：左侧半圆（顶 → 底，逆时针 sweep=0）
  const sweep = a >= 0 ? 1 : 0;
  return `M32 2 A30 30 0 0 0 32 62 A${rx} 30 0 0 ${sweep} 32 2`;
}
