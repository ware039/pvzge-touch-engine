import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const targetDocs = path.join('D:\\deepseek harness\\tmp-pvzge\\stage\\pvzge_web-0.16.0\\docs');

// 1. Update application.js
const appJsPath = path.join(targetDocs, 'application.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

const appInitTarget = 'cc = engine;\n            window.cc = engine;';
const appInitAlt = 'cc = engine;\r\n            window.cc = engine;';

const appInitNew = `cc = engine;
            window.cc = engine;
            try {
              if (cc.game && typeof cc.game.setFrameRate === 'function') {
                cc.game.setFrameRate(120);
              }
            } catch(e) {}
            try {
              var origGetContext = HTMLCanvasElement.prototype.getContext;
              HTMLCanvasElement.prototype.getContext = function(type, attributes) {
                if (type === 'webgl2' || type === 'webgl') {
                  attributes = attributes || {};
                  attributes.desynchronized = true;
                  attributes.powerPreference = 'high-performance';
                }
                return origGetContext.call(this, type, attributes);
              };
            } catch(e) {}
            try {
              var cap = 0.75;
              if (typeof localStorage !== 'undefined' && localStorage.getItem('PvZ2_DPRCap')) {
                cap = parseFloat(localStorage.getItem('PvZ2_DPRCap')) || 0.75;
              }
              var origDPR = window.devicePixelRatio || 1;
              Object.defineProperty(window, 'devicePixelRatio', {
                get: function() { return Math.min(origDPR, cap); },
                configurable: true
              });
            } catch(e) {}
            try {
              var style = document.createElement('style');
              style.textContent = '#GameCanvas, #GameDiv, #Cocos3dGameContainer { touch-action: none !important; -webkit-touch-callout: none !important; user-select: none !important; }';
              (document.head || document.documentElement).appendChild(style);
            } catch(e) {}
            window.__pvzFastDispatch = function(x, y, type, button) {
              var el = document.getElementById("GameCanvas");
              if (!el) return;
              var d = window.devicePixelRatio || 1;
              var ev = new MouseEvent(type, {
                view: window,
                bubbles: true,
                cancelable: true,
                screenX: x,
                screenY: y,
                clientX: x / d,
                clientY: y / d,
                button: button
              });
              el.dispatchEvent(ev);
            };`;

if (!appJs.includes('window.__pvzFastDispatch')) {
  if (appJs.includes(appInitTarget)) {
    appJs = appJs.replace(appInitTarget, appInitNew);
  } else if (appJs.includes(appInitAlt)) {
    appJs = appJs.replace(appInitAlt, appInitNew);
  } else {
    appJs = appJs.replace('window.cc = engine;', appInitNew);
  }
  console.log('✓ Injected fast dispatch, 120Hz, WebGL desynchronized, and DPR cap into application.js');
}

// In start method: overrideSettings: { engine: { macros: { CLEANUP_IMAGE_CACHE: true } }, profiling: ... }
const overrideOld = `overrideSettings: {
                // assets: {
                //      preloadBundles: [{ bundle: 'main', version: 'xxx' }],
                // }
                profiling: {
                  showFPS: this.showFPS
                }
              }`;
const overrideOldCRLF = overrideOld.replace(/\n/g, '\r\n');

const overrideNew = `overrideSettings: {
                engine: {
                  macros: {
                    CLEANUP_IMAGE_CACHE: true
                  }
                },
                profiling: {
                  showFPS: this.showFPS
                }
              }`;

if (appJs.includes(overrideOld)) {
  appJs = appJs.replace(overrideOld, overrideNew);
  console.log('✓ Injected CLEANUP_IMAGE_CACHE into application.js');
} else if (appJs.includes(overrideOldCRLF)) {
  appJs = appJs.replace(overrideOldCRLF, overrideNew.replace(/\n/g, '\r\n'));
  console.log('✓ Injected CLEANUP_IMAGE_CACHE into application.js (CRLF)');
} else {
  console.log('- overrideSettings in application.js check:', appJs.includes('CLEANUP_IMAGE_CACHE'));
}

fs.writeFileSync(appJsPath, appJs, 'utf8');

// 2. Update assets/main/index.js
const mainJsPath = path.join(targetDocs, 'assets', 'main', 'index.js');
let mainJs = fs.readFileSync(mainJsPath, 'utf8');

// NodePools wipe prevention
const poolTarget = 'if(n)n.put(o),n.size()>100&&n.clear();';
const poolReplacement = 'if(n){if(n.size()<200)n.put(o);else if(o&&typeof o.destroy==="function")o.destroy();}';
if (mainJs.includes(poolTarget)) {
  mainJs = mainJs.replace(poolTarget, poolReplacement);
  console.log('✓ NodePools expansion to 200 without clearing injected');
} else if (mainJs.includes('n.size()<200')) {
  console.log('- NodePools expansion already present');
}

// Mega Gatling Pea auto-plantfood delay
const mgpOld = 'Math.random()<this._objdataOwn.MGPAutoShotsChanceToPlantfood?this.food():(this.shooting=!0,';
const mgpNew = 'Math.random()<this._objdataOwn.MGPAutoShotsChanceToPlantfood?(function(p){p.__mgpPF||(p.__mgpPF=setTimeout((function(){p.__mgpPF=0,p&&!p.dead&&!p.fooding&&p.food()}),50))})(this):(this.shooting=!0,';
if (mainJs.includes(mgpOld)) {
  mainJs = mainJs.replace(mgpOld, mgpNew);
  console.log('✓ MGP auto-plantfood race-condition delay injected');
} else if (mainJs.includes('__mgpPF')) {
  console.log('- MGP auto-plantfood delay already present');
}

// 3. Verify V8 syntax of both files
try {
  new vm.Script(appJs, { filename: 'application.js' });
  console.log('✓ application.js V8 syntax check passed');
} catch (e) {
  console.error('FAIL: application.js syntax error: ' + e.message);
  process.exit(1);
}

try {
  new vm.Script(mainJs, { filename: 'main.index.js' });
  console.log('✓ assets/main/index.js V8 syntax check passed');
} catch (e) {
  console.error('FAIL: main.index.js syntax error: ' + e.message);
  process.exit(1);
}

fs.writeFileSync(mainJsPath, mainJs, 'utf8');
console.log('\n[SUCCESS] All optimizations finalized and written!');
