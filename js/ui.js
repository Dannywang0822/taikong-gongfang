import { CHUTE_STATES, COPY, PICKER, getPart } from "./data.js";
import { drawScene, loadImages, partImageUrls } from "./flightview.js";
import { guideInput, vesselHasEngine } from "./guide.js";
import {
  buildStatus,
  canRoot,
  cloneParts,
  compileVessel,
  drawOrder,
  layoutParts,
  placePart,
  removeSubtree,
  validTargets,
} from "./rocket.js";
import {
  createFlight,
  flightInfo,
  formatAlt,
  formatSpeed,
  fuelFrac,
  step,
} from "./sim.js";
import { store } from "./store.js";

const PLACE_ERR = {
  "bad-root": COPY.build.badRoot,
  "need-node": COPY.build.needNode,
  "no-fit": COPY.build.noFit,
  "one-pod": COPY.build.onePod,
  "one-engine": COPY.build.oneEngine,
  "one-chute": COPY.build.oneChute,
};

const TOASTS = {
  "staged-boosters": COPY.flight.stagedBoosters,
  "staged-core": COPY.flight.stagedCore,
  "no-stage": COPY.flight.noStage,
  "chute-high": COPY.flight.chuteHigh,
  "chute-fast": COPY.flight.chuteFast,
  "chute-none": COPY.flight.chuteNone,
  "chute-open": COPY.flight.chuteOpen,
};

const STARS = Array.from({ length: 42 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 24634.6345;
  return { x: a - Math.floor(a), y: (b - Math.floor(b)) * 0.86, s: 1 + (i % 3) };
});

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : fallback;
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function mix(a, b, t) {
  const u = clamp(t, 0, 1);
  const n = a.map((v, i) => Math.round(v + (b[i] - v) * u));
  return `rgb(${n[0]}, ${n[1]}, ${n[2]})`;
}

