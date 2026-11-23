/**
 * 原创数值实现。公式与常数来自物理参考（推力、耗油、μ 重力、
 * 开普勒、SOI、大气密度、阻力、降落伞、碰撞分、时间档），不是原作代码。
 */

import { HOME } from "./bodies.js";

export const G0 = 9.8;

export const IMPACT = {
  low: 2.5,
  medium: 5.5,
  high: 12.5,
  wheel: 50.5,
};

export const CHUTE = {
  maxDeployHeight: 2500,
  maxDeployVelocity: 250,
  minSpeed: 3,
  heightFrac: 0.9,
  fullFrac: 0.2,
  fullBias: 300,
  animationTime: 3,
};

/** 切线为 0 的折线：(0,0)、(1,15)、(2,250)。 */
export const CHUTE_KEYS = [
  { t: 0, y: 0 },
  { t: 1, y: 15 },
  { t: 2, y: 250 },
];

export const WARP = {
  physics: [1, 2, 3, 5],
  analytic: [1, 5, 25],
  /** Normal / Hard 的 MaxPhysicsTimewarpIndex。 */
  maxPhysicsIndex: 2,
  dtMin: 1 / 60,
  dtMax: 1 / 15,
  pausedDt: 0.1,
  maxIndex: 7,
};

export const ISP_MULTIPLIER = 1;
export const RESOURCE_MASS = 1;

export function wrapPi(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function gravityAccel(mu, x, y) {
  const r2 = x * x + y * y;
  const r = Math.sqrt(r2);
  if (r <= 1e-5) return { x: 0, y: 0, r: 0, g: 0 };
  const g = mu / r2;
  return { x: (-x / r) * g, y: (-y / r) * g, r, g };
}

/** ρ = d·[exp(−c·h/H) − exp(−c)]；h>H 或没有大气则为 0。负高度不夹断。 */
export function airDensity(body, altitude) {
  const H = body.atmosphereHeight;
  const d = body.atmosphereDensity;
  const c = body.atmosphereCurve;
  if (!H || !d || !c) return 0;
  if (altitude > H) return 0;
  return d * (Math.exp((-c * altitude) / H) - Math.exp(-c));
}

function hullOf(points) {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * 阻力面积用整船外轮廓，而不是把每块零件的矩形都加一遍
 * （叠在一起的贮箱不该重复挡风）。轮廓边仍用参考权重
 * w = dx² / (dx + |dy|)，dx≥0.01；闭合轮廓正反各算一次，再取一半。
 * 速度先变到船的局部坐标。
 */
export function effectiveArea(parts, velLocalX, velLocalY) {
  const speed = Math.hypot(velLocalX, velLocalY);
  if (speed < 1e-4) return 0;
  const vx = velLocalX / speed;
  const vy = velLocalY / speed;
  const xhx = -vy;
  const xhy = vx;
  const cloud = [];
  for (const p of parts) {
    if (p.dead) continue;
    const hw = p.halfW;
    const hh = p.halfH;
    const corners = [
      [p.localX - hw, p.localY - hh],
      [p.localX + hw, p.localY - hh],
      [p.localX + hw, p.localY + hh],
      [p.localX - hw, p.localY + hh],
    ];
    for (const [lx, ly] of corners) {
      cloud.push({ x: lx * xhx + ly * xhy, y: lx * vx + ly * vy });
    }
  }
  const hull = hullOf(cloud);
  if (hull.length < 2) return 0;
  let area = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (dx < 0) {
      dx = -dx;
      dy = -dy;
    }
    if (dx >= 0.01) area += (dx * dx) / (dx + Math.abs(dy));
  }
  return area * 0.5;
}

export function chuteCurve(state) {
  const x = clamp(state, 0, 2);
  const i = x >= 1 ? 1 : 0;
  const t0 = CHUTE_KEYS[i].t;
  const t1 = CHUTE_KEYS[i + 1].t;
  const u = (x - t0) / (t1 - t0);
  const p0 = CHUTE_KEYS[i].y;
  const p1 = CHUTE_KEYS[i + 1].y;
  const h00 = 2 * u * u * u - 3 * u * u + 1;
  const h01 = -2 * u * u * u + 3 * u * u;
  return h00 * p0 + h01 * p1;
}

/** 力的大小 S·ρ，方向逆速度。S_air = 1.5·A·|v|²，伞权重再加进去。 */
export function dragAccel(mass, area, chuteWeight, density, vx, vy) {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-5 || density <= 0 || mass <= 0) {
    return { x: 0, y: 0, sAir: 0 };
  }
  const sAir = 1.5 * area * speed * speed;
  const sTotal = sAir + chuteWeight;
  const scale = (sTotal * density) / (mass * speed);
  return { x: -vx * scale, y: -vy * scale, sAir };
}

