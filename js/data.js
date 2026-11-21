/**
 * 太空工坊 P0 自研数据。
 *
 * 这里的每一个数字都是为了让建造–飞行–开伞闭环可玩、可单测而设的占位。
 * 它们不是从官方游戏提取的数值，代码和界面都不得把它们说成官方数据。
 * 证据等级沿用项目规格里的「估计」。
 */

export const EVIDENCE = "估计";

/** 把比冲换成排气速度时用的标准重力。不是从官方公式还原的常数。 */
export const ISP_G0 = 9.80665;

export const SCALE = {
  source: EVIDENCE,
  /** 芯级不透明宽度对应的直径，用来把零件图像换成米。 */
  coreDiameterM: 1.8,
  coreOpaquePx: 131,
};
SCALE.mPerPx = SCALE.coreDiameterM / SCALE.coreOpaquePx;

export const PLANET = {
  source: EVIDENCE,
  id: "qingya",
  name: "青芽",
  radius: 80000,
  g: 7.5,
  atmScale: 4500,
  atmTop: 28000,
  rho0: 1.05,
};
PLANET.mu = PLANET.g * PLANET.radius * PLANET.radius;

export const FUELS = {
  liquid: {
    id: "liquid",
    name: "液体燃料",
    unit: "千克",
    density: 820,
    flow: 12.6,
    source: EVIDENCE,
  },
  solid: {
    id: "solid",
    name: "固体燃料",
    unit: "千克",
    density: 1200,
    flow: 13.4,
    source: EVIDENCE,
  },
};

export const AERO = {
  source: EVIDENCE,
  coreCdA: 1.05,
  boosterCdA: 0.55,
  chuteMid: 48,
  chuteOpen: 420,
};

export const CHUTE = {
  source: EVIDENCE,
  /** 约 8 km、约 190 m/s 开伞不应直接算成功，所以门限收在这下面。 */
  maxAlt: 4500,
  maxSpeed: 80,
  deployTime: 1.2,
};

export const LANDING = {
  source: EVIDENCE,
  /** 约 15–20 m/s 的下沉不算轻落地。 */
  maxSink: 11,
  maxLateral: 8,
  maxTilt: 0.6,
  /** 底部高出这段之后，才按飞行中的落地规则，而不是发射台。 */
  leftPadAlt: 40,
  /** 还在发射台附近时，超过这个地速或倾角就坠毁。估计。 */
  padSlideSpeed: 22,
  tipCrash: 0.85,
};

export const CONTROL = {
  source: EVIDENCE,
  /** 短按只是小幅倾斜，按住几秒才会接近水平。 */
  alpha: 0.62,
  maxOmega: 0.42,
  damp: 2.4,
};

export const STAGE = {
  source: EVIDENCE,
  impulse: 6,
};

/**
 * 零件几何取自锁定图的不透明边界，节点是自研吸附规则用的锚点。
 * 质量、燃料、推力和比冲全部是估计。
 */
