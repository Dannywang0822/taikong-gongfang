/**
 * 自研本地存档。只存这个项目自己的 JSON，不兼容任何官方存档。
 */

import { artRocket, hopRocket } from "./rocket.js";

const KEY = "taikong-gongfang-play-v2";

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function seedWorlds() {
  const now = Date.now();
  return [
    {
      id: "sample-qingya",
      name: "青芽一号",
      color: "#5a9a6a",
      stroke: "#2a5a38",
      createdAt: now - 86400000,
      updatedAt: now - 1000,
      activity: "建造中",
      rocket: artRocket(),
      flight: null,
    },
    {
      id: "sample-field",
      name: "试飞场",
      color: "#c4a056",
      stroke: "#6a4a20",
      createdAt: now - 172800000,
      updatedAt: now - 7200000,
      activity: "已着陆",
      rocket: hopRocket(),
      flight: null,
    },
  ];
}

export function createStore(storage) {
  function read() {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 2 || !Array.isArray(data.worlds)) return null;
      return data;
    } catch {
      return null;
    }
  }
  function write(data) {
    storage.setItem(KEY, JSON.stringify(data));
  }
  function ensure() {
    let data = read();
    if (!data) {
      data = { v: 2, lastWorldId: "sample-qingya", worlds: seedWorlds() };
      write(data);
    }
    return data;
  }
  return {
    list() {
      return ensure()
        .worlds.slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get(id) {
      return ensure().worlds.find((w) => w.id === id) || null;
    },
    lastId() {
      return ensure().lastWorldId;
    },
    create(name) {
      const data = ensure();
      if (data.worlds.length >= 24) return null;
      const colors = ["#5a8ec4", "#c46a5a", "#7a6ac4", "#3a9a8a", "#c48a3a"];
      const world = {
        id: "w" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
        name: (name || "").trim().slice(0, 12) || "新的航程",
        color: colors[data.worlds.length % colors.length],
        stroke: "#1a2430",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activity: "建造中",
        rocket: [],
        flight: null,
      };
      data.worlds.unshift(world);
      data.lastWorldId = world.id;
      write(data);
      return world;
    },
    update(id, patch) {
      const data = ensure();
      const world = data.worlds.find((w) => w.id === id);
      if (!world) return null;
      Object.assign(world, patch);
      world.updatedAt = Date.now();
      data.lastWorldId = id;
      write(data);
      return world;
    },
    reset() {
      storage.removeItem(KEY);
    },
  };
}

const hasLocalStorage = typeof localStorage !== "undefined";
export const store = createStore(hasLocalStorage ? localStorage : memoryStorage());
