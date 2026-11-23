/**
 * 飞行步进：物理档用速度 Verlet，解析档用开普勒。
 * 姿态是一艘船一个刚体，惯量由零件求和。
 */

import {
  HOME,
  childBodies,
  getBody,
  surfaceAltitude,
  toGlobal,
  toLocal,
} from "./bodies.js";
import { CONTROL, LANDING, STAGE } from "./data.js";
import {
  CHUTE,
  G0,
  WARP,
  airDensity,
  allowedWarpIndex,
  chuteBlocker,
  consumeProportional,
  dragAccel,
  chuteCurve,
  effectiveArea,
  fuelRequest,
  gravityAccel,
  impactBreaks,
  impactScore,
  keplerAdvance,
  massProps,
  orbitalElements,
  partMass,
  periApo,
  physicsStepDt,
  shouldAutoFull,
  thrustForce,
  timeToTrueAnomaly,
  warpGear,
  wrapPi,
} from "./physics.js";

export function vesselBasis(vessel) {
  const r = Math.hypot(vessel.x, vessel.y) || 1;
  const radial = { x: vessel.x / r, y: vessel.y / r };
  const right = { x: radial.y, y: -radial.x };
  const c = Math.cos(vessel.att);
  const s = Math.sin(vessel.att);
  const nose = {
    x: radial.x * c + right.x * s,
    y: radial.y * c + right.y * s,
  };
  const side = { x: nose.y, y: -nose.x };
  return { r, radial, right, nose, side };
}

export function localToWorld(vessel, basis, lx, ly) {
  return {
    x: vessel.x + basis.side.x * lx + basis.nose.x * ly,
    y: vessel.y + basis.side.y * lx + basis.nose.y * ly,
  };
}

export function lowestAGL(vessel) {
  const body = getBody(vessel.bodyId) || HOME;
  const b = vesselBasis(vessel);
  let min = Infinity;
  let part = null;
  for (const p of vessel.parts) {
    if (p.dead) continue;
    const corners = [
      [p.localX - p.halfW, p.localY - p.halfH],
      [p.localX + p.halfW, p.localY - p.halfH],
      [p.localX - p.halfW, p.localY + p.halfH],
      [p.localX + p.halfW, p.localY + p.halfH],
    ];
    for (const [lx, ly] of corners) {
      const q = localToWorld(vessel, b, lx, ly);
      const agl = surfaceAltitude(body, q.x, q.y);
      if (agl < min) {
        min = agl;
        part = p;
      }
    }
  }
  if (!Number.isFinite(min)) min = surfaceAltitude(body, vessel.x, vessel.y);
  return { agl: min, part, body };
}

export function altitude(vessel) {
  return lowestAGL(vessel).agl;
}

export function speedOf(vessel) {
  return Math.hypot(vessel.vx, vessel.vy);
}

export function placeOnPad(vessel) {
  const body = getBody(vessel.bodyId) || HOME;
  const ang = body.padAngle ?? Math.PI / 2;
  vessel.x = Math.cos(ang) * (body.radius + 30);
  vessel.y = Math.sin(ang) * (body.radius + 30);
  vessel.vx = 0;
  vessel.vy = 0;
  vessel.att = 0;
  vessel.omega = 0;
  for (let i = 0; i < 6; i += 1) {
    const { agl } = lowestAGL(vessel);
    const r = Math.hypot(vessel.x, vessel.y) || 1;
    const lift = 0.35 - agl;
    vessel.x += (vessel.x / r) * lift;
    vessel.y += (vessel.y / r) * lift;
  }
}

export function createFlight(vessel) {
  if (!vessel.bodyId) vessel.bodyId = HOME.id;
  placeOnPad(vessel);
  const agl = Math.max(0, altitude(vessel));
  return {
    vessels: [vessel],
    activeId: vessel.id,
    time: 0,
    warpIndex: 0,
    maxAlt: agl,
    maxSpeed: 0,
    outcome: null,
    crashReason: null,
    pendingFailure: null,
    leftPad: false,
    notice: null,
  };
}

export function activeVessel(state) {
  return state.vessels.find((v) => v.id === state.activeId) || state.vessels[0];
}

