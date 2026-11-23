/**
 * 飞行画面：近处跟随机体，远处能看到星球和轨道。
 * 地图是同一套世界坐标，只是镜头拉开、不再把地平线转正。
 */

import { HOME, MOON, bodyGlobal, getBody, terrainRadius } from "./bodies.js";
import { SCALE, getPart } from "./data.js";
import { keplerAdvance, orbitalElements } from "./physics.js";
import { flightInfo, localToWorld, vesselBasis } from "./sim.js";

const cache = new Map();

export function loadImages(urls) {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          if (!url || cache.has(url)) {
            resolve();
            return;
          }
          const img = new Image();
          img.onload = () => {
            cache.set(url, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  );
}

function imageFor(url) {
  return url ? cache.get(url) : null;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function worldToScreen(x, y, cam, w, h) {
  const dx = x - cam.focusX;
  const dy = y - cam.focusY;
  const c = Math.cos(cam.rot);
  const s = Math.sin(cam.rot);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return { x: w / 2 + lx * cam.ppm, y: h / 2 - ly * cam.ppm };
}

function screenAngle(dx, dy, cam) {
  const c = Math.cos(cam.rot);
  const s = Math.sin(cam.rot);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.atan2(lx, ly);
}

export function craftHeight(vessel) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of vessel.parts || []) {
    if (part.dead) continue;
    minY = Math.min(minY, part.localY - part.halfH);
    maxY = Math.max(maxY, part.localY + part.halfH);
  }
  if (!Number.isFinite(minY)) return 12;
  return Math.max(4, maxY - minY);
}

/**
 * 飞行视图始终画零件贴图。船在屏幕上矮于 8 像素时才额外加定位点，
 * 这个点不代替贴图。地图上的小三角也只是叠加的轨道图标。
 */
export function vesselPresentation(ppm, heightM) {
  const pixels = Math.max(0, ppm) * Math.max(heightM || 1, 1);
  return { sprites: true, marker: pixels < 8 };
}

export function cameraFor(info, w, h, cam) {
  const zoom = cam.zoom || 1;
  const body = info.body;
  if (cam.map) {
    const apoR = body.radius + Math.max(info.apoAlt || 0, info.radialAlt, body.atmosphereHeight || 0);
    const reach = Math.max(body.radius * 1.45, apoR * 1.2);
    return {
      focusX: 0,
      focusY: 0,
      rot: 0,
      ppm: clamp(((Math.min(w, h) * 0.78) / (reach * 2)) * zoom, 1e-8, 4),
      map: true,
    };
  }
  const alt = Math.max(info.radialAlt, 1);
  const heightM = craftHeight(info.vessel);
  let ppm;
  if (alt < 220) ppm = 12;
  else if (alt < 3500) ppm = Math.max(4.5, 12 * (220 / alt) ** 0.55);
  else ppm = Math.max(72 / heightM, 4.5 * (3500 / alt) ** 0.45);
  ppm = clamp(ppm * zoom, Math.min(w, h) / (body.radius * 14), 42);
  const vessel = info.vessel;
  const dist = Math.hypot(vessel.x, vessel.y) || 1;
  const sink = alt < 90 ? 18 : 0;
  return {
    focusX: vessel.x - (vessel.x / dist) * sink,
    focusY: vessel.y - (vessel.y / dist) * sink,
    rot: Math.atan2(vessel.y, vessel.x) - Math.PI / 2,
    ppm,
    map: false,
  };
}

function sky(ctx, w, h, alt) {
  const space = clamp((alt - 2500) / 24000, 0, 1);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * space));
  const css = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const top = mix([110, 186, 232], [6, 10, 18]);
  const mid = mix([176, 214, 236], [16, 36, 58]);
  const bot = mix([232, 244, 250], [10, 18, 28]);
  g.addColorStop(0, css(top));
  g.addColorStop(0.55, css(mid));
  g.addColorStop(1, css(bot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (space > 0.15) {
    ctx.globalAlpha = (space - 0.15) / 0.85;
    ctx.fillStyle = "#f4f7fb";
    for (let i = 0; i < 70; i += 1) {
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const b = Math.sin(i * 78.233) * 24634.6345;
      const x = (a - Math.floor(a)) * w;
      const y = (b - Math.floor(b)) * h;
      ctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 2));
    }
    ctx.globalAlpha = 1;
  }
}

