// moon.js — 月球轨道、月相与北京月心高度（纯函数）
//
// 轨道：Paul Schlyter 低精度算法（日期驱动的开普勒椭圆 + 主要太阳引力扰动）
// https://www.stjarnhimlen.se/comp/ppcomp.html
// - 历元：1999-12-31 00:00 UTC
// - 倾角 5.1454°，离心率 0.0549，半长轴 60.2666 地球赤道半径
// - 恒星月约 27.32166 天，朔望月约 29.53059 天
//
// 月相使用与场景相同的太阳黄经（solar.js，USNO 近似），保证光照与月相一致。

import {
  sunLongitude, wrap2Pi, BEIJING_LAT, BEIJING_LON, daysSinceJ2000
} from './solar.js';

const DAY_MS = 86400000;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6378.137;
const MOON_SEMI_MAJOR_ER = 60.2666;
export const SYNODIC_MONTH = 29.53059;
export const SIDEREAL_MONTH = 27.32166;

// Schlyter 历元
const SCHLYTER_EPOCH_MS = Date.UTC(1999, 11, 31, 0, 0, 0);

function schlyterDays(ms) {
  return (ms - SCHLYTER_EPOCH_MS) / DAY_MS;
}

// 开普勒方程 M = E - e sin E，Newton 迭代
function solveKepler(Mrad, e) {
  let E = Mrad + e * Math.sin(Mrad) * (1 + e * Math.cos(Mrad));
  for (let k = 0; k < 30; k++) {
    const f = E - e * Math.sin(E) - Mrad;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

// 太阳轨道元素（Schlyter），供月球扰动使用；返回太阳平黄经 Ls（度）等
function sunElements(d) {
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = 356.0470 + 0.9856002585 * d;
  const es = 0.016709 - 1.151e-9 * d;
  return { ws, Ms, es, Ls: Ms + ws };
}

// 太阳真近点角与黄经（Schlyter，度）
function sunTrueLongitudeDeg(se) {
  const Mrad = se.Ms * DEG;
  const E = solveKepler(Mrad, se.es);
  const xv = Math.cos(E) - se.es;
  const yv = Math.sqrt(1 - se.es * se.es) * Math.sin(E);
  const v = Math.atan2(yv, xv) * RAD;
  return v + se.ws;
}

// 月球地心位置（日心扰动后的黄经/黄纬/距离）
// 返回 { lon(rad), lat(rad), distER, distanceKm, meanLonRad, d (schlyter days) }
export function moonPosition(ms) {
  const d = schlyterDays(ms);

  // 月球轨道元素（度）
  const N = 125.1228 - 0.0529538083 * d;
  const inc = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const e = 0.0549;
  const M = 115.3654 + 13.0649929509 * d;

  const Mrad = M * DEG;
  const E = solveKepler(Mrad, e);
  const xv = MOON_SEMI_MAJOR_ER * (Math.cos(E) - e);
  const yv = MOON_SEMI_MAJOR_ER * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv); // 弧度
  const r = Math.hypot(xv, yv); // 地球赤道半径

  // 中间黄道坐标
  const vw = v + w * DEG;
  const Nrad = N * DEG;
  const irad = inc * DEG;
  const x = Math.cos(Nrad) * Math.cos(vw) - Math.sin(Nrad) * Math.sin(vw) * Math.cos(irad);
  const y = Math.sin(Nrad) * Math.cos(vw) + Math.cos(Nrad) * Math.sin(vw) * Math.cos(irad);
  const z = Math.sin(vw) * Math.sin(irad);
  let lon = Math.atan2(y, x);
  let lat = Math.atan2(z, Math.hypot(x, y));

  // 主要太阳引力扰动
  const se = sunElements(d);
  const Lm = M + w + N;            // 月球平均黄经（度）
  const D = Lm - se.Ls;            // 平均距角（度）
  const F = Lm - N;                // 纬度幅角（度）
  const Mm = M;
  const Ms = se.Ms;

  const rad = (deg) => deg * DEG;
  const dLon =
    -1.274 * Math.sin(rad(Mm - 2 * D))
    + 0.658 * Math.sin(rad(2 * D))
    - 0.186 * Math.sin(rad(Ms))
    - 0.059 * Math.sin(rad(2 * Mm - 2 * D))
    - 0.057 * Math.sin(rad(Mm - 2 * D + Ms))
    + 0.053 * Math.sin(rad(Mm + 2 * D))
    + 0.046 * Math.sin(rad(2 * D - Ms))
    + 0.041 * Math.sin(rad(Mm - Ms))
    - 0.035 * Math.sin(rad(D))
    - 0.031 * Math.sin(rad(Mm + Ms))
    - 0.015 * Math.sin(rad(2 * F - 2 * D))
    + 0.011 * Math.sin(rad(Mm - 4 * D));
  const dLat =
    -0.173 * Math.sin(rad(F - 2 * D))
    - 0.055 * Math.sin(rad(Mm - F - 2 * D))
    - 0.046 * Math.sin(rad(Mm + F - 2 * D))
    + 0.033 * Math.sin(rad(F + 2 * D))
    + 0.017 * Math.sin(rad(2 * Mm + F));
  const dR = -0.58 * Math.cos(rad(Mm - 2 * D)) - 0.46 * Math.cos(rad(2 * D));

  lon = wrap2Pi(lon + dLon * DEG);
  lat = lat + dLat * DEG;
  const distER = r + dR;

  return {
    lon,
    lat,
    distER,
    distanceKm: distER * EARTH_RADIUS_KM,
    meanLonRad: wrap2Pi(Lm * DEG),
    d
  };
}

// 月相：phase = wrap(λmoon − λsun)/2π；受光比例 ≈ (1 − cosβ·cos(λmoon−λsun))/2
export function moonPhase(ms) {
  const mp = moonPosition(ms);
  const ls = sunLongitude(ms);
  const phase = wrap2Pi(mp.lon - ls) / (2 * Math.PI);
  const cosElong = Math.cos(mp.lat) * Math.cos(mp.lon - ls);
  const illumination = (1 - cosElong) / 2;
  return { phase, illumination, ...mp };
}

// 月相名称。主相只在窄范围（±2°，约 0.0056 周）使用。
export function phaseName(phase, illumination) {
  const principal = 0.0056; // ±2°
  const dNew = Math.min(phase, 1 - phase);
  if (dNew < principal) return '新月';
  if (Math.abs(phase - 0.25) < principal) return '上弦月';
  if (Math.abs(phase - 0.5) < principal) return '满月';
  if (Math.abs(phase - 0.75) < principal) return '下弦月';
  if (phase < 0.25) return '盈月牙';
  if (phase < 0.5) return '盈凸月';
  if (phase < 0.75) return '亏凸月';
  return '残月';
}

// ---------- 北京月心几何高度（含地表观察者视差，不含大气折射） ----------
// r 与观察者坐标均以地球赤道半径为单位；使用真实天文距离。

export function moonAltitude(ms, lat = BEIJING_LAT, lon = BEIJING_LON) {
  const mp = moonPosition(ms);
  const d = mp.d;
  const eps = (23.4393 - 3.563e-7 * d) * DEG;

  // 地心赤道坐标
  const cl = Math.cos(mp.lat);
  const Xeq = mp.distER * cl * Math.cos(mp.lon);
  const Yeq = mp.distER * (Math.sin(mp.lon) * cl * Math.cos(eps) - Math.sin(mp.lat) * Math.sin(eps));
  const Zeq = mp.distER * (Math.sin(mp.lon) * cl * Math.sin(eps) + Math.sin(mp.lat) * Math.cos(eps));

  // 当地恒星时
  const n = daysSinceJ2000(ms);
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * DEG;
  const LST = gmst + lon * DEG;

  // 地表观察者（地球椭球）
  const phi = lat * DEG;
  const e2 = 0.00669437999014;
  const rho = 1 / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
  const Xobs = rho * Math.cos(phi) * Math.cos(LST);
  const Yobs = rho * Math.cos(phi) * Math.sin(LST);
  const Zobs = rho * (1 - e2) * Math.sin(phi);

  // 站心坐标
  const X = Xeq - Xobs;
  const Y = Yeq - Yobs;
  const Z = Zeq - Zobs;

  const east = -X * Math.sin(LST) + Y * Math.cos(LST);
  const north = -X * Math.sin(phi) * Math.cos(LST) - Y * Math.sin(phi) * Math.sin(LST) + Z * Math.cos(phi);
  const up = X * Math.cos(phi) * Math.cos(LST) + Y * Math.cos(phi) * Math.sin(LST) + Z * Math.sin(phi);

  const elevation = Math.atan2(up, Math.hypot(east, north)) * RAD;
  const azimuth = wrap2Pi(Math.atan2(east, north)) * RAD;
  return { elevationDeg: elevation, azimuthDeg: azimuth };
}