function stickOf(input) {
  const digital = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (digital !== 0) return digital;
  if (typeof input.stick === "number") return Math.max(-1, Math.min(1, input.stick));
  return 0;
}

function liquidSources(vessel) {
  return vessel.parts
    .filter((p) => !p.dead && p.fuelType === "liquid" && p.fuel > 0)
    .map((p) => ({
      amount: p.fuel,
      part: p,
    }));
}

function applyPropulsion(vessel, throttle, dt, props) {
  const b = vesselBasis(vessel);
  let fx = 0;
  let fy = 0;
  let torque = 0;
  if (vessel.controllable && throttle > 0.04) {
    for (const p of vessel.parts) {
      if (p.role === "booster" && p.fuel > 0 && !p.dead) p.ignited = true;
    }
  }
  const liquids = liquidSources(vessel);
  let liquidQ = 0;
  const burns = [];
  for (const p of vessel.parts) {
    if (p.dead || p.thrust <= 0) continue;
    if (p.role === "booster") {
      if (!p.ignited || p.fuel <= 0) continue;
      const q = fuelRequest(p.thrust, 1, p.isp);
      const want = q * dt;
      const take = Math.min(p.fuel, want);
      const scale = want > 0 ? take / want : 0;
      p.fuel -= take;
      burns.push({ part: p, force: thrustForce(p.thrust, 1) * scale, gimbal: false });
    } else if (p.role === "engine" && vessel.controllable && throttle > 0) {
      const q = fuelRequest(p.thrust, throttle, p.isp);
      liquidQ += q;
      burns.push({ part: p, force: thrustForce(p.thrust, throttle), gimbal: !!p.gimbal, q });
    }
  }
  let fuelScale = 1;
  if (liquidQ > 0) {
    const sources = liquids.map((s) => ({ amount: s.part.fuel, part: s.part }));
    const got = consumeProportional(sources, liquidQ, dt);
    for (const s of sources) s.part.fuel = s.amount;
    fuelScale = liquidQ * dt > 0 ? got / (liquidQ * dt) : 0;
  }
  const stick = vessel.controllable ? vessel._stick || 0 : 0;
  const gimbal = ((CONTROL.gimbalDeg * Math.PI) / 180) * stick;
  for (const burn of burns) {
    const force = burn.part.role === "engine" ? burn.force * fuelScale : burn.force;
    if (force <= 0) continue;
    const delta = burn.gimbal ? gimbal : 0;
    const lx = -Math.sin(delta) * force;
    const ly = Math.cos(delta) * force;
    fx += b.side.x * lx + b.nose.x * ly;
    fy += b.side.y * lx + b.nose.y * ly;
    const rx = burn.part.localX - props.cx;
    const ry = burn.part.localY - props.cy;
    const nozzleY = ry - burn.part.halfH * 0.85;
    torque += nozzleY * lx - rx * ly;
  }
  return { fx, fy, torque, thrusting: fx * fx + fy * fy > 1 };
}

function applyRcs(vessel, props, stick, dt) {
  if (!vessel.controllable || Math.abs(stick) < 0.04) return { fx: 0, fy: 0, torque: 0 };
  const pod = vessel.parts.find((p) => p.rcs && !p.dead && p.rcsFuel > 0);
  if (!pod) return { fx: 0, fy: 0, torque: 0 };
  const q = (CONTROL.rcsThrust / CONTROL.rcsIsp) * Math.abs(stick);
  const want = q * dt;
  const take = Math.min(pod.rcsFuel, want);
  pod.rcsFuel -= take;
  const scale = want > 0 ? take / want : 0;
  if (scale <= 0) return { fx: 0, fy: 0, torque: 0 };
  const force = thrustForce(CONTROL.rcsThrust, Math.abs(stick)) * scale;
  const sign = Math.sign(stick);
  const b = vesselBasis(vessel);
  // 一对侧向喷口，总推力等于参考推力，力矩让机头跟着摇杆走。
  const nose = vessel.parts.find((p) => p.role === "pod" && !p.dead) || pod;
  const tail = [...vessel.parts].filter((p) => !p.dead).sort((a, c) => a.localY - c.localY)[0];
  let torque = 0;
  const half = force * 0.5;
  const spots = [
    { part: nose, fx: sign * half },
    { part: tail, fx: sign * -half },
  ];
  let fx = 0;
  let fy = 0;
  for (const spot of spots) {
    fx += b.side.x * spot.fx;
    fy += b.side.y * spot.fx;
    const rx = spot.part.localX - props.cx;
    const ry = spot.part.localY - props.cy;
    torque += ry * spot.fx - rx * 0;
  }
  return { fx, fy, torque };
}

