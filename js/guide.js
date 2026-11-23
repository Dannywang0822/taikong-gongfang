/**
 * 原创入轨演示：竖直起飞、重力转弯、远地点圆化、制动再入、开伞。
 * 玩家可以随时关掉它自己飞。
 */

import { activeVessel, flightInfo, step } from "./sim.js";
import { chuteBlocker, wrapPi } from "./physics.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function steer(info, target) {
  const err = wrapPi(target - info.att);
  return clamp(err * 2.6 - info.omega * 1.25, -1, 1);
}

function prograde(info) {
  return Math.atan2(info.vRt, info.vUp);
}

export function vesselHasEngine(vessel) {
  return vessel.parts.some((p) => p.role === "engine" && !p.dead);
}

function solidRemaining(vessel) {
  return vessel.parts.some((p) => p.role === "booster" && !p.dead && p.fuel > 0.03);
}

function sidesAttached(vessel) {
  return vessel.parts.some((p) => p.link === "side" && !p.dead);
}

export function guideInput(state, mode) {
  const info = flightInfo(state);
  const input = { throttle: 0, stick: 0, separate: false, deploy: false, warp: 0 };
  if (!info || state.outcome) return input;
  const vessel = info.vessel;
  const atmo = info.body.atmosphereHeight || 0;
  const targetApo = atmo + 14000;

  if (mode === "ascend") {
    if (sidesAttached(vessel) && !solidRemaining(vessel)) input.separate = true;
    if (info.inOrbit) {
      input.warp = info.radialAlt > atmo ? 5 : 0;
      input.stick = 0;
      return input;
    }
    const climbingOut = info.apoAlt < targetApo || info.radialAlt < 10000;
    const nearApo = Number.isFinite(info.timeToApo) && info.timeToApo < 35 && info.radialAlt > atmo * 0.85;
    if (climbingOut && info.radialAlt < atmo + 6000) {
      input.throttle = 1;
      let pitch = 0;
      if (info.radialAlt >= 800 && info.radialAlt < 16000) {
        pitch = ((info.radialAlt - 800) / 15200) * ((68 * Math.PI) / 180);
      } else if (info.radialAlt >= 16000) pitch = (78 * Math.PI) / 180;
      const target = info.speed > 80 && info.radialAlt > 18000 ? prograde(info) : pitch;
      input.stick = steer(info, target);
      input.warp = 0;
      return input;
    }
    if (info.periAlt < atmo + 3500 && (nearApo || info.vUp < 40) && info.apoAlt > atmo) {
      input.throttle = info.vUp < -30 && info.radialAlt < info.apoAlt * 0.55 ? 0 : 1;
      if (info.radialAlt < atmo * 0.5 && info.vUp < 0) input.throttle = 0;
      input.stick = steer(info, prograde(info));
      input.warp = 0;
      return input;
    }
    input.throttle = 0;
    input.stick = steer(info, prograde(info));
    const soon = info.timeToApo < 70;
    input.warp = info.radialAlt > atmo ? (soon ? 2 : 5) : info.radialAlt > 8000 ? 2 : 0;
    return input;
  }

  if (mode === "deorbit") {
    if (info.periAlt > 12000 && info.fuel > 0.02 && vesselHasEngine(vessel)) {
      input.throttle = info.periAlt > 20000 ? 0.45 : 0.2;
      input.stick = steer(info, wrapPi(prograde(info) + Math.PI));
      input.warp = 0;
      return input;
    }
    input.throttle = 0;
    input.stick = steer(info, 0);
    if (vesselHasEngine(vessel)) input.separate = true;
    input.warp = info.radialAlt > atmo + 1500 ? 2 : 0;
    return input;
  }

  if (mode === "reentry") {
    if (vesselHasEngine(vessel)) input.separate = true;
    input.throttle = 0;
    input.stick = steer(info, 0);
    const block = chuteBlocker({
      hasChute: vessel.chuteTarget >= 0,
      target: Math.max(0, vessel.chuteTarget),
      atmosphereHeight: atmo,
      altitude: info.radialAlt,
      terrainAlt: info.alt,
      speed: info.speed,
      multiplier: info.body.parachuteMultiplier || 1,
    });
    if (vessel.chuteTarget === 0 && !block) input.deploy = true;
    if (info.alt > 8000) input.warp = 2;
    else input.warp = 0;
    return input;
  }

  input.warp = info.radialAlt > atmo ? 5 : 0;
  return input;
}

export function runMission(state, options = {}) {
  let mode = "ascend";
  const trace = [];
  const max = options.maxSteps || 180000;
  let deorbitMarked = false;
  for (let i = 0; i < max && !state.outcome; i += 1) {
    const info = flightInfo(state);
    if (!info) break;
    if (mode === "ascend" && info.inOrbit) {
      trace.push({
        event: "orbit",
        t: state.time,
        alt: info.radialAlt,
        peri: info.periAlt,
        apo: info.apoAlt,
        e: info.e,
      });
      if (options.stopAtOrbit) break;
      mode = "deorbit";
    }
    const vessel = activeVessel(state);
    if (mode === "deorbit" && !deorbitMarked && info.periAlt < 11000 && !vesselHasEngine(vessel)) {
      deorbitMarked = true;
      trace.push({ event: "deorbit", t: state.time, peri: info.periAlt, alt: info.radialAlt });
      mode = "reentry";
    }
    if (mode === "reentry" && info.chuteState > 0.4 && !trace.some((item) => item.event === "chute")) {
      trace.push({ event: "chute", t: state.time, alt: info.alt, speed: info.speed });
    }
    const input = guideInput(state, mode);
    const result = step(state, input, 1 / 30);
    state = result.state;
    if (options.log && i % 4000 === 0) {
      const now = flightInfo(state);
      console.log(
        mode,
        "t",
        now.time.toFixed(0),
        "alt",
        now.radialAlt.toFixed(0),
        "spd",
        now.speed.toFixed(0),
        "apo",
        now.apoAlt.toFixed(0),
        "peri",
        now.periAlt.toFixed(0),
        "e",
        now.e.toFixed(3),
        "att",
        now.att.toFixed(2),
        "up",
        now.vUp.toFixed(0),
        "warp",
        now.warpIndex,
        "fuel",
        now.fuel.toFixed(2),
        "out",
        state.outcome,
      );
    }
  }
  return { state, mode, trace, info: flightInfo(state) };
}
