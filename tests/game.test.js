import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { COPY, LANDING, PICKER } from "../js/data.js";
import {
  artRocket,
  buildStatus,
  compileVessel,
  hopRocket,
  layoutParts,
  placePart,
  removeSubtree,
} from "../js/rocket.js";
import {
  altitude,
  createFlight,
  fuelFrac,
  shouldShowVelocityArrow,
  speedOf,
  step,
} from "../js/sim.js";
import { createStore } from "../js/store.js";

function mem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const idle = { throttle: 0, left: false, right: false, separate: false, deploy: false };

test("picker is the eight locked parts and hides fairings", () => {
  assert.deepEqual(PICKER.order, [
    "cmd-pod",
    "tank-short",
    "tank-long",
    "engine-liquid",
    "booster-solid",
    "decoupler",
    "parachute",
    "adapter",
  ]);
  assert.equal(PICKER.order.includes("fairing"), false);
});

test("no-fuel message matches the locked sentence", () => {
  let parts = [];
  parts = placePart(parts, "cmd-pod", null).parts;
  const pod = parts[0];
  parts = placePart(parts, "engine-liquid", { parentUid: pod.uid, parentJoint: "bottom" }).parts;
  const status = buildStatus(parts);
  assert.equal(status.ok, false);
  assert.equal(status.text, "这级还没有燃料，加上储箱再试飞。");
  assert.equal(status.text, COPY.build.noFuel);
});

test("art rocket is ready to fly and boosters flank the tank", () => {
  const parts = artRocket();
  const status = buildStatus(parts);
  assert.equal(status.ok, true);
  assert.ok(status.twr > 1, "twr " + status.twr);
  const layout = layoutParts(parts);
  const tank = parts.find((p) => p.defId === "tank-long");
  const tankBox = layout.get(tank.uid);
  const boosters = parts.filter((p) => p.defId === "booster-solid");
  assert.equal(boosters.length, 2);
  const flips = boosters.map((b) => layout.get(b.uid).flip).sort();
  assert.deepEqual(flips, [false, true]);
  for (const b of boosters) {
    const box = layout.get(b.uid);
    const bodyLeft = box.flip ? box.x + (120 - 109) : box.x + 33;
    const bodyRight = box.flip ? box.x + (120 - 33) : box.x + 109;
    if (box.flip) {
      const gap = tankBox.x + 6 - bodyRight;
      assert.ok(Math.abs(gap) < 14, "left gap " + gap);
    } else {
      const gap = bodyLeft - (tankBox.x + 136);
      assert.ok(Math.abs(gap) < 14, "right gap " + gap);
    }
  }
  const pod = layout.get(parts.find((p) => p.defId === "cmd-pod").uid);
  const engine = layout.get(parts.find((p) => p.defId === "engine-liquid").uid);
  assert.ok(engine.y > pod.y);
});

test("undo-sized delete removes the subtree and a second pod is refused", () => {
  let parts = hopRocket();
  const tank = parts.find((p) => p.defId === "tank-short");
  parts = removeSubtree(parts, tank.uid);
  assert.equal(parts.some((p) => p.defId === "engine-liquid"), false);
  assert.equal(parts.some((p) => p.defId === "cmd-pod"), true);
  const again = placePart(parts, "cmd-pod", null);
  assert.equal(again.error, "one-pod");
});

test("tank-first build still compiles around the pod", () => {
  let parts = [];
  parts = placePart(parts, "tank-short", null).parts;
  const tank = parts[0];
  parts = placePart(parts, "cmd-pod", { parentUid: tank.uid, parentJoint: "top" }).parts;
  parts = placePart(parts, "engine-liquid", { parentUid: tank.uid, parentJoint: "bottom" }).parts;
  const vessel = compileVessel(parts);
  const pod = vessel.parts.find((p) => p.role === "pod");
  const engine = vessel.parts.find((p) => p.role === "engine");
  assert.equal(pod.parentUid, null);
  assert.ok(engine.localY < pod.localY);
});

test("staging drops boosters first, then the lower stage", () => {
  const state = createFlight(compileVessel(artRocket()));
  const first = step(state, { ...idle, separate: true }, 0.05);
  const vessel = first.state.vessels.find((v) => v.id === first.state.activeId);
  assert.equal(vessel.parts.some((p) => p.role === "booster"), false);
  assert.equal(first.state.vessels.length, 3);
  assert.equal(first.events.some((e) => e.code === "staged-boosters"), true);
  const second = step(first.state, { ...idle, separate: true }, 0.05);
  const upper = second.state.vessels.find((v) => v.id === second.state.activeId);
  assert.equal(upper.parts.some((p) => p.role === "engine"), false);
  assert.equal(upper.parts.some((p) => p.role === "pod"), true);
  assert.equal(second.events.some((e) => e.code === "staged-core"), true);
});