function attitudeTorque(vessel, props, stick, extra) {
  let torque = extra;
  const alivePod = vessel.parts.some((p) => p.wheel && !p.dead);
  if (vessel.controllable && alivePod) {
    const cap = Math.min(CONTROL.wheelTorque, CONTROL.maxAlpha * props.inertia);
    torque += stick * cap;
  }
  if (vessel.chuteState > 0.2) {
    torque += -wrapPi(vessel.att) * CONTROL.chuteUpright * props.inertia;
  }
  torque += -vessel.omega * CONTROL.angularDamp * props.inertia;
  return torque;
}

function velLocal(vessel, basis) {
  return {
    x: vessel.vx * basis.side.x + vessel.vy * basis.side.y,
    y: vessel.vx * basis.nose.x + vessel.vy * basis.nose.y,
  };
}

function stepAttitude(vessel, torque, inertia, dt) {
  const alpha = inertia > 1e-6 ? torque / inertia : 0;
  vessel.omega += alpha * dt;
  vessel.att = wrapPi(vessel.att + vessel.omega * dt);
}

function chuteWeight(vessel, speed) {
  if (vessel.chuteTarget !== 1 && vessel.chuteTarget !== 2) return 0;
  return chuteCurve(vessel.chuteState) * speed * speed;
}

function animateChute(vessel, body, dt) {
  if (vessel.chuteTarget < 0) return;
  const { agl } = lowestAGL(vessel);
  if (shouldAutoFull(vessel.chuteTarget, vessel.chuteState, agl, body.parachuteMultiplier || 1)) {
    vessel.chuteTarget = 2;
  }
  if (vessel.chuteTarget > vessel.chuteState) {
    const step = dt / CHUTE.animationTime;
    vessel.chuteState = Math.min(vessel.chuteTarget, vessel.chuteState + step);
  }
}

function scheduleFailure(state, reason) {
  if (state.outcome || state.pendingFailure) return;
  state.pendingFailure = { at: state.time + 3, reason };
  state.crashReason = reason;
}

function resolveGround(state, vessel, preVx, preVy, dt) {
  const info = lowestAGL(vessel);
  const body = info.body;
  if (info.agl > 0.2) return;
  const r = Math.hypot(vessel.x, vessel.y) || 1;
  const nx = vessel.x / r;
  const ny = vessel.y / r;
  const score = impactScore(preVx, preVy, nx, ny);
  const b = vesselBasis(vessel);
  const brokenNow = [];
  for (const p of vessel.parts) {
    if (p.dead) continue;
    let touch = false;
    const corners = [
      [p.localX - p.halfW, p.localY - p.halfH],
      [p.localX + p.halfW, p.localY - p.halfH],
      [p.localX - p.halfW, p.localY + p.halfH],
      [p.localX + p.halfW, p.localY + p.halfH],
    ];
    for (const [lx, ly] of corners) {
      const q = localToWorld(vessel, b, lx, ly);
      if (surfaceAltitude(body, q.x, q.y) <= 0.45) touch = true;
    }
    if (touch && impactBreaks(score, p.impact)) {
      p.dead = true;
      brokenNow.push(p);
    }
  }
  const vr = vessel.vx * nx + vessel.vy * ny;
  if (vr < 0) {
    vessel.vx -= vr * nx;
    vessel.vy -= vr * ny;
  }
  if (info.agl < 0.05) {
    const lift = 0.05 - info.agl;
    vessel.x += nx * lift;
    vessel.y += ny * lift;
  }
  const lat = LANDING.friction * (body.gravity || 1) * dt;
  const tx = -ny;
  const ty = nx;
  const vt = vessel.vx * tx + vessel.vy * ty;
  const bleed = Math.max(-lat, Math.min(lat, vt));
  vessel.vx -= bleed * tx;
  vessel.vy -= bleed * ty;
  if (Math.abs(vessel.omega) > 0 && info.agl < 0.4) vessel.omega *= Math.exp(-3 * dt);

  const podAlive = vessel.parts.some((p) => p.role === "pod" && !p.dead);
  const fatal = brokenNow.some((p) => p.role === "pod" || p.role === "tank" || p.role === "engine" || p.role === "adapter");
  if (vessel.controllable && (!podAlive || fatal || score >= 12.5)) {
    scheduleFailure(state, "terrain");
  }

  const tipped = Math.abs(wrapPi(vessel.att)) > LANDING.tipCrash;
  if (vessel.controllable && podAlive && tipped && info.agl < 1.2 && speedOf(vessel) < 35) {
    scheduleFailure(state, "tip");
  }
  if (
    vessel.controllable &&
    state.leftPad &&
    podAlive &&
    !state.pendingFailure &&
    !tipped &&
    speedOf(vessel) < LANDING.settleSpeed &&
    Math.abs(wrapPi(vessel.att)) <= LANDING.maxTilt
  ) {
    state.outcome = "land";
  }
}

