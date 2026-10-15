// docparse.js：PDF 文字 → 段落、TXT → 段落、文字檔編碼
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const context = vm.createContext({ TextDecoder, console });
vm.runInContext(fs.readFileSync(path.join(SRC, 'docparse.js'), 'utf8'), context, { filename: 'docparse.js' });
const { DocParse } = context;
const plain = value => JSON.parse(JSON.stringify(value));

// pdf.js getTextContent() 的一個項目：每個字寬 5、字高 size
const item = (str, x, y, { size = 10, eol = true } = {}) => ({
  str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, hasEOL: eol
});
// 一行一個項目，由上往下排（PDF 的 y 往上增加）
const page = (lines, { top = 800, gap = 12, size = 10 } = {}) => {
  let y = top;
  return lines.map(entry => {
    const [text, options = {}] = Array.isArray(entry) ? entry : [entry];
    y -= options.gap ?? gap;
    return item(text, options.x ?? 50, y, { size: options.size ?? size });
  });
};

test('DocParse: 自動折行的英文接回同一段，斷字的連字號拿掉', () => {
  const [paragraphs] = plain(DocParse.paragraphsFromPdfPages([page([
    'Press and hold the power button for three seconds until the indicator light starts to',
    'blink. Then release the button and wait for the device to finish its start-',
    'up sequence before continuing.'
  ])]));
  assert.deepEqual(paragraphs.map(p => p.text), [
    'Press and hold the power button for three seconds until the indicator light starts to blink. Then release the button and wait for the device to finish its startup sequence before continuing.'
  ]);
});

test('DocParse: 行距變大、標題字級、項目符號都會分段', () => {
  const [paragraphs] = plain(DocParse.paragraphsFromPdfPages([page([
    ['Getting Started', { size: 16 }],
    ['Before using the device, read all of the safety instructions in this manual carefully.', { gap: 20 }],
    ['Keep this manual for future reference and give it to the next owner of the device.'],
    ['• Do not expose the device to water.', { gap: 22 }],
    ['• Use only the supplied charger.']
  ])]));
  assert.deepEqual(paragraphs.map(p => p.text), [
    'Getting Started',
    'Before using the device, read all of the safety instructions in this manual carefully. Keep this manual for future reference and give it to the next owner of the device.',
    '• Do not expose the device to water.',
    '• Use only the supplied charger.'
  ]);
  assert.deepEqual(paragraphs.map(p => p.heading), [true, false, false, false]);
});

test('DocParse: 每頁都有的頁首、頁尾和頁碼會拿掉', () => {
  const pages = [1, 2, 3].map(n => page([
    'Model X200 User Manual',
    `Section ${n} body text that explains something important about the device.`,
    `${n}`
  ]));
  const paragraphs = plain(DocParse.paragraphsFromPdfPages(pages));
  assert.deepEqual(paragraphs.map(p => p.map(x => x.text)), [
    ['Section 1 body text that explains something important about the device.'],
    ['Section 2 body text that explains something important about the device.'],
    ['Section 3 body text that explains something important about the device.']
  ]);
});

test('DocParse: 只差數字的頁首會拿掉，但只差數字的內文、每頁的大標題要留著', () => {
  const pages = [1, 2, 3].map(n => [
    item(`Chapter ${n} · Safety Guide`, 50, 800, { size: 8 }),
    item(`Chapter ${n}`, 50, 760, { size: 18 }),
    item(`Read section ${n} first.`, 50, 730),
    item(`- Unplug part ${n} before cleaning.`, 50, 718)
  ]);
  const paragraphs = plain(DocParse.paragraphsFromPdfPages(pages));
  assert.deepEqual(paragraphs[1].map(x => x.text), ['Chapter 2', 'Read section 2 first.', '- Unplug part 2 before cleaning.']);
});

test('DocParse: 同一行切成好幾個項目時，英文補空格、中文不補', () => {
  const lines = plain(DocParse.linesFromItems([
    item('Hello', 50, 700, { eol: false }), item('world', 80, 700, { eol: true }),
    item('使用', 50, 680, { eol: false }), item('說明', 60, 680, { eol: true })
  ]));
  assert.deepEqual(lines.map(l => l.text), ['Hello world', '使用說明']);
});

test('DocParse: 中文折行接回來不加空格', () => {
  const [paragraphs] = plain(DocParse.paragraphsFromPdfPages([page([
    '請先確認電源線已經確實插入插座，再按下電源按鈕三秒鐘，等待指示燈開始閃爍',
    '之後放開按鈕。'
  ])]));
  assert.deepEqual(paragraphs.map(p => p.text), ['請先確認電源線已經確實插入插座，再按下電源按鈕三秒鐘，等待指示燈開始閃爍之後放開按鈕。']);
});

test('DocParse: TXT 用空行分段，自動折行接回來，短行（詩、清單）保留換行', () => {
  const text = 'Chapter One\r\n\r\nThe rain had not stopped for three days, and the whole town smelled of\nwet stone and chimney smoke from every single house.\n\n\nRoses are red\nViolets are blue\n';
  assert.deepEqual(plain(DocParse.paragraphsFromText(text)).map(p => p.text), [
    'Chapter One',
    'The rain had not stopped for three days, and the whole town smelled of wet stone and chimney smoke from every single house.',
    'Roses are red\nViolets are blue'
  ]);
});

test('DocParse: 文字檔編碼（UTF-8、有 BOM 的 UTF-16、Big5）', () => {
  assert.equal(DocParse.decodeText(new TextEncoder().encode('你好 hello')), '你好 hello');
  assert.equal(DocParse.decodeText(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])), '你好');
  // 「你好」的 Big5：A7 41 A6 6E
  assert.equal(DocParse.decodeText(new Uint8Array([0xa7, 0x41, 0xa6, 0x6e])), '你好');
});
