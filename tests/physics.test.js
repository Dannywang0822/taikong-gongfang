import assert from "node:assert/strict";
import test from "node:test";

import { HOME, MOON, SUN, bodyGlobal, toGlobal } from "../js/bodies.js";
import { CONTROL, STAGE } from "../js/data.js";
import { artRocket, compileVessel, hopRocket } from "../js/rocket.js";
import { runMission } from "../js/guide.js";
import {
  CHUTE,
  G0,
  IMPACT,
  WARP,
  airDensity,
  allowedWarpIndex,
  chuteBlocker,
  chuteCurve,
  fuelRequest,
  gravityAccel,
  impactBreaks,
  impactScore,
  keplerAdvance,
  massProps,
  specificAngularMomentum,
  specificEnergy,
  thrustForce,
  warpGear,
} from "../js/physics.js";
import { createFlight, flightInfo, fuelFrac, massProps as simMass, step } from "../js/sim.js";

const idle = { throttle: 0, stick: 0, separate: false, deploy: false, warp: 0 };

test("surface gravity and inverse-square field use μ = g R²", () => {
  assert.equal(G0, 9.8);
  assert.equal(HOME.radius, 314970);
  assert.equal(HOME.gravity, 9.8);
  assert.ok(Math.abs(HOME.mu - HOME.gravity * HOME.radius * HOME.radius) < 1);
  const g = gravityAccel(HOME.mu, 0, HOME.radius);
  assert.ok(Math.abs(g.g - 9.8) < 1e-9);
  assert.ok(g.y < 0);
  const far = gravityAccel(HOME.mu, 0, HOME.radius * 2);
  assert.ok(Math.abs(far.g - 9.8 / 4) < 1e-9);
  const origin = gravityAccel(HOME.mu, 0, 0);
  assert.equal(origin.x, 0);
  assert.equal(origin.y, 0);
});

test("atmosphere density matches the reference curve and is zero above the top", () => {
  assert.equal(HOME.atmosphereHeight, 30000);
  assert.equal(HOME.atmosphereDensity, 0.005);
  assert.equal(HOME.atmosphereCurve, 10);
  const sea = airDensity(HOME, 0);
  const expectSea = 0.005 * (1 - Math.exp(-10));
  assert.ok(Math.abs(sea - expectSea) < 1e-12);
  assert.equal(airDensity(HOME, 30000), 0);
  assert.equal(airDensity(HOME, 30000.1), 0);
  assert.ok(airDensity(HOME, 15000) < sea * 0.01);
  assert.equal(airDensity(MOON, 0), 0);
});

test("a circular orbit closes after one period and keeps energy", () => {
  const r = HOME.radius + 50000;
  const speed = Math.sqrt(HOME.mu / r);
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / HOME.mu);
  const next = keplerAdvance(r, 0, 0, speed, HOME.mu, period);
  assert.ok(next, "kepler");
  assert.ok(Math.hypot(next.x - r, next.y) < 1, "pos " + Math.hypot(next.x - r, next.y));
  assert.ok(Math.abs(next.vx) < 1e-3);
  assert.ok(Math.abs(next.vy - speed) < 1e-3, "vy " + next.vy);
  const half = keplerAdvance(r, 0, 0, speed, HOME.mu, period / 2);
  assert.ok(Math.hypot(half.x + r, half.y) < 1);
  const e0 = specificEnergy(r, 0, 0, speed, HOME.mu);
  const e1 = specificEnergy(next.x, next.y, next.vx, next.vy, HOME.mu);
  assert.ok(Math.abs(e1 - e0) / Math.abs(e0) < 1e-8);
});

test("vacuum coasting conserves energy and angular momentum", () => {
  const r = HOME.radius + 80000;
  const speed = Math.sqrt(HOME.mu / r);
  const vessel = compileVessel(hopRocket());
  vessel.x = r;
  vessel.y = 0;
  vessel.vx = 0;
  vessel.vy = speed;
  vessel.bodyId = HOME.id;
  const state = {
    vessels: [vessel],
    activeId: vessel.id,
    time: 0,
    warpIndex: 0,
    maxAlt: r,
    maxSpeed: speed,
    outcome: null,
    crashReason: null,
    pendingFailure: null,
    leftPad: true,
    notice: null,
  };
  const e0 = specificEnergy(vessel.x, vessel.y, vessel.vx, vessel.vy, HOME.mu);
  const h0 = specificAngularMomentum(vessel.x, vessel.y, vessel.vx, vessel.vy);
  let current = state;
  for (let i = 0; i < 1800; i += 1) current = step(current, idle, 1 / 30).state;
  const v = current.vessels[0];
  const e1 = specificEnergy(v.x, v.y, v.vx, v.vy, HOME.mu);
  const h1 = specificAngularMomentum(v.x, v.y, v.vx, v.vy);
  assert.ok(Math.abs(e1 - e0) / Math.abs(e0) < 2e-3, "energy " + (e1 - e0) / e0);
  assert.ok(Math.abs(h1 - h0) / Math.abs(h0) < 2e-3, "ang " + (h1 - h0) / h0);
  assert.equal(current.outcome, null);
});