function physicsOnce(state, vessel, throttle, stick, dt) {
  animateChute(vessel, getBody(vessel.bodyId) || HOME, dt);
  const props = massProps(vessel.parts);
  vessel.mass = props.mass;
  vessel.comX = props.cx;
  vessel.comY = props.cy;
  vessel.inertia = props.inertia;
  if (props.mass <= 0) return;
  vessel._stick = stick;
  const thrust = applyPropulsion(vessel, throttle, dt, props);
  const rcs = applyRcs(vessel, props, stick, dt);
  const body = getBody(vessel.bodyId) || HOME;
  const b = vesselBasis(vessel);
  const localV = velLocal(vessel, b);
  const radialAlt = b.r - body.radius;
  const rho = airDensity(body, radialAlt);
  const area = effectiveArea(vessel.parts, localV.x, localV.y);
  const speed = Math.hypot(vessel.vx, vessel.vy);
  const drag = dragAccel(props.mass, area, chuteWeight(vessel, speed), rho, vessel.vx, vessel.vy);
  const ax = (thrust.fx + rcs.fx) / props.mass + drag.x;
  const ay = (thrust.fy + rcs.fy) / props.mass + drag.y;
  const preVx = vessel.vx;
  const preVy = vessel.vy;
  const g1 = gravityAccel(body.mu, vessel.x, vessel.y);
  vessel.vx += (g1.x + ax) * dt * 0.5;
  vessel.vy += (g1.y + ay) * dt * 0.5;
  vessel.x += vessel.vx * dt;
  vessel.y += vessel.vy * dt;
  const g2 = gravityAccel(body.mu, vessel.x, vessel.y);
  vessel.vx += (g2.x + ax) * dt * 0.5;
  vessel.vy += (g2.y + ay) * dt * 0.5;
  const torque = attitudeTorque(vessel, props, stick, thrust.torque + rcs.torque);
  stepAttitude(vessel, torque, props.inertia, dt);
  resolveGround(state, vessel, preVx, preVy, dt);
  vessel.thrusting = thrust.thrusting;
}

function adopt(vessel, bodyId, rel) {
  vessel.bodyId = bodyId;
  vessel.x = rel.x;
  vessel.y = rel.y;
  vessel.vx = rel.vx;
  vessel.vy = rel.vy;
}

export function updateSoi(vessel, time) {
  const global = toGlobal(vessel.bodyId, vessel, time);
  for (const child of childBodies(vessel.bodyId)) {
    const rel = toLocal(child.id, global, time);
    const outside = rel.x * rel.x + rel.y * rel.y > child.soi * child.soi;
    if (!outside) {
      adopt(vessel, child.id, rel);
      return child.id;
    }
  }
  const body = getBody(vessel.bodyId);
  if (body && body.parentId && body.soi < Infinity) {
    const outside = vessel.x * vessel.x + vessel.y * vessel.y > body.soi * body.soi;
    if (outside) {
      adopt(vessel, body.parentId, toLocal(body.parentId, global, time));
      return body.parentId;
    }
  }
  return vessel.bodyId;
}

