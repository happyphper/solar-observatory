// solar.js — 时间/时区、NOAA 太阳位置与日出日落、连续太阳黄经（纯函数，可脱离 DOM 测试）
//
// 约定：
// - 唯一物理状态为 UTC 瞬时（毫秒）。界面显示北京时间（UTC+8）。
// - 世界黄道坐标：+Y 指向黄道北极；黄经 λ、黄纬 β 的方向为
//   direction = (sinλ·cosβ, sinβ, cosλ·cosβ)
// - 太阳黄纬近似 0：sunDirection = (sinλs, 0, cosλs)

export const BEIJING_LAT = 39.9042;       // 北纬
export const BEIJING_LON = 116.4074;      // 东经
export const UTC_OFFSET_MIN = 480;        // UTC+8
export const DATE_MIN_YMD = { y: 2024, m: 1, d: 1 };
export const DATE_MAX_YMD = { y: 2036, m: 12, d: 31 };
const DAY_MS = 86400000;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const wrap2Pi = (x) => {
  const w = x % (2 * Math.PI);
  return w < 0 ? w + 2 * Math.PI : w;
};
const wrap360 = (x) => {
  const w = x % 360;
  return w < 0 ? w + 360 : w;
};
export { wrap2Pi, wrap360 };

// ---------- 日期与北京时间 ----------

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function daysInYear(y) {
  return isLeapYear(y) ? 366 : 365;
}

export function dayOfYear(y, m, d) {
  let n = 0;
  for (let k = 1; k < m; k++) n += daysInMonth(y, k);
  return n + d;
}

// 校验数字拆分的日历日期；返回 true/false
export function isValidDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

// 解析 "YYYY-MM-DD"，严格校验（不依赖设备本地时区，不用 new Date(str)）
export function parseDateStr(str) {
  if (typeof str !== 'string') return { ok: false, error: '日期格式不正确，应为 YYYY-MM-DD' };
  const mt = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mt) return { ok: false, error: '日期格式不正确，应为 YYYY-MM-DD' };
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  const d = Number(mt[3]);
  if (!isValidDate(y, m, d)) return { ok: false, error: '日期不存在（请检查月份与日期，含闰年）' };
  return { ok: true, y, m, d };
}

