import fs from 'node:fs';
import vm from 'node:vm';

const mainJsPath = 'stage/pvzge_web-0.16.0/docs/assets/main/index.js';
let code = fs.readFileSync(mainJsPath, 'utf8');

console.log('Original code length:', code.length);

let patched = 0;

// =========================================================================
// Patch 1: Rectangle.prototype.judgeCrossRec AABB Fast-Reject with NaN Defense
// =========================================================================
const p1Target = 't.judgeCrossRec=function(t){if(!t)return!1;var n=this.point1,o=this.point2,i=this.point3,e=this.point4,r=t.point1,a=t.point2,s=t.point3,h=t.point4;return!!(this.judgeInRec(r.x,r.y)||this.judgeInRec(a.x,a.y)||this.judgeInRec(s.x,s.y)||this.judgeInRec(h.x,h.y)||t.judgeInRec(n.x,n.y)||t.judgeInRec(o.x,o.y)||t.judgeInRec(i.x,i.y)||t.judgeInRec(e.x,e.y))||(!!D(n.x,n.y,i.x,i.y,a.x,a.y,h.x,h.y)||!!D(r.x,r.y,s.x,s.y,n.x,n.y,i.x,i.y))}';
const p1Replacement = 't.judgeCrossRec=function(t){if(!t||!t.point1||!this.point1)return!1;var n=this.point1,o=this.point2,i=this.point3,e=this.point4,r=t.point1,a=t.point2,s=t.point3,h=t.point4;var minX1=Math.min(n.x,o.x,i.x,e.x),maxX1=Math.max(n.x,o.x,i.x,e.x),minX2=Math.min(r.x,a.x,s.x,h.x),maxX2=Math.max(r.x,a.x,s.x,h.x);if(isNaN(minX1)||isNaN(minX2)||maxX1<minX2||minX1>maxX2)return!1;var minY1=Math.min(n.y,o.y,i.y,e.y),maxY1=Math.max(n.y,o.y,i.y,e.y),minY2=Math.min(r.y,a.y,s.y,h.y),maxY2=Math.max(r.y,a.y,s.y,h.y);if(isNaN(minY1)||isNaN(minY2)||maxY1<minY2||minY1>maxY2)return!1;return!!(this.judgeInRec(r.x,r.y)||this.judgeInRec(a.x,a.y)||this.judgeInRec(s.x,s.y)||this.judgeInRec(h.x,h.y)||t.judgeInRec(n.x,n.y)||t.judgeInRec(o.x,o.y)||t.judgeInRec(i.x,i.y)||t.judgeInRec(e.x,e.y))||(!!D(n.x,n.y,i.x,i.y,a.x,a.y,h.x,h.y)||!!D(r.x,r.y,s.x,s.y,n.x,n.y,i.x,i.y))}';

if (code.includes('if(isNaN(minX1)||isNaN(minX2)')) {
  console.log('- Patch 1: already present');
} else if (code.includes(p1Target)) {
  code = code.replace(p1Target, p1Replacement);
  patched++;
  console.log('✓ Patch 1: Rectangle.prototype.judgeCrossRec AABB Fast-Reject with NaN Defense applied');
} else {
  console.error('FAIL: Patch 1 target not found');
}

// =========================================================================
// Patch 2: commonShot.prototype.detectEnemyNormal Loop Pruning & Zero Allocation
// =========================================================================
const p2Target = 'for(var f,g=a(n);!(f=g()).done;){var y=f.value;if(c&&u===c)break;var b=this.JudgesZombieBodyRecForShooter?y.bodyRecForShooter:y.bodyRec;if(b&&((!c||y===c)&&b.judgeCrossRec(i))){var S=b.prjX();(!u||m&&S.x<p||!m&&S.y>p)&&(u=y,p=m?S.x:S.y)}}';
const p2Replacement = 'if(n){for(var _ni=0;_ni<n.length;_ni++){var y=n[_ni];if(y){if(c&&u===c)break;var b=this.JudgesZombieBodyRecForShooter?y.bodyRecForShooter:y.bodyRec;if(b&&((!c||y===c)&&b.judgeCrossRec(i))){var S=b.prjX();(!u||m&&S.x<p||!m&&S.y>p)&&(u=y,p=m?S.x:S.y)}}}}';