function collectDesc(parts, uid) {
  const out = [];
  const walk = (id) => {
    for (const p of parts) {
      if (p.parentUid === id && !p.dead) {
        out.push(p);
        walk(p.uid);
      }
    }
  };
  walk(uid);
  return out;
}

function detach(state, vessel, parts, kind) {
  const ids = new Set(parts.map((p) => p.uid));
  const b = vesselBasis(vessel);
  vessel.parts = vessel.parts.filter((p) => !ids.has(p.uid));
  const debrisParts = parts.map((p) => ({
    ...p,
    parentUid: ids.has(p.parentUid) ? p.parentUid : null,
  }));
  const debris = {
    id: "d" + Math.floor(Math.random() * 1e9).toString(36),
    bodyId: vessel.bodyId,
    x: vessel.x,
    y: vessel.y,
    vx: vessel.vx,
    vy: vessel.vy,
    att: vessel.att,
    omega: kind === "side" ? 0.25 : -0.15,
    chuteTarget: -1,
    chuteState: 0,
    controllable: false,
    born: state.time,
    parts: debrisParts,
  };
  const massD = Math.max(0.05, massProps(debrisParts).mass);
  const massP = Math.max(0.05, massProps(vessel.parts).mass);
  const impulse = STAGE.force * STAGE.multiplier * STAGE.frame;
  let dx = -b.nose.x;
  let dy = -b.nose.y;
  if (kind === "side") {
    const sign = Math.sign(parts[0].localX) || 1;
    dx = b.side.x * sign;
    dy = b.side.y * sign;
  }
  const dvD = impulse / massD;
  const dvP = impulse / massP;
  debris.vx += dx * dvD;
  debris.vy += dy * dvD;
  debris.x += dx * 1.4;
  debris.y += dy * 1.4;
  vessel.vx -= dx * dvP;
  vessel.vy -= dy * dvP;
  state.vessels.push(debris);
  return { impulse, massD, dvD };
}

function separate(state, vessel) {
  if (!vessel || !vessel.controllable) return null;
  const sides = vessel.parts.filter((p) => p.link === "side" && !p.dead);
  if (sides.length) {
    for (const part of sides) detach(state, vessel, [part], "side");
    return "boosters";
  }
  const decs = vessel.parts.filter((p) => p.role === "decoupler" && !p.dead);
  if (!decs.length) return null;
  decs.sort((a, b) => a.localY - b.localY);
  const drop = collectDesc(vessel.parts, decs[0].uid);
  if (!drop.length) return null;
  detach(state, vessel, drop, "stack");
  return "stage";
}

function tryDeploy(vessel) {
  if (vessel.chuteTarget < 0) return "none";
  const body = getBody(vessel.bodyId) || HOME;
  const agl = altitude(vessel);
  const radial = vesselBasis(vessel).r - body.radius;
  const speed = speedOf(vessel);
  if (vessel.chuteTarget >= 2) return "open";
  if (vessel.chuteTarget >= 1) {
    const M = body.parachuteMultiplier || 1;
    if (agl <= CHUTE.fullFrac * M * CHUTE.maxDeployHeight) {
      vessel.chuteTarget = 2;
      return "full";
    }
    return "open";
  }
  const code = chuteBlocker({
    hasChute: true,
    target: vessel.chuteTarget,
    atmosphereHeight: body.atmosphereHeight,
    altitude: radial,
    terrainAlt: agl,
    speed,
    multiplier: body.parachuteMultiplier || 1,
  });
  if (code) return code;
  vessel.chuteTarget = 1;
  return "deploy";
}

function thrustingNow(vessel, throttle) {
  if (vessel.parts.some((p) => p.role === "booster" && p.ignited && p.fuel > 0 && !p.dead)) return true;
  if (throttle > 0.02 && vessel.controllable) {
    const liquid = vessel.parts.some((p) => !p.dead && p.fuelType === "liquid" && p.fuel > 0.001);
    const engine = vessel.parts.some((p) => !p.dead && p.role === "engine" && p.thrust > 0);
    if (liquid && engine) return true;
    if (vessel.parts.some((p) => p.role === "booster" && p.fuel > 0 && !p.dead)) return true;
  }
  return false;
}