test("burning fuel removes the same amount of mass", () => {
  const state = createFlight(compileVessel(hopRocket()));
  const before = simMass(state.vessels[0].parts);
  const fuelBefore = state.vessels[0].parts.reduce((s, p) => s + p.fuel, 0);
  let current = state;
  for (let i = 0; i < 20; i += 1) current = step(current, { ...idle, throttle: 1 }, 0.05).state;
  const vessel = current.vessels.find((v) => v.id === current.activeId);
  const after = simMass(vessel.parts);
  const fuelAfter = vessel.parts.reduce((s, p) => s + p.fuel, 0);
  const burned = fuelBefore - fuelAfter;
  assert.ok(burned > 0.1, "burned " + burned);
  assert.ok(Math.abs(before.mass - after.mass - burned) < 0.02, "mass " + (before.mass - after.mass));
  const q = fuelRequest(46, 1, 290);
  assert.ok(Math.abs(burned - q) < 0.02, "q " + q + " burned " + burned);
  assert.ok(Math.abs(thrustForce(46, 1) - 46 * 9.8) < 1e-6);
  assert.ok(fuelFrac(vessel) < 1);
});

test("parachute gates use the reference height, speed and animation", () => {
  assert.equal(CHUTE.maxDeployHeight, 2500);
  assert.equal(CHUTE.maxDeployVelocity, 250);
  assert.equal(CHUTE.minSpeed, 3);
  assert.equal(CHUTE.animationTime, 3);
  assert.equal(chuteCurve(0), 0);
  assert.ok(Math.abs(chuteCurve(1) - 15) < 1e-9);
  assert.ok(Math.abs(chuteCurve(2) - 250) < 1e-9);
  const base = {
    hasChute: true,
    target: 0,
    atmosphereHeight: 30000,
    altitude: 2000,
    terrainAlt: 2000,
    speed: 40,
    multiplier: 1,
  };
  assert.equal(chuteBlocker(base), null);
  assert.equal(chuteBlocker({ ...base, terrainAlt: 2600, altitude: 2600 }), "high");
  assert.equal(chuteBlocker({ ...base, speed: 260 }), "fast");
  assert.equal(chuteBlocker({ ...base, speed: 1 }), "slow");
  assert.equal(chuteBlocker({ ...base, hasChute: false }), "none");
  assert.equal(chuteBlocker({ ...base, altitude: 28000, terrainAlt: 2000 }), "high");
});

test("impact score equals closing speed head-on, and equality still breaks", () => {
  const score = impactScore(0, -12.5, 0, 1);
  assert.ok(Math.abs(score - 12.5) < 1e-9, "score " + score);
  assert.equal(IMPACT.low, 2.5);
  assert.equal(IMPACT.medium, 5.5);
  assert.equal(IMPACT.high, 12.5);
  assert.equal(impactBreaks(2.5, "low"), true);
  assert.equal(impactBreaks(2.499, "low"), false);
  assert.equal(impactBreaks(5.5, "medium"), true);
  assert.equal(impactBreaks(12.49, "high"), false);
  const graze = impactScore(30, 0, 0, 1);
  assert.ok(Math.abs(graze - 10) < 1e-9, "graze " + graze);
});

test("time warp follows the normal gear table and blocks rails in the air", () => {
  const speeds = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => warpGear(i).speed);
  assert.deepEqual(speeds, [1, 2, 3, 5, 25, 100, 500, 2500]);
  assert.equal(warpGear(2).rails, false);
  assert.equal(warpGear(3).rails, true);
  assert.equal(WARP.maxPhysicsIndex, 2);
  assert.equal(allowedWarpIndex({ thrusting: true, chuteBusy: false, altitude: 40000, atmosphereHeight: 30000 }), 0);
  assert.equal(allowedWarpIndex({ thrusting: false, chuteBusy: true, altitude: 40000, atmosphereHeight: 30000 }), 0);
  assert.equal(allowedWarpIndex({ thrusting: false, chuteBusy: false, altitude: 1000, atmosphereHeight: 30000 }), 2);
  assert.equal(allowedWarpIndex({ thrusting: false, chuteBusy: false, altitude: 40000, atmosphereHeight: 30000 }), 7);

  const low = createFlight(compileVessel(hopRocket()));
  low.leftPad = true;
  const held = step(low, { ...idle, throttle: 1, warp: 6 }, 1 / 30).state;
  assert.equal(held.warpIndex, 0);

  const high = createFlight(compileVessel(hopRocket()));
  high.leftPad = true;
  high.vessels[0].y = HOME.radius + 40000;
  high.vessels[0].x = 0;
  high.vessels[0].vx = Math.sqrt(HOME.mu / high.vessels[0].y);
  high.vessels[0].vy = 0;
  const coast = step(high, { ...idle, warp: 5 }, 1 / 30).state;
  assert.equal(coast.warpIndex, 5);
  assert.ok(coast.time > 1, "time " + coast.time);
});