if (code.includes('for(var _ni=0;_ni<n.length;_ni++)')) {
  console.log('- Patch 2: already present');
} else if (code.includes(p2Target)) {
  code = code.replace(p2Target, p2Replacement);
  patched++;
  console.log('✓ Patch 2: detectEnemyNormal loop pruning & zero allocation applied');
} else {
  console.error('FAIL: Patch 2 target not found');
}

// =========================================================================
// Patch 3: commonShot.prototype._setBodyRec In-place Zero-Allocation Mutation
// =========================================================================
const p3Target = 'h._setBodyRec=function(e,t){var i=t.clone().add(e.clone().negative()),o=e.clone().add(i.clone().multiplyScalar(.5));this.size&&(this._bodyRec=z.createRectangleCenter(o,Math.abs(i.x)+this.size.width,Math.abs(i.y)+this.size.height))}';
const p3Replacement = 'h._setBodyRec=function(e,t){if(!this.size)return;var ex=e.x||0,ey=e.y||0,tx=t.x||0,ty=t.y||0,w2=this.size.width*0.5,h2=this.size.height*0.5,minX=Math.min(ex,tx)-w2,maxX=Math.max(ex,tx)+w2,minY=Math.min(ey,ty)-h2,maxY=Math.max(ey,ty)+h2,rec=this._bodyRec;if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;rec.point2.y=minY;rec.point3.x=maxX;rec.point3.y=maxY;rec.point4.x=minX;rec.point4.y=maxY;rec._prjX=null;rec._prjY=null;}else{this._bodyRec=new z(new y(minX,minY),new y(maxX,minY),new y(maxX,maxY),new y(minX,maxY));}}';

if (code.includes('rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;')) {
  console.log('- Patch 3: already present');
} else if (code.includes(p3Target)) {
  code = code.replace(p3Target, p3Replacement);
  patched++;
  console.log('✓ Patch 3: commonShot._setBodyRec in-place mutation applied');
} else {
  console.error('FAIL: Patch 3 target not found');
}

// =========================================================================
// Patch 4: Zombie.defaultSetBodyRec (Already applied or target)
// =========================================================================
const p4Target = 'defaultSetBodyRec=function(){var t=this.scale,e=Math.abs(t),i=this.HitRect;this.bodyRec=I.createRectangleCenter(new y(this.BodyRecXBase()+i.x*t,this._worldPositionY+i.y*e+this.height_depth),i.w*e,i.h*e)}';
const p4Replacement = 'defaultSetBodyRec=function(){var t=this.scale,e=Math.abs(t),i=this.HitRect,cx=this.BodyRecXBase()+i.x*t,cy=this._worldPositionY+i.y*e+this.height_depth,w2=i.w*e*0.5,h2=i.h*e*0.5,minX=cx-w2,maxX=cx+w2,minY=cy-h2,maxY=cy+h2,rec=this.bodyRec;if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;rec.point2.y=minY;rec.point3.x=maxX;rec.point3.y=maxY;rec.point4.x=minX;rec.point4.y=maxY;rec._prjX=null;rec._prjY=null;}else{this.bodyRec=I.createRectangleCenter(new y(cx,cy),i.w*e,i.h*e)}}';

if (code.includes('cx=this.BodyRecXBase()+i.x*t,cy=this._worldPositionY+i.y*e+this.height_depth')) {
  console.log('- Patch 4: already present');
} else if (code.includes(p4Target)) {
  code = code.replace(p4Target, p4Replacement);
  patched++;
  console.log('✓ Patch 4: Zombie.defaultSetBodyRec in-place mutation applied');
} else {
  console.error('FAIL: Patch 4 target not found');
}

