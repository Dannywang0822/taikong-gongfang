/**
 * 自研二维飞行动力学。全部是估计，不是从官方程序还原的公式。
 *
 * 坐标：行星中心为原点，y 朝上。姿态 0 表示机头指向当地天顶，
 * 正角度把机头转向当地右方（屏幕顺时针）。
 */

import {
  AERO,
  CHUTE,
  CONTROL,
  EVIDENCE,
  ISP_G0,
  LANDING,
  PLANET,
  STAGE,
} from "./data.js";

export { EVIDENCE, PLANET };

function wrap(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function radialOf(v) {
  const r = Math.hypot(v.x, v.y) || 1;
  return { r, x: v.x / r, y: v.y / r };
}

export function altitude(vessel) {
  return Math.hypot(vessel.x, vessel.y) - PLANET.radius;
}

export function speedOf(vessel) {
  return Math.hypot(vessel.vx, vessel.vy);
}

function basis(vessel) {
  const radial = radialOf(vessel);
  const right = { x: radial.y, y: -radial.x };
  const att = vessel.att;
  const nose = {
    x: radial.x * Math.cos(att) + right.x * Math.sin(att),
    y: radial.y * Math.cos(att) + right.y * Math.sin(att),
  };
  const side = { x: nose.y, y: -nose.x };
  return { radial, right, nose, side };
}

function worldPoint(vessel, basis, lx, ly) {
  return {
    x: vessel.x + basis.side.x * lx + basis.nose.x * ly,
    y: vessel.y + basis.side.y * lx + basis.nose.y * ly,
  };
}

export function lowestAGL(vessel) {
  const b = basis(vessel);
  let min = Infinity;
  for (const p of vessel.parts) {
    const corners = [
      [p.localX - p.halfW, p.localY - p.halfH],
      [p.localX + p.halfW, p.localY - p.halfH],
      [p.localX - p.halfW, p.localY + p.halfH],
      [p.localX + p.halfW, p.localY + p.halfH],
    ];
    for (const [lx, ly] of corners) {
      const q = worldPoint(vessel, b, lx, ly);
      min = Math.min(min, Math.hypot(q.x, q.y) - PLANET.radius);
    }
  }
  return min;
}

export function placeOnPad(vessel) {
  vessel.x = 0;
  vessel.vx = 0;
  vessel.vy = 0;
  vessel.att = 0;
  vessel.omega = 0;
  vessel.y = PLANET.radius + 80;
  for (let i = 0; i < 4; i += 1) {
    const agl = lowestAGL(vessel);
    const r = Math.hypot(vessel.x, vessel.y) || 1;
    const lift = 0.3 - agl;
    vessel.x += (vessel.x / r) * lift;
    vessel.y += (vessel.y / r) * lift;
  }
}

export function createFlight(vessel) {
  placeOnPad(vessel);
  return {
    vessels: [vessel],
    activeId: vessel.id,
    time: 0,
    maxAlt: Math.max(0, lowestAGL(vessel)),
    maxSpeed: 0,
    outcome: null,
    leftPad: false,
  };
}

function active(state) {
  return state.vessels.find((v) => v.id === state.activeId) || state.vessels[0];
}

function rhoAt(alt) {
  if (alt >= PLANET.atmTop || alt < -200) return 0;
  const h = Math.max(0, alt);
  return PLANET.rho0 * Math.exp(-h / PLANET.atmScale);
}

function massOf(vessel) {
  let m = 0;
  for (const p of vessel.parts) m += p.dry + Math.max(0, p.fuel);
  return Math.max(m, 1);
}

function frontalCdA(vessel) {
  let a = 0;
  const core = vessel.parts.some((p) => p.role !== "booster");
  if (core) a += AERO.coreCdA;
  const boosters = vessel.parts.filter((p) => p.role === "booster").length;
  a += boosters * AERO.boosterCdA;
  if (vessel.chute === "mid") a += AERO.chuteMid;
  if (vessel.chute === "open") a += AERO.chuteOpen;
  return a;
}

function consumeLiquid(vessel, kg) {
  if (kg <= 0) return 0;
  const tanks = vessel.parts.filter((p) => p.fuelType === "liquid" && p.fuel > 0);
  const total = tanks.reduce((s, p) => s + p.fuel, 0);
  if (total <= 0) return 0;
  const take = Math.min(total, kg);
  for (const t of tanks) t.fuel -= take * (t.fuel / total);
  return take;
}

function liquidAvailable(vessel) {
  let s = 0;
  for (const p of vessel.parts) if (p.fuelType === "liquid") s += Math.max(0, p.fuel);
  return s;
}

/**
 * 估计：固体助推一旦点着就烧完，液体发动机跟随油门。
 * 分离前整艘火箭的液体燃料都能进发动机；分离后只剩本段自己的。
 */
function propulsion(vessel, throttle, dt) {
  if (vessel.controllable && throttle > 0.04) {
    for (const p of vessel.parts) {
      if (p.role === "booster" && p.fuel > 0) p.ignited = true;
    }
  }
  let thrust = 0;
  const liquid = [];
  let liquidNeed = 0;
  for (const p of vessel.parts) {
    if (p.role === "booster") {
      if (!p.ignited || p.fuel <= 0 || p.thrust <= 0) continue;
      const mdot = p.thrust / (p.isp * ISP_G0);
      const want = mdot * dt;
      const take = Math.min(p.fuel, want);
      const scale = want > 0 ? take / want : 0;
      p.fuel -= take;
      thrust += p.thrust * scale;
    } else if (p.role === "engine" && vessel.controllable && throttle > 0 && p.thrust > 0) {
      const force = p.thrust * throttle;
      const mdot = force / (p.isp * ISP_G0);
      liquid.push({ force, mdot });
      liquidNeed += mdot * dt;
    }
  }
  if (liquidNeed > 0) {
    const have = liquidAvailable(vessel);
    const scale = Math.min(1, have / liquidNeed);
    consumeLiquid(vessel, liquidNeed * scale);
    for (const b of liquid) thrust += b.force * scale;
  }
  return thrust;
}

function collectDesc(parts, uid) {
  const out = [];
  const walk = (id) => {
    for (const p of parts) {
      if (p.parentUid === id) {
        out.push(p);
        walk(p.uid);
      }
    }
  };
  walk(uid);
  return out;
}

function makeDebris(parent, parts, kind) {
  const debris = {
    id: "d" + Math.floor(Math.random() * 1e9).toString(36),
    x: parent.x,
    y: parent.y,
    vx: parent.vx,
    vy: parent.vy,
    att: parent.att,
    omega: 0,
    chute: "none",
    chuteT: 0,
    controllable: false,
    parts: parts.map((p) => ({ ...p })),
  };
  const ids = new Set(debris.parts.map((p) => p.uid));
  for (const p of debris.parts) {
    if (!ids.has(p.parentUid)) p.parentUid = null;
  }
  const b = basis(parent);
  if (kind === "side") {
    const sign = Math.sign(parts[0].localX) || 1;
    debris.vx += b.side.x * sign * STAGE.impulse - b.nose.x * 1.5;
    debris.vy += b.side.y * sign * STAGE.impulse - b.nose.y * 1.5;
    debris.x += b.side.x * sign * 1.1;
    debris.y += b.side.y * sign * 1.1;
  } else {
    debris.vx -= b.nose.x * STAGE.impulse;
    debris.vy -= b.nose.y * STAGE.impulse;
    debris.x -= b.nose.x * 1.4;
    debris.y -= b.nose.y * 1.4;
    parent.vx += b.nose.x * STAGE.impulse * 0.25;
    parent.vy += b.nose.y * STAGE.impulse * 0.25;
  }
  return debris;
}

function separate(state) {
  const vessel = active(state);
  if (!vessel || !vessel.controllable) return null;
  const sides = vessel.parts.filter((p) => p.link === "side");
  if (sides.length) {
    vessel.parts = vessel.parts.filter((p) => p.link !== "side");
    for (const p of sides) state.vessels.push(makeDebris(vessel, [p], "side"));
    return "boosters";
  }
  const decs = vessel.parts.filter((p) => p.role === "decoupler");
  if (!decs.length) return null;
  decs.sort((a, b) => a.localY - b.localY);
  const drop = collectDesc(vessel.parts, decs[0].uid);
  if (!drop.length) return null;
  const ids = new Set(drop.map((p) => p.uid));
  vessel.parts = vessel.parts.filter((p) => !ids.has(p.uid));
  state.vessels.push(makeDebris(vessel, drop, "stack"));
  return "stage";
}

function tryDeploy(state) {
  const vessel = active(state);
  if (!vessel || !vessel.controllable) return { ok: false, code: "none" };
  if (vessel.chute === "none") return { ok: false, code: "none" };
  if (vessel.chute === "mid" || vessel.chute === "open") return { ok: true, code: "open" };
  const alt = altitude(vessel);
  const spd = speedOf(vessel);
  if (alt > CHUTE.maxAlt) return { ok: false, code: "high" };
  if (spd > CHUTE.maxSpeed) return { ok: false, code: "fast" };
  vessel.chute = "mid";
  vessel.chuteT = 0;
  return { ok: true, code: "deploy" };
}

function supportPad(vessel) {
  const agl = lowestAGL(vessel);
  const radial = radialOf(vessel);
  const vr = vessel.vx * radial.x + vessel.vy * radial.y;
  if (vr < 0) {
    vessel.vx -= vr * radial.x;
    vessel.vy -= vr * radial.y;
  }
  if (agl < 0.05) {
    const lift = 0.05 - agl;
    vessel.x += radial.x * lift;
    vessel.y += radial.y * lift;
  }
}

function touchdown(state, vessel) {
  const b = basis(vessel);
  const vr = vessel.vx * b.radial.x + vessel.vy * b.radial.y;
  const sink = -vr;
  const lateral = Math.abs(vessel.vx * b.right.x + vessel.vy * b.right.y);
  const gentle = sink <= LANDING.maxSink && lateral <= LANDING.maxLateral && Math.abs(wrap(vessel.att)) <= LANDING.maxTilt;
  vessel.vx = 0;
  vessel.vy = 0;
  vessel.omega = 0;
  const agl = lowestAGL(vessel);
  if (agl < 0.05) {
    vessel.x += b.radial.x * (0.05 - agl);
    vessel.y += b.radial.y * (0.05 - agl);
  }
  if (gentle && vessel.parts.some((p) => p.role === "pod")) {
    state.outcome = "land";
    return "land";
  }
  state.outcome = "crash";
  return "crash";
}

function stepVessel(vessel, state, input, dt, isActive) {
  const throttle = isActive ? input.throttle : 0;
  if (isActive) vessel.throttle = throttle;

  if (vessel.chute === "mid") {
    vessel.chuteT += dt;
    if (vessel.chuteT >= CHUTE.deployTime) vessel.chute = "open";
  }

  const mass = massOf(vessel);
  const b = basis(vessel);
  const alt = altitude(vessel);
  const spd = speedOf(vessel);
  const rho = rhoAt(alt);

  const thrust = propulsion(vessel, isActive ? throttle : 0, dt);
  let ax = b.nose.x * (thrust / mass);
  let ay = b.nose.y * (thrust / mass);

  const g = PLANET.mu / (b.radial.r * b.radial.r);
  ax -= b.radial.x * g;
  ay -= b.radial.y * g;

  if (rho > 0 && spd > 0.01) {
    const drag = (0.5 * rho * frontalCdA(vessel) * spd * spd) / mass;
    ax -= (vessel.vx / spd) * drag;
    ay -= (vessel.vy / spd) * drag;
  }

  vessel.vx += ax * dt;
  vessel.vy += ay * dt;
  vessel.x += vessel.vx * dt;
  vessel.y += vessel.vy * dt;

  let torque = 0;
  if (isActive && vessel.controllable && vessel.parts.some((p) => p.role === "pod")) {
    if (input.left) torque -= CONTROL.alpha;
    if (input.right) torque += CONTROL.alpha;
  }
  // 估计：动压只修正小角度迎角，不会把下落的火箭自己翻过头。
  if (rho > 0.02 && spd > 20 && vessel.chute === "stow") {
    const vUp = vessel.vx * b.radial.x + vessel.vy * b.radial.y;
    const vRt = vessel.vx * b.right.x + vessel.vy * b.right.y;
    const desired = Math.atan2(vRt, vUp);
    const err = wrap(desired - vessel.att);
    if (Math.abs(err) < 1) {
      const q = Math.min(0.8, (0.5 * rho * spd * spd) / 12000);
      torque += err * q;
    }
  }
  if (vessel.chute === "mid" || vessel.chute === "open") {
    torque += wrap(0 - vessel.att) * 1.4;
    vessel.omega *= Math.exp(-1.6 * dt);
  }

  vessel.omega += torque * dt;
  if (vessel.omega > CONTROL.maxOmega) vessel.omega = CONTROL.maxOmega;
  if (vessel.omega < -CONTROL.maxOmega) vessel.omega = -CONTROL.maxOmega;
  if (isActive && !input.left && !input.right) vessel.omega *= Math.exp(-CONTROL.damp * dt);
  vessel.att = wrap(vessel.att + vessel.omega * dt);

  // 还没飞离发射台时，只在贴地的一小段里托住，避免没离地就被判坠毁。
  if (!state.leftPad && isActive && vessel.controllable && lowestAGL(vessel) < 1.2) {
    supportPad(vessel);
    return null;
  }

  const agl = lowestAGL(vessel);
  if (agl <= 0) {
    if (isActive && vessel.controllable) return touchdown(state, vessel);
    return "debris";
  }
  return null;
}

function stepOnce(state, input, dt) {
  const events = [];
  if (state.outcome) return { state, events };
  const vessel = active(state);
  if (!vessel) return { state, events };

  if (input.separate) {
    const kind = separate(state);
    if (kind === "boosters") events.push({ type: "toast", code: "staged-boosters" });
    else if (kind === "stage") events.push({ type: "toast", code: "staged-core" });
    else events.push({ type: "toast", code: "no-stage" });
  }
  if (input.deploy) {
    const d = tryDeploy(state);
    if (d.code === "high") events.push({ type: "toast", code: "chute-high" });
    else if (d.code === "fast") events.push({ type: "toast", code: "chute-fast" });
    else if (d.code === "none") events.push({ type: "toast", code: "chute-none" });
    else if (d.code === "deploy") events.push({ type: "toast", code: "chute-open" });
  }

  const hit = [];
  for (const v of state.vessels) {
    const isActive = v.id === state.activeId;
    const result = stepVessel(v, state, input, dt, isActive);
    if (result === "debris") hit.push(v.id);
    if (result === "land" || result === "crash") {
      events.push({ type: result });
    }
  }

  if (hit.length) state.vessels = state.vessels.filter((v) => !hit.includes(v.id) || v.id === state.activeId);

  const now = active(state);
  if (now) {
    const agl = Math.max(0, lowestAGL(now));
    const spd = speedOf(now);
    if (agl > state.maxAlt) state.maxAlt = agl;
    if (spd > state.maxSpeed) state.maxSpeed = spd;
    if (agl > LANDING.leftPadAlt) state.leftPad = true;
  }
  state.time += dt;

  // 飞远的碎片不再积分
  const keep = active(state);
  if (keep) {
    state.vessels = state.vessels.filter((v) => {
      if (v.id === keep.id) return true;
      return Math.hypot(v.x - keep.x, v.y - keep.y) < 8000;
    });
  }
  return { state, events };
}

export function fuelFrac(vessel) {
  let max = 0;
  let now = 0;
  for (const p of vessel.parts) {
    max += p.fuelMax || 0;
    now += Math.max(0, p.fuel || 0);
  }
  if (max <= 0) return 0;
  return now / max;
}

export function step(state, input, dt) {
  if (state.outcome) return { state, events: [] };
  const currentActive = active(state);
  if (!currentActive) return { state, events: [] };
  const spd = speedOf(currentActive);
  const n = Math.max(1, Math.min(8, Math.ceil((spd * dt) / 4)));
  const h = dt / n;
  let current = state;
  const events = [];
  for (let i = 0; i < n; i += 1) {
    const once = i === 0 ? input : { ...input, separate: false, deploy: false };
    const r = stepOnce(current, once, h);
    current = r.state;
    events.push(...r.events);
    if (current.outcome) break;
  }
  return { state: current, events };
}

export function formatSpeed(v) {
  const a = Math.abs(v);
  if (a < 1000) return (a < 100 ? a.toFixed(1) : a.toFixed(0)) + " m/s";
  return (a / 1000).toFixed(2) + " km/s";
}

export function formatAlt(m) {
  const a = Math.max(0, m);
  if (a < 1000) return a.toFixed(0) + " m";
  return (a / 1000).toFixed(1) + " km";
}
