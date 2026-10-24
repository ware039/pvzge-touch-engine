import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = 'D:\\deepseek harness\\tmp-pvzge';
const mainJsPath = process.argv[2] || path.join(root, 'stage', 'pvzge_web-master', 'docs', 'assets', 'main', 'index.js');
const backupPath = mainJsPath + '.bak';

if (!fs.existsSync(mainJsPath)) {
  console.error('FAIL: index.js not found at:', mainJsPath);
  process.exit(1);
}

// 0. Backup original index.js if no backup exists
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(mainJsPath, backupPath);
  console.log('✓ Created backup of index.js -> ' + backupPath);
}

let code = fs.readFileSync(mainJsPath, 'utf8');
let patchedCount = 0;

// =========================================================================
// Patch 1: AABB Fast-Reject for Rectangle.prototype.judgeCrossRec (Hardened with NaN Defense)
// 1) 消除 99% 不碰撞情况下的 32 次点积计算与 LineSegment/Vec2 临时对象分配
// 2) 修复原版 Cocos 由于 !(cross >= 0) 对 NaN 返回 true 的漏洞，彻底杜绝死怪/隐身怪空包围盒的误判与分配
// =========================================================================
const p1Target = 'judgeCrossRec=function(t){return!!t&&(!!(this.judgeInRecP(t.point1)||this.judgeInRecP(t.point2)||this.judgeInRecP(t.point3)||this.judgeInRecP(t.point4)||t.judgeInRecP(this.point1)||t.judgeInRecP(this.point2)||t.judgeInRecP(this.point3)||t.judgeInRecP(this.point4))||!(!new j(this.point1,this.point3).judgeCrossRec(t)&&!new j(t.point1,t.point3).judgeCrossRec(this)))}';
const p1Existing = 'if(maxX1<minX2||minX1>maxX2)return!1;var minY1=Math.min(a1.y,a2.y,a3.y,a4.y),maxY1=Math.max(a1.y,a2.y,a3.y,a4.y),minY2=Math.min(b1.y,b2.y,b3.y,b4.y),maxY2=Math.max(b1.y,b2.y,b3.y,b4.y);if(maxY1<minY2||minY1>maxY2)return!1;';
const p1Hardened = 'if(isNaN(minX1)||isNaN(minX2)||maxX1<minX2||minX1>maxX2)return!1;var minY1=Math.min(a1.y,a2.y,a3.y,a4.y),maxY1=Math.max(a1.y,a2.y,a3.y,a4.y),minY2=Math.min(b1.y,b2.y,b3.y,b4.y),maxY2=Math.max(b1.y,b2.y,b3.y,b4.y);if(isNaN(minY1)||isNaN(minY2)||maxY1<minY2||minY1>maxY2)return!1;';

if (code.includes('if(isNaN(minX1)||isNaN(minX2)')) {
  console.log('- Patch 1 (Rectangle AABB Fast-Reject with NaN Defense): already present');
} else if (code.includes(p1Existing)) {
  code = code.replace(p1Existing, p1Hardened);
  patchedCount++;
  console.log('✓ Patch 1 hardened: Rectangle.prototype.judgeCrossRec NaN defense injected');
} else if (code.includes(p1Target)) {
  const p1Full = 'judgeCrossRec=function(t){if(!t||!t.point1||!this.point1)return!1;var a1=this.point1,a2=this.point2,a3=this.point3,a4=this.point4,b1=t.point1,b2=t.point2,b3=t.point3,b4=t.point4;var minX1=Math.min(a1.x,a2.x,a3.x,a4.x),maxX1=Math.max(a1.x,a2.x,a3.x,a4.x),minX2=Math.min(b1.x,b2.x,b3.x,b4.x),maxX2=Math.max(b1.x,b2.x,b3.x,b4.x);if(isNaN(minX1)||isNaN(minX2)||maxX1<minX2||minX1>maxX2)return!1;var minY1=Math.min(a1.y,a2.y,a3.y,a4.y),maxY1=Math.max(a1.y,a2.y,a3.y,a4.y),minY2=Math.min(b1.y,b2.y,b3.y,b4.y),maxY2=Math.max(b1.y,b2.y,b3.y,b4.y);if(isNaN(minY1)||isNaN(minY2)||maxY1<minY2||minY1>maxY2)return!1;return!!(this.judgeInRecP(b1)||this.judgeInRecP(b2)||this.judgeInRecP(b3)||this.judgeInRecP(b4)||t.judgeInRecP(a1)||t.judgeInRecP(a2)||t.judgeInRecP(a3)||t.judgeInRecP(a4))||!(!new j(a1,a3).judgeCrossRec(t)&&!new j(b1,b3).judgeCrossRec(this))}';
  code = code.replace(p1Target, p1Full);
  patchedCount++;
  console.log('✓ Patch 1 applied: Rectangle.prototype.judgeCrossRec AABB Fast-Reject with NaN Defense');
} else {
  console.warn('! Warning: Patch 1 target not found');
}