function chuteBusy(vessel) {
  return vessel.chuteTarget > 0 && vessel.chuteState + 0.03 < vessel.chuteTarget;
}

function orbitHitsAir(vessel) {
  const body = getBody(vessel.bodyId) || HOME;
  if (!body.atmosphereHeight) return false;
  const el = orbitalElements(vessel.x, vessel.y, vessel.vx, vessel.vy, body.mu);
  if (!el) return true;
  const pa = periApo(el, body.radius);
  return pa.periAlt < body.atmosphereHeight;
}

function prune(state) {
  const keep = activeVessel(state);
  if (!keep) return;
  state.vessels = state.vessels.filter((v) => {
    if (v.id === keep.id) return true;
    const far = Math.hypot(v.x - keep.x, v.y - keep.y) > 25000;
    const old = state.time - (v.born || 0) > 120;
    const alive = v.parts.some((p) => !p.dead);
    return alive && !far && !old;
  });
}

function railsStep(state, vessel, dt) {
  const body = getBody(vessel.bodyId) || HOME;
  const next = keplerAdvance(vessel.x, vessel.y, vessel.vx, vessel.vy, body.mu, dt);
  if (!next) return false;
  vessel.x = next.x;
  vessel.y = next.y;
  vessel.vx = next.vx;
  vessel.vy = next.vy;
  vessel.omega *= Math.exp(-dt);
  updateSoi(vessel, state.time + dt);
  return true;
}

export function step(state, input, frameDt) {
  const events = [];
  if (state.outcome) return { state, events };
  const vessel = activeVessel(state);
  if (!vessel) return { state, events };
  const throttle = Math.max(0, Math.min(1, input.throttle || 0));
  const stick = stickOf(input);
  vessel.throttle = throttle;

  if (input.separate) {
    const kind = separate(state, vessel);
    if (kind === "boosters") events.push({ type: "toast", code: "staged-boosters" });
    else if (kind === "stage") events.push({ type: "toast", code: "staged-core" });
    else events.push({ type: "toast", code: "no-stage" });
  }
  if (input.deploy) {
    const code = tryDeploy(vessel);
    const map = {
      high: "chute-high",
      fast: "chute-fast",
      slow: "chute-slow",
      thin: "chute-thin",
      none: "chute-none",
      deploy: "chute-open",
      full: "chute-full",
      open: null,
    };
    if (map[code]) events.push({ type: "toast", code: map[code] });
  }

  const body = getBody(vessel.bodyId) || HOME;
  const agl = altitude(vessel);
  const radialAlt = vesselBasis(vessel).r - body.radius;
  if (typeof input.warp === "number") state.warpIndex = input.warp;
  if (input.warpDelta) state.warpIndex += input.warpDelta;
  const limit = allowedWarpIndex({
    thrusting: thrustingNow(vessel, throttle),
    chuteBusy: chuteBusy(vessel),
    altitude: radialAlt,
    atmosphereHeight: body.atmosphereHeight || 0,
  });
  const asked = state.warpIndex;
  if (state.warpIndex > limit) {
    state.warpIndex = limit;
    if (input.warpDelta) {
      const code = thrustingNow(vessel, throttle)
        ? "warp-thrust"
        : radialAlt < (body.atmosphereHeight || 0)
          ? "warp-atmo"
          : "warp-blocked";
      events.push({ type: "toast", code });
    }
  }
  void asked;
  if (state.warpIndex < 0) state.warpIndex = 0;
  let gear = warpGear(state.warpIndex);
  if (gear.rails && (orbitHitsAir(vessel) || radialAlt < (body.atmosphereHeight || 0))) {
    state.warpIndex = Math.min(state.warpIndex, WARP.maxPhysicsIndex);
    gear = warpGear(state.warpIndex);
  }

  if (!gear.rails) {
    let dt = physicsStepDt(frameDt, gear.speed);
    const speed = speedOf(vessel);
    const n = Math.max(1, Math.min(6, Math.ceil((speed * dt) / 80)));
    const h = dt / n;
    for (const item of state.vessels) {
      const isActive = item.id === vessel.id;
      const th = isActive ? throttle : 0;
      const st = isActive ? stick : 0;
      for (let i = 0; i < n; i += 1) {
        if (state.outcome) break;
        physicsOnce(state, item, th, st, h);
        if (item.id === vessel.id) updateSoi(item, state.time);
      }
    }
    state.time += dt;
  } else {
    const dt = Math.min(frameDt * gear.speed, 6);
    if (!railsStep(state, vessel, dt)) {
      physicsOnce(state, vessel, throttle, stick, Math.min(dt, WARP.dtMax));
    }
    for (const item of state.vessels) {
      if (item.id === vessel.id) continue;
      physicsOnce(state, item, 0, 0, Math.min(WARP.dtMax, 0.05));
    }
    state.time += dt;
  }

  if (state.pendingFailure && state.time >= state.pendingFailure.at) {
    state.outcome = "crash";
    state.crashReason = state.pendingFailure.reason;
    events.push({ type: "crash", reason: state.crashReason });
  }
  if (state.outcome === "land") events.push({ type: "land" });

  const now = activeVessel(state);
  if (now) {
    const nowAgl = Math.max(0, altitude(now));
    const spd = speedOf(now);
    if (nowAgl > state.maxAlt) state.maxAlt = nowAgl;
    if (spd > state.maxSpeed) state.maxSpeed = spd;
    if (nowAgl > LANDING.leftPadAlt) state.leftPad = true;
  }
  prune(state);
  return { state, events };
}