export const PARTS = {
  "cmd-pod": {
    id: "cmd-pod",
    name: "指令舱",
    role: "pod",
    attachAs: "nose",
    src: "assets/parts/cmd-pod.png",
    w: 143,
    h: 245,
    opaque: { l: 6, t: 6, r: 136, b: 238 },
    nodes: {
      top: { x: 71, y: 6, accepts: ["parachute"] },
      bottom: { x: 71, y: 238, accepts: ["stack", "engine"] },
    },
    dry: 700,
    fuel: 0,
    fuelType: null,
    source: EVIDENCE,
  },
  "tank-short": {
    id: "tank-short",
    name: "短储箱",
    role: "tank",
    attachAs: "stack",
    src: "assets/parts/tank-short.png",
    w: 143,
    h: 179,
    opaque: { l: 6, t: 6, r: 136, b: 172 },
    nodes: {
      top: { x: 71, y: 6, accepts: ["stack", "nose"] },
      bottom: { x: 71, y: 172, accepts: ["stack", "engine"] },
      "side-left": { x: 6, y: 110, accepts: ["booster"] },
      "side-right": { x: 136, y: 110, accepts: ["booster"] },
    },
    dry: 180,
    fuel: 900,
    fuelType: "liquid",
    source: EVIDENCE,
  },
  "tank-long": {
    id: "tank-long",
    name: "长储箱",
    role: "tank",
    attachAs: "stack",
    src: "assets/parts/tank-long.png",
    w: 143,
    h: 387,
    opaque: { l: 6, t: 6, r: 136, b: 380 },
    nodes: {
      top: { x: 71, y: 6, accepts: ["stack", "nose"] },
      bottom: { x: 71, y: 380, accepts: ["stack", "engine"] },
      "side-left": { x: 6, y: 310, accepts: ["booster"] },
      "side-right": { x: 136, y: 310, accepts: ["booster"] },
    },
    dry: 360,
    fuel: 2400,
    fuelType: "liquid",
    source: EVIDENCE,
  },
  "engine-liquid": {
    id: "engine-liquid",
    name: "液体发动机",
    role: "engine",
    attachAs: "engine",
    src: "assets/parts/engine-liquid.png",
    plume: "assets/parts/engine-liquid-plume.png",
    plumeH: 436,
    w: 115,
    h: 237,
    opaque: { l: 4, t: 4, r: 110, b: 232 },
    nodes: {
      top: { x: 57, y: 4, accepts: ["stack", "nose"] },
    },
    dry: 500,
    fuel: 0,
    fuelType: "liquid",
    thrust: 34000,
    isp: 262,
    source: EVIDENCE,
  },
  "booster-solid": {
    id: "booster-solid",
    name: "固体助推",
    role: "booster",
    attachAs: "booster",
    src: "assets/parts/booster-solid.png",
    w: 120,
    h: 495,
    opaque: { l: 6, t: 6, r: 113, b: 488 },
    /** 挂耳在图像左侧，中点约在两条挂耳之间。 */
    nodes: {
      side: { x: 16, y: 252, accepts: [] },
    },
    bodyLeft: 33,
    bodyRight: 109,
    dry: 280,
    fuel: 1100,
    fuelType: "solid",
    thrust: 28000,
    isp: 214,
    source: EVIDENCE,
  },
  decoupler: {
    id: "decoupler",
    name: "分离器",
    role: "decoupler",
    attachAs: "stack",
    src: "assets/parts/decoupler.png",
    w: 139,
    h: 67,
    opaque: { l: 4, t: 4, r: 134, b: 62 },
    nodes: {
      top: { x: 69, y: 4, accepts: ["stack", "nose"] },
      bottom: { x: 69, y: 62, accepts: ["stack", "engine"] },
    },
    dry: 70,
    fuel: 0,
    fuelType: null,
    source: EVIDENCE,
  },
  parachute: {
    id: "parachute",
    name: "降落伞",
    role: "chute",
    attachAs: "parachute",
    src: "assets/parts/parachute-stow.png",
    sprites: {
      stow: "assets/parts/parachute-stow.png",
      mid: "assets/parts/parachute-mid.png",
      open: "assets/parts/parachute-open.png",
    },
    spriteSize: {
      stow: { w: 67, h: 123, opaque: { l: 4, t: 4, r: 62, b: 118 } },
      mid: { w: 249, h: 231, opaque: { l: 6, t: 6, r: 242, b: 224 } },
      open: { w: 349, h: 379, opaque: { l: 6, t: 6, r: 342, b: 372 } },
    },
    w: 67,
    h: 123,
    opaque: { l: 4, t: 4, r: 62, b: 118 },
    nodes: {
      bottom: { x: 33, y: 118, accepts: [] },
    },
    dry: 50,
    fuel: 0,
    fuelType: null,
    source: EVIDENCE,
  },
  adapter: {
    id: "adapter",
    name: "结构转接件",
    role: "adapter",
    attachAs: "stack",
    src: "assets/parts/adapter.png",
    w: 143,
    h: 161,
    opaque: { l: 6, t: 6, r: 136, b: 154 },
    nodes: {
      top: { x: 71, y: 6, accepts: ["stack", "nose"] },
      bottom: { x: 71, y: 154, accepts: ["stack", "engine"] },
      "side-left": { x: 6, y: 90, accepts: ["booster"] },
      "side-right": { x: 136, y: 90, accepts: ["booster"] },
    },
    dry: 140,
    fuel: 0,
    fuelType: null,
    source: EVIDENCE,
  },
};

