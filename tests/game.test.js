import assert from "node:assert/strict";
import test from "node:test";

import { CHUTE, COPY, PICKER, PLANET } from "../js/data.js";
import {
  artRocket,
  bareRocket,
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

test("gravity pulls a coasting rocket down", () => {
  const vessel = compileVessel(hopRocket());
  vessel.y = PLANET.radius + 1000;
  vessel.x = 0;
  const state = {
    vessels: [vessel],
    activeId: vessel.id,
    time: 0,
    maxAlt: 1000,
    maxSpeed: 0,
    outcome: null,
    leftPad: true,
  };
  const next = step(state, idle, 2).state;
  const v = next.vessels[0];
  assert.ok(altitude(v) < 990, "alt " + altitude(v));
  assert.ok(v.vy < 0);
});

test("throttle climbs, fuel burns, and a chute lands the hop", () => {
  let state = createFlight(compileVessel(hopRocket()));
  const before = fuelFrac(state.vessels[0]);
  for (let i = 0; i < 120; i += 1) state = step(state, { ...idle, throttle: 1 }, 0.05).state;
  const after = fuelFrac(state.vessels.find((v) => v.id === state.activeId));
  assert.ok(after < before);
  assert.ok(state.maxAlt > 40, "maxAlt " + state.maxAlt);
  let sent = false;
  for (let i = 0; i < 4000 && !state.outcome; i += 1) {
    const v = state.vessels.find((item) => item.id === state.activeId);
    const alt = altitude(v);
    const spd = speedOf(v);
    const deploy = !sent && v.chute === "stow" && alt < CHUTE.maxAlt && spd < CHUTE.maxSpeed && state.time > 8;
    if (deploy) sent = true;
    state = step(state, { ...idle, deploy }, 0.05).state;
  }
  assert.equal(state.outcome, "land", "outcome " + state.outcome + " alt " + state.maxAlt);
});

test("hitting the ground without a chute fails the flight", () => {
  let state = createFlight(compileVessel(bareRocket()));
  for (let i = 0; i < 100; i += 1) state = step(state, { ...idle, throttle: 1 }, 0.05).state;
  for (let i = 0; i < 4000 && !state.outcome; i += 1) state = step(state, idle, 0.05).state;
  assert.equal(state.outcome, "crash");
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
  const raw = storage.getItem("taikong-gongfang-p0-v1");
  assert.equal(raw.includes("sfs"), false);
  assert.equal(JSON.parse(raw).v, 1);
});
