// scene.js — Three.js 场景：太阳 / 地球（倾斜·自转·北京）/ 月球（椭圆轨道·同步自转）
// 负责：层级、材质、相机过渡、三种构图、北京锁定、拾取、DOM 标签、资源降级与清理。
// 科学坐标约定见 solar.js / moon.js 顶部注释。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  sunDirection, equationOfTimeAndDecl, BEIJING_LAT, BEIJING_LON
} from './solar.js';
import { moonPosition, EARTH_RADIUS_KM } from './moon.js';

const DEG = Math.PI / 180;
const AXIAL_TILT = 23.44 * DEG;

// 教学场景尺寸（非真实比例）
const EARTH_R = 1.68;
const SUN_R = 2.35;
const EARTH_ORBIT_R = 8.8;
const MOON_R = EARTH_R * 0.2724;
const MOON_DISPLAY_MEAN = 5.2;
const MOON_MEAN_KM = 60.2666 * EARTH_RADIUS_KM;

const MODES = ['overview', 'earth', 'moon'];

// ---------- 程序化资源 ----------

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,225,170,0.9)');
  g.addColorStop(0.18, 'rgba(255,190,105,0.6)');
  g.addColorStop(0.45, 'rgba(255,150,60,0.16)');
  g.addColorStop(1, 'rgba(255,130,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
  g.addColorStop(0, '#ffe9b8');
  g.addColorStop(0.55, '#ffc86b');
  g.addColorStop(0.9, '#ff9d3c');
  g.addColorStop(1, '#ff8d33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // 少量表面颗粒
  for (let k = 0; k < 260; k++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = Math.random() * 22 + 4;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(255,${180 + Math.random() * 60 | 0},90,0.10)`);
    gg.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeStars() {
  const N = 3600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tmp = new THREE.Color();
  for (let k = 0; k < N; k++) {
    // 均匀球面
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 300 + Math.random() * 260;
    const s = Math.sqrt(1 - u * u);
    pos[k * 3] = r * s * Math.cos(th);
    pos[k * 3 + 1] = r * u;
    pos[k * 3 + 2] = r * s * Math.sin(th);
    const roll = Math.random();
    if (roll < 0.62) tmp.setRGB(0.9 + Math.random() * 0.1, 0.92 + Math.random() * 0.08, 1.0);
    else if (roll < 0.82) tmp.setRGB(1.0, 0.93 + Math.random() * 0.07, 0.78 + Math.random() * 0.12);
    else tmp.setRGB(0.78 + Math.random() * 0.15, 0.86 + Math.random() * 0.1, 1.0);
    tmp.multiplyScalar(0.55 + Math.random() * 0.55);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.15, sizeAttenuation: true, vertexColors: true,
    depthWrite: false, transparent: true, opacity: 0.95
  });
  return new THREE.Points(geo, mat);
}

// 大气 Fresnel 轮廓
function makeAtmosphere(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x64c5ed) } },
    vertexShader: `
      varying vec3 vN;
      void main() {
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vN;
      void main() {
        float i = pow(0.68 - dot(vN, vec3(0.0, 0.0, 1.0)), 2.4);
        gl_FragColor = vec4(uColor, 1.0) * i;
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.22, 64, 48), mat);
}

// ---------- 场景工厂 ----------

export async function createObservatory(container, callbacks = {}) {
  const reducedMotion = () => callbacks.reducedMotion?.() ?? false;
  const bootProgress = (p) => callbacks.onBootProgress?.(p);

  // 标签在后台/未合成时 getContext 可能返回 null，变为可见后才可用。
  // 因此：可见性事件立即重试 + 定时重试，窗口约 20 秒；每次失败都释放上下文。
  let renderer = null;
  let lastErr = null;
  const loseGl = (gl) => {
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (_) { /* ignore */ }
  };
  const waitSignal = (ms) => new Promise((res) => {
    const t = setTimeout(res, ms);
    const go = () => { clearTimeout(t); res(); };
    document.addEventListener('visibilitychange', go, { once: true });
    window.addEventListener('focus', go, { once: true });
  });
  bootProgress({
    percent: 4, stage: '初始化 3D 引擎',
    message: '正在初始化 3D 渲染引擎…'
  });
  for (let attempt = 0; attempt < 32; attempt++) {
    bootProgress({
      percent: Math.min(16, 4 + attempt * 0.5), stage: '初始化 3D 引擎',
      message: attempt === 0
        ? '正在初始化 3D 渲染引擎…'
        : `3D 引擎启动中（第 ${attempt + 1} 次尝试）…`
    });
    const probe = document.createElement('canvas');
    let pgl = null;
    try {
      pgl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
        || probe.getContext('webgl', { failIfMajorPerformanceCaveat: false });
    } catch (e) { pgl = null; }
    if (pgl) {
      loseGl(pgl);
      try {
        const attrs = { antialias: true, powerPreference: 'high-performance' };
        if (attempt >= 8) delete attrs.powerPreference;
        renderer = new THREE.WebGLRenderer(attrs);
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[WebGL] 第 ${attempt + 1} 次创建渲染器失败：`, err);
        try { renderer?.forceContextLoss(); renderer?.dispose(); } catch (_) { /* ignore */ }
        renderer = null;
      }
    } else {
      lastErr = new Error('GPU 尚未就绪（页面可能仍在后台）');
    }
    await waitSignal(500);
  }
  if (!renderer) {
    callbacks.onWebglError?.(lastErr);
    return null;
  }
  bootProgress({
    percent: 20, stage: '初始化 3D 引擎',
    message: '3D 渲染引擎就绪。'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x081525);

  const camera = new THREE.PerspectiveCamera(
    40, container.clientWidth / container.clientHeight, 0.05, 2000
  );
  camera.position.set(-6, 7, 18);
  camera.layers.enable(1); // 月球在第 1 层（点光源层）

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(-3, 0, 0);

  // 太阳光照：
  // - 地球用平行光（真实阳光为平行光）：N·L=0 的明暗分界平面恰好过地心，
  //   与金色晨昏线环（过地心、垂直太阳方向）严格重合。
  // - 月球场景的距离经过压缩，用位于太阳（原点）的点光源，让月球亮面朝向
  //   画面中可见的太阳；两者通过 layers 互不影响。
  const sunLight = new THREE.PointLight(0xfff2dd, 2.7, 0, 0);
  sunLight.position.set(0, 0, 0);
  sunLight.layers.set(1);
  scene.add(sunLight);

  const dirLight = new THREE.DirectionalLight(0xfff2dd, 2.7);
  scene.add(dirLight);
  scene.add(dirLight.target);

  const ambient = new THREE.AmbientLight(0x93aac4, 0.16);
  ambient.layers.enable(1);
  scene.add(ambient);

  // 星空
  const stars = makeStars();
  scene.add(stars);

  // ---------- 太阳 ----------
  const sunGroup = new THREE.Group();
  const sunTex = makeSunTexture();
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_R, 64, 48),
    new THREE.MeshBasicMaterial({ map: sunTex })
  );
  sunGroup.add(sunMesh);
  const glowTex = makeGlowTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc988, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  glow.scale.setScalar(SUN_R * 4.6);
  sunGroup.add(glow);
  const glow2 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffa050, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  glow2.scale.setScalar(SUN_R * 8.4);
  sunGroup.add(glow2);
  scene.add(sunGroup);

  // ---------- 地球年轨 ----------
  const yearOrbitPts = [];
  for (let k = 0; k < 256; k++) {
    const a = k / 256 * Math.PI * 2;
    yearOrbitPts.push(new THREE.Vector3(Math.cos(a) * EARTH_ORBIT_R, 0, Math.sin(a) * EARTH_ORBIT_R));
  }
  const yearOrbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(yearOrbitPts),
    new THREE.LineBasicMaterial({ color: 0x2c4d68, transparent: true, opacity: 0.75 })
  );
  yearOrbit.rotation.x = Math.PI / 2;
  scene.add(yearOrbit);

  // ---------- 地球锚点（公转位置，只平移） ----------
  const earthAnchor = new THREE.Group();
  scene.add(earthAnchor);

  // 大气（不随地表自转）
  const atmosphere = makeAtmosphere(EARTH_R);
  earthAnchor.add(atmosphere);

  // 金色晨昏线：位于垂直太阳方向、过地心的平面（earthAnchor 子节点，不随地表自转）
  const terminator = new THREE.Mesh(
    new THREE.TorusGeometry(EARTH_R * 1.008, EARTH_R * 0.006, 8, 220),
    new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.95 })
  );
  earthAnchor.add(terminator);

  // 地轴（在倾斜节点下，穿过南北两极）
  const axisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -EARTH_R * 1.75, 0),
    new THREE.Vector3(0, EARTH_R * 1.75, 0)
  ]);
  const earthTilt = new THREE.Group();
  earthTilt.rotation.z = -AXIAL_TILT; // 轴向 (sin ε, cos ε, 0)
  earthAnchor.add(earthTilt);
  const axisLine = new THREE.Line(
    axisGeo,
    new THREE.LineBasicMaterial({ color: 0xc7d8e6, transparent: true, opacity: 0.8 })
  );
  earthTilt.add(axisLine);

  // 赤道（垂直地轴，随倾斜，不随地表自转；略大于地表避免穿插闪烁）
  const equatorPts = [];
  for (let k = 0; k < 160; k++) {
    const a = (k / 160) * Math.PI * 2;
    equatorPts.push(new THREE.Vector3(
      Math.cos(a) * EARTH_R * 1.006, 0, Math.sin(a) * EARTH_R * 1.006
    ));
  }
  const equatorLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(equatorPts),
    new THREE.LineBasicMaterial({ color: 0x64c5ed, transparent: true, opacity: 0.75 })
  );
  earthTilt.add(equatorLine);

  // 地表自转节点
  const earthSpin = new THREE.Group();
  earthTilt.add(earthSpin);

  const earthMat = new THREE.MeshStandardMaterial({
    color: 0x2b4f6e, // 贴图失败时的基础色
    roughness: 0.82,
    metalness: 0.0
  });
  const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R, 96, 64), earthMat
  );
  earthSpin.add(earthMesh);

  // 北京标记（随地表自转）
  const bjPhi = BEIJING_LAT * DEG;
  const bjLon = BEIJING_LON * DEG;
  const bjSurface = new THREE.Vector3(
    Math.cos(bjPhi) * Math.cos(bjLon),
    Math.sin(bjPhi),
    -Math.cos(bjPhi) * Math.sin(bjLon)
  );
  const beijingGroup = new THREE.Group();
  beijingGroup.position.copy(bjSurface).multiplyScalar(EARTH_R * 1.004);
  beijingGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bjSurface);
  const bjRing = new THREE.Mesh(
    new THREE.RingGeometry(EARTH_R * 0.034, EARTH_R * 0.05, 28),
    new THREE.MeshBasicMaterial({ color: 0xf7c779, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
  );
  const bjDot = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R * 0.02, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe3ad })
  );
  bjDot.position.z = EARTH_R * 0.012;
  beijingGroup.add(bjRing, bjDot);
  earthSpin.add(beijingGroup);

  // ---------- 月球（挂在 earthAnchor 下，不继承自转/倾斜） ----------
  const moonAnchor = new THREE.Group();
  earthAnchor.add(moonAnchor);
  const moonSpin = new THREE.Group();
  moonAnchor.add(moonSpin);
  const moonMat = new THREE.MeshStandardMaterial({
    color: 0xb9b7b0,
    roughness: 0.96,
    metalness: 0.0
  });
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_R, 64, 48), moonMat
  );
  moonSpin.add(moonMesh);
  moonMesh.layers.set(1); // 只由位于太阳的点光源照亮，亮面朝向可见太阳

  // 月球参考轨迹（采样未来 27.32 天，缓存，不每帧重建）
  let trajAnchorMs = null;
  let moonTraj = null;
  function rebuildTrajectory(ms) {
    if (moonTraj) {
      moonTraj.geometry.dispose();
      earthAnchor.remove(moonTraj);
    }
    const pts = [];
    const N = 120;
    for (let k = 0; k <= N; k++) {
      const t = ms + (k / N) * 27.32 * 86400000;
      const mp = moonPosition(t);
      const d = new THREE.Vector3(
        Math.sin(mp.lon) * Math.cos(mp.lat),
        Math.sin(mp.lat),
        Math.cos(mp.lon) * Math.cos(mp.lat)
      );
      d.multiplyScalar(MOON_DISPLAY_MEAN * (mp.distanceKm / MOON_MEAN_KM));
      pts.push(d);
    }
    moonTraj = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x7798b4, transparent: true, opacity: 0.6 })
    );
    earthAnchor.add(moonTraj);
    moonTraj.visible = orbitVisible && mode !== 'earth';
    trajAnchorMs = ms;
  }

  // 太阳方向箭头（地月系统）：指向太阳（+sunDir），月球亮面应与箭头同向
  const sunArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 4.6,
    0xf7c779, 0.55, 0.32
  );
  sunArrow.visible = false;
  earthAnchor.add(sunArrow);

  // ---------- DOM 标签 ----------
  const labelLayer = callbacks.labelLayer;
  const makeLabel = (text, cls) => {
    const el = document.createElement('div');
    el.className = `body-label ${cls}`;
    el.textContent = text;
    labelLayer.appendChild(el);
    return el;
  };
  const labels = {
    sun: makeLabel('太阳', 'label-sun'),
    earth: makeLabel('地球', 'label-earth'),
    moon: makeLabel('月球', 'label-moon'),
    beijing: makeLabel('北京', 'label-beijing')
  };

  // ---------- 状态 ----------
  let mode = 'overview';
  let locked = false;
  let orbitVisible = true;
  let tween = null;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpDelta = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  let viewOffsetReserve = 0;
  let prevEarthPosReady = false;

  // ---------- 相机构图 ----------

  function getPose(forMode, ms) {
    const earthPos = tmpV2.copy(earthAnchor.position);
    if (forMode === 'earth') {
      const sd = new THREE.Vector3().copy(lastSunDir);
      const dir = sd.multiplyScalar(0.72).add(new THREE.Vector3(0, 0.62, 0.42)).normalize();
      return {
        target: earthPos.clone(),
        pos: earthPos.clone().add(dir.multiplyScalar(5.9))
      };
    }
    if (forMode === 'moon') {
      const sd = new THREE.Vector3().copy(lastSunDir);
      const aspect = container.clientWidth / container.clientHeight;
      if (aspect < 1) {
        // 竖屏：拉远以容纳整个月球轨道
        const dir = new THREE.Vector3(0, 0.26, 0.97).normalize();
        return {
          target: earthPos.clone(),
          pos: earthPos.clone().add(dir.multiplyScalar(24))
        };
      }
      const dir = sd.multiplyScalar(0.5).add(new THREE.Vector3(0, 0.72, 0.45)).normalize();
      return {
        target: earthPos.clone(),
        pos: earthPos.clone().add(dir.multiplyScalar(17.6))
      };
    }
    // 全景：目标在太阳与地球之间，偏向地球；竖屏需要拉远并抬高
    const aspect = container.clientWidth / container.clientHeight;
    if (aspect < 1) {
      // 竖屏：太阳—地球连线沿竖直方向展开，相机从侧向观察
      const target = earthPos.clone().multiplyScalar(0.5);
      const pos = target.clone().add(new THREE.Vector3(15.5, 9.5, 1.4));
      return { target, pos };
    }
    const target = earthPos.clone().multiplyScalar(0.5);
    const pos = target.clone().add(new THREE.Vector3(-2.4, 6.0, 16.6));
    return { target, pos };
  }

  const lastSunDir = new THREE.Vector3(1, 0, 0);

  function transitionTo(pose) {
    const dur = reducedMotion() ? 0.01 : 0.4;
    tween = {
      fromPos: camera.position.clone(),
      toPos: pose.pos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: pose.target.clone(),
      t: 0,
      dur
    };
  }

  function applyFov() {
    const aspect = container.clientWidth / container.clientHeight;
    let fov = 40;
    if (aspect < 1) fov = mode === 'overview' ? 60 : 48;
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function applyModeLimits() {
    if (mode === 'overview') {
      controls.minDistance = 6; controls.maxDistance = 70;
    } else if (mode === 'earth') {
      controls.minDistance = 2.4; controls.maxDistance = 20;
    } else {
      controls.minDistance = 4; controls.maxDistance = 45;
    }
  }

  function applyVisibility() {
    sunGroup.visible = mode === 'overview';
    yearOrbit.visible = mode === 'overview';
    axisLine.visible = true;
    equatorLine.visible = true;
    moonAnchor.visible = mode !== 'earth';
    moonTraj && (moonTraj.visible = orbitVisible && mode !== 'earth');
    sunArrow.visible = mode === 'moon';
    terminator.visible = mode !== 'moon';
    labels.sun.style.display = mode === 'earth' ? 'none' : '';
  }

  // ---------- 每帧更新 ----------

  function update(ms, dt) {
    // 太阳方向（连续）
    const sd = sunDirection(ms);
    lastSunDir.set(sd.x, sd.y, sd.z);

    // 地球公转位置：地球在太阳反向
    const prevEarthX = earthAnchor.position.x;
    const prevEarthZ = earthAnchor.position.z;
    earthAnchor.position.set(-EARTH_ORBIT_R * sd.x, 0, -EARTH_ORBIT_R * sd.z);

    // 近景/地月模式：相机整体跟随地球公转平移，保证地球始终居中
    // （月球公转播放跨越数周，地球沿年轨道移动，否则焦点会持续偏移）
    if (mode !== 'overview' && !locked && prevEarthPosReady) {
      tmpDelta.set(
        earthAnchor.position.x - prevEarthX,
        0,
        earthAnchor.position.z - prevEarthZ
      );
      if (tween) {
        tween.toPos.add(tmpDelta);
        tween.toTarget.add(tmpDelta);
      } else {
        camera.position.add(tmpDelta);
        controls.target.add(tmpDelta);
      }
    }
    prevEarthPosReady = true;

    // 平行光：目标地心，方向沿太阳方向（光线从太阳照来）
    dirLight.target.position.copy(earthAnchor.position);
    dirLight.position.copy(earthAnchor.position)
      .add(new THREE.Vector3(sd.x, sd.y, sd.z).multiplyScalar(14));

    // 地球自转（教学公式，见开发指导 7.2）
    const { eqtime } = equationOfTimeAndDecl(ms);
    const bj = new Date(ms + 480 * 60000);
    const bjMinute = (bj.getUTCHours() * 60 + bj.getUTCMinutes()
      + bj.getUTCSeconds() / 60 + bj.getUTCMilliseconds() / 60000);
    // sunAngle：太阳方向在倾斜局部系中的方位
    const tiltInv = earthTilt.quaternion.clone().invert();
    const sLocal = new THREE.Vector3(sd.x, sd.y, sd.z).applyQuaternion(tiltInv);
    const sunAngle = Math.atan2(sLocal.z, sLocal.x);
    const trueSolarMinutes = bjMinute + eqtime + 4 * BEIJING_LON - 480;
    const H = (trueSolarMinutes / 4 - 180) * DEG;
    earthSpin.rotation.y = -bjLon - sunAngle + H;

    // 月球
    const mp = moonPosition(ms);
    const mdir = new THREE.Vector3(
      Math.sin(mp.lon) * Math.cos(mp.lat),
      Math.sin(mp.lat),
      Math.cos(mp.lon) * Math.cos(mp.lat)
    );
    const displayR = MOON_DISPLAY_MEAN * (mp.distanceKm / MOON_MEAN_KM);
    moonAnchor.position.copy(mdir).multiplyScalar(displayR);
    // 平均运动近似同步自转（近侧朝向地球）
    moonSpin.rotation.y = mp.meanLonRad + Math.PI / 2;

    // 晨昏线：法线 = 太阳方向
    terminator.quaternion.setFromUnitVectors(zAxis, tmpV.set(sd.x, sd.y, sd.z));

    // 太阳箭头：指向太阳
    sunArrow.setDirection(tmpV2.set(sd.x, sd.y, sd.z));

    // 轨迹缓存：漂移超过 0.3 天重建
    if (trajAnchorMs === null || Math.abs(ms - trajAnchorMs) > 0.3 * 86400000) {
      rebuildTrajectory(ms);
    }

    // 太阳光晕微幅呼吸
    if (!reducedMotion()) {
      const p = 1 + 0.025 * Math.sin(performance.now() * 0.0011);
      glow.scale.setScalar(SUN_R * 4.6 * p);
    }

    // 相机过渡 / 北京锁定
    updateCamera(ms, dt);

    controls.update();
    updateLabels();
    renderer.render(scene, camera);

    // 调试/验收钩子：渲染后立即复制真实帧（不依赖页面合成器）
    if (frameGrab) {
      try {
        const c2 = document.createElement('canvas');
        c2.width = renderer.domElement.width;
        c2.height = renderer.domElement.height;
        c2.getContext('2d').drawImage(renderer.domElement, 0, 0);
        frameGrab(c2.toDataURL('image/png'));
      } catch (e) { frameGrab('error:' + String(e)); }
      frameGrab = null;
    }
  }

  let frameGrab = null;
  if (typeof window !== 'undefined') {
    window.__grabFrame = () => new Promise((res) => { frameGrab = res; });
  }

  function lockPose() {
    beijingGroup.getWorldPosition(tmpV);
    const q = new THREE.Quaternion();
    beijingGroup.getWorldQuaternion(q);
    const normal = tmpV2.set(0, 0, 1).applyQuaternion(q);
    const dist = camera.position.distanceTo(tmpV);
    const d = Math.max(EARTH_R * 1.5, Math.min(dist, 12));
    return {
      target: tmpV.clone(),
      pos: tmpV.clone().add(normal.clone().multiplyScalar(d))
    };
  }

  function updateCamera(ms, dt) {
    if (locked) {
      const pose = lockPose();
      if (tween) {
        tween.t += dt;
        const k = Math.min(1, tween.t / tween.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(tween.fromPos, pose.pos, e);
        controls.target.lerpVectors(tween.fromTarget, pose.target, e);
        if (k >= 1) tween = null;
      } else {
        camera.position.copy(pose.pos);
        controls.target.copy(pose.target);
      }
      return;
    }
    if (tween) {
      tween.t += dt;
      const k = Math.min(1, tween.t / tween.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
      if (k >= 1) tween = null;
    }
  }

  // ---------- 标签 ----------

  function projectWorld(obj) {
    obj.getWorldPosition(tmpV);
    tmpV.project(camera);
    return tmpV;
  }

  function updateLabels() {
    const w = container.clientWidth;
    const h = container.clientHeight;

    const place = (el, worldObj, pad = 14) => {
      worldObj.getWorldPosition(tmpV);
      const ndc = tmpV.clone().project(camera);
      if (ndc.z > 1) { el.style.display = 'none'; return; }
      let x = (ndc.x * 0.5 + 0.5) * w;
      let y = (-ndc.y * 0.5 + 0.5) * h;
      x = Math.max(pad, Math.min(w - pad, x));
      y = Math.max(pad, Math.min(h - pad, y));
      el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
    };

    if (mode === 'overview') {
      place(labels.sun, sunMesh);
      labels.sun.style.display = '';
    } else if (mode === 'moon') {
      // 太阳标签放在箭头尖端：地心 + sunDir×箭头长度
      tmpV.copy(earthAnchor.position)
        .add(tmpV2.copy(lastSunDir).multiplyScalar(4.6));
      const ndc = tmpV.clone().project(camera);
      let x = (ndc.x * 0.5 + 0.5) * w;
      let y = (-ndc.y * 0.5 + 0.5) * h;
      x = Math.max(20, Math.min(w - 20, x));
      y = Math.max(20, Math.min(h - 20, y));
      labels.sun.style.transform =
        `translate(-50%,-50%) translate(${x}px,${y}px)`;
      labels.sun.style.display = '';
    }
    place(labels.earth, earthMesh);
    labels.earth.style.display = '';

    // 北京：仅近景显示标签；背面隐藏
    if (mode === 'earth') {
      beijingGroup.getWorldPosition(tmpV);
      const normal = tmpV2.set(0, 0, 1).applyQuaternion(
        beijingGroup.getWorldQuaternion(new THREE.Quaternion())
      );
      const toCam = camera.position.clone().sub(tmpV).normalize();
      if (normal.dot(toCam) > 0.12) {
        const ndc = tmpV.clone().project(camera);
        const x = (ndc.x * 0.5 + 0.5) * w;
        const y = (-ndc.y * 0.5 + 0.5) * h;
        labels.beijing.style.transform =
          `translate(-50%,-50%) translate(${Math.max(20, Math.min(w - 20, x))}px,${Math.max(20, Math.min(h - 20, y)) - 26}px)`;
        labels.beijing.style.display = '';
      } else labels.beijing.style.display = 'none';
    } else labels.beijing.style.display = 'none';

    // 月球：地球遮挡时隐藏
    if (mode !== 'earth') {
      moonMesh.getWorldPosition(tmpV);
      const moonPoint = tmpV.clone();
      const occluded = isOccludedByEarth(moonPoint);
      if (occluded) labels.moon.style.display = 'none';
      else {
        place(labels.moon, moonMesh);
        labels.moon.style.display = '';
      }
    } else labels.moon.style.display = 'none';
  }

  function isOccludedByEarth(point) {
    const camPos = camera.position;
    const earthCenter = earthAnchor.position;
    const dir = point.clone().sub(camPos);
    const t = earthCenter.clone().sub(camPos).dot(dir) / dir.lengthSq();
    if (t < 0 || t > 1) return false;
    const closest = camPos.clone().add(dir.multiplyScalar(t));
    return closest.distanceTo(earthCenter) < EARTH_R * 1.02;
  }

  // ---------- 拾取 ----------

  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const candidates = [];
    if (earthMesh.visible) candidates.push(earthMesh);
    if (moonMesh.visible && mode !== 'earth') candidates.push(moonMesh);
    const hits = raycaster.intersectObjects(candidates, false);
    if (!hits.length) return null;
    const obj = hits[0].object;
    if (obj === earthMesh) return 'earth';
    if (obj === moonMesh) return 'moon';
    return null;
  }

  // ---------- 贴图加载（失败降级） ----------

  // 贴图加载：fetch 流式读取以获得真实字节进度（TextureLoader 走 Image
  // 元素，没有进度事件）；读完转 blob URL 交给 TextureLoader 解码。
  const loader = new THREE.TextureLoader();
  function applyTexture(tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }
  async function fetchTexture(url, material, name, pctStart, pctEnd, stage) {
    let blobUrl = null;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        const ratio = total
          ? loaded / total
          : Math.min(0.95, loaded / (name === '地球贴图' ? 900000 : 700000));
        bootProgress({
          percent: pctStart + ratio * (pctEnd - pctStart), stage,
          message: `正在加载${name}（NASA）… ${Math.round(ratio * 100)}%`
        });
      }
      const blob = new Blob(chunks, {
        type: res.headers.get('content-type') || 'image/jpeg'
      });
      blobUrl = URL.createObjectURL(blob);
      const tex = await new Promise((resolve, reject) =>
        loader.load(blobUrl, resolve, undefined, reject));
      applyTexture(tex);
      material.map = tex;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      return { ok: true };
    } catch (err) {
      console.warn(`[texture] ${name}加载失败：`, err);
      callbacks.onTextureError?.(name);
      return { ok: false };
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }
  // 顺序加载：阶段文字不交替；任一失败仍继续（降级基础材质）
  const texturesReady = (async () => [
    await fetchTexture('earth-map.jpg', earthMat, '地球贴图', 22, 55, '加载地球表面贴图'),
    await fetchTexture('moon-map.jpg', moonMat, '月球贴图', 55, 90, '加载月球表面贴图')
  ])();

  // ---------- 缩放 / 尺寸 ----------

  function dolly(factor) {
    const dir = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(
      dir.length() * factor, controls.minDistance, controls.maxDistance
    );
    camera.position.copy(controls.target).add(dir.setLength(len));
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    applyFov();
    applyViewOffset(w, h);
    camera.updateProjectionMatrix();
  }

  function applyViewOffset(w, h) {
    if (viewOffsetReserve > 0 && !locked && mode !== 'earth') {
      // 投影偏移避让右侧 HUD：物体向左移
      camera.setViewOffset(w, h, viewOffsetReserve, 0, w, h);
    } else {
      camera.clearViewOffset();
    }
  }

  function setHudReserve(px) {
    viewOffsetReserve = px;
    resize();
  }

  // ---------- 清理 ----------

  function dispose() {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    sunTex.dispose(); glowTex.dispose();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    Object.values(labels).forEach((el) => el.remove());
  }

  // ---------- 公开 API ----------

  return {
    update,
    resize,
    dispose,
    pick,
    texturesReady,
    domElement: renderer.domElement,
    setMode(nextMode, ms, { immediate = false } = {}) {
      if (!MODES.includes(nextMode)) return;
      mode = nextMode;
      applyFov();
      applyModeLimits();
      applyVisibility();
      const pose = getPose(mode, ms);
      if (immediate) {
        tween = null;
        camera.position.copy(pose.pos);
        controls.target.copy(pose.target);
      } else transitionTo(pose);
      applyViewOffset(container.clientWidth, container.clientHeight);
    },
    getMode: () => mode,
    setLock(on, ms) {
      locked = on;
      controls.enableRotate = !on;
      controls.enablePan = !on;
      controls.enableDamping = !on; // 清除会抵消锁定的阻尼
      if (on) {
        const pose = lockPose();
        transitionTo(pose);
      } else {
        tween = null;
        const pose = getPose('earth', ms);
        transitionTo(pose);
      }
    },
    isLocked: () => locked,
    setOrbitVisible(on) {
      orbitVisible = on;
      if (moonTraj) moonTraj.visible = on && mode !== 'earth';
    },
    zoomIn: () => dolly(0.8),
    zoomOut: () => dolly(1.25),
    resetCamera(ms) {
      tween = null;
      if (locked) {
        const pose = lockPose();
        camera.position.copy(pose.pos);
        controls.target.copy(pose.target);
      } else {
        const pose = getPose(mode, ms);
        transitionTo(pose);
      }
    },
    setHudReserve,
    earthPosition: () => earthAnchor.position,
    getCamera: () => camera,
    getControls: () => controls
  };
}