export function thrustForce(thrustNumber, throttle) {
  return thrustNumber * G0 * Math.max(0, throttle);
}

/** q = |thrust|·throttle / (ISP·IspMultiplier)，不含 9.8。 */
export function fuelRequest(thrustNumber, throttle, isp, ispMultiplier = ISP_MULTIPLIER) {
  if (isp <= 0 || throttle <= 0) return 0;
  return (Math.abs(thrustNumber) * throttle) / (isp * ispMultiplier);
}

/**
 * 总请求 q 在本步按存量比例分摊。
 * f = min(1, q·dt / A)，各源扣除 f×存量。返回实际烧掉的量。
 */
export function consumeProportional(sources, q, dt) {
  const A = sources.reduce((s, src) => s + Math.max(0, src.amount), 0);
  if (A <= 0 || q <= 0 || dt <= 0) return 0;
  const f = Math.min(1, (q * dt) / A);
  for (const src of sources) src.amount = Math.max(0, src.amount - f * src.amount);
  return f * A;
}

export function partMass(part) {
  if (!part || part.dead) return 0;
  const fuel = Math.max(0, part.fuel || 0) * (part.resourceMass ?? RESOURCE_MASS);
  return (part.dryMass || 0) + fuel + Math.max(0, part.rcsFuel || 0);
}

export function massProps(parts) {
  let mass = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    const m = partMass(p);
    mass += m;
    cx += m * p.localX;
    cy += m * p.localY;
  }
  if (mass <= 1e-8) return { mass: 0, cx: 0, cy: 0, inertia: 0.05 };
  cx /= mass;
  cy /= mass;
  let inertia = 0;
  for (const p of parts) {
    const m = partMass(p);
    if (m <= 0) continue;
    const dx = p.localX - cx;
    const dy = p.localY - cy;
    inertia += m * (dx * dx + dy * dy);
    inertia += (m * (p.halfW * p.halfW + p.halfH * p.halfH)) / 3;
  }
  return { mass, cx, cy, inertia: Math.max(inertia, 0.02) };
}

/**
 * 分数 = (法向闭合速度 + 0.5·|v|) / 1.5。
 * 法线取地表外法向，相对速度取地面相对火箭（−v）。
 * 正面撞击时分数等于速率。严格小于阈值才算撑住。
 */
export function impactScore(vx, vy, nx, ny) {
  const speed = Math.hypot(vx, vy);
  const closing = Math.max(0, -(vx * nx + vy * ny));
  return (closing + 0.5 * speed) / 1.5;
}

export function impactBreaks(score, level) {
  const threshold = IMPACT[level] ?? IMPACT.medium;
  return score >= threshold;
}

export function chuteBlocker(input) {
  const {
    hasChute,
    target,
    atmosphereHeight,
    altitude,
    terrainAlt,
    speed,
    multiplier,
  } = input;
  if (!hasChute) return "none";
  if (target >= 2) return "open";
  const M = multiplier || 1;
  if (!atmosphereHeight) return "thin";
  if (!(altitude <= CHUTE.heightFrac * atmosphereHeight)) return "high";
  if (!(terrainAlt <= M * CHUTE.maxDeployHeight)) return "high";
  if (speed > M * CHUTE.maxDeployVelocity) return "fast";
  if (speed < CHUTE.minSpeed) return "slow";
  return null;
}

export function shouldAutoFull(target, state, terrainAlt, multiplier) {
  if (target !== 1 || state < 0.99) return false;
  const M = multiplier || 1;
  return terrainAlt < CHUTE.fullFrac * M * CHUTE.maxDeployHeight - CHUTE.fullBias;
}