test("a hop burns fuel, climbs, and still answers the stick", () => {
  let state = createFlight(compileVessel(hopRocket()));
  const before = fuelFrac(state.vessels[0]);
  for (let i = 0; i < 40; i += 1) state = step(state, { ...idle, throttle: 1 }, 0.05).state;
  const vessel = state.vessels.find((v) => v.id === state.activeId);
  assert.ok(fuelFrac(vessel) < before);
  assert.ok(state.maxAlt > 40, "maxAlt " + state.maxAlt);
  assert.equal(state.outcome, null);
});

test("removing a placed part drops that part and what hangs on it", () => {
  let parts = hopRocket();
  const tank = parts.find((p) => p.defId === "tank-short");
  const engine = parts.find((p) => p.defId === "engine-liquid");
  assert.ok(tank && engine);
  parts = removeSubtree(parts, tank.uid);
  assert.equal(parts.some((p) => p.uid === tank.uid), false);
  assert.equal(parts.some((p) => p.uid === engine.uid), false);
  assert.equal(parts.some((p) => p.defId === "cmd-pod"), true);
});

test("part taps are not covered by the empty node layer", () => {
  const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /#nodes\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.node\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(css, /\.sprite\s*\{[^}]*pointer-events:\s*auto/);
});

test("tipping over on the pad crashes instead of sliding", () => {
  let state = createFlight(compileVessel(hopRocket()));
  for (let i = 0; i < 240 && !state.outcome; i += 1) {
    state = step(state, { ...idle, right: true }, 0.05).state;
  }
  assert.equal(state.outcome, "crash");
  assert.ok(state.maxAlt < LANDING.leftPadAlt);
});

test("a fast ground impact becomes a failure after the three second delay", () => {
  const state = createFlight(compileVessel(hopRocket()));
  state.leftPad = true;
  state.vessels[0].vy = -260;
  const first = step(state, idle, 0.05);
  assert.equal(first.state.outcome, null);
  assert.ok(first.state.pendingFailure);
  let next = first.state;
  for (let i = 0; i < 80 && !next.outcome; i += 1) next = step(next, idle, 0.05).state;
  assert.equal(next.outcome, "crash");
  assert.ok(next.time >= 3);
});

test("a short steering hold is a tilt, not horizontal", () => {
  let state = createFlight(compileVessel(hopRocket()));
  for (let i = 0; i < 10; i += 1) state = step(state, { ...idle, right: true }, 0.05).state;
  const att = Math.abs(state.vessels[0].att);
  assert.equal(state.outcome, null);
  assert.ok(att > 0.05, "moved " + att);
  assert.ok(att < 0.45, "too far " + att);
});

test("a gentle tilt on the pad does not crash", () => {
  let state = createFlight(compileVessel(hopRocket()));
  state.vessels[0].att = 0.25;
  for (let i = 0; i < 20; i += 1) state = step(state, { ...idle, throttle: 1 }, 0.05).state;
  assert.equal(state.outcome, null);
});

test("retry at rest does not show the velocity arrow", () => {
  let state = createFlight(compileVessel(hopRocket()));
  for (let i = 0; i < 30; i += 1) state = step(state, idle, 0.05).state;
  const speed = speedOf(state.vessels[0]);
  assert.ok(speed < 12, "speed " + speed);
  assert.equal(shouldShowVelocityArrow(speed), false);
  assert.equal(shouldShowVelocityArrow(0), false);
  assert.equal(LANDING.settleSpeed, 2);
});

test("worlds save in this project's own json", () => {
  const storage = mem();
  const store = createStore(storage);
  const worlds = store.list();
  assert.equal(worlds[0].name, "青芽一号");
  assert.equal(worlds[1].name, "试飞场");
  const made = store.create("新的航程");
  assert.equal(made.name, "新的航程");
  store.update(made.id, { activity: "已着陆" });
  const again = createStore(storage);
  assert.equal(again.get(made.id).activity, "已着陆");
  const raw = storage.getItem("taikong-gongfang-play-v2");
  assert.equal(raw.includes("sfs"), false);
  assert.equal(JSON.parse(raw).v, 2);
});