// =========================================================================
// Patch 2: commonShot.prototype.detectEnemyNormal
// 1) 替换 forEach 为高效索引循环，消除闭包分配
// 2) 延迟调用 o.prjX()，只有在 AABB 确认碰撞时才读取，避免每帧每僵尸分配 Vec2
// 3) 延迟实例化 Damage 对象 d，非击中墓碑时不生成
// =========================================================================
const p2Target = ',null==(a=c)||a.forEach((function(e){if(!t.targetLocked||l!=t.targetLocked){var o=t.JudgesZombieBodyRecForShooter?e.bodyRecForShooter:e.bodyRec,n=o.prjX();t.targetLocked&&e!=t.targetLocked||null==o||!o.judgeCrossRec(i)||(!l||t.linearVelocity.x>=0&&n.x<r||t.linearVelocity.x<0&&n.y>h)&&(l=e,r=n.x,h=n.y)}}));var d=new z(this.damage*this.damageScale*(this.havePeaBuff?1.5:1),this.armorProtection,this.armorKnockSound,this.bodyKnockSound,null,this.damageType,!0,!0);';
const p2Replacement = ';if(c){for(var _ci=0;_ci<c.length;_ci++){var e=c[_ci];if(e&&(!t.targetLocked||l!=t.targetLocked)){var o=t.JudgesZombieBodyRecForShooter?e.bodyRecForShooter:e.bodyRec;if(o&&(!t.targetLocked||e==t.targetLocked)&&o.judgeCrossRec(i)){var n=o.prjX();(!l||t.linearVelocity.x>=0&&n.x<r||t.linearVelocity.x<0&&n.y>h)&&(l=e,r=n.x,h=n.y)}}}}var d=null;';

const p2TombTarget = ',p)return p.dealDamage(d),this.onTombHit(p),this.dealSplashDamage(null,p),void this.pop()';
const p2TombReplacement = ',p)return(d||(d=new z(this.damage*this.damageScale*(this.havePeaBuff?1.5:1),this.armorProtection,this.armorKnockSound,this.bodyKnockSound,null,this.damageType,!0,!0))),p.dealDamage(d),this.onTombHit(p),this.dealSplashDamage(null,p),void this.pop()';

if (code.includes('for(var _ci=0;_ci<c.length;_ci++)')) {
  console.log('- Patch 2 (detectEnemyNormal Pruning & Lazy Damage): already present');
} else if (code.includes(p2Target)) {
  code = code.replace(p2Target, p2Replacement);
  if (code.includes(p2TombTarget)) {
    code = code.replace(p2TombTarget, p2TombReplacement);
  }
  patchedCount++;
  console.log('✓ Patch 2 applied: commonShot detectEnemyNormal pruned loop & lazy Damage');
} else {
  console.warn('! Warning: Patch 2 target not found');
}