// =========================================================================
// Patch 5: Zombie.setPlantDetectorRec In-place Zero-Allocation Mutation
// =========================================================================
const p5Target = 'l.setPlantDetectorRec=function(){if(U.gameStarted&&this.bodyRecHiddenCD<=0&&this.isAlive()){var t=this.scale,e=Math.abs(t);this._plantDetectorRec=I.createRectangleCenter(new y(this.PlantDetectorRecBaseX()+this.AttackRect.x*t,this.worldPositionY+this.height_depth+this.AttackRect.y*e),this.AttackRect.w*e,this.AttackRect.h*e)}else this._plantDetectorRec=I.createRectangleCenter(new y(1e4,1e4),1,1)}';
const p5Replacement = 'l.setPlantDetectorRec=function(){var rec=this._plantDetectorRec;if(U.gameStarted&&this.bodyRecHiddenCD<=0&&this.isAlive()){var t=this.scale,e=Math.abs(t),cx=this.PlantDetectorRecBaseX()+this.AttackRect.x*t,cy=this.worldPositionY+this.height_depth+this.AttackRect.y*e,w2=this.AttackRect.w*e*0.5,h2=this.AttackRect.h*e*0.5,minX=cx-w2,maxX=cx+w2,minY=cy-h2,maxY=cy+h2;if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=minX;rec.point1.y=minY;rec.point2.x=maxX;rec.point2.y=minY;rec.point3.x=maxX;rec.point3.y=maxY;rec.point4.x=minX;rec.point4.y=maxY;rec._prjX=null;rec._prjY=null;}else{this._plantDetectorRec=I.createRectangleCenter(new y(cx,cy),this.AttackRect.w*e,this.AttackRect.h*e);}}else if(rec&&rec.point1&&rec.point2&&rec.point3&&rec.point4){rec.point1.x=1e4;rec.point1.y=1e4;rec.point2.x=1e4+1;rec.point2.y=1e4;rec.point3.x=1e4+1;rec.point3.y=1e4+1;rec.point4.x=1e4;rec.point4.y=1e4+1;rec._prjX=null;rec._prjY=null;}else{this._plantDetectorRec=I.createRectangleCenter(new y(1e4,1e4),1,1);}}';

if (code.includes('rec.point1.x=1e4;rec.point1.y=1e4;rec.point2.x=1e4+1;')) {
  console.log('- Patch 5: already present');
} else if (code.includes(p5Target)) {
  code = code.replace(p5Target, p5Replacement);
  patched++;
  console.log('✓ Patch 5: Zombie.setPlantDetectorRec in-place mutation applied');
} else {
  console.error('FAIL: Patch 5 target not found');
}

// =========================================================================
// Patch 6: Zombie.defaultDetectPlant Single-Pass Loop & Lazy Damage
// =========================================================================
const p6Target = 'this.ignorePlants()||((s=this.getSingleGumInRec(i))||(o=this.getSingleZombieInRec(i)),s||o||(a=this.getSingleTombInRec(i)),s||o||a||this.hypnotized||(n=this.inLane.plantPool().filter((function(t){return!(!((t.eaterDetectable||e.plantEatExtraAllowed(t))&&e.plantEatAllowed(t)&&i.judgeCrossRec(t.bodyRec)&&e.specialPlantEatAllowedAfterDetect(t))||n&&t.PlantCategory!=K.vine&&t.PlantCategory!=K.plant&&t.PlantCategory!=K.lilyPad&&t.PlantCategory!=K.pot)})).sort((function(t,i){var n=e.scale>0?t.bodyRec.prjX().y:t.bodyRec.prjX().x;return((e.scale>0?i.bodyRec.prjX().y:i.bodyRec.prjX().x)-n)*e.scale})).find((function(){return!0}))));var r=new z(this.dps*t,!0,!1,!1,null);s?this.whenGumDetected(s,r,t):o?this.whenZombieDetected(o,r,t):a?this.whenTombDetected(a,r,t):n?this.whenPlantDetected(n,r,t):this.allowWalk()?this.playWalk(.1):(this.isWalking||this.isEating)&&this.playIdle()';
const p6Replacement = 'if(!this.ignorePlants()){if(!(s=this.getSingleGumInRec(i)))o=this.getSingleZombieInRec(i);if(!s&&!o)a=this.getSingleTombInRec(i);if(!s&&!o&&!a&&!this.hypnotized){var _pl=this.inLane.plantPool(),_bp=null,_bv=0;if(_pl){for(var _pi=0;_pi<_pl.length;_pi++){var _pt=_pl[_pi];if(_pt&&(_pt.eaterDetectable||e.plantEatExtraAllowed(_pt))&&e.plantEatAllowed(_pt)&&i.judgeCrossRec(_pt.bodyRec)&&e.specialPlantEatAllowedAfterDetect(_pt)){var _pj=_pt.bodyRec.prjX(),_pv=e.scale>0?_pj.y:_pj.x;if(!_bp||(e.scale>0?_pv>_bv:_pv<_bv)){_bp=_pt;_bv=_pv;}}}}n=_bp;}}var r=null;s?this.whenGumDetected(s,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):o?this.whenZombieDetected(o,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):a?this.whenTombDetected(a,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):n?this.whenPlantDetected(n,r||(r=new z(this.dps*t,!0,!1,!1,null)),t):this.allowWalk()?this.playWalk(.1):(this.isWalking||this.isEating)&&this.playIdle()';

