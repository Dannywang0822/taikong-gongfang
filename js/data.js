/**
 * 太空工坊零件与手感。
 *
 * 几何来自锁定的原创零件图。质量、推力、比冲是原创数值，只参考
 * 「推力数 / 湿质量 ≈ 推重比」这种量级，不复刻任何零件表。
 * 天体尺度、气动、伞、碰撞和时间档的参考常数在 physics.js / bodies.js。
 */

export const EVIDENCE = "原创";

/** 与参考推力公式同一个 9.8，用来把推力数换成加速度量纲。 */
export const ISP_G0 = 9.8;

export const SCALE = {
  source: "原创",
  /** 芯级不透明宽度对应的直径，用来把零件图像换成米。 */
  coreDiameterM: 1.8,
  coreOpaquePx: 131,
};
SCALE.mPerPx = SCALE.coreDiameterM / SCALE.coreOpaquePx;

export const FUELS = {
  liquid: { id: "liquid", name: "液体燃料", resourceMass: 1 },
  solid: { id: "solid", name: "固体燃料", resourceMass: 1 },
};

/**
 * 姿态手感，全部可调。反作用轮力矩和喷管偏转角是为这套质量、米制杠杆调的；
 * 参考里指令舱力矩序列化值是 5，但单位对不上这套尺度，所以不直接拿来用。
 * RCS 的推力 1.5、比冲 120、两个角度阈值采用参考序列化值。
 */
export const CONTROL = {
  wheelTorque: 42,
  /** 重船太钝、轻舱太灵时，角加速度不超过这个值。 */
  maxAlpha: 0.95,
  gimbalDeg: 5.5,
  angularDamp: 1.7,
  rcsThrust: 1.5,
  rcsIsp: 120,
  rcsDirDeg: 45,
  rcsTorqueDeg: 40,
  chuteUpright: 2.4,
};

/** 分离冲量 = 力 × 倍率 × 一帧。帧长用参考里约 0.02 的固定步长，力是原创。 */
export const STAGE = {
  force: 4800,
  multiplier: 1,
  frame: 0.02,
};

export const LANDING = {
  /** 撑住撞击之后，速率低于参考里的 2 就判定已经落地。 */
  settleSpeed: 2,
  maxTilt: 0.65,
  leftPadAlt: 80,
  tipCrash: 0.85,
  /** 默认摩擦，接触时用来抹掉剩余横移。 */
  friction: 0.4,
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
    wetMass: 0.95,
    dryMassPercent: 1,
    fuelType: null,
    impact: "high",
    wheel: true,
    rcs: true,
    rcsFuel: 0.08,
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
    wetMass: 4,
    dryMassPercent: 0.15,
    fuelType: "liquid",
    impact: "medium",
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
    wetMass: 9,
    dryMassPercent: 0.12,
    fuelType: "liquid",
    impact: "medium",
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
    wetMass: 1.25,
    dryMassPercent: 1,
    fuelType: "liquid",
    thrust: 46,
    isp: 290,
    gimbal: true,
    impact: "medium",
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
    wetMass: 6.8,
    dryMassPercent: 0.18,
    fuelType: "solid",
    thrust: 38,
    isp: 210,
    impact: "low",
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
    wetMass: 0.14,
    dryMassPercent: 1,
    fuelType: null,
    impact: "low",
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
    wetMass: 0.08,
    dryMassPercent: 1,
    fuelType: null,
    impact: "low",
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
    wetMass: 0.3,
    dryMassPercent: 1,
    fuelType: null,
    impact: "medium",
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
    peri: "近地点",
    apo: "远地点",
    left: "左",
    right: "右",
    stage: "分离",
    chute: "开伞",
    map: "地图",
    warpUp: "加速",
    warpDown: "减速",
    auto: "演示入轨",
    manual: "手控",
    autoOn: "演示飞行中。碰一下操纵就会交回手控。",
    noStage: "没有可以分离的东西。",
    stagedBoosters: "助推器已分离。",
    stagedCore: "这一级已分离。",
    chuteHigh: "还太高，再低一些再开伞。",
    chuteFast: "速度太高，伞张不开。",
    chuteSlow: "几乎没在动，先不用开伞。",
    chuteThin: "这里没有大气。",
    chuteNone: "没有降落伞。",
    chuteOpen: "降落伞已打开。",
    chuteFull: "降落伞完全张开。",
    warpBlocked: "现在不能用这么高的时间加速。",
    warpAtmo: "还在大气层里，只能用物理档。",
    warpThrust: "发动机开着，时间保持一倍。",
    resume: "继续飞行",
    backBuild: "返回建造",
    backHome: "返回主菜单",
    zoomIn: "拉近",
    zoomOut: "拉远",
  },
  fail: {
    title: "没有落地",
    terrain: "火箭撞上了地表，结构没有撑住。",
    tip: "火箭在地面上翻倒了。",
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
      "试飞之后，上下拖动圆形油门起飞，按住「左」「右」或 A / D 转向。先竖直上升，再逐渐压平，让远地点升到大气层外，到远地点附近朝前推，把近地点也抬出去。",
      "地图上看轨道。大气层里或发动机开着时不能用高倍时间加速。再入之后，高度和速度都合适才开得了伞。伞会自己完全张开。落地要正、要慢，撞太狠会解体。",
    ],
  },
  credits: {
    title: "制作人员",
    body: "太空工坊是原创的浏览器火箭游戏。建造、轨道、画面和这套界面都是自己写的。锁定美术全部为原创绘制。重力、大气、推力和开伞用了公开分析里的规则和一部分常数；零件质量、推力和姿态手感是单独调的，不是原作数据。",
  },
  soon: "即将推出。",
  file: "请在项目目录运行 python3 -m http.server 8080，然后打开 http://localhost:8080 。直接双击 HTML 时，浏览器会拦截模块脚本。",
};