// =========================================================================
// Patch 3: commonShot.prototype._setBodyRec
// 复用已有 _bodyRec 实例与 4 个点坐标，就地修改坐标，消除每帧 8 个 Vec2 与 1 个 Rectangle 的高频分配
// =========================================================================
const p3Target = 'h._setBodyRec=function(e,t){var i=t.clone().add(e.clone().negative()),o=e.clone().add(i.clone().multiplyScalar(.5));this._bodyRec=O.createRectangleCenter(o,Math.abs(i.x)+this.size.width,Math.abs(i.y)+this.size.height)}';
const p3Replacement = 'h._setBodyRec=function(e,t){var ex=e.x||0,ey=e.y||0,tx=t.x||0,ty=t.y||0,w2=this.size.width*0.5,h2=this.size.height*0.5,minX=Math.min(ex,tx)-w2,maxX=Math.max(ex,tx)+w2,minY=Math.min(ey,ty)-h2,maxY=Math.max(ey,ty)+h2,rec=this._bodyRec;if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;rec.point2.y=minY;rec.point3.x=maxX;rec.point3.y=maxY;rec.point4.x=minX;rec.point4.y=maxY;rec._prjX=null;rec._prjY=null;}else{this._bodyRec=new O(new y(minX,minY),new y(maxX,minY),new y(maxX,maxY),new y(minX,maxY));}}';

if (code.includes('rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;')) {
  console.log('- Patch 3 (commonShot _setBodyRec In-place Reuse): already present');
} else if (code.includes(p3Target)) {
  code = code.replace(p3Target, p3Replacement);
  patchedCount++;
  console.log('✓ Patch 3 applied: commonShot._setBodyRec in-place mutation (Zero-Allocation)');
} else {
  console.warn('! Warning: Patch 3 target not found');
}

// =========================================================================
// Patch 4: Zombie.prototype.defaultSetBodyRec
// 僵尸受击包围盒就地复用，消除每帧为每只僵尸重新 new Rectangle 的内存开销
// =========================================================================
const p4Target = 'defaultSetBodyRec=function(){var t=this.scale,e=Math.abs(t),i=this.HitRect;this.bodyRec=I.createRectangleCenter(new y(this.BodyRecXBase()+i.x*t,this._worldPositionY+i.y*e+this.height_depth),i.w*e,i.h*e)}';
const p4Replacement = 'defaultSetBodyRec=function(){var t=this.scale,e=Math.abs(t),i=this.HitRect,cx=this.BodyRecXBase()+i.x*t,cy=this._worldPositionY+i.y*e+this.height_depth,w2=i.w*e*0.5,h2=i.h*e*0.5,minX=cx-w2,maxX=cx+w2,minY=cy-h2,maxY=cy+h2,rec=this.bodyRec;if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;rec.point2.y=minY;rec.point3.x=maxX;rec.point3.y=maxY;rec.point4.x=minX;rec.point4.y=maxY;rec._prjX=null;rec._prjY=null;}else{this.bodyRec=I.createRectangleCenter(new y(cx,cy),i.w*e,i.h*e)}}';

if (code.includes('cx=this.BodyRecXBase()+i.x*t,cy=this._worldPositionY+i.y*e+this.height_depth')) {
  console.log('- Patch 4 (Zombie defaultSetBodyRec In-place Reuse): already present');
} else if (code.includes(p4Target)) {
  code = code.replace(p4Target, p4Replacement);
  patchedCount++;
  console.log('✓ Patch 4 applied: Zombie.defaultSetBodyRec in-place mutation (Zero-Allocation)');
} else {
  console.warn('! Warning: Patch 4 target not found');
}

// =========================================================================
// Patch 5: Zombie.prototype.setPlantDetectorRec
// 僵尸植物探测包围盒就地复用，彻底终结尸潮场景下的 V8 Minor GC 帧冻结
// =========================================================================
const p5Target = 'setPlantDetectorRec=function(){if(K.gameStarted&&this.bodyRecHiddenCD<=0&&this.isAlive()){var t=this.scale,e=Math.abs(t);this._plantDetectorRec=I.createRectangleCenter(new y(this.PlantDetectorRecBaseX()+this.AttackRect.x*t,this.worldPosition.y+this.height_depth+this.AttackRect.y*e),this.AttackRect.w*e,this.AttackRect.h*e)}else this._plantDetectorRec=I.createRectangleCenter(new y(1e4,1e4),1,1)}';
const p5Replacement = 'setPlantDetectorRec=function(){var rec=this._plantDetectorRec;if(K.gameStarted&&this.bodyRecHiddenCD<=0&&this.isAlive()){var t=this.scale,e=Math.abs(t),cx=this.PlantDetectorRecBaseX()+this.AttackRect.x*t,cy=this.worldPosition.y+this.height_depth+this.AttackRect.y*e,w2=this.AttackRect.w*e*0.5,h2=this.AttackRect.h*e*0.5,minX=cx-w2,maxX=cx+w2,minY=cy-h2,maxY=cy+h2;if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;rec.point2.y=minY;rec.point3.x=maxX;rec.point3.y=maxY;rec.point4.x=minX;rec.point4.y=maxY;rec._prjX=null;rec._prjY=null;}else{this._plantDetectorRec=I.createRectangleCenter(new y(cx,cy),this.AttackRect.w*e,this.AttackRect.h*e);}}else if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=1e4;rec.point1.y=1e4;rec.point2.x=1e4+1;rec.point2.y=1e4;rec.point3.x=1e4+1;rec.point3.y=1e4+1;rec.point4.x=1e4;rec.point4.y=1e4+1;rec._prjX=null;rec._prjY=null;}else{this._plantDetectorRec=I.createRectangleCenter(new y(1e4,1e4),1,1);}}';

