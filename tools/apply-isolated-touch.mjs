/**
 * apply-isolated-touch.mjs
 *
 * 游戏侧（Web 载荷）补丁总入口，幂等：
 * 1. application.js & index.js: 挂载 window.cc = engine（场景名查询即时可靠）。
 * 2. assets/main/index.js:
 *    - 维护 window.__isInGame 场景标志位（进关卡置 true，出关卡置 false）；
 *    - 清除 Mouse.ts 里被误绑的 TOUCH_*（详见下方 step 4 的注释）+ onMouseMove 触摸兜底；
 *    - 在 UIInGame.onMouseDown 注入坐标同步与 squares.update(0)，实现关内草坪单击即种；
 *    - 在 UIInGame.onMouseDown 注入 DroppedCards 触控几何判定，解决砸罐子掉落卡无法触控选中。
 *
 * 【已删除】旧版曾在此脚本里往 index.html 注入「场景隔离触摸桥」。该桥是关外导航失效的
 * 元凶之一（捕获阶段监听会破坏 Cocos 的节点级 TOUCH_END），现行架构要求 index.html
 * 100% 保持官方原版；关外输入一律交给原生触摸管线，故本步骤永久移除。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const targetDir = process.argv[2];
if (!targetDir || !fs.existsSync(targetDir)) {
  console.error('Usage: node apply-isolated-touch.mjs <webDir>');
  process.exit(1);
}

console.log('Applying isolated touch architecture to:', targetDir);

// 1. application.js: 导出 window.cc
const appJsPath = path.join(targetDir, 'application.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');
if (!appJs.includes('window.cc = engine;')) {
  appJs = appJs.replace('cc = engine;', 'cc = engine;\n            window.cc = engine;');
  fs.writeFileSync(appJsPath, appJs, 'utf8');
  console.log('✓ application.js: window.cc = engine');
} else {
  console.log('- application.js: already contains window.cc');
}

// 2. index.js: 导出 window.cc
const idxJsPath = path.join(targetDir, 'index.js');
let idxJs = fs.readFileSync(idxJsPath, 'utf8');
if (!idxJs.includes('window.cc = engine;')) {
  idxJs = idxJs.replace('topLevelImport(\'cc\').then(function (engine) {', 'topLevelImport(\'cc\').then(function (engine) {\n        window.cc = engine;');
  fs.writeFileSync(idxJsPath, idxJs, 'utf8');
  console.log('✓ index.js: window.cc = engine');
} else {
  console.log('- index.js: already contains window.cc');
}

// 3. assets/main/index.js: 标记 window.__isInGame + 关内单击即种补丁
const mainJsPath = path.join(targetDir, 'assets', 'main', 'index.js');
let mainJs = fs.readFileSync(mainJsPath, 'utf8');

// (a) 进出关卡标记 window.__isInGame
if (!mainJs.includes('window.__isInGame=!0')) {
  mainJs = mainJs.replace(/this\.GoToScene\("inGameScene",!t\);case \d+:this\.isInGame=!0[,;]/, '$&window.__isInGame=!0,');
  mainJs = mainJs.replace(/case 4:return this\.isInGame=!1,/, '$&window.__isInGame=!1,');
  mainJs = mainJs.replace(/([a-zA-Z0-9_$]+)\.isInGame=!1,/g, '$1.isInGame=!1,window.__isInGame=!1,');
  console.log('✓ assets/main/index.js: KeyListener window.__isInGame flags injected');
} else {
  console.log('- assets/main/index.js: KeyListener flags already present');
}

// (b) UIInGame.onMouseDown「单击即种」补丁（修正版 v3）
//
// 【真因定稿 2026-10-02，屏上诊断层 + 放大截图取证】
//   v2 把 this.squares 当成 Square 类使用：this.squares.judgeLIndex / judgeCIndex / getLnC。
//   但 UIInGame.squares 是 Square.ts 的「管理器实例」——实例上只有 update/readIndex/plantGhost，
//   而 judgeLIndex / judgeCIndex / getLnC 是 Square 类的【静态方法】（UI.ts 里别名 F=e.Square）。
//   于是「选中植物卡」（this.index !== -1）后每次 mousedown 都在注入块里抛
//       TypeError: this.squares.judgeLIndex is not a function
//   该异常中断 UIInGame.onMouseDown 的剩余逻辑（含把目标格子 index 置 1 的悬停提升链），
//   表现为：点绿格 → 格子变红（indexPoint 已置 1）但 index 仍为 0 → 格子自己的
//   onMouseDown 里 `if(this.index)` 不成立 → 不调用 PlaceUIPlant → 卡片不消耗、阳光不扣、种不下。
//   关外不受影响，因为只有选中卡片（this.index!=-1）才会走到这三行判定。
//   修正：判定方法全部走 Square 类别名，且一律加 typeof 兜底 —— 注入代码永不允许抛异常。
const UI_HEAD = 'System.register("chunks:///_virtual/UI.ts"';
const uiStart = mainJs.indexOf(UI_HEAD);
if (uiStart < 0) throw new Error('无法定位 UI.ts 模块，拒绝写入');
const uiEndIdx = mainJs.indexOf('System.register(', uiStart + UI_HEAD.length);
const uiMod = mainJs.slice(uiStart, uiEndIdx > 0 ? uiEndIdx : uiStart + 40000);
const sqAliasM = uiMod.match(/(\w+)=e\.Square\}/);
const mouseAliasM = uiMod.match(/(\w+)=e\.Mouse\}/);
if (!sqAliasM || !mouseAliasM) throw new Error('无法解析 UI.ts 的 Square/Mouse 模块别名，拒绝写入');
const SQ = sqAliasM[1]; // Square 类别名（静态 judgeLIndex/judgeCIndex/getLnC 在这里）
const MS = mouseAliasM[1]; // Mouse 类别名（_position / position / mouseInLnC 在这里）
const utAliasM = uiMod.match(/(\w+)=e\.UITransform[,\}]/);
const UT = utAliasM ? utAliasM[1] : 'T'; // UITransform 组件类别名

const LOCK_SEL = `_tg&&_tg.isInLawn()&&(${MS}.mouseInLnC=_tg,_tg.index=1,_tg.indexPoint=1);`;
const LOCK_BROKEN = 'this.squares.judgeLIndex(';
const LOCK_SRC_OLD =
  `this.squares&&this.squares.update(0);` +
  `if(-1!=this.index&&this.squares){` +
  `var _l=this.squares.judgeLIndex(${MS}.position.y),_c=this.squares.judgeCIndex(${MS}.position.x),_tg=this.squares.getLnC(_l,_c);` +
  `${LOCK_SEL}}`;
const LOCK_SRC_NEW =
  `this.squares&&typeof this.squares.update==="function"&&this.squares.update(0);` +
  `if(-1!=this.index&&typeof ${SQ}.judgeLIndex==="function"&&typeof ${SQ}.getLnC==="function"){` +
  `var _l=${SQ}.judgeLIndex(${MS}.position.y),_c=${SQ}.judgeCIndex(${MS}.position.x),_tg=${SQ}.getLnC(_l,_c);` +
  `${LOCK_SEL}}`;

if (mainJs.includes(LOCK_BROKEN)) {
  if (!mainJs.includes(LOCK_SRC_OLD)) throw new Error('检测到 v2 误用但锚点形态不符，拒绝猜测性改写');
  mainJs = mainJs.replace(LOCK_SRC_OLD, LOCK_SRC_NEW);
  console.log(`✓ assets/main/index.js: patch-tap-plant v2→v3 修正（判定改走 Square 类 ${SQ}，全量 typeof 兜底）`);
} else if (mainJs.includes(`typeof ${SQ}.judgeLIndex==="function"`)) {
  console.log(`- assets/main/index.js: patch-tap-plant v3 已存在（Square 类 ${SQ}）`);
} else if (mainJs.includes('this.squares&&this.squares.update(0)')) {
  // v1（只有坐标同步 + update）→ 升级为 v3
  const v1Target = 'this.squares&&this.squares.update(0);';
  mainJs = mainJs.replace(v1Target, LOCK_SRC_NEW);
  console.log(`✓ assets/main/index.js: patch-tap-plant v1→v3（Square 类 ${SQ}）`);
} else {
  const HEAD_RE = /(this\.MouseClickCoolingDown=2;)var (\w+)=!1,(\w+)=e\.getButton\(\);/;
  const headMatches = [...mainJs.matchAll(new RegExp(HEAD_RE.source, 'g'))];
  if (headMatches.length !== 1) {
    throw new Error(`头部锚点命中 ${headMatches.length} 次，期望 1 次`);
  }
  const m = headMatches[0];
  const iVar = m[2];
  const oVar = m[3];
  const inject =
    `${m[1]}` +
    `e.getUILocationX&&(${MS}._position.x=e.getUILocationX(),${MS}._position.y=e.getUILocationY());` +
    LOCK_SRC_NEW +
    `var ${iVar}=!1,${oVar}=e.getButton();`;
  mainJs = mainJs.replace(m[0], inject);
  console.log(`✓ assets/main/index.js: patch-tap-plant v3 注入（Square ${SQ} / Mouse ${MS}，vars ${iVar}/${oVar}）`);
}

// (b2) LnC.onMouseDown 兜底提升：触屏没有悬停，让「本次点中的格子」自己成为种植目标。
// 修好 v3 后这一条通常不再必要；保留它是因为节点派发与 UIInGame 全局处理器的先后顺序
// 依赖引擎实现，一旦顺序不利，本兜底仍能保证「点一下就种」。只在
// 「未选中格子 + 左键 + 当前选中了植物卡(0..8) + 在草坪内 + currentCF 存在」时生效。
const LNC_HEAD = 'System.register("chunks:///_virtual/LnC.ts"';
const lncStart = mainJs.indexOf(LNC_HEAD);
if (lncStart < 0) throw new Error('无法定位 LnC.ts 模块，拒绝写入');
const lncEndIdx = mainJs.indexOf('System.register(', lncStart + LNC_HEAD.length);
const lncMod = mainJs.slice(lncStart, lncEndIdx > 0 ? lncEndIdx : lncStart + 64000);
const LNC_HEAD_RE =
  /(\w+)\.preventSwallow=!0;var (\w+)=(\w+)\.getButton\(\),(\w+)=(\w+)\.index,(\w+)=function\(\)\{\5\.component\.MouseListenOffThisTick=!0\};/;
const lncMatches = [...lncMod.matchAll(new RegExp(LNC_HEAD_RE.source, 'g'))];
if (lncMatches.length !== 1) {
  throw new Error(`LnC.onMouseDown 头部锚点命中 ${lncMatches.length} 次，期望 1 次`);
}
const lm = lncMatches[0];
const lBtn = lm[2];   // 按键变量：var <lBtn> = t.getButton()
const lCardIdx = lm[4]; // 卡片序号变量：var <lCardIdx> = m.index（复用为守卫条件更贴近原意）
const lUI = lm[5];    // UIInGame 单例别名：<lUI>.index / <lUI>.component
const LNC_PROMOTE_MARK = `this.UIInGame.currentCF)this.index=1`;
if (mainJs.includes(LNC_PROMOTE_MARK)) {
  console.log('- assets/main/index.js: LnC 单击兜底提升已存在');
} else {
  const promote =
    `if(!this.index&&0===${lBtn}&&${lCardIdx}>=0&&${lCardIdx}<=8&&typeof this.isInLawn==="function"&&this.isInLawn()&&this.UIInGame&&this.UIInGame.currentCF)this.index=1,this.indexPoint=1;`;
  mainJs = mainJs.replace(lm[0], lm[0] + promote);
  console.log(`✓ assets/main/index.js: LnC 单击兜底提升已注入（button=${lBtn}, cardIdx=${lCardIdx}, UI=${lUI}）`);
}

// (b3) 侧边卡片栏（PocketUI）一次性迁移 —— 手机端把植物卡片条从顶部挪到侧边
//
// 现象：手机上是"植物（种子栏）在上面"，希望改成侧边竖排（口袋/侧边卡片栏）。
// 机制：游戏的 PocketUI 布局本身就是侧边竖排大卡（`Cards` 里 `PocketUI?122:505` 宽度、
//       `spacingY:-70`、`node.position=(-400,238)`、滑动收屏蔽方向为左），且**代码默认值已是 true**
//       （`Setting` 构造函数 `this.PocketUI=!0`）。真正把它按回顶部的是**存档**：
//       `SettingWindow.getSettings()` 末尾 `D.PocketUI=(e.PocketUI===undefined||null)?!0:!!e.PocketUI`
//       —— 早期版本默认值是 false，只要那时保存过一次，localStorage 里就有 `PocketUI:false`，
//       而 localStorage 跨版本升级不丢，于是永远覆盖代码默认值。
// 做法：一次性迁移键。首次启动强制 PocketUI=true 并落键；**此后完全尊重存档与游戏内开关**
//       （设置窗口里那个「PocketUI」按钮可随时切回顶部，颜色绿=侧边/红=顶部）。
const POCKET_ANCHOR = 'D.PocketUI=(e.PocketUI===undefined||e.PocketUI===null)?!0:!!e.PocketUI,';
const POCKET_ANCHOR_16 = 'F.PocketUI=!!e.PocketUI,';
const POCKET_MIGR = 'w.localStorage.getItem("__pvzgePocketSideV1")||(D.PocketUI=!0,w.localStorage.setItem("__pvzgePocketSideV1","1")),';
const POCKET_MIGR_16 = '(typeof window!=="undefined"&&window.localStorage&&!window.localStorage.getItem("__pvzgePocketSideV1")?(e.PocketUI=!0,window.localStorage.setItem("__pvzgePocketSideV1","1")):0),';
const POCKET_MARK = '__pvzgePocketSideV1';
if (mainJs.includes(POCKET_MARK)) {
  console.log('- assets/main/index.js: 侧边卡片栏迁移已存在');
} else if (mainJs.includes(POCKET_ANCHOR)) {
  const pocketHits = mainJs.split(POCKET_ANCHOR).length - 1;
  if (pocketHits !== 1) throw new Error(`PocketUI 读取锚点命中 ${pocketHits} 次，期望 1 次`);
  mainJs = mainJs.replace(POCKET_ANCHOR, POCKET_ANCHOR + POCKET_MIGR);
  console.log('✓ assets/main/index.js: 侧边卡片栏（PocketUI）一次性迁移已注入 (0.15)');
} else if (mainJs.includes(POCKET_ANCHOR_16)) {
  const pocketHits = mainJs.split(POCKET_ANCHOR_16).length - 1;
  if (pocketHits !== 1) throw new Error(`PocketUI 0.16 读取锚点命中 ${pocketHits} 次，期望 1 次`);
  mainJs = mainJs.replace(POCKET_ANCHOR_16, POCKET_MIGR_16 + POCKET_ANCHOR_16);
  console.log('✓ assets/main/index.js: 侧边卡片栏（PocketUI）一次性迁移已注入 (0.16)');
} else {
  console.warn('WARN: 未匹配到 PocketUI 锚点，跳过该项');
}

// (b4) 掉落植物卡（DroppedCards）触控几何击中判定补丁
// 砸罐子（Vasebreaker）关卡中打碎罐子掉落植物卡，触控点击无 hover 导致 PointedAt === 0，卡片无法选中。
// 在 DroppedCards.find 中注入触控几何击中判定（judgeInUITransform）：检查 e.cf.node 或 e.node 的 UITransform 是否命中当前触摸坐标。
const DROPPED_CARDS_SRC_OLD =
  'var u,c=this.DroppedCards.concat().reverse().find((function(e){return e.cf.ca.PointedAt>0}));';
const DROPPED_CARDS_SRC_NEW =
  `var u,c=this.DroppedCards.concat().reverse().find((function(e){return e.cf.ca.PointedAt>0||(typeof ${MS}.judgeInUITransform==="function"&&((e.cf&&e.cf.node&&e.cf.node.getComponent(${UT})&&${MS}.judgeInUITransform(e.cf.node.getComponent(${UT})))||(e.node&&e.node.getComponent(${UT})&&${MS}.judgeInUITransform(e.node.getComponent(${UT})))))}));`;

if (mainJs.includes(DROPPED_CARDS_SRC_NEW)) {
  console.log('- assets/main/index.js: 掉落植物卡触控几何击中判定补丁已存在（幂等）');
} else if (mainJs.includes(DROPPED_CARDS_SRC_OLD)) {
  const droppedHits = mainJs.split(DROPPED_CARDS_SRC_OLD).length - 1;
  if (droppedHits !== 1) throw new Error(`DroppedCards 锚点命中 ${droppedHits} 次，期望 1 次`);
  mainJs = mainJs.replace(DROPPED_CARDS_SRC_OLD, DROPPED_CARDS_SRC_NEW);
  console.log(`✓ assets/main/index.js: 掉落植物卡触控几何击中判定补丁已注入 (Mouse ${MS}, UITransform ${UT})`);
} else {
  throw new Error('未匹配到 DroppedCards 原型锚点，拒绝写入');
}

// 4. assets/main/index.js: 清除 Mouse.ts 里被误绑的 TOUCH_*（2026-10-02 修复）
//
// 现象：选世界/选关界面（worldMapScene）点按与滑动全部无反应，标题与选玩家正常。
// 真因：Mouse.onLoad 被加了三行 TOUCH_MOVE/TOUCH_START/TOUCH_END 绑定，而 Mouse.onMouseMove
//       调的是 e.getUILocationX() —— 该 API 只存在于 EventMouse 与 Touch，EventTouch 没有。
//       引擎自带「鼠标→触摸模拟」，装机态（原生触摸被抑制）每次点击都会生成 EventTouch 派发
//       到 Mouse 组件所在节点（worldMapScene/Canvas 上就挂着 Mouse），于是派发链里抛
//       TypeError，Cocos 的触摸派发被中断：只绑 TOUCH_END 的 WorldMapChooser / WorldMap 关卡
//       入口再也收不到事件（实测节点级 TOUCH_START/END 计数为 0，正常应为 1）。
// 正解：恢复上游只绑 MOUSE_*；并给 onMouseMove 加触摸兜底，避免同类结构再被误用。
const MOUSE_TOUCHBIND =
  'this.node.on(l.EventType.TOUCH_MOVE,this.onMouseMove,this),' +
  'this.node.on(l.EventType.TOUCH_START,(function(e){this.onMouseMove(e);this.onMouseDown(e)}),this),' +
  'this.node.on(l.EventType.TOUCH_END,this.onMouseUp,this)';
const MOUSE_MOVE_HEAD = 'r.onMouseMove=function(e){';
const MOUSE_MOVE_GUARD = 'if(typeof e.getUILocationX!=="function")return;';

let mouseFixNote = [];
// 注意：这段绑定紧跟在 MOUSE_UP 绑定之后，前面那个逗号必须一起删掉，否则会留下悬空逗号
// （语法校验会拦下并放弃写盘 —— 已实测）。
if (mainJs.includes(',' + MOUSE_TOUCHBIND)) {
  mainJs = mainJs.replace(',' + MOUSE_TOUCHBIND, '');
  mouseFixNote.push('已移除 Mouse.onLoad 的 TOUCH_* 误绑（连同前导逗号）');
} else if (mainJs.includes(MOUSE_TOUCHBIND)) {
  mainJs = mainJs.replace(MOUSE_TOUCHBIND, '');
  mouseFixNote.push('已移除 Mouse.onLoad 的 TOUCH_* 误绑（无前导逗号形态）');
} else {
  mouseFixNote.push('TOUCH_* 误绑不存在（干净）');
}
// 删除结果必须结构化复验：Mouse.ts 模块内不得残留任何 TOUCH_* 绑定。
// （只认一处字面量是不够的：独立复审反例 t3/t6 证明"只回插 TOUCH_START/END"或"改用别名"会漏检，
//   而 Mouse.onMouseDown/onMouseUp 用的 e.getButton() 同样只属 EventMouse，照样会中断派发链。）
const MOD_HEAD = 'System.register("chunks:///_virtual/Mouse.ts"';
const modStart = mainJs.indexOf(MOD_HEAD);
const modEnd = modStart >= 0 ? mainJs.indexOf('System.register(', modStart + MOD_HEAD.length) : -1;
const mouseMod = modStart >= 0 ? mainJs.slice(modStart, modEnd > 0 ? modEnd : modStart + 8000) : '';
if (mouseMod.length < 500) {
  throw new Error('无法定位 Mouse.ts 模块切片，拒绝写入');
}
if (/EventType\.TOUCH_/.test(mouseMod)) {
  throw new Error('Mouse.ts 模块内仍残留 TOUCH_* 绑定，拒绝写入');
}
mouseFixNote.push('Mouse.ts 模块内 TOUCH_* 计数=0（复验通过）');
// onMouseMove 只应出现一次；锚点计数不符就报错，避免误改别处
const mmCount = mainJs.split(MOUSE_MOVE_HEAD).length - 1;
if (mmCount !== 1) {
  throw new Error(`Mouse.onMouseMove 锚点命中 ${mmCount} 次，期望 1 次`);
}
if (!mainJs.includes(MOUSE_MOVE_HEAD + MOUSE_MOVE_GUARD)) {
  mainJs = mainJs.replace(MOUSE_MOVE_HEAD, MOUSE_MOVE_HEAD + MOUSE_MOVE_GUARD);
  mouseFixNote.push('已给 onMouseMove 加触摸兜底');
} else {
  mouseFixNote.push('触摸兜底已存在');
}
console.log('✓ assets/main/index.js: ' + mouseFixNote.join('；'));

// 5. assets/main/index.js: Mouse.ts 触屏划线防瞬移误吸补丁（按下重置 + 抬起归零 + 瞬移位移阈值阻断）
//
// 现象：触屏上一个触点抬起，随后在另一处点按时，两点连线中间跨过的阳光/金币会被误吸。
// 真因：Mouse.lateUpdate 每帧用 oldMousePos 与当前坐标连成 moveLine 供掉落物检测相交；
//       触点消失后 oldMousePos 仍停留在旧坐标，新触点落下时生成了一条横跨大半个屏幕的瞬移假线段。
// 修复：
//   1. onMouseDown: 新点落下瞬间将 oldMousePos 拉齐到当前落点，moveLine 归零；
//   2. onMouseUp: 触点消失瞬间 moveLine 归零，不留残留射线；
//   3. lateUpdate: 单帧位移 > 180px 判定为瞬移跳跃，moveLine 归零；保留自然滑动刮阳光。
const OLD_LATE_UPDATE =
  'r.lateUpdate=function(e){var o=this.oldMousePos.clone(),t=new c(n._position.x,n._position.y,0),i=new a(t.x-o.x,t.y-o.y);n.moveLine=v.createLineLenDir(new a(o.x,o.y),i.length(),i),this.oldMousePos=t.toVec2()}';
const NEW_LATE_UPDATE =
  'r.lateUpdate=function(e){var o=this.oldMousePos.clone(),t=new c(n._position.x,n._position.y,0),i=new a(t.x-o.x,t.y-o.y);n.moveLine=i.length()>180?v.createLineLenDir(t.toVec2(),0):v.createLineLenDir(new a(o.x,o.y),i.length(),i),this.oldMousePos=t.toVec2()}';

const OLD_MOUSE_DOWN =
  'r.onMouseDown=function(e){e.getButton()==p.BUTTON_LEFT||(e.getButton(),p.BUTTON_RIGHT)}';
const NEW_MOUSE_DOWN =
  'r.onMouseDown=function(e){e.getUILocationX&&(n._position.x=e.getUILocationX(),n._position.y=e.getUILocationY()),this.oldMousePos=new a(n._position.x,n._position.y),n.moveLine=v.createLineLenDir(this.oldMousePos,0),e.getButton()==p.BUTTON_LEFT||(e.getButton(),p.BUTTON_RIGHT)}';

const OLD_MOUSE_UP =
  'r.onMouseUp=function(e){n.followingCart=null,e.getButton()==p.BUTTON_LEFT||(e.getButton(),p.BUTTON_RIGHT)}';
const NEW_MOUSE_UP =
  'r.onMouseUp=function(e){n.moveLine=v.createLineLenDir(new a(n._position.x,n._position.y),0),n.followingCart=null,e.getButton()==p.BUTTON_LEFT||(e.getButton(),p.BUTTON_RIGHT)}';

if (mainJs.includes(OLD_LATE_UPDATE)) {
  mainJs = mainJs
    .replace(OLD_LATE_UPDATE, NEW_LATE_UPDATE)
    .replace(OLD_MOUSE_DOWN, NEW_MOUSE_DOWN)
    .replace(OLD_MOUSE_UP, NEW_MOUSE_UP);
  console.log('✓ assets/main/index.js: Mouse.ts 触屏划线防瞬移误吸补丁（按下重置+抬起归零+瞬移阈值截断）已注入');
} else if (mainJs.includes('i.length()>180')) {
  console.log('- assets/main/index.js: Mouse.ts 触屏划线防瞬移误吸补丁已存在（幂等）');
} else {
  console.warn('WARN: 未匹配到 Mouse.lateUpdate 原型，可能已被修改，跳过本步骤');
}

// 语法校验
try {
  new vm.Script(mainJs, { filename: 'main.index.js' });
} catch (e) {
  throw new Error('main.index.js 语法校验失败: ' + e.message);
}
fs.writeFileSync(mainJsPath, mainJs, 'utf8');

console.log('注：index.html 保持官方原版（不注入任何触摸桥）—— 这是硬性约束。');
console.log('=== All modifications successfully applied and validated ===');