function drawBodyDisk(ctx, body, ox, oy, cam, w, h) {
  const center = worldToScreen(ox, oy, cam, w, h);
  const rPx = body.radius * cam.ppm;
  if (rPx < 0.6) return;
  if (rPx > Math.max(w, h) * 2.6) {
    const focusAng = Math.atan2(cam.focusY - oy, cam.focusX - ox);
    const span = clamp((w / cam.ppm / body.radius) * 1.8, 0.004, Math.PI * 1.4);
    ctx.beginPath();
    const steps = 42;
    for (let i = 0; i <= steps; i += 1) {
      const ang = focusAng - span / 2 + (span * i) / steps;
      const rr = terrainRadius(body, ang);
      const p = worldToScreen(ox + Math.cos(ang) * rr, oy + Math.sin(ang) * rr, cam, w, h);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(w + 80, h + 120);
    ctx.lineTo(-80, h + 120);
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, center.y - 40, 0, h);
    grd.addColorStop(0, "#c2b48a");
    grd.addColorStop(0.18, "#7f9a52");
    grd.addColorStop(1, "#3d5826");
    ctx.fillStyle = grd;
    ctx.fill();
    return;
  }
  ctx.beginPath();
  const steps = rPx > 80 ? 120 : 48;
  for (let i = 0; i <= steps; i += 1) {
    const ang = (i / steps) * Math.PI * 2;
    const rr = terrainRadius(body, ang);
    const p = worldToScreen(ox + Math.cos(ang) * rr, oy + Math.sin(ang) * rr, cam, w, h);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  const fill = ctx.createRadialGradient(center.x - rPx * 0.25, center.y - rPx * 0.3, rPx * 0.2, center.x, center.y, rPx);
  fill.addColorStop(0, "#d5e2a4");
  fill.addColorStop(0.45, "#6f8a48");
  fill.addColorStop(1, "#2c461c");
  ctx.fillStyle = fill;
  ctx.fill();
  if (body.atmosphereHeight && body.atmosphereHeight * cam.ppm > 1.5) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, (body.radius + body.atmosphereHeight) * cam.ppm, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(170, 214, 245, 0.45)";
    ctx.lineWidth = Math.max(1.5, body.atmosphereHeight * cam.ppm);
    ctx.stroke();
  }
  const pad = worldToScreen(
    ox + Math.cos(body.padAngle || 0) * body.radius,
    oy + Math.sin(body.padAngle || 0) * body.radius,
    cam,
    w,
    h,
  );
  if (rPx > 18) {
    ctx.fillStyle = "#f0d78a";
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, Math.max(2, Math.min(6, rPx * 0.015)), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f7fb";
    ctx.font = "12px 'WenQuanYi Micro Hei', 'Noto Sans CJK SC', sans-serif";
    ctx.fillText(body.name, center.x + 8, center.y);
  }
}