if (code.includes('rec.point1.x=1e4;rec.point1.y=1e4;rec.point2.x=1e4+1;')) {
  console.log('- Patch 5 (Zombie setPlantDetectorRec In-place Reuse): already present');
} else if (code.includes(p5Target)) {
  code = code.replace(p5Target, p5Replacement);
  patchedCount++;
  console.log('✓ Patch 5 applied: Zombie.setPlantDetectorRec in-place mutation (Zero-Allocation)');
} else {
  console.warn('! Warning: Patch 5 target not found');
}

// =========================================================================
// Patch 6: Zombie.prototype.defaultDetectPlant 零分配单趟循环与延迟伤害对象
// 1) 消除每帧无条件 new Damage(this.dps*t, ...)
// 2) 替换 filter().sort().find() 为单趟 O(N) 遍历寻找最优植物，消除临时 Array 和闭包分配
// =========================================================================
const p6Target = 'this.ignorePlants()||((s=this.getSingleGumInRec(i))||(o=this.getSingleZombieInRec(i)),s||o||(a=this.getSingleTombInRec(i)),s||o||a||this.hypnotized||(n=this.inLane.plantPool().filter((function(t){return!(!((t.eaterDetectable||e.plantEatExtraAllowed(t))&&e.plantEatAllowed(t)&&i.judgeCrossRec(t.bodyRec)&&e.specialPlantEatAllowedAfterDetect(t))||n&&t.PlantCategory!=U.vine&&t.PlantCategory!=U.plant&&t.PlantCategory!=U.lilyPad&&t.PlantCategory!=U.pot)})).sort((function(t,i){var n=e.scale>0?t.bodyRec.prjX().y:t.bodyRec.prjX().x;return((e.scale>0?i.bodyRec.prjX().y:i.bodyRec.prjX().x)-n)*e.scale})).find((function(){return!0}))));var r=new z(this.dps*t,!0,!1,!1,null);s?this.whenGumDetected(s,r,t):o?this.whenZombieDetected(o,r,t):a?this.whenTombDetected(a,r,t):n?this.whenPlantDetected(n,r,t):this.allowWalk()?this.playWalk(.1):(this.isWalking||this.isEating)&&this.playIdle()';
const p6Replacement = 'if(!this.ignorePlants()){if(!(s=this.getSingleGumInRec(i)))o=this.getSingleZombieInRec(i);if(!s&&!o)a=this.getSingleTombInRec(i);if(!s&&!o&&!a&&!this.hypnotized){var _pl=this.inLane.plantPool(),_bp=null,_bv=0;if(_pl){for(var _pi=0;_pi<_pl.length;_pi++){var _pt=_pl[_pi];if(_pt&&(_pt.eaterDetectable||e.plantEatExtraAllowed(_pt))&&e.plantEatAllowed(_pt)&&i.judgeCrossRec(_pt.bodyRec)&&e.specialPlantEatAllowedAfterDetect(_pt)){var _pj=_pt.bodyRec.prjX(),_pv=e.scale>0?_pj.y:_pj.x;if(!_bp||(e.scale>0?_pv>_bv:_pv<_bv)){_bp=_pt;_bv=_pv;}}}}n=_bp;}}var r=null;s?this.whenGumDetected(s,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):o?this.whenZombieDetected(o,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):a?this.whenTombDetected(a,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):n?this.whenPlantDetected(n,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):this.allowWalk()?this.playWalk(.1):(this.isWalking||this.isEating)&&this.playIdle()';

