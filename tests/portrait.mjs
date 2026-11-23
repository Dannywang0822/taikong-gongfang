/**
 * 竖屏布局验收：390×844、360×780 走完主线，横屏回归，飞行中转向不丢状态。
 * 用法：node tests/portrait.mjs
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import puppeteer from "puppeteer-core";

const port = Number(process.env.PORT || 8771);
const outDir = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts";

function startServer() {
  return spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    stdio: "ignore",
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await delay(150);
  }
  throw new Error("静态服务器没有起来");
}

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, type: "png" });
  return file;
}

async function layoutAudit(page, kind) {
  return page.evaluate((kind) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const issues = [];
    const groups = {
      home: [".home-main .btn.primary", ".home-hero img", ".brand h2", ".sec"],
      worlds: ["#create-world", "#world-name", ".world"],
      build: ["#bench", "#fly", "#undo", "#detach", ".cell", ".msg"],
      flight: [
        "#thr",
        "#btn-left",
        "#btn-right",
        "#btn-stage",
        "#btn-chute",
        "#read-speed",
        "#read-alt",
        "#read-peri",
        "#read-apo",
        "#warp-up",
        "#warp-down",
        "#map-toggle",
        "#flight-menu",
        ".fuelchip",
        "#auto-flight",
      ],
      modal: [".modal h4", ".modal .btn.primary"],
    };
    for (const sel of groups[kind] || []) {
      const el = document.querySelector(sel);
      if (!el) {
        issues.push("missing " + sel);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) issues.push("tiny " + sel);
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        issues.push(`clip ${sel} @ ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (el.tagName === "BUTTON" && (el.scrollWidth > el.clientWidth + 3 || el.scrollHeight > el.clientHeight + 3)) {
        issues.push("text " + sel);
      }
    }
    const portrait = vh > vw;
    if (kind === "home") {
      const dir = getComputedStyle(document.querySelector(".home-safe")).flexDirection;
      if (portrait && dir !== "column") issues.push("home " + dir);
      if (!portrait && dir !== "row") issues.push("home " + dir);
      const btn = document.querySelector(".home-main .btn.primary").getBoundingClientRect();
      if (portrait && btn.top < vh * 0.35) issues.push("home button too high");
    }
    if (kind === "build") {
      const fly = document.querySelector("#fly").getBoundingClientRect();
      const cell = document.querySelector(".cell").getBoundingClientRect();
      if (portrait && fly.height < 44) issues.push("fly short");
      if (portrait && fly.top < vh * 0.62) issues.push("fly not in thumb zone");
      if (portrait && cell.bottom > fly.top + 1) issues.push("parts cover fly");
    }
    if (kind === "flight") {
      const dir = getComputedStyle(document.querySelector(".flight-bar")).flexDirection;
      if (portrait && dir !== "column") issues.push("bar " + dir);
      if (!portrait && dir !== "row") issues.push("bar " + dir);
      const ids = ["#btn-left", "#btn-right", "#btn-stage", "#btn-chute", "#thr", "#flight-menu", ".fuelchip", "#auto-flight"];
      const rects = ids.map((id) => [id, document.querySelector(id).getBoundingClientRect()]);
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i][1];
          const b = rects[j][1];
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 3 && oy > 3) issues.push(`overlap ${rects[i][0]} ${rects[j][0]}`);
        }
      }
      const left = rects[0][1];
      if (portrait && left.top < vh * 0.5) issues.push("steer too high");
      if (portrait && left.height < 44) issues.push("steer short");
    }
    if (document.documentElement.scrollWidth > vw + 2) issues.push("hscroll " + document.documentElement.scrollWidth);
    return { issues, vw, vh, portrait };
  }, kind);
}

async function openBuild(page) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.__TK.images);
  await page.click("[data-go=worlds]");
  await page.waitForSelector("[data-world=sample-qingya]");
  await page.click("[data-world=sample-qingya]");
  await page.waitForSelector("#screen-build");
  await delay(200);
}

async function flyMission(page, prefix, shots) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.__TK.images);
  await delay(120);
  const home = await layoutAudit(page, "home");
  if (prefix.endsWith("390")) shots.push(await shot(page, `${prefix}_00_home.png`));
  await page.click("[data-go=worlds]");
  await page.waitForSelector("#screen-worlds");
  await delay(150);
  const worlds = await layoutAudit(page, "worlds");
  if (prefix.endsWith("390")) shots.push(await shot(page, `${prefix}_01_worlds.png`));
  await page.click("[data-world=sample-qingya]");
  await page.waitForSelector("#screen-build");
  await delay(200);
  const build = await layoutAudit(page, "build");
  shots.push(await shot(page, `${prefix}_02_build.png`));
  await page.click("#fly");
  await page.waitForSelector("#screen-flight");
  await delay(150);
  const airborne = await page.evaluate(() => window.__TK.playUntil("airborne"));
  const flight = await layoutAudit(page, "flight");
  shots.push(await shot(page, `${prefix}_03_launch.png`));
  const orbitInfo = await page.evaluate(() => window.__TK.playUntil("orbit"));
  await page.evaluate(() => window.__TK.setMap(true));
  await delay(40);
  const map = await layoutAudit(page, "flight");
  if (prefix.endsWith("390") || prefix.startsWith("portrait_360")) shots.push(await shot(page, `${prefix}_04_orbit.png`));
  await page.evaluate(() => {
    window.__TK.setMap(false);
    window.__TK.setZoom(2.4);
  });
  const chuteInfo = await page.evaluate(() => window.__TK.playUntil("chute"));
  if (prefix.endsWith("390")) shots.push(await shot(page, `${prefix}_05_chute.png`));
  await page.evaluate(() => window.__TK.setZoom(1));
  const landInfo = await page.evaluate(() => window.__TK.playUntil("land"));
  await delay(80);
  const modal = await layoutAudit(page, "modal");
  shots.push(await shot(page, `${prefix}_06_land.png`));
  const crashInfo = await page.evaluate(() => window.__TK.crashDive());
  await delay(80);
  const crashModal = await layoutAudit(page, "modal");
  if (prefix.endsWith("390") || prefix.startsWith("landscape")) shots.push(await shot(page, `${prefix}_07_crash.png`));
  return { home, worlds, build, flight, map, modal, crashModal, airborne, orbitInfo, chuteInfo, landInfo, crashInfo };
}

const server = startServer();
try {
  await waitForServer();
  await mkdir(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  const shots = [];
  const reports = {};

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  reports.p390 = await flyMission(page, "portrait_390", shots);

  await page.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true });
  reports.p360 = await flyMission(page, "portrait_360", shots);

  await page.setViewport({ width: 1280, height: 720, isMobile: false, hasTouch: false });
  reports.land = await flyMission(page, "landscape", shots);

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await openBuild(page);
  await page.click("#fly");
  await page.waitForSelector("#screen-flight");
  await page.evaluate(() => window.__TK.playUntil("airborne"));
  await page.evaluate(() => {
    window.__TK.mark = "rotate-keep";
  });
  const before = await page.evaluate(() => {
    const flight = window.__TK.flight;
    const vessel = flight.vessels.find((item) => item.id === flight.activeId);
    return {
      mark: window.__TK.mark,
      id: vessel.id,
      time: flight.time,
      parts: vessel.parts.length,
      screen: window.__TK.screen,
      alt: window.__TK.info.radialAlt,
    };
  });
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await delay(250);
  const sideways = await page.evaluate(() => {
    const flight = window.__TK.flight;
    const vessel = flight.vessels.find((item) => item.id === flight.activeId);
    return {
      mark: window.__TK.mark,
      id: vessel.id,
      time: flight.time,
      parts: vessel.parts.length,
      screen: window.__TK.screen,
      alt: window.__TK.info.radialAlt,
      dir: getComputedStyle(document.querySelector(".flight-bar")).flexDirection,
    };
  });
  shots.push(await shot(page, "rotate_landscape_flight.png"));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await delay(250);
  const back = await page.evaluate(() => {
    const flight = window.__TK.flight;
    const vessel = flight.vessels.find((item) => item.id === flight.activeId);
    return {
      mark: window.__TK.mark,
      id: vessel.id,
      time: flight.time,
      parts: vessel.parts.length,
      screen: window.__TK.screen,
      alt: window.__TK.info.radialAlt,
      outcome: flight.outcome,
      dir: getComputedStyle(document.querySelector(".flight-bar")).flexDirection,
    };
  });
  shots.push(await shot(page, "rotate_back_portrait_flight.png"));
  reports.rotate = { before, sideways, back };

  const problems = [];
  for (const [name, report] of Object.entries(reports)) {
    if (name === "rotate") continue;
    for (const [step, audit] of Object.entries(report)) {
      if (audit && Array.isArray(audit.issues) && audit.issues.length) problems.push(`${name}.${step}: ${audit.issues.join("; ")}`);
    }
    if (!report.orbitInfo || report.orbitInfo.peri < 30000) problems.push(name + " orbit");
    if (!report.landInfo || report.landInfo.outcome !== "land") problems.push(name + " land " + JSON.stringify(report.landInfo));
    if (!report.crashInfo || report.crashInfo.outcome !== "crash") problems.push(name + " crash");
  }
  if (sidewaysDirBad(reports.rotate)) problems.push("rotate " + JSON.stringify(reports.rotate));
  if (errors.length) problems.push("pageerror " + errors.join(" | "));
  console.log(JSON.stringify({ problems, shots, rotate: reports.rotate, audits: {
    p390: slim(reports.p390),
    p360: slim(reports.p360),
    land: slim(reports.land),
  } }, null, 2));
  if (problems.length) throw new Error(problems.join("\n"));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

function sidewaysDirBad(rotate) {
  const { before, sideways, back } = rotate;
  if (before.mark !== "rotate-keep" || sideways.mark !== before.mark || back.mark !== before.mark) return true;
  if (before.id !== sideways.id || sideways.id !== back.id) return true;
  if (before.parts !== sideways.parts || back.parts !== before.parts) return true;
  if (sideways.screen !== "flight" || back.screen !== "flight") return true;
  if (sideways.time + 0.01 < before.time || back.time + 0.01 < sideways.time) return true;
  if (back.outcome) return true;
  if (sideways.dir !== "row" || back.dir !== "column") return true;
  return false;
}

function slim(report) {
  const out = {};
  for (const [key, value] of Object.entries(report)) {
    if (value && value.issues) out[key] = value.issues;
    else if (value && value.outcome) out[key] = value.outcome;
    else if (value && value.peri) out[key] = Math.round(value.peri);
  }
  return out;
}
