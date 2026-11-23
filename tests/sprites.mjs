/**
 * 再入阶段必须仍是零件贴图。390×844 和 1280×720 各走一遍。
 * 用法：node tests/sprites.mjs
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import puppeteer from "puppeteer-core";

const port = Number(process.env.PORT || 8773);
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

async function runSize(page, tag) {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.__TK.images);
  await page.click("[data-go=worlds]");
  await page.waitForSelector("[data-world=sample-qingya]");
  await page.click("[data-world=sample-qingya]");
  await page.waitForSelector("#fly");
  await page.click("#fly");
  await page.waitForSelector("#screen-flight");
  await page.evaluate(() => {
    window.__TK.setMap(false);
    window.__TK.setZoom(1);
  });
  const shots = [];
  const notes = {};
  for (const phase of ["orbit", "atmo", "dive", "chute", "land"]) {
    const info = await page.evaluate((name) => window.__TK.playUntil(name), phase);
    await page.evaluate(() => {
      window.__TK.setMap(false);
      window.__TK.setZoom(1);
    });
    await delay(40);
    shots.push(await shot(page, `${tag}_${phase}.png`));
    notes[phase] = { alt: info.alt, speed: info.speed, peri: info.peri, outcome: info.outcome, chute: info.chute };
  }
  return { shots, notes };
}

const server = startServer();
try {
  await waitForServer();
  await mkdir(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 390, height: 844 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const portrait = await runSize(page, "sprite_390");
  await page.setViewport({ width: 1280, height: 720 });
  const landscape = await runSize(page, "sprite_1280");
  console.log(JSON.stringify({ errors, portrait: portrait.notes, landscape: landscape.notes, shots: [...portrait.shots, ...landscape.shots] }, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
  for (const run of [portrait, landscape]) {
    if (!run.notes.orbit || run.notes.orbit.peri < 30000) throw new Error("orbit " + JSON.stringify(run.notes.orbit));
    if (!run.notes.atmo || run.notes.atmo.alt > 30000 || run.notes.atmo.alt < 24000) throw new Error("atmo " + JSON.stringify(run.notes.atmo));
    if (!run.notes.dive || run.notes.dive.speed < 180) throw new Error("dive " + JSON.stringify(run.notes.dive));
    if (!run.notes.chute || run.notes.chute.chute < 0.4) throw new Error("chute " + JSON.stringify(run.notes.chute));
    if (!run.notes.land || run.notes.land.outcome !== "land") throw new Error("land " + JSON.stringify(run.notes.land));
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