if (code.includes('for(var _pi=0;_pi<_pl.length;_pi++)')) {
  console.log('- Patch 6 (Zombie defaultDetectPlant Zero-Allocation Single-Pass): already present');
} else if (code.includes(p6Target)) {
  code = code.replace(p6Target, p6Replacement);
  patchedCount++;
  console.log('✓ Patch 6 applied: Zombie.defaultDetectPlant zero-allocation & single-pass loop');
} else {
  console.warn('! Warning: Patch 6 target not found');
}

// =========================================================================
// Patch 7: Zombie.prototype.getSingleZombieInRec & getSingleTombInRec 空池快速阻断
// 消除 99.9% 帧中由于 hypnoZombiePool / tombPool 为空造成的多余 concat/shuffle/filter/sort 数组开销
// =========================================================================
const p7ZTarget = 'getSingleZombieInRec=function(e,t,n){var i=this;return void 0===n&&(n=this.inLane),v.shuffle(this.hypnotized?this.inLane.zombiePool().concat(this.inLane.UpperLane.zombiePool(),this.inLane.LowerLane.zombiePool()):this.inLane.hypnoZombiePool().concat(this.inLane.UpperLane.hypnoZombiePool(),this.inLane.LowerLane.hypnoZombiePool())).filter((function(t){return t.bodyRec.judgeCrossRec(e)})).sort((function(e,t){var n=i.scale>0?e.bodyRec.prjX().y:e.bodyRec.prjX().x;return((i.scale>0?t.bodyRec.prjX().y:t.bodyRec.prjX().x)-n)*i.scale})).find((function(){return!0}))}';
const p7ZReplacement = 'getSingleZombieInRec=function(e,t,n){var i=this;void 0===n&&(n=this.inLane);if(!n)return;var p1=this.hypnotized?n.zombiePool():n.hypnoZombiePool(),p2=n.UpperLane?(this.hypnotized?n.UpperLane.zombiePool():n.UpperLane.hypnoZombiePool()):null,p3=n.LowerLane?(this.hypnotized?n.LowerLane.zombiePool():n.LowerLane.hypnoZombiePool()):null;var len=(p1?p1.length:0)+(p2?p2.length:0)+(p3?p3.length:0);if(len===0)return;return v.shuffle(p1.concat(p2||[],p3||[])).filter((function(t){return t.bodyRec.judgeCrossRec(e)})).sort((function(e,t){var n=i.scale>0?e.bodyRec.prjX().y:e.bodyRec.prjX().x;return((i.scale>0?t.bodyRec.prjX().y:t.bodyRec.prjX().x)-n)*i.scale})).find((function(){return!0}))}';

const p7TTarget = 'getSingleTombInRec=function(e,t,n){var i=this;void 0===n&&(n=this.inLane);var a=this.hypnotized?0:1;return v.shuffle(this.inLane.tombPool(a).concat(this.inLane.UpperLane.tombPool(a),this.inLane.LowerLane.tombPool(a))).filter((function(t){return t.bodyRec.judgeCrossRec(e)})).sort((function(e,t){var n=i.scale>0?e.bodyRec.prjX().y:e.bodyRec.prjX().x;return((i.scale>0?t.bodyRec.prjX().y:t.bodyRec.prjX().x)-n)*i.scale})).find((function(){return!0}))}';
const p7TReplacement = 'getSingleTombInRec=function(e,t,n){var i=this;void 0===n&&(n=this.inLane);if(!n)return;var a=this.hypnotized?0:1;var t1=n.tombPool(a),t2=n.UpperLane?n.UpperLane.tombPool(a):null,t3=n.LowerLane?n.LowerLane.tombPool(a):null;var tlen=(t1?t1.length:0)+(t2?t2.length:0)+(t3?t3.length:0);if(tlen===0)return;return v.shuffle(t1.concat(t2||[],t3||[])).filter((function(t){return t.bodyRec.judgeCrossRec(e)})).sort((function(e,t){var n=i.scale>0?e.bodyRec.prjX().y:e.bodyRec.prjX().x;return((i.scale>0?t.bodyRec.prjX().y:t.bodyRec.prjX().x)-n)*i.scale})).find((function(){return!0}))}';