function drawMoon(ctx, flight, cam, w, h) {
  const vessel = flight.vessels.find((v) => v.id === flight.activeId);
  if (!vessel || vessel.bodyId !== HOME.id) return;
  const t = flight.time || 0;
  const moon = bodyGlobal(MOON.id, t);
  const home = bodyGlobal(HOME.id, t);
  const ox = moon.x - home.x;
  const oy = moon.y - home.y;
  drawBodyDisk(ctx, MOON, ox, oy, cam, w, h);
  if (!cam.map) return;
  ctx.beginPath();
  const steps = 64;
  for (let i = 0; i <= steps; i += 1) {
    const ang = (i / steps) * Math.PI * 2;
    const p = worldToScreen(Math.cos(ang) * MOON.sma, Math.sin(ang) * MOON.sma, cam, w, h);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = "rgba(214, 226, 240, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawOrbit(ctx, vessel, cam, w, h) {
  const body = getBody(vessel.bodyId) || HOME;
  const el = orbitalElements(vessel.x, vessel.y, vessel.vx, vessel.vy, body.mu);
  if (!el || !el.n || el.e >= 0.985) return;
  const period = (Math.PI * 2) / el.n;
  ctx.beginPath();
  let moved = false;
  for (let i = 0; i <= 80; i += 1) {
    const p = keplerAdvance(vessel.x, vessel.y, vessel.vx, vessel.vy, body.mu, (period * i) / 80);
    if (!p) return;
    const s = worldToScreen(p.x, p.y, cam, w, h);
    if (!moved) {
      ctx.moveTo(s.x, s.y);
      moved = true;
    } else ctx.lineTo(s.x, s.y);
  }
  ctx.strokeStyle = "rgba(255, 220, 140, 0.9)";
  ctx.lineWidth = cam.map ? 2 : 1.25;
  ctx.stroke();
}

function spriteOf(part, vessel, thrusting) {
  if (part.role === "chute" && vessel.chuteState > 0.12) {
    const def = getPart("parachute");
    const which = vessel.chuteState >= 1.05 ? "open" : "mid";
    const spec = def.spriteSize[which];
    return {
      src: def.sprites[which],
      w: spec.w,
      h: spec.h,
      ocx: (spec.opaque.l + spec.opaque.r) / 2,
      ocy: (spec.opaque.t + spec.opaque.b) / 2,
    };
  }
  if (part.role === "engine" && thrusting && part.plume) {
    return { src: part.plume, w: part.spriteW, h: part.plumeH, ocx: part.ocx, ocy: part.ocy };
  }
  return { src: part.src, w: part.spriteW, h: part.spriteH, ocx: part.ocx, ocy: part.ocy };
}

function drawLocator(ctx, x, y, angle, map) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineWidth = 1.5;
  if (map) {
    ctx.fillStyle = "#fff4d2";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.5, 6);
    ctx.lineTo(-4.5, 6);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = "#fff4d2";
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.moveTo(0, -9);
    ctx.lineTo(0, -4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVessel(ctx, vessel, cam, w, h, thrusting) {
  const basis = vesselBasis(vessel);
  const origin = worldToScreen(vessel.x, vessel.y, cam, w, h);
  const nose = screenAngle(basis.nose.x, basis.nose.y, cam);
  const heightM = craftHeight(vessel);
  const view = vesselPresentation(cam.ppm, heightM);
  const parts = vessel.parts.filter((p) => !p.dead);
  parts.sort((a, b) => (a.role === "booster" ? 1 : 0) - (b.role === "booster" ? 1 : 0));
  if (view.sprites) {
    for (const part of parts) {
      const at = localToWorld(vessel, basis, part.localX, part.localY);
      const s = worldToScreen(at.x, at.y, cam, w, h);
      const spec = spriteOf(part, vessel, thrusting && vessel.controllable);
      const m = SCALE.mPerPx * cam.ppm;
      const img = imageFor(spec.src);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(nose);
      if (part.flip) ctx.scale(-1, 1);
      if (img) ctx.drawImage(img, -spec.ocx * m, -spec.ocy * m, spec.w * m, spec.h * m);
      else {
        ctx.fillStyle = part.role === "engine" ? "#c4552a" : "#d5deea";
        ctx.fillRect(-part.halfW * cam.ppm, -part.halfH * cam.ppm, part.halfW * 2 * cam.ppm, part.halfH * 2 * cam.ppm);
      }
      ctx.restore();
    }
  }
  if (view.marker) drawLocator(ctx, origin.x, origin.y, nose, cam.map);
}

function drawVelocity(ctx, vessel, cam, w, h) {
  const speed = Math.hypot(vessel.vx, vessel.vy);
  if (speed < 12) return;
  const origin = worldToScreen(vessel.x, vessel.y, cam, w, h);
  const tip = worldToScreen(vessel.x + vessel.vx, vessel.y + vessel.vy, cam, w, h);
  const dx = tip.x - origin.x;
  const dy = tip.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  const reach = cam.map ? 28 : 78;
  const ux = (dx / len) * reach;
  const uy = (dy / len) * reach;
  ctx.strokeStyle = "#1a2430";
  ctx.fillStyle = "#1a2430";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(origin.x + ux, origin.y + uy);
  ctx.stroke();
  const ang = Math.atan2(uy, ux);
  ctx.beginPath();
  ctx.moveTo(origin.x + ux, origin.y + uy);
  ctx.lineTo(origin.x + ux - Math.cos(ang - 0.45) * 10, origin.y + uy - Math.sin(ang - 0.45) * 10);
  ctx.lineTo(origin.x + ux - Math.cos(ang + 0.45) * 10, origin.y + uy - Math.sin(ang + 0.45) * 10);
  ctx.fill();
}

export function drawScene(canvas, flight, camInput) {
  const info = flightInfo(flight);
  if (!info) return null;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.max(1, Math.floor(w * dpr));
  const ph = Math.max(1, Math.floor(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cam = cameraFor(info, w, h, camInput || { zoom: 1, map: false });
  sky(ctx, w, h, info.radialAlt);
  const body = info.body;
  drawBodyDisk(ctx, body, 0, 0, cam, w, h);
  if (body.id === HOME.id) drawMoon(ctx, flight, cam, w, h);
  const vessel = info.vessel;
  if (cam.map || info.radialAlt > 6000) drawOrbit(ctx, vessel, cam, w, h);
  for (const item of flight.vessels) {
    if (item.id === vessel.id) continue;
    drawVessel(ctx, item, cam, w, h, false);
  }
  drawVessel(ctx, vessel, cam, w, h, (vessel.throttle || 0) > 0.04 || vessel.thrusting);
  drawVelocity(ctx, vessel, cam, w, h);
  return cam;
}

export function partImageUrls() {
  const urls = [];
  for (const id of ["cmd-pod", "tank-short", "tank-long", "engine-liquid", "booster-solid", "decoupler", "parachute", "adapter"]) {
    const part = getPart(id);
    urls.push(part.src);
    if (part.plume) urls.push(part.plume);
    if (part.sprites) urls.push(...Object.values(part.sprites));
  }
  return urls;
}