export function fuelFrac(vessel) {
  let max = 0;
  let now = 0;
  for (const p of vessel.parts) {
    max += p.fuelMax || 0;
    now += Math.max(0, p.fuel || 0);
    max += p.rcsFuelMax || 0;
    now += Math.max(0, p.rcsFuel || 0);
  }
  if (max <= 0) return 0;
  return now / max;
}

export function flightInfo(state) {
  const vessel = activeVessel(state);
  if (!vessel) return null;
  const body = getBody(vessel.bodyId) || HOME;
  const b = vesselBasis(vessel);
  const agl = altitude(vessel);
  const radialAlt = b.r - body.radius;
  const el = orbitalElements(vessel.x, vessel.y, vessel.vx, vessel.vy, body.mu);
  const pa = periApo(el, body.radius);
  const vUp = vessel.vx * b.radial.x + vessel.vy * b.radial.y;
  const vRt = vessel.vx * b.right.x + vessel.vy * b.right.y;
  const gear = warpGear(state.warpIndex || 0);
  const atmo = body.atmosphereHeight || 0;
  const inOrbit =
    body.id === HOME.id &&
    pa.periAlt > atmo + 2000 &&
    pa.apoAlt > atmo + 2000 &&
    pa.apoAlt < 800000 &&
    el &&
    el.e < 0.22 &&
    radialAlt > atmo;
  return {
    vessel,
    body,
    alt: agl,
    radialAlt,
    speed: speedOf(vessel),
    periAlt: pa.periAlt,
    apoAlt: pa.apoAlt,
    e: el ? el.e : 0,
    nu: el ? el.nu : 0,
    timeToApo: el ? timeToTrueAnomaly(el, Math.PI) : Infinity,
    vUp,
    vRt,
    att: vessel.att,
    omega: vessel.omega,
    mass: vessel.mass || massProps(vessel.parts).mass,
    fuel: fuelFrac(vessel),
    chuteTarget: vessel.chuteTarget,
    chuteState: vessel.chuteState,
    warpIndex: state.warpIndex || 0,
    warpSpeed: gear.speed,
    rails: gear.rails,
    inOrbit,
    time: state.time,
    outcome: state.outcome,
  };
}

export function formatSpeed(v) {
  const a = Math.abs(v);
  if (a < 1000) return (a < 100 ? a.toFixed(1) : a.toFixed(0)) + " m/s";
  return (a / 1000).toFixed(2) + " km/s";
}

export function formatAlt(m) {
  if (!Number.isFinite(m)) return "—";
  const sign = m < 0 ? "-" : "";
  const a = Math.abs(m);
  if (a < 1000) return sign + a.toFixed(0) + " m";
  if (a < 100000) return sign + (a / 1000).toFixed(1) + " km";
  return sign + (a / 1000).toFixed(0) + " km";
}

export function shouldShowVelocityArrow(speed) {
  return speed >= 12;
}

export { G0, massProps, partMass };