export function warpGear(index, maxPhysicsIndex = WARP.maxPhysicsIndex) {
  const i = Math.max(0, Math.floor(index));
  if (i <= maxPhysicsIndex) {
    return { index: i, speed: WARP.physics[i], rails: false };
  }
  const k = i - maxPhysicsIndex;
  const speed = WARP.analytic[k % 3] * 100 ** Math.floor(k / 3);
  return { index: i, speed, rails: true };
}

/** 原创限制：有推力或伞还在张合时只能 1×；大气内只能物理档。 */
export function allowedWarpIndex(env) {
  if (env.thrusting || env.chuteBusy) return 0;
  const atmo = env.atmosphereHeight || 0;
  if (env.altitude < atmo) return WARP.maxPhysicsIndex;
  return WARP.maxIndex;
}

export function physicsStepDt(frameDt, speed) {
  if (speed <= 0) return WARP.pausedDt;
  return clamp(frameDt * speed, WARP.dtMin, WARP.dtMax);
}

function solveEccentric(M, e) {
  const m = wrapPi(M);
  if (e <= 0.8) {
    let E = m + e * Math.sin(m) + 0.5 * e * e * Math.sin(2 * m);
    for (let i = 0; i < 32; i += 1) {
      const denom = 1 - e * Math.cos(E);
      const dE = denom === 0 ? 0 : (E - e * Math.sin(E) - m) / denom;
      E -= dE;
      if (Math.abs(dE) <= 1e-7) break;
    }
    return E;
  }
  const sign = Math.sin(m) === 0 ? (m >= 0 ? 1 : -1) : Math.sign(Math.sin(m));
  let E = m + 0.85 * e * sign;
  for (let i = 0; i < 50; i += 1) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const fpp = e * Math.sin(E);
    const disc = 16 * fp * fp - 20 * f * fpp;
    const root = Math.sqrt(Math.abs(disc));
    const denom = fp + Math.sign(fp || 1) * root;
    if (denom === 0) break;
    E -= (5 * f) / denom;
  }
  return E;
}

function solveHyperbolic(M, e) {
  let H = Math.asinh(M / Math.max(e, 1));
  if (Math.abs(M) > 1) {
    H = Math.sign(M || 1) * Math.log((2 * Math.abs(M)) / e + 2);
  }
  for (let i = 0; i < 40; i += 1) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    if (fp === 0) break;
    const dH = f / fp;
    H -= dH;
    if (Math.abs(dH) <= 1e-7) break;
  }
  return H;
}

export function orbitalElements(x, y, vx, vy, mu) {
  const r = Math.hypot(x, y);
  if (r < 1e-4 || mu <= 0) return null;
  const v2 = vx * vx + vy * vy;
  const h = x * vy - y * vx;
  const energy = v2 * 0.5 - mu / r;
  let ex = (vy * h) / mu - x / r;
  let ey = (-vx * h) / mu - y / r;
  let e = Math.hypot(ex, ey);
  if (e < 1e-10) {
    ex = x / r;
    ey = y / r;
    e = 0;
  }
  const a = Math.abs(energy) < 1e-16 ? Infinity : -mu / (2 * energy);
  const direction = h >= 0 ? 1 : -1;
  let cosNu = 1;
  let sinNu = 0;
  if (e >= 1e-10) {
    cosNu = clamp((ex * x + ey * y) / (e * r), -1, 1);
    sinNu = clamp((direction * (ex * y - ey * x)) / (e * r), -1, 1);
  }
  const nu = Math.atan2(sinNu, cosNu);
  let M = 0;
  let n = 0;
  if (Number.isFinite(a) && e < 1) {
    const E = Math.atan2(Math.sqrt(Math.max(0, 1 - e * e)) * sinNu, e + cosNu);
    M = E - e * Math.sin(E);
    n = Math.sqrt(mu / (a * a * a));
  } else if (Number.isFinite(a) && e >= 1) {
    const absA = Math.abs(a);
    const denom = 1 + e * cosNu;
    const coshH = denom === 0 ? 1 : (e + cosNu) / denom;
    let H = Math.acosh(clamp(coshH, 1, 1e8));
    if (nu < 0) H = -H;
    M = e * Math.sinh(H) - H;
    n = Math.sqrt(mu / (absA ** 3));
  }
  return { a, e, energy, h, nu, M, n, ex, ey, direction, mu, r };
}