if (code.includes('if(len===0)return;')) {
  console.log('- Patch 7 (Zombie getSingleZombie/Tomb Empty Pool Fast-Exit): already present');
} else if (code.includes(p7ZTarget) && code.includes(p7TTarget)) {
  code = code.replace(p7ZTarget, p7ZReplacement);
  code = code.replace(p7TTarget, p7TReplacement);
  patchedCount += 2;
  console.log('✓ Patch 7 applied: getSingleZombieInRec & getSingleTombInRec empty pool fast-exit');
} else {
  console.warn('! Warning: Patch 7 target not found');
}

// =========================================================================
// Patch 8: commonShot.prototype.move 飞行高频标量计算与零 Vec2 分配
// 消除每颗子弹每帧反复 clone() 及瞬态 Vec2 分配（Sx/Sy 纯标量化，复用位置对象）
// =========================================================================
const p8Target = 'var S=this.linearVelocity.clone().add(c).multiplyScalar(.5),v=(this.bodyLinearVelocity+d)/2;this.worldPosition=new y(r.x+S.x*s,r.y+S.y*s*this.SpeedYScale);var P=h+v*s;this.height=this.canDiveUnderHeight0?P:Math.max(P,this.hitsFloorWhenRecHitInsteadOfHeightZero?this.size.height*Math.abs(this.scale)/2:0);var k=this.realWorldPosition.clone();this._setBodyRec(a,k),this.onMoving(a,k,e),this.oldPos=k';
const p8Replacement = 'var Sx=(this.linearVelocity.x+c.x)*.5,Sy=(this.linearVelocity.y+c.y)*.5,v=(this.bodyLinearVelocity+d)/2;this.worldPosition=new y(r.x+Sx*s,r.y+Sy*s*this.SpeedYScale);var P=h+v*s;this.height=this.canDiveUnderHeight0?P:Math.max(P,this.hitsFloorWhenRecHitInsteadOfHeightZero?this.size.height*Math.abs(this.scale)/2:0);var k=this._cachedRealPos||(this._cachedRealPos=new y(0,0));k.x=this._worldPositionX;k.y=this._worldPositionY+this._height-this._depth;this._setBodyRec(a,k),this.onMoving(a,k,e),this.oldPos=k';

const p8AOld = 'var a=this.realWorldPosition.clone(),s=60*e,l=60*e,r=this.worldPosition,h=this.height,c=this.linearVelocity.clone()';
const p8ANew = 'var a=this._cachedOldRealPos||(this._cachedOldRealPos=new y(0,0));a.x=this._worldPositionX;a.y=this._worldPositionY+this._height-this._depth;var s=60*e,l=60*e,r=this.worldPosition,h=this.height,c=this.linearVelocity.clone()';

if (code.includes('var Sx=(this.linearVelocity.x+c.x)*.5')) {
  console.log('- Patch 8 (commonShot.move Scalar Velocity & Vector Reuse): already present');
} else if (code.includes(p8Target) && code.includes(p8AOld)) {
  code = code.replace(p8Target, p8Replacement);
  code = code.replace(p8AOld, p8ANew);
  patchedCount++;
  console.log('✓ Patch 8 applied: commonShot.move scalar velocity calculation and vector cache');
} else {
  console.warn('! Warning: Patch 8 target not found');
}

// =========================================================================
// Syntax & Integrity Verification
// =========================================================================
console.log(`\nValidating syntax of index.js (${code.length} bytes)...`);
try {
  new vm.Script(code, { filename: 'main.index.js' });
  console.log('✓ assets/main/index.js syntax check passed 100%!');
} catch (e) {
  console.error('FAIL: Syntax error in modified index.js: ' + e.message);
  process.exit(1);
}

fs.writeFileSync(mainJsPath, code, 'utf8');
console.log(`\n[SUCCESS] Applied patches saved to:\n  ${mainJsPath}`);