/** 拾取栏从数据生成。非 P0 分类（整流罩等）不在这里。 */
export const PICKER = {
  source: "自研",
  columns: 4,
  order: [
    "cmd-pod",
    "tank-short",
    "tank-long",
    "engine-liquid",
    "booster-solid",
    "decoupler",
    "parachute",
    "adapter",
  ],
};

export const CHUTE_STATES = [
  { id: "stow", name: "收起", src: "assets/parts/parachute-stow.png" },
  { id: "mid", name: "展开", src: "assets/parts/parachute-mid.png" },
  { id: "open", name: "打开", src: "assets/parts/parachute-open.png" },
];

export function getPart(id) {
  return PARTS[id];
}

export const COPY = {
  meta: {
    title: "太空工坊",
    tagline: "建造、飞行、回家",
  },
  home: {
    start: "开始",
    resume: "继续",
    build: "造火箭",
    tutorial: "教程",
    mods: "模组",
    community: "社区",
    credits: "制作人员",
    shop: "商店",
    notices: "通知",
    soon: "即将推出",
  },
  worlds: {
    title: "世界",
    create: "创建世界",
    name: "世界名称",
    placeholder: "新的航程",
    recent: "最近",
    empty: "还没有世界。起一个名字就能创建。",
    tooMany: "世界太多了，先用现有的飞一飞。",
  },
  build: {
    title: "建造",
    undo: "撤销",
    detach: "拆除",
    fly: "试飞",
    hint: "点选零件，再点亮起的接口。",
    noUndo: "没有可以撤销的操作。",
    ready: "可以试飞。",
    noPod: "还没有指令舱。",
    noEngine: "还没有发动机或固体助推。",
    noFuel: "这级还没有燃料，加上储箱再试飞。",
    lowTwR: "推力可能抬不起来，仍可以试飞。",
    badRoot: "这个零件不能单独当第一级。",
    needNode: "点亮起的接口，才能接上去。",
    noFit: "这里接不上。",
    onePod: "只能有一个指令舱。",
    oneEngine: "液体发动机只能装一台。",
    oneChute: "只能有一具降落伞。",
  },
  flight: {
    fuel: "燃料",
    menu: "菜单",
    speed: "速度",
    throttle: "油门",
    alt: "离地",
    left: "左",
    right: "右",
    stage: "分离",
    chute: "开伞",
    noStage: "没有可以分离的东西。",
    stagedBoosters: "助推器已分离。",
    stagedCore: "这一级已分离。",
    chuteHigh: "还太高，再低一些再开伞。",
    chuteFast: "速度太高，伞张不开。",
    chuteNone: "没有降落伞。",
    chuteOpen: "降落伞已打开。",
    resume: "继续飞行",
    backBuild: "返回建造",
    backHome: "返回主菜单",
  },
  fail: {
    title: "没有落地",
    body: "还可以再试一次，或结束这次飞行。",
    retry: "重试",
    end: "结束任务",
    back: "返回",
  },
  land: {
    title: "已经落地",
    body: "火箭停在地面上。",
  },
  end: {
    title: "结束任务",
    body: "这次飞行到这里。",
  },
  tutorial: {
    title: "教程",
    next: "下一步",
    done: "知道了",
    steps: [
      "点下方的零件，再点火箭上亮起的圆点，零件就会接上去。第一件也可以直接放到空台上。",
      "点一下已经放好的零件可以选中。选错了按「撤销」；「拆除」会拿掉选中的零件，以及接在它下面的部分。",
      "没有燃料就不能试飞。短储箱和长储箱装液体燃料，固体助推自己带着燃料。分离器会把上下两段切开。",
      "试飞之后，上下拖动圆形油门起飞，按住「左」「右」转向。分离会先抛下侧面的助推，再断开最下面的分离器。离地低一些、速度不大时再开伞。",
    ],
  },
  credits: {
    title: "制作人员",
    body: "太空工坊是个人研究的原创试作。建造、飞行和这套界面都是自己写的。锁定美术 v0.4 全部为原创绘制，不是官方应用里的图片、字体或音频。飞行用的质量、推力和大气没有公开可引用的官方数值，在代码里标为估计。",
  },
  soon: "即将推出。",
  file: "请在项目目录运行 python3 -m http.server 8080，然后打开 http://localhost:8080 。直接双击 HTML 时，浏览器会拦截模块脚本。",
};
