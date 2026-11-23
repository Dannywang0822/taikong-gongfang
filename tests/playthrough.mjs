/**
 * 无头浏览器走一遍：默认火箭建造 → 发射 → 入轨 → 开伞 → 着陆，再高速撞地。
 * 用法：node tests/playthrough.mjs [port]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import puppeteer from "puppeteer-core";

const port = Number(process.argv[2] || 8765);
const outDir = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts";

function startServer() {
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    stdio: "ignore",
  });
  return child;
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

const server = startServer();
try {
  await waitForServer();
  await mkdir(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,720"],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.__TK.images);
  await page.click("[data-go=worlds]");
  await page.waitForSelector("[data-world=sample-qingya]");
  await page.click("[data-world=sample-qingya]");
  await page.waitForSelector("#screen-build");
  await delay(250);
  const build = await shot(page, "01_build_default_rocket.png");

  await page.click("#fly");
  await page.waitForSelector("#screen-flight");
  await delay(200);
  const airborne = await page.evaluate(() => window.__TK.playUntil("airborne"));
  const launch = await shot(page, "02_launch_airborne.png");

  const orbitInfo = await page.evaluate(() => window.__TK.playUntil("orbit"));
  await page.evaluate(() => window.__TK.setMap(true));
  await delay(50);
  const orbit = await shot(page, "03_orbit_map.png");

  await page.evaluate(() => {
    window.__TK.setMap(false);
    window.__TK.setZoom(2.6);
  });
  const chuteInfo = await page.evaluate(() => window.__TK.playUntil("chute"));
  const chute = await shot(page, "04_reentry_chute.png");

  await page.evaluate(() => window.__TK.setZoom(1.05));
  const landInfo = await page.evaluate(() => window.__TK.playUntil("land"));
  await delay(100);
  const land = await shot(page, "05_landed.png");

  const crashInfo = await page.evaluate(() => window.__TK.crashDive());
  await delay(100);
  const crash = await shot(page, "06_crash_failure.png");

  const summary = { airborne, orbitInfo, chuteInfo, landInfo, crashInfo, errors, shots: [build, launch, orbit, chute, land, crash] };
  await writeFile(path.join(outDir, "playthrough.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
  if (!orbitInfo || orbitInfo.peri < 30000) throw new Error("没有进入轨道 " + JSON.stringify(orbitInfo));
  if (!landInfo || landInfo.outcome !== "land") throw new Error("没有着陆 " + JSON.stringify(landInfo));
  if (!crashInfo || crashInfo.outcome !== "crash") throw new Error("没有失败界面 " + JSON.stringify(crashInfo));
  if (!crashInfo.title || !crashInfo.title.includes("没有落地")) throw new Error("失败标题不对 " + crashInfo.title);
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
