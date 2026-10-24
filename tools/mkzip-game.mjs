/**
 * 把解包出来的官方 web 构建打成 Android 壳需要的 assets/pvzge_web-master.zip。
 *
 * 壳侧 GameActivity 用 ZipInputStream 直接解到 filesDir，再从 filesDir/pvzge_web-master/docs
 * 起服务，所以条目名必须带 `pvzge_web-master/docs/` 前缀，且不能多一层、也不能改前缀。
 *
 * 输入是 extract-all.mjs 从官方 exe 解出的原始树（键为 /index.html、/assets/...），
 * 这里只做「加前缀 + 打包」，不碰任何字节，保证产物与官方发布包逐字节一致。
 *
 * 用法: node mkzip-game.mjs <srcDir> <outZip>
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = process.argv[2];
const OUT = process.argv[3];
const PREFIX = 'pvzge_web-master/docs/';
// --store-media：已压缩媒体（音频/贴图/字体/容器）直接 store，不再白跑一遍 deflate。
// full 包有 1.28GB 素材，全量 deflate 要几分钟且几乎压不动；官方 full 包本身也是 store 风格。
const STORE_MEDIA = process.argv.includes('--store-media');
const STORE_EXT = new Set(['m4a', 'mp3', 'mp4', 'avif', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'ogg', 'wav',
  'wasm', 'bin', 'cconb', 'astc', 'pkm', 'pvr', 'ttf', 'otf', 'woff', 'woff2', 'ico', 'br']);
if (!SRC || !OUT) { console.error('usage: node mkzip-game.mjs <srcDir> <outZip> [--store-media]'); process.exit(2); }

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]; return (c ^ 0xffffffff) >>> 0; }

const files = [];
(function walk(dir, rel) {
  for (const it of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (it.name.startsWith('.')) continue;
    const r = rel ? rel + '/' + it.name : it.name;
    if (it.isDirectory()) walk(path.join(dir, it.name), r);
    else files.push([PREFIX + r, path.join(dir, it.name)]);
  }
})(SRC, '');
files.sort((a, b) => (a[0] < b[0] ? -1 : 1));

const fd = fs.openSync(OUT, 'w');
let off = 0;
const buf = Buffer.alloc(1 << 16);
function push(b) { let o = 0; while (o < b.length) o += fs.writeSync(fd, b, o, b.length - o, off + o); off += b.length; }

// 固定时间戳，保证同样输入产出同样的包
const DTIME = ((0 << 11) | (0 << 5) | (0 >> 1)) & 0xffff;
const DDATE = (((2026 - 1980) << 9) | (1 << 5) | 1) & 0xffff;

const central = [];
let raw = 0;
for (const [name, abs] of files) {
  const data = fs.readFileSync(abs);
  raw += data.length;
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const skipDeflate = STORE_MEDIA && STORE_EXT.has(ext);
  const def = skipDeflate ? null : zlib.deflateRawSync(data, { level: 6 });
  const useStore = skipDeflate || def.length >= data.length;
  const payload = useStore ? data : def;
  const nameBuf = Buffer.from(name, 'utf8');
  const lho = off;
  const lh = Buffer.alloc(30 + nameBuf.length);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(useStore ? 0 : 8, 8);
  lh.writeUInt16LE(DTIME, 10); lh.writeUInt16LE(DDATE, 12);
  lh.writeUInt32LE(crc32(data), 14);
  lh.writeUInt32LE(payload.length, 18); lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(lh, 30);
  push(lh); push(payload);
  central.push({ name: nameBuf, method: useStore ? 0 : 8, crc: crc32(data), csize: payload.length, usize: data.length, lho });
}
const cdStart = off;
for (const e of central) {
  const rec = Buffer.alloc(46 + e.name.length);
  rec.writeUInt32LE(0x02014b50, 0); rec.writeUInt16LE(20, 4); rec.writeUInt16LE(20, 6);
  rec.writeUInt16LE(0x0800, 8); rec.writeUInt16LE(e.method, 10);
  rec.writeUInt16LE(DTIME, 12); rec.writeUInt16LE(DDATE, 14);
  rec.writeUInt32LE(e.crc, 16); rec.writeUInt32LE(e.csize, 20); rec.writeUInt32LE(e.usize, 24);
  rec.writeUInt16LE(e.name.length, 28); rec.writeUInt32LE(e.lho, 42);
  e.name.copy(rec, 46);
  push(rec);
}
const cdSize = off - cdStart;
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
push(eocd);
fs.closeSync(fd);

console.log('entries', central.length, 'raw', (raw / 1048576).toFixed(1) + 'MB', 'zip', (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB');
