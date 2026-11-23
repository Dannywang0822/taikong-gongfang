/**
 * 三体拼贴轨道用的天体。
 *
 * 半径、表面重力、大气三参数、降落伞倍率、timewarp_height、SOI 倍率
 * 采用参考表里地球、月球、太阳的序列化值。
 * 中文名、轨道半长轴、发射台位置、地表噪声是原创：参考表没有半长轴。
 * μ = g·R²。SOI = a·(μ/μ_parent)^0.4·multiplier。无父体则 SOI 为无穷。
 */

export const HOME_ID = "qingya";
export const MOON_ID = "yinye";
export const SUN_ID = "hengxing";

function muOf(gravity, radius) {
  return gravity * radius * radius;
}

export const SUN = {
  id: SUN_ID,
  name: "恒星",
  parentId: null,
  radius: 34817000,
  gravity: 247,
  atmosphereHeight: 300000,
  atmosphereDensity: 0.005,
  atmosphereCurve: 13,
  parachuteMultiplier: 1,
  timewarpHeight: 500000,
  multiplierSoi: null,
  sma: null,
  terrainAmp: 0,
  padAngle: 0,
  padHalf: 0.01,
};

export const HOME = {
  id: HOME_ID,
  name: "青芽",
  parentId: SUN_ID,
  radius: 314970,
  gravity: 9.8,
  atmosphereHeight: 30000,
  atmosphereDensity: 0.005,
  atmosphereCurve: 10,
  parachuteMultiplier: 1,
  timewarpHeight: 25000,
  multiplierSoi: 2.5,
  /** 原创半长轴：让青芽的 SOI 包住银芽，且不撞进恒星。 */
  sma: 1200000000,
  terrainAmp: 220,
  padAngle: Math.PI / 2,
  padHalf: 0.012,
};

export const MOON = {
  id: MOON_ID,
  name: "银芽",
  parentId: HOME_ID,
  radius: 86500,
  gravity: 1.42,
  atmosphereHeight: 0,
  atmosphereDensity: 0,
  atmosphereCurve: 0,
  parachuteMultiplier: 0,
  timewarpHeight: 5000,
  multiplierSoi: 1.35,
  /** 原创：约 8 个青芽半径，低轨道不会撞上它。 */
  sma: 8 * 314970,
  terrainAmp: 80,
  padAngle: Math.PI / 2,
  padHalf: 0.02,
};

function finish(body) {
  body.mu = muOf(body.gravity, body.radius);
  return body;
}

finish(SUN);
finish(HOME);
finish(MOON);

export function soiRadius(body, parent) {
  if (!parent || !body.sma || body.multiplierSoi == null) return Infinity;
  return body.sma * (body.mu / parent.mu) ** 0.4 * body.multiplierSoi;
}

SUN.soi = Infinity;
HOME.soi = soiRadius(HOME, SUN);
MOON.soi = soiRadius(MOON, HOME);

export const BODIES = {
  [SUN_ID]: SUN,
  [HOME_ID]: HOME,
  [MOON_ID]: MOON,
};

export function getBody(id) {
  return BODIES[id];
}

export function childBodies(id) {
  if (id === SUN_ID) return [HOME];
  if (id === HOME_ID) return [MOON];
  return [];
}

function wrapPi(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** 发射台附近压平，其余用三阶正弦，给着陆一个真正的地表半径。 */
export function terrainRadius(body, angle) {
  const amp = body.terrainAmp || 0;
  if (!amp) return body.radius;
  const pad = wrapPi(angle - (body.padAngle || 0));
  const flat = Math.exp(-(pad * pad) / (2 * (body.padHalf || 0.02) ** 2));
  const n =
    Math.sin(angle * 5) * 0.62 +
    Math.sin(angle * 13 + 1.7) * 0.28 +
    Math.sin(angle * 29 + 0.4) * 0.1;
  return body.radius + amp * n * (1 - flat);
}

export function surfaceAltitude(body, x, y) {
  const r = Math.hypot(x, y);
  return r - terrainRadius(body, Math.atan2(y, x));
}

function circular(a, mu, angle) {
  const n = Math.sqrt(mu / (a * a * a));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a * c, y: a * s, vx: -a * n * s, vy: a * n * c };
}

/** 天体在以恒星为原点的惯性系里的位置。根天体固定在原点。 */
export function bodyGlobal(id, time) {
  if (id === SUN_ID) return { x: 0, y: 0, vx: 0, vy: 0 };
  if (id === HOME_ID) {
    const ang = Math.sqrt(SUN.mu / HOME.sma ** 3) * time;
    return circular(HOME.sma, SUN.mu, ang);
  }
  const parent = bodyGlobal(HOME_ID, time);
  const ang = Math.PI + Math.sqrt(HOME.mu / MOON.sma ** 3) * time;
  const rel = circular(MOON.sma, HOME.mu, ang);
  return {
    x: parent.x + rel.x,
    y: parent.y + rel.y,
    vx: parent.vx + rel.vx,
    vy: parent.vy + rel.vy,
  };
}

export function toGlobal(bodyId, local, time) {
  const o = bodyGlobal(bodyId, time);
  return {
    x: o.x + local.x,
    y: o.y + local.y,
    vx: o.vx + local.vx,
    vy: o.vy + local.vy,
  };
}

export function toLocal(bodyId, global, time) {
  const o = bodyGlobal(bodyId, time);
  return {
    x: global.x - o.x,
    y: global.y - o.y,
    vx: global.vx - o.vx,
    vy: global.vy - o.vy,
  };
}