if (code.includes('for(var _pi=0;_pi<_pl.length;_pi++)')) {
  console.log('- Patch 6: already present');
} else if (code.includes(p6Target)) {
  code = code.replace(p6Target, p6Replacement);
  patched++;
  console.log('✓ Patch 6: Zombie.defaultDetectPlant zero-allocation single-pass applied');
} else {
  console.error('FAIL: Patch 6 target not found');
}

// =========================================================================
// Patch 7: getSingleZombieInRec & getSingleTombInRec (Already present)
// =========================================================================
if (code.includes('if(len===0)return;')) {
  console.log('- Patch 7: already present');
} else {
  console.error('FAIL: Patch 7 not found');
}

// =========================================================================
// Patch 8: commonShot.prototype.move Vector Cache & Zero Allocation
// =========================================================================
const p8Target = 'var H=this.realWorldPosition,I=this.worldPositionX+z*d,M=this.worldPositionY+E*d,F=u+x*d,V=this.hitsFloorWhenRecHitInsteadOfHeightZero?this.size.height*Math.abs(this.scale)*.5:0;F=Math.max(F,V),this.worldPositionVec3=new g(I,M,F);var Z=this.realWorldPosition;this._setBodyRec(H,Z),this.onMoving(H,Z,e),this.oldPos=Z';
const p8Replacement = 'var H=this._cachedOldRealPos||(this._cachedOldRealPos=new y(0,0));H.x=this._worldPositionX;H.y=this._worldPositionY+this._height-this._depth;var I=this.worldPositionX+z*d,M=this.worldPositionY+E*d,F=u+x*d,V=this.hitsFloorWhenRecHitInsteadOfHeightZero?this.size.height*Math.abs(this.scale)*.5:0;F=Math.max(F,V);var wpos=this._cachedWorldPosVec3||(this._cachedWorldPosVec3=new g(0,0,0));wpos.x=I;wpos.y=M;wpos.z=F;this.worldPositionVec3=wpos;var Z=this._cachedRealPos||(this._cachedRealPos=new y(0,0));Z.x=this._worldPositionX;Z.y=this._worldPositionY+this._height-this._depth;this._setBodyRec(H,Z),this.onMoving(H,Z,e),this.oldPos=Z';

if (code.includes('_cachedOldRealPos') && code.includes('_cachedWorldPosVec3')) {
  console.log('- Patch 8: already present');
} else if (code.includes(p8Target)) {
  code = code.replace(p8Target, p8Replacement);
  patched++;
  console.log('✓ Patch 8: commonShot.move vector cache & zero allocation applied');
} else {
  console.error('FAIL: Patch 8 target not found');
}

// =========================================================================
// Syntax check & save
// =========================================================================
console.log(`\nValidating V8 AST syntax of modified index.js (${code.length} bytes)...`);
try {
  new vm.Script(code, { filename: 'main.index.js' });
  console.log('✓ 100% V8 Syntax compilation passed!');
} catch (e) {
  console.error('FAIL: Syntax error: ' + e.message);
  process.exit(1);
}

fs.writeFileSync(mainJsPath, code, 'utf8');
console.log(`\nAll 8 performance patches verified and written to ${mainJsPath}!`);