export function boot() {
  const view = document.querySelector("#view");
  const overlay = document.querySelector("#overlay");
  const app = {
    screen: "home",
    worldId: null,
    parts: [],
    undo: [],
    armed: null,
    selected: null,
    detach: false,
    view: { zoom: 1, panX: 40, panY: 40, manual: false },
    wasPortrait: typeof window !== "undefined" && window.innerHeight > window.innerWidth,
    flight: null,
    cam: { zoom: 1, map: false },
    auto: false,
    autoMode: "ascend",
    pointers: new Map(),
    throttle: 0,
    hold: { left: false, right: false },
    keys: { left: false, right: false, up: false, down: false },
    edge: { separate: false, deploy: false },
    raf: 0,
    lastTs: 0,
    saveAcc: 0,
    tut: 0,
    toastTimer: 0,
    pan: null,
  };

  let ghost = null;

  function toast(text, home) {
    const host = document.querySelector("#toast");
    if (!host) return;
    host.hidden = false;
    host.textContent = text;
    host.classList.toggle("home-toast", !!home);
    clearTimeout(app.toastTimer);
    app.toastTimer = setTimeout(() => {
      host.hidden = true;
    }, 1700);
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = "";
  }

  function showOverlay(inner) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="modal">${inner}</div>`;
    overlay.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => onOverlay(btn.dataset.act));
    });
  }

  function statsLine() {
    if (!app.flight) return "";
    return `最高离地 ${formatAlt(app.flight.maxAlt)} · 最高速度 ${formatSpeed(app.flight.maxSpeed)}`;
  }

  function onOverlay(act) {
    if (act === "close") {
      hideOverlay();
      return;
    }
    if (act === "tut-next") {
      app.tut += 1;
      if (app.tut >= COPY.tutorial.steps.length) hideOverlay();
      else openTutorial();
      return;
    }
    if (act === "retry") {
      retryFlight();
      return;
    }
    if (act === "to-build") {
      hideOverlay();
      show("build");
      return;
    }
    if (act === "to-home") {
      hideOverlay();
      show("home");
      return;
    }
    if (act === "end-flight") {
      if (app.worldId && app.flight && !app.flight.outcome) {
        store.update(app.worldId, { activity: "已结束", flight: null });
      }
      openEnd();
      return;
    }
    if (act === "settle-build") {
      hideOverlay();
      show("build");
    }
  }

  function openTutorial() {
    const last = app.tut >= COPY.tutorial.steps.length - 1;
    showOverlay(`
      <h4>${COPY.tutorial.title}</h4>
      <p>${COPY.tutorial.steps[app.tut]}</p>
      <button class="btn primary" type="button" data-act="tut-next">${last ? COPY.tutorial.done : COPY.tutorial.next}</button>
    `);
  }

  function openCredits() {
    showOverlay(`
      <h4>${COPY.credits.title}</h4>
      <p>${COPY.credits.body}</p>
      <button class="btn" type="button" data-act="close">${COPY.fail.back}</button>
    `);
  }

  function openMenu() {
    showOverlay(`
      <h4>${COPY.flight.menu}</h4>
      <button class="btn primary" type="button" data-act="close">${COPY.flight.resume}</button>
      <button class="btn" type="button" data-act="end-flight">${COPY.fail.end}</button>
      <button class="btn ghost" type="button" data-act="to-home">${COPY.flight.backHome}</button>
    `);
  }

  function openCrash() {
    const reason = app.flight && app.flight.crashReason === "tip" ? COPY.fail.tip : COPY.fail.terrain;
    showOverlay(`
      <h4>${COPY.fail.title}</h4>
      <p>${reason}</p>
      <p>${COPY.fail.body}</p>
      <button class="btn primary" type="button" data-act="retry">${COPY.fail.retry}</button>
      <button class="btn" type="button" data-act="to-build">${COPY.fail.end}</button>
      <button class="btn ghost" type="button" data-act="to-home">${COPY.fail.back}</button>
    `);
  }

  function openLand() {
    showOverlay(`
      <h4>${COPY.land.title}</h4>
      <p>${COPY.land.body}</p>
      <p class="stats">${statsLine()}</p>
      <button class="btn primary" type="button" data-act="retry">${COPY.fail.retry}</button>
      <button class="btn" type="button" data-act="to-build">${COPY.fail.end}</button>
      <button class="btn ghost" type="button" data-act="to-home">${COPY.fail.back}</button>
    `);
  }

  function openEnd() {
    showOverlay(`
      <h4>${COPY.end.title}</h4>
      <p>${COPY.end.body}</p>
      <p class="stats">${statsLine()}</p>
      <button class="btn primary" type="button" data-act="retry">${COPY.fail.retry}</button>
      <button class="btn" type="button" data-act="settle-build">${COPY.flight.backBuild}</button>
      <button class="btn ghost" type="button" data-act="to-home">${COPY.fail.back}</button>
    `);
  }

  function show(name) {
    if (app.raf) cancelAnimationFrame(app.raf);
    app.raf = 0;
    app.screen = name;
    clearHolds();
    hideOverlay();
    if (name === "home") renderHome();
    else if (name === "worlds") renderWorlds();
    else if (name === "build") renderBuild();
    else if (name === "flight") renderFlight();
    window.__TK.screen = name;
  }

  function clearHolds() {
    app.hold.left = false;
    app.hold.right = false;
    app.keys.left = false;
    app.keys.right = false;
    app.keys.up = false;
    app.keys.down = false;
    app.edge.separate = false;
    app.edge.deploy = false;
    app.edge.warp = 0;
  }

  function openWorld(id, mode) {
    const world = store.get(id);
    if (!world) {
      show("worlds");
      return;
    }
    app.worldId = id;
    store.update(id, {});
    if (mode === "flight" && world.flight && world.flight.vessels && world.flight.activeId && !world.flight.outcome) {
      app.parts = cloneParts(world.rocket || []);
      app.flight = world.flight;
      const vessel = app.flight.vessels.find((v) => v.id === app.flight.activeId);
      app.throttle = vessel && vessel.throttle ? vessel.throttle : 0;
      show("flight");
      return;
    }
    app.parts = cloneParts(world.rocket || []);
    app.undo = [];
    app.armed = null;
    app.selected = null;
    app.detach = false;
    app.view.manual = false;
    show("build");
  }

  function renderHome() {
    view.innerHTML = `
      <div class="screen" id="screen-home">
        <div class="sky"></div>
        <div class="safe home-safe">
          <div class="home-stage">
            <div class="brand">
              <div class="mark"><img src="assets/parts/cmd-pod.png" alt="" width="40" height="50"></div>
              <h2>${COPY.meta.title}</h2>
              <p>${COPY.meta.tagline}</p>
            </div>
            <div class="home-hero"><img src="assets/parts/rocket-home.png" alt=""></div>
          </div>
          <div class="home-main">
            <button class="btn primary" type="button" data-go="worlds">${COPY.home.start}</button>
            <button class="btn" type="button" data-go="resume">${COPY.home.resume}</button>
            <button class="btn" type="button" data-go="build">${COPY.home.build}</button>
            <div class="sec-grid">
              <button class="sec" type="button" data-go="tutorial">${COPY.home.tutorial}</button>
              <button class="sec" type="button" data-go="soon">${COPY.home.mods} <span class="soon">${COPY.home.soon}</span></button>
              <button class="sec" type="button" data-go="soon">${COPY.home.community} <span class="soon">${COPY.home.soon}</span></button>
              <button class="sec" type="button" data-go="credits">${COPY.home.credits}</button>
            </div>
            <button class="frame" type="button" data-go="soon"><span>${COPY.home.shop}</span><span class="soon">${COPY.home.soon}</span></button>
            <button class="frame" type="button" data-go="soon"><span>${COPY.home.notices}</span><span class="soon">${COPY.home.soon}</span></button>
          </div>
        </div>
        <div id="toast" class="toast home-toast" hidden></div>
      </div>`;
    view.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const go = btn.dataset.go;
        if (go === "worlds") show("worlds");
        else if (go === "resume") resume();
        else if (go === "build") buildShortcut();
        else if (go === "tutorial") {
          app.tut = 0;
          openTutorial();
        } else if (go === "credits") openCredits();
        else toast(COPY.soon, true);
      });
    });
  }

  function resume() {
    const id = store.lastId();
    const world = id && store.get(id);
    if (!world) {
      show("worlds");
      return;
    }
    if (world.flight && world.flight.vessels && !world.flight.outcome) openWorld(world.id, "flight");
    else openWorld(world.id, "build");
  }

  function buildShortcut() {
    const id = store.lastId();
    if (id && store.get(id)) openWorld(id, "build");
    else show("worlds");
  }

  function renderWorlds() {
    view.innerHTML = `
      <div class="screen" id="screen-worlds">
        <div class="sky"></div>
        <div class="safe world-safe">
          <div class="topbar"><button class="back" type="button" data-go="home">←</button><h3>${COPY.worlds.title}</h3></div>
          <div class="world-body">
            <div class="world-list" id="world-list"></div>
            <div class="world-side">
              <button class="btn primary" type="button" id="create-world">${COPY.worlds.create}</button>
              <div class="field">
                <label for="world-name">${COPY.worlds.name}</label>
                <input id="world-name" maxlength="12" value="${COPY.worlds.placeholder}" autocomplete="off">
              </div>
            </div>
          </div>
        </div>
        <div id="toast" class="toast home-toast" hidden></div>
      </div>`;
    view.querySelector("[data-go=home]").addEventListener("click", () => show("home"));
    const list = view.querySelector("#world-list");
    const worlds = store.list();
    if (!worlds.length) {
      const empty = document.createElement("div");
      empty.className = "empty-worlds";
      empty.textContent = COPY.worlds.empty;
      list.appendChild(empty);
    }
    for (const world of worlds) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "world";
      card.dataset.world = world.id;
      const fill = safeColor(world.color, "#5a8ec4");
      const stroke = safeColor(world.stroke, "#1a2430");
      card.innerHTML = `<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="${fill}" stroke="${stroke}"/><circle cx="13" cy="13" r="5" fill="#ffffff55"/></svg>`;
      const text = document.createElement("div");
      const name = document.createElement("b");
      name.textContent = world.name;
      const meta = document.createElement("span");
      meta.textContent = `${COPY.worlds.recent}：${world.activity}`;
      text.append(name, meta);
      card.appendChild(text);
      card.addEventListener("click", () => openWorld(world.id, "build"));
      list.appendChild(card);
    }
    const input = view.querySelector("#world-name");
    input.addEventListener("focus", () => input.select());
    const create = () => {
      const made = store.create(input.value);
      if (!made) {
        toast(COPY.worlds.tooMany, true);
        return;
      }
      input.value = COPY.worlds.placeholder;
      openWorld(made.id, "build");
    };
    view.querySelector("#create-world").addEventListener("click", create);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        create();
      }
    });
  }

  function persistBuild() {
    if (!app.worldId) return;
    store.update(app.worldId, { rocket: app.parts, flight: null, activity: "建造中" });
  }

  function renderBuild() {
    const cells = PICKER.order.map((id) => {
      const part = getPart(id);
      return `<button class="cell" type="button" data-part="${id}"><span class="thumb"><img src="${part.src}" alt="" width="64" height="64"></span><em>${part.name}</em></button>`;
    }).join("");
    const states = CHUTE_STATES.map((s) => `<div class="state"><img src="${s.src}" alt="">${s.name}</div>`).join("");
    view.innerHTML = `
      <div class="screen" id="screen-build">
        <div class="safe">
          <div class="topbar">
            <button class="back" type="button" id="build-back">←</button>
            <h3>${COPY.build.title}</h3>
            <div class="tools">
              <button class="iconbtn" type="button" id="undo">${COPY.build.undo}</button>
              <button class="iconbtn" type="button" id="detach">${COPY.build.detach}</button>
              <button class="iconbtn" type="button" id="fly">${COPY.build.fly}</button>
            </div>
          </div>
          <div class="build-body">
            <div class="bench" id="bench">
              <div id="rocket-art"></div>
              <div id="nodes"></div>
            </div>
            <div class="picker">
              <div class="grid">${cells}</div>
              <div class="states">${states}</div>
              <div class="msg" id="build-msg"></div>
            </div>
          </div>
        </div>
        <div id="toast" class="toast" hidden></div>
      </div>`;
    view.querySelector("#build-back").addEventListener("click", () => show("worlds"));
    view.querySelector("#undo").addEventListener("click", undo);
    view.querySelector("#detach").addEventListener("click", onDetach);
    view.querySelector("#fly").addEventListener("click", onFly);
    view.querySelectorAll(".cell").forEach((cell) => bindPalette(cell, cell.dataset.part));
    const bench = view.querySelector("#bench");
    bench.addEventListener("pointerdown", onBenchDown);
    bench.addEventListener("pointermove", onBenchMove);
    bench.addEventListener("pointerup", onBenchUp);
    bench.addEventListener("pointercancel", () => {
      app.pan = null;
    });
    bench.addEventListener("wheel", onWheel, { passive: false });
    drawBuild();
    requestAnimationFrame(() => {
      if (app.screen === "build") drawBuild();
    });
  }

  function bindPalette(cell, defId) {
    let start = null;
    let dragging = false;
    cell.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
      cell.setPointerCapture(e.pointerId);
    });
    cell.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
        dragging = true;
        if (!ghost) {
          ghost = document.createElement("img");
          ghost.className = "drag-ghost";
          document.body.appendChild(ghost);
        }
        ghost.hidden = false;
        ghost.src = getPart(defId).src;
        ghost.style.left = e.clientX + "px";
        ghost.style.top = e.clientY + "px";
      }
    });
    cell.addEventListener("pointerup", (e) => {
      if (ghost) ghost.hidden = true;
      if (!start || e.pointerId !== start.id) return;
      if (dragging) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        dropOn(defId, el);
      } else {
        app.detach = false;
        app.armed = app.armed === defId ? null : defId;
        drawBuild();
      }
      start = null;
      dragging = false;
    });
    cell.addEventListener("click", (e) => {
      if (e.detail === 0) {
        app.detach = false;
        app.armed = app.armed === defId ? null : defId;
        drawBuild();
      }
    });
  }

  function dropOn(defId, el) {
    const node = el && el.closest("[data-joint]");
    if (node) {
      commitPlace(defId, { parentUid: node.dataset.parent, parentJoint: node.dataset.joint });
      return;
    }
    if (!app.parts.length && el && el.closest("#bench")) {
      commitPlace(defId, null);
      return;
    }
    app.armed = defId;
    app.detach = false;
    drawBuild();
    if (app.parts.length) toast(COPY.build.needNode);
  }

  function commitPlace(defId, target) {
    const result = placePart(app.parts, defId, target);
    if (result.error) {
      toast(PLACE_ERR[result.error] || COPY.build.noFit);
      return;
    }
    app.undo.push(cloneParts(app.parts));
    if (app.undo.length > 40) app.undo.shift();
    app.parts = result.parts;
    app.selected = null;
    app.view.manual = false;
    persistBuild();
    drawBuild();
  }

  function undo() {
    if (!app.undo.length) {
      toast(COPY.build.noUndo);
      return;
    }
    app.parts = app.undo.pop();
    app.selected = null;
    app.view.manual = false;
    persistBuild();
    drawBuild();
  }

  function removeAt(uid) {
    app.undo.push(cloneParts(app.parts));
    app.parts = removeSubtree(app.parts, uid);
    app.selected = null;
    app.view.manual = false;
    persistBuild();
    drawBuild();
  }

  function onDetach() {
    if (app.selected) {
      removeAt(app.selected);
      return;
    }
    app.detach = !app.detach;
    app.armed = null;
    drawBuild();
  }

  function onFly() {
    const status = buildStatus(app.parts);
    const msg = view.querySelector("#build-msg");
    if (!status.ok) {
      if (msg) {
        msg.classList.remove("shake");
        void msg.offsetWidth;
        msg.classList.add("shake");
      }
      return;
    }
    const vessel = compileVessel(app.parts);
    app.flight = createFlight(vessel);
    app.throttle = 0;
    app.saveAcc = 0;
    if (app.worldId) {
      store.update(app.worldId, { rocket: app.parts, activity: "飞行中", flight: app.flight });
    }
    show("flight");
  }

  function fitBuild() {
    const bench = view.querySelector("#bench");
    if (!bench || app.view.manual) return;
    const rect = bench.getBoundingClientRect();
    if (!app.parts.length) {
      app.view.zoom = 1;
      app.view.panX = rect.width / 2;
      app.view.panY = rect.height / 2;
      return;
    }
    const layout = layoutParts(app.parts);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const part of app.parts) {
      const box = layout.get(part.uid);
      const def = getPart(part.defId);
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + def.w);
      maxY = Math.max(maxY, box.y + def.h);
    }
    const bw = Math.max(40, maxX - minX);
    const bh = Math.max(40, maxY - minY);
    const z = Math.min((rect.width - 24) / bw, (rect.height - 24) / bh, 1.2);
    app.view.zoom = clamp(z, 0.08, 1.2);
    app.view.panX = (rect.width - bw * app.view.zoom) / 2 - minX * app.view.zoom;
    app.view.panY = (rect.height - bh * app.view.zoom) / 2 - minY * app.view.zoom;
  }

  function drawBuild() {
    const art = view.querySelector("#rocket-art");
    const nodes = view.querySelector("#nodes");
    const msg = view.querySelector("#build-msg");
    if (!art || !nodes) return;
    fitBuild();
    const layout = layoutParts(app.parts);
    art.innerHTML = "";
    nodes.innerHTML = "";
    if (!app.parts.length) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = COPY.build.hint;
      nodes.appendChild(hint);
      if (app.armed && canRoot(getPart(app.armed))) {
        const root = document.createElement("button");
        root.type = "button";
        root.className = "node";
        root.dataset.root = "1";
        root.style.left = "50%";
        root.style.top = "46%";
        root.addEventListener("click", (e) => {
          e.stopPropagation();
          commitPlace(app.armed, null);
        });
        nodes.appendChild(root);
      }
    }
    for (const part of drawOrder(app.parts)) {
      const box = layout.get(part.uid);
      const def = getPart(part.defId);
      const img = document.createElement("img");
      img.className = "sprite" + (app.selected === part.uid ? " sel" : "");
      img.src = def.src;
      img.alt = def.name;
      img.draggable = false;
      img.style.left = app.view.panX + box.x * app.view.zoom + "px";
      img.style.top = app.view.panY + box.y * app.view.zoom + "px";
      img.style.width = def.w * app.view.zoom + "px";
      img.style.height = def.h * app.view.zoom + "px";
      if (box.flip) img.style.transform = "scaleX(-1)";
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        if (app.detach) {
          removeAt(part.uid);
          return;
        }
        app.selected = app.selected === part.uid ? null : part.uid;
        drawBuild();
      });
      art.appendChild(img);
    }
    if (app.armed && !app.detach) {
      for (const target of validTargets(app.parts, app.armed)) {
        const host = app.parts.find((p) => p.uid === target.parentUid);
        const box = layout.get(host.uid);
        const node = getPart(host.defId).nodes[target.parentJoint];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "node";
        btn.dataset.joint = target.parentJoint;
        btn.dataset.parent = target.parentUid;
        btn.style.left = app.view.panX + (box.x + node.x) * app.view.zoom + "px";
        btn.style.top = app.view.panY + (box.y + node.y) * app.view.zoom + "px";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          commitPlace(app.armed, { parentUid: target.parentUid, parentJoint: target.parentJoint });
        });
        nodes.appendChild(btn);
      }
    }
    view.querySelectorAll(".cell").forEach((cell) => {
      cell.classList.toggle("armed", cell.dataset.part === app.armed);
    });
    const detachBtn = view.querySelector("#detach");
    if (detachBtn) detachBtn.classList.toggle("on", app.detach);
    if (msg) msg.textContent = buildStatus(app.parts).text;
    window.__TK.parts = app.parts;
  }

  function onBenchDown(e) {
    if (e.target.closest(".sprite") || e.target.closest(".node")) return;
    app.pan = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      panX: app.view.panX,
      panY: app.view.panY,
      moved: false,
    };
  }

  function onBenchMove(e) {
    if (!app.pan || e.pointerId !== app.pan.id) return;
    const dx = e.clientX - app.pan.x;
    const dy = e.clientY - app.pan.y;
    if (Math.hypot(dx, dy) > 5) {
      app.pan.moved = true;
      app.view.manual = true;
      app.view.panX = app.pan.panX + dx;
      app.view.panY = app.pan.panY + dy;
      drawBuild();
    }
  }

  function onBenchUp(e) {
    if (!app.pan || app.pan.id !== e.pointerId) return;
    const moved = app.pan.moved;
    app.pan = null;
    if (moved) return;
    if (e.target.closest(".sprite") || e.target.closest(".node")) return;
    if (!app.parts.length && app.armed) commitPlace(app.armed, null);
  }

  function onWheel(e) {
    e.preventDefault();
    const bench = view.querySelector("#bench");
    const rect = bench.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const prev = app.view.zoom;
    const next = clamp(prev * (e.deltaY < 0 ? 1.08 : 0.92), 0.08, 2.4);
    app.view.panX = mx - ((mx - app.view.panX) * next) / prev;
    app.view.panY = my - ((my - app.view.panY) * next) / prev;
    app.view.zoom = next;
    app.view.manual = true;
    drawBuild();
  }

  function renderFlight() {
    view.innerHTML = `
      <div class="screen" id="screen-flight">
        <canvas id="sky"></canvas>
        <div id="layers"></div>
        <svg id="varr" viewBox="0 0 54 54" aria-hidden="true" hidden>
          <path d="M27 46 V16" stroke="#1a2430" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <path d="M16 27 L27 12 L38 27" stroke="#1a2430" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="fuelchip"><b>${COPY.flight.fuel}</b><div class="fuelbar"><i id="fuel-fill"></i></div></div>
        <div class="orbit-read">
          <div class="hud-read"><span>${COPY.flight.peri}</span><b id="read-peri">—</b></div>
          <div class="hud-read"><span>${COPY.flight.apo}</span><b id="read-apo">—</b></div>
          <button class="menu" type="button" id="warp-down">${COPY.flight.warpDown}</button>
          <button class="menu" type="button" id="warp-label">×1</button>
          <button class="menu" type="button" id="warp-up">${COPY.flight.warpUp}</button>
          <button class="menu" type="button" id="map-toggle">${COPY.flight.map}</button>
        </div>
        <button class="menu auto-btn" type="button" id="auto-flight">${COPY.flight.auto}</button>
        <button class="menu" type="button" id="flight-menu">${COPY.flight.menu}</button>
        <div class="flight-bar">
          <div class="hud-dock">
            <div class="hud-read"><span>${COPY.flight.speed}</span><b id="read-speed">0 m/s</b></div>
            <div class="thr-ring" id="thr" role="slider" aria-valuemin="0" aria-valuemax="100" aria-label="${COPY.flight.throttle}">
              <div class="thr-core"><span>${COPY.flight.throttle}</span><b id="read-thr">0%</b></div>
            </div>
            <div class="hud-read"><span>${COPY.flight.alt}</span><b id="read-alt">0 m</b></div>
          </div>
          <div class="bot">
            <button class="btn" type="button" id="btn-left">${COPY.flight.left}</button>
            <button class="btn" type="button" id="btn-right">${COPY.flight.right}</button>
            <button class="btn" type="button" id="btn-stage">${COPY.flight.stage}</button>
            <button class="btn go" type="button" id="btn-chute">${COPY.flight.chute}</button>
          </div>
        </div>
        <div id="toast" class="toast" hidden></div>
      </div>`;
    view.querySelector("#flight-menu").addEventListener("click", () => {
      if (app.flight && app.flight.outcome) return;
      saveFlight();
      openMenu();
    });
    holdButton(view.querySelector("#btn-left"), "left");
    holdButton(view.querySelector("#btn-right"), "right");
    view.querySelector("#btn-stage").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stopAuto();
      app.edge.separate = true;
    });
    view.querySelector("#btn-chute").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stopAuto();
      app.edge.deploy = true;
    });
    view.querySelector("#warp-down").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      app.edge.warp = (app.edge.warp || 0) - 1;
    });
    view.querySelector("#warp-up").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      app.edge.warp = (app.edge.warp || 0) + 1;
    });
    view.querySelector("#map-toggle").addEventListener("click", () => {
      app.cam.map = !app.cam.map;
      view.querySelector("#map-toggle").classList.toggle("on", app.cam.map);
    });
    view.querySelector("#auto-flight").addEventListener("click", () => {
      if (app.auto) stopAuto();
      else beginAuto();
    });
    const canvas = view.querySelector("#sky");
    canvas.addEventListener("wheel", onFlightWheel, { passive: false });
    canvas.addEventListener("pointerdown", onFlightPointer);
    canvas.addEventListener("pointermove", onFlightPointer);
    canvas.addEventListener("pointerup", onFlightPointer);
    canvas.addEventListener("pointercancel", onFlightPointer);
    bindThrottle(view.querySelector("#thr"));
    app.lastTs = 0;
    app.raf = requestAnimationFrame(loop);
  }

  function holdButton(btn, key) {
    const down = (e) => {
      stopAuto();
      app.hold[key] = true;
      btn.classList.add("held");
      btn.setPointerCapture(e.pointerId);
    };
    const up = () => {
      app.hold[key] = false;
      btn.classList.remove("held");
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
  }

  function bindThrottle(ring) {
    let drag = null;
    const paint = () => {
      const sweep = 0.72;
      const fill = clamp(app.throttle, 0, 1) * sweep;
      ring.style.background = `conic-gradient(from 210deg, #f4f7fb 0 ${fill}turn, #ffffff33 ${fill}turn ${sweep}turn, transparent ${sweep}turn 1turn), #152030e8`;
      const label = view.querySelector("#read-thr");
      const pct = Math.round(app.throttle * 100);
      if (label) label.textContent = pct + "%";
      ring.setAttribute("aria-valuenow", String(pct));
    };
    ring.paint = paint;
    ring.addEventListener("pointerdown", (e) => {
      stopAuto();
      drag = { y: e.clientY, t: app.throttle, id: e.pointerId };
      ring.setPointerCapture(e.pointerId);
    });
    ring.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      app.throttle = clamp(drag.t + (drag.y - e.clientY) / 120, 0, 1);
      paint();
    });
    ring.addEventListener("pointerup", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (Math.abs(e.clientY - drag.y) < 5) {
        const rect = ring.getBoundingClientRect();
        app.throttle = clamp(app.throttle + (e.clientY < rect.top + rect.height / 2 ? 0.1 : -0.1), 0, 1);
      }
      drag = null;
      paint();
    });
    paint();
  }

  function loop(ts) {
    app.raf = requestAnimationFrame(loop);
    if (app.screen !== "flight" || !app.flight) return;
    const dt = app.lastTs ? clamp((ts - app.lastTs) / 1000, 0, 0.05) : 0.016;
    app.lastTs = ts;
    const paused = !overlay.hidden || app.flight.outcome;
    if (!paused) {
      if (!app.auto) {
        if (app.keys.up) app.throttle = clamp(app.throttle + dt * 0.55, 0, 1);
        if (app.keys.down) app.throttle = clamp(app.throttle - dt * 0.55, 0, 1);
      }
      const input = app.auto ? guidedInput() : playerInput();
      if (app.auto) app.throttle = input.throttle;
      app.edge.separate = false;
      app.edge.deploy = false;
      app.edge.warp = 0;
      const result = step(app.flight, input, dt);
      app.flight = result.state;
      for (const ev of result.events) onFlightEvent(ev);
      app.saveAcc += dt;
      if (app.saveAcc > 2 && !app.flight.outcome) {
        app.saveAcc = 0;
        saveFlight();
      }
    }
    drawFlight();
  }

  function onFlightEvent(ev) {
    if (ev.type === "toast" && TOASTS[ev.code]) toast(TOASTS[ev.code]);
    if (ev.type === "crash") {
      if (app.worldId) store.update(app.worldId, { activity: "没有落地", flight: null });
      openCrash();
    }
    if (ev.type === "land") {
      if (app.worldId) store.update(app.worldId, { activity: "已着陆", flight: null });
      openLand();
    }
  }

  function saveFlight() {
    if (!app.worldId || !app.flight || app.flight.outcome) return;
    const vessel = app.flight.vessels.find((v) => v.id === app.flight.activeId);
    if (vessel) vessel.throttle = app.throttle;
    store.update(app.worldId, { activity: "飞行中", flight: app.flight, rocket: app.parts });
  }

  function retryFlight() {
    const world = app.worldId && store.get(app.worldId);
    const blueprint = world ? world.rocket : app.parts;
    app.parts = cloneParts(blueprint || []);
    const vessel = compileVessel(app.parts);
    if (!vessel) {
      hideOverlay();
      show("build");
      return;
    }
    app.flight = createFlight(vessel);
    app.throttle = 0;
    app.saveAcc = 0;
    if (app.worldId) store.update(app.worldId, { activity: "飞行中", flight: app.flight, rocket: app.parts });
    hideOverlay();
    if (app.screen !== "flight") show("flight");
    else drawFlight();
  }

  function stopAuto() {
    if (!app.auto) return;
    app.auto = false;
    const btn = view.querySelector("#auto-flight");
    if (btn) btn.textContent = COPY.flight.auto;
  }

  function beginAuto() {
    const info = app.flight && flightInfo(app.flight);
    app.auto = true;
    if (info && info.inOrbit) app.autoMode = "deorbit";
    else if (info && info.periAlt < 14000 && info.radialAlt > 4000 && !vesselHasEngine(info.vessel)) app.autoMode = "reentry";
    else app.autoMode = "ascend";
    const btn = view.querySelector("#auto-flight");
    if (btn) btn.textContent = COPY.flight.manual;
    toast(COPY.flight.autoOn);
  }

  function advanceAutoMode() {
    const info = flightInfo(app.flight);
    if (!info) return;
    if (app.autoMode === "ascend" && info.inOrbit) app.autoMode = "deorbit";
    if (app.autoMode === "deorbit" && info.periAlt < 11000 && !vesselHasEngine(info.vessel)) app.autoMode = "reentry";
  }

  function guidedInput() {
    advanceAutoMode();
    return guideInput(app.flight, app.autoMode);
  }

  function playerInput() {
    return {
      throttle: app.throttle,
      left: app.hold.left || app.keys.left,
      right: app.hold.right || app.keys.right,
      separate: app.edge.separate,
      deploy: app.edge.deploy,
      warpDelta: app.edge.warp || 0,
    };
  }

  function onFlightWheel(e) {
    e.preventDefault();
    app.cam.zoom = clamp(app.cam.zoom * (e.deltaY < 0 ? 1.12 : 0.9), 0.08, 12);
  }

  function onFlightPointer(e) {
    if (e.type === "pointerdown") app.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    else if (e.type === "pointermove") {
      if (app.pointers.has(e.pointerId)) app.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (app.pointers.size === 2) {
        const [a, b] = [...app.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (app.pinch) {
          const ratio = dist / app.pinch;
          app.cam.zoom = clamp(app.cam.zoom * ratio, 0.08, 12);
        }
        app.pinch = dist;
      }
    } else {
      app.pointers.delete(e.pointerId);
      if (app.pointers.size < 2) app.pinch = 0;
    }
  }

  function runGuide(phase) {
    const limit = {
      airborne: 6000,
      orbit: 90000,
      atmo: 140000,
      dive: 155000,
      chute: 165000,
      land: 175000,
    }[phase] || 4000;
    app.auto = true;
    if (!app.autoMode) app.autoMode = "ascend";
    for (let i = 0; i < limit && app.flight && !app.flight.outcome; i += 1) {
      const info = flightInfo(app.flight);
      if (phase === "airborne" && info && info.radialAlt > 32 && info.speed > 18) break;
      if (phase === "orbit" && info && info.inOrbit && app.autoMode === "ascend") break;
      if (phase === "atmo" && info && info.vUp < 0 && info.radialAlt < info.body.atmosphereHeight && info.radialAlt > 24000) break;
      if (phase === "dive" && info && info.vUp < -20 && info.speed > 180 && info.radialAlt < 16000 && info.radialAlt > 6000 && info.chuteState < 0.15) break;
      if (phase === "chute" && info && info.chuteState > 0.45) break;
      const input = guidedInput();
      app.throttle = input.throttle;
      const result = step(app.flight, input, 1 / 30);
      app.flight = result.state;
      if (phase === "land" && app.flight.outcome) {
        for (const ev of result.events) onFlightEvent(ev);
        break;
      }
      if (app.flight.outcome && phase !== "land") break;
    }
    if (app.flight && app.flight.outcome === "land") {
      const landed = app.flight;
      if (!view.querySelector(".modal")) onFlightEvent({ type: "land" });
      app.flight = landed;
    }
    drawFlight();
    return snapshot();
  }

  function crashDive() {
    if (app.screen !== "flight") return snapshot();
    hideOverlay();
    const vessel = app.flight && app.flight.vessels.find((v) => v.id === app.flight.activeId);
    if (!vessel) return snapshot();
    const r = Math.hypot(vessel.x, vessel.y) || 1;
    const bodyR = flightInfo(app.flight).body.radius;
    vessel.x = (vessel.x / r) * (bodyR + 50);
    vessel.y = (vessel.y / r) * (bodyR + 50);
    vessel.vx = (-vessel.x / r) * 280;
    vessel.vy = (-vessel.y / r) * 280;
    vessel.omega = 0;
    app.flight.outcome = null;
    app.flight.pendingFailure = null;
    app.flight.leftPad = true;
    app.flight.warpIndex = 0;
    app.auto = false;
    app.cam.map = false;
    app.cam.zoom = 1;
    for (let i = 0; i < 160 && !app.flight.outcome; i += 1) {
      const result = step(app.flight, playerInput(), 0.05);
      app.flight = result.state;
      if (app.flight.outcome) {
        for (const ev of result.events) onFlightEvent(ev);
      }
    }
    drawFlight();
    return snapshot();
  }

  function snapshot() {
    const info = app.flight ? flightInfo(app.flight) : null;
    const modal = view.querySelector(".modal h4") || document.querySelector("#overlay h4");
    return {
      screen: app.screen,
      outcome: app.flight ? app.flight.outcome : null,
      reason: app.flight ? app.flight.crashReason : null,
      title: modal ? modal.textContent : "",
      alt: info ? info.radialAlt : null,
      speed: info ? info.speed : null,
      peri: info ? info.periAlt : null,
      apo: info ? info.apoAlt : null,
      chute: info ? info.chuteState : null,
      map: app.cam.map,
      warp: info ? info.warpSpeed : null,
    };
  }

  function horizonY(h, alt) {
    const drop = 1 - Math.exp(-Math.max(0, alt) / 1800);
    return h * (0.68 + 0.4 * drop);
  }

  function drawFlight() {
    const canvas = view.querySelector("#sky");
    const info = app.flight && flightInfo(app.flight);
    if (!canvas || !info) return;
    drawScene(canvas, app.flight, app.cam);
    const layers = view.querySelector("#layers");
    if (layers) layers.innerHTML = "";
    const arrow = view.querySelector("#varr");
    if (arrow) arrow.hidden = true;
    view.querySelector("#read-speed").textContent = formatSpeed(info.speed);
    view.querySelector("#read-alt").textContent = formatAlt(info.alt);
    const peri = view.querySelector("#read-peri");
    const apo = view.querySelector("#read-apo");
    const showOrbit = info.e < 0.92 && info.radialAlt > 300;
    if (peri) peri.textContent = showOrbit ? formatAlt(info.periAlt) : "—";
    if (apo) apo.textContent = showOrbit ? formatAlt(info.apoAlt) : "—";
    view.querySelector("#fuel-fill").style.width = Math.round(info.fuel * 100) + "%";
    const warp = view.querySelector("#warp-label");
    if (warp) warp.textContent = "×" + info.warpSpeed;
    const ring = view.querySelector("#thr");
    if (ring && ring.paint) ring.paint();
    window.__TK.flight = app.flight;
    window.__TK.info = info;
  }

  function onKey(e) {
    if (e.target && e.target.tagName === "INPUT") return;
    if (e.repeat && (e.key === " " || e.key === "f" || e.key === "F" || e.key === "j" || e.key === "J")) return;
    const down = e.type === "keydown";
    if (e.key === "Escape" && down && app.screen === "flight" && overlay.hidden && app.flight && !app.flight.outcome) {
      openMenu();
      return;
    }
    if (app.screen === "build" && down) {
      if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (app.selected) removeAt(app.selected);
      } else if (e.key === "Enter") onFly();
      return;
    }
    if (app.screen !== "flight") return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    if (down && ["ArrowLeft", "ArrowRight", "a", "A", "d", "D", "w", "W", "s", "S", "ArrowUp", "ArrowDown", " ", "f", "F"].includes(e.key)) {
      stopAuto();
    }
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") app.keys.left = down;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") app.keys.right = down;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") app.keys.up = down;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") app.keys.down = down;
    if (down && (e.key === " " || e.key === "j" || e.key === "J")) app.edge.separate = true;
    if (down && (e.key === "f" || e.key === "F" || e.key === "k" || e.key === "K")) app.edge.deploy = true;
    if (down && (e.key === "[" || e.key === ",")) app.edge.warp = (app.edge.warp || 0) - 1;
    if (down && (e.key === "]" || e.key === ".")) app.edge.warp = (app.edge.warp || 0) + 1;
    if (down && (e.key === "m" || e.key === "M")) {
      app.cam.map = !app.cam.map;
      const btn = view.querySelector("#map-toggle");
      if (btn) btn.classList.toggle("on", app.cam.map);
    }
    if (down && (e.key === "+" || e.key === "=")) app.cam.zoom = clamp(app.cam.zoom * 1.15, 0.08, 12);
    if (down && (e.key === "-" || e.key === "_")) app.cam.zoom = clamp(app.cam.zoom / 1.15, 0.08, 12);
  }

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("beforeunload", () => {
    if (app.screen === "flight") saveFlight();
  });
  window.addEventListener("resize", () => {
    const portrait = window.innerHeight > window.innerWidth;
    if (portrait !== app.wasPortrait && app.screen === "build") app.view.manual = false;
    app.wasPortrait = portrait;
    if (app.screen === "build") drawBuild();
    else if (app.screen === "flight") drawFlight();
  });

  window.__TK = {
    screen: "home",
    parts: [],
    flight: null,
    get throttle() {
      return app.throttle;
    },
    set throttle(v) {
      app.throttle = clamp(v, 0, 1);
    },
    show,
    openWorld: (id, mode) => openWorld(id, mode),
    store,
    playUntil: (phase) => runGuide(phase),
    crashDive: () => crashDive(),
    snapshot: () => snapshot(),
    setMap: (on) => {
      app.cam.map = !!on;
      const btn = view.querySelector("#map-toggle");
      if (btn) btn.classList.toggle("on", app.cam.map);
      drawFlight();
    },
    setZoom: (z) => {
      app.cam.zoom = z;
      drawFlight();
    },
    images: loadImages(partImageUrls()),
  };

  show("home");
}
