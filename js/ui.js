import { CHUTE_STATES, COPY, PICKER, SCALE, getPart } from "./data.js";
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
  formatAlt,
  formatSpeed,
  fuelFrac,
  lowestAGL,
  shouldShowVelocityArrow,
  speedOf,
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
    flight: null,
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
    showOverlay(`
      <h4>${COPY.fail.title}</h4>
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
      app.edge.separate = true;
    });
    view.querySelector("#btn-chute").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      app.edge.deploy = true;
    });
    bindThrottle(view.querySelector("#thr"));
    app.lastTs = 0;
    app.raf = requestAnimationFrame(loop);
  }

  function holdButton(btn, key) {
    const down = (e) => {
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
      if (app.keys.up) app.throttle = clamp(app.throttle + dt * 0.5, 0, 1);
      if (app.keys.down) app.throttle = clamp(app.throttle - dt * 0.5, 0, 1);
      const input = {
        throttle: app.throttle,
        left: app.hold.left || app.keys.left,
        right: app.hold.right || app.keys.right,
        separate: app.edge.separate,
        deploy: app.edge.deploy,
      };
      app.edge.separate = false;
      app.edge.deploy = false;
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

  function horizonY(h, alt) {
    // 自研表现：高度越高，地平线越沉出画面。不是贴在屏幕底边的色带。
    const drop = 1 - Math.exp(-Math.max(0, alt) / 1800);
    return h * (0.68 + 0.4 * drop);
  }

  function drawSky(canvas, alt) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const space = clamp((alt - 2500) / 14000, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, mix(hex("#6eb9ea"), hex("#071018"), space));
    g.addColorStop(0.55, mix(hex("#9fd0f2"), hex("#143044"), space));
    g.addColorStop(1, mix(hex("#d7eef8"), hex("#102030"), space));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (space > 0.2) {
      ctx.globalAlpha = (space - 0.2) / 0.8;
      ctx.fillStyle = "#f4f7fb";
      for (const star of STARS) ctx.fillRect(star.x * w, star.y * h * 0.9, star.s, star.s);
      ctx.globalAlpha = 1;
    }
    const hy = horizonY(h, alt);
    if (hy < h + 40) {
      const radius = Math.max(w, h) * (1.35 + Math.min(alt, 20000) / 6000);
      const cy = hy + radius * 0.98;
      const gg = ctx.createRadialGradient(w / 2, hy, radius * 0.2, w / 2, cy, radius);
      gg.addColorStop(0, "#9aaf68");
      gg.addColorStop(0.2, "#6f8a48");
      gg.addColorStop(1, "#3d5826");
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(w / 2, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function cameraFor(vessel, w, h, alt) {
    const att = vessel.att || 0;
    const c = Math.cos(att);
    const s = Math.sin(att);
    let maxX = 4;
    let maxY = 4;
    let minLocalY = 0;
    for (const p of vessel.parts) {
      minLocalY = Math.min(minLocalY, p.localY - p.halfH);
      const corners = [
        [p.localX - p.halfW, p.localY - p.halfH],
        [p.localX + p.halfW, p.localY - p.halfH],
        [p.localX - p.halfW, p.localY + p.halfH],
        [p.localX + p.halfW, p.localY + p.halfH],
      ];
      for (const [lx, ly] of corners) {
        const x = lx;
        const y = -ly;
        const xr = Math.abs(x * c + y * s);
        const yr = Math.abs(-x * s + y * c);
        maxX = Math.max(maxX, xr);
        maxY = Math.max(maxY, yr);
      }
    }
    const ppm = clamp(Math.min((w * 0.5) / maxX, (h * 0.48) / maxY), 6, 34);
    const tailDown = -minLocalY * ppm * Math.max(0, c);
    const hy = horizonY(h, alt);
    const anchorY = clamp(hy - tailDown - 10, h * 0.3, h * 0.58);
    return { ppm, anchor: { x: w * 0.42, y: anchorY } };
  }

  function drawFlight() {
    const canvas = view.querySelector("#sky");
    const vessel = app.flight && app.flight.vessels.find((v) => v.id === app.flight.activeId);
    if (!canvas || !vessel) return;
    const alt = Math.max(0, lowestAGL(vessel));
    drawSky(canvas, alt);
    const h = canvas.clientHeight;
    const w = canvas.clientWidth;
    const cam = cameraFor(vessel, w, h, alt);
    const ppm = cam.ppm;
    const anchor = cam.anchor;
    const layers = view.querySelector("#layers");
    const keep = new Set();
    for (const item of app.flight.vessels) {
      keep.add(item.id);
      let layer = layers.querySelector(`[data-vessel="${item.id}"]`);
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "layer";
        layer.dataset.vessel = item.id;
        layers.appendChild(layer);
      }
      const pos = refScreen(item, vessel, anchor, ppm);
      layer.style.transformOrigin = pos.x + "px " + pos.y + "px";
      layer.style.transform = `rotate(${item.att}rad)`;
      syncLayer(layer, spriteSpecs(item, pos, ppm));
    }
    for (const layer of [...layers.querySelectorAll(".layer")]) {
      if (!keep.has(layer.dataset.vessel)) layer.remove();
    }
    const speed = speedOf(vessel);
    view.querySelector("#read-speed").textContent = formatSpeed(speed);
    view.querySelector("#read-alt").textContent = formatAlt(alt);
    view.querySelector("#fuel-fill").style.width = Math.round(fuelFrac(vessel) * 100) + "%";
    const ring = view.querySelector("#thr");
    if (ring && ring.paint) ring.paint();
    const arrow = view.querySelector("#varr");
    const r = Math.hypot(vessel.x, vessel.y) || 1;
    const radial = { x: vessel.x / r, y: vessel.y / r };
    const right = { x: radial.y, y: -radial.x };
    const vUp = vessel.vx * radial.x + vessel.vy * radial.y;
    const vRt = vessel.vx * right.x + vessel.vy * right.y;
    if (!shouldShowVelocityArrow(speed)) {
      arrow.hidden = true;
    } else {
      const ang = Math.atan2(vRt, vUp);
      arrow.hidden = false;
      const reach = Math.min(96, Math.max(56, h * 0.12));
      arrow.style.left = anchor.x + Math.sin(ang) * reach + "px";
      arrow.style.top = anchor.y - Math.cos(ang) * reach + "px";
      arrow.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
    }
    window.__TK.flight = app.flight;
  }

  function refScreen(item, main, anchor, ppm) {
    if (item.id === main.id) return anchor;
    const dx = item.x - main.x;
    const dy = item.y - main.y;
    const r = Math.hypot(main.x, main.y) || 1;
    const radial = { x: main.x / r, y: main.y / r };
    const right = { x: radial.y, y: -radial.x };
    const up = dx * radial.x + dy * radial.y;
    const rt = dx * right.x + dy * right.y;
    return { x: anchor.x + rt * ppm, y: anchor.y - up * ppm };
  }

  function spriteSpecs(vessel, pos, ppm) {
    const s = SCALE.mPerPx * ppm;
    const thr = vessel.id === app.flight.activeId ? app.throttle : 0;
    const liquid = vessel.parts.some((p) => p.fuelType === "liquid" && p.fuel > 0.05);
    const engineOn = !!(vessel.controllable && thr > 0.02 && liquid);
    const specs = [];
    const ordered = vessel.parts.slice().sort((a, b) => rank(a) - rank(b));
    for (const p of ordered) {
      const cx = pos.x + p.localX * ppm;
      const cy = pos.y - p.localY * ppm;
      if (p.role === "chute" && (vessel.chute === "mid" || vessel.chute === "open")) {
        const def = getPart("parachute");
        const which = vessel.chute === "open" ? "open" : "mid";
        const spec = def.spriteSize[which];
        const stow = def.spriteSize.stow;
        const stowOcy = (stow.opaque.t + stow.opaque.b) / 2;
        const bottomY = cy + (stow.opaque.b - stowOcy) * s + 0.2 * ppm;
        const ocx = (spec.opaque.l + spec.opaque.r) / 2;
        specs.push({
          k: p.uid,
          src: def.sprites[which],
          left: cx - ocx * s,
          top: bottomY - spec.opaque.b * s,
          width: spec.w * s,
          height: spec.h * s,
          flip: false,
        });
        continue;
      }
      let src = p.src;
      let dh = p.spriteH * s;
      const dw = p.spriteW * s;
      if (p.role === "engine" && engineOn && p.plume) {
        src = p.plume;
        dh = p.plumeH * s;
      }
      const left = cx - p.ocx * s;
      const top = cy - p.ocy * s;
      specs.push({ k: p.uid, src, left, top, width: dw, height: dh, flip: p.flip });
      if (p.role === "booster" && p.ignited && p.fuel > 0.05) {
        const flicker = 0.82 + 0.18 * Math.sin(app.flight.time * 42 + p.localX);
        specs.push({
          k: "flame-" + p.uid,
          kind: "flame",
          left: left + dw * 0.3,
          top: top + dh * 0.9,
          width: dw * 0.4,
          height: dh * 0.24 * flicker,
        });
      }
    }
    return specs;
  }

  function rank(p) {
    if (p.role === "booster") return 2;
    if (p.role === "chute") return 3;
    return 1;
  }

  function syncLayer(layer, specs) {
    const have = new Map([...layer.children].map((el) => [el.dataset.k, el]));
    const keep = new Set();
    for (const spec of specs) {
      keep.add(spec.k);
      let el = have.get(spec.k);
      const wantFlame = spec.kind === "flame";
      if (!el || wantFlame !== (el.dataset.kind === "flame")) {
        if (el) el.remove();
        el = wantFlame ? document.createElement("div") : document.createElement("img");
        el.dataset.k = spec.k;
        el.dataset.kind = wantFlame ? "flame" : "img";
        if (wantFlame) el.className = "flame";
        else el.draggable = false;
        layer.appendChild(el);
      }
      if (el.tagName === "IMG" && el.getAttribute("src") !== spec.src) el.setAttribute("src", spec.src);
      el.style.left = spec.left + "px";
      el.style.top = spec.top + "px";
      el.style.width = spec.width + "px";
      el.style.height = spec.height + "px";
      if (el.tagName === "IMG") el.style.transform = spec.flip ? "scaleX(-1)" : "";
    }
    for (const [key, el] of have) if (!keep.has(key)) el.remove();
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
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") app.keys.left = down;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") app.keys.right = down;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") app.keys.up = down;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") app.keys.down = down;
    if (down && (e.key === " " || e.key === "j" || e.key === "J")) app.edge.separate = true;
    if (down && (e.key === "f" || e.key === "F" || e.key === "k" || e.key === "K")) app.edge.deploy = true;
  }

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("beforeunload", () => {
    if (app.screen === "flight") saveFlight();
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
  };

  show("home");
}