function placeOnOrbit(el, dt) {
  const e = el.e;
  const direction = el.direction || 1;
  const M1 = el.M + direction * el.n * dt;
  const enorm = Math.hypot(el.ex, el.ey) || 1;
  const px = el.ex / enorm;
  const py = el.ey / enorm;
  const qx = -py * direction;
  const qy = px * direction;
  if (e < 1 && Number.isFinite(el.a)) {
    const ee = Math.min(e, 0.999999999);
    const E = solveEccentric(M1, ee);
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const denom = 1 - ee * cosE || 1e-12;
    const r = el.a * (1 - ee * cosE);
    const cosNu = (cosE - ee) / denom;
    const sinNu = (Math.sqrt(Math.max(0, 1 - ee * ee)) * sinE) / denom;
    const p = el.a * (1 - ee * ee);
    const vScale = Math.sqrt(el.mu / Math.max(p, 1e-8));
    return {
      x: r * (cosNu * px + sinNu * qx),
      y: r * (cosNu * py + sinNu * qy),
      vx: vScale * (-sinNu * px + (ee + cosNu) * qx),
      vy: vScale * (-sinNu * py + (ee + cosNu) * qy),
    };
  }
  const absA = Math.abs(el.a);
  const H = solveHyperbolic(M1, Math.max(e, 1));
  const ch = Math.cosh(H);
  const sh = Math.sinh(H);
  const denom = e * ch - 1 || 1e-12;
  const r = absA * denom;
  const cosNu = (e - ch) / denom;
  const sinNu = (Math.sqrt(Math.max(0, e * e - 1)) * sh) / denom;
  const p = absA * (e * e - 1);
  const vScale = Math.sqrt(el.mu / Math.max(p, 1e-8));
  return {
    x: r * (cosNu * px + sinNu * qx),
    y: r * (cosNu * py + sinNu * qy),
    vx: vScale * (-sinNu * px + (e + cosNu) * qx),
    vy: vScale * (-sinNu * py + (e + cosNu) * qy),
  };
}

/** 解析推进。径向坠落或抛物线退化时返回 null，调用方改走数值步。 */
export function keplerAdvance(x, y, vx, vy, mu, dt) {
  const el = orbitalElements(x, y, vx, vy, mu);
  if (!el || !Number.isFinite(el.a) || el.n === 0) return null;
  if (Math.abs(el.h) < 1e-3) return null;
  return placeOnOrbit(el, dt);
}

export function specificEnergy(x, y, vx, vy, mu) {
  const r = Math.hypot(x, y);
  return (vx * vx + vy * vy) * 0.5 - mu / r;
}

export function specificAngularMomentum(x, y, vx, vy) {
  return x * vy - y * vx;
}

export function periApo(el, bodyRadius) {
  if (!el || !Number.isFinite(el.a)) {
    return { peri: Infinity, apo: Infinity, periAlt: Infinity, apoAlt: Infinity };
  }
  if (el.e < 1) {
    const peri = el.a * (1 - el.e);
    const apo = el.a * (1 + el.e);
    return { peri, apo, periAlt: peri - bodyRadius, apoAlt: apo - bodyRadius };
  }
  const absA = Math.abs(el.a);
  const peri = absA * (el.e - 1);
  return { peri, apo: Infinity, periAlt: peri - bodyRadius, apoAlt: Infinity };
}

export function timeToTrueAnomaly(el, targetNu) {
  if (!el || el.e >= 1 || !el.n) return Infinity;
  const E = Math.atan2(
    Math.sqrt(Math.max(0, 1 - el.e * el.e)) * Math.sin(targetNu),
    el.e + Math.cos(targetNu),
  );
  const targetM = E - el.e * Math.sin(E);
  let d = wrapPi(targetM - wrapPi(el.M));
  if (d < 0) d += Math.PI * 2;
  return d / el.n;
}

export const HOME_MU = HOME.mu;
