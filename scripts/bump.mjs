// 升版本號：package.json（打包時會寫進兩個 manifest）＋ README 的「最新版本」「最後更新日」
// 用法：
//   npm run bump              最後一碼 +1        1.4.0.0 → 1.4.0.1
//   npm run bump -- patch     第三碼 +1          1.4.0.3 → 1.4.1.0
//   npm run bump -- minor     第二碼 +1          1.4.1.0 → 1.5.0.0
//   npm run bump -- major     第一碼 +1          1.5.0.0 → 2.0.0.0
//   npm run bump -- 1.5.2.0   直接指定
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = path.join(ROOT, 'package.json');
const README = path.join(ROOT, 'README.md');
const LEVELS = ['major', 'minor', 'patch', 'build'];

// Chrome / Firefox 的版本號：1～4 段數字，每段 0～65535，不能有前導 0
const parse = version => {
  const parts = String(version).split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some(p => !/^(0|[1-9]\d*)$/.test(p) || Number(p) > 65535)) {
    throw new Error(`版本號格式不對：${version}（要像 1.5.0.0 這樣，每段 0～65535）`);
  }
  return [...parts.map(Number), 0, 0, 0].slice(0, 4);
};

const next = (current, arg = 'build') => {
  if (!LEVELS.includes(arg)) return parse(arg);
  const parts = parse(current);
  const index = LEVELS.indexOf(arg);
  parts[index] += 1;
  for (let i = index + 1; i < 4; i++) parts[i] = 0;
  if (parts[index] > 65535) throw new Error('版本號超過 65535 了');
  return parts;
};

const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
const previous = pkg.version;
let version;
try {
  version = next(previous, process.argv[2]).join('.');
} catch (error) {
  console.error(`✘ ${error.message}`);
  process.exit(1);
}
pkg.version = version;
fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json: ${previous} → ${version}`);

if (fs.existsSync(README)) {
  const today = new Date();
  const date = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  let readme = fs.readFileSync(README, 'utf8');
  const updated = readme
    .replace(/^Ver\.\d+(?:\.\d+){0,3}[ \t]*$/m, `Ver.${version}`)
    .replace(/^最後更新日：.*$/m, `最後更新日：${date}`);
  if (updated !== readme) {
    fs.writeFileSync(README, updated);
    console.log(`README.md: Ver.${version}、最後更新日：${date}`);
  } else {
    console.log('README.md: 找不到「Ver.」或「最後更新日」那一行，沒有更動');
  }
}
