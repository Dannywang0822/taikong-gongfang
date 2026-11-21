/**
 * 建造图与飞行器编译。
 * 吸附、燃料是否够飞、分离顺序都是自研规则，不是已证实的官方手势。
 */

import { PLANET, SCALE, getPart } from "./data.js";

const STACK_OVERLAP = 4;
const SIDE_OVERLAP = 8;

let seq = 1;

export function nextUid() {
  seq += 1;
  return "p" + seq.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function cloneParts(parts) {
  return parts.map((p) => ({ ...p }));
}

function selfJointFor(parentJoint) {
  if (parentJoint === "bottom") return "top";
  if (parentJoint === "top") return "bottom";
  if (parentJoint === "side-left" || parentJoint === "side-right") return "side";
  return null;
}

function linkFor(parentJoint) {
  return parentJoint && parentJoint.startsWith("side") ? "side" : "stack";
}

export function canRoot(def) {
  return def.attachAs === "stack" || def.attachAs === "nose" || def.attachAs === "engine";
}

function jointFree(parts, part, jointName) {
  if (parts.some((c) => c.parentUid === part.uid && c.parentJoint === jointName)) return false;
  if (part.selfJoint && part.selfJoint === jointName) return false;
  return true;
}

export function validTargets(parts, defId) {
  const def = getPart(defId);
  if (!def || !parts.length) return [];
  if (def.role === "pod" && parts.some((p) => getPart(p.defId).role === "pod")) return [];
  if (def.role === "engine" && parts.some((p) => getPart(p.defId).role === "engine")) return [];
  if (def.role === "chute" && parts.some((p) => getPart(p.defId).role === "chute")) return [];
  const out = [];
  for (const part of parts) {
    const host = getPart(part.defId);
    for (const [joint, node] of Object.entries(host.nodes)) {
      if (!node.accepts || !node.accepts.includes(def.attachAs)) continue;
      if (!jointFree(parts, part, joint)) continue;
      const selfJoint = selfJointFor(joint);
      if (!def.nodes[selfJoint]) continue;
      out.push({
        parentUid: part.uid,
        parentJoint: joint,
        selfJoint,
        link: linkFor(joint),
      });
    }
  }
  return out;
}

export function placePart(parts, defId, target) {
  const def = getPart(defId);
  if (!def) return { parts, error: "no-fit" };
  if (!parts.length) {
    if (target) return { parts, error: "no-fit" };
    if (!canRoot(def)) return { parts, error: "bad-root" };
    return {
      parts: [
        {
          uid: nextUid(),
          defId,
          parentUid: null,
          parentJoint: null,
          selfJoint: null,
          link: null,
        },
      ],
      error: null,
    };
  }
  if (def.role === "pod" && parts.some((p) => getPart(p.defId).role === "pod")) {
    return { parts, error: "one-pod" };
  }
  if (def.role === "engine" && parts.some((p) => getPart(p.defId).role === "engine")) {
    return { parts, error: "one-engine" };
  }
  if (def.role === "chute" && parts.some((p) => getPart(p.defId).role === "chute")) {
    return { parts, error: "one-chute" };
  }
  if (!target) return { parts, error: "need-node" };
  const ok = validTargets(parts, defId).find(
    (v) => v.parentUid === target.parentUid && v.parentJoint === target.parentJoint,
  );
  if (!ok) return { parts, error: "no-fit" };
  return {
    parts: parts.concat({
      uid: nextUid(),
      defId,
      parentUid: ok.parentUid,
      parentJoint: ok.parentJoint,
      selfJoint: ok.selfJoint,
      link: ok.link,
    }),
    error: null,
  };
}

export function removeSubtree(parts, uid) {
  const drop = new Set();
  const walk = (id) => {
    drop.add(id);
    for (const p of parts) if (p.parentUid === id) walk(p.uid);
  };
  walk(uid);
  return parts.filter((p) => !drop.has(p.uid));
}

function childNode(def, selfJoint, flip) {
  const node = def.nodes[selfJoint];
  if (!node) return { x: def.w / 2, y: 0 };
  if (selfJoint === "side" && flip) return { x: def.w - node.x, y: node.y };
  return node;
}

/**
 * 像素坐标，y 向下。左右助推按机体边缘贴上芯级，左侧镜像，让挂耳朝向芯级。
 */
export function layoutParts(parts) {
  const pos = new Map();
  if (!parts.length) return pos;
  const root = parts.find((p) => !p.parentUid) || parts[0];

  const place = (part, left, top, flip) => {
    pos.set(part.uid, { x: left, y: top, w: getPart(part.defId).w, h: getPart(part.defId).h, flip: !!flip });
    for (const child of parts) {
      if (child.parentUid !== part.uid) continue;
      const host = getPart(part.defId);
      const cd = getPart(child.defId);
      const parentNode = host.nodes[child.parentJoint];
      if (!parentNode) continue;
      if (child.parentJoint === "side-left" || child.parentJoint === "side-right") {
        const sideNode = cd.nodes.side;
        const bodyLeft = cd.bodyLeft ?? 33;
        let cx;
        let childFlip = false;
        if (child.parentJoint === "side-right") {
          cx = left + parentNode.x - SIDE_OVERLAP - bodyLeft;
        } else {
          childFlip = true;
          const flippedBodyRight = cd.w - bodyLeft;
          cx = left + parentNode.x + SIDE_OVERLAP - flippedBodyRight;
        }
        const cy = top + parentNode.y - sideNode.y;
        place(child, cx, cy, childFlip);
      } else {
        const sn = childNode(cd, child.selfJoint, false);
        let cx = left + parentNode.x - sn.x;
        let cy = top + parentNode.y - sn.y;
        if (child.parentJoint === "bottom") cy -= STACK_OVERLAP;
        if (child.parentJoint === "top") cy += STACK_OVERLAP;
        place(child, cx, cy, false);
      }
    }
  };
  place(root, 0, 0, false);
  return pos;
}

export function drawOrder(parts) {
  const core = [];
  const root = parts.find((p) => !p.parentUid);
  const walk = (uid) => {
    const part = parts.find((p) => p.uid === uid);
    if (!part || part.link === "side") return;
    core.push(part);
    for (const c of parts) if (c.parentUid === uid) walk(c.uid);
  };
  if (root) walk(root.uid);
  const sides = parts.filter((p) => p.link === "side");
  return core.concat(sides);
}

function massOf(parts) {
  let m = 0;
  for (const p of parts) {
    const d = getPart(p.defId);
    m += d.dry + (d.fuel || 0);
  }
  return m;
}

function thrustOf(parts) {
  let t = 0;
  for (const p of parts) {
    const d = getPart(p.defId);
    if (d.thrust) t += d.thrust;
  }
  return t;
}

/** 建造台底部那一行字。无燃料时用锁定稿里的原句。 */
export function buildStatus(parts) {
  if (!parts.length) {
    return { ok: false, code: "empty", text: "点选零件，再点亮起的接口。" };
  }
  const defs = parts.map((p) => getPart(p.defId));
  const hasPod = defs.some((d) => d.role === "pod");
  const hasEngine = defs.some((d) => d.role === "engine");
  const hasBooster = defs.some((d) => d.role === "booster");
  const hasLiquid = defs.some((d) => d.fuelType === "liquid" && d.fuel > 0);
  const hasSolid = defs.some((d) => d.fuelType === "solid" && d.fuel > 0);
  if (!hasPod) return { ok: false, code: "no-pod", text: "还没有指令舱。" };
  if (!hasEngine && !hasBooster) {
    return { ok: false, code: "no-engine", text: "还没有发动机或固体助推。" };
  }
  if (!hasLiquid && !hasSolid) {
    return { ok: false, code: "no-fuel", text: "这级还没有燃料，加上储箱再试飞。" };
  }
  const mass = massOf(parts);
  const thrust = thrustOf(parts);
  const twr = mass > 0 ? thrust / (mass * PLANET.g) : 0;
  if (twr < 1) {
    return {
      ok: true,
      code: "low-twr",
      text: "推力可能抬不起来，仍可以试飞。",
      twr,
      mass,
      thrust,
    };
  }
  return { ok: true, code: "ready", text: "可以试飞。", twr, mass, thrust };
}

export function reroot(parts, rootUid) {
  const byId = new Map(parts.map((p) => [p.uid, p]));
  const adj = new Map(parts.map((p) => [p.uid, []]));
  for (const p of parts) {
    if (!p.parentUid || !byId.has(p.parentUid)) continue;
    adj.get(p.uid).push({ uid: p.parentUid, dir: "up" });
    adj.get(p.parentUid).push({ uid: p.uid, dir: "down" });
  }
  const out = [];
  const seen = new Set([rootUid]);
  const q = [{ uid: rootUid, parentUid: null, link: null, parentJoint: null, selfJoint: null }];
  while (q.length) {
    const cur = q.shift();
    const src = byId.get(cur.uid);
    out.push({
      uid: src.uid,
      defId: src.defId,
      parentUid: cur.parentUid,
      link: cur.link,
      parentJoint: cur.parentJoint,
      selfJoint: cur.selfJoint,
    });
    for (const n of adj.get(cur.uid)) {
      if (seen.has(n.uid)) continue;
      seen.add(n.uid);
      let link;
      let parentJoint;
      let selfJoint;
      if (n.dir === "down") {
        const child = byId.get(n.uid);
        link = child.link;
        parentJoint = child.parentJoint;
        selfJoint = child.selfJoint;
      } else {
        const child = byId.get(cur.uid);
        link = child.link;
        parentJoint = child.selfJoint;
        selfJoint = child.parentJoint;
      }
      q.push({ uid: n.uid, parentUid: cur.uid, link, parentJoint, selfJoint });
    }
  }
  return out;
}

export function compileVessel(buildParts) {
  if (!buildParts.length) return null;
  const pod = buildParts.find((p) => getPart(p.defId).role === "pod");
  if (!pod) return null;
  const layout = layoutParts(buildParts);
  const podDef = getPart(pod.defId);
  const podBox = layout.get(pod.uid);
  const podCx = podBox.x + (podDef.opaque.l + podDef.opaque.r) / 2;
  const podCy = podBox.y + (podDef.opaque.t + podDef.opaque.b) / 2;
  const rooted = reroot(buildParts, pod.uid);
  const m = SCALE.mPerPx;
  const parts = rooted.map((p) => {
    const d = getPart(p.defId);
    const box = layout.get(p.uid);
    const ocx = (d.opaque.l + d.opaque.r) / 2;
    const ocy = (d.opaque.t + d.opaque.b) / 2;
    const wx = box.x + ocx;
    const wy = box.y + ocy;
    return {
      uid: p.uid,
      defId: p.defId,
      role: d.role,
      fuelType: d.fuelType,
      localX: (wx - podCx) * m,
      localY: -(wy - podCy) * m,
      halfW: ((d.opaque.r - d.opaque.l) / 2) * m,
      halfH: ((d.opaque.b - d.opaque.t) / 2) * m,
      dry: d.dry,
      fuel: d.fuel || 0,
      fuelMax: d.fuel || 0,
      thrust: d.thrust || 0,
      isp: d.isp || 1,
      parentUid: p.parentUid,
      link: p.link,
      ignited: false,
      flip: !!box.flip,
      spriteW: d.w,
      spriteH: d.h,
      ocx,
      ocy,
      src: d.src,
      plume: d.plume || null,
      plumeH: d.plumeH || d.h,
    };
  });
  return {
    id: "v" + Math.floor(Math.random() * 1e9).toString(36),
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    att: 0,
    omega: 0,
    chute: parts.some((p) => p.role === "chute") ? "stow" : "none",
    chuteT: 0,
    controllable: true,
    parts,
  };
}

function placeSeq(steps) {
  let parts = [];
  for (const [defId, pick] of steps) {
    const target = pick ? pick(parts) : null;
    const result = placePart(parts, defId, target);
    if (result.error) throw new Error(defId + ":" + result.error);
    parts = result.parts;
  }
  return parts;
}

function byDef(parts, defId, joint) {
  const host = parts.find((p) => p.defId === defId && jointFree(parts, p, joint));
  if (!host) throw new Error("no host " + defId + " " + joint);
  return { parentUid: host.uid, parentJoint: joint };
}

/** 和锁定组装图同一套堆叠：伞、舱、转接、短箱、分离器、长箱、发动机、两侧助推。 */
export function artRocket() {
  return placeSeq([
    ["cmd-pod", null],
    ["parachute", (ps) => byDef(ps, "cmd-pod", "top")],
    ["adapter", (ps) => byDef(ps, "cmd-pod", "bottom")],
    ["tank-short", (ps) => byDef(ps, "adapter", "bottom")],
    ["decoupler", (ps) => byDef(ps, "tank-short", "bottom")],
    ["tank-long", (ps) => byDef(ps, "decoupler", "bottom")],
    ["engine-liquid", (ps) => byDef(ps, "tank-long", "bottom")],
    ["booster-solid", (ps) => byDef(ps, "tank-long", "side-left")],
    ["booster-solid", (ps) => byDef(ps, "tank-long", "side-right")],
  ]);
}

/** 一发能跳起来再开伞的小火箭。 */
export function hopRocket() {
  return placeSeq([
    ["cmd-pod", null],
    ["parachute", (ps) => byDef(ps, "cmd-pod", "top")],
    ["tank-short", (ps) => byDef(ps, "cmd-pod", "bottom")],
    ["engine-liquid", (ps) => byDef(ps, "tank-short", "bottom")],
  ]);
}

export function bareRocket() {
  return placeSeq([
    ["cmd-pod", null],
    ["tank-short", (ps) => byDef(ps, "cmd-pod", "bottom")],
    ["engine-liquid", (ps) => byDef(ps, "tank-short", "bottom")],
  ]);
}

export const RULES_NOTE = {
  source: "估计",
  attach: "网格吸附是自研接口，不是已证实的官方磁吸规则。",
  fuel: "分离前，同一艘火箭上的液体燃料可以供给液体发动机。分离之后各飞各的。",
  physics: "重力、推力、阻力和开伞都是估计模型。",
};

