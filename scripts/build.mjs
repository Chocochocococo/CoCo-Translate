// 建置腳本：src/ + manifests/<browser>.json → dist/<browser>/ 與可上架的 zip / xpi
// 用法：node scripts/build.mjs [chrome|firefox]（不帶參數就兩個都建）
// 不需要安裝任何套件，Node 18+ 就能跑
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const BROWSERS = ['chrome', 'firefox'];

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const listFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? listFiles(full) : [full];
});

// ---------- 檢查：Firefox manifest 的 background scripts 要跟 background.js 的 importScripts 一致 ----------
function checkBackgroundLibs(manifest) {
  const background = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
  const match = background.match(/const BACKGROUND_LIBS = \[([\s\S]*?)\];/);
  if (!match) throw new Error('background.js: BACKGROUND_LIBS not found');
  const libs = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const expected = [...libs, 'background.js'];
  const actual = manifest.background.scripts;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`firefox.json background.scripts 跟 BACKGROUND_LIBS 不一致：\n  manifest: ${actual}\n  expected: ${expected}`);
  }
}

// ---------- 最小 zip 寫入器（deflate） ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

function createZip(entries) {
  // 固定時間戳（1980-01-01），同樣的原始碼每次打包出來的檔案都一樣
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 檔名
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuffer, end]);
}

// ---------- 建置 ----------
function build(browser) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', `${browser}.json`), 'utf8'));
  manifest.version = version;
  if (browser === 'firefox') checkBackgroundLibs(manifest);

  const outDir = path.join(DIST, browser);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const entries = [];
  const manifestData = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestData);
  entries.push({ name: 'manifest.json', data: manifestData });

  for (const file of listFiles(SRC).sort()) {
    const relative = path.relative(SRC, file).split(path.sep).join('/');
    const data = fs.readFileSync(file);
    const target = path.join(outDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    entries.push({ name: relative, data });
  }

  const extension = browser === 'firefox' ? 'xpi' : 'zip';
  const packagePath = path.join(DIST, `coco-translate-${browser}-${version}.${extension}`);
  fs.writeFileSync(packagePath, createZip(entries));
  console.log(`✔ ${browser}: dist/${browser}/  →  ${path.relative(ROOT, packagePath)}`);
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : BROWSERS;
for (const browser of targets) {
  if (!BROWSERS.includes(browser)) {
    console.error(`Unknown browser: ${browser}（只支援 ${BROWSERS.join(' / ')}）`);
    process.exit(1);
  }
  build(browser);
}