test("staging splits the ship and pushes the pieces apart", () => {
  const state = createFlight(compileVessel(artRocket()));
  const ids = new Set(state.vessels[0].parts.map((p) => p.uid));
  const first = step(state, { ...idle, separate: true }, 0.05);
  const vessel = first.state.vessels.find((v) => v.id === first.state.activeId);
  assert.equal(vessel.parts.some((p) => p.role === "booster"), false);
  assert.equal(first.state.vessels.length, 3);
  const debris = first.state.vessels.filter((v) => v.id !== vessel.id);
  for (const piece of debris) {
    const mass = massProps(piece.parts).mass;
    const impulse = STAGE.force * STAGE.multiplier * STAGE.frame;
    const kick = impulse / mass;
    const rel = Math.hypot(piece.vx - vessel.vx, piece.vy - vessel.vy);
    assert.ok(rel > kick * 0.5, "rel " + rel + " kick " + kick);
    assert.ok(rel < kick * 2.5, "rel " + rel + " kick " + kick);
  }
  const second = step(first.state, { ...idle, separate: true }, 0.05);
  const upper = second.state.vessels.find((v) => v.id === second.state.activeId);
  const all = second.state.vessels.flatMap((v) => v.parts.map((p) => p.uid));
  assert.equal(new Set(all).size, ids.size);
  assert.equal(all.length, ids.size);
  assert.equal(upper.parts.some((p) => p.role === "engine"), false);
  assert.equal(upper.parts.some((p) => p.role === "pod"), true);
  assert.equal(CONTROL.rcsThrust, 1.5);
  assert.equal(CONTROL.rcsIsp, 120);
});

test("crossing a moon SOI reparents the vessel without a position jump", () => {
  assert.ok(MOON.soi > MOON.radius * 2);
  assert.ok(MOON.soi < MOON.sma * 0.5);
  assert.ok(HOME.soi > MOON.sma);
  assert.equal(SUN.soi, Infinity);
  const moon = bodyGlobal(MOON.id, 0);
  const home = bodyGlobal(HOME.id, 0);
  const mx = moon.x - home.x;
  const my = moon.y - home.y;
  const dist = Math.hypot(mx, my);
  const dirx = mx / dist;
  const diry = my / dist;
  const vessel = compileVessel(hopRocket());
  vessel.bodyId = HOME.id;
  vessel.x = mx + dirx * (MOON.soi + 40);
  vessel.y = my + diry * (MOON.soi + 40);
  vessel.vx = moon.vx - home.vx - dirx * 25;
  vessel.vy = moon.vy - home.vy - diry * 25;
  vessel.att = 0;
  const state = {
    vessels: [vessel],
    activeId: vessel.id,
    time: 0,
    warpIndex: 0,
    maxAlt: 0,
    maxSpeed: 0,
    outcome: null,
    pendingFailure: null,
    leftPad: true,
    crashReason: null,
  };
  let current = state;
  let prev = toGlobal(vessel.bodyId, vessel, 0);
  let switchJump = null;
  for (let i = 0; i < 200 && switchJump == null; i += 1) {
    const before = current.vessels[0].bodyId;
    current = step(current, idle, 1 / 40).state;
    const now = current.vessels[0];
    const global = toGlobal(now.bodyId, now, current.time);
    const jump = Math.hypot(global.x - prev.x, global.y - prev.y);
    if (now.bodyId === MOON.id && before !== MOON.id) switchJump = jump;
    prev = global;
  }
  assert.ok(switchJump != null, "never entered the moon SOI");
  const v = current.vessels[0];
  assert.ok(Math.hypot(v.x, v.y) <= MOON.soi + 1);
  assert.ok(switchJump < 2000, "jump " + switchJump);
  const outside = v.x * v.x + v.y * v.y > MOON.soi * MOON.soi;
  assert.equal(outside, false);
});

test("the scripted rocket reaches orbit, opens a chute, and lands", () => {
  const run = runMission(createFlight(compileVessel(artRocket())), { maxSteps: 160000 });
  const events = run.trace.map((item) => item.event);
  assert.ok(events.includes("orbit"), JSON.stringify(run.trace));
  assert.ok(events.includes("chute"));
  assert.equal(run.state.outcome, "land");
  const orbit = run.trace.find((item) => item.event === "orbit");
  assert.ok(orbit.peri > 30000, "peri " + orbit.peri);
  assert.ok(orbit.apo > 30000);
  const info = flightInfo(run.state);
  assert.ok(info.alt < 5);
  assert.ok(info.speed < 2);
  assert.ok(info.chuteState > 1.5);
});