export function dateToStr(y, m, d) {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

// 北京日期 + 当日分钟数（可为小数）→ UTC 毫秒
export function beijingToUtcMs(y, m, d, minuteOfDay) {
  return Date.UTC(y, m - 1, d) + minuteOfDay * 60000 - UTC_OFFSET_MIN * 60000;
}

// UTC 毫秒 → 北京日期与时间（各字段）
export function utcMsToBeijing(ms) {
  if (!Number.isFinite(ms)) return null;
  const shifted = ms + UTC_OFFSET_MIN * 60000;
  const dt = new Date(shifted);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  const secondOfDay = dt.getUTCHours() * 3600 + dt.getUTCMinutes() * 60 + dt.getUTCSeconds() + dt.getUTCMilliseconds() / 1000;
  const minuteOfDay = secondOfDay / 60;
  return {
    y, m, d,
    hour: Math.floor(secondOfDay / 3600),
    minute: Math.floor((secondOfDay % 3600) / 60),
    second: Math.floor(secondOfDay % 60),
    minuteOfDay,
    dateStr: dateToStr(y, m, d),
    timeStr: formatMinutes(minuteOfDay)
  };
}

// 分钟数（可小数）→ "HH:MM"
export function formatMinutes(min) {
  if (!Number.isFinite(min)) return '—';
  let m = ((min % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = Math.floor(m % 60 + 0.5);
  if (mm === 60) { m += 60; }
  const h = mm === 60 ? (hh + 1) % 24 : hh;
  const mi = mm === 60 ? 0 : mm;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// 分钟数 → "X小时Y分"
export function formatDuration(min) {
  if (!Number.isFinite(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h} 小时 ${m} 分`;
}

// 支持范围校验（含当日时间上限 23:55）
export function checkRange(y, m, d, minuteOfDay = 0) {
  const minMs = beijingToUtcMs(DATE_MIN_YMD.y, DATE_MIN_YMD.m, DATE_MIN_YMD.d, 0);
  const maxMs = beijingToUtcMs(DATE_MAX_YMD.y, DATE_MAX_YMD.m, DATE_MAX_YMD.d, 23 * 60 + 55);
  const ms = beijingToUtcMs(y, m, d, minuteOfDay);
  if (ms < minMs) return { ok: false, error: '日期超出支持范围：2024-01-01 至 2036-12-31' };
  if (ms > maxMs) return { ok: false, error: '日期超出支持范围：2024-01-01 至 2036-12-31' };
  return { ok: true, ms };
}

// ---------- NOAA 近似太阳位置 ----------
// 参考：https://gml.noaa.gov/grad/solcalc/solareqns.PDF

// 年内角 γ（弧度），使用北京当地日期与小时
function fractionalYear(bj) {
  const doy = dayOfYear(bj.y, bj.m, bj.d);
  const hour = bj.minuteOfDay / 60;
  return (2 * Math.PI / daysInYear(bj.y)) * (doy - 1 + (hour - 12) / 24);
}

// 返回时差 E（分钟）与太阳赤纬 δ（弧度）
export function equationOfTimeAndDecl(ms) {
  const bj = utcMsToBeijing(ms);
  const g = fractionalYear(bj);
  const eqtime = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(g)
    - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g)
    - 0.040849 * Math.sin(2 * g)
  );
  const decl = 0.006918
    - 0.399912 * Math.cos(g)
    + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g)
    + 0.00148 * Math.sin(3 * g);
  return { eqtime, decl, gamma: g };
}

// 给定瞬时的太阳高度角/方位角（度）。方位北起顺时针。
export function sunPosition(ms, lat = BEIJING_LAT, lon = BEIJING_LON) {
  const bj = utcMsToBeijing(ms);
  const { eqtime, decl } = equationOfTimeAndDecl(ms);
  // 太阳时角
  const solarTimeFix = eqtime + 4 * lon - UTC_OFFSET_MIN * 60;
  let trueSolar = bj.minuteOfDay + solarTimeFix;
  trueSolar = ((trueSolar % 1440) + 1440) % 1440;
  const ha = (trueSolar / 4 - 180) * DEG;
  const latR = lat * DEG;
  const cosZen = Math.sin(latR) * Math.sin(decl)
    + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elev = 90 - zen * RAD;
  // 方位角
  let az = Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)
  ) * RAD;
  az = (az + 180) % 360; // NOAA 约定：北起顺时针
  return { elevationDeg: elev, azimuthDeg: az, decl, eqtime };
}

// 当日日出 / 太阳中天 / 日落 / 白昼时长（北京当地分钟）
// 标准天顶角 90.833°（大气折射 34' + 太阳视半径 16'）
export function sunEvents(ms, lat = BEIJING_LAT, lon = BEIJING_LON, tzMin = UTC_OFFSET_MIN) {
  const bj = utcMsToBeijing(ms);
  // 以当日北京时间 12:00 求日参数
  const noonMs = beijingToUtcMs(bj.y, bj.m, bj.d, 720);
  const { eqtime, decl } = equationOfTimeAndDecl(noonMs);
  const latR = lat * DEG;
  const cosH0 = (Math.cos(90.833 * DEG) - Math.sin(latR) * Math.sin(decl))
    / (Math.cos(latR) * Math.cos(decl));

  const solarNoon = 720 - 4 * lon - eqtime + tzMin;
  if (cosH0 < -1) {
    // 极昼：太阳全天在地平线上
    return { polarDay: true, polarNight: false, solarNoon, sunrise: null, sunset: null, daylight: 1440, decl, eqtime };
  }
  if (cosH0 > 1) {
    // 极夜
    return { polarDay: false, polarNight: true, solarNoon, sunrise: null, sunset: null, daylight: 0, decl, eqtime };
  }
  const H0 = Math.acos(cosH0) * RAD; // 度
  return {
    polarDay: false,
    polarNight: false,
    solarNoon,
    sunrise: solarNoon - 4 * H0,
    sunset: solarNoon + 4 * H0,
    daylight: 8 * H0,
    decl,
    eqtime
  };
}

// ---------- 连续太阳黄经（USNO 近似） ----------
// 参考：https://aa.usno.navy.mil/faq/sun_approx
// n 为距 J2000（2000-01-01 12:00 UTC）的连续天数

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export function daysSinceJ2000(ms) {
  return (ms - J2000_MS) / DAY_MS;
}

export function sunLongitude(ms) {
  const n = daysSinceJ2000(ms);
  const g = (357.529 + 0.98560028 * n) * DEG;
  const q = (280.459 + 0.98564736 * n) * DEG;
  const lon = q + 1.915 * DEG * Math.sin(g) + 0.020 * DEG * Math.sin(2 * g);
  return wrap2Pi(lon);
}

// 地球指向太阳的单位方向（黄道世界坐标）
export function sunDirection(ms) {
  const l = sunLongitude(ms);
  return { x: Math.sin(l), y: 0, z: Math.cos(l) };
}
